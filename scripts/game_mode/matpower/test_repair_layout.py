# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Tests for repair_layout.py — the geographic-layout repair of the France EHV
(Matpower) game grids.

Two halves:

* unit tests of the anchor policy and the relaxation, on synthetic graphs;
* a regression guard on the COMMITTED layouts, which is what actually keeps the
  map neat: it re-derives the quality statistics from the shipped network +
  layout and holds them to the France THT reference the repair was calibrated
  against.

Stdlib only except the relaxation itself (numpy / scipy), which skips when they
are absent. Tests reading committed data skip when the family is not built.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
GRIDS = REPO / "data" / "rte_matpower" / "grids"

#: The largest committed case — the fullest picture of the family's topology.
REFERENCE_GRID = "grid_6be3a179"

#: Ceilings taken from the France THT reference grid (grid_5384e039), whose map
#: the repair is meant to be comparable with: neighbour offsets there run
#: p90 = 15.0 km, p99 = 30.0 km, max = 45.1 km. The Matpower family keeps a
#: residual tail from contradicted identities upstream still owns, so p99 and
#: max get headroom; p90 — the shape of the bulk — must be at least as tight.
MAX_NEIGHBOUR_OFFSET_P90_KM = 15.0
MAX_NEIGHBOUR_OFFSET_P99_KM = 45.0

#: Share of branches allowed to exceed LONG_BRANCH_KM. The raw reconstruction
#: shipped 2.9 % (265 / 8 988); the repair brings it to 0.9 %.
MAX_LONG_BRANCH_SHARE = 0.012

#: `grid_layout.json` must stay in raw Mercator metres — pypowsybl draws VL
#: circles at a fixed r = 27.5 user units, so a layout squashed below ~500 000
#: units forces overlap on dense regions. See
#: docs/data/grid-layout-coordinate-scale.md.
MIN_LAYOUT_SPAN_UNITS = 500_000


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


R = _load("repair_layout")

built = pytest.mark.skipif(
    not (GRIDS / REFERENCE_GRID / "grid_layout.json").is_file(),
    reason="France EHV (Matpower) family not built in this checkout",
)


def _grid_dirs():
    return sorted(d for d in GRIDS.iterdir() if d.is_dir()) if GRIDS.is_dir() else []


# ---------------------------------------------------------------- anchor policy

def test_identity_ids_maps_bus_numbers_to_voltage_levels():
    layout = {"VL-1": [0, 0], "VL-2": [1, 1], "VL-9": [2, 2]}
    smap = {"1": {"substation": "A", "confidence": "strict"},
            "2": {"substation": "B", "confidence": "loose"},
            "7": {"substation": "C", "confidence": "strict"}}  # no such VL
    assert R.identity_ids(smap, layout) == {"VL-1": "strict", "VL-2": "loose"}


def test_neighbour_offsets_uses_the_median_of_the_neighbours():
    # VL-C sits 100 units from where its two neighbours say it should.
    pos = {"VL-A": (0.0, 0.0), "VL-B": (0.0, 0.0), "VL-C": (100.0, 0.0)}
    offsets = R.neighbour_offsets(pos, [("VL-A", "VL-C"), ("VL-B", "VL-C")])
    assert offsets["VL-C"] == pytest.approx(100.0 * R.KM_PER_UNIT)


def test_select_anchors_releases_only_contradicted_loose_identities():
    far = R.MAX_IDENTITY_OFFSET_KM * 2 / R.KM_PER_UNIT
    pos = {
        "VL-1": (0.0, 0.0), "VL-2": (0.0, 0.0),      # neighbourhood
        "VL-3": (far, 0.0),                           # loose, contradicted
        "VL-4": (far, 0.0),                           # strict, contradicted
        "VL-5": (10.0, 0.0),                          # loose, consistent
    }
    pairs = [("VL-1", "VL-3"), ("VL-2", "VL-3"),
             ("VL-1", "VL-4"), ("VL-2", "VL-4"),
             ("VL-1", "VL-5"), ("VL-2", "VL-5")]
    identities = {"VL-3": "loose", "VL-4": "strict", "VL-5": "loose"}
    anchors, released = R.select_anchors(pos, pairs, identities)
    assert released == {"VL-3"}, "only a loose identity the topology contradicts"
    assert anchors == {"VL-4", "VL-5"}


# ------------------------------------------------------------------ relaxation

def test_relax_pulls_a_free_voltage_level_toward_its_anchors_without_moving_them():
    pytest.importorskip("scipy")
    # VL-M hangs between two anchors but was dumped far off to the side.
    layout = {"VL-A": [0.0, 0.0], "VL-B": [100.0, 0.0], "VL-M": [50.0, 900.0]}
    pos = R.relax(layout, [("VL-A", "VL-M"), ("VL-B", "VL-M")], {"VL-A", "VL-B"})
    assert pos["VL-A"] == (0.0, 0.0)
    assert pos["VL-B"] == (100.0, 0.0)
    assert 0.0 < pos["VL-M"][1] < 900.0, "pulled toward the anchors, not onto them"
    assert pos["VL-M"][0] == pytest.approx(50.0), "no sideways drift on a symmetric pair"


def test_relax_leaves_a_layout_that_already_agrees_with_its_graph_alone():
    pytest.importorskip("scipy")
    layout = {"VL-A": [0.0, 0.0], "VL-B": [100.0, 0.0], "VL-M": [50.0, 0.0]}
    pos = R.relax(layout, [("VL-A", "VL-M"), ("VL-B", "VL-M")], {"VL-A", "VL-B"})
    assert pos["VL-M"][0] == pytest.approx(50.0)
    assert pos["VL-M"][1] == pytest.approx(0.0)


def _chain_needing_two_rounds():
    """A(strict) - B(loose) - C(loose), with B and C dumped on the same far spot.

    B is contradicted immediately (its anchored neighbour A is ``far`` away).
    C is NOT: it sits exactly on its only neighbour B. Only once B has relaxed
    home does C's position become contradicted — which is why one pass is not
    enough on the real grids either.
    """
    far = R.MAX_IDENTITY_OFFSET_KM * 4 / R.KM_PER_UNIT
    return (
        {"VL-1": [0.0, 0.0], "VL-2": [far, 0.0], "VL-3": [far, 0.0]},
        [("VL-1", "VL-2"), ("VL-2", "VL-3")],
        {"VL-1": "strict", "VL-2": "loose", "VL-3": "loose"},
    )


def test_repair_positions_keeps_releasing_while_the_relaxed_picture_contradicts():
    pytest.importorskip("scipy")
    layout, pairs, identities = _chain_needing_two_rounds()
    _, anchors, released = R.repair_positions(layout, pairs, identities)
    assert released == {"VL-2", "VL-3"}
    assert anchors == {"VL-1"}


def test_repair_positions_respects_the_round_cap():
    pytest.importorskip("scipy")
    layout, pairs, identities = _chain_needing_two_rounds()
    _, _, released = R.repair_positions(layout, pairs, identities, max_rounds=0)
    # Only the first, pre-relaxation pass ran — C is still anchored.
    assert released == {"VL-2"}


# ------------------------------------------------- committed-data regression guard

@built
def test_every_committed_grid_records_the_repair_it_carries():
    """Each layout must hash to its provenance record.

    The relaxation is anchored on the layout it reads, so a re-run over its own
    output would drift. The provenance hash is what makes the tool idempotent —
    if it goes stale, the next run silently deforms the map.
    """
    for grid_dir in _grid_dirs():
        provenance_path = grid_dir / "layout_repair.json"
        assert provenance_path.is_file(), f"{grid_dir.name} has no layout_repair.json"
        provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
        digest = hashlib.sha256(
            (grid_dir / "grid_layout.json").read_bytes()).hexdigest()
        assert provenance["output_sha256"] == digest, (
            f"{grid_dir.name}: grid_layout.json changed without re-recording the "
            f"repair — re-run scripts/game_mode/matpower/repair_layout.py")


@built
def test_committed_layouts_stay_in_raw_mercator_metres_without_collisions():
    for grid_dir in _grid_dirs():
        layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
        xs = [c[0] for c in layout.values()]
        ys = [c[1] for c in layout.values()]
        assert max(xs) - min(xs) > MIN_LAYOUT_SPAN_UNITS, grid_dir.name
        assert max(ys) - min(ys) > MIN_LAYOUT_SPAN_UNITS, grid_dir.name
        coords = {(round(c[0], 3), round(c[1], 3)) for c in layout.values()}
        assert len(coords) == len(layout), (
            f"{grid_dir.name}: voltage levels share a position — their circles "
            f"would render on top of each other")


@built
def test_the_committed_reference_layout_is_as_neat_as_the_france_tht_map():
    """The statistics that made the raw map a hairball, held to the THT bar."""
    grid_dir = GRIDS / REFERENCE_GRID
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
    pos = {k: (v[0], v[1]) for k, v in layout.items()}
    pairs, _ = R.parse_topology(R.load_network_xml(grid_dir))

    offsets = R.neighbourhood_offset_stats(pos, pairs)
    assert offsets["p90"] <= MAX_NEIGHBOUR_OFFSET_P90_KM
    assert offsets["p99"] <= MAX_NEIGHBOUR_OFFSET_P99_KM

    branches = R.branch_length_stats(pos, pairs)
    share = branches["over_100km"] / branches["n"]
    assert share <= MAX_LONG_BRANCH_SHARE, (
        f"{share:.1%} of branches exceed {R.LONG_BRANCH_KM:.0f} km — the raw "
        f"reconstruction shipped 2.9 %, the repair brings it to ~0.9 %")


@built
def test_the_repair_keeps_the_voltage_levels_and_most_of_their_identities():
    grid_dir = GRIDS / REFERENCE_GRID
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
    smap = json.loads((grid_dir / "rte_substation_map.json").read_text(encoding="utf-8"))
    provenance = json.loads((grid_dir / "layout_repair.json").read_text(encoding="utf-8"))

    identities = R.identity_ids(smap, layout)
    released = set(provenance["released_identities"])
    assert released < set(identities), "released set must be a strict subset"
    assert len(released) / len(identities) < 0.2, (
        "the repair should contradict a small minority of the claimed RTE "
        "identities, not overturn the reconstruction")
    # Every position an upstream `strict` match claims is kept exactly.
    assert not [vl for vl in released if identities[vl] == "strict"]
