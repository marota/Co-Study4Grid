"""
convert_pypsa_to_xiidm.py
=========================
Converts the France 400 kV OSM dataset (Zenodo 18619025) directly into a
pypowsybl XIIDM network file — no MATPOWER intermediate step.

Pipeline:
  1. Load & filter buses/lines/transformers from raw OSM CSVs
  2. Build a pypowsybl Network object (node-breaker topology)
  3. Export to XIIDM  →  data/pypsa_eur_fr400/network.xiidm
  4. Write grid_layout.json  →  data/pypsa_eur_fr400/grid_layout.json
  5. Write a bus-id mapping  →  data/pypsa_eur_fr400/bus_id_mapping.json

Node-breaker topology:
  Each VL has 1 busbar section (node 0) and each equipment connects via:
    busbar(node 0) → DISCONNECTOR → BREAKER → equipment node
  The add_detailed_topology.py script later adds a second busbar + coupling
  for eligible substations.

Usage:
    cd /home/marotant/dev/AntiGravity/ExpertAssist
    venv_expert_assist_py310/bin/python scripts/convert_pypsa_to_xiidm.py
"""

import os
import re
import json
import logging
import warnings
import pandas as pd
import networkx as nx
import pypowsybl as pp

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────
SCRIPT_DIR      = os.path.dirname(os.path.abspath(__file__))
BASE_DIR        = os.path.join(SCRIPT_DIR, "..")
DATA_DIR        = os.path.join(BASE_DIR, "data", "pypsa_eur_osm")
OUT_DIR         = os.path.join(BASE_DIR, "data", "pypsa_eur_fr400")
os.makedirs(OUT_DIR, exist_ok=True)

TARGET_COUNTRY  = "FR"
TARGET_VOLTAGES = [380, 400]


def safe_id(raw: str) -> str:
    """Convert an OSM id to a valid IIDM identifier."""
    return re.sub(r"[^A-Za-z0-9_\-\.]", "_", raw)


# ─────────────────────────────────────────────────────────────────────────────
# Step 1: Load raw CSVs
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 1 — Loading raw OSM CSVs …")
buses_raw  = pd.read_csv(os.path.join(DATA_DIR, "buses.csv"), index_col=0)
lines_raw  = pd.read_csv(os.path.join(DATA_DIR, "lines.csv"), index_col=0, quotechar="'")
trafos_raw = pd.read_csv(os.path.join(DATA_DIR, "transformers.csv"), index_col=0, quotechar="'")
log.info(f"  Raw: {len(buses_raw)} buses, {len(lines_raw)} lines, {len(trafos_raw)} trafos")

# ─────────────────────────────────────────────────────────────────────────────
# Step 2: Filter to France 380/400 kV AC
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 2 — Filtering to FR 380/400 kV AC …")
buses = buses_raw[
    (buses_raw["country"]            == TARGET_COUNTRY) &
    (buses_raw["voltage"].isin(TARGET_VOLTAGES)) &
    (buses_raw["dc"]                 == "f") &
    (buses_raw["under_construction"] == "f")
].copy()

bus_ids = set(buses.index)

lines = lines_raw[
    lines_raw["bus0"].isin(bus_ids) &
    lines_raw["bus1"].isin(bus_ids) &
    (lines_raw["under_construction"] == "f")
].copy()

trafos = trafos_raw[
    trafos_raw["bus0"].isin(bus_ids) &
    trafos_raw["bus1"].isin(bus_ids)
].copy()

log.info(f"  After filter: {len(buses)} buses, {len(lines)} lines, {len(trafos)} trafos")

# ─────────────────────────────────────────────────────────────────────────────
# Step 3: Keep main connected component
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 3 — Connected component analysis …")
G = nx.Graph()
G.add_nodes_from(bus_ids)
for _, row in lines.iterrows():
    G.add_edge(row["bus0"], row["bus1"])
for _, row in trafos.iterrows():
    G.add_edge(row["bus0"], row["bus1"])

main_comp = max(nx.connected_components(G), key=len)
log.info(f"  Main component: {len(main_comp)} buses")

buses  = buses[buses.index.isin(main_comp)].copy()
lines  = lines[lines["bus0"].isin(main_comp) & lines["bus1"].isin(main_comp)].copy()
trafos = trafos[trafos["bus0"].isin(main_comp) & trafos["bus1"].isin(main_comp)].copy()

bus_list  = sorted(buses.index.tolist())
slack_bus = bus_list[0]
log.info(f"  Final: {len(buses)} buses, {len(lines)} lines, {len(trafos)} trafos")

# ─────────────────────────────────────────────────────────────────────────────
# Step 4: Build pypowsybl Network
#
# IIDM rule: 2-winding transformers must have both VLs in the SAME substation.
# We map transformer-connected buses to share a single substation.
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 4 — Building pypowsybl Network …")

n = pp.network.create_empty("pypsa_eur_fr400")

# Assign substation ids: transformer-connected buses share a substation
bus_to_ss = {b: f"SS_{safe_id(b)}" for b in bus_list}
for _, row in trafos.iterrows():
    b0, b1 = row["bus0"], row["bus1"]
    if b0 in bus_to_ss and b1 in bus_to_ss:
        # Both buses share the substation of bus0
        bus_to_ss[b1] = bus_to_ss[b0]

unique_ss = sorted(set(bus_to_ss.values()))
log.info(f"  Substations: {len(unique_ss)} (merged trafo pairs)")

# Substations
ss_df = pd.DataFrame(
    {"country": ["FR"] * len(unique_ss), "name": unique_ss},
    index=unique_ss
)
n.create_substations(ss_df)

# Voltage levels (one per bus) — all NODE_BREAKER topology
vl_df = pd.DataFrame(
    {
        "substation_id":      [bus_to_ss[b] for b in bus_list],
        "topology_kind":      ["NODE_BREAKER"] * len(bus_list),
        "nominal_v":          [float(buses.loc[b, "voltage"]) for b in bus_list],
        "high_voltage_limit": [float(buses.loc[b, "voltage"]) * 1.10 for b in bus_list],
        "low_voltage_limit":  [float(buses.loc[b, "voltage"]) * 0.90 for b in bus_list],
    },
    index=[f"VL_{safe_id(b)}" for b in bus_list]
)
n.create_voltage_levels(vl_df)

# Busbar sections (one per VL at node 0)
bbs_df = pd.DataFrame(
    {
        "voltage_level_id": [f"VL_{safe_id(b)}" for b in bus_list],
        "node":             [0] * len(bus_list),
        "name":             ["Busbar 1"] * len(bus_list),
    },
    index=[f"VL_{safe_id(b)}_BBS1" for b in bus_list]
)
n.create_busbar_sections(bbs_df)
log.info(f"  Created {len(bus_list)} VLs with node-breaker topology")

# ── Per-VL node counter: tracks next available node for each VL ──
# Node 0 is reserved for busbar section 1 (BBS1)
# Node 1 is reserved for busbar section 2 (BBS2) — added by add_detailed_topology.py
# Element allocation starts at node 2
vl_next_node = {f"VL_{safe_id(b)}": 2 for b in bus_list}


def _allocate_nodes(vl_id: str, count: int) -> list:
    """Allocate `count` sequential nodes in a VL, returning their numbers."""
    start = vl_next_node[vl_id]
    vl_next_node[vl_id] = start + count
    return list(range(start, start + count))

# ─────────────────────────────────────────────────────────────────────────────
# Step 5: Generators and loads (one each per bus)
#
# Node-breaker pattern per element:
#   BBS1(node 0) ─ DISCONNECTOR ─ intermediate(node N) ─ BREAKER ─ element(node N+1)
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 5 — Adding generators and loads …")

gen_switch_ids = []
gen_switch_data = {"voltage_level_id": [], "node1": [], "node2": [], "kind": [], "name": []}

gen_ids = []
gen_data = {
    "voltage_level_id": [], "node": [],
    "target_p": [], "target_q": [], "target_v": [],
    "min_p": [], "max_p": [], "voltage_regulator_on": [],
}

load_switch_ids = []
load_switch_data = {"voltage_level_id": [], "node1": [], "node2": [], "kind": [], "name": []}

load_ids = []
load_data = {"voltage_level_id": [], "node": [], "p0": [], "q0": []}

for b in bus_list:
    vl_id = f"VL_{safe_id(b)}"
    g_id = f"G_{safe_id(b)}"
    l_id = f"L_{safe_id(b)}"

    # Generator: BBS1(0) → DISCO(node_d) → BK(node_d, node_e) → Gen(node_e)
    node_d, node_e = _allocate_nodes(vl_id, 2)
    gen_switch_ids.extend([f"{vl_id}_D_{g_id}", f"{vl_id}_BK_{g_id}"])
    for sw_id, n1, n2, kind, name in [
        (f"{vl_id}_D_{g_id}",  0,      node_d, "DISCONNECTOR", f"D {g_id[:25]}"),
        (f"{vl_id}_BK_{g_id}", node_d, node_e, "BREAKER",      f"BK {g_id[:24]}"),
    ]:
        gen_switch_data["voltage_level_id"].append(vl_id)
        gen_switch_data["node1"].append(n1)
        gen_switch_data["node2"].append(n2)
        gen_switch_data["kind"].append(kind)
        gen_switch_data["name"].append(name)

    gen_ids.append(g_id)
    gen_data["voltage_level_id"].append(vl_id)
    gen_data["node"].append(node_e)
    gen_data["target_p"].append(100.0 if b == slack_bus else 0.0)
    gen_data["target_q"].append(0.0)
    gen_data["target_v"].append(float(buses.loc[b, "voltage"]))
    gen_data["min_p"].append(0.0)
    gen_data["max_p"].append(100000.0 if b == slack_bus else 1000.0)
    gen_data["voltage_regulator_on"].append(True)

    # Load: BBS1(0) → DISCO(node_d) → BK(node_d, node_e) → Load(node_e)
    node_d, node_e = _allocate_nodes(vl_id, 2)
    load_switch_ids.extend([f"{vl_id}_D_{l_id}", f"{vl_id}_BK_{l_id}"])
    for sw_id, n1, n2, kind, name in [
        (f"{vl_id}_D_{l_id}",  0,      node_d, "DISCONNECTOR", f"D {l_id[:25]}"),
        (f"{vl_id}_BK_{l_id}", node_d, node_e, "BREAKER",      f"BK {l_id[:24]}"),
    ]:
        load_switch_data["voltage_level_id"].append(vl_id)
        load_switch_data["node1"].append(n1)
        load_switch_data["node2"].append(n2)
        load_switch_data["kind"].append(kind)
        load_switch_data["name"].append(name)

    load_ids.append(l_id)
    load_data["voltage_level_id"].append(vl_id)
    load_data["node"].append(node_e)
    load_data["p0"].append(1.0)
    load_data["q0"].append(0.1)

# Create switches first, then elements
n.create_switches(pd.DataFrame(gen_switch_data, index=gen_switch_ids))
n.create_generators(pd.DataFrame(gen_data, index=gen_ids))
n.create_switches(pd.DataFrame(load_switch_data, index=load_switch_ids))
n.create_loads(pd.DataFrame(load_data, index=load_ids))
log.info(f"  Added {len(gen_ids)} generators + {len(load_ids)} loads (with DISCO+BK switches)")

# ─────────────────────────────────────────────────────────────────────────────
# Step 6: AC Lines (node-breaker: each terminal gets DISCO + BK chain)
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 6 — Adding AC lines …")

line_sw_ids = []
line_sw_data = {"voltage_level_id": [], "node1": [], "node2": [], "kind": [], "name": []}

line_ids = []
line_data = {
    "voltage_level1_id": [], "node1": [],
    "voltage_level2_id": [], "node2": [],
    "r": [], "x": [], "b1": [], "b2": [], "g1": [], "g2": [],
    "name": [],
}
skipped = 0
seen_ids = set()

for line_id, row in lines.iterrows():
    try:
        b0 = safe_id(row["bus0"])
        b1 = safe_id(row["bus1"])
        vl1_id = f"VL_{b0}"
        vl2_id = f"VL_{b1}"
        circuits = max(1, int(row.get("circuits", 1) or 1))
        r = max(float(row["r"]) / circuits, 1e-4)
        x = max(float(row["x"]) / circuits, 1e-3)
        b = float(row["b"]) * circuits

        uid = safe_id(line_id)
        counter = 0
        while uid in seen_ids:
            counter += 1
            uid = f"{safe_id(line_id)}_{counter}"
        seen_ids.add(uid)

        # Side 1: BBS1(0) → DISCO → BK → line node
        node_d1, node_e1 = _allocate_nodes(vl1_id, 2)
        for sw_id, n1, n2, kind, name in [
            (f"{vl1_id}_D_{uid}_s1",  0,       node_d1, "DISCONNECTOR", f"D {uid[:23]}_s1"),
            (f"{vl1_id}_BK_{uid}_s1", node_d1, node_e1, "BREAKER",      f"BK {uid[:22]}_s1"),
        ]:
            line_sw_ids.append(sw_id)
            line_sw_data["voltage_level_id"].append(vl1_id)
            line_sw_data["node1"].append(n1)
            line_sw_data["node2"].append(n2)
            line_sw_data["kind"].append(kind)
            line_sw_data["name"].append(name)

        # Side 2: BBS1(0) → DISCO → BK → line node
        node_d2, node_e2 = _allocate_nodes(vl2_id, 2)
        for sw_id, n1, n2, kind, name in [
            (f"{vl2_id}_D_{uid}_s2",  0,       node_d2, "DISCONNECTOR", f"D {uid[:23]}_s2"),
            (f"{vl2_id}_BK_{uid}_s2", node_d2, node_e2, "BREAKER",      f"BK {uid[:22]}_s2"),
        ]:
            line_sw_ids.append(sw_id)
            line_sw_data["voltage_level_id"].append(vl2_id)
            line_sw_data["node1"].append(n1)
            line_sw_data["node2"].append(n2)
            line_sw_data["kind"].append(kind)
            line_sw_data["name"].append(name)

        line_ids.append(uid)
        line_data["voltage_level1_id"].append(vl1_id)
        line_data["node1"].append(node_e1)
        line_data["voltage_level2_id"].append(vl2_id)
        line_data["node2"].append(node_e2)
        line_data["r"].append(r)
        line_data["x"].append(x)
        line_data["b1"].append(b / 2)
        line_data["b2"].append(b / 2)
        line_data["g1"].append(0.0)
        line_data["g2"].append(0.0)
        line_data["name"].append(line_id)
    except Exception as e:
        log.debug(f"  Skipping line {line_id}: {e}")
        skipped += 1

# Create line switches first, then lines
n.create_switches(pd.DataFrame(line_sw_data, index=line_sw_ids))
n.create_lines(pd.DataFrame(line_data, index=line_ids))
log.info(f"  Added {len(line_ids)} lines with DISCO+BK switches (skipped {skipped})")

# ─────────────────────────────────────────────────────────────────────────────
# Step 7: 2-winding transformers (node-breaker: DISCO + BK per terminal)
# Note: both VLs MUST be in the same substation (enforced above in step 4)
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 7 — Adding transformers …")

if len(trafos) > 0:
    t_sw_ids = []
    t_sw_data = {"voltage_level_id": [], "node1": [], "node2": [], "kind": [], "name": []}

    t_ids = []
    t_data = {
        "rated_u1": [], "rated_u2": [], "rated_s": [],
        "r": [], "x": [], "g": [], "b": [],
        "voltage_level1_id": [], "node1": [],
        "voltage_level2_id": [], "node2": [],
        "name": [],
    }
    for tid, row in trafos.iterrows():
        b0 = safe_id(row["bus0"])
        b1 = safe_id(row["bus1"])
        vl1_id = f"VL_{b0}"
        vl2_id = f"VL_{b1}"
        v0 = float(buses.loc[row["bus0"], "voltage"]) if row["bus0"] in buses.index else 400.0
        v1 = float(buses.loc[row["bus1"], "voltage"]) if row["bus1"] in buses.index else 400.0
        s  = float(row["s_nom"]) if pd.notna(row.get("s_nom")) else 100.0

        t_id = f"T_{safe_id(tid)}"

        # Side 1: BBS1(0) → DISCO → BK → trafo node
        node_d1, node_e1 = _allocate_nodes(vl1_id, 2)
        for sw_id, n1, n2, kind, name in [
            (f"{vl1_id}_D_{t_id}_s1",  0,       node_d1, "DISCONNECTOR", f"D {t_id[:23]}_s1"),
            (f"{vl1_id}_BK_{t_id}_s1", node_d1, node_e1, "BREAKER",      f"BK {t_id[:22]}_s1"),
        ]:
            t_sw_ids.append(sw_id)
            t_sw_data["voltage_level_id"].append(vl1_id)
            t_sw_data["node1"].append(n1)
            t_sw_data["node2"].append(n2)
            t_sw_data["kind"].append(kind)
            t_sw_data["name"].append(name)

        # Side 2: BBS1(0) → DISCO → BK → trafo node
        node_d2, node_e2 = _allocate_nodes(vl2_id, 2)
        for sw_id, n1, n2, kind, name in [
            (f"{vl2_id}_D_{t_id}_s2",  0,       node_d2, "DISCONNECTOR", f"D {t_id[:23]}_s2"),
            (f"{vl2_id}_BK_{t_id}_s2", node_d2, node_e2, "BREAKER",      f"BK {t_id[:22]}_s2"),
        ]:
            t_sw_ids.append(sw_id)
            t_sw_data["voltage_level_id"].append(vl2_id)
            t_sw_data["node1"].append(n1)
            t_sw_data["node2"].append(n2)
            t_sw_data["kind"].append(kind)
            t_sw_data["name"].append(name)

        t_ids.append(t_id)
        t_data["rated_u1"].append(v0)
        t_data["rated_u2"].append(v1)
        t_data["rated_s"].append(s)
        t_data["r"].append(0.1)
        t_data["x"].append(10.0)
        t_data["g"].append(0.0)
        t_data["b"].append(0.0)
        t_data["voltage_level1_id"].append(vl1_id)
        t_data["node1"].append(node_e1)
        t_data["voltage_level2_id"].append(vl2_id)
        t_data["node2"].append(node_e2)
        t_data["name"].append(tid)

    n.create_switches(pd.DataFrame(t_sw_data, index=t_sw_ids))
    n.create_2_windings_transformers(pd.DataFrame(t_data, index=t_ids))
    log.info(f"  Added {len(t_ids)} transformers with DISCO+BK switches")
else:
    log.info("  No transformers to add")

# ─────────────────────────────────────────────────────────────────────────────
# Step 8: Export to XIIDM
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 8 — Exporting to XIIDM …")

xiidm_path = os.path.join(OUT_DIR, "network.xiidm")
n.dump(xiidm_path, format="XIIDM")
size_kb = os.path.getsize(xiidm_path) / 1024
log.info(f"  Written: {xiidm_path}  ({size_kb:.1f} KB)")

# Save node counter state for downstream scripts (add_detailed_topology.py)
node_counter_path = os.path.join(OUT_DIR, "vl_next_node.json")
with open(node_counter_path, "w") as f:
    json.dump(vl_next_node, f, indent=2)
log.info(f"  Written: {node_counter_path}")

# Round-trip verification
n2 = pp.network.load(xiidm_path)
log.info(f"  Round-trip: {len(n2.get_buses())} buses, {len(n2.get_lines())} lines, "
         f"{len(n2.get_2_windings_transformers())} trafos, {len(n2.get_switches())} switches")

# ─────────────────────────────────────────────────────────────────────────────
# Step 9: Write grid_layout.json
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 9 — Writing grid_layout.json …")

# pypowsybl electrical bus ids take the form "{VL_id}_0", "{VL_id}_1", etc.
# We write multiple forms so the backend (network_service.py) finds them.
layout = {}
for bus_id, row in buses.iterrows():
    sid = safe_id(bus_id)
    lon = float(row["x"])
    lat = float(row["y"])
    layout[sid]           = [lon, lat]
    # Cover electrical bus naming up to a generous index
    for idx in range(10):
        layout[f"VL_{sid}_{idx}"] = [lon, lat]

layout_path = os.path.join(OUT_DIR, "grid_layout.json")
with open(layout_path, "w") as f:
    json.dump(layout, f, indent=2)
log.info(f"  Written: {layout_path}  ({len(layout)} entries)")

# ─────────────────────────────────────────────────────────────────────────────
# Step 10: Write bus id mapping (safe_id → original OSM id)
# ─────────────────────────────────────────────────────────────────────────────
mapping = {safe_id(b): b for b in buses.index}
mapping_path = os.path.join(OUT_DIR, "bus_id_mapping.json")
with open(mapping_path, "w") as f:
    json.dump(mapping, f, indent=2)
log.info(f"  Written: {mapping_path}")

# ─────────────────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────────────────
log.info("=" * 60)
log.info("Conversion complete ✓")
log.info(f"  Electrical buses : {len(n2.get_buses())}")
log.info(f"  Busbar sections  : {len(n2.get_busbar_sections())}")
log.info(f"  Switches         : {len(n2.get_switches())}")
log.info(f"  Lines            : {len(n2.get_lines())}")
log.info(f"  Transformers     : {len(n2.get_2_windings_transformers())}")
log.info(f"  Generators       : {len(n2.get_generators())}")
log.info(f"  Loads            : {len(n2.get_loads())}")
log.info(f"  XIIDM file       : {xiidm_path}")
log.info(f"  Layout file      : {layout_path}")
log.info(f"  Bus mapping      : {mapping_path}")
log.info(f"  Node counter     : {node_counter_path}")
log.info("=" * 60)
