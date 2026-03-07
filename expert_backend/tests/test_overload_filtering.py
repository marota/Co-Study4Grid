import pytest
from unittest.mock import patch, MagicMock
from expert_backend.services.recommender_service import RecommenderService

class TestOverloadFiltering:
    @pytest.fixture
    def service(self):
        return RecommenderService()

    @patch("expert_backend.services.recommender_service.run_analysis_step2")
    def test_run_analysis_step2_filters_care_about(self, mock_run_step2, service):
        """Verify that deselected overloads are removed from lines_we_care_about."""
        # Setup context
        mock_run_step2.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["LINE_1", "LINE_2"]
        }
        
        service._analysis_context = {
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

    @patch("expert_backend.services.recommender_service.run_analysis_step2")
    def test_run_analysis_step2_preserves_care_about_when_monitoring(self, mock_run_step2, service):
        """Verify that lines_we_care_about is NOT filtered when monitor_deselected=True."""
        mock_run_step2.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["LINE_1", "LINE_2"]
        }
        
        initial_care = {"LINE_1", "LINE_2", "LINE_3"}
        service._analysis_context = {
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

    @patch("expert_backend.services.recommender_service.run_analysis_step2")
    def test_run_analysis_step2_handles_different_iterable_types(self, mock_run_step2, service):
        """Verify filtering works for both sets and lists in lines_we_care_about."""
        mock_run_step2.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "L2"]
        }
        
        # Case 1: List
        service._analysis_context = {
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": ["L1", "L2", "L3"]
        }
        list(service.run_analysis_step2(selected_overloads=["L1"], all_overloads=["L1", "L2"], monitor_deselected=False))
        assert service._analysis_context["lines_we_care_about"] == ["L1", "L3"]


    @patch("expert_backend.services.recommender_service.run_analysis_step2")
    def test_run_analysis_step2_handles_empty_selection(self, mock_run_step2, service):
        """Verify that empty selected_overloads results in empty targets but doesn't crash."""
        mock_run_step2.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "L2"]
        }
        
        service._analysis_context = {
            "lines_overloaded_names": ["L1", "L2"],
            "lines_overloaded_ids": [0, 1],
            "lines_overloaded_ids_kept": [0, 1],
            "lines_we_care_about": {"L1", "L2", "L3"}
        }
        
        list(service.run_analysis_step2(selected_overloads=[], all_overloads=["L1", "L2"], monitor_deselected=False))
        
        assert service._analysis_context["lines_overloaded_names"] == []
        assert service._analysis_context["lines_overloaded_ids"] == []
        assert service._analysis_context["lines_we_care_about"] == {"L3"}

    @patch("expert_backend.services.recommender_service.run_analysis_step2")
    def test_run_analysis_step2_handles_invalid_names_in_selection(self, mock_run_step2, service):
        """Verify that invalid names in selected_overloads are ignored."""
        mock_run_step2.return_value = {
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["L1", "L2"]
        }
        
        service._analysis_context = {
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

