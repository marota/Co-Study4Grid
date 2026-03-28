# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import sys
import os
import json
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, "/home/marotant/dev/AntiGravity/ExpertAssist")

from expert_backend.services.recommender_service import recommender_service
from expert_op4grid_recommender import config

def generate_baseline():
    network_path = "/home/marotant/dev/AntiGravity/ExpertAssist/data/bare_env_small_grid_test"
    action_file_path = "/home/marotant/dev/AntiGravity/ExpertAssist/data/action_space/reduced_model_actions_test.json"
    disconnected_element = "P.SAOL31RONCI"
    
    # Mapping of action IDs to their relevant voltage level
    action_vl_map = {
        "node_merging_PYMONP3": "PYMONP3",
        "f344b395-9908-43c2-bca0-75c5f298465e_COUCHP6": "COUCHP6"
    }

    print("Setting up config...")
    class Settings:
        def __init__(self, network_path, action_file_path):
            self.network_path = network_path
            self.action_file_path = action_file_path
            self.min_line_reconnections = 1
            self.min_close_coupling = 1
            self.min_open_coupling = 1
            self.min_line_disconnections = 1
            self.n_prioritized_actions = 20
            self.monitoring_factor = 0.95
            self.pre_existing_overload_threshold = 0.02
            self.lines_monitoring_path = None
            
    recommender_service.update_config(Settings(network_path, action_file_path))

    # Import and load network service
    from expert_backend.services.network_service import network_service
    network_service.load_network(str(network_path))
    
    print(f"Running analysis for {disconnected_element}...")
    # Capture the output of run_analysis which contains the recommendations
    iterator = recommender_service.run_analysis(disconnected_element)
    for _ in iterator: pass # consume it
    
    result = recommender_service._last_result
    prioritized = result.get("prioritized_actions", {})
    
    # KEY FIX: Use the observation of the contingency from the analysis results
    # recommender_service.run_analysis doesn't explicitly store obs_contingency in _last_result
    # but the Backend.run_analysis does! Let's check internal state.
    # Actually, we can just get it from any recommended action's 'n1_obs' if available,
    # or re-simulate if we must. But wait, get_action_variant_diagram re-simulates it!
    # To be 100% consistent with the diagram labels, we MUST use the logic in 
    # get_action_variant_diagram (lines 485-496 approx).
    
    print("Simulating N-1 state...")
    n1_network = recommender_service._load_network()
    if disconnected_element:
        try:
            n1_network.disconnect(disconnected_element)
        except Exception:
            pass
    from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter
    import pypowsybl as pp
    params = create_olf_rte_parameter()
    pp.loadflow.run_ac(n1_network, params)
    n1_flows = recommender_service._get_network_flows(n1_network)

    baseline = {
        "contingency": disconnected_element,
        "actions": {}
    }
    
    for aid, target_vl in action_vl_map.items():
        if aid not in prioritized:
            print(f"Warning: Action {aid} not found in analysis results.")
            continue
            
        print(f"Capturing baseline for {aid} (Target VL: {target_vl})...")
        obs_after = prioritized[aid]["observation"]
        
        # Switch to the correct variant
        variant_id = obs_after._variant_id
        nm = obs_after._network_manager
        nm.set_working_variant(variant_id)
        n_after = nm.network
        
        after_flows = recommender_service._get_network_flows(n_after)
        
        # Get target branches
        lines = n_after.get_lines()
        target_lines = lines[(lines.voltage_level1_id == target_vl) | (lines.voltage_level2_id == target_vl)].index.tolist()
        trafos = n_after.get_2_windings_transformers()
        target_trafos = trafos[(trafos.voltage_level1_id == target_vl) | (trafos.voltage_level2_id == target_vl)].index.tolist()
        target_branch_ids = set(target_lines + target_trafos)
        
        # Compute deltas matching diagram logic
        deltas = recommender_service._compute_deltas(after_flows, n1_flows, voltage_level_ids=[target_vl])
        
        filtered_p = {bid: data for bid, data in deltas["flow_deltas"].items() if bid in target_branch_ids}
        filtered_q = {bid: data for bid, data in deltas["reactive_flow_deltas"].items() if bid in target_branch_ids}
        
        print(f"  Results for {aid}:")
        for bid, d in filtered_p.items():
             print(f"    {bid}: P={d['delta']}, Q={filtered_q[bid]['delta']}")

        baseline["actions"][aid] = {
            "target_voltage_level": target_vl,
            "flow_deltas": filtered_p,
            "reactive_flow_deltas": filtered_q
        }

    output_path = Path("tests/baseline_scenario.json")
    with open(output_path, "w") as f:
        json.dump(baseline, f, indent=2)
    print(f"Baseline saved to {output_path}")

if __name__ == "__main__":
    generate_baseline()
