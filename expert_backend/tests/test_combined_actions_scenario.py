# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import sys
import os
import json
import re
import pytest
import numpy as np
from pathlib import Path
from unittest.mock import MagicMock

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

# Add Expert_op4grid_recommender local dev dir
expert_op4_path = Path("/home/marotant/dev/Expert_op4grid_recommender")
if expert_op4_path.exists():
    sys.path.insert(0, str(expert_op4_path))

# Real-data integration test — requires the actual pypowsybl and
# expert_op4grid_recommender packages.  When conftest.py falls back to
# MagicMock stubs the pipeline hits numeric comparisons on mocks and
# fails with ``TypeError: '>' not supported between instances of
# 'MagicMock' and 'MagicMock'``.  Skip the whole module in that case.
import pypowsybl as _pp  # noqa: E402
import expert_op4grid_recommender as _eor  # noqa: E402

if isinstance(_pp, MagicMock) or isinstance(_eor, MagicMock):
    pytest.skip(
        "Real pypowsybl / expert_op4grid_recommender packages are required "
        "for this integration test; skipping because conftest.py is using "
        "MagicMock stubs.",
        allow_module_level=True,
    )

from expert_backend.services.recommender_service import recommender_service
from expert_op4grid_recommender import config

# Force disable fast mode in tests so run_analysis matches manual simulate() exactly
config.PYPOWSYBL_FAST_MODE = False

import pypowsybl as pp
from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter

"""
Traceability Images for this test:
- f344b395..._COUCHP6: file:///home/marotant/.gemini/antigravity/brain/41877071-9c18-415b-b88c-0b24a209f64c/media__1772618839391.png
- node_merging_PYMONP3: file:///home/marotant/.gemini/antigravity/brain/41877071-9c18-415b-b88c-0b24a209f64c/media__1772618859880.png
"""

@pytest.fixture(scope="module")
def scenario_data():
    baseline_path = Path(__file__).parent / "baseline_scenario.json"
    with open(baseline_path, "r") as f:
        return json.load(f)

@pytest.fixture(scope="module")
def analysis_results(scenario_data):
    project_root = Path(__file__).parent.parent.parent
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
            self.do_visualization = False

    # `reset()` mirrors what `/api/config` does in production: clears
    # `_base_network` (and thus any N-1 variants cached on it) plus the
    # cached LF / observation state. Without it, N-1 variants cloned by
    # earlier test modules on the same `bare_env_small_grid_test` network
    # are reused under the cache-by-variant-id path in `_get_contingency_variant`,
    # which caused a small drift in the flow deltas measured below when
    # the full pytest suite ran in file order (see README / CI note).
    # Then load the network so `self.network` is available for the
    # `enrich_actions_lazy` call inside `update_config`.
    from expert_backend.services.network_service import network_service
    recommender_service.reset()
    network_service.load_network(str(network_path))

    # Force-disable fast mode at fixture-setup time too — the module-
    # level `config.PYPOWSYBL_FAST_MODE = False` at import time may have
    # been overwritten by previously-run modules (e.g. the `reset_config`
    # autouse fixture restores its snapshot from BEFORE our module-level
    # line ran).
    config.PYPOWSYBL_FAST_MODE = False

    recommender_service.update_config(Settings(network_path, action_file_path))

    # Run analysis once for the contingency
    iterator = recommender_service.run_analysis(contingency)
    for _ in iterator: pass

    return recommender_service._last_result

def test_independent_actions_simulation(scenario_data, analysis_results):
    prioritized = analysis_results.get("prioritized_actions", {})
    contingency = scenario_data["contingency"]

    # Re-simulate N-1 matching RecommenderService.get_action_variant_diagram logic
    n1_flows = recommender_service._get_contingency_flows(contingency)

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


def _build_equip_id_to_svg_ids(sld_metadata_str):
    """Replicate the frontend equipIdToSvgIds map building logic.

    The frontend reads nodes, feederInfos, and feederNodes from SLD metadata
    to build a map from equipment IDs to SVG element IDs.
    """
    equip_map = {}  # equipmentId -> [svgId, ...]
    if not sld_metadata_str:
        return equip_map
    meta = json.loads(sld_metadata_str) if isinstance(sld_metadata_str, str) else sld_metadata_str
    sources = (meta.get("nodes") or []) + (meta.get("feederInfos") or []) + (meta.get("feederNodes") or [])
    for entry in sources:
        eid = entry.get("equipmentId")
        sid = entry.get("id")
        if eid and sid:
            equip_map.setdefault(eid, []).append(sid)
    return equip_map


def _svg_has_element(svg_str, svg_id):
    """Check if an SVG element with the given id exists in the SVG string."""
    return f'id="{svg_id}"' in svg_str


def test_vielmp6_sld_matching(scenario_data, analysis_results):
    """Verify that all branches at VIELMP6 (including C.REG) are matchable
    on the SLD diagram.

    This test simulates the frontend SLD delta rendering logic:
    1. Parse SLD metadata to build equipmentId -> svgId mapping
    2. For each branch in flow_deltas at VIELMP6, verify:
       a. The branch equipmentId is found in the metadata
       b. At least one SVG element with the metadata svgId exists in the SVG
       c. The branch should have a non-green category (positive/negative/grey)
    """
    prioritized = analysis_results.get("prioritized_actions", {})
    contingency = scenario_data["contingency"]
    target_vl = "VIELMP6"

    # Find the VIELMP6 action
    target_action = None
    for aid in prioritized:
        if "VIELMP6" in aid:
            target_action = aid
            break
    assert target_action is not None, "No VIELMP6 action found in analysis results"

    # Compute flow deltas
    n1_flows = recommender_service._get_contingency_flows(contingency)

    obs_after = prioritized[target_action]["observation"]
    nm = obs_after._network_manager
    nm.set_working_variant(obs_after._variant_id)
    after_flows = recommender_service._get_network_flows(nm.network)
    computed = recommender_service._compute_deltas(after_flows, n1_flows, voltage_level_ids=[target_vl])

    # Identify branches touching VIELMP6
    vl1 = after_flows.get("vl1", {})
    vl2 = after_flows.get("vl2", {})
    vielm_branches = [bid for bid in computed["flow_deltas"]
                      if vl1.get(bid) == target_vl or vl2.get(bid) == target_vl]
    assert len(vielm_branches) > 0, "No branches found at VIELMP6"
    print(f"\nBranches at {target_vl}: {vielm_branches}")

    # Get SLD data
    sld_data = recommender_service.get_action_variant_sld(target_action, target_vl)
    sld_metadata = sld_data.get("sld_metadata")
    sld_svg = sld_data.get("svg", "")
    assert sld_metadata, "SLD metadata is None"

    # Build the equipmentId -> svgId map (same logic as frontend)
    equip_map = _build_equip_id_to_svg_ids(sld_metadata)
    print(f"Equipment IDs in metadata: {list(equip_map.keys())}")

    # Verify C.REG lines specifically
    creg_branches = [b for b in vielm_branches if 'C.REG' in b]
    assert len(creg_branches) >= 2, f"Expected at least 2 C.REG branches, got {creg_branches}"
    print(f"C.REG branches in flow_deltas: {creg_branches}")

    # Verify each VIELMP6 branch is matchable on the SLD
    unmatched = []
    for branch_id in vielm_branches:
        svg_ids = equip_map.get(branch_id, [])
        if not svg_ids:
            unmatched.append(branch_id)
            continue
        # Check at least one SVG element exists
        found = any(_svg_has_element(sld_svg, sid) for sid in svg_ids)
        if not found:
            unmatched.append(branch_id)

    print(f"Unmatched branches (not in SLD metadata or SVG): {unmatched}")
    assert len(unmatched) == 0, (
        f"Branches at {target_vl} not matchable on SLD: {unmatched}. "
        f"These branches have flow_deltas but cannot be rendered on the SLD."
    )

    # Verify C.REG branches have valid delta categories
    for branch_id in creg_branches:
        delta = computed["flow_deltas"][branch_id]
        assert delta["category"] in ("positive", "negative", "grey"), (
            f"C.REG branch {branch_id} has unexpected category: {delta['category']}"
        )
        print(f"  {branch_id}: delta={delta['delta']}, category={delta['category']}")

def test_action_simulation_consistency(scenario_data, analysis_results):
    import numpy as np
    from expert_op4grid_recommender.pypowsybl_backend.network_manager import NetworkManager
    from expert_op4grid_recommender.pypowsybl_backend.action_space import ActionSpace
    from expert_op4grid_recommender.pypowsybl_backend.observation import PypowsyblObservation
    
    prioritized = analysis_results.get("prioritized_actions", {})
    target_action = "f344b395-9908-43c2-bca0-75c5f298465e_COUCHP6"
    
    assert target_action in prioritized, f"Action {target_action} not found in prioritized list"
    
    # 1. Get the action object
    action_obj = prioritized[target_action]["action"]
    
    # 2. Results from run_analysis
    obs_run_analysis = prioritized[target_action]["observation"]
    max_rho_run_analysis = prioritized[target_action]["max_rho"]
    
    # 3. Simulate manually from scratch using the exact same environment setup as run_analysis
    from expert_op4grid_recommender.environment_pypowsybl import setup_environment_configs_pypowsybl
    from expert_op4grid_recommender.main import simulate_contingency_pypowsybl
    
    project_root = Path(__file__).parent.parent.parent
    env_folder = project_root / "data"
    env_name = "bare_env_small_grid_test"
    
    # Use identical configuration
    env, obs_base, _, _, _, _, _, _ = setup_environment_configs_pypowsybl(
        analysis_date=None,
        env_folder=env_folder,
        env_name=env_name
    )
    
    # 3a. Disconnect the contingency line and get base N-1 state
    contingency = scenario_data["contingency"]
    if contingency:
        # In bare_env there are no chronics, act_reco_maintenance is an empty action
        act_reco_maintenance = env.action_space({})
        obs_n1, has_converged = simulate_contingency_pypowsybl(
            env, obs_base, [contingency], act_reco_maintenance, timestep=0, fast_mode=config.PYPOWSYBL_FAST_MODE
        )
        assert has_converged, "Contingency failed"
    else:
        obs_n1 = obs_base
        
    # 3b. Simulate the action on top of the N-1 state
    obs_simulated, _, done, info = obs_n1.simulate(action_obj, fast_mode=config.PYPOWSYBL_FAST_MODE)
    assert not done, f"Simulation failed: {info}"
    
    # 4. We assert that the simulation results (rho array) mirror the results from run_analysis
    # Print out differences if they occur
    mismatches = []
    for i, line_name in enumerate(obs_n1.name_line):
        diff = abs(obs_simulated.rho[i] - obs_run_analysis.rho[i])
        if diff > 1e-5:
            mismatches.append(f"{line_name}: manual={obs_simulated.rho[i]:.4f}, run_analysis={obs_run_analysis.rho[i]:.4f}")
    if mismatches:
        print("Mismatches found:", "\n".join(mismatches))
        
    assert np.allclose(obs_simulated.rho, obs_run_analysis.rho, atol=1e-5), "Full rho array mismatch between manual simulation and run_analysis"

def test_combined_actions_superposition(scenario_data, analysis_results):
    """Verify that combined_actions is produced with valid beta coefficients."""
    # Check if combined actions were produced
    combined = analysis_results.get("combined_actions", {})
    prioritized = analysis_results.get("prioritized_actions", {})

    # Count converged actions
    converged_ids = [aid for aid, d in prioritized.items() if d.get("non_convergence") is None]
    n_converged = len(converged_ids)
    expected_pairs = n_converged * (n_converged - 1) // 2

    print(f"\nConverged actions: {n_converged}, expected pairs: {expected_pairs}")
    print(f"Actual combined_actions entries: {len(combined)}")

    # Must produce at least some pairs if there are 2+ converged actions
    if n_converged >= 2:
        assert len(combined) > 0, "No combined action pairs produced despite having converged actions"

    # Check each pair has valid structure
    for pair_key, pair_data in combined.items():
        if "error" in pair_data:
            # Errors are acceptable (e.g. unidentifiable elements), just ensure they're logged
            continue

        assert "betas" in pair_data, f"Pair {pair_key} missing betas"
        assert "p_or_combined" in pair_data, f"Pair {pair_key} missing p_or_combined"
        assert "max_rho" in pair_data, f"Pair {pair_key} missing max_rho"
        assert "max_rho_line" in pair_data, f"Pair {pair_key} missing max_rho_line"
        assert "is_rho_reduction" in pair_data, f"Pair {pair_key} missing is_rho_reduction"
        assert "action1_id" in pair_data, f"Pair {pair_key} missing action1_id"
        assert "action2_id" in pair_data, f"Pair {pair_key} missing action2_id"

        betas = pair_data["betas"]
        assert len(betas) == 2, f"Pair {pair_key} should have exactly 2 betas, got {len(betas)}"
        # Betas should be finite numbers
        assert all(np.isfinite(b) for b in betas), f"Pair {pair_key} has non-finite betas: {betas}"

        # max_rho should be non-negative
        assert pair_data["max_rho"] >= 0, f"Pair {pair_key} has negative max_rho"

        print(f"  {pair_key}: betas={[round(b, 4) for b in betas]}, "
              f"max_rho={pair_data['max_rho']:.3f}, rho_reduction={pair_data['is_rho_reduction']}")

def test_compute_superposition_agrees_with_precomputed_pair(scenario_data, analysis_results):
    """Regression: estimating a pair in Explore Pairs (on-demand
    ``compute_superposition``) must return the same betas and
    ``max_rho`` as the pre-computed "Computed Pairs" entry produced by
    step2's ``run_analysis_step2_discovery`` for the identical pair.

    Before the fix, the on-demand path fetched a fresh ``obs_start``
    from ``env.get_obs()`` while the pre-computed path used the N-1
    observation captured at step1. Grid2Op's
    ``obs.simulate(action, keep_variant=True)`` (invoked by each
    ``simulate_manual_action``) could mutate the shared N-1 variant,
    so the fresh fetch drifted away from the step1 baseline and
    produced very different betas (e.g. ``[3.193, 1.479]`` vs the
    pre-computed ``[1.10, 0.92]``), sometimes flagged as "unreliable
    superposition — betas outside [-2.0, 3.0]".
    """
    combined = analysis_results.get("combined_actions", {}) or {}
    candidate = None
    for pair_id, pair_data in combined.items():
        if "+" not in pair_id or "error" in pair_data:
            continue
        betas = pair_data.get("betas")
        if betas and all(np.isfinite(betas)):
            candidate = (pair_id, pair_data)
            break
    if candidate is None:
        pytest.skip("No non-errored combined pair produced by this scenario")

    pair_id, pre = candidate
    action1_id, action2_id = pair_id.split("+", 1)
    contingency = scenario_data["contingency"]

    on_demand = recommender_service.compute_superposition(
        action1_id, action2_id, contingency
    )
    assert "error" not in on_demand, f"on-demand failed: {on_demand.get('error')}"

    # Betas must agree — small floating-point tolerance for
    # library-internal numerical paths.
    for i, (b_pre, b_on) in enumerate(zip(pre["betas"], on_demand["betas"])):
        assert b_pre == pytest.approx(b_on, rel=1e-3, abs=1e-3), (
            f"Beta[{i}] drift between step2 and on-demand for {pair_id}: "
            f"pre-computed={b_pre} vs on-demand={b_on}"
        )

    # `max_rho` is scaled by monitoring_factor in the on-demand path;
    # compare the ratios to the corresponding max_rho_line values.
    assert on_demand["max_rho"] == pytest.approx(pre["max_rho"], rel=5e-3, abs=5e-3), (
        f"max_rho drift for {pair_id}: pre-computed={pre['max_rho']} vs "
        f"on-demand={on_demand['max_rho']}"
    )


if __name__ == "__main__":
    pytest.main([__file__])

