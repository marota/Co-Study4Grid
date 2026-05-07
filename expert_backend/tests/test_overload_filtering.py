# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import pytest
from unittest.mock import patch, MagicMock
from expert_backend.services.recommender_service import RecommenderService

class TestOverloadFiltering:
    @pytest.fixture
    def service(self):
        return RecommenderService()

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_filters_care_about(self, mock_run_discovery, mock_run_graph, service):
        """Verify that deselected overloads are removed from lines_we_care_about."""
        # Setup mocks
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["LINE_1", "LINE_2"]
        }
        
        service._analysis_context = {
            "env": MagicMock(),
            "lines_overloaded_names": ["LINE_1", "LINE_2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": {"LINE_1", "LINE_2", "LINE_3"}
        }
        
        # Test with monitor_deselected=False (filtering happens)
        list(service.run_analysis_step2(
            selected_overloads=["LINE_1"],
            all_overloads=["LINE_1", "LINE_2"],
            monitor_deselected=False
        ))
        
        # Verify lines_we_care_about was updated (LINE_2 was deselected)
        assert service._analysis_context["lines_we_care_about"] == {"LINE_1", "LINE_3"}
        assert service._analysis_context["lines_overloaded_names"] == ["LINE_1"]

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_preserves_care_about_when_monitoring(self, mock_run_discovery, mock_run_graph, service):
        """Verify that lines_we_care_about is NOT filtered when monitor_deselected=True."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["LINE_1", "LINE_2"]
        }
        
        initial_care = {"LINE_1", "LINE_2", "LINE_3"}
        service._analysis_context = {
            "env": MagicMock(),
            "lines_overloaded_names": ["LINE_1", "LINE_2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": initial_care.copy()
        }
        
        list(service.run_analysis_step2(
            selected_overloads=["LINE_1"],
            all_overloads=["LINE_1", "LINE_2"],
            monitor_deselected=True
        ))
        
        # Verify lines_we_care_about remains the same
        assert service._analysis_context["lines_we_care_about"] == initial_care
        # But resolution targets are still filtered
        assert service._analysis_context["lines_overloaded_names"] == ["LINE_1"]

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_handles_different_iterable_types(self, mock_run_discovery, mock_run_graph, service):
        """Verify filtering works for both sets and lists in lines_we_care_about."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "L2"]
        }
        
        # Case 1: List
        service._analysis_context = {
            "env": MagicMock(),
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": ["L1", "L2", "L3"]
        }
        list(service.run_analysis_step2(selected_overloads=["L1"], all_overloads=["L1", "L2"], monitor_deselected=False))
        assert service._analysis_context["lines_we_care_about"] == ["L1", "L3"]

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_handles_empty_selection(self, mock_run_discovery, mock_run_graph, service):
        """Verify that empty selected_overloads results in empty targets but doesn't crash."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "L2"]
        }
        
        service._analysis_context = {
            "env": MagicMock(),
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": {"L1", "L2", "L3"}
        }
        
        list(service.run_analysis_step2(selected_overloads=[], all_overloads=["L1", "L2"], monitor_deselected=False))
        
        assert service._analysis_context["lines_overloaded_names"] == []
        assert service._analysis_context["lines_overloaded_ids"] == []
        assert service._analysis_context["lines_we_care_about"] == {"L3"}

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_handles_invalid_names_in_selection(self, mock_run_discovery, mock_run_graph, service):
        """Verify that invalid names in selected_overloads are ignored."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "L2"]
        }
        
        service._analysis_context = {
            "env": MagicMock(),
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": {"L1", "L2", "L3"}
        }
        
        # Select "L1" and "INVALID"
        list(service.run_analysis_step2(
            selected_overloads=["L1", "INVALID"], 
            all_overloads=["L1", "L2"], 
            monitor_deselected=False
        ))
        
        assert service._analysis_context["lines_overloaded_names"] == ["L1"]
        assert service._analysis_context["lines_overloaded_ids"] == [0]
        # "L2" was in all_overloads but not in selected, so it should be removed from care
        assert service._analysis_context["lines_we_care_about"] == {"L1", "L3"}

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_appends_additional_lines_to_cut(self, mock_run_discovery, mock_run_graph, service):
        """Verify additional_lines_to_cut are appended to the resolution targets
        (ExpertAgent's `additionalLinesToCut`/`ltc` semantics) and kept in
        lines_we_care_about even when their detected siblings are deselected."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "EXTRA_1"],
        }

        obs = MagicMock()
        # name_line is the obs-aligned line catalogue; ids returned by step1
        # index into it. We seed L1=0, L2=1 and the candidate extras at 2, 3.
        obs.name_line = ["L1", "L2", "EXTRA_1", "EXTRA_2"]
        service._analysis_context = {
            "env": MagicMock(),
            "obs_simu_defaut": obs,
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": ["L1", "L2", "L3"],
        }

        list(service.run_analysis_step2(
            selected_overloads=["L1"],
            all_overloads=["L1", "L2"],
            monitor_deselected=False,
            additional_lines_to_cut=["EXTRA_1", "EXTRA_2", "UNKNOWN_LINE", "L1"],
        ))

        ctx = service._analysis_context
        # Detected target L1 stays, L2 is dropped, EXTRA_{1,2} are appended.
        # L1 (already selected) and UNKNOWN_LINE (not in name_line) must
        # not be duplicated/added.
        assert ctx["lines_overloaded_names"] == ["L1", "EXTRA_1", "EXTRA_2"]
        assert ctx["lines_overloaded_ids"] == [0, 2, 3]
        # Kept-ids tracks the same set so they reach the overflow graph.
        assert ctx["lines_overloaded_ids_kept"] == [0, 2, 3]
        # The deselect-filter would have evicted nothing here, but we also
        # need to ensure the extras stay inside care.
        assert "EXTRA_1" in ctx["lines_we_care_about"]
        assert "EXTRA_2" in ctx["lines_we_care_about"]
        assert "L2" not in ctx["lines_we_care_about"]

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_additional_lines_recover_from_deselect_filter(self, mock_run_discovery, mock_run_graph, service):
        """If an additional line happens to be in the deselected-overload set,
        the append step must add it back to lines_we_care_about so monitoring
        is not silently lost."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "L2"],
        }

        obs = MagicMock()
        obs.name_line = ["L1", "L2"]
        service._analysis_context = {
            "env": MagicMock(),
            "obs_simu_defaut": obs,
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": {"L1", "L2"},
        }

        # Operator deselects L2 but immediately re-adds it as an extra
        # line-to-cut — net effect is: L2 stays in care and is re-added
        # as a target.
        list(service.run_analysis_step2(
            selected_overloads=["L1"],
            all_overloads=["L1", "L2"],
            monitor_deselected=False,
            additional_lines_to_cut=["L2"],
        ))

        ctx = service._analysis_context
        assert "L2" in ctx["lines_we_care_about"]
        assert ctx["lines_overloaded_names"] == ["L1", "L2"]
        assert ctx["lines_overloaded_ids"] == [0, 1]

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_handles_error(self, mock_run_discovery, mock_run_graph, service):
        """Verify that backend errors are caught and yielded as error events."""
        mock_run_graph.side_effect = Exception("Simulated Backend Crash")
        
        service._analysis_context = {
            "env": MagicMock(),
            "lines_overloaded_names": ["L1"],
            "lines_overloaded_ids": [0],
            "lines_overloaded_ids_kept": [0]
        }
        
        events = list(service.run_analysis_step2(selected_overloads=["L1"], all_overloads=["L1"]))
        
        assert any(e.get("type") == "error" and "Simulated Backend Crash" in e.get("message") for e in events)

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_care_initialization(self, mock_run_discovery, mock_run_graph, service):
        """Verify that 'care' is correctly handled (fixing UnboundLocalError regression)."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1"]
        }
        
        # Scenario where monitor_deselected is True (skips the filtering block where 'care' was defined)
        service._analysis_context = {
            "env": MagicMock(),
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": ["L1", "L2"]
        }
        
        # This should NOT raise UnboundLocalError
        events = list(service.run_analysis_step2(
            selected_overloads=["L1"],
            all_overloads=["L1", "L2"],
            monitor_deselected=True
        ))
        
        result_event = next(e for e in events if e.get("type") == "result")
        assert result_event["lines_we_care_about"] == ["L1", "L2"]
