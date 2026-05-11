
import pytest
import numpy as np
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config

@pytest.fixture
def recommender():
    return RecommenderService()

def test_superposition_max_rho_filtering_regression(recommender):
    """
    Test that heavily loaded lines (but not overloads) in N-state 
    are NOT filtered out of max_rho estimation even if they don't worsen.
    This was the bug where TRI.PY761 was hidden because it was 91% in N.
    """
    # 1. Setup config
    config.MONITORING_FACTOR_THERMAL_LIMITS = 0.95
    config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD = 0.02
    
    # 2. Mock environment and observations
    env = MagicMock()
    recommender._get_simulation_env = MagicMock(return_value=env)
    
    # LINE1 is heavily loaded (91%) but NOT an overload (<95%)
    # LINE2 is an actual overload in N-1 (110%)
    name_line = ["LINE1", "LINE2"]
    env.name_line = name_line
    
    # N-state observation
    obs_n = MagicMock()
    obs_n.rho = np.array([0.91, 0.5]) # LINE1=91%, LINE2=50%
    obs_n.name_line = name_line
    
    # N-1 state observation (contingency state)
    obs_n1 = MagicMock()
    obs_n1.rho = np.array([0.92, 1.1]) # LINE1=92%, LINE2=110%
    obs_n1.name_line = name_line
    
    # Mock compute_superposition calls to get_obs
    # In recommender_service.py: first N-1 then N
    env.get_obs.side_effect = [obs_n1, obs_n]
    
    # Unitary action observations
    obs_act1 = MagicMock()
    obs_act1.rho = np.array([0.90, 0.8]) 
    obs_act1.name_line = name_line
    
    obs_act2 = MagicMock()
    obs_act2.rho = np.array([0.90, 0.8]) 
    obs_act2.name_line = name_line
    
    recommender._last_result = {
        "prioritized_actions": {
            "act1": {"observation": obs_act1, "action": MagicMock()},
            "act2": {"observation": obs_act2, "action": MagicMock()}
        }
    }
    
    # 3. Mock internal helpers
    recommender._get_monitoring_parameters = MagicMock(return_value=(set(name_line), set(name_line)))
    recommender._get_n_variant = MagicMock(return_value="N")
    recommender._get_contingency_variant = MagicMock(return_value="N1")
    env.network_manager.network.get_working_variant_id.return_value = "ORIG"
    
    # Use patch to mock compute_combined_pair_superposition AND _identify_action_elements
    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])):
        with patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_super:
            # We want betas=[0.5, 0.5] so rho_combined becomes [0.90, 0.8]
            # rho_combined = np.abs((1-sum(betas))*obs_n1.rho + b1*obs_act1.rho + b2*obs_act2.rho)
            mock_super.return_value = {
                "betas": [0.5, 0.5],
                "p_or_combined": [100, 100], # Dummy
                "p_ex_combined": [-100, -100]  # Dummy
            }
            
            # 4. Run Estimation
            result = recommender.compute_superposition("act1", "act2", "CONTINGENCY")
            
            # LINE1 (estimated 90%) should be the max rho line because it's higher than LINE2 (80%)
            # and it's NOT filtered out as a pre-existing overload.
            # MF (0.95) is applied to the final result.
            assert result["max_rho_line"] == "LINE1"
            assert abs(result["max_rho"] - 0.90 * 0.95) < 0.001

if __name__ == "__main__":
    pytest.main([__file__])
