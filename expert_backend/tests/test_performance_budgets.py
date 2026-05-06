import pytest
import time
import numpy as np
from unittest.mock import MagicMock, patch
import pandas as pd
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config

class TestPerformanceBudgets:
    """Benchmark tests to ensure logic stays within performance budgets.

    Wall-clock budgets are inherently noisy on shared / loaded CI cores —
    a single 3 ms scheduler hiccup or GC pause can push a 150 ms budget
    past the line even when the steady-state logic is an order of
    magnitude faster. To stay sensitive to real regressions without
    failing on transient noise we run each measured path multiple times
    and assert the minimum, the standard practice for micro-benchmarks
    (see CPython's `timeit` recommendation). The minimum is the
    measurement closest to "logic only" — outliers above it are external
    interference, not behaviour we control.
    """

    # Number of measured iterations used to compute the steady-state
    # minimum. Five gives a comfortable margin against scheduler noise
    # while keeping each test under a second.
    _BENCH_ITERATIONS = 5

    def _make_large_obs(self, n_lines=2000):
        obs = MagicMock()
        obs.rho = np.random.rand(n_lines)
        obs.name_line = [f"LINE_{i}" for i in range(n_lines)]
        obs.n_components = 1
        obs.main_component_load_mw = 100.0
        obs._network_manager = MagicMock()
        network = MagicMock()
        obs._network_manager.network = network
        
        limits_df = pd.DataFrame({
            'element_id': obs.name_line,
            'type': ['CURRENT'] * n_lines,
            'acceptable_duration': [-1] * n_lines,
        })
        network.get_operational_limits.return_value = limits_df
        return obs

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    @patch.object(RecommenderService, '_get_base_network')
    def test_simulation_logic_budget_large_grid(self, mock_get_net, mock_get_env, mock_get_n, mock_get_n1):
        """Budget: < 50ms for 2,000 lines (logic only, mocked simulation)."""
        service = RecommenderService()
        service._dict_action = {"act1": {"content": {}}}
        service._last_result = {"prioritized_actions": {}}
        
        n_lines = 2000
        obs_n = self._make_large_obs(n_lines)
        obs_n1 = self._make_large_obs(n_lines)
        obs_after = self._make_large_obs(n_lines)
        
        # Mock simulation to be instant
        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        
        env = MagicMock()
        env.get_obs.side_effect = [obs_n, obs_n1]
        mock_get_env.return_value = env
        
        with patch.object(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95), \
             patch.object(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02):

            # Warm up to absorb cold-path overhead.
            service.simulate_manual_action("act1", "DISCO_1")

            # Measured runs — take the minimum to filter scheduler noise.
            durations_ms = []
            for _ in range(self._BENCH_ITERATIONS):
                obs_pre = self._make_large_obs(n_lines)
                obs_post = self._make_large_obs(n_lines)
                obs_after_iter = self._make_large_obs(n_lines)
                obs_post.simulate.return_value = (obs_after_iter, None, None, {"exception": None})
                env.get_obs.side_effect = [obs_pre, obs_post]
                start_time = time.perf_counter()
                service.simulate_manual_action("act1", "DISCO_1")
                end_time = time.perf_counter()
                durations_ms.append((end_time - start_time) * 1000)

            duration_ms = min(durations_ms)
            print(f"\n[PERF] 2,000 line simulation logic min={duration_ms:.2f}ms (samples={durations_ms})")

            # Target: < 50ms. Vectorized logic should easily be < 10ms on modern CPUs.
            assert duration_ms < 50, (
                f"Performance regression! Logic min took {duration_ms:.2f}ms "
                f"(budget: 50ms; samples: {durations_ms})"
            )

    @patch.object(RecommenderService, '_get_n1_variant')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_simulation_env')
    def test_simulation_logic_budget_small_grid(self, mock_get_env, mock_get_n, mock_get_n1):
        """Budget: < 150ms for small scale (e.g. 100 lines)."""
        service = RecommenderService()
        service._dict_action = {"act1": {"content": {}}}
        service._last_result = {"prioritized_actions": {}}
        
        n_lines = 100
        obs_n = self._make_large_obs(n_lines)
        obs_n1 = self._make_large_obs(n_lines)
        obs_after = self._make_large_obs(n_lines)
        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        
        env = MagicMock()
        env.get_obs.side_effect = [obs_n, obs_n1]
        mock_get_env.return_value = env
        
        with patch.object(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95):
            # Warm up to absorb first-call overhead (module import resolution,
            # MagicMock attribute caching, cold BLAS/pandas paths). Without
            # this, a cold first call on a loaded CI machine occasionally
            # spikes past the budget even though the steady-state logic is
            # an order of magnitude faster. Mirrors the warm-up in the
            # large-grid test above.
            service.simulate_manual_action("act1", "DISCO_1")

            # Measured runs — take the minimum across N iterations to
            # reject scheduler / GC noise. env.get_obs.side_effect is an
            # iterator consumed two values at a time (N + N-1) so it has
            # to be reset each iteration.
            durations_ms = []
            for _ in range(self._BENCH_ITERATIONS):
                obs_pre = self._make_large_obs(n_lines)
                obs_post = self._make_large_obs(n_lines)
                obs_after_iter = self._make_large_obs(n_lines)
                obs_post.simulate.return_value = (obs_after_iter, None, None, {"exception": None})
                env.get_obs.side_effect = [obs_pre, obs_post]
                start_time = time.perf_counter()
                service.simulate_manual_action("act1", "DISCO_1")
                end_time = time.perf_counter()
                durations_ms.append((end_time - start_time) * 1000)

            duration_ms = min(durations_ms)
            print(f"\n[PERF] 100 line simulation logic min={duration_ms:.2f}ms (samples={durations_ms})")

            assert duration_ms < 150, (
                f"Performance regression! Small logic min took {duration_ms:.2f}ms "
                f"(budget: 150ms; samples: {durations_ms})"
            )
