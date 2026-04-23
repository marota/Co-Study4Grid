"""
add_detailed_topology.py
========================
Post-processes the FR XIIDM network (node-breaker topology) to
introduce detailed double-busbar substation topology for eligible VLs.

Target topology per eligible voltage level (&gt;=4 branches):

    [BBS1] -------- DISCO_D1 --- BK(coupler) --- DISCO_D2 -------- [BBS2]
      |     |                                              |     |
    SA.1  SA.1                                           SA.2  SA.2
      |     |                                              |     |
      +--+--+                                              +--+--+
         |                                                    |
       (intermediate node, shared by both DISCOs)           (same)
         |                                                    |
        BK                                                   BK
         |                                                    |
       line_1  (assigned to BBS1: SA.1=closed, SA.2=open)  line_2 (assigned to BBS2)

Each element gets TWO disconnectors (one per busbar) connecting to the
same intermediate node, plus one breaker. Only one disconnector is closed.
The coupling device uses BBS1(0) -- DISCO -- BK -- DISCO -- BBS2(1).

Initial state:
  - Coupling device fully closed (both busbars electrically connected)
  - All breakers closed
  - For each element: SA.1 closed + SA.2 open (BBS1), or SA.1 open + SA.2 closed (BBS2)
  - Round-robin dispatch: odd-indexed elements per category go to BBS2

Pipeline position:
  convert_pypsa_to_xiidm.py -> add_limits_and_overloads.py -> **add_detailed_topology.py**

Usage:
    cd /home/marotant/dev/AntiGravity/ExpertAssist
    venv_expert_assist_py310/bin/python scripts/add_detailed_topology.py --voltages 225,400

Options:
    --network-dir <path>   Directory containing network.xiidm (default: data/pypsa_eur_fr400)
    --voltages <list>      Target voltage levels (default: 400)
    --min-branches <n>     Min branches for double-busbar (default: 4)
    --output-dir <path>    Output directory for updated network
"""

import os
import sys
import json
import logging
import argparse
from collections import defaultdict, Counter

import pandas as pd

import pypowsybl as pp
from pypowsybl.loadflow import Parameters

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ─── Parse command-line arguments ─────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Add double-busbar topology to substations"
)
parser.add_argument(
    "--network",
    type=str,
    default="data/pypsa_eur_fr400",
    help="Directory containing network.xiidm "
         "(default: data/pypsa_eur_fr400)",
)
parser.add_argument(
    "--voltages",
    type=str,
    default="400",
    help="Target voltage levels (comma-separated, e.g., '225,400')",
)
parser.add_argument(
    "--min-branches",
    type=int,
    default=4,
    help="Minimum branches for double-busbar topology",
)
parser.add_argument(
    "--output",
    type=str,
    default=None,
    help="Output directory (default: update --network in place)",
)
# Back-compat: accept the old --network-dir / --output-dir names too.
parser.add_argument("--network-dir", dest="network", help=argparse.SUPPRESS)
parser.add_argument("--output-dir", dest="output", help=argparse.SUPPRESS)
args = parser.parse_args()

TARGET_VOLTAGES = [float(v.strip()) for v in args.voltages.split(",")]
MIN_BRANCHES = args.min_branches

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# Resolve network directory (absolute or relative to repo root)
NETWORK_DIR = (
    args.network if os.path.isabs(args.network) else os.path.join(BASE_DIR, args.network)
)
assert os.path.isdir(NETWORK_DIR), f"--network is not a directory: {NETWORK_DIR}"

OUT_DIR = args.output if args.output else NETWORK_DIR
if not os.path.isabs(OUT_DIR):
    OUT_DIR = os.path.join(BASE_DIR, OUT_DIR)
os.makedirs(OUT_DIR, exist_ok=True)

log.info(f"Target voltages: {TARGET_VOLTAGES} kV")
log.info(f"Network directory: {NETWORK_DIR}")
log.info(f"Output directory: {OUT_DIR}")
log.info(f"Minimum branches for double-busbar: {MIN_BRANCHES}")

# ---------------------------------------------------------------------------
# Step 1: Load the existing network with calibrated limits
# ---------------------------------------------------------------------------
log.info("=" * 70)
log.info("Step 1 -- Loading existing XIIDM with calibrated limits")
log.info("=" * 70)

network_path = os.path.join(NETWORK_DIR, "network.xiidm")
assert os.path.isfile(network_path), f"network.xiidm not found at {network_path}"
n = pp.network.load(network_path)
log.info(f"  Loaded: {network_path}")
log.info(
    f"  {len(n.get_buses())} buses, {len(n.get_lines())} lines, "
    f"{len(n.get_2_windings_transformers())} trafos, {len(n.get_switches())} switches"
)

log.info("")
log.info("=" * 70)
log.info("Step 2 -- Identifying substations eligible for double-busbar topology")
log.info("=" * 70)

# ---------------------------------------------------------------------------
# Step 2: Identify branches per voltage level
# ---------------------------------------------------------------------------
lines_df = n.get_lines()
trafos_df = n.get_2_windings_transformers()
gens_df = n.get_generators()
loads_df = n.get_loads()

vl_branches = defaultdict(list)  # vl_id -> [(element_type, element_id, side)]
for lid, row in lines_df.iterrows():
    vl_branches[row["voltage_level1_id"]].append(("line", lid, "1"))
    vl_branches[row["voltage_level2_id"]].append(("line", lid, "2"))
for tid, row in trafos_df.iterrows():
    vl_branches[row["voltage_level1_id"]].append(("trafo", tid, "1"))
    vl_branches[row["voltage_level2_id"]].append(("trafo", tid, "2"))

vl_gens = defaultdict(list)
for gid, row in gens_df.iterrows():
    vl_gens[row["voltage_level_id"]].append(gid)
vl_loads = defaultdict(list)
for lid, row in loads_df.iterrows():
    vl_loads[row["voltage_level_id"]].append(lid)

eligible_vls = {
    vl: branches
    for vl, branches in vl_branches.items()
    if len(branches) >= MIN_BRANCHES
}

log.info(f"  Total voltage levels: {len(vl_branches)}")
log.info(
    f"  Eligible for double-busbar (>={MIN_BRANCHES} branches): {len(eligible_vls)}"
)
dist = Counter(len(b) for b in vl_branches.values())
for count in sorted(dist.keys()):
    marker = " <<<" if count >= MIN_BRANCHES else ""
    log.info(f"    {count} branches: {dist[count]} VLs{marker}")

# Load node counter from conversion (in the network directory)
network_dir = NETWORK_DIR
node_counter_path = os.path.join(network_dir, "vl_next_node.json")

if not os.path.exists(node_counter_path):
    raise FileNotFoundError(f"Node counter file not found: {node_counter_path}")

with open(node_counter_path) as f:
    vl_next_node = json.load(f)


def allocate_nodes(vl_id, count):
    start = vl_next_node[vl_id]
    vl_next_node[vl_id] = start + count
    return list(range(start, start + count))


# ---------------------------------------------------------------------------
# Step 3: Create detailed double-busbar topology
#
# For each eligible VL:
#   - Add BBS2 at reserved node 1
#   - Add coupling device: BBS1(0) - DISCO - BK - DISCO - BBS2(1)
#   - For EACH existing element: add a SECOND disconnector to BBS2
#     pointing to the same intermediate node as the existing DISCO
#   - Round-robin: odd-indexed elements have SA.2 closed, SA.1 open
#     (i.e., assigned to BBS2); even-indexed have SA.1 closed, SA.2 open
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Step 3 -- Creating detailed double-busbar topology")
log.info("=" * 70)

# Get current switches with all attributes (we need node1/node2)
switches_df = n.get_switches(all_attributes=True)

all_new_bbs = []
all_new_switches = []

# For round-robin: existing DISCOs that need to be opened (element goes to BBS2)
discos_to_open = []

total_new_discos = 0

for vl_id, branches in sorted(eligible_vls.items()):
    # --- Create busbar section 2 at node 1 ---
    bbs2_id = f"{vl_id}_BBS2"
    all_new_bbs.append(
        {
            "id": bbs2_id,
            "voltage_level_id": vl_id,
            "node": 1,
            "name": "Busbar 2",
        }
    )

    # --- Coupling device: BBS1(0) - DISCO - BK - DISCO - BBS2(1) ---
    coupl_nodes = allocate_nodes(vl_id, 2)  # 2 intermediate nodes
    coupl_d1_id = f"{vl_id}_COUPL_D1"
    coupl_bk_id = f"{vl_id}_COUPL"
    coupl_d2_id = f"{vl_id}_COUPL_D2"

    all_new_switches.extend(
        [
            {
                "id": coupl_d1_id,
                "voltage_level_id": vl_id,
                "node1": 0,
                "node2": coupl_nodes[0],
                "kind": "DISCONNECTOR",
                "name": "Coupler D1",
                "open": False,
            },
            {
                "id": coupl_bk_id,
                "voltage_level_id": vl_id,
                "node1": coupl_nodes[0],
                "node2": coupl_nodes[1],
                "kind": "BREAKER",
                "name": "Coupler BK",
                "open": False,
            },
            {
                "id": coupl_d2_id,
                "voltage_level_id": vl_id,
                "node1": coupl_nodes[1],
                "node2": 1,
                "kind": "DISCONNECTOR",
                "name": "Coupler D2",
                "open": False,
            },
        ]
    )

    # --- Collect all elements in this VL and their disconnector switches ---
    # Existing DISCOs were created by convert_pypsa_to_xiidm.py and connect
    # node1=0 (BBS1) to an intermediate node.
    vl_sw = switches_df[switches_df["voltage_level_id"] == vl_id]
    vl_discos = vl_sw[vl_sw["kind"] == "DISCONNECTOR"]

    # Classify by naming convention:
    # Lines:  VL_xxx_D_<line_id>...
    # Gens:   VL_xxx_D_G_<gen_id>
    # Loads:  VL_xxx_D_L_<load_id>
    branch_discos = []
    gen_discos = []
    load_discos = []

    for disco_id, disco_row in vl_discos.iterrows():
        if disco_row["node1"] != 0:
            continue  # Only consider DISCOs from BBS1

        node2 = disco_row["node2"]  # intermediate node

        if "_D_G_" in disco_id:
            gen_discos.append((disco_id, node2))
        elif "_D_L_" in disco_id:
            load_discos.append((disco_id, node2))
        else:
            branch_discos.append((disco_id, node2))

    # For EACH element, add a second disconnector from BBS2 (node 1) to the
    # same intermediate node. The new DISCO name uses SA.2 suffix.
    # Round-robin: even-indexed -> BBS1 (SA.1 closed, SA.2 open)
    #              odd-indexed  -> BBS2 (SA.1 open, SA.2 closed)
    for disco_list in [branch_discos, gen_discos, load_discos]:
        for i, (disco_id, intermediate_node) in enumerate(disco_list):
            # Create the second disconnector (SA.2) from BBS2 to same intermediate
            sa2_id = disco_id.replace("_D_", "_D2_")  # e.g. VL_xxx_D2_line_yyy
            all_new_switches.append(
                {
                    "id": sa2_id,
                    "voltage_level_id": vl_id,
                    "node1": 1,  # BBS2
                    "node2": intermediate_node,  # same intermediate node
                    "kind": "DISCONNECTOR",
                    "name": "SA.2",
                    "open": i % 2
                    == 0,  # SA.2 open for even (BBS1-assigned), closed for odd
                }
            )
            total_new_discos += 1

            # For odd-indexed elements: open the existing SA.1 (BBS1 disconnector)
            if i % 2 == 1:
                discos_to_open.append(disco_id)

n_couplers = len(eligible_vls)
n_coupl_switches = n_couplers * 3  # 2 DISCOs + 1 BK per coupler

log.info(f"  Eligible VLs: {len(eligible_vls)}")
log.info(f"  New busbar sections: {len(all_new_bbs)}")
log.info(f"  New coupling switches: {n_coupl_switches}")
log.info(f"  New element SA.2 disconnectors: {total_new_discos}")
log.info(f"  SA.1 DISCOs to open (BBS2-assigned): {len(discos_to_open)}")

# Create BBS2
n.create_busbar_sections(pd.DataFrame(all_new_bbs).set_index("id"))
log.info(f"  Created {len(all_new_bbs)} busbar sections")

# Create all new switches (coupling + SA.2 disconnectors)
n.create_switches(pd.DataFrame(all_new_switches).set_index("id"))
log.info(f"  Created {len(all_new_switches)} new switches")

# Open the SA.1 disconnectors for BBS2-assigned elements
if discos_to_open:
    n.update_switches(
        pd.DataFrame({"open": [True] * len(discos_to_open)}, index=discos_to_open)
    )
    log.info(f"  Opened {len(discos_to_open)} SA.1 disconnectors (elements -> BBS2)")

# ---------------------------------------------------------------------------
# Step 4: Verify AC loadflow
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Step 4 -- Verifying AC loadflow convergence")
log.info("=" * 70)

result = pp.loadflow.run_ac(n, Parameters(distributed_slack=True))
status = str(result[0].status)
log.info(f"  AC loadflow: {status}")
if "CONVERGED" not in status:
    result = pp.loadflow.run_ac(n, Parameters(distributed_slack=False))
    status = str(result[0].status)
    log.info(f"  Fallback (no dist slack): {status}")
assert "CONVERGED" in status, f"Loadflow failed: {status}"

el_buses = n.get_buses()
bbs = n.get_busbar_sections()
sw = n.get_switches()
log.info(f"  Electrical buses: {len(el_buses)}")
log.info(f"  Busbar sections: {len(bbs)}")
log.info(f"  Total switches: {len(sw)}")
log.info(f"  Switch kinds: {sw['kind'].value_counts().to_dict()}")

# ---------------------------------------------------------------------------
# Step 5: Save XIIDM
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Step 5 -- Saving XIIDM")
log.info("=" * 70)

xiidm_path = os.path.join(OUT_DIR, "network.xiidm")
n.dump(xiidm_path, format="XIIDM")
size_kb = os.path.getsize(xiidm_path) / 1024
log.info(f"  Saved: {xiidm_path} ({size_kb:.1f} KB)")

n2 = pp.network.load(xiidm_path)
log.info(
    f"  Round-trip: {len(n2.get_buses())} el. buses, {len(n2.get_busbar_sections())} BBS, "
    f"{len(n2.get_switches())} switches"
)

# Save updated node counter
with open(os.path.join(OUT_DIR, "vl_next_node.json"), "w") as f:
    json.dump(vl_next_node, f, indent=2)

# ---------------------------------------------------------------------------
# Step 6: Update grid_layout.json
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Step 6 -- Updating grid_layout.json")
log.info("=" * 70)

# Load from network directory (where it exists)
layout_path = os.path.join(network_dir, "grid_layout.json")
with open(layout_path) as f:
    layout = json.load(f)

added = 0
for vl_id in eligible_vls:
    safe_id_val = vl_id[3:]
    if safe_id_val in layout:
        for idx in range(10, 20):
            layout[f"{vl_id}_{idx}"] = layout[safe_id_val]
            added += 1

with open(layout_path, "w") as f:
    json.dump(layout, f, indent=2)
log.info(f"  Added {added} layout entries, total: {len(layout)}")

# ---------------------------------------------------------------------------
# Step 7: Generate coupling breaker opening actions
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Step 7 -- Generating coupling breaker opening actions")
log.info("=" * 70)

actions_path = os.path.join(OUT_DIR, "actions.json")

# Try to load existing actions from network directory first, or create new file
source_actions_path = os.path.join(network_dir, "actions.json")
if os.path.exists(source_actions_path):
    with open(source_actions_path) as f:
        actions = json.load(f)
    log.info(f"  Loaded {len(actions)} existing actions from network directory")
else:
    actions = {}
    log.info("  No existing actions found, starting fresh")

original_count = len(actions)

# Load VL names for human-readable descriptions
vls_df = n.get_voltage_levels()

for vl_id in sorted(eligible_vls.keys()):
    coupler_bk_id = f"{vl_id}_COUPL"
    action_id = f"open_coupler_{vl_id}"
    n_branches = len(eligible_vls[vl_id])

    # Use the VL's name (e.g. "BOUTRE 400kV") if available
    vl_display = (
        vls_df.loc[vl_id, "name"]
        if vl_id in vls_df.index and pd.notna(vls_df.loc[vl_id, "name"])
        else vl_id
    )

    actions[action_id] = {
        "description": f"Opening coupling breaker in '{vl_display}' ({n_branches} branches, split into 2 nodes)",
        "description_unitaire": f"Ouverture du couplage '{coupler_bk_id}' dans le poste '{vl_display}'",
        "switches": {coupler_bk_id: True},
        "VoltageLevelId": vl_id,
    }

with open(actions_path, "w") as f:
    json.dump(actions, f, indent=2, ensure_ascii=False)

log.info(f"  Actions: {original_count} -> {len(actions)}")

# ---------------------------------------------------------------------------
# Step 8: Verify Union-Find enrichment
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Step 8 -- Verifying Union-Find enrichment for all coupler actions")
log.info("=" * 70)

try:
    from expert_op4grid_recommender.utils.conversion_actions_repas import (
        NetworkTopologyCache,
    )
    from expert_op4grid_recommender.data_loader import _diff_set_bus

    cache = NetworkTopologyCache(n2)

    coupler_actions = {
        k: v for k, v in actions.items() if k.startswith("open_coupler_")
    }
    n_pass = n_fail = 0

    for action_id, action_data in sorted(coupler_actions.items()):
        switches = action_data["switches"]
        impacted_vls = set()
        for sw_id in switches:
            vl = cache._switch_to_vl.get(sw_id)
            if vl:
                impacted_vls.add(vl)

        if not impacted_vls:
            n_fail += 1
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
            log.error(
                f"  FAIL {action_id}: disconnected elements! buses={sorted(all_buses)}"
            )
            n_fail += 1
        elif n_changed == 0:
            log.warning(f"  WARN {action_id}: no changes in diff")
            n_fail += 1
        else:
            n_pass += 1

    log.info(f"  Results: {n_pass} PASS, {n_fail} FAIL out of {len(coupler_actions)}")

    # Sample detail
    test_vl = sorted(eligible_vls.keys(), key=lambda v: -len(eligible_vls[v]))[0]
    test_sw = {f"{test_vl}_COUPL": True}
    i_n2b = cache.compute_bus_assignments({}, {test_vl})
    i_sb = cache.get_element_bus_assignments(i_n2b, {test_vl})
    f_n2b = cache.compute_bus_assignments(test_sw, {test_vl})
    f_sb = cache.get_element_bus_assignments(f_n2b, {test_vl})
    diff = _diff_set_bus(i_sb, f_sb)
    log.info(f"  Sample: {test_vl}")
    for k, v in sorted(diff.items()):
        if v:
            log.info(f"    {k}: {v}")

except ImportError:
    log.warning("  Skipping (expert_op4grid_recommender not available)")

# ---------------------------------------------------------------------------
# Step 9: Verify coupler opening
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Step 9 -- Verifying coupler opening creates valid split")
log.info("=" * 70)

test_vl = sorted(eligible_vls.keys(), key=lambda v: -len(eligible_vls[v]))[0]
n_test = pp.network.load(xiidm_path)
pp.loadflow.run_ac(n_test, Parameters(distributed_slack=True))
buses_before = len(n_test.get_buses())
n_test.update_switches(pd.DataFrame({"open": [True]}, index=[f"{test_vl}_COUPL"]))
result = pp.loadflow.run_ac(n_test, Parameters(distributed_slack=True))
buses_after = len(n_test.get_buses())
nan_buses = n_test.get_buses()[n_test.get_buses()["v_mag"].isna()]

log.info(f"  Opened {test_vl}_COUPL: {buses_before} -> {buses_after} el. buses")
log.info(f"  Loadflow: {result[0].status}")
log.info(
    f"  Island buses: {len(nan_buses)}" + (" PASS" if len(nan_buses) == 0 else " WARN")
)

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
log.info("")
log.info("=" * 70)
log.info("Done!")
log.info("=" * 70)
log.info("  Topology: NODE_BREAKER with double-busbar (2 DISCOs per element)")
log.info(f"  Double-busbar substations: {len(eligible_vls)}")
log.info(f"  SA.2 disconnectors added: {total_new_discos}")
log.info(f"  Elements on BBS2 (SA.1 open): {len(discos_to_open)}")
log.info(f"  Electrical buses: {len(n2.get_buses())}")
log.info(f"  Busbar sections: {len(n2.get_busbar_sections())}")
sw2 = n2.get_switches()
log.info(f"  Switches: {len(sw2)} ({sw2['kind'].value_counts().to_dict()})")
log.info(
    f"  Actions: {len(actions)} (incl. {sum(1 for k in actions if k.startswith('open_coupler_'))} coupler openings)"
)
log.info("=" * 70)
