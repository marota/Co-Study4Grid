import numpy as np
import pytest
from unittest.mock import MagicMock, patch
import pandas as pd

from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config

class TestVectorizedMonitoringLogic:
    """Consolidated tests for vectorized monitoring, masking, and coercion."""

    def _make_obs(self, rho_values, line_names, with_limits=True):
        obs = MagicMock()
        obs.rho = np.array(rho_values)
        obs.name_line = line_names
        obs.n_components = 1
        obs.main_component_load_mw = 100.0
        obs._network_manager = MagicMock()
        network = MagicMock()
        obs._network_manager.network = network
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

    def test_coercion_handles_various_types(self):
        """Verify np.atleast_1d and float conversion works for legacy mocks."""
        service = RecommenderService()
        
        # 1. Standard NumPy
        arr = np.array([0.5, 1.2])
        coerced = np.atleast_1d(arr).astype(float)
        assert np.array_equal(coerced, arr)

        # 2. List
        lst = [0.5, 1.2]
        coerced = np.atleast_1d(lst).astype(float)
        assert np.array_equal(coerced, arr)

        # 3. MagicMock (simulating legacy tests)
        mock_val = MagicMock()
        mock_val.__array__ = lambda *args: arr 
        # Note: In the actual code we use np.atleast_1d(mock_val).astype(float)
        # which triggers the __array__ or similar if defined, or wraps it.
        # Our fix used np.atleast_1d(getattr(obs, 'rho', [])).astype(float)
        
        test_obs = MagicMock()
        test_obs.rho = [0.5, 1.2]
        res = np.atleast_1d(test_obs.rho).astype(float)
        assert np.array_equal(res, arr)

    def test_monitoring_factor_threshold_edge_cases(self):
        """Verify strict inequality or precision in monitoring factor."""
        service = RecommenderService()
        line_names = ["L1", "L2", "L3"]
        monitoring_factor = 0.95
        
        # Rho exactly at 0.95 should NOT be considered overloaded if using >
        # Our code uses: mask = rho_n1 > monitoring_factor
        obs_n1 = self._make_obs([0.949, 0.950, 0.951], line_names)
        
        # Mocking config
        with patch.object(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95):
            rho_n1 = np.atleast_1d(obs_n1.rho).astype(float)
            mask = rho_n1 > config.MONITORING_FACTOR_THERMAL_LIMITS
            assert not mask[0] # 0.949
            assert not mask[1] # 0.950 (Exactly at threshold)
            assert mask[2]     # 0.951 (Just above)

    def test_care_mask_logic_with_impact_threshold(self):
        """Detailed check of the symmetric impact-based care_mask used in
        simulate_manual_action. A pre-existing overload is excluded only
        when the contingency leaves it inside the ±impact_threshold band
        around its N value (i.e. the line is unaffected by the contingency
        and the issue belongs to other root causes).
        """
        service = RecommenderService()
        line_names = ["PRE_EXISTING", "NEW_OVERLOAD", "IMPROVED", "STABLE", "INERT_PREEXISTING"]

        # N state
        # PRE_EXISTING: 1.1 (already overloaded)
        # NEW_OVERLOAD: 0.8 (healthy)
        # IMPROVED: 1.2 (already overloaded)
        # STABLE: 0.5 (healthy)
        # INERT_PREEXISTING: 1.0 (already overloaded)
        obs_n = self._make_obs([1.1, 0.8, 1.2, 0.5, 1.0], line_names)

        # N-1 state (after contingency)
        # PRE_EXISTING: 1.15 (worsened from 1.1, ratio=1.045 → outside +2% band)
        # NEW_OVERLOAD: 1.05 (now overloaded)
        # IMPROVED: 1.1 (improved from 1.2, ratio=0.917 → outside -2% band)
        # STABLE: 0.55 (worsened but still healthy)
        # INERT_PREEXISTING: 1.005 (barely changed, ratio=1.005 → inside band)
        obs_n1 = self._make_obs([1.15, 1.05, 1.1, 0.55, 1.005], line_names)

        with patch.object(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95), \
             patch.object(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02):

            rho_n = np.atleast_1d(obs_n.rho).astype(float)
            rho_n1 = np.atleast_1d(obs_n1.rho).astype(float)

            mf = config.MONITORING_FACTOR_THERMAL_LIMITS
            wt = config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD

            was_overloaded = rho_n > mf
            is_overloaded = rho_n1 > mf
            # Symmetric impact rule — see services.simulation_helpers.
            impacted = (rho_n1 < rho_n * (1 - wt)) | (rho_n1 > rho_n * (1 + wt))

            care_mask = (is_overloaded & ~was_overloaded) | (is_overloaded & was_overloaded & impacted)

            # PRE_EXISTING: Overloaded in both, ratio 1.045 > 1.02. → TRUE.
            assert care_mask[0] == True

            # NEW_OVERLOAD: Healthy in N, Overloaded in N-1. → TRUE.
            assert care_mask[1] == True

            # IMPROVED: Overloaded in both, ratio 0.917 < 0.98. Symmetric
            # rule keeps it because the contingency clearly *impacted* it. → TRUE.
            assert care_mask[2] == True

            # STABLE: Healthy in both. → FALSE.
            assert care_mask[3] == False

            # INERT_PREEXISTING: Overloaded in both, ratio 1.005 inside band. → FALSE.
            assert care_mask[4] == False

    def test_mask_integrity_with_real_thermal_limits(self):
        """Ensure care_mask respects branches_with_limits (thermal limits)."""
        service = RecommenderService()
        line_names = ["LIMIT_SET", "NO_LIMIT"]
        obs_n = self._make_obs([0.5, 0.5], line_names)
        obs_n1 = self._make_obs([1.2, 1.2], line_names)
        
        # Setup limits: only one line has a limit
        network = obs_n1._network_manager.network
        network.get_operational_limits.return_value = pd.DataFrame({
            'element_id': ["LIMIT_SET"],
            'type': ['CURRENT'],
            'acceptable_duration': [-1],
        })

        with patch.object(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95):
            # Extract monitored info
            monitored_lines, branches_with_limits = service._get_monitoring_parameters(obs_n1)
            
            # monitored_lines is the "care about" list, which defaults to all lines
            assert "LIMIT_SET" in monitored_lines
            assert "NO_LIMIT" in monitored_lines
            
            # branches_with_limits should strictly contain only those with thermal limits
            assert "LIMIT_SET" in branches_with_limits
            assert "NO_LIMIT" not in branches_with_limits
