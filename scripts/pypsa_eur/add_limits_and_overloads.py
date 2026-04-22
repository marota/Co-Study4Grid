"""
add_limits_and_overloads.py
===========================
Post-processes the FR 400kV XIIDM network to:
1. Create a realistic geographic load/generation pattern (SE gen → NW loads)
2. Add operational limits (current ratings)
3. Tune limits on corridor lines so N-1 contingencies produce >100% overloads
4. Save updated XIIDM

Usage:
    python scripts/pypsa_eur/add_limits_and_overloads.py --network-dir data/pypsa_eur_fr225_400
"""

import os, json, argparse
import pandas as pd
import numpy as np
import pypowsybl as pp
from pypowsybl.loadflow import Parameters

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.dirname(os.path.dirname(SCRIPT_DIR))

# --- Parse command-line arguments ---
parser = argparse.ArgumentParser(
    description="Add operational limits and overload scenario"
)
parser.add_argument(
    "--network-dir",
    default=os.path.join(BASE_DIR, "data", "pypsa_eur_fr225_400"),
    help="Directory containing the network.xiidm file (absolute, or relative to repo root)",
)
parser.add_argument(
    "--voltages",
    type=str,
    default="225,380,400",
    help="Target voltage levels (comma-separated)",
)
parser.add_argument(
    "--output-dir", default=None, help="Output directory for the updated network"
)
args = parser.parse_args()

TARGET_VOLTAGES = [float(v.strip()) for v in args.voltages.split(",")]

# OUT_DIR should be the directory containing the network, not the full path
if args.output_dir:
    OUT_DIR = args.output_dir
elif os.path.isfile(args.network_dir):
    # If network_dir is a file, use its parent directory
    OUT_DIR = os.path.dirname(args.network_dir)
else:
    OUT_DIR = args.network_dir

# --- Derived constants based on voltage levels ---
DEFAULT_I_NOM_400 = 2580.0  # Amperes (OSM rating for 400kV)
DEFAULT_I_NOM_380 = 2580.0  # Amperes (OSM rating for 380kV)
DEFAULT_I_NOM_225 = 3150.0  # Amperes (OSM rating for 225kV)

# Determine default I_nom based on target voltages
if 400 in TARGET_VOLTAGES or 380 in TARGET_VOLTAGES:
    DEFAULT_I_NOM = DEFAULT_I_NOM_400
else:
    DEFAULT_I_NOM = DEFAULT_I_NOM_225

print(f"Target voltage levels: {TARGET_VOLTAGES} kV")
print(f"Default I_nom: {DEFAULT_I_NOM} A")

# --- Step 1: Load existing XIIDM network directly ---
print("=== Step 1: Loading existing XIIDM network ===")
network_dir = args.network_dir if os.path.isabs(args.network_dir) else os.path.join(BASE_DIR, args.network_dir)
network_path = network_dir if os.path.isfile(network_dir) else os.path.join(network_dir, "network.xiidm")
n = pp.network.load(network_path)

print(f"\nLoaded network from {network_path}")
print(f"Network: {len(n.get_buses())} buses, {len(n.get_lines())} lines")

# --- Step 2: Set up concentrated load/generation pattern ---
print("\n=== Step 2: Setting up geographic load pattern ===")

# Try to load grid_layout from the network directory or fallback to 400kV version
network_dir = os.path.dirname(network_path)
layout_candidates = [
    os.path.join(network_dir, "grid_layout.json"),
    os.path.join(BASE_DIR, "data/pypsa_eur_fr400/grid_layout.json"),
]

layout = None
for layout_path in layout_candidates:
    if os.path.exists(layout_path):
        with open(layout_path) as f:
            layout = json.load(f)
        print(f"  Loaded grid_layout from {layout_path}")
        break

if layout is None:
    raise FileNotFoundError("No grid_layout.json found")

buses_df = n.get_buses()
gens_df = n.get_generators()
loads_df = n.get_loads()

# Map buses to geographic positions (layout already contains VL_..._0 format)
bus_positions = {}
for idx in buses_df.index:
    if idx in layout:
        bus_positions[idx] = {"lon": layout[idx][0], "lat": layout[idx][1]}

print(f"  Mapped {len(bus_positions)} buses to positions")
if len(bus_positions) == 0:
    raise ValueError("No buses mapped from layout! Check grid_layout.json format.")

all_lons = [v["lon"] for v in bus_positions.values()]
all_lats = [v["lat"] for v in bus_positions.values()]
med_lon = np.median(all_lons)
med_lat = np.median(all_lats)
lon_range = max(all_lons) - min(all_lons)
lat_range = max(all_lats) - min(all_lats)
print(f"  Centroid: lon={med_lon:.2f}, lat={med_lat:.2f}")
print(f"  Range: lon={lon_range:.2f}, lat={lat_range:.2f}")

# Generation: heavy in south-east France (nuclear plants near Rhône valley)
# Load: heavy in north-west France (Paris region, Brittany)
gen_updates = []
for gen_id, row in gens_df.iterrows():
    vl_id = row["voltage_level_id"]
    bus_id = f"{vl_id}_0"

    if bus_id in bus_positions:
        pos = bus_positions[bus_id]
        # Normalize to [-1, 1] range
        lon_norm = (pos["lon"] - med_lon) / (lon_range / 2) if lon_range > 0 else 0
        lat_norm = (pos["lat"] - med_lat) / (lat_range / 2) if lat_range > 0 else 0
        # SE = positive lon_norm, negative lat_norm → high generation
        se_score = lon_norm - lat_norm  # ranges roughly -2 to 2
        p = max(5.0, 40.0 + se_score * 25.0)
    else:
        p = 10.0
    gen_updates.append({"id": gen_id, "target_p": p})

gen_update_df = pd.DataFrame(gen_updates).set_index("id")
n.update_generators(gen_update_df)
total_gen = sum(g["target_p"] for g in gen_updates)
print(f"  Total generation: {total_gen:.0f} MW")

# Loads: heavy in north-west
load_updates = []
for load_id, row in loads_df.iterrows():
    vl_id = row["voltage_level_id"]
    bus_id = f"{vl_id}_0"

    if bus_id in bus_positions:
        pos = bus_positions[bus_id]
        lon_norm = (pos["lon"] - med_lon) / (lon_range / 2) if lon_range > 0 else 0
        lat_norm = (pos["lat"] - med_lat) / (lat_range / 2) if lat_range > 0 else 0
        # NW = negative lon_norm, positive lat_norm → high load
        nw_score = -lon_norm + lat_norm
        p = max(2.0, 25.0 + nw_score * 15.0)
    else:
        p = 5.0
    load_updates.append({"id": load_id, "p0": p, "q0": p * 0.1})

load_update_df = pd.DataFrame(load_updates).set_index("id")
n.update_loads(load_update_df)
total_load = sum(l["p0"] for l in load_updates)
print(f"  Total load: {total_load:.0f} MW")

# --- Step 3: Run AC loadflow ---
print("\n=== Step 3: AC loadflow ===")
result = pp.loadflow.run_ac(n, Parameters(distributed_slack=True))
status = str(result[0].status)
print(f"  Status: {status}")

if "CONVERGED" not in status:
    print("  Trying with different params...")
    result = pp.loadflow.run_ac(n, Parameters(distributed_slack=False))
    status = str(result[0].status)
    print(f"  Status (no dist slack): {status}")

assert "CONVERGED" in status, f"AC loadflow failed: {status}"

# --- Step 4: Analyze flows and set limits ---
print("\n=== Step 4: Analyzing flows and setting limits ===")

lines_after = n.get_lines()

# Compute current on each line (need to get voltage from VL)
vl_df = (
    n.get_voltage_levels()
)  # DataFrame with index=VL_id, columns include 'nominal_v'

line_flows = []
for lid, row in lines_after.iterrows():
    p1 = abs(row.get("p1", 0))
    q1 = abs(row.get("q1", 0))
    s = np.sqrt(p1**2 + q1**2)  # MVA

    # Get voltage from voltage level DataFrame (use first side as proxy for both sides in same VL)
    vl_id = row["voltage_level1_id"]
    v_nom = vl_df.loc[vl_id, "nominal_v"] if vl_id in vl_df.index else 400.0

    i_a = s * 1000 / (np.sqrt(3) * v_nom)  # Amperes, v_nom in [400, 380, 225]
    line_flows.append({"id": lid, "p1": p1, "q1": q1, "s_mva": s, "i_a": i_a})

flow_df = pd.DataFrame(line_flows).set_index("id")
flow_df = flow_df.sort_values("i_a", ascending=False)

print(f"\n  Top 20 loaded lines:")
for i, (lid, row) in enumerate(flow_df.head(20).iterrows()):
    print(
        f"    {i + 1:2d}. {lid[:55]:55s}  I={row['i_a']:.1f} A  S={row['s_mva']:.1f} MVA"
    )

max_i = flow_df["i_a"].max()
print(f"\n  Max current: {max_i:.1f} A")

# Find parallel line groups (lines sharing the same two voltage levels)
line_endpoints = {}
for lid, row in lines_after.iterrows():
    vl1 = row["voltage_level1_id"]
    vl2 = row["voltage_level2_id"]
    key = tuple(sorted([vl1, vl2]))
    if key not in line_endpoints:
        line_endpoints[key] = []
    line_endpoints[key].append(lid)

parallel_groups = {k: v for k, v in line_endpoints.items() if len(v) >= 2}
print(f"\n  Parallel line groups: {len(parallel_groups)}")

# For parallel pairs, when one trips, the other takes all the current
# So if a pair has lines with I_a each, after trip the remaining sees ~2*I_a
# We want limit = ~1.5*I_a so that 2*I_a / 1.5*I_a ≈ 133% → overload!

DEFAULT_I_NOM = 2580.0  # Amperes (OSM rating for 400kV)
DEFAULT_I_NOM_225 = 3150.0  # Amperes (OSM rating for 225kV)

# Strategy: set limits on parallel corridor lines such that:
# - N-state loading ≈ 80-90%
# - N-1 (parallel trip) pushes to >100%
#
# For a pair with currents I1, I2:
#   After tripping line 1, line 2 sees approx I1+I2
#   Set limit = (I1+I2) / 1.05 → loading after trip ≈ 105%

limit_map = {}  # lid -> limit value in A

for key, group_lines in parallel_groups.items():
    # Get total current through this corridor
    group_currents = [
        (lid, flow_df.loc[lid, "i_a"]) for lid in group_lines if lid in flow_df.index
    ]
    if not group_currents:
        continue

    total_corridor_i = sum(i for _, i in group_currents)

    if total_corridor_i < 20:  # Skip trivially loaded corridors
        continue

    n_lines = len(group_currents)

    # After tripping one line, remaining (n-1) lines share the total current
    # Post-trip current per line ≈ total_corridor_i / (n-1)
    if n_lines >= 2:
        post_trip_i = total_corridor_i / (n_lines - 1)
        # Set limit so post-trip loading = 105-115%
        # limit = post_trip_i / target_overload
        target_overload = 1.08  # 108% → clear overload
        limit = post_trip_i / target_overload

        # Don't set limit below the N-state current (would be overloaded in N-state)
        max_line_i = max(i for _, i in group_currents)
        if limit < max_line_i * 1.05:
            # Ensure N-state is not overloaded: limit must be > max_line_i
            limit = max_line_i * 1.05  # 5% margin in N-state

        for lid, _ in group_currents:
            limit_map[lid] = limit

print(f"\n  Lines with custom limits: {len(limit_map)}")

# Build limit entries (use VL nominal voltage from vl_df)
limit_entries = []
for lid in lines_after.index:
    # Get voltage from first side's VL
    vl_id = lines_after.loc[lid, "voltage_level1_id"]
    v_nom = vl_df.loc[vl_id, "nominal_v"] if vl_id in vl_df.index else 400.0

    limit_value = limit_map.get(
        lid, DEFAULT_I_NOM if v_nom >= 380 else DEFAULT_I_NOM_225
    )

    for side in ["ONE", "TWO"]:
        limit_entries.append(
            {
                "element_id": lid,
                "name": f"permanent_limit_{side.lower()}",
                "side": side,
                "type": "CURRENT",
                "value": limit_value,
                "acceptable_duration": -1,
                "fictitious": False,
            }
        )

limits_df = pd.DataFrame(limit_entries).set_index("element_id")
n.create_operational_limits(limits_df)
print(f"  Created {len(limit_entries)} operational limit entries")

# Show expected loading for parallel corridors
print(f"\n  Expected N-state and N-1 loading for corridor lines:")
shown = 0
for key, group_lines in sorted(
    parallel_groups.items(),
    key=lambda x: sum(flow_df.loc[l, "i_a"] for l in x[1] if l in flow_df.index),
    reverse=True,
):
    group_currents = [
        (lid, flow_df.loc[lid, "i_a"]) for lid in group_lines if lid in flow_df.index
    ]
    if not group_currents or all(i < 20 for _, i in group_currents):
        continue

    total_i = sum(i for _, i in group_currents)
    # Get voltage from first line's VL
    first_lid = group_currents[0][0]
    vl_id_first = lines_after.loc[first_lid, "voltage_level1_id"]
    v_nom_first = (
        vl_df.loc[vl_id_first, "nominal_v"] if vl_id_first in vl_df.index else 400.0
    )

    for lid, i_a in group_currents:
        vl_id = lines_after.loc[lid, "voltage_level1_id"]
        v_nom = vl_df.loc[vl_id, "nominal_v"] if vl_id in vl_df.index else 400.0
        lim = limit_map.get(lid, DEFAULT_I_NOM if v_nom >= 380 else DEFAULT_I_NOM_225)
        n_loading = (i_a / lim) * 100
        # After tripping one parallel line
        post_trip = (
            total_i / (len(group_currents) - 1) if len(group_currents) > 1 else total_i
        )
        n1_loading = (post_trip / lim) * 100
        print(
            f"    {lid[:50]:50s}  N={n_loading:.0f}%  N-1={n1_loading:.0f}%  (limit={lim:.0f}A)"
        )
    shown += 1
    if shown >= 8:
        break

# --- Step 5: Save updated XIIDM ---
print("\n=== Step 5: Saving XIIDM ===")
xiidm_path = os.path.join(OUT_DIR, "network.xiidm")
n.dump(xiidm_path, format="XIIDM")
size_kb = os.path.getsize(xiidm_path) / 1024
print(f"  Saved: {xiidm_path} ({size_kb:.1f} KB)")

# --- Step 6: N-1 verification ---
print("\n=== Step 6: N-1 Overload Verification ===")

overload_contingencies = []
tested = 0

for key, group_lines in parallel_groups.items():
    group_currents = [
        (lid, flow_df.loc[lid, "i_a"]) for lid in group_lines if lid in flow_df.index
    ]
    if not group_currents or all(i < 20 for _, i in group_currents):
        continue

    for tripped_line in group_lines:
        tested += 1
        n_test = pp.network.load(xiidm_path)

        # Disconnect
        n_test.update_lines(
            pd.DataFrame(
                {"connected1": [False], "connected2": [False]}, index=[tripped_line]
            )
        )

        # AC loadflow
        res = pp.loadflow.run_ac(n_test, Parameters(distributed_slack=True))
        if "CONVERGED" not in str(res[0].status):
            res = pp.loadflow.run_dc(n_test, Parameters(distributed_slack=True))
            if "CONVERGED" not in str(res[0].status):
                print(f"  SKIP {tripped_line[:40]} — loadflow failed")
                continue

        # Check loading
        lines_n1 = n_test.get_lines()
        max_loading = 0
        max_line = ""
        overloaded_lines = []

        for lid2, row2 in lines_n1.iterrows():
            if lid2 == tripped_line:
                continue
            if not row2.get("connected1", True) or not row2.get("connected2", True):
                continue

            p1 = abs(row2.get("p1", 0))
            q1 = abs(row2.get("q1", 0))
            s = np.sqrt(p1**2 + q1**2)

            # Get voltage from VL (use first side as proxy)
            vl_id = row2["voltage_level1_id"]
            v_nom = vl_df.loc[vl_id, "nominal_v"] if vl_id in vl_df.index else 400.0

            i_a = s * 1000 / (np.sqrt(3) * v_nom)

            lim = limit_map.get(
                lid2, DEFAULT_I_NOM if v_nom >= 380 else DEFAULT_I_NOM_225
            )
            loading = (i_a / lim) * 100

            if loading > max_loading:
                max_loading = loading
                max_line = lid2
            if loading > 100:
                overloaded_lines.append((lid2, loading))

        if max_loading > 80:
            tag = "OVERLOAD!" if max_loading > 100 else "stressed"
            print(
                f"  N-1 {tripped_line[:45]:45s} → max={max_loading:.1f}% [{tag}] overloaded={len(overloaded_lines)}"
            )
            if overloaded_lines:
                overload_contingencies.append(
                    {
                        "tripped": tripped_line,
                        "max_loading": max_loading,
                        "overloaded": len(overloaded_lines),
                    }
                )

print(f"\n  Tested {tested} contingencies")
print(f"  Contingencies with >100% overload: {len(overload_contingencies)}")

if overload_contingencies:
    print("\n  ✓ OVERLOADS FOUND — Network is ready for N-1 contingency analysis!")
    for oc in overload_contingencies[:5]:
        print(
            f"    Trip {oc['tripped'][:50]:50s} → {oc['max_loading']:.1f}% ({oc['overloaded']} overloaded lines)"
        )
else:
    print("\n  ✗ No >100% overloads — further tuning needed")
