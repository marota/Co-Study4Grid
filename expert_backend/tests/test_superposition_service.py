
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
