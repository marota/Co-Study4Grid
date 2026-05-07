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
    def test_run_analysis_step2_routes_additional_lines_to_extra_channel(self, mock_run_discovery, mock_run_graph, service):
        """Operator-supplied extras are routed via the upstream
        ``extra_lines_to_cut_ids`` channel (which the recommender / alphaDeesp
        treat as cut-but-not-overload via ``OverFlowGraph(extra_lines_to_cut=…)``).
        They MUST NOT be appended to ``lines_overloaded_*`` — otherwise the
        viewer's "Overloads" layer would mis-classify them.
        """
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1"],
        }

        obs = MagicMock()
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
        # Overload lists stay narrowed to operator-selected detected
        # overloads — extras must NOT leak in.
        assert ctx["lines_overloaded_names"] == ["L1"]
        assert ctx["lines_overloaded_ids"] == [0]
        assert ctx["lines_overloaded_ids_kept"] == [0]
        # Extras flow through the upstream ``extra_lines_to_cut_ids``
        # channel (consumed by ``run_analysis_step2_graph`` and forwarded
        # to ``OverFlowGraph(extra_lines_to_cut=…)``).  L1 (already
        # selected) and UNKNOWN_LINE (not in name_line) are skipped.
        assert ctx["extra_lines_to_cut_ids"] == [2, 3]
        # Extras stay inside the monitoring scope.
        assert "EXTRA_1" in ctx["lines_we_care_about"]
        assert "EXTRA_2" in ctx["lines_we_care_about"]
        assert "L2" not in ctx["lines_we_care_about"]

    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_graph")
    @patch("expert_backend.services.analysis_mixin.run_analysis_step2_discovery")
    def test_run_analysis_step2_extra_lines_recover_from_deselect_filter(self, mock_run_discovery, mock_run_graph, service):
        """An extra that coincides with a deselected overload must be added
        back to lines_we_care_about so monitoring is not silently lost,
        and routed through ``extra_lines_to_cut_ids`` (not promoted back
        into the overload set)."""
        mock_run_graph.side_effect = lambda ctx: ctx
        mock_run_discovery.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1"],
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

        list(service.run_analysis_step2(
            selected_overloads=["L1"],
            all_overloads=["L1", "L2"],
            monitor_deselected=False,
            additional_lines_to_cut=["L2"],
        ))

        ctx = service._analysis_context
        # L2 is back in care (re-merged after the deselect-filter would
        # have evicted it).
        assert "L2" in ctx["lines_we_care_about"]
        # L2 is routed through the extras channel — it must NOT have
        # been promoted back into the overload-resolution targets.
        assert ctx["extra_lines_to_cut_ids"] == [1]
        assert ctx["lines_overloaded_names"] == ["L1"]
        assert ctx["lines_overloaded_ids"] == [0]

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
