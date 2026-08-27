# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Tests for the v3 layout repair of the France EHV (Matpower) game grids.

Three layers:

* unit tests of the relaxation, the identity vetting and the 225 kV machinery
  on synthetic fixtures;
* THT-reference plumbing (substation nesting, poste graph, whitespace);
* a regression guard on the COMMITTED layouts — the statistics that keep the
  map neat, held to the France THT reference the repair is calibrated against.

Stdlib only except numpy/scipy (skipped when absent). Tests reading committed
data skip when the family is not built.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import statistics
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
GRIDS = REPO / "data" / "rte_matpower" / "grids"

#: The largest committed case — the fullest picture of the family's topology.
REFERENCE_GRID = "grid_6be3a179"

#: The named France THT snapshot `geo.py` matched the cases against. It is the
#: ground truth for both the coordinate frame and the real substation structure.
THT_GRID = REPO / "data" / "rte7000_tht" / "grids" / "grid_5384e039"

#: Every KEPT identity sits within ~6 km of its claimed poste as reconstructed
#: (the deliberate jitter that keeps a substation's several voltage levels
#: apart) and the repair must not move it. 12 km leaves room for a rebuild
#: without letting a broken frame or a shifted mapping through.
MAX_IDENTITY_TO_POSTE_KM = 12.0

#: Ceilings for the committed reference grid. Calibration: the France THT
#: reference's own neighbour-offset p90 is 15.0 km — the v3 repair lands at
#: ~18 km because snapping 225 kV nodes onto their real sites while some of
#: their 380 kV parents are unclaimed leaves honest local tension (the v1
#: repair's 12.2 km was SMOOTHER than reality — everything had collapsed onto
#: the 380 backbone, which is exactly what the operator flagged).
MAX_NEIGHBOUR_OFFSET_P90_KM = 20.0
MAX_NEIGHBOUR_OFFSET_P99_KM = 50.0
MAX_LONG_BRANCH_SHARE = 0.010        # shipped: 60-67 of ~8950 (0.7%); raw: 3.0%
MAX_OVER_200KM_BRANCHES = 4          # shipped: 2; raw: 51-57
#: 225 kV point-cloud fidelity vs the real THT 225 kV network. The raw layouts
#: had coverage p50 ~14.5 km (worse than a uniform random scatter — the
#: stacking defect); v1 shipped ~13. v3 restores it to ~4.5.
MAX_225_COVERAGE_P50_KM = 6.0
MIN_225_COVERAGE_WITHIN_10KM_PCT = 80.0
MAX_225_FORWARD_P50_KM = 6.0

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
both_built = pytest.mark.skipif(
    not (GRIDS / REFERENCE_GRID / "grid_layout.json").is_file()
    or not (THT_GRID / "grid_layout.json").is_file(),
    reason="the Matpower family or the France THT reference is not built here",
)


def _grid_dirs():
    return sorted(d for d in GRIDS.iterdir() if d.is_dir()) if GRIDS.is_dir() else []


@pytest.fixture(scope="module")
def tht():
    pytest.importorskip("scipy")
    import sys
    sys.path.insert(0, str(HERE))
    from tht_reference import load_tht_reference
    if not (THT_GRID / "grid_layout.json").is_file():
        pytest.skip("THT reference not built")
    return load_tht_reference()


# ---------------------------------------------------------------- basic pieces

def test_identity_ids_maps_bus_numbers_to_voltage_levels():
    layout = {"VL-1": [0, 0], "VL-2": [1, 1], "VL-9": [2, 2]}
    smap = {"1": {"substation": "A", "confidence": "strict"},
            "2": {"substation": "B", "confidence": "loose"},
            "7": {"substation": "C", "confidence": "strict"}}  # no such VL
    assert R.identity_ids(smap, layout) == {"VL-1": "strict", "VL-2": "loose"}


def test_identity_postes_strips_whitespace():
    # The map carries claims like 'CERN ' whose trailing space breaks every
    # THT lookup — the audit found 5 such claims made invisible by it.
    layout = {"VL-1": [0, 0]}
    smap = {"1": {"substation": "CERN ", "confidence": "loose"}}
    assert R.identity_postes(smap, layout) == {"VL-1": "CERN"}


def test_neighbour_offsets_uses_the_median_of_the_neighbours():
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


def test_transformer_pairs_only_returns_transformers():
    xml = ('<network><line voltageLevelId1="A" voltageLevelId2="B"/>'
           '<twoWindingsTransformer voltageLevelId1="C" voltageLevelId2="D"/></network>')
    assert R.transformer_pairs(xml) == [("C", "D")]


# ------------------------------------------------------------------ relaxation

def test_relax_pulls_a_free_voltage_level_toward_its_anchors_without_moving_them():
    pytest.importorskip("scipy")
    layout = {"VL-A": [0.0, 0.0], "VL-B": [100.0, 0.0], "VL-M": [50.0, 900.0]}
    pos = R.relax(layout, [("VL-A", "VL-M"), ("VL-B", "VL-M")], {"VL-A", "VL-B"})
    assert pos["VL-A"] == (0.0, 0.0)
    assert pos["VL-B"] == (100.0, 0.0)
    assert 0.0 < pos["VL-M"][1] < 900.0, "pulled toward the anchors, not onto them"
    assert pos["VL-M"][0] == pytest.approx(50.0), "no sideways drift on a symmetric pair"


def test_relax_honours_anchor_position_overrides():
    pytest.importorskip("scipy")
    layout = {"VL-A": [0.0, 0.0], "VL-M": [10.0, 0.0]}
    pos = R.relax(layout, [("VL-A", "VL-M")], {"VL-A"},
                  anchor_positions={"VL-A": (500.0, 500.0)})
    assert pos["VL-A"] == (500.0, 500.0)


def test_relax_per_node_lambda_and_targets():
    pytest.importorskip("scipy")
    # M hangs off anchor A; its own prior says (1000, 0), the target override
    # says (0, 1000). With a large lambda toward the override it must land
    # near the override, not near the prior.
    layout = {"VL-A": [0.0, 0.0], "VL-M": [1000.0, 0.0]}
    pos = R.relax(layout, [("VL-A", "VL-M")], {"VL-A"},
                  lam_overrides={"VL-M": 50.0},
                  target_overrides={"VL-M": (0.0, 1000.0)})
    assert pos["VL-M"][1] > 900.0
    assert pos["VL-M"][0] < 100.0


def test_relax_near_zero_lambda_lets_the_graph_place_a_released_node():
    pytest.importorskip("scipy")
    # Released ex-identity R sits at a wrong pile position; its two anchored
    # neighbours agree on somewhere else entirely. With LAMBDA_RELEASED it must
    # essentially ignore its prior.
    layout = {"VL-A": [0.0, 0.0], "VL-B": [100.0, 0.0], "VL-R": [100000.0, 0.0]}
    pos = R.relax(layout, [("VL-A", "VL-R"), ("VL-B", "VL-R")], {"VL-A", "VL-B"},
                  lam_overrides={"VL-R": R.LAMBDA_RELEASED})
    assert abs(pos["VL-R"][0] - 50.0) < 2500.0, "graph dominates the wrong prior"


def _chain_needing_two_rounds():
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
    assert released == {"VL-2"}


def test_repair_positions_seeds_from_an_initial_release_set():
    pytest.importorskip("scipy")
    layout = {"VL-1": [0.0, 0.0], "VL-2": [10.0, 0.0]}
    pairs = [("VL-1", "VL-2")]
    _, anchors, released = R.repair_positions(
        layout, pairs, {"VL-1": "strict", "VL-2": "loose"},
        initial_released={"VL-2"})
    assert released == {"VL-2"}
    assert anchors == {"VL-1"}


# ---------------------------------------------------------------- 225 kV stage

class _FakePoste:
    def __init__(self, vls):
        self.vls = vls
        self.n_gens = 0

    def centroid_at(self, kv):
        pts = [(x, y) for _, k, x, y in self.vls if k == kv and x is not None]
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


class _FakeTht:
    def __init__(self, postes, sites_225):
        self._postes = postes
        self.sites_225 = sites_225

    def info(self, name):
        return self._postes.get(name.strip())


def test_transformer_pins_land_on_the_postes_real_225_site():
    tht = _FakeTht(
        {"POSTE": _FakePoste([("POSTEP6", 225, 5000.0, 6000.0)])},
        [(5000.0, 6000.0, "POSTE", "POSTEP6")])
    layout = {"VL-380": [0.0, 0.0], "VL-225": [99.0, 99.0]}
    pins = R.transformer_pins_225(
        layout, [("VL-380", "VL-225")], {"VL-380": 380, "VL-225": 225},
        {"VL-380": "POSTE"}, tht)
    assert pins == {"VL-225": (5000.0, 6000.0)}


def test_transformer_pins_skip_postes_without_a_tht_225_level():
    tht = _FakeTht({"P400": _FakePoste([("P400P7", 380, 0.0, 0.0)])}, [])
    pins = R.transformer_pins_225(
        {"VL-380": [0, 0], "VL-225": [1, 1]}, [("VL-380", "VL-225")],
        {"VL-380": 380, "VL-225": 225}, {"VL-380": "P400"}, tht)
    assert pins == {}


def test_snap_assigns_at_most_one_node_per_site_and_respects_the_cutoff():
    pytest.importorskip("scipy")
    km = 1.0 / R.KM_PER_UNIT
    tht = _FakeTht({}, [(0.0, 0.0, "S1", "a"), (10 * km, 0.0, "S2", "b")])
    positions = {"VL-a": (1.0, 0.0), "VL-b": (2.0, 0.0), "VL-far": (500 * km, 0.0)}
    out = R.snap_free_225(positions, ["VL-a", "VL-b", "VL-far"], {}, tht,
                          cutoff_km=35.0)
    # Two nodes stacked near site S1: one takes S1, the other is pushed to S2.
    assert set(out) == {"VL-a", "VL-b"}
    assert sorted(out.values()) == [(0.0, 0.0), (10 * km, 0.0)]
    # The node 500 km from every site stays unsnapped.
    assert "VL-far" not in out


# ------------------------------------------------------ identity vetting (THT)

def test_vetting_releases_a_self_supporting_pile_but_keeps_clean_claims():
    pytest.importorskip("scipy")
    import sys
    sys.path.insert(0, str(HERE))
    from identity_vetting import vet_identities
    km = 1.0 / R.KM_PER_UNIT

    # THT truth: postes P and Q are adjacent, R is 1000 km away from both.
    class T:
        class _I:
            def __init__(self, n380, gens=0):
                self._n = n380
                self.n_gens = gens

            def count_at(self, kv):
                return self._n if kv == 380 else 0

        def __init__(self):
            self._info = {"P": self._I(1), "Q": self._I(1), "R": self._I(1)}
            self._pos = {"P": (0, 0), "Q": (50 * km, 0), "R": (1000 * km, 0)}

        def has_poste(self, n):
            return n.strip() in self._info

        def info(self, n):
            return self._info.get(n.strip())

        def geodist(self, p, q, kv=380):
            a, b = self._pos.get(p.strip()), self._pos.get(q.strip())
            if not a or not b:
                return None
            return math.hypot(a[0] - b[0], a[1] - b[1])

        def are_adjacent(self, p, q):
            return {p.strip(), q.strip()} == {"P", "Q"}

    # A pile of 4 VLs all claiming P (cap = ceil(1.5*1)+0 = 2) that only
    # support each other, plus one clean claim at Q supported by a P-claimer.
    identities = {f"VL-{i}": "P" for i in range(4)} | {"VL-q": "Q"}
    confidences = {f"VL-{i}": "loose" for i in range(4)} | {"VL-q": "loose"}
    adjacency = {"VL-0": {"VL-1", "VL-q"}, "VL-1": {"VL-0", "VL-2"},
                 "VL-2": {"VL-1", "VL-3"}, "VL-3": {"VL-2"}, "VL-q": {"VL-0"}}
    kept, released, reasons = vet_identities(identities, confidences, adjacency, T())
    assert "VL-q" in kept, "a supported claim at a non-over-claimed poste survives"
    assert len([v for v in released if identities[v] == "P"]) >= 2, \
        "the pile is cut down toward its cap"


def test_vetting_never_releases_strict_and_drops_unknown_postes():
    pytest.importorskip("scipy")
    import sys
    sys.path.insert(0, str(HERE))
    from identity_vetting import vet_identities

    class T:
        def has_poste(self, n):
            return n.strip() == "REAL"

        def info(self, n):
            class _I:
                n_gens = 0

                def count_at(self, kv):
                    return 1
            return _I() if n.strip() == "REAL" else None

        def geodist(self, p, q, kv=380):
            return None

        def are_adjacent(self, p, q):
            return False

    identities = {"VL-1": "GHOST", "VL-2": "GHOST", "VL-3": "REAL"}
    confidences = {"VL-1": "loose", "VL-2": "strict", "VL-3": "strict"}
    kept, released, reasons = vet_identities(identities, confidences, {}, T())
    assert "VL-1" in released and reasons["VL-1"] == "poste-not-in-tht"
    assert "VL-2" in kept, "strict claims are never released, even to a ghost poste"
    assert "VL-3" in kept


def test_poste_cap_accounts_for_node_split_and_generator_units():
    pytest.importorskip("scipy")
    import sys
    sys.path.insert(0, str(HERE))
    from identity_vetting import poste_cap

    class T:
        def __init__(self, n380, gens):
            class _I:
                n_gens = gens

                def count_at(self, kv):
                    return n380 if kv == 380 else 0
            self._i = _I()

        def info(self, n):
            return self._i

    assert poste_cap(T(1, 0), "X") == 2      # ceil(1.5*1)
    assert poste_cap(T(1, 6), "X") == 8      # Gravelines-style plant poste
    assert poste_cap(T(3, 0), "X") == 5      # ceil(1.5*3)


# --------------------------------------------------------- THT reference tables

@both_built
def test_tht_reference_uses_substation_nesting_not_id_prefix(tht):
    # 157 of the 1424 THT voltage levels are extra 400 kV nodes named
    # 1<poste>P7 / 2<poste>P7 whose prefix is not their substation.
    assert tht.poste_of_vl["1ARGIP7"] == "ARGIA"
    assert len(tht.poste_of_vl) == 1424
    assert len(tht.postes) == 1147
    n380_postes = sum(1 for p in tht.postes.values() if p.count_at(380) >= 1)
    assert n380_postes == 201
    assert len(tht.sites_225) == 1081


@both_built
def test_tht_poste_graph_connects_electrical_neighbours(tht):
    assert tht.are_adjacent("ARGIA", "CANTE") or len(tht.adjacency["ARGIA"]) >= 1
    # Whitespace-tolerant lookups.
    assert tht.has_poste("CERN ") or not tht.has_poste("CERN")


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
        assert provenance["algorithm"] == "vetted-anchored-laplacian-v3"


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
    grid_dir = GRIDS / REFERENCE_GRID
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
    pos = {k: (v[0], v[1]) for k, v in layout.items()}
    pairs, _ = R.parse_topology(R.load_network_xml(grid_dir))

    offsets = R.neighbourhood_offset_stats(pos, pairs)
    assert offsets["p90"] <= MAX_NEIGHBOUR_OFFSET_P90_KM
    assert offsets["p99"] <= MAX_NEIGHBOUR_OFFSET_P99_KM

    branches = R.branch_length_stats(pos, pairs)
    assert branches["over_100km"] / branches["n"] <= MAX_LONG_BRANCH_SHARE
    assert branches["over_200km"] <= MAX_OVER_200KM_BRANCHES


@both_built
def test_the_committed_225_layer_covers_the_real_french_225_network(tht):
    """The defect the operator reported: the 225 kV web was unrecognizable.

    Raw layouts: site-coverage p50 ~14.5 km (worse than a uniform random
    scatter). The repair must keep both directions of the point-cloud match to
    the real THT 225 kV network healthy.
    """
    grid_dir = GRIDS / REFERENCE_GRID
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
    pos = {k: (v[0], v[1]) for k, v in layout.items()}
    _, kv = R.parse_topology(R.load_network_xml(grid_dir))
    fid = R.fidelity_225_stats(pos, kv, tht)
    assert fid["coverage_km"]["p50"] <= MAX_225_COVERAGE_P50_KM
    assert fid["coverage_km"]["within_10km_pct"] >= MIN_225_COVERAGE_WITHIN_10KM_PCT
    assert fid["forward_km"]["p50"] <= MAX_225_FORWARD_P50_KM


@both_built
def test_matpower_and_france_tht_layouts_share_one_coordinate_frame(tht):
    """Both datasets must be in the same raw Mercator metres.

    A rebuild that shipped a rescaled or shifted frame would still look like a
    plausible map on its own while putting every substation in the wrong
    place, so the agreement is worth pinning.
    """
    grid_dir = GRIDS / REFERENCE_GRID
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
    smap = json.loads((grid_dir / "rte_substation_map.json").read_text(encoding="utf-8"))
    released = set(json.loads(
        (grid_dir / "layout_repair.json").read_text(encoding="utf-8")
    )["released_identities"])

    anchored = []
    for vl, poste in R.identity_postes(smap, layout).items():
        info = tht.info(poste)
        if vl in released or info is None:
            continue
        candidates = [(x, y) for _, k, x, y in info.vls if x is not None]
        if not candidates:
            continue
        p = (layout[vl][0], layout[vl][1])
        anchored.append(
            (p, min(candidates, key=lambda c: math.hypot(p[0] - c[0], p[1] - c[1]))))
    assert len(anchored) > 200, "too few kept identities to conclude anything"

    shift = math.hypot(statistics.median(p[0] - c[0] for p, c in anchored),
                       statistics.median(p[1] - c[1] for p, c in anchored)) * R.KM_PER_UNIT
    assert shift < 5.0, f"frames are offset by {shift:.1f} km"

    ratios = []
    for (p1, c1), (p2, c2) in zip(anchored[::2], anchored[1::2]):
        d_tht = math.hypot(c1[0] - c2[0], c1[1] - c2[1])
        if d_tht < 50_000:
            continue
        ratios.append(math.hypot(p1[0] - p2[0], p1[1] - p2[1]) / d_tht)
    assert ratios
    assert statistics.median(ratios) == pytest.approx(1.0, abs=0.02)


@both_built
def test_the_repair_never_moves_a_kept_identity_off_its_real_rte_poste(tht):
    """The contract: the map gets tidier, but a KEPT identity stays exactly
    where that identity puts it — strict matches above all."""
    grid_dir = GRIDS / REFERENCE_GRID
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
    smap = json.loads((grid_dir / "rte_substation_map.json").read_text(encoding="utf-8"))
    provenance = json.loads((grid_dir / "layout_repair.json").read_text(encoding="utf-8"))
    released = set(provenance["released_identities"])
    confidences = R.identity_ids(smap, layout)

    # No strict claim is ever released.
    assert not [vl for vl in released if confidences.get(vl) == "strict"]

    worst = 0.0
    for vl, poste in R.identity_postes(smap, layout).items():
        if vl in released:
            continue
        info = tht.info(poste)
        if info is None:
            continue
        candidates = [(x, y) for _, k, x, y in info.vls if x is not None]
        if not candidates:
            continue
        p = (layout[vl][0], layout[vl][1])
        km = min(math.hypot(p[0] - x, p[1] - y) for x, y in candidates) * R.KM_PER_UNIT
        worst = max(worst, km)
    assert worst <= MAX_IDENTITY_TO_POSTE_KM, (
        f"a kept identity sits {worst:.1f} km from the poste it claims")


@built
def test_the_release_is_substantial_but_not_a_wholesale_overturn():
    grid_dir = GRIDS / REFERENCE_GRID
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))
    smap = json.loads((grid_dir / "rte_substation_map.json").read_text(encoding="utf-8"))
    provenance = json.loads((grid_dir / "layout_repair.json").read_text(encoding="utf-8"))
    identities = R.identity_ids(smap, layout)
    released = set(provenance["released_identities"])
    assert released < set(identities), "released set must be a strict subset"
    # The audit's ground truth: ~49 % of claims sit at over-claimed postes or
    # contradict their neighbourhood. Well over 60 % released would mean the
    # vetting has gone rogue; well under 30 % would mean it stopped seeing the
    # piles (SCHEE alone holds 52 claims vs a THT cap of 2).
    share = len(released) / len(identities)
    assert 0.30 <= share <= 0.60, f"released share {share:.2f}"
