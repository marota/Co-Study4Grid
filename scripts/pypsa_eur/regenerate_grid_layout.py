"""
regenerate_grid_layout.py
=========================
Standalone script to (re)generate grid_layout.json for any network variant
produced by convert_pypsa_to_xiidm.py.

Uses the same Web Mercator projection as Step 9 of the conversion pipeline,
but reads VL IDs from the XIIDM file to guarantee the keys match what
pypowsybl expects in ``fixed_positions``.

Coordinate scale (changed 2026-05-08):
    The default output is now **raw Mercator metres** (centred on the
    bounding-box midpoint, span ≈ 1.6 M units for the French grid). Earlier
    versions of this script rescaled every coordinate to a 8 000-unit
    target width, which was the root cause of the "voltage-level circles
    overlap their neighbours in dense urban regions" problem reported on
    fr225_400 — pypowsybl emits VL outer circles at a fixed
    ``r = 27.5`` user-space units regardless of layout scale, so a
    8 000-unit-wide diagram pushes the median nearest-neighbour distance
    down to ~26 units (= 0.95 × r), guaranteeing visual overlap. The
    operator-issued reference layout (RTE study format) renders cleanly
    at the same vlCount because its native span is ~1.6 M units, giving
    a median NN/r ratio of ~65×.

    Pass ``--target-width N`` to recreate the legacy rescaled output
    (e.g. ``--target-width 8000`` to reproduce pre-2026-05-08 files).
    The rescale path is preserved for callers that depend on the
    fixed bounding box.

Usage:
    # Default: raw Mercator metres (recommended)
    python scripts/pypsa_eur/regenerate_grid_layout.py --network data/pypsa_eur_fr225_400

    # Legacy: rescale to 8 000-unit width (NOT recommended for dense grids)
    python scripts/pypsa_eur/regenerate_grid_layout.py --network data/pypsa_eur_fr400 --target-width 8000

The script:
  1. Reads buses.csv (the raw OSM source) filtered to the voltages present
     in the target network.xiidm
  2. Extracts the actual VL IDs from the XIIDM to use as layout keys
  3. Maps each VL ID to its bus geographic coordinates (lon/lat from CSV)
  4. Projects to Web Mercator, optionally rescales (see ``--target-width``)
  5. Writes grid_layout.json with keys matching the network VL IDs
"""

import argparse
import json
import logging
import math
import os
import re
import xml.etree.ElementTree as ET

import pandas as pd

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ─── Parse arguments ─────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Regenerate grid_layout.json for a pypsa-eur network"
)
parser.add_argument(
    "--network",
    type=str,
    required=True,
    help="Path to the network data directory (e.g., data/pypsa_eur_fr225_400)",
)
parser.add_argument(
    "--target-width",
    type=float,
    default=None,
    help=(
        "Optional x-span in NAD coordinate space. Default (None) writes raw "
        "Mercator metres — recommended, matches the operator reference "
        "layout. Pass an explicit value (e.g. 8000) to reproduce the "
        "pre-2026-05-08 rescaled output. Note: any value below ~500 000 "
        "will produce visible VL-circle overlap on dense grids — see the "
        "module docstring for the math."
    ),
)
args = parser.parse_args()

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BASE_DIR = os.path.join(SCRIPT_DIR, "..", "..")
DATA_DIR = os.path.join(BASE_DIR, "data", "pypsa_eur_osm")
NETWORK_DIR = os.path.join(BASE_DIR, args.network) if not os.path.isabs(args.network) else args.network
XIIDM_PATH = os.path.join(NETWORK_DIR, "network.xiidm")

assert os.path.isfile(XIIDM_PATH), f"network.xiidm not found at {XIIDM_PATH}"
assert os.path.isfile(os.path.join(DATA_DIR, "buses.csv")), f"buses.csv not found at {DATA_DIR}"


def safe_id(raw: str) -> str:
    """Convert an OSM id to a valid IIDM identifier (same as convert script)."""
    return re.sub(r"[^A-Za-z0-9_\-\.]", "_", raw)


# ─── Step 1: Extract actual VL IDs from the XIIDM ────────────────────────────
log.info("Step 1 — Reading VL IDs from network.xiidm …")

tree = ET.parse(XIIDM_PATH)
root = tree.getroot()

# Handle XML namespace
ns = ""
if root.tag.startswith("{"):
    ns = root.tag.split("}")[0] + "}"

vl_ids_in_network = set()
for elem in root.iter():
    tag = elem.tag.replace(ns, "")
    if tag == "voltageLevel":
        vl_id = elem.get("id")
        if vl_id:
            vl_ids_in_network.add(vl_id)

log.info(f"  Found {len(vl_ids_in_network)} voltage levels in network")

# ─── Step 2: Load raw OSM buses and build VL→coords mapping ──────────────────
log.info("Step 2 — Loading buses.csv and building coordinate mapping …")

buses_raw = pd.read_csv(os.path.join(DATA_DIR, "buses.csv"), index_col=0)

# Build a mapping: VL_ID -> (lon, lat) for all buses whose VL_ID is in the network
vl_coords = {}
unmatched_vls = set(vl_ids_in_network)

for bus_id, row in buses_raw.iterrows():
    sid = safe_id(str(bus_id))
    vl_id = f"VL_{sid}"
    if vl_id in vl_ids_in_network:
        lon = float(row["x"])
        lat = float(row["y"])
        vl_coords[vl_id] = (lon, lat)
        unmatched_vls.discard(vl_id)

log.info(f"  Matched {len(vl_coords)} / {len(vl_ids_in_network)} VLs to bus coordinates")
if unmatched_vls:
    log.warning(f"  {len(unmatched_vls)} VLs in network have no matching bus in CSV:")
    for vl in sorted(unmatched_vls)[:10]:
        log.warning(f"    {vl}")
    if len(unmatched_vls) > 10:
        log.warning(f"    ... and {len(unmatched_vls) - 10} more")

# ─── Step 3: Mercator projection (identical to convert_pypsa_to_xiidm Step 9) ─
log.info("Step 3 — Projecting to Web Mercator …")

EARTH_RADIUS = 6_378_137.0  # WGS-84 semi-major axis (metres)
TARGET_WIDTH = args.target_width


def _lon_lat_to_mercator(lon, lat):
    x = math.radians(lon) * EARTH_RADIUS
    y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * EARTH_RADIUS
    return x, y


# First pass: project all points and collect bounds
raw_positions = {}
for vl_id, (lon, lat) in vl_coords.items():
    mx, my = _lon_lat_to_mercator(lon, lat)
    raw_positions[vl_id] = (mx, -my)  # negate Y for screen coords (north up)

raw_xs = [v[0] for v in raw_positions.values()]
raw_ys = [v[1] for v in raw_positions.values()]
p_cx = (min(raw_xs) + max(raw_xs)) / 2
p_cy = (min(raw_ys) + max(raw_ys)) / 2
p_xrange = max(raw_xs) - min(raw_xs) or 1.0

# Either keep the raw Mercator metres (default) or rescale to a fixed
# user-supplied width. Both branches center the bounding-box midpoint at
# the origin so pypowsybl's NAD viewBox lands somewhere reasonable.
#
# The rescale branch is preserved for backward compatibility but should
# generally NOT be used: any target width below ~500 000 user-units
# produces VL-circle overlap on dense grids because pypowsybl emits the
# outer circle at fixed r = 27.5 user-units. See the module docstring.
if TARGET_WIDTH is None:
    log.info(
        "  Writing raw Mercator metres (no rescale). Span will be ~%.1f km on x.",
        p_xrange / 1000.0,
    )
    layout = {}
    for vl_id, (rx, ry) in raw_positions.items():
        nx = rx - p_cx
        ny = ry - p_cy
        layout[vl_id] = [round(nx, 2), round(ny, 2)]
else:
    log.info("  Rescaling to TARGET_WIDTH=%.1f user-units.", TARGET_WIDTH)
    if TARGET_WIDTH < 500_000:
        log.warning(
            "  TARGET_WIDTH=%.0f is below the readability threshold (~500 000). "
            "Expect VL-circle overlap on dense regions — pypowsybl emits the "
            "VL outer circle at fixed r=27.5 user-units, so the median "
            "nearest-neighbour distance would land at ~%.1f units (≈ %.2f × r).",
            TARGET_WIDTH, TARGET_WIDTH / 60.0, TARGET_WIDTH / 60.0 / 27.5,
        )
    scale = TARGET_WIDTH / p_xrange
    layout = {}
    for vl_id, (rx, ry) in raw_positions.items():
        nx = (rx - p_cx) * scale
        ny = (ry - p_cy) * scale
        layout[vl_id] = [round(nx, 2), round(ny, 2)]

# ─── Step 4: Write grid_layout.json ──────────────────────────────────────────
layout_path = os.path.join(NETWORK_DIR, "grid_layout.json")
with open(layout_path, "w") as f:
    json.dump(layout, f, indent=2)

log.info(f"  Written: {layout_path}  ({len(layout)} entries)")

# ─── Verification ────────────────────────────────────────────────────────────
xs = [v[0] for v in layout.values()]
ys = [v[1] for v in layout.values()]
x_span = max(xs) - min(xs)
y_span = max(ys) - min(ys)
log.info(f"  Coordinate ranges: X=[{min(xs):.1f}, {max(xs):.1f}], Y=[{min(ys):.1f}, {max(ys):.1f}]")
log.info(f"  X span: {x_span:.1f}, Y span: {y_span:.1f}")

# Quick spacing-vs-pypowsybl-radius sanity check. pypowsybl emits each VL
# outer circle at fixed r = 27.5 user-units, so the median NN/r ratio is
# the single best predictor of how cluttered Paris/Lyon will look.
import statistics  # noqa: E402  (kept local — only used here)
pts = list(layout.values())
nn = []
sample = pts[::max(1, len(pts) // 1000)]  # cap at ~1000 for speed
for a in sample:
    best = float("inf")
    for b in pts:
        if a is b:
            continue
        dd = math.hypot(a[0] - b[0], a[1] - b[1])
        if 0 < dd < best:
            best = dd
    if best < float("inf"):
        nn.append(best)
if nn:
    nn.sort()
    median_nn = nn[len(nn) // 2]
    PYPOWSYBL_R = 27.5
    ratio = median_nn / PYPOWSYBL_R
    log.info(
        "  Median nearest-neighbour distance: %.1f units → %.1f × pypowsybl r "
        "(operator-style reference is ~65×; below ~10× starts to look cramped).",
        median_nn, ratio,
    )

# Cross-check: verify all layout keys are valid VL IDs
invalid_keys = set(layout.keys()) - vl_ids_in_network
if invalid_keys:
    log.error(f"  BUG: {len(invalid_keys)} layout keys are NOT valid VL IDs!")
else:
    log.info(f"  ✓ All {len(layout)} layout keys match network VL IDs")

missing_vls = vl_ids_in_network - set(layout.keys())
if missing_vls:
    log.warning(f"  {len(missing_vls)} VLs in network have no layout entry (will get random positions)")
else:
    log.info(f"  ✓ All {len(vl_ids_in_network)} network VLs have layout entries")
