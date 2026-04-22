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
# Step 3b: Load OSM names for human-readable labels
# ─────────────────────────────────────────────────────────────────────────────
OSM_NAMES_FILE = os.path.join(OUT_DIR, "osm_names.json")
bus_display_names = {}   # bus_index -> display name (e.g. "BOUTRE")
line_display_names = {}  # line_index -> display name (e.g. "Avelin - Weppes 1")

if os.path.exists(OSM_NAMES_FILE):
    log.info("Step 3b — Loading OSM names for real labels …")
    with open(OSM_NAMES_FILE, encoding="utf-8") as f:
        osm_names = json.load(f)

    for bus_idx, info in osm_names.get("bus_to_name", {}).items():
        name = info.get("display_name", "")
        if name:
            bus_display_names[bus_idx] = name

    for line_idx, info in osm_names.get("line_to_name", {}).items():
        # Prefer human-readable 'name' over RTE code
        name = info.get("name") or info.get("display_name", "")
        if name:
            line_display_names[line_idx] = name

    log.info(f"  Loaded {len(bus_display_names)} bus names, {len(line_display_names)} line names")
else:
    log.warning("  osm_names.json not found — using raw IDs. Run fetch_osm_names.py first.")


def _bus_name(bus_id: str) -> str:
    """Get a human-readable name for a bus/substation."""
    return bus_display_names.get(bus_id, safe_id(bus_id))


def _line_name(line_id: str, bus0: str = "", bus1: str = "") -> str:
    """Get a human-readable name for a line/circuit.

    Falls back to a composite name built from bus endpoint names when
    no OSM name is available, so that the pypowsybl ``name`` field
    always contains something human-readable (e.g. "CHARPENAY — ST-VULBAS-EST").
    """
    osm = line_display_names.get(line_id)
    if osm:
        return osm
    # Build composite name from bus endpoints
    n0 = bus_display_names.get(bus0, "")
    n1 = bus_display_names.get(bus1, "")
    if n0 and n1 and n0 != n1:
        return f"{n0} \u2014 {n1}"
    if n0:
        return n0
    if n1:
        return n1
    return str(line_id)


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

# Substations — use real RTE names where available
# Build SS id → display name: derive from the first bus mapped to that SS
ss_name_map = {}
for b in bus_list:
    ss_id = bus_to_ss[b]
    if ss_id not in ss_name_map:
        ss_name_map[ss_id] = _bus_name(b)

ss_df = pd.DataFrame(
    {
        "country": ["FR"] * len(unique_ss),
        "name": [ss_name_map.get(ss, ss) for ss in unique_ss],
    },
    index=unique_ss
)
n.create_substations(ss_df)

# Voltage levels (one per bus) — all NODE_BREAKER topology
# Name: "BOUTRE 400kV" (human-readable name + voltage)
vl_names = []
for b in bus_list:
    display = _bus_name(b)
    kv = int(buses.loc[b, "voltage"])
    vl_names.append(f"{display} {kv}kV")

vl_df = pd.DataFrame(
    {
        "substation_id":      [bus_to_ss[b] for b in bus_list],
        "topology_kind":      ["NODE_BREAKER"] * len(bus_list),
        "nominal_v":          [float(buses.loc[b, "voltage"]) for b in bus_list],          # kV (pypowsybl unit)
        "high_voltage_limit": [float(buses.loc[b, "voltage"]) * 1.10 for b in bus_list],  # +10%
        "low_voltage_limit":  [float(buses.loc[b, "voltage"]) * 0.90 for b in bus_list],  # -10%
        "name":               vl_names,
    },
    index=[f"VL_{safe_id(b)}" for b in bus_list]
)
n.create_voltage_levels(vl_df)

# Busbar sections (one per VL at node 0)
bbs_df = pd.DataFrame(
    {
        "voltage_level_id": [f"VL_{safe_id(b)}" for b in bus_list],
        "node":             [0] * len(bus_list),
        "name":             [f"{_bus_name(b)} JdB1" for b in bus_list],
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
# Scaling strategy:
#   - Line thermal ratings in the OSM data have total capacity ~754 GW
#   - For a realistic French 400kV grid at 50-80 GW scale, scale loads accordingly
#   - Total load ≈ 75 GW (median estimate), with each bus proportional to its
#     connectivity degree (buses with more connections get more load)
#   - Total generation ≈ 85 GW (5% above load for slack headroom)
#   - Generator voltage targets: 400 kV (standard for 400kV network)
#
# Node-breaker pattern per element:
#   BBS1(node 0) ─ DISCONNECTOR ─ intermediate(node N) ─ BREAKER ─ element(node N+1)
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 5 — Adding generators and loads …")

# ── Compute scaling factors based on line capacity ──
# Assume total line capacity (~754 GW) should support ~75 GW load + ~85 GW gen
# on a realistic French grid. This is consistent with actual RTE grid data.
lines_total_s_nom = lines["s_nom"].sum()  # ~754 GW
target_total_load_mw = 75000.0  # 75 GW target load
target_total_gen_mw = 85000.0   # 85 GW target generation (10 GW above load for slack)
load_scale = target_total_load_mw / len(bus_list)  # uniform load per bus
gen_scale = target_total_gen_mw / len(bus_list)    # uniform generation per bus

log.info(f"  Load scaling: {load_scale:.1f} MW per bus (total {target_total_load_mw:.0f} MW)")
log.info(f"  Gen scaling: {gen_scale:.1f} MW per bus (total {target_total_gen_mw:.0f} MW)")

# ── Compute degree-based load distribution (buses with more connections get more load) ──
import networkx as nx
degree_graph = nx.Graph()
degree_graph.add_nodes_from(bus_list)
for _, row in lines.iterrows():
    b0, b1 = row["bus0"], row["bus1"]
    if b0 in bus_list and b1 in bus_list:
        degree_graph.add_edge(b0, b1)
for _, row in trafos.iterrows():
    b0, b1 = row["bus0"], row["bus1"]
    if b0 in bus_list and b1 in bus_list:
        degree_graph.add_edge(b0, b1)

bus_degrees = dict(degree_graph.degree())
min_degree = min(bus_degrees.values()) if bus_degrees else 1
max_degree = max(bus_degrees.values()) if bus_degrees else 1
degree_sum = sum(bus_degrees.values())

# Normalize degrees: higher degree → higher load fraction
# Load for bus i: load_scale * (degree[i] - min_degree + 1) / scale_factor
degree_weights = {b: max(1.0, float(bus_degrees[b] - min_degree + 1)) for b in bus_list}
degree_weight_sum = sum(degree_weights.values())

log.info(f"  Bus connectivity: min degree {min_degree}, max degree {max_degree}, avg {degree_sum / len(bus_list):.1f}")

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

    # Distribute generation uniformly: each bus can supply up to gen_scale MW
    # Slack bus (first bus) is capable of providing additional power if needed
    gen_ids.append(g_id)
    gen_data["voltage_level_id"].append(vl_id)
    gen_data["node"].append(node_e)
    gen_data["target_p"].append(gen_scale)  # Set to average gen (slack will adjust in load flow)
    gen_data["target_q"].append(0.0)
    gen_data["target_v"].append(float(buses.loc[b, "voltage"]))  # kV (pypowsybl unit)
    gen_data["min_p"].append(0.0)
    gen_data["max_p"].append(gen_scale * 2.0 if b == slack_bus else gen_scale * 1.5)  # Slack can provide more
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

    # Distribute load proportional to bus degree (connectivity)
    weight = degree_weights.get(b, 1.0)
    load_mw = (load_scale * weight / degree_weight_sum) * len(bus_list)
    load_ids.append(l_id)
    load_data["voltage_level_id"].append(vl_id)
    load_data["node"].append(node_e)
    load_data["p0"].append(load_mw)
    load_data["q0"].append(load_mw * 0.1)  # 10% reactive load

# Create switches first, then elements
n.create_switches(pd.DataFrame(gen_switch_data, index=gen_switch_ids))
n.create_generators(pd.DataFrame(gen_data, index=gen_ids))
n.create_switches(pd.DataFrame(load_switch_data, index=load_switch_ids))
n.create_loads(pd.DataFrame(load_data, index=load_ids))

total_gen_p = sum(gen_data["target_p"])
total_load_p = sum(load_data["p0"])
log.info(f"  Added {len(gen_ids)} generators + {len(load_ids)} loads (with DISCO+BK switches)")
log.info(f"    Total generation: {total_gen_p:.0f} MW, Total load: {total_load_p:.0f} MW")

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
line_i_nom = {}  # uid -> current limit in A (for operational limits)
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
        line_data["name"].append(_line_name(line_id, row["bus0"], row["bus1"]))

        # Track current limit: i_nom (kA in CSV) * circuits → Amperes
        i_nom_ka = float(row.get("i_nom", 0) or 0)
        if i_nom_ka > 0:
            line_i_nom[uid] = i_nom_ka * 1000.0 * circuits  # kA → A, scaled by circuits
    except Exception as e:
        log.debug(f"  Skipping line {line_id}: {e}")
        skipped += 1

# Create line switches first, then lines
n.create_switches(pd.DataFrame(line_sw_data, index=line_sw_ids))
n.create_lines(pd.DataFrame(line_data, index=line_ids))
log.info(f"  Added {len(line_ids)} lines with DISCO+BK switches (skipped {skipped})")

# Add permanent current limits (operational limits) to lines
if line_i_nom:
    limit_ids = []
    limit_data = {
        "element_id": [],
        "element_type": [],
        "side": [],
        "name": [],
        "type": [],
        "value": [],
        "acceptable_duration": [],
    }
    for uid, i_lim_a in line_i_nom.items():
        limit_ids.append(f"{uid}_perm_limit")
        limit_data["element_id"].append(uid)
        limit_data["element_type"].append("LINE")
        limit_data["side"].append("ONE")
        limit_data["name"].append("permanent_limit")
        limit_data["type"].append("CURRENT")
        limit_data["value"].append(i_lim_a)
        limit_data["acceptable_duration"].append(-1)
    n.create_operational_limits(pd.DataFrame(limit_data, index=limit_ids))
    log.info(f"  Added permanent current limits to {len(limit_ids)} lines "
             f"(typical limit: {next(iter(line_i_nom.values())):.0f} A)")

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
        # Name: "SUBST1 - SUBST2" using endpoint substation names
        t_name_1 = _bus_name(row["bus0"])
        t_name_2 = _bus_name(row["bus1"])
        t_data["name"].append(f"{t_name_1} - {t_name_2}")

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

# Round-trip verification and flow-based limit calibration
n2 = pp.network.load(xiidm_path)
log.info(f"  Round-trip: {len(n2.get_buses())} buses, {len(n2.get_lines())} lines, "
         f"{len(n2.get_2_windings_transformers())} trafos, {len(n2.get_switches())} switches")

# ── Calibrate operational limits based on actual N-state power flows ──
#
# Strategy: produce a realistic *spread* of N-state loadings rather than
# pinning every line at the same percentage.
#
# The OSM i_nom (2580 A for 400 kV lines) is far above actual flows (~50-900 A),
# so using raw i_nom gives <30% loading everywhere.  Instead we:
#
# 1. Run AC load flow → get N-state current per line.
# 2. Set each line's limit proportional to its flow but with randomised headroom
#    drawn from an exponential-like distribution centred at the flow value:
#       limit = flow / target_loading(line)
#    where target_loading is drawn from a distribution with:
#       - ~50% of lines at ≤50% loading (generous headroom)
#       - some lines at 55-65% (tight corridors that will overload in N-1)
#       - absolute cap: no line above 65% in N state
#       - absolute floor: limit ≥ MIN_LIMIT_A
# 3. The distribution is *deterministic* (seeded by line ID hash) so the
#    same conversion run always produces the same limits.
#
# With this spread, N-1 contingencies on tight corridors produce overloads
# in the 100-130% range when flow redistributes to parallel paths.
#
log.info("  Calibrating operational limits from N-state flows …")
from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter as _olf_params
_lf_results = pp.loadflow.run_ac(n2, parameters=_olf_params())
_lf_ok = any(r.status.name == 'CONVERGED' for r in _lf_results)
if _lf_ok:
    import numpy as _np
    import hashlib as _hashlib
    _n2_lines = n2.get_lines()[['i1', 'i2']]
    _MIN_LIMIT_A = 100.0

    # Target loading distribution parameters
    # Lines get a target N-state loading drawn from a distribution:
    #   - base range: 20% to 65%
    #   - skewed towards lower values (many lightly loaded lines)
    _LOADING_MIN = 0.20   # lightest loaded lines: 20%
    _LOADING_MAX = 0.65   # tightest loaded lines: 65%

    # Compute N-state flow per line
    _line_flows = {}
    for _lid, _row in _n2_lines.iterrows():
        if _np.isnan(_row['i1']) or _np.isnan(_row['i2']):
            continue
        _line_flows[_lid] = max(abs(_row['i1']), abs(_row['i2']))

    # Sort lines by flow (highest flow = tightest limit)
    _sorted_lines = sorted(_line_flows.items(), key=lambda x: x[1], reverse=True)

    # Assign target loadings: top-loaded lines get higher loading %,
    # lightly loaded lines get lower loading %.
    # Use a power-law-like distribution: rank-based assignment.
    _n_lines = len(_sorted_lines)
    _lim_map = {}
    _loadings = []
    for _rank, (_lid, _flow) in enumerate(_sorted_lines):
        # Normalised rank: 0 = highest flow, 1 = lowest flow
        _t = _rank / max(1, _n_lines - 1)
        # Target loading: high-flow lines get ~60-65%, low-flow get ~20-30%
        # Use a smooth curve: loading = MAX - (MAX-MIN) * t^0.6
        # (exponent <1 skews distribution towards lower loadings)
        _target_loading = _LOADING_MAX - (_LOADING_MAX - _LOADING_MIN) * (_t ** 0.6)

        # Add per-line jitter (±5%) based on deterministic hash
        _hash_val = int(_hashlib.md5(_lid.encode()).hexdigest()[:8], 16)
        _jitter = ((_hash_val % 1000) / 1000.0 - 0.5) * 0.10  # ±5%
        _target_loading = max(_LOADING_MIN, min(_LOADING_MAX, _target_loading + _jitter))

        _new_lim = max(_MIN_LIMIT_A, _flow / _target_loading)
        _lim_map[_lid] = _new_lim
        if _new_lim > 0:
            _loadings.append(_flow / _new_lim * 100.0)

    _loadings.sort()
    _pct_below_50 = sum(1 for x in _loadings if x <= 50.0) / len(_loadings) * 100
    log.info("  N-state loading distribution:")
    log.info(f"    min={_loadings[0]:.1f}%, median={_loadings[len(_loadings)//2]:.1f}%, "
             f"max={_loadings[-1]:.1f}%")
    log.info(f"    {_pct_below_50:.0f}% of lines at ≤50% loading")
    log.info(f"    P25={_loadings[len(_loadings)//4]:.1f}%, "
             f"P75={_loadings[3*len(_loadings)//4]:.1f}%, "
             f"P90={_loadings[int(len(_loadings)*0.9)]:.1f}%")

    # Update limits in XIIDM XML (pypowsybl doesn't support in-place update)
    from lxml import etree
    _tree = etree.parse(xiidm_path)
    _root = _tree.getroot()
    _xml_updated = 0
    for _line_el in _root.iter():
        _tag = _line_el.tag.split('}')[-1] if '}' in _line_el.tag else _line_el.tag
        if _tag == "line":
            _el_id = _line_el.get("id")
            if _el_id in _lim_map:
                for _cl_el in _line_el.iter():
                    _cl_tag = _cl_el.tag.split('}')[-1] if '}' in _cl_el.tag else _cl_el.tag
                    if _cl_tag == "currentLimits" and "permanentLimit" in _cl_el.attrib:
                        _cl_el.set("permanentLimit", f"{_lim_map[_el_id]:.1f}")
                        _xml_updated += 1
    _tree.write(xiidm_path, xml_declaration=True, encoding="UTF-8")
    _size_kb = os.path.getsize(xiidm_path) / 1024
    log.info(f"  Re-exported with calibrated limits: {xiidm_path}  ({_size_kb:.1f} KB)")
    log.info(f"  Updated {_xml_updated} line limits in XML")

    # ── N-1 verification pass: cap overloads at MAX_N1_LOADING ──
    # Run each contingency, find lines exceeding the cap, bump their limits.
    # Iterate until no line exceeds the cap (typically 1-2 passes).
    _MAX_N1_LOADING = 1.30  # no line above 130% in any N-1 state
    _MAX_N1_PASSES = 3
    for _pass_num in range(1, _MAX_N1_PASSES + 1):
        log.info(f"  N-1 verification pass {_pass_num} (cap={_MAX_N1_LOADING*100:.0f}%) …")
        _n1_net = pp.network.load(xiidm_path)
        _n1_lines_list = list(_n1_net.get_lines().index)
        _bumps = {}  # line_id -> needed limit (max across all contingencies)

        for _cont_id in _n1_lines_list:
            _nc = pp.network.load(xiidm_path)
            try:
                _nc.update_lines(id=[_cont_id], connected1=[False], connected2=[False])
            except Exception:
                continue
            _lf_c = pp.loadflow.run_ac(_nc, parameters=_olf_params())
            if not any(_r.status.name == 'CONVERGED' for _r in _lf_c):
                continue
            _c_lines = _nc.get_lines()[['i1', 'i2']]
            for _clid, _crow in _c_lines.iterrows():
                if _clid == _cont_id or _np.isnan(_crow['i1']):
                    continue
                _c_flow = max(abs(_crow['i1']), abs(_crow['i2']))
                _c_lim = _lim_map.get(_clid, 0)
                if _c_lim > 0 and _c_flow / _c_lim > _MAX_N1_LOADING:
                    # Add 2% margin to account for XML rounding (1 decimal place)
                    _needed = _c_flow / (_MAX_N1_LOADING - 0.02)
                    if _clid not in _bumps or _needed > _bumps[_clid]:
                        _bumps[_clid] = _needed

        if not _bumps:
            log.info(f"    No lines exceed {_MAX_N1_LOADING*100:.0f}% — verification passed ✓")
            break

        log.info(f"    Bumping limits on {len(_bumps)} lines to stay under {_MAX_N1_LOADING*100:.0f}%")
        for _bid, _new_val in _bumps.items():
            _lim_map[_bid] = _new_val
            log.info(f"      {_bid}: → {_new_val:.1f} A")

        # Re-write XML with bumped limits
        _tree2 = etree.parse(xiidm_path)
        _root2 = _tree2.getroot()
        for _line_el2 in _root2.iter():
            _tag2 = _line_el2.tag.split('}')[-1] if '}' in _line_el2.tag else _line_el2.tag
            if _tag2 == "line":
                _el_id2 = _line_el2.get("id")
                if _el_id2 in _bumps:
                    for _cl_el2 in _line_el2.iter():
                        _cl_tag2 = _cl_el2.tag.split('}')[-1] if '}' in _cl_el2.tag else _cl_el2.tag
                        if _cl_tag2 == "currentLimits" and "permanentLimit" in _cl_el2.attrib:
                            _cl_el2.set("permanentLimit", f"{_lim_map[_el_id2]:.1f}")
        _tree2.write(xiidm_path, xml_declaration=True, encoding="UTF-8")
    else:
        log.warning(f"  N-1 verification did not converge after {_MAX_N1_PASSES} passes")

    # Final N-state loading summary after all limit adjustments
    _n_final = pp.network.load(xiidm_path)
    pp.loadflow.run_ac(_n_final, parameters=_olf_params())
    _final_lines = _n_final.get_lines()[['i1', 'i2']]
    _final_loadings = []
    for _flid, _frow in _final_lines.iterrows():
        if _np.isnan(_frow['i1']):
            continue
        _f_flow = max(abs(_frow['i1']), abs(_frow['i2']))
        _f_lim = _lim_map.get(_flid, 0)
        if _f_lim > 0:
            _final_loadings.append(_f_flow / _f_lim * 100.0)
    _final_loadings.sort()
    _f_pct50 = sum(1 for x in _final_loadings if x <= 50.0) / len(_final_loadings) * 100
    log.info(f"  Final N-state loading: min={_final_loadings[0]:.1f}%, "
             f"median={_final_loadings[len(_final_loadings)//2]:.1f}%, "
             f"max={_final_loadings[-1]:.1f}%, "
             f"{_f_pct50:.0f}% at ≤50%")
else:
    log.warning("  AC load flow did not converge — keeping raw i_nom limits")

# ─────────────────────────────────────────────────────────────────────────────
# Step 9: Write grid_layout.json
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 9 — Writing grid_layout.json …")

# pypowsybl NAD fixed_positions expects **voltage-level IDs** (e.g. "VL_{sid}")
# as keys, with [x, y] in screen coordinates (y increasing downward).
#
# We project WGS-84 lon/lat to Web Mercator, negate Y so north is up, then
# rescale so the x-span ≈ 8 000 units — matching pypowsybl's natural
# force-layout scale where circle radii (20–27.5 px) and text are readable.
import math

EARTH_RADIUS = 6_378_137.0  # WGS-84 semi-major axis (metres)
_TARGET_WIDTH = 8_000.0      # target x-span matching pypowsybl force-layout

def _lon_lat_to_mercator(lon, lat):
    x = math.radians(lon) * EARTH_RADIUS
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * EARTH_RADIUS
    return x, y

# First pass: project all points and collect bounds
raw_positions = {}
for bus_id, row in buses.iterrows():
    sid = safe_id(bus_id)
    lon = float(row["x"])
    lat = float(row["y"])
    mx, my = _lon_lat_to_mercator(lon, lat)
    raw_positions[f"VL_{sid}"] = (mx, -my)  # negate Y for screen coords

raw_xs = [v[0] for v in raw_positions.values()]
raw_ys = [v[1] for v in raw_positions.values()]
p_cx = (min(raw_xs) + max(raw_xs)) / 2
p_cy = (min(raw_ys) + max(raw_ys)) / 2
p_xrange = max(raw_xs) - min(raw_xs) or 1.0

# Uniform scale (preserves aspect ratio)
scale = _TARGET_WIDTH / p_xrange

# Second pass: rescale to NAD-friendly coordinate space
layout = {}
for vl_id, (rx, ry) in raw_positions.items():
    nx = (rx - p_cx) * scale
    ny = (ry - p_cy) * scale
    layout[vl_id] = [round(nx, 2), round(ny, 2)]

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
# Step 11: Generate disconnection actions (actions.json)
# ─────────────────────────────────────────────────────────────────────────────
log.info("Step 11 — Generating disconnection actions …")

# Build IIDM line id → display name mapping (for this script and downstream)
line_id_to_name = {}
for uid, name in zip(line_ids, line_data["name"]):
    line_id_to_name[uid] = name

actions = {}

# Line disconnection actions
for uid in line_ids:
    display = line_id_to_name.get(uid, uid)
    vl1 = None
    vl2 = None
    # Look up VL names from the line data
    idx = line_ids.index(uid)
    vl1_id = line_data["voltage_level1_id"][idx]
    vl2_id = line_data["voltage_level2_id"][idx]
    vl1_name = vl_df.loc[vl1_id, "name"] if vl1_id in vl_df.index else vl1_id
    vl2_name = vl_df.loc[vl2_id, "name"] if vl2_id in vl_df.index else vl2_id

    actions[f"disco_{uid}"] = {
        "description": f"Disconnection of line '{display}' ({vl1_name} — {vl2_name})",
        "description_unitaire": f"Ouverture de la ligne '{display}'",
        "content": {
            "set_bus": {
                "lines_or_id": {uid: -1},
                "lines_ex_id": {uid: -1},
            }
        },
    }

# Transformer disconnection actions
if len(trafos) > 0:
    for t_id, t_name in zip(t_ids, t_data["name"]):
        actions[f"disco_{t_id}"] = {
            "description": f"Disconnection of transformer '{t_name}'",
            "description_unitaire": f"Ouverture du transformateur '{t_name}'",
            "content": {
                "set_bus": {
                    "lines_or_id": {t_id: -1},
                    "lines_ex_id": {t_id: -1},
                }
            },
        }

actions_path = os.path.join(OUT_DIR, "actions.json")
with open(actions_path, "w", encoding="utf-8") as f:
    json.dump(actions, f, indent=2, ensure_ascii=False)
log.info(f"  Written: {actions_path}  ({len(actions)} actions)")

# Save line id → display name mapping for downstream scripts
line_names_path = os.path.join(OUT_DIR, "line_id_names.json")
with open(line_names_path, "w", encoding="utf-8") as f:
    json.dump(line_id_to_name, f, indent=2, ensure_ascii=False)
log.info(f"  Written: {line_names_path}")

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
