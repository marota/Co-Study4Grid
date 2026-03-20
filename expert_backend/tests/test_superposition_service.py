
import pytest
import numpy as np
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService

@pytest.fixture
def recommender():
    svc = RecommenderService()
    svc._dict_action = {}
    svc._last_result = {"prioritized_actions": {}}
    return svc

def test_compute_superposition_on_demand(recommender):
    # Setup two actions in the result
    aid1, aid2 = "act1", "act2"
    recommender._last_result["prioritized_actions"] = {
        aid1: {"action": MagicMock(), "observation": MagicMock()},
        aid2: {"action": MagicMock(), "observation": MagicMock()}
    }
    
    # Mock dependencies
    recommender._get_simulation_env = MagicMock()
    recommender._get_n_variant = MagicMock()
    recommender._get_n1_variant = MagicMock()
    recommender._get_lines_we_care_about = MagicMock(return_value=None)
    
    env = recommender._get_simulation_env.return_value
    env.name_line = ["LINE1"]
    
    # Mock observations
    obs_start = MagicMock()
    obs_start.rho = np.array([1.1])
    env.get_obs.return_value = obs_start # Simplified mock for this test
    
    # Mock library functions
    with patch('expert_backend.services.recommender_service._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.recommender_service.compute_combined_pair_superposition') as mock_combine:
        
        mock_combine.return_value = {
            "betas": [0.5, 0.5],
            "p_or_combined": [100.0]
        }
        
        # We need to ensure results from compute_superposition can calculate max_rho
        # It uses obs_start.rho, obs_act1.rho, obs_act2.rho
        recommender._last_result["prioritized_actions"][aid1]["observation"].rho = np.array([0.9])
        recommender._last_result["prioritized_actions"][aid2]["observation"].rho = np.array([0.9])
        
        # Mock n_variant/n1_variant to avoid real network access
        recommender._get_n_variant = MagicMock(return_value="N")
        recommender._get_n1_variant = MagicMock(return_value="N-1")
        env.network_manager.network.get_working_variant_id.return_value = "ORIG"
        
        result = recommender.compute_superposition(aid1, aid2, "contingency")
        
        assert "betas" in result
        assert result["max_rho"] is not None
        assert result["is_estimated"] is True

def test_compute_superposition_triggers_simulation(recommender):
    # aid1 in result, aid2 NOT in result
    aid1, aid2 = "act1", "act2"
    recommender._last_result["prioritized_actions"] = {
        aid1: {"action": MagicMock(), "observation": MagicMock()}
    }
    recommender._dict_action = {
        aid2: {"content": "content2", "description_unitaire": "Desc 2"}
    }
    
    # Mock simulate_manual_action
    def mock_simulate(aid, cont):
        recommender._last_result["prioritized_actions"][aid] = {
            "action": MagicMock(),
            "observation": MagicMock()
        }
        recommender._last_result["prioritized_actions"][aid]["observation"].rho = np.array([0.9])
    
    recommender.simulate_manual_action = MagicMock(side_effect=mock_simulate)
    
    # Mock other dependencies to avoid crash
    recommender._get_simulation_env = MagicMock()
    recommender._get_n_variant = MagicMock()
    recommender._get_n1_variant = MagicMock()
    recommender._get_lines_we_care_about = MagicMock(return_value=None)
    
    env = recommender._get_simulation_env.return_value
    env.name_line = ["LINE1"]
    obs_start = MagicMock()
    obs_start.rho = np.array([1.1])
    env.get_obs.return_value = obs_start

    with patch('expert_backend.services.recommender_service._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.recommender_service.compute_combined_pair_superposition') as mock_combine:
        
        mock_combine.return_value = {"betas": [0.5, 0.5]}
        recommender._last_result["prioritized_actions"][aid1]["observation"].rho = np.array([0.9])
        
        result = recommender.compute_superposition(aid1, aid2, "contingency")
        
        # Verify simulate_manual_action was called for aid2
        recommender.simulate_manual_action.assert_called_with(aid2, "contingency")
        assert "betas" in result

if __name__ == "__main__":
    pytest.main([__file__])


def _setup_superposition_mocks(recommender, aid1, aid2):
    """Shared mock setup for compute_superposition tests."""
    recommender._get_simulation_env = MagicMock()
    recommender._get_n_variant = MagicMock(return_value="N")
    recommender._get_n1_variant = MagicMock(return_value="N-1")

    env = recommender._get_simulation_env.return_value
    env.name_line = ["PST_LINE"]
    env.network_manager.network.get_working_variant_id.return_value = "ORIG"

    obs_start = MagicMock()
    obs_start.rho = np.array([0.8])
    env.get_obs.return_value = obs_start

    recommender._last_result["prioritized_actions"][aid1]["observation"].rho = np.array([0.7])
    recommender._last_result["prioritized_actions"][aid2]["observation"].rho = np.array([0.75])
    return env


def test_compute_superposition_pst_flag_detected_by_id(recommender):
    """compute_superposition should detect PST actions by ID prefix and
    pass act1_is_pst=True / act2_is_pst to compute_combined_pair_superposition."""
    aid1 = "pst_transformer_A"
    aid2 = "act2"
    recommender._last_result["prioritized_actions"] = {
        aid1: {"action": MagicMock(), "observation": MagicMock()},
        aid2: {"action": MagicMock(), "observation": MagicMock()},
    }
    recommender._dict_action = {
        # aid1 has no description — ID-based detection must fire
        aid1: {},
        aid2: {"description_unitaire": "Fermeture ligne X"},
    }

    _setup_superposition_mocks(recommender, aid1, aid2)

    with patch('expert_backend.services.recommender_service._identify_action_elements',
               return_value=([0], [])) as mock_identify, \
         patch('expert_backend.services.recommender_service.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {"betas": [0.6, 0.4], "p_or_combined": [50.0]}
        del mock_identify  # used positionally; suppress unused-var warning

        recommender.compute_superposition(aid1, aid2, "contingency")

        # Verify the PST flag is passed correctly
        call_kwargs = mock_combine.call_args.kwargs
        assert call_kwargs.get("act1_is_pst") is True, (
            f"Expected act1_is_pst=True for id '{aid1}', got {call_kwargs.get('act1_is_pst')}"
        )
        assert call_kwargs.get("act2_is_pst") is False, (
            f"Expected act2_is_pst=False for id '{aid2}', got {call_kwargs.get('act2_is_pst')}"
        )


def test_compute_superposition_pst_flag_detected_by_classifier(recommender):
    """compute_superposition should detect PST actions via ActionClassifier
    (description contains 'tap') and pass act1_is_pst=True."""
    aid1 = "action_for_trafo"
    aid2 = "action_topo"
    recommender._last_result["prioritized_actions"] = {
        aid1: {"action": MagicMock(), "observation": MagicMock()},
        aid2: {"action": MagicMock(), "observation": MagicMock()},
    }
    recommender._dict_action = {
        # ActionClassifier.identify_action_type returns 'pst_tap' when description
        # contains 'Variation de slot' or 'tap'
        aid1: {"description_unitaire": "Variation de slot PST trafo"},
        aid2: {"description_unitaire": "Ouverture ligne B"},
    }

    _setup_superposition_mocks(recommender, aid1, aid2)

    with patch('expert_backend.services.recommender_service._identify_action_elements',
               return_value=([0], [])), \
         patch('expert_backend.services.recommender_service.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {"betas": [0.5, 0.5], "p_or_combined": [60.0]}

        recommender.compute_superposition(aid1, aid2, "contingency")

        call_kwargs = mock_combine.call_args.kwargs
        assert call_kwargs.get("act1_is_pst") is True, (
            f"Expected act1_is_pst=True for description-based PST action, got {call_kwargs.get('act1_is_pst')}"
        )
        assert call_kwargs.get("act2_is_pst") is False, (
            f"Expected act2_is_pst=False for id '{aid2}', got {call_kwargs.get('act2_is_pst')}"
        )

def test_identify_pst_elements_robustness(recommender):
    from expert_op4grid_recommender.utils.superposition import _identify_action_elements
    from expert_op4grid_recommender.action_evaluation.classifier import ActionClassifier
    
    env = MagicMock()
    env.name_line = ["ARKA TD 661_inc2", "OTHER_LINE"]
    env.name_sub = ["SUB1"]
    
    classifier = ActionClassifier()
    
    # Test case 1: Leading dot in ID and discovery suffix (_inc2)
    # The regex should strip _inc2, and lstrip('.') should handle the dot.
    aid = "pst_tap_.ARKA TD 661_inc2"
    action = MagicMock()
    # Classifier needs "tap" in description to recognize as PST
    dict_action = {aid: {"description": "PST tap change"}}
    
    line_idxs, sub_idxs = _identify_action_elements(
        action, aid, dict_action, classifier, env
    )
    
    # "ARKA TD 661" (extracted) is a substring of "ARKA TD 661_inc2"
    assert line_idxs == [0]
    assert sub_idxs == []

    # Test case 2: Nested content structure
    aid2 = "some_pst"
    action2 = MagicMock()
    # Content structure used in RecommenderService._dict_action
    dict_action2 = {aid2: {
        "description": "Variation de slot",
        "content": {"pst_tap": {"OTHER_LINE": 5}}
    }}
    
    line_idxs2, sub_idxs2 = _identify_action_elements(
        action2, aid2, dict_action2, classifier, env
    )
    assert line_idxs2 == [1]

    # Test case 3: Leading dot with exact match (after stripping dot)
    env.name_line = ["ARKA TD 661", "OTHER_LINE"]
    line_idxs3, sub_idxs3 = _identify_action_elements(
        action, aid, dict_action, classifier, env
    )
    assert line_idxs3 == [0]
