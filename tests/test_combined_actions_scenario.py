
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

def test_vielmp6_creg_diagnostic(scenario_data, analysis_results):
    """Diagnostic test for C.REG branches at VIELMP6.

    Identifies why C.REG lines are not rendered on the SLD:
    1. Are they in _get_network_flows (lines/transformers)?
    2. Are they in flow_deltas with non-zero values?
    3. Are they in the SLD feederNodes metadata?
    4. Do their SVG element IDs match the metadata?
    """
    prioritized = analysis_results.get("prioritized_actions", {})
    contingency = scenario_data["contingency"]
    target_vl = "VIELMP6"
    target_action = None

    # Find the VIELMP6 action
    for aid in prioritized:
        if aid.endswith("_VIELMP6") or "VIELMP6" in aid:
            target_action = aid
            break
    assert target_action is not None, "No VIELMP6 action found in analysis results"
    print(f"\n=== VIELMP6 C.REG Diagnostic for action: {target_action} ===")

    # --- 1. Examine network element types at VIELMP6 ---
    n1_network = recommender_service._load_network()
    if contingency:
        try:
            n1_network.disconnect(contingency)
        except Exception:
            pass
    params = create_olf_rte_parameter()
    pp.loadflow.run_ac(n1_network, params)

    # Lines at VIELMP6
    all_lines = n1_network.get_lines()
    vielm_lines = all_lines[
        (all_lines['voltage_level1_id'] == target_vl) |
        (all_lines['voltage_level2_id'] == target_vl)
    ]
    print(f"\n[1] Lines at {target_vl}: {list(vielm_lines.index)}")
    creg_lines = [lid for lid in vielm_lines.index if 'C.REG' in lid or 'CREG' in lid or 'c.reg' in lid.lower()]
    print(f"    C.REG lines found: {creg_lines}")

    # Transformers at VIELMP6
    all_trafos = n1_network.get_2_windings_transformers()
    vielm_trafos = all_trafos[
        (all_trafos['voltage_level1_id'] == target_vl) |
        (all_trafos['voltage_level2_id'] == target_vl)
    ]
    print(f"    Transformers at {target_vl}: {list(vielm_trafos.index)}")
    creg_trafos = [tid for tid in vielm_trafos.index if 'C.REG' in tid or 'CREG' in tid or 'c.reg' in tid.lower()]
    print(f"    C.REG transformers found: {creg_trafos}")

    # Switches at VIELMP6 (if available)
    try:
        all_switches = n1_network.get_switches()
        vielm_switches = all_switches[all_switches['voltage_level_id'] == target_vl] if 'voltage_level_id' in all_switches.columns else all_switches
        creg_switches = [sid for sid in vielm_switches.index if 'C.REG' in sid or 'CREG' in sid or 'c.reg' in sid.lower()]
        print(f"    C.REG switches found: {creg_switches}")
        if creg_switches:
            print(f"    Switch details: {vielm_switches.loc[creg_switches].to_dict()}")
    except Exception as e:
        print(f"    Could not get switches: {e}")

    # Dangling lines at VIELMP6
    try:
        all_dl = n1_network.get_dangling_lines()
        vielm_dl = all_dl[all_dl['voltage_level_id'] == target_vl] if 'voltage_level_id' in all_dl.columns else all_dl
        creg_dl = [did for did in vielm_dl.index if 'C.REG' in did or 'CREG' in did or 'c.reg' in did.lower()]
        if creg_dl:
            print(f"    C.REG dangling lines found: {creg_dl}")
    except Exception:
        pass

    # Tie lines
    try:
        all_tl = n1_network.get_tie_lines()
        creg_tl = [tid for tid in all_tl.index if 'C.REG' in tid or 'CREG' in tid or 'c.reg' in tid.lower()]
        if creg_tl:
            print(f"    C.REG tie lines found: {creg_tl}")
    except Exception:
        pass

    # --- 2. Check flow_deltas ---
    obs_after = prioritized[target_action]["observation"]
    variant_id = obs_after._variant_id
    nm = obs_after._network_manager
    nm.set_working_variant(variant_id)
    n_after = nm.network

    n1_flows = recommender_service._get_network_flows(n1_network)
    after_flows = recommender_service._get_network_flows(n_after)
    computed = recommender_service._compute_deltas(after_flows, n1_flows, voltage_level_ids=[target_vl])

    # Find C.REG in flow_deltas
    creg_in_deltas = {k: v for k, v in computed["flow_deltas"].items()
                      if 'C.REG' in k or 'CREG' in k or 'c.reg' in k.lower()}
    print(f"\n[2] C.REG entries in flow_deltas: {creg_in_deltas}")

    # List ALL branches at VIELMP6 in flow_deltas (by VL)
    vl1 = after_flows.get("vl1", {})
    vl2 = after_flows.get("vl2", {})
    vielm_branch_ids = [bid for bid in computed["flow_deltas"]
                        if vl1.get(bid) == target_vl or vl2.get(bid) == target_vl]
    print(f"    All branches touching {target_vl} in flow_deltas: {vielm_branch_ids}")

    # --- 3. Check SLD metadata ---
    try:
        sld_data = recommender_service.get_action_variant_sld(target_action, target_vl)
        sld_metadata = sld_data.get("sld_metadata")
        if sld_metadata:
            meta = json.loads(sld_metadata) if isinstance(sld_metadata, str) else sld_metadata
            feeder_nodes = meta.get("feederNodes", [])
            print(f"\n[3] SLD feederNodes for {target_vl} ({len(feeder_nodes)} total):")
            for fn in feeder_nodes:
                is_creg = 'C.REG' in fn.get('equipmentId', '') or 'CREG' in fn.get('equipmentId', '')
                marker = " *** C.REG ***" if is_creg else ""
                in_deltas = fn.get('equipmentId', '') in computed["flow_deltas"]
                delta_marker = " [IN flow_deltas]" if in_deltas else " [NOT in flow_deltas]"
                print(f"    equipmentId={fn.get('equipmentId', '?'):30s}  svgId={fn.get('id', '?'):40s}  componentType={fn.get('componentType', '?')}{marker}{delta_marker}")

            # Check if any flow_deltas keys are NOT in feederNodes
            feeder_equip_ids = {fn.get('equipmentId') for fn in feeder_nodes}
            missing_from_metadata = [bid for bid in vielm_branch_ids if bid not in feeder_equip_ids]
            print(f"\n    Branches at {target_vl} in flow_deltas but NOT in SLD feederNodes: {missing_from_metadata}")
        else:
            print(f"\n[3] SLD metadata is None for {target_vl}")

        # Also inspect the SVG for C.REG elements
        sld_svg = sld_data.get("svg", "")
        import re
        creg_svg_ids = re.findall(r'id="([^"]*[Cc]\.?[Rr][Ee][Gg][^"]*)"', sld_svg)
        print(f"\n[4] SVG element IDs containing 'C.REG' or 'CREG': {creg_svg_ids}")
    except Exception as e:
        print(f"\n[3] Failed to get SLD: {e}")

    # Assert that C.REG branches exist somewhere (this will show what's missing)
    all_creg = creg_lines + creg_trafos
    print(f"\n=== SUMMARY ===")
    print(f"C.REG in network (lines+trafos): {all_creg}")
    print(f"C.REG in flow_deltas: {list(creg_in_deltas.keys())}")
    assert len(all_creg) > 0 or len(creg_in_deltas) > 0, \
        "C.REG branches not found in network lines/trafos NOR in flow_deltas — check if they are switches"


if __name__ == "__main__":
    pytest.main([__file__])
