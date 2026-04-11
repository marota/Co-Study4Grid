# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

"""Tests for second-contingency state reset and action content integrity.

Regression tests for:
1. Auto-generated disco_ actions must have valid content (not None)
2. simulate_manual_action must never store content=None in _dict_action
3. update_config must produce a clean _dict_action on each call
"""

import numpy as np
import pytest
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService


class TestDiscoActionContentIntegrity:
    """Auto-generated disco_ actions must have valid content with set_bus."""

    def test_auto_generated_disco_has_content(self):
        """When no disco_ actions exist in the action file, update_config
        auto-generates them. Each must have a 'content' dict with 'set_bus'
        so the library's rule validator doesn't crash on content.get(...)."""
        svc = RecommenderService()

        # Mock load_actions to return an empty dict (no disco_ actions)
        with patch('expert_backend.services.recommender_service.load_actions', return_value={}):
            # Mock network_service for branch list
            mock_ns = MagicMock()
            mock_ns.get_disconnectable_elements.return_value = ["LINE_A", "LINE_B"]
            mock_ns.network = MagicMock()

            with patch('expert_backend.services.network_service.network_service', mock_ns):
                # Mock enrich_actions_lazy to pass through (don't wrap)
                with patch('expert_backend.services.recommender_service.enrich_actions_lazy',
                           side_effect=lambda d, n: d):
                    # Mock the JSON write
                    from unittest.mock import mock_open
                    m = mock_open()
                    with patch('builtins.open', m):
                        settings = MagicMock()
                        settings.network_path = "/tmp/test/grid"
                        settings.action_file_path = "/tmp/test/actions.json"

                        svc.update_config(settings)

        # Verify all disco_ actions have valid content
        for action_id, entry in svc._dict_action.items():
            if action_id.startswith("disco_"):
                assert "content" in entry, f"{action_id} missing 'content' key"
                content = entry["content"]
                assert content is not None, f"{action_id} has content=None"
                assert isinstance(content, dict), f"{action_id} content is not a dict: {type(content)}"
                assert "set_bus" in content, f"{action_id} content missing 'set_bus'"

    def test_disco_content_has_correct_bus_topology(self):
        """Disco action content must disconnect the line (bus=-1 on both extremities)."""
        svc = RecommenderService()

        with patch('expert_backend.services.recommender_service.load_actions', return_value={}):
            mock_ns = MagicMock()
            mock_ns.get_disconnectable_elements.return_value = ["MY_LINE"]
            mock_ns.network = MagicMock()

            with patch('expert_backend.services.network_service.network_service', mock_ns):
                with patch('expert_backend.services.recommender_service.enrich_actions_lazy',
                           side_effect=lambda d, n: d):
                    from unittest.mock import mock_open
                    with patch('builtins.open', mock_open()):
                        settings = MagicMock()
                        settings.network_path = "/tmp/test/grid"
                        settings.action_file_path = "/tmp/test/actions.json"
                        svc.update_config(settings)

        entry = svc._dict_action["disco_MY_LINE"]
        set_bus = entry["content"]["set_bus"]
        assert set_bus["lines_or_id"] == {"MY_LINE": -1}
        assert set_bus["lines_ex_id"] == {"MY_LINE": -1}


class TestSimulateManualActionContentNeverNone:
    """simulate_manual_action must never leave content=None in _dict_action."""

    @patch.object(RecommenderService, '_get_n1_variant', return_value="n1_var")
    @patch.object(RecommenderService, '_get_n_variant', return_value="n_var")
    def test_content_defaults_to_empty_dict_when_unavailable(self, mock_n, mock_n1):
        """If content can't be resolved from dict or topology, it must
        default to {} (empty dict) — never None."""
        svc = RecommenderService()

        # Setup minimal mocks
        env = MagicMock()
        nm = MagicMock()
        network = MagicMock()
        network.get_working_variant_id.return_value = "init"
        network.get_variant_ids.return_value = ["init", "n_var", "n1_var"]
        nm.network = network
        env.network_manager = nm
        svc._simulation_env = env
        svc._base_network = network

        obs = MagicMock()
        obs.rho = np.array([0.3])
        obs.name_line = ["L1"]
        obs.n_components = 1
        obs.name_load = ["LOAD"]
        obs.load_p = np.array([100.0])
        obs.name_gen = ["GEN"]
        obs.gen_p = np.array([80.0])

        obs_n1 = MagicMock()
        obs_n1.rho = np.array([0.8])
        obs_n1.name_line = ["L1"]
        obs_n1.n_components = 1
        obs_n1._variant_id = "n1_var"
        obs_n1._network_manager = nm
        obs_n1.name_load = ["LOAD"]
        obs_n1.load_p = np.array([100.0])
        obs_n1.name_gen = ["GEN"]
        obs_n1.gen_p = np.array([80.0])

        obs_after = MagicMock()
        obs_after.rho = np.array([0.5])
        obs_after.name_line = ["L1"]
        obs_after.n_components = 1
        obs_after.main_component_load_mw = 1000.0
        obs_after.name_load = ["LOAD"]
        obs_after.load_p = np.array([50.0])
        obs_after.name_gen = ["GEN"]
        obs_after.gen_p = np.array([40.0])

        obs_n1.simulate.return_value = (obs_after, None, None, {"exception": None})
        svc._cached_obs_n = obs
        svc._cached_obs_n_id = "n_var"
        svc._cached_obs_n1 = obs_n1
        svc._cached_obs_n1_id = "n1_var"

        # Action with content=None — simulates a corrupted entry from a
        # previous simulation where topology couldn't be reconstructed
        svc._dict_action = {
            "some_action": {"description_unitaire": "Test action", "content": None}
        }
        svc._last_result = {"prioritized_actions": {}}

        # env.action_space returns a mock action (content doesn't matter for simulation)
        mock_action = MagicMock()
        mock_action.pst_tap = {}
        mock_action.lines_ex_bus = {}
        mock_action.lines_or_bus = {}
        mock_action.gens_bus = {}
        mock_action.loads_bus = {}
        mock_action.substations = {}
        mock_action.switches = {}
        mock_action.loads_p = {}
        mock_action.gens_p = {}
        env.action_space.return_value = mock_action

        svc.simulate_manual_action("some_action", "DISCO_X")

        # After simulation, _dict_action entry must have content that is not None
        entry = svc._dict_action["some_action"]
        content = entry.get("content")
        assert content is not None, \
            "content must never be None after simulate_manual_action — " \
            "the library's rule validator calls content.get('set_bus', {}) and crashes on None"
        assert isinstance(content, dict), f"content must be a dict, got {type(content)}"


class TestSecondContingencyStateReset:
    """Verify that running a second contingency analysis starts from clean state."""

    def test_recommender_service_reset_clears_dict_action_mutations(self):
        """reset() must clear _dict_action so stale entries with content=None
        don't persist across studies."""
        svc = RecommenderService()
        svc._dict_action = {"stale_action": {"content": None}}
        svc._last_result = {"prioritized_actions": {"stale_action": {}}}

        svc.reset()

        assert svc._dict_action is None
        assert svc._last_result is None

    def test_analysis_context_cleared_between_contingencies(self):
        """_analysis_context must be cleared when switching contingencies
        so overloaded lines from the first analysis don't bleed into the second."""
        svc = RecommenderService()
        svc._analysis_context = {
            "lines_we_care_about": ["OLD_LINE_A"],
            "lines_overloaded": ["OLD_LINE_A"],
        }

        svc.reset()

        assert svc._analysis_context is None
