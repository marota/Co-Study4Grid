"""
build_pypsa_eur_network.py
==========================
Builds a France 400 kV transmission network from the PyPSA-Eur OSM dataset
(Zenodo record 18619025), exports it as:

  1. A MATPOWER .m file   → data/pypsa_eur_fr400/network.m
  2. A grid_layout.json   → data/pypsa_eur_fr400/grid_layout.json
  3. A stats summary      → data/pypsa_eur_fr400/network_stats.txt

Usage:
    cd /home/marotant/dev/AntiGravity/ExpertAssist
    venv_expert_assist_py310/bin/python scripts/build_pypsa_eur_network.py
"""

import os
import json
import logging
import warnings
import numpy as np
import pandas as pd
import networkx as nx

warnings.filterwarnings("ignore")
logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ─── Configuration ────────────────────────────────────────────────────────────
SCRIPT_DIR     = os.path.dirname(os.path.abspath(__file__))
BASE_DIR       = os.path.join(SCRIPT_DIR, "..")
DATA_DIR       = os.path.join(BASE_DIR, "data", "pypsa_eur_osm")
OUT_DIR        = os.path.join(BASE_DIR, "data", "pypsa_eur_fr400")
os.makedirs(OUT_DIR, exist_ok=True)

TARGET_COUNTRY  = "FR"
TARGET_VOLTAGES = [380, 400]   # kV — OSM uses both 380 and 400 for the French HV grid
BASE_MVA        = 100.0        # MATPOWER system base (MVA)


# ─── Helper: write MATPOWER .m file ──────────────────────────────────────────
def write_matpower(path, bus_list, bus_to_int, buses_df, lines_df):
    """Write a MATPOWER v2 case file."""
    slack_bus = bus_list[0]

    with open(path, "w") as f:
        f.write("function mpc = network\n")
        f.write("%% MATPOWER case file — PyPSA-Eur OSM France 400 kV\n")
        f.write(f"%% Buses: {len(bus_list)}  Branches: {len(lines_df)}\n\n")
        f.write("mpc.version = '2';\n\n")
        f.write(f"mpc.baseMVA = {BASE_MVA};\n\n")

        # bus data: [bus_i type Pd Qd Gs Bs area Vm Va baseKV zone Vmax Vmin]
        f.write("%% bus data\n")
        f.write("%  bus_i  type  Pd    Qd    Gs  Bs  area  Vm    Va  baseKV  zone  Vmax  Vmin\n")
        f.write("mpc.bus = [\n")
        for bus_id in bus_list:
            bi       = bus_to_int[bus_id]
            bus_type = 3 if bus_id == slack_bus else 1
            v_nom    = float(buses_df.loc[bus_id, "voltage"])
            f.write(f"    {bi}  {bus_type}  1.0  0.1  0  0  1  1.0  0  {v_nom}  1  1.05  0.95;\n")
        f.write("];\n\n")

        # generator data: [bus Pg Qg Qmax Qmin Vg mBase status Pmax Pmin]
        f.write("%% generator data\n")
        f.write("%  bus  Pg  Qg    Qmax   Qmin    Vg  mBase  status  Pmax   Pmin\n")
        f.write("mpc.gen = [\n")
        slack_i = bus_to_int[slack_bus]
        f.write(f"    {slack_i}  0  0  99999  -99999  1.0  {BASE_MVA}  1  100000  0;\n")
        f.write("];\n\n")

        # branch data: [fbus tbus r x b rateA rateB rateC ratio angle status angmin angmax]
        f.write("%% branch data\n")
        f.write("%  fbus  tbus  r           x           b           rateA   rateB   rateC   ratio  angle  status  angmin  angmax\n")
        f.write("mpc.branch = [\n")
        for _, row in lines_df.iterrows():
            fb   = bus_to_int.get(row["bus0"])
            tb   = bus_to_int.get(row["bus1"])
            if fb is None or tb is None:
                continue
            r    = max(float(row["r"]),   1e-6)
            x    = max(float(row["x"]),   1e-4)
            b    = float(row["b"])
            rate = float(row["s_nom"]) if pd.notna(row.get("s_nom")) else BASE_MVA
            f.write(f"    {fb}  {tb}  {r:.8f}  {x:.8f}  {b:.8f}  {rate:.1f}  {rate:.1f}  {rate:.1f}  0  0  1  -360  360;\n")
        f.write("];\n\n")

        # bus name lookup (comments)
        f.write("%% bus name index\n")
        for bus_id in bus_list:
            f.write(f"% {bus_to_int[bus_id]}: {bus_id}\n")
        f.write("\n")

    log.info(f"  Written: {path}")


# ─── Step 1: Load raw CSVs ────────────────────────────────────────────────────
log.info("Step 1 — Loading raw OSM CSVs …")

buses_raw = pd.read_csv(os.path.join(DATA_DIR, "buses.csv"), index_col=0)
lines_raw = pd.read_csv(os.path.join(DATA_DIR, "lines.csv"), index_col=0, quotechar="'")
trafos_raw = pd.read_csv(os.path.join(DATA_DIR, "transformers.csv"), index_col=0, quotechar="'")

log.info(f"  Loaded: {len(buses_raw)} buses, {len(lines_raw)} lines, {len(trafos_raw)} transformers")


# ─── Step 2: Filter to France 400 kV AC ──────────────────────────────────────
log.info("Step 2 — Filtering to FR 400 kV AC …")

buses = buses_raw[
    (buses_raw["country"] == TARGET_COUNTRY) &
    (buses_raw["voltage"].isin(TARGET_VOLTAGES)) &
    (buses_raw["dc"] == "f") &
    (buses_raw["under_construction"] == "f")
].copy()

log.info(f"  FR 400 kV AC buses: {len(buses)}")

bus_ids = set(buses.index)

lines = lines_raw[
    lines_raw["bus0"].isin(bus_ids) &
    lines_raw["bus1"].isin(bus_ids) &
    (lines_raw["under_construction"] == "f")
].copy()

log.info(f"  Internal lines: {len(lines)}")

trafos = trafos_raw[
    trafos_raw["bus0"].isin(bus_ids) &
    trafos_raw["bus1"].isin(bus_ids)
].copy()

log.info(f"  Internal transformers: {len(trafos)}")


# ─── Step 3: Keep only the main connected component ───────────────────────────
log.info("Step 3 — Extracting main connected component …")

G = nx.Graph()
G.add_nodes_from(bus_ids)
for _, row in lines.iterrows():
    G.add_edge(row["bus0"], row["bus1"])
for _, row in trafos.iterrows():
    G.add_edge(row["bus0"], row["bus1"])

components  = list(nx.connected_components(G))
main_comp   = max(components, key=len)

log.info(f"  Components: {len(components)}, largest: {len(main_comp)} buses")

buses  = buses[buses.index.isin(main_comp)].copy()
lines  = lines[lines["bus0"].isin(main_comp) & lines["bus1"].isin(main_comp)].copy()
trafos = trafos[trafos["bus0"].isin(main_comp) & trafos["bus1"].isin(main_comp)].copy()

log.info(f"  After filtering → buses={len(buses)}, lines={len(lines)}, trafos={len(trafos)}")


# ─── Step 4: Build integer bus index ─────────────────────────────────────────
log.info("Step 4 — Building integer bus index …")

bus_list   = sorted(buses.index.tolist())
bus_to_int = {b: i + 1 for i, b in enumerate(bus_list)}    # 1-indexed (MATPOWER convention)


# ─── Step 5: Convert impedances to per-unit ───────────────────────────────────
# Impedances in the CSV are in Ohms (physical values).
# Z_base = V_base² / S_base  (V_base in kV, S_base in MVA → Z_base in Ω)
V_BASE = 400.0                      # kV
Z_BASE = (V_BASE ** 2) / BASE_MVA  # = 1600 Ω

log.info(f"  Z_base = {Z_BASE:.1f} Ω  (V_base={V_BASE} kV, S_base={BASE_MVA} MVA)")

lines_pu = lines.copy()
for _, row in lines.iterrows():
    circuits = max(1, int(row.get("circuits", 1)))
    idx      = row.name
    lines_pu.at[idx, "r"] = float(row["r"]) / Z_BASE / circuits
    lines_pu.at[idx, "x"] = float(row["x"]) / Z_BASE / circuits
    lines_pu.at[idx, "b"] = float(row["b"]) * Z_BASE * circuits
    if pd.notna(row.get("s_nom")):
        lines_pu.at[idx, "s_nom"] = float(row["s_nom"]) * circuits

# Add transformers as zero-resistance branches (same voltage level, just coupling)
trafo_rows = []
for tid, row in trafos.iterrows():
    trafo_rows.append({
        "bus0":  row["bus0"],
        "bus1":  row["bus1"],
        "r":     1e-4,
        "x":     0.01,
        "b":     0.0,
        "s_nom": float(row["s_nom"]) if pd.notna(row.get("s_nom")) else BASE_MVA,
    })

if trafo_rows:
    trafo_df = pd.DataFrame(trafo_rows, index=[f"trafo_{t}" for t in trafos.index])
    all_branches = pd.concat([lines_pu, trafo_df])
else:
    all_branches = lines_pu.copy()

log.info(f"  Total branches (lines + trafos): {len(all_branches)}")


# ─── Step 6: Write MATPOWER file ─────────────────────────────────────────────
log.info("Step 6 — Writing MATPOWER file …")

matpower_path = os.path.join(OUT_DIR, "network.m")
write_matpower(matpower_path, bus_list, bus_to_int, buses, all_branches)


# ─── Step 7: Write grid_layout.json ──────────────────────────────────────────
log.info("Step 7 — Writing grid_layout.json …")

layout = {}
for bus_id, row in buses.iterrows():
    # pypowsybl NAD expects: bus_id → [longitude, latitude]
    layout[bus_id] = [float(row["x"]), float(row["y"])]

layout_path = os.path.join(OUT_DIR, "grid_layout.json")
with open(layout_path, "w") as f:
    json.dump(layout, f, indent=2)

log.info(f"  Written: {layout_path}  ({len(layout)} bus entries)")


# ─── Step 8: Write network stats ─────────────────────────────────────────────
stats_path = os.path.join(OUT_DIR, "network_stats.txt")
with open(stats_path, "w") as f:
    f.write("PyPSA-Eur France 400 kV Network — Build Summary\n")
    f.write("=" * 52 + "\n\n")
    f.write("Source       : Zenodo 18619025 (PyPSA-Eur OSM)\n")
    f.write("Filter       : country=FR, voltage∈{380,400} kV, AC, not under construction\n")
    f.write(f"Base MVA     : {BASE_MVA}\n")
    f.write(f"Z_base       : {Z_BASE} Ω\n\n")
    f.write(f"Buses        : {len(buses)}\n")
    f.write(f"Lines        : {len(lines_pu)}\n")
    f.write(f"Transformers : {len(trafos)}\n")
    f.write(f"Total branches: {len(all_branches)}\n\n")
    f.write("Voltage distribution (buses):\n")
    for v, cnt in buses["voltage"].value_counts().sort_index().items():
        f.write(f"  {v} kV : {cnt} buses\n")
    f.write("\nGeographic extent (lon/lat):\n")
    f.write(f"  Longitude : {buses['x'].min():.3f}° … {buses['x'].max():.3f}°\n")
    f.write(f"  Latitude  : {buses['y'].min():.3f}° … {buses['y'].max():.3f}°\n")
    f.write("\nOutputs:\n")
    f.write(f"  {matpower_path}\n")
    f.write(f"  {layout_path}\n")
    f.write(f"  {stats_path}\n")

log.info(f"  Written: {stats_path}")
log.info("=" * 52)
log.info("Build complete ✓")
log.info(f"  Buses   : {len(buses)}")
log.info(f"  Lines   : {len(lines_pu)}")
log.info(f"  Trafos  : {len(trafos)}")
log.info(f"  Output  : {OUT_DIR}")
