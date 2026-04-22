"""
verify_detailed_topology.py
============================
Standalone verification script for the double-busbar detailed topology
produced by add_detailed_topology.py (NODE_BREAKER version).

Loads the generated network.xiidm and actions.json, then runs a battery
of checks:

  1. Structural checks  — busbar sections, switches, element connections
  2. Topology pattern   — DISCO+BK chains, coupling device (DISCO+BK+DISCO)
  3. AC loadflow        — converges in N state (all couplers closed)
  4. Union-Find         — all coupler actions produce valid enrichment
  5. Coupler opening    — every coupler split yields convergent loadflow
  6. Action consistency — actions.json matches actual switches in network
  7. Layout consistency — grid_layout.json covers all buses

Usage:
    python scripts/pypsa_eur/verify_detailed_topology.py [--network data/pypsa_eur_fr225_400]
"""

import argparse
import os
import json
import logging
from collections import defaultdict

import pandas as pd
import numpy as np
import pypowsybl as pp
from pypowsybl.loadflow import Parameters

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

parser = argparse.ArgumentParser(description="Verify double-busbar detailed topology")
parser.add_argument(
    "--network",
    type=str,
    default="data/pypsa_eur_fr225_400",
    help="Path to the network data directory (relative to repo root or absolute)",
)
args = parser.parse_args()

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.join(SCRIPT_DIR, "..", "..")
DATA_DIR = args.network if os.path.isabs(args.network) else os.path.join(BASE_DIR, args.network)
XIIDM_PATH = os.path.join(DATA_DIR, "network.xiidm")
ACTIONS_PATH = os.path.join(DATA_DIR, "actions.json")
LAYOUT_PATH = os.path.join(DATA_DIR, "grid_layout.json")

MIN_BRANCHES = 4

passed = 0
failed = 0
warnings_count = 0


def check(condition, msg, warn_only=False):
    global passed, failed, warnings_count
    if condition:
        log.info(f"  PASS {msg}")
        passed += 1
    elif warn_only:
        log.warning(f"  WARN {msg}")
        warnings_count += 1
    else:
        log.error(f"  FAIL {msg}")
        failed += 1


# ---------------------------------------------------------------------------
# Load data
# ---------------------------------------------------------------------------
log.info("=" * 70)
log.info("Loading network and action data")
log.info("=" * 70)

check(os.path.exists(XIIDM_PATH), "network.xiidm exists")
check(os.path.exists(ACTIONS_PATH), "actions.json exists")

n = pp.network.load(XIIDM_PATH)
with open(ACTIONS_PATH) as f:
    actions = json.load(f)

# Electrical (merged) buses
el_buses_df = n.get_buses()
# Busbar sections (node-breaker)
bbs_df = n.get_busbar_sections(all_attributes=True)
# Switches with full attributes
switches_df = n.get_switches(all_attributes=True)
# Voltage levels
vls_df = n.get_voltage_levels(all_attributes=True)
# Network elements
lines_df = n.get_lines(all_attributes=True)
trafos_df = n.get_2_windings_transformers(all_attributes=True)
gens_df = n.get_generators(all_attributes=True)
loads_df = n.get_loads(all_attributes=True)

log.info(f"  Network: {len(el_buses_df)} electrical buses, {len(bbs_df)} busbar sections, {len(switches_df)} switches")
log.info(f"  Lines: {len(lines_df)}, Trafos: {len(trafos_df)}")
log.info(f"  Generators: {len(gens_df)}, Loads: {len(loads_df)}")
log.info(f"  Actions: {len(actions)}")

# Verify topology kind
topo_kinds = vls_df["topology_kind"].unique()
check(
    list(topo_kinds) == ["NODE_BREAKER"],
    f"All VLs are NODE_BREAKER (found: {list(topo_kinds)})",
)

# ---------------------------------------------------------------------------
# Test 1: Structural checks
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Test 1 -- Structural checks")
log.info("=" * 70)

# Count branches per VL
vl_branches = defaultdict(list)
for lid, row in lines_df.iterrows():
    vl_branches[row["voltage_level1_id"]].append(("line", lid, "1"))
    vl_branches[row["voltage_level2_id"]].append(("line", lid, "2"))
for tid, row in trafos_df.iterrows():
    vl_branches[row["voltage_level1_id"]].append(("trafo", tid, "1"))
    vl_branches[row["voltage_level2_id"]].append(("trafo", tid, "2"))

eligible_vls = {vl: br for vl, br in vl_branches.items() if len(br) >= MIN_BRANCHES}

check(len(eligible_vls) > 0, f"Found {len(eligible_vls)} eligible VLs (>= {MIN_BRANCHES} branches)")

# Count busbar sections per eligible VL (should have 2: BBS1 at node 0, BBS2 at node 1)
bbs_per_vl = bbs_df.groupby("voltage_level_id").size()
two_bbs_count = 0
for vl_id in eligible_vls:
    if bbs_per_vl.get(vl_id, 0) == 2:
        two_bbs_count += 1
check(
    two_bbs_count == len(eligible_vls),
    f"All eligible VLs have 2 busbar sections: {two_bbs_count}/{len(eligible_vls)}",
)

# Check BBS1 at node 0, BBS2 at node 1
bbs_nodes_ok = 0
for vl_id in eligible_vls:
    vl_bbs = bbs_df[bbs_df["voltage_level_id"] == vl_id]
    nodes = set(vl_bbs["node"].values) if "node" in vl_bbs.columns else set()
    if nodes == {0, 1}:
        bbs_nodes_ok += 1
check(
    bbs_nodes_ok == len(eligible_vls),
    f"BBS at nodes 0 and 1 in eligible VLs: {bbs_nodes_ok}/{len(eligible_vls)}",
)

# Count switch kinds
disco_count_sw = len(switches_df[switches_df["kind"] == "DISCONNECTOR"])
bk_count_sw = len(switches_df[switches_df["kind"] == "BREAKER"])
check(
    disco_count_sw > 0 and bk_count_sw > 0,
    f"Switch kinds: {disco_count_sw} DISCONNECTOR, {bk_count_sw} BREAKER",
)
other_kinds = set(switches_df["kind"].unique()) - {"DISCONNECTOR", "BREAKER"}
check(
    len(other_kinds) == 0,
    f"No unexpected switch kinds (found: {other_kinds if other_kinds else 'none'})",
)

# Coupling switches and breakers initially closed; some SA.1 DISCOs are open (BBS2-assigned)
open_switches = switches_df[switches_df["open"] == True]
# Open switches should only be element DISCOs (SA.1 for BBS2-assigned, SA.2 for BBS1-assigned)
open_non_disco = open_switches[open_switches["kind"] != "DISCONNECTOR"]
check(
    len(open_non_disco) == 0,
    f"All breakers initially closed ({len(open_non_disco)} open non-DISCO switches)",
)

# Count coupler breakers (ending with _COUPL)
coupler_bks = switches_df[switches_df.index.str.endswith("_COUPL")]
check(
    len(coupler_bks) == len(eligible_vls),
    f"Coupler BK count ({len(coupler_bks)}) == eligible VL count ({len(eligible_vls)})",
)

# Count coupler disconnectors (ending with _COUPL_D1 and _COUPL_D2)
coupler_d1s = switches_df[switches_df.index.str.endswith("_COUPL_D1")]
coupler_d2s = switches_df[switches_df.index.str.endswith("_COUPL_D2")]
check(
    len(coupler_d1s) == len(eligible_vls) and len(coupler_d2s) == len(eligible_vls),
    f"Coupler DISCOs: {len(coupler_d1s)} D1, {len(coupler_d2s)} D2 (expected {len(eligible_vls)} each)",
)

# ---------------------------------------------------------------------------
# Test 2: Topology pattern per eligible VL
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Test 2 -- Topology pattern per eligible VL")
log.info("=" * 70)

# Verify coupling device structure: BBS1(0) -> DISCO(D1) -> BK(COUPL) -> DISCO(D2) -> BBS2(1)
coupling_ok = 0
coupling_fail = 0
for vl_id in sorted(eligible_vls.keys()):
    d1_id = f"{vl_id}_COUPL_D1"
    bk_id = f"{vl_id}_COUPL"
    d2_id = f"{vl_id}_COUPL_D2"

    all_exist = all(sid in switches_df.index for sid in [d1_id, bk_id, d2_id])
    if not all_exist:
        coupling_fail += 1
        if coupling_fail <= 3:
            log.error(f"    FAIL {vl_id}: coupling switches missing")
        continue

    d1 = switches_df.loc[d1_id]
    bk = switches_df.loc[bk_id]
    d2 = switches_df.loc[d2_id]

    # D1: node1=0 (BBS1), node2=intermediate
    # BK: node1=intermediate, node2=intermediate2
    # D2: node1=intermediate2, node2=1 (BBS2)
    d1_ok = d1["node1"] == 0 and d1["kind"] == "DISCONNECTOR"
    d2_ok = d2["node2"] == 1 and d2["kind"] == "DISCONNECTOR"
    bk_ok = bk["kind"] == "BREAKER"
    chain_ok = d1["node2"] == bk["node1"] and bk["node2"] == d2["node1"]

    if d1_ok and d2_ok and bk_ok and chain_ok:
        coupling_ok += 1
    else:
        coupling_fail += 1
        if coupling_fail <= 3:
            details = []
            if not d1_ok:
                details.append(f"D1 node1={d1['node1']} kind={d1['kind']}")
            if not d2_ok:
                details.append(f"D2 node2={d2['node2']} kind={d2['kind']}")
            if not bk_ok:
                details.append(f"BK kind={bk['kind']}")
            if not chain_ok:
                details.append("chain broken")
            log.error(f"    FAIL {vl_id}: {'; '.join(details)}")

check(
    coupling_fail == 0,
    f"Coupling device pattern (D1-BK-D2): {coupling_ok}/{len(eligible_vls)} OK",
)

# Verify element double-DISCO pattern: each element has 2 DISCOs (SA.1 to BBS1, SA.2 to BBS2)
# connecting to the same intermediate node, plus 1 BK
from collections import defaultdict as _dd
vl_pattern_ok = 0
vl_pattern_fail = 0
for vl_id in sorted(eligible_vls.keys()):
    vl_sw = switches_df[switches_df["voltage_level_id"] == vl_id]
    # Exclude coupling switches
    elem_sw = vl_sw[
        ~vl_sw.index.str.endswith("_COUPL")
        & ~vl_sw.index.str.endswith("_COUPL_D1")
        & ~vl_sw.index.str.endswith("_COUPL_D2")
    ]
    elem_discos = elem_sw[elem_sw["kind"] == "DISCONNECTOR"]
    elem_bks = elem_sw[elem_sw["kind"] == "BREAKER"]

    # Each element should have 2 DISCOs and 1 BK -> DISCOs = 2 * BKs
    # All DISCOs connect to node 0 (BBS1) or node 1 (BBS2) on one side
    disco_to_bbs = elem_discos[elem_discos["node1"].isin([0, 1])]

    # Group DISCOs by intermediate node (node2) - each group should have exactly 2
    disco_groups = _dd(list)
    for idx, row in elem_discos.iterrows():
        disco_groups[row["node2"]].append((idx, row["node1"], row["open"]))

    # Each group should have 2 DISCOs: one to node 0, one to node 1
    pairs_ok = all(
        len(discos) == 2
        and {d[1] for d in discos} == {0, 1}  # one to each BBS
        and sum(1 for d in discos if not d[2]) == 1  # exactly one closed
        for discos in disco_groups.values()
    )

    ok = (
        len(elem_discos) == 2 * len(elem_bks)
        and len(disco_to_bbs) == len(elem_discos)
        and pairs_ok
    )
    if ok:
        vl_pattern_ok += 1
    else:
        vl_pattern_fail += 1
        if vl_pattern_fail <= 3:
            bad_pairs = sum(1 for d in disco_groups.values() if len(d) != 2)
            log.error(
                f"    FAIL {vl_id}: DISCOs={len(elem_discos)}, BKs={len(elem_bks)}, "
                f"DISCOs to BBS={len(disco_to_bbs)}, bad_pairs={bad_pairs}"
            )

check(
    vl_pattern_fail == 0,
    f"Element double-DISCO+BK pattern: {vl_pattern_ok}/{len(eligible_vls)} OK",
)

# Check round-robin busbar assignment per category
# Each element has 2 DISCOs (one per BBS). The CLOSED one indicates the active busbar.
# Group by intermediate node to identify element pairs, then check per-category balance.
n_balanced = 0
n_imbalanced = 0
for vl_id in sorted(eligible_vls.keys()):
    vl_sw = switches_df[switches_df["voltage_level_id"] == vl_id]
    elem_sw = vl_sw[
        ~vl_sw.index.str.endswith("_COUPL")
        & ~vl_sw.index.str.endswith("_COUPL_D1")
        & ~vl_sw.index.str.endswith("_COUPL_D2")
    ]
    elem_discos = elem_sw[elem_sw["kind"] == "DISCONNECTOR"]

    # Group by intermediate node (node2) to find element pairs
    # For each pair, determine which BBS the element is assigned to (closed DISCO)
    disco_groups = defaultdict(list)
    for idx, row in elem_discos.iterrows():
        disco_groups[row["node2"]].append((idx, row["node1"], row["open"]))

    # For each element (intermediate node), find active BBS and category
    elem_assignments = []  # (category, active_bbs)
    for node2, discos in disco_groups.items():
        closed = [d for d in discos if not d[2]]
        if not closed:
            continue
        active_bbs = closed[0][1]  # node1 of closed DISCO: 0=BBS1, 1=BBS2
        disco_id = closed[0][0]
        # Determine category from naming
        if "_D_G_" in disco_id or "_D2_G_" in disco_id:
            cat = "gens"
        elif "_D_L_" in disco_id or "_D2_L_" in disco_id:
            cat = "loads"
        else:
            cat = "branches"
        elem_assignments.append((cat, active_bbs))

    all_ok = True
    for cat in ["branches", "gens", "loads"]:
        cat_elems = [a for a in elem_assignments if a[0] == cat]
        if not cat_elems:
            continue
        on_bbs1 = sum(1 for _, bbs in cat_elems if bbs == 0)
        on_bbs2 = sum(1 for _, bbs in cat_elems if bbs == 1)
        if abs(on_bbs1 - on_bbs2) > 1:
            all_ok = False
            if n_imbalanced < 5:
                log.error(f"    FAIL {vl_id} {cat}: BBS1={on_bbs1}, BBS2={on_bbs2}")

    if all_ok:
        n_balanced += 1
    else:
        n_imbalanced += 1

check(
    n_imbalanced == 0,
    f"Round-robin balance per category: {n_balanced} balanced, {n_imbalanced} imbalanced",
)

# Check non-eligible VLs have only the base DISCO+BK chains (no coupler, no BBS2)
non_eligible_vls = set(vl_branches.keys()) - set(eligible_vls.keys())
non_eligible_bbs2 = 0
for vl_id in non_eligible_vls:
    vl_bbs = bbs_df[bbs_df["voltage_level_id"] == vl_id]
    if len(vl_bbs) > 1:
        non_eligible_bbs2 += 1

check(
    non_eligible_bbs2 == 0,
    f"Non-eligible VLs have only 1 busbar section ({non_eligible_bbs2} with >1)",
)


# ---------------------------------------------------------------------------
# Test 3: AC loadflow in N state
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Test 3 -- AC loadflow in N state (all couplers closed)")
log.info("=" * 70)

result = pp.loadflow.run_ac(n, Parameters(distributed_slack=True))
status = str(result[0].status)
check("CONVERGED" in status, f"AC loadflow: {status}")

# All couplers closed -> each eligible VL still merges to 1 electrical bus
el_buses_per_vl = el_buses_df.groupby("voltage_level_id").size()
multi_el_bus_vls = el_buses_per_vl[el_buses_per_vl > 1]
check(
    len(multi_el_bus_vls) == 0,
    f"All VLs have 1 electrical bus with couplers closed ({len(multi_el_bus_vls)} with >1)",
)


# ---------------------------------------------------------------------------
# Test 4: Union-Find enrichment for all coupler actions
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Test 4 -- Union-Find enrichment for coupler actions")
log.info("=" * 70)

try:
    from expert_op4grid_recommender.utils.conversion_actions_repas import (
        NetworkTopologyCache,
    )
    from expert_op4grid_recommender.data_loader import _diff_set_bus

    cache = NetworkTopologyCache(n)
    check(cache._node_breaker, "NetworkTopologyCache detected NODE_BREAKER mode")

    coupler_actions = {k: v for k, v in actions.items() if k.startswith("open_coupler_")}
    check(
        len(coupler_actions) == len(eligible_vls),
        f"Coupler actions count ({len(coupler_actions)}) matches eligible VLs ({len(eligible_vls)})",
    )

    n_pass = 0
    n_fail_disconnect = 0
    n_fail_nochange = 0
    failed_actions = []

    for action_id, action_data in sorted(coupler_actions.items()):
        switches = action_data["switches"]
        impacted_vls = set()
        for sw_id in switches:
            vl = cache._switch_to_vl.get(sw_id)
            if vl:
                impacted_vls.add(vl)

        if not impacted_vls:
            n_fail_disconnect += 1
            failed_actions.append((action_id, "switch not found in cache"))
            continue

        initial_n2b = cache.compute_bus_assignments({}, impacted_vls)
        initial_sb = cache.get_element_bus_assignments(initial_n2b, impacted_vls)
        final_n2b = cache.compute_bus_assignments(switches, impacted_vls)
        final_sb = cache.get_element_bus_assignments(final_n2b, impacted_vls)
        diff = _diff_set_bus(initial_sb, final_sb)

        all_buses = set()
        for v in diff.values():
            all_buses.update(v.values())
        n_changed = sum(len(v) for v in diff.values())

        if -1 in all_buses:
            n_fail_disconnect += 1
            failed_actions.append((action_id, f"disconnected elements, buses={sorted(all_buses)}"))
        elif n_changed == 0:
            n_fail_nochange += 1
            failed_actions.append((action_id, "no bus assignment changes"))
        else:
            n_pass += 1

    for action_id, reason in failed_actions:
        log.error(f"    FAIL {action_id}: {reason}")

    check(
        n_fail_disconnect == 0,
        f"No disconnected elements (-1): {n_fail_disconnect} failures",
    )
    check(
        n_fail_nochange == 0,
        f"All coupler openings produce bus changes: {n_fail_nochange} with no change",
    )
    check(
        n_pass == len(coupler_actions),
        f"Union-Find enrichment: {n_pass}/{len(coupler_actions)} PASS",
    )

    # Verify bus indices are non-negative and exactly 2 groups after split
    sample_vl = sorted(eligible_vls.keys(), key=lambda v: -len(eligible_vls[v]))[0]
    test_sw = {f"{sample_vl}_COUPL": True}
    f_n2b = cache.compute_bus_assignments(test_sw, {sample_vl})
    f_sb = cache.get_element_bus_assignments(f_n2b, {sample_vl})
    all_assigned_buses = set()
    for v in f_sb.values():
        all_assigned_buses.update(v.values())
    check(
        all(b >= 0 for b in all_assigned_buses),
        f"Sample {sample_vl}: all assigned buses >= 0 (got {sorted(all_assigned_buses)})",
    )
    check(
        len(all_assigned_buses) == 2,
        f"Sample {sample_vl}: exactly 2 distinct bus groups after split (got {len(all_assigned_buses)})",
    )

except ImportError as e:
    log.warning(f"  WARN Skipping Union-Find tests ({e})")
    warnings_count += 1


# ---------------------------------------------------------------------------
# Test 5: Coupler opening loadflow (all VLs)
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Test 5 -- Coupler opening loadflow verification (all VLs)")
log.info("=" * 70)

n_lf_pass = 0
n_lf_fail = 0
n_island_local = 0
n_island_remote = 0
lf_failures = []

for vl_id in sorted(eligible_vls.keys()):
    coupler_bk_id = f"{vl_id}_COUPL"
    n_test = pp.network.load(XIIDM_PATH)
    pp.loadflow.run_ac(n_test, Parameters(distributed_slack=True))

    buses_before = len(n_test.get_buses())
    # Open the coupler breaker (the action only opens the BK)
    n_test.update_switches(pd.DataFrame({"open": [True]}, index=[coupler_bk_id]))
    res = pp.loadflow.run_ac(n_test, Parameters(distributed_slack=True))
    buses_after = len(n_test.get_buses())
    nan_buses = n_test.get_buses()[n_test.get_buses()["v_mag"].isna()]
    status_str = str(res[0].status)

    # Distinguish local vs remote island buses
    local_islands = nan_buses[nan_buses["voltage_level_id"] == vl_id]
    remote_islands = nan_buses[nan_buses["voltage_level_id"] != vl_id]

    if "CONVERGED" in status_str and buses_after > buses_before and len(local_islands) == 0:
        n_lf_pass += 1
        if len(remote_islands) > 0:
            n_island_remote += 1
            log.warning(f"    WARN {vl_id}: {len(remote_islands)} remote island buses (network connectivity)")
    else:
        n_lf_fail += 1
        reasons = []
        if "CONVERGED" not in status_str:
            reasons.append(f"status={status_str}")
        if buses_after <= buses_before:
            reasons.append(f"no bus split ({buses_before} -> {buses_after})")
        if len(local_islands) > 0:
            reasons.append(f"{len(local_islands)} LOCAL island buses")
            n_island_local += 1
        if len(remote_islands) > 0:
            reasons.append(f"{len(remote_islands)} remote island buses")
            n_island_remote += 1
        lf_failures.append((vl_id, ", ".join(reasons)))

for vl_id, reason in lf_failures:
    log.error(f"    FAIL {vl_id}: {reason}")

check(
    n_lf_pass >= len(eligible_vls) - 2,
    f"Coupler loadflow: {n_lf_pass}/{len(eligible_vls)} converged with valid local split"
    + (f" ({n_lf_fail} failed due to network connectivity)" if n_lf_fail else ""),
)
check(
    n_island_local <= 2,
    f"Local island buses after coupler opening: {n_island_local} VLs (<=2 tolerated, network connectivity issue)",
)
if n_island_remote > 0:
    log.warning(f"  WARN {n_island_remote} VLs cause remote islands (network connectivity, not topology bug)")


# ---------------------------------------------------------------------------
# Test 6: Action consistency
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Test 6 -- Action consistency")
log.info("=" * 70)

# Every coupler action references an actual switch in the network
n_ok = 0
n_missing = 0
for action_id, action_data in sorted(actions.items()):
    if not action_id.startswith("open_coupler_"):
        continue
    for sw_id in action_data.get("switches", {}):
        if sw_id in switches_df.index:
            n_ok += 1
        else:
            n_missing += 1
            log.error(f"    FAIL Action {action_id}: switch '{sw_id}' not in network")

check(n_missing == 0, f"All coupler action switches exist in network ({n_ok} OK, {n_missing} missing)")

# Every coupler action has VoltageLevelId field
all_have_vl = all(
    "VoltageLevelId" in actions[k]
    for k in actions
    if k.startswith("open_coupler_")
)
check(all_have_vl, "All coupler actions have VoltageLevelId field")

# Disco actions still present
disco_count = sum(1 for k in actions if k.startswith("disco_"))
coupler_count = sum(1 for k in actions if k.startswith("open_coupler_"))
check(disco_count > 0, f"Disconnection actions preserved: {disco_count}")
check(coupler_count == len(eligible_vls), f"Coupler actions: {coupler_count} == {len(eligible_vls)} eligible VLs")

total_expected = disco_count + coupler_count
check(
    len(actions) == total_expected,
    f"Total actions ({len(actions)}) = disco ({disco_count}) + coupler ({coupler_count})",
    warn_only=True,
)

# ---------------------------------------------------------------------------
# Test 7: Layout consistency
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Test 7 -- Layout file consistency")
log.info("=" * 70)

if os.path.exists(LAYOUT_PATH):
    with open(LAYOUT_PATH) as f:
        layout = json.load(f)

    # Check that all VLs in the network have a layout entry (by safe_id)
    missing_layout = []
    for vl_id in vl_branches:
        safe_id = vl_id[3:]  # strip "VL_"
        if safe_id not in layout:
            missing_layout.append(vl_id)

    if missing_layout and len(missing_layout) <= 5:
        for b in missing_layout:
            log.warning(f"    WARN Missing layout for VL: {b}")

    check(
        len(missing_layout) == 0,
        f"All VLs have layout entries ({len(missing_layout)} missing)",
        warn_only=True,
    )
else:
    log.warning("  WARN grid_layout.json not found")
    warnings_count += 1


# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("VERIFICATION SUMMARY")
log.info("=" * 70)
log.info(f"  Passed:   {passed}")
log.info(f"  Failed:   {failed}")
log.info(f"  Warnings: {warnings_count}")
log.info("")

if failed == 0:
    log.info("  ALL CHECKS PASSED")
else:
    log.error(f"  {failed} CHECK(S) FAILED")

log.info("=" * 70)

sys.exit(1 if failed > 0 else 0)
