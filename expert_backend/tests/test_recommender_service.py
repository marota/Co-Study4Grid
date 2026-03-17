import os
from pathlib import Path
from unittest.mock import patch, mock_open, MagicMock

import numpy as np
import pytest

from expert_backend.services.recommender_service import RecommenderService
from expert_backend.main import ConfigRequest
from expert_op4grid_recommender import config

class TestRecommenderService:
    @patch("expert_backend.services.recommender_service.enrich_actions_lazy")
    @patch("expert_backend.services.recommender_service.load_actions")
    @patch("expert_backend.services.network_service.network_service")
    @patch("builtins.open", new_callable=mock_open)
    def test_update_config_applies_settings(self, mock_file, mock_network_service, mock_load_actions, mock_enrich):
        # Set up mocks
        mock_load_actions.return_value = {"existing_action": {}}
        mock_network_service.get_disconnectable_elements.return_value = ["line1", "line2"]
        mock_network_service.get_monitored_elements.return_value = ["line1"]
        
        service = RecommenderService()
        
        # Test paths
        network_path = "/tmp/test_network.xiidm"
        action_path = "/tmp/test_actions.json"
        layout_path = "/tmp/test_layout.json"

        # Create a sample config request with test data paths and custom values
        settings = ConfigRequest(
            network_path=network_path,
            action_file_path=action_path,
            layout_path=layout_path,
            min_line_reconnections=5.0,
            min_close_coupling=4.0,
            min_open_coupling=3.0,
            min_line_disconnections=2.0,
            n_prioritized_actions=20,
            monitoring_factor=0.85,
            pre_existing_overload_threshold=0.05,
            ignore_reconnections=True,
            pypowsybl_fast_mode=False
        )

        service.update_config(settings)

        # Verify that config module was updated correctly
        assert config.ENV_PATH == Path(network_path)
        assert config.ENV_NAME == "test_network.xiidm"
        assert config.ENV_FOLDER == Path("/tmp")
        assert config.ACTION_FILE_PATH == Path(action_path)
        assert config.LAYOUT_FILE_PATH == Path(layout_path)
        
        assert config.MIN_LINE_RECONNECTIONS == 5.0
        assert config.MIN_CLOSE_COUPLING == 4.0
        assert config.MIN_OPEN_COUPLING == 3.0
        assert config.MIN_LINE_DISCONNECTIONS == 2.0
        assert config.N_PRIORITIZED_ACTIONS == 20
        assert config.MONITORING_FACTOR_THERMAL_LIMITS == 0.85
        assert config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD == 0.05
        
        # Verify the new settings are applied
        assert config.IGNORE_RECONNECTIONS is True
        assert config.PYPOWSYBL_FAST_MODE is False

        # Verify side effects (mocks)
        mock_load_actions.assert_called_once_with(Path(action_path))
        # Since disco_ actions were not in mock_load_actions.return_value, it should have auto-generated them
        # and called open(action_path, 'w')
        mock_file.assert_called_with(Path(action_path), 'w')
        
    def test_update_config_defaults(self):
        # We also want to verify that default settings work as expected
        with patch("expert_backend.services.recommender_service.load_actions") as mock_load, \
             patch("expert_backend.services.recommender_service.enrich_actions_lazy") as mock_enrich, \
             patch("expert_backend.services.network_service.network_service") as mock_ns, \
             patch("builtins.open", mock_open()):
            
            mock_load.return_value = {"disco_line1": {}} # already has disco
            service = RecommenderService()
            
            settings = ConfigRequest(
                network_path="/tmp/net",
                action_file_path="/tmp/act.json"
                # using defaults for the rest
            )
            
            service.update_config(settings)
            
            # Defaults check (based on main.py)
            assert config.IGNORE_RECONNECTIONS is False
            assert config.PYPOWSYBL_FAST_MODE is True
            assert config.MONITORING_FACTOR_THERMAL_LIMITS == 0.95
            assert config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD == 0.02


class TestRestoreAnalysisContext:
    """Tests for RecommenderService.restore_analysis_context()."""

    def test_restore_sets_analysis_context(self):
        service = RecommenderService()
        assert service._analysis_context is None

        service.restore_analysis_context(
            lines_we_care_about=["LINE_A", "LINE_B"],
            disconnected_element="LINE_X",
            lines_overloaded=["LINE_A"],
        )

        assert service._analysis_context is not None
        assert service._analysis_context["lines_we_care_about"] == ["LINE_A", "LINE_B"]
        assert service._analysis_context["lines_overloaded"] == ["LINE_A"]
        assert service._last_disconnected_element == "LINE_X"

    def test_restore_with_none_lines(self):
        service = RecommenderService()
        service.restore_analysis_context(lines_we_care_about=None)

        assert service._analysis_context is not None
        assert service._analysis_context["lines_we_care_about"] is None

    def test_restore_with_computed_pairs(self):
        service = RecommenderService()
        pairs = {"act1+act2": {"max_rho": 0.5, "betas": [0.1, 0.2]}}
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            computed_pairs=pairs,
        )

        assert service._saved_computed_pairs == pairs
        assert service.get_saved_computed_pairs() == pairs

    def test_restore_without_computed_pairs(self):
        service = RecommenderService()
        service.restore_analysis_context(lines_we_care_about=["L1"])

        assert service._saved_computed_pairs is None
        assert service.get_saved_computed_pairs() is None

    def test_restore_without_optional_fields(self):
        service = RecommenderService()
        service.restore_analysis_context(lines_we_care_about=["L1", "L2"])

        assert service._analysis_context["lines_we_care_about"] == ["L1", "L2"]
        assert "lines_overloaded" not in service._analysis_context
        assert service._last_disconnected_element is None

    def test_restore_updates_disconnected_element(self):
        service = RecommenderService()
        service._last_disconnected_element = "OLD_LINE"
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            disconnected_element="NEW_LINE",
        )
        assert service._last_disconnected_element == "NEW_LINE"

    def test_restore_does_not_overwrite_disconnected_element_if_none(self):
        service = RecommenderService()
        service._last_disconnected_element = "EXISTING"
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            disconnected_element=None,
        )
        # None is falsy, so it should not overwrite
        assert service._last_disconnected_element == "EXISTING"

    def test_reset_clears_restored_context(self):
        service = RecommenderService()
        service.restore_analysis_context(
            lines_we_care_about=["L1"],
            computed_pairs={"p": {}},
        )
        assert service._analysis_context is not None
        assert service._saved_computed_pairs is not None

        service.reset()
        assert service._analysis_context is None
        assert service._saved_computed_pairs is None


class TestGetMonitoringParametersWithContext:
    """Tests that _get_monitoring_parameters uses restored analysis context."""

    def _make_mock_obs(self, line_names):
        obs = MagicMock()
        obs.name_line = line_names
        obs._network_manager = MagicMock()
        network = MagicMock()
        obs._network_manager.network = network
        # Return empty limits so branches_with_limits defaults to set()
        import pandas as pd
        network.get_operational_limits.return_value = pd.DataFrame()
        return obs

    def test_uses_context_lines_we_care_about(self):
        service = RecommenderService()
        service._analysis_context = {
            "lines_we_care_about": ["LINE_A", "LINE_C"]
        }
        obs = self._make_mock_obs(["LINE_A", "LINE_B", "LINE_C"])

        lines, _ = service._get_monitoring_parameters(obs)
        assert lines == ["LINE_A", "LINE_C"]

    def test_fallback_without_context(self):
        service = RecommenderService()
        service._analysis_context = None
        obs = self._make_mock_obs(["LINE_A", "LINE_B"])

        # With IGNORE_LINES_MONITORING=True (default), falls back to all lines
        original = getattr(config, 'IGNORE_LINES_MONITORING', True)
        config.IGNORE_LINES_MONITORING = True
        try:
            lines, _ = service._get_monitoring_parameters(obs)
            assert lines == ["LINE_A", "LINE_B"]
        finally:
            config.IGNORE_LINES_MONITORING = original

    def test_context_with_none_care_falls_back_to_all_lines(self):
        service = RecommenderService()
        service._analysis_context = {"lines_we_care_about": None}
        obs = self._make_mock_obs(["L1", "L2", "L3"])

        lines, _ = service._get_monitoring_parameters(obs)
        assert lines == ["L1", "L2", "L3"]


class TestSimulateManualActionOverloadedLines:
    """Tests for care_mask and lines_overloaded_ids in simulate_manual_action.

    These tests verify that:
    1. Restored analysis context lines_overloaded are used directly
    2. Overloaded lines are always included in care_mask for max_rho
    3. max_rho correctly reflects the worst loading across all monitored lines
    """

    def _make_obs(self, rho_values, line_names, with_limits=True):
        """Create a mock observation with given rho values and line names.

        If with_limits=True, all lines are given permanent thermal limits in
        pypowsybl so they pass the branches_with_limits filter.
        """
        obs = MagicMock()
        obs.rho = np.array(rho_values)
        obs.name_line = line_names
        obs.n_components = 1
        obs.main_component_load_mw = 100.0
        obs._network_manager = MagicMock()
        network = MagicMock()
        obs._network_manager.network = network
        import pandas as pd
        if with_limits:
            limits_df = pd.DataFrame({
                'element_id': line_names,
                'type': ['CURRENT'] * len(line_names),
                'acceptable_duration': [-1] * len(line_names),
            })
        else:
            limits_df = pd.DataFrame()
        network.get_operational_limits.return_value = limits_df
        return obs

    def _setup_service_with_context(self, lines_we_care_about, lines_overloaded=None):
        """Create a RecommenderService with restored context and mocked internals."""
        service = RecommenderService()
        service._analysis_context = {
            "lines_we_care_about": lines_we_care_about,
        }
        if lines_overloaded is not None:
            service._analysis_context["lines_overloaded"] = lines_overloaded
        service._dict_action = {"act1": {"content": {}}}
        service._last_result = {"prioritized_actions": {}}
        return service

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    def test_context_overloaded_lines_used_for_rho_before_after(
        self, mock_get_env, mock_get_n, mock_get_n1
    ):
        """When _analysis_context has lines_overloaded, those lines should be used
        for rho_before/rho_after instead of recomputing."""
        line_names = ["LINE_A", "LINE_B", "LINE_C"]
        # N state: nothing overloaded
        obs_n = self._make_obs([0.3, 0.4, 0.5], line_names)
        # N-1 state: LINE_A is overloaded (rho > 1.0 raw, > 0.95 * monitoring_factor)
        obs_n1 = self._make_obs([0.3, 1.05, 0.5], line_names)
        obs_n1._variant_id = "n1_variant"
        # After action: LINE_B drops from 1.05 to 0.75
        obs_after = self._make_obs([0.3, 0.75, 0.55], line_names)
        obs_after.n_components = 1
        obs_after.main_component_load_mw = 100.0

        # Setup environment mock
        env = MagicMock()
        env.network_manager.network.get_working_variant_id.return_value = "base"
        env.action_space.return_value = MagicMock()
        env.get_obs.side_effect = [obs_n, obs_n1]
        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        mock_get_env.return_value = env
        mock_get_n.return_value = "n_variant"
        mock_get_n1.return_value = "n1_variant"

        service = self._setup_service_with_context(
            lines_we_care_about=line_names,
            lines_overloaded=["LINE_B"],  # From saved session
        )

        result = service.simulate_manual_action("act1", "DISCO_LINE")

        # rho_before and rho_after should be for LINE_B (index 1)
        assert len(result["rho_before"]) == 1
        assert len(result["rho_after"]) == 1
        assert result["lines_overloaded"] == ["LINE_B"]

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    def test_care_mask_includes_overloaded_lines_for_max_rho(
        self, mock_get_env, mock_get_n, mock_get_n1
    ):
        """Overloaded lines must always be included in care_mask so max_rho
        reflects the true worst-case loading, even if the pre-existing
        overload filter would normally exclude them."""
        line_names = ["LINE_A", "LINE_B", "LINE_C"]
        monitoring_factor = 0.95

        # N state: LINE_B has high rho (pre-existing overload in grid2op)
        obs_n = self._make_obs([0.3, 1.0, 0.4], line_names)
        # N-1 state: LINE_B gets worse
        obs_n1 = self._make_obs([0.3, 1.1, 0.4], line_names)
        obs_n1._variant_id = "n1_variant"
        # After action: LINE_B at 0.75 (action helped), LINE_C at 0.55
        # Without the fix, LINE_B would be excluded from care_mask because
        # obs_n.rho[1]=1.0 >= 0.95 and obs_after.rho[1]=0.75 <= 1.0*1.02
        # So max_rho would be 0.55*0.95=0.5225 on LINE_C instead of 0.75*0.95=0.7125 on LINE_B
        obs_after = self._make_obs([0.3, 0.75, 0.55], line_names)
        obs_after.n_components = 1
        obs_after.main_component_load_mw = 100.0

        env = MagicMock()
        env.network_manager.network.get_working_variant_id.return_value = "base"
        env.action_space.return_value = MagicMock()
        env.get_obs.side_effect = [obs_n, obs_n1]
        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        mock_get_env.return_value = env
        mock_get_n.return_value = "n_variant"
        mock_get_n1.return_value = "n1_variant"

        service = self._setup_service_with_context(
            lines_we_care_about=line_names,
            lines_overloaded=["LINE_B"],
        )

        result = service.simulate_manual_action("act1", "DISCO_LINE")

        # max_rho should be on LINE_B (0.75 * 0.95 = 0.7125), NOT LINE_C (0.55 * 0.95)
        assert result["max_rho"] == pytest.approx(0.75 * monitoring_factor, abs=0.001)
        assert result["max_rho_line"] == "LINE_B"

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    def test_without_context_recomputes_overloaded_lines(
        self, mock_get_env, mock_get_n, mock_get_n1
    ):
        """Without analysis context, lines_overloaded_ids should be recomputed."""
        line_names = ["LINE_A", "LINE_B"]
        # N state: nothing overloaded
        obs_n = self._make_obs([0.3, 0.4], line_names)
        # N-1 state: LINE_B overloaded (rho > monitoring_factor)
        obs_n1 = self._make_obs([0.3, 1.05], line_names)
        obs_n1._variant_id = "n1_variant"
        obs_after = self._make_obs([0.3, 0.8], line_names)
        obs_after.n_components = 1
        obs_after.main_component_load_mw = 100.0

        env = MagicMock()
        env.network_manager.network.get_working_variant_id.return_value = "base"
        env.action_space.return_value = MagicMock()
        env.get_obs.side_effect = [obs_n, obs_n1]
        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        mock_get_env.return_value = env
        mock_get_n.return_value = "n_variant"
        mock_get_n1.return_value = "n1_variant"

        service = RecommenderService()
        service._analysis_context = None  # No context
        service._dict_action = {"act1": {"content": {}}}
        service._last_result = {"prioritized_actions": {}}

        result = service.simulate_manual_action("act1", "DISCO_LINE")

        # LINE_B was detected as overloaded (rho=1.05 > 0.95) and not a pre-existing N overload
        assert "LINE_B" in result["lines_overloaded"]

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    def test_caller_lines_overloaded_used_without_context(
        self, mock_get_env, mock_get_n, mock_get_n1
    ):
        """When caller provides lines_overloaded and there's no context, use those."""
        line_names = ["LINE_A", "LINE_B"]
        obs_n = self._make_obs([0.3, 0.4], line_names)
        obs_n1 = self._make_obs([0.3, 1.05], line_names)
        obs_n1._variant_id = "n1_variant"
        obs_after = self._make_obs([0.3, 0.8], line_names)
        obs_after.n_components = 1
        obs_after.main_component_load_mw = 100.0

        env = MagicMock()
        env.network_manager.network.get_working_variant_id.return_value = "base"
        env.action_space.return_value = MagicMock()
        env.get_obs.side_effect = [obs_n, obs_n1]
        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        mock_get_env.return_value = env
        mock_get_n.return_value = "n_variant"
        mock_get_n1.return_value = "n1_variant"

        service = RecommenderService()
        service._analysis_context = None
        service._dict_action = {"act1": {"content": {}}}
        service._last_result = {"prioritized_actions": {}}

        result = service.simulate_manual_action(
            "act1", "DISCO_LINE",
            lines_overloaded=["LINE_A", "LINE_B"],
        )

        # Both lines provided by caller should be used
        assert result["lines_overloaded"] == ["LINE_A", "LINE_B"]
        assert len(result["rho_before"]) == 2
        assert len(result["rho_after"]) == 2
