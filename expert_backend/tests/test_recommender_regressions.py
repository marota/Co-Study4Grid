import pytest
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService
import numpy as np

class TestRecommenderRegressions:
    def setup_method(self):
        self.service = RecommenderService()

    def test_mw_calculation_robustness(self):
        """Regression test for gen_p naming and abs() MW calculation (Fixes 0.0MW display)."""
        # 1. Mock observations: obs_n1 has gen_p (PyPowsybl), no prod_p (Grid2Op)
        obs_n1 = MagicMock()
        obs_n1.name_gen = ["GEN_1", "GEN_2"]
        obs_n1.gen_p = np.array([-10.0, -20.0])
        del obs_n1.prod_p # Ensure it's not there

        obs_action = MagicMock()
        obs_action.name_gen = ["GEN_1", "GEN_2"]
        obs_action.gen_p = np.array([0.0, -20.0]) # GEN_1 is curtailed (0.0)
        del obs_action.prod_p

        # 2. Test _compute_curtailment_details
        # Set up analysis context for N-1 observation
        self.service._analysis_context = {"obs_simu_defaut": obs_n1}
        
        # Action data contains the action object and the post-action observation
        mock_action = MagicMock()
        mock_action.gens_bus = {"GEN_1": -1}
        action_data = {
            "action": mock_action,
            "observation": obs_action
        }
        
        with patch.object(self.service, "_is_renewable_gen", return_value=True), \
             patch("expert_backend.services.network_service.network_service.get_generator_voltage_level", return_value="VL1"):
            
            details = self.service._compute_curtailment_details(action_data)
            
            assert details is not None
            assert len(details) == 1
            # abs(-10.0 - 0.0) = 10.0. 
            assert details[0]["curtailed_mw"] == 10.0

        # 3. Test _mw_start_curtailment
        gen_idx_map = {"GEN_1": 0, "GEN_2": 1}
        action_entry = {"content": {"set_bus": {"generators_id": {"GEN_1": -1}}}}
        
        mw_start = self.service._mw_start_curtailment("curtail_GEN_1", action_entry, obs_n1, gen_idx_map)
        assert mw_start == 10.0 # abs(-10.0)

    def test_dynamic_curtailment_reconstruction(self):
        """Regression test for curtail_ prefix handling in simulate_manual_action."""
        self.service._dict_action = {"dummy": {}} # Set non-empty
        
        # Mock simulation environment and network
        mock_env = MagicMock()
        mock_nm = MagicMock()
        mock_env.network_manager = mock_nm
        mock_n = MagicMock()
        mock_nm.network = mock_n
        mock_n.get_working_variant_id.return_value = "base"
        mock_n.get_variant_ids.return_value = ["base", "N_state_cached", "contingency_state_NONE"]
        
        # Mock observations
        mock_obs = MagicMock()
        mock_obs.name_line = ["LINE_1"]
        mock_obs.rho = np.array([0.5])
        mock_obs.n_components = 1
        mock_env.get_obs.return_value = mock_obs
        
        # Mock simulation result
        mock_simulated = MagicMock()
        mock_simulated.name_line = ["LINE_1"]
        mock_simulated.rho = np.array([0.4])
        mock_simulated.n_components = 1
        mock_obs.simulate.return_value = (mock_simulated, 0.0, False, {"exception": None})
        
        # Mock action object returned by action_space
        mock_action = MagicMock()
        mock_action.gens_bus = {}
        mock_action.loads_bus = {}
        mock_action.gens_p = {"GEN_TEST": 0.0}
        mock_action.loads_p = {}
        mock_env.action_space.return_value = mock_action
        
        with patch.object(self.service, "_get_simulation_env", return_value=mock_env), \
             patch.object(self.service, "_get_n_variant", return_value="N_state_cached"), \
             patch.object(self.service, "_get_contingency_variant", return_value="contingency_state_NONE"), \
             patch.object(self.service, "_get_monitoring_parameters", return_value=(["LINE_1"], {"LINE_1"})), \
             patch.object(self.service, "_is_renewable_gen", return_value=True), \
             patch("expert_backend.services.network_service.network_service.get_generator_voltage_level", return_value="VL_TEST"), \
             patch.object(self.service, "_compute_deltas", return_value={"flow_deltas": {}, "reactive_flow_deltas": {}}), \
             patch.object(self.service, "_compute_asset_deltas", return_value={}):
            
            # Action 'curtail_GEN_TEST' is NOT in self._dict_action
            assert "curtail_GEN_TEST" not in self.service._dict_action
            
            # Call simulate_manual_action
            # Use "NONE" as disconnected_element to match mock_n.get_variant_ids
            result = self.service.simulate_manual_action("curtail_GEN_TEST", "NONE")
            
            # Verify it was dynamically created and injected
            assert "curtail_GEN_TEST" in self.service._dict_action
            entry = self.service._dict_action["curtail_GEN_TEST"]
            assert entry["content"]["set_gen_p"]["GEN_TEST"] == 0.0
            assert "Renewable curtailment" in entry["description"]

            # Verify enriched result contains curtailment_details
            assert "curtailment_details" in result
            assert len(result["curtailment_details"]) == 1
            assert result["curtailment_details"][0]["gen_name"] == "GEN_TEST"
            # It should also have curtailed_mw (mocked as 0.0 in this specific test since we didn't mock gen_p in this test case's obs)
            assert "curtailed_mw" in result["curtailment_details"][0]
