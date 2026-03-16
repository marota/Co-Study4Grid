
import sys
import os
import json
import pytest
import numpy as np
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Add Expert_op4grid_recommender local dev dir
expert_op4_path = Path("/home/marotant/dev/Expert_op4grid_recommender")
if expert_op4_path.exists():
    sys.path.insert(0, str(expert_op4_path))

from expert_backend.services.recommender_service import recommender_service
from expert_op4grid_recommender import config

@pytest.fixture(scope="module")
def analysis_setup():
    project_root = Path(__file__).parent.parent.parent
    network_path = project_root / "data" / "bare_env_small_grid_test"
    action_file_path = project_root / "data" / "action_space" / "reduced_model_actions_test.json"
    contingency = "P.SAOL31RONCI"

    # Setup config
    class Settings:
        def __init__(self, network_path, action_file_path):
            self.network_path = str(network_path)
            self.action_file_path = str(action_file_path)
            self.min_line_reconnections = 1
            self.min_close_coupling = 1
            self.min_open_coupling = 1
            self.min_line_disconnections = 1
            self.n_prioritized_actions = 20
            self.monitoring_factor = 0.95
            self.pre_existing_overload_threshold = 0.02
            self.lines_monitoring_path = None
            self.pypowsybl_fast_mode = False # Disable fast mode for better consistency

    from expert_backend.services.network_service import network_service
    network_service.load_network(str(network_path))
    recommender_service.update_config(Settings(network_path, action_file_path))

    # Run analysis
    iterator = recommender_service.run_analysis(contingency)
    for _ in iterator: pass

    if not recommender_service._last_result or "prioritized_actions" not in recommender_service._last_result:
        print("\nWARNING: No analysis results found!")
        print("Detailed Result Keys:", recommender_service._last_result.keys() if recommender_service._last_result else "None")
    else:
        print(f"\nFound {len(recommender_service._last_result['prioritized_actions'])} prioritized actions")

    return contingency

def test_combined_simulation_manual(analysis_setup):
    contingency = analysis_setup
    prioritized = recommender_service._last_result["prioritized_actions"]
    
    print(f"\nAvailable action IDs in dict: {list(recommender_service._dict_action.keys())[:5]}...")
    print(f"Prioritized action IDs: {list(prioritized.keys())[:5]}...")

    # Pick two converged actions
    converged_ids = [aid for aid, d in prioritized.items() if d.get("non_convergence") is None]
    if len(converged_ids) < 2:
        pytest.skip(f"Need at least 2 converged actions, found {len(converged_ids)}")
    
    id1, id2 = converged_ids[0], converged_ids[1]
    
    # Check if they exist in dict
    print(f"Testing with id1={id1}, id2={id2}")
    if id1 not in recommender_service._dict_action:
        print(f"CRITICAL: {id1} not in _dict_action")
    if id2 not in recommender_service._dict_action:
        print(f"CRITICAL: {id2} not in _dict_action")

    combined_id = "+".join(sorted([id1, id2]))
    
    print(f"Simulating combined action: {combined_id}")
    result = recommender_service.simulate_manual_action(combined_id, contingency)
    
    assert result["action_id"] == combined_id
    assert result["description_unitaire"].startswith("[COMBINED]")
    assert "rho_after" in result
    assert result["non_convergence"] is None
    
    # Verify it's actually different from individual actions
    res1 = recommender_service.simulate_manual_action(id1, contingency)
    res2 = recommender_service.simulate_manual_action(id2, contingency)
    
    # Combined rho_after should be different from individual ones
    if res1["rho_after"] and res2["rho_after"] and result["rho_after"]:
        # Use np.allclose to handle floating point
        assert not np.allclose(result["rho_after"], res1["rho_after"], atol=1e-5)
        assert not np.allclose(result["rho_after"], res2["rho_after"], atol=1e-5)

def test_combined_simulation_canonical_ids(analysis_setup):
    contingency = analysis_setup
    prioritized = recommender_service._last_result["prioritized_actions"]
    converged_ids = [aid for aid, d in prioritized.items() if d.get("non_convergence") is None]
    if len(converged_ids) < 2:
        pytest.skip("Not enough actions")
        
    id1, id2 = converged_ids[0], converged_ids[1]
    
    # Simulate with A+B
    res_ab = recommender_service.simulate_manual_action(f"{id1}+{id2}", contingency)
    # Simulate with B+A
    res_ba = recommender_service.simulate_manual_action(f"{id2}+{id1}", contingency)
    
    # Both should return same action_id (canonical)
    assert res_ab["action_id"] == res_ba["action_id"]
    assert res_ab["max_rho"] == res_ba["max_rho"]

def test_combined_simulation_islanding_mw(analysis_setup):
    # Try to find actions that cause islanding when combined
    # For now, just verify the field exists in a normal combined simulation
    contingency = analysis_setup
    prioritized = recommender_service._last_result["prioritized_actions"]
    converged_ids = [aid for aid, d in prioritized.items() if d.get("non_convergence") is None]
    if len(converged_ids) < 2:
        pytest.skip("Not enough actions")
        
    id1, id2 = converged_ids[0], converged_ids[1]
    result = recommender_service.simulate_manual_action(f"{id1}+{id2}", contingency)
    
    # Field should be present (even if 0.0)
    assert "disconnected_mw" in result
    assert isinstance(result["disconnected_mw"], (int, float))

def test_on_demand_superposition(analysis_setup):
    contingency = analysis_setup
    prioritized = recommender_service._last_result["prioritized_actions"]
    
    converged_ids = [aid for aid, d in prioritized.items() if d.get("non_convergence") is None]
    if len(converged_ids) < 2:
        pytest.skip("Not enough converged actions for superposition")
        
    id1, id2 = converged_ids[0], converged_ids[1]
    
    print(f"\nComputing on-demand superposition: {id1} and {id2}")
    result = recommender_service.compute_superposition(id1, id2, contingency)
    
    if "error" in result:
        print(f"Superposition error: {result['error']}")
        # Try to find two actions that work?
        pytest.fail(f"Superposition failed: {result['error']}")

    assert "betas" in result
    assert len(result["betas"]) == 2
    assert "max_rho" in result
    assert "is_rho_reduction" in result
    assert "p_or_combined" in result
    assert "rho_after" in result
    
    print(f"  Betas: {result['betas']}")
    print(f"  Max Rho: {result['max_rho']}")

if __name__ == "__main__":
    pytest.main([__file__])
