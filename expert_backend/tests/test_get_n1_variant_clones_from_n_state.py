# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Tests that _get_n1_variant clones from the clean N state variant,
not from whatever working variant happens to be active.

Regression test for a bug where switching contingencies after running
action simulations produced incorrect overload lists because the N-1
variant was cloned from a dirty (post-simulation) working variant
instead of the clean base state.
"""

from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService


class TestGetN1VariantClonesFromNState:

    def _make_service_with_mock_network(self):
        """Create a RecommenderService with a mock network that tracks
        clone_variant calls so we can verify the clone source."""
        service = RecommenderService()
        mock_network = MagicMock()

        variant_ids = ["initial_working"]
        clone_calls = []

        mock_network.get_variant_ids.side_effect = lambda: variant_ids.copy()
        mock_network.get_working_variant_id.return_value = "initial_working"
        mock_network.set_working_variant = MagicMock()

        def track_clone(from_var, to_var):
            clone_calls.append((from_var, to_var))
            variant_ids.append(to_var)

        mock_network.clone_variant.side_effect = track_clone
        mock_network.disconnect = MagicMock()

        service._base_network = mock_network
        return service, mock_network, clone_calls

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_n1_variant_clones_from_n_state_not_working_variant(self, _mock_ac):
        """The N-1 variant must be cloned from the N_state_cached variant,
        not from the current working variant which may be dirty."""
        service, network, clone_calls = self._make_service_with_mock_network()

        # First call: _get_n_variant creates N_state_cached from initial_working
        n_var = service._get_n_variant()
        assert n_var == "N_state_cached"
        assert clone_calls[-1] == ("initial_working", "N_state_cached")

        # Simulate a dirty working variant (as if left by a prior simulation)
        network.get_working_variant_id.return_value = "dirty_simulation_variant"

        # _get_n1_variant must clone from N_state_cached, NOT dirty_simulation_variant
        n1_var = service._get_n1_variant("LINE_FAULT")
        assert n1_var == "N_1_state_LINE_FAULT"

        # The clone source must be N_state_cached
        source, target = clone_calls[-1]
        assert source == "N_state_cached", (
            f"Expected clone from N_state_cached but got {source}. "
            "N-1 variant would inherit dirty state from prior simulations."
        )
        assert target == "N_1_state_LINE_FAULT"

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_n1_variant_disconnects_contingency_element(self, _mock_ac):
        """After cloning, the contingency element must be disconnected."""
        service, network, _ = self._make_service_with_mock_network()

        service._get_n1_variant("LINE_X")
        network.disconnect.assert_called_once_with("LINE_X")

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_n1_variant_runs_load_flow(self, mock_ac):
        """After cloning and disconnecting, AC load flow must run."""
        service, _, _ = self._make_service_with_mock_network()

        service._get_n1_variant("LINE_Y")
        mock_ac.assert_called()

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_n1_variant_restores_working_variant(self, _mock_ac):
        """The working variant must be restored after creating the N-1 variant."""
        service, network, _ = self._make_service_with_mock_network()

        # Working variant is "dirty" before call
        network.get_working_variant_id.return_value = "dirty_var"

        service._get_n1_variant("LINE_Z")

        # Last set_working_variant call should restore to the original
        last_call = network.set_working_variant.call_args_list[-1]
        assert last_call.args[0] == "dirty_var"

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_n1_variant_is_cached_on_second_call(self, mock_ac):
        """Calling _get_n1_variant with the same contingency twice should
        reuse the cached variant (no second clone)."""
        service, network, clone_calls = self._make_service_with_mock_network()

        v1 = service._get_n1_variant("LINE_A")
        clone_count_after_first = len(clone_calls)

        v2 = service._get_n1_variant("LINE_A")
        assert v1 == v2
        assert len(clone_calls) == clone_count_after_first  # no new clone

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_different_contingencies_get_different_variants(self, _mock_ac):
        """Each contingency must get its own variant ID."""
        service, _, clone_calls = self._make_service_with_mock_network()

        v1 = service._get_n1_variant("LINE_A")
        v2 = service._get_n1_variant("LINE_B")

        assert v1 != v2
        assert v1 == "N_1_state_LINE_A"
        assert v2 == "N_1_state_LINE_B"

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_n1_variant_clones_from_n_after_multiple_simulations(self, _mock_ac):
        """Even after multiple simulations change the working variant,
        new N-1 variants must still clone from the clean N state."""
        service, network, clone_calls = self._make_service_with_mock_network()

        # Create N state
        service._get_n_variant()

        # Simulate three consecutive dirty working variants
        for dirty in ["sim_action_1", "sim_action_2", "sim_action_3"]:
            network.get_working_variant_id.return_value = dirty

        # Create N-1 for a brand new contingency
        service._get_n1_variant("NEW_CONTINGENCY")

        # Must still clone from N_state_cached
        source, _ = clone_calls[-1]
        assert source == "N_state_cached"

    @patch.object(RecommenderService, '_run_ac_with_fallback', return_value=[])
    def test_n1_variant_handles_disconnect_failure_gracefully(self, _mock_ac):
        """If disconnect fails, the variant should still be created."""
        service, network, _ = self._make_service_with_mock_network()
        network.disconnect.side_effect = Exception("Element not found")

        # Should not raise
        variant = service._get_n1_variant("MISSING_LINE")
        assert variant == "N_1_state_MISSING_LINE"
