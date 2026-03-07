import pytest
import os
from pathlib import Path
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config
from expert_op4grid_recommender.data_loader import load_actions, enrich_actions_lazy

class TestRecommenderSimulationRealData:
    @classmethod
    def setup_class(cls):
        # Use the small test grid included in the repo
        cls.test_env_path = Path(__file__).parent.parent.parent / "data" / "bare_env_small_grid_test"
        cls.grid_path = cls.test_env_path / "grid.xiidm"

        # New action dictionary without pre-computed content (lazy format)
        cls.action_path = Path(__file__).parent.parent.parent / "data" / "action_space" / "reduced_model_actions_test_pypowsybl.json"

        # Ensure test data exists
        if not cls.grid_path.exists():
            pytest.skip(f"Test grid not found at {cls.grid_path}")
        if not cls.action_path.exists():
            pytest.skip(f"Action file not found at {cls.action_path}")

    def setup_method(self):
        self.service = RecommenderService()
        # Point config to our test data
        config.ENV_PATH = self.test_env_path
        # Start with empty action dict
        self.service._dict_action = {}

    def test_get_network_variants_caching_real(self):
        """Verify that variants are cached and not recreated if they already exist."""
        # 1. Base network should be cached
        n1 = self.service._get_base_network()
        n2 = self.service._get_base_network()
        assert n1 is n2

        # 2. N variant should be created once
        v_n = self.service._get_n_variant()
        assert v_n == "N_state_cached"
        assert v_n in n1.get_variant_ids()

        # Check that calling it again doesn't trigger another clone_variant
        with patch.object(n1, "clone_variant") as mock_clone:
            v_n_2 = self.service._get_n_variant()
            assert v_n_2 == "N_state_cached"
            mock_clone.assert_not_called()

        # 3. N-1 variant should be created once per contingency
        # Let's find a valid line ID from the network
        line_ids = n1.get_line_ids()
        if not line_ids:
            pytest.skip("No lines in test grid")

        target_line = line_ids[0]
        v_n1 = self.service._get_n1_variant(target_line)
        expected_v1 = f"N_1_state_{target_line}"
        assert v_n1 == expected_v1
        assert v_n1 in n1.get_variant_ids()

        with patch.object(n1, "clone_variant") as mock_clone:
            v_n1_repeat = self.service._get_n1_variant(target_line)
            assert v_n1_repeat == expected_v1
            mock_clone.assert_not_called()

    def test_simulation_env_is_cached(self):
        """Verify that _get_simulation_env returns the same instance and shares the network."""
        env1 = self.service._get_simulation_env()
        env2 = self.service._get_simulation_env()

        assert env1 is env2
        # Check that it uses the base network we load
        assert env1.network_manager.network is self.service._get_base_network()

    def test_load_actions_lazy_no_content(self):
        """Verify that the new action dictionary has no pre-computed content fields,
        and that enrich_actions_lazy wraps them so content is accessible on demand."""
        raw_actions = load_actions(self.action_path)

        # Switch-topology actions should not have pre-computed content
        switch_actions = {k: v for k, v in raw_actions.items() if "switches" in v and not k.startswith("disco_")}
        assert switch_actions, "Expected at least one switch-topology action in the new JSON"
        for action_id, action_data in switch_actions.items():
            assert "content" not in action_data, (
                f"Action '{action_id}' should not have pre-computed content in the new JSON format"
            )

        # disco_* actions should have no content and no switches
        disco_actions = {k: v for k, v in raw_actions.items() if k.startswith("disco_")}
        assert disco_actions, "Expected disco_ actions in the test action dictionary"
        for action_id, action_data in disco_actions.items():
            assert "content" not in action_data
            assert "switches" not in action_data

    def test_enrich_actions_lazy_provides_content(self):
        """Verify that enrich_actions_lazy wraps actions so 'content' key is accessible
        even when absent from the raw JSON, using LazyActionDict."""
        n = self.service._get_base_network()
        raw_actions = load_actions(self.action_path)
        lazy_actions = enrich_actions_lazy(raw_actions, n)

        # Every action should report 'content' as present (LazyActionDict.__contains__ always True)
        for action_id, action_data in lazy_actions.items():
            assert "content" in action_data, (
                f"Action '{action_id}' should expose 'content' via LazyActionDict"
            )

        # Accessing content on a switch-topology action should trigger computation
        switch_actions = {k: v for k, v in lazy_actions.items() if "switches" in v and not k.startswith("disco_")}
        if switch_actions:
            first_id, first_action = next(iter(switch_actions.items()))
            content = first_action["content"]
            assert isinstance(content, dict), f"Expected content to be a dict for action '{first_id}'"
            assert "set_bus" in content, f"Expected 'set_bus' key in content for action '{first_id}'"

        # Accessing content on a disco_ action should also work
        disco_actions = {k: v for k, v in lazy_actions.items() if k.startswith("disco_")}
        if disco_actions:
            first_disco_id, first_disco = next(iter(disco_actions.items()))
            content = first_disco["content"]
            assert isinstance(content, dict), f"Expected content to be a dict for action '{first_disco_id}'"

    def test_simulate_manual_action_sets_correct_variant(self):
        """Verify that simulate_manual_action correctly switches variants and sets obs._variant_id,
        using a LazyActionDict-wrapped action with the new JSON format (switches, no pre-computed content)."""
        n = self.service._get_base_network()
        line_ids = n.get_line_ids()
        if not line_ids:
            pytest.skip("No lines in test grid")
        target_line = line_ids[0]

        # Load and enrich actions from the new JSON (lazy format)
        raw_actions = load_actions(self.action_path)
        lazy_actions = enrich_actions_lazy(raw_actions, n)
        self.service._dict_action = lazy_actions

        # Pick any non-disco action that has switches, or fall back to a disco_ action
        switch_action_ids = [k for k, v in lazy_actions.items() if "switches" in v and not k.startswith("disco_")]
        action_id = switch_action_ids[0] if switch_action_ids else next(iter(lazy_actions))

        env = self.service._get_simulation_env()

        with patch.object(env, "action_space") as mock_action_space, \
             patch.object(self.service, "_get_monitoring_parameters", return_value=(set(), set())), \
             patch.object(self.service, "_compute_deltas", return_value={}):

            mock_obs = MagicMock()
            mock_obs.simulate.return_value = (MagicMock(), None, None, {"exception": None})
            mock_obs.name_line = ["LINE_1"]
            mock_obs.rho = [0.1]

            def wrapped_get_obs():
                return mock_obs

            with patch.object(env, "get_obs", side_effect=wrapped_get_obs) as mock_get_obs:
                self.service.simulate_manual_action(action_id, target_line)

                # Check that it called get_obs twice (one for N, one for N-1)
                assert mock_get_obs.call_count == 2

                # Check that after the second call, the observation was tagged with the N-1 variant ID
                # In the actual code: obs_simu_defaut._variant_id = n1_variant_id
                # env.get_obs() uses side_effect=wrapped_get_obs which returns mock_obs;
                # mock_get_obs.return_value is a separate auto-generated mock, not mock_obs.
                assert mock_obs._variant_id == f"N_1_state_{target_line}"

                # Check that _last_disconnected_element was updated
                assert self.service._last_disconnected_element == target_line
