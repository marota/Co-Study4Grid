
import sys
import os
import json
import pytest
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent))

from expert_backend.services.recommender_service import recommender_service
from expert_op4grid_recommender import config
import pypowsybl as pp
from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter

"""
Traceability Images for this test:
- f344b395..._COUCHP6: file:///home/marotant/.gemini/antigravity/brain/41877071-9c18-415b-b88c-0b24a209f64c/media__1772618839391.png
- node_merging_PYMONP3: file:///home/marotant/.gemini/antigravity/brain/41877071-9c18-415b-b88c-0b24a209f64c/media__1772618859880.png
"""

@pytest.fixture(scope="module")
def scenario_data():
    project_root = Path(__file__).parent.parent
    baseline_path = project_root / "tests" / "baseline_scenario.json"
    with open(baseline_path, "r") as f:
        return json.load(f)

@pytest.fixture(scope="module")
def analysis_results(scenario_data):
    project_root = Path(__file__).parent.parent
    network_path = project_root / "data" / "bare_env_small_grid_test"
    action_file_path = project_root / "data" / "action_space" / "reduced_model_actions_test.json"
    contingency = scenario_data["contingency"]
    
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
            
    recommender_service.update_config(Settings(network_path, action_file_path))
    
    # Run analysis once for the contingency
    iterator = recommender_service.run_analysis(contingency)
    for _ in iterator: pass
    
    return recommender_service._last_result

def test_independent_actions_simulation(scenario_data, analysis_results):
    prioritized = analysis_results.get("prioritized_actions", {})
    contingency = scenario_data["contingency"]
    
    # Re-simulate N-1 matching RecommenderService.get_action_variant_diagram logic
    n1_network = recommender_service._load_network()
    if contingency:
        try:
            n1_network.disconnect(contingency)
        except Exception:
            pass
    params = create_olf_rte_parameter()
    pp.loadflow.run_ac(n1_network, params)
    n1_flows = recommender_service._get_network_flows(n1_network)

    # We test each action listed in the baseline independently
    for aid, baseline in scenario_data["actions"].items():
        assert aid in prioritized, f"Action {aid} should be recommended by analysis"
        target_vl = baseline["target_voltage_level"]
        
        print(f"Testing action: {aid} (Targeting VL: {target_vl})")
        obs_after = prioritized[aid]["observation"]
        
        # Switch to the correct variant
        variant_id = obs_after._variant_id
        nm = obs_after._network_manager
        nm.set_working_variant(variant_id)
        n_after = nm.network
        
        after_flows = recommender_service._get_network_flows(n_after)
        
        # Compute deltas matching diagram logic (passing single target_vl)
        computed_deltas = recommender_service._compute_deltas(after_flows, n1_flows, voltage_level_ids=[target_vl])
        
        baseline_p = baseline["flow_deltas"]
        baseline_q = baseline["reactive_flow_deltas"]
        
        # 1. Assertions for P deltas
        assert len(baseline_p) > 0, f"Baseline for {aid} should contain branches for {target_vl}"
        for branch_id, expected in baseline_p.items():
            actual = computed_deltas["flow_deltas"].get(branch_id)
            assert actual is not None, f"Branch {branch_id} missing in computed P deltas for {aid}"
            
            # Numerical accuracy
            assert actual["delta"] == pytest.approx(expected["delta"], abs=1.0), f"P delta mismatch for {branch_id} in {aid}"
            
            # VISUAL PROPERTIES: Category
            assert actual["category"] == expected["category"], f"Category mismatch for {branch_id} in {aid}"
            
            # VISUAL PROPERTIES: Direction
            assert actual["flip_arrow"] == expected["flip_arrow"], f"Direction mismatch for {branch_id} in {aid}"
            
        # 2. Assertions for Q deltas
        for branch_id, expected in baseline_q.items():
            actual = computed_deltas["reactive_flow_deltas"].get(branch_id)
            assert actual is not None, f"Branch {branch_id} missing in computed Q deltas for {aid}"
            assert actual["delta"] == pytest.approx(expected["delta"], abs=1.0), f"Q delta mismatch for {branch_id} in {aid}"

if __name__ == "__main__":
    pytest.main([__file__])
