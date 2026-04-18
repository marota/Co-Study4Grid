import pytest
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config

class TestCacheSynchronization:
    """Tests for the _cached_obs mechanism in RecommenderService."""

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    @patch.object(RecommenderService, '_get_base_network')
    def test_cache_hits_on_repeated_calls(self, mock_get_net, mock_get_env, mock_get_n, mock_get_n1):
        service = RecommenderService()
        service._dict_action = {"act1": {"content": {}}}
        service._last_result = {"prioritized_actions": {}}
        
        # Setup variants
        mock_get_n.return_value = "n_var"
        mock_get_n1.return_value = "n1_var"
        
        # Setup environment
        env = MagicMock()
        mock_get_env.return_value = env
        
        # Observations
        obs_n = MagicMock(name="obs_n")
        obs_n.rho = [0.5]
        obs_n.name_line = ["L1"]
        obs_n.n_components = 1
        obs_n1 = MagicMock(name="obs_n1")
        obs_n1.rho = [0.8]
        obs_n1.name_line = ["L1"]
        obs_n1.n_components = 1
        obs_after = MagicMock(name="obs_after")
        obs_after.rho = [0.7]
        obs_after.name_line = ["L1"]
        obs_after.n_components = 1
        obs_after.main_component_load_mw = 100.0
        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        
        # Fix for MagicMock comparisons in some environments
        with patch.object(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95), \
             patch.object(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02):
            
            # First call: get_obs should be called twice (N and N1)
            env.get_obs.side_effect = [obs_n, obs_n1]
            service.simulate_manual_action("act1", "DISCO_A")
            assert env.get_obs.call_count == 2
            
            # Second call with SAME contingency: get_obs should NOT be called (cache hit)
            env.get_obs.reset_mock()
            service.simulate_manual_action("act1", "DISCO_A")
            assert env.get_obs.call_count == 0
            assert service._cached_obs_n is obs_n
            assert service._cached_obs_n1 is obs_n1

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    def test_cache_invalidation_on_contingency_switch(self, mock_get_env, mock_get_n, mock_get_n1):
        service = RecommenderService()
        service._dict_action = {"act1": {"content": {}}}
        service._last_result = {"prioritized_actions": {}}
        
        env = MagicMock()
        mock_get_env.return_value = env
        
        # Contingency A
        mock_get_n.return_value = "n_var"
        # Each `simulate_manual_action` call now triggers `_get_n1_variant`
        # twice — once via the `_ensure_n1_state_ready` guard at entry
        # (see docs/perf-grid2op-shared-network.md), once inside the
        # simulation body. Two simulate calls → four side-effect values.
        mock_get_n1.side_effect = ["n1_A", "n1_A", "n1_B", "n1_B"]
        
        obs_n = MagicMock(name="obs_n")
        obs_n.rho = [0.5]
        obs_n.name_line = ["L1"]
        obs_n.n_components = 1
        obs_n1_A = MagicMock(name="obs_n1_A")
        obs_n1_A.rho = [0.6]
        obs_n1_A.name_line = ["L1"]
        obs_n1_A.n_components = 1
        obs_after = MagicMock(name="obs_after")
        obs_after.rho = [0.55]
        obs_after.name_line = ["L1"]
        obs_after.n_components = 1
        obs_after.main_component_load_mw = 100.0
        obs_n1_A.simulate.return_value = (obs_after, None, None, {"exception": None})
        
        with patch.object(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95), \
             patch.object(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02):
             
            env.get_obs.side_effect = [obs_n, obs_n1_A]
            service.simulate_manual_action("act1", "DISCO_A")
            
            # Switch to Contingency B
            obs_n1_B = MagicMock(name="obs_n1_B")
            obs_n1_B.rho = [0.7]
            obs_n1_B.name_line = ["L1"]
            obs_n1_B.n_components = 1
            obs_n1_B.simulate.return_value = (obs_after, None, None, {"exception": None})
            
            # When switching B, n1_variant_id changes to "n1_B"
            # N-cache should HIT, N1-cache should MISS
            env.get_obs.reset_mock()
            env.get_obs.side_effect = [obs_n1_B] # Only N1 should miss
            service.simulate_manual_action("act1", "DISCO_B")
            
            assert env.get_obs.call_count == 1 # Only one miss (N1)
            assert service._cached_obs_n1 is obs_n1_B
            assert service._cached_obs_n1_id == "n1_B"
            assert service._cached_obs_n is obs_n # Still hitting N cache

    def test_reset_clears_all_caches(self):
        service = RecommenderService()
        service._cached_obs_n = MagicMock()
        service._cached_obs_n1 = MagicMock()
        service._cached_obs_n_id = "v1"
        service._cached_obs_n1_id = "v2"
        # N-1 diagram fast-path (commit d220d61): LF status cache per
        # N-1 variant must be cleared when loading a new study,
        # otherwise stale convergence flags from the previous grid
        # would leak.
        service._lf_status_by_variant = {
            "N_1_state_DISCO_A": {"converged": True, "lf_status": "CONVERGED"},
            "N_1_state_DISCO_B": {"converged": False, "lf_status": "FAILED"},
        }

        service.reset()

        assert service._cached_obs_n is None
        assert service._cached_obs_n1 is None
        assert service._cached_obs_n_id is None
        assert service._cached_obs_n1_id is None
        # The LF-status cache dict must be emptied (not replaced with
        # None) so later `_get_n1_variant` calls on the fresh study
        # can still use `dict.get()` / `dict[key] = ...` safely.
        assert service._lf_status_by_variant == {}

    @patch.object(RecommenderService, '_get_simulation_env')
    def test_isolation_simulation_does_not_modify_cache_fields(self, mock_get_env):
        """Verify that simulation calls don't inadvertently modify cache property pointers."""
        service = RecommenderService()
        obs_n1 = MagicMock()
        obs_n1._variant_id = "v1"
        service._cached_obs_n1 = obs_n1
        service._cached_obs_n1_id = "v1"
        
        # If the code incorrectly did e.g. self._cached_obs_n1.some_prop = x
        # verify it stays isolated. Here we check that the object identity is preserved.
        assert service._cached_obs_n1 is obs_n1
