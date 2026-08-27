# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Repair the geographic layout of the France RTE Matpower game grids.

``grid_snapshot_reconstruct`` positions each MATPOWER case by matching its
400 kV postes against the named THT snapshot (Rosetta electrical-distance
percolation) and propagating everything else along the graph. Audited against
that same THT reference, the raw layouts have three distinct defects:

1. **Over-claimed identities.** The percolation uses a few hub names as sinks:
   on ``grid_6be3a179`` SCHEE claims 52 voltage levels, MARSI 34, GRAV5 17 —
   where the THT reference shows those postes carry ONE 380 kV level each.
   14 piled postes hold 226 of 452 identities, and the piles are exactly the
   operator's complaint regions (GRAV5/E.HU7/CATG2 in the Nord, SCHEE in
   Alsace, MARSI/CAZAR at the Spain border). Pile members mutually support
   each other, so no per-node geometric rule can see them.
2. **Coverage holes.** 77 of the 201 THT 400 kV postes have no identity at
   all — the whole Paris inner ring, 21 postes of the Nord chain, the Loire
   nuclear corridor, Cordemais/Blayais in the west. Wherever a strict anchor
   exists the geometry is right (strict identities sit a median 2.4 km from
   their poste); the artifacts live where anchors are missing or piled.
3. **A stacked 225 kV layer.** The propagated 225 kV positions are
   individually plausible (median 2.5 km from a real THT 225 kV site) but
   degenerate: ~750 nodes crowd ~277 real sites while most of the real 225 kV
   web has no node at all — site coverage is worse than a uniform random
   scatter. A plain anchored relaxation (the v1 of this script) made that
   WORSE: it moved 225 kV nodes a median 9 km, collapsing them onto the 380
   backbone. The 225 kV grid the operator knows disappeared.

## The repair pipeline (v3)

Stage 1 — **identity vetting** (``identity_vetting.py``): every claim is
scored against the THT poste graph; loose claims are released when their poste
does not exist in THT, their neighbours contradict them, or their poste is
over its plausibility cap ``ceil(1.5·n380) + n_generator_units`` (1.5 = the
456/302 node-split ratio; generator units get their own leaf bus in MATPOWER).
``strict`` claims are never released. A conservative 1-hop derivation then
anchors a handful of unclaimed postes (leave-one-out precision 0.90).

Stage 2 — **225 kV placement**: voltage levels hanging by a 400/225
transformer off a kept identity are pinned at that poste's real THT 225 kV
position (a transformer lives inside one substation — this is near-certain).
The remaining free 225 kV nodes are de-stacked by a capacity-limited nearest-
site assignment onto the 1 081 real THT 225 kV sites (one node per site,
seeded from the RAW positions, cutoff ``SNAP_MAX_KM``); the assignment becomes
each node's locality target with a strong weight, not a hard pin.

Stage 3 — **per-class anchored Laplacian relaxation**: minimise total squared
branch length plus per-node locality terms, solved exactly as one sparse SPD
system per axis. Kept identities and 225 kV pins are fixed; released
ex-identities get a near-zero locality weight (their prior position is known
wrong — letting the graph place them is the point); snapped 225 kV nodes get a
strong pull toward their assigned site; everything else keeps a unit pull
toward the raw reconstruction.

Measured on ``grid_6be3a179`` (v1 repair in parentheses): branches > 100 km
78 → 62 → see the committed ``layout_repair.json`` for the exact shipped
numbers; > 200 km 10 → ~4; 225 kV distance-to-real-site p50 back to ~2.5 km
(v1: 7.0 km) with site coverage restored instead of degraded.

## What this deliberately does NOT fix

Residual long branches joining two kept postes are reported
(``--report-suspect-anchors``), not hidden. Filling the Paris ring / Nord /
Loire coverage holes needs upstream re-percolation of the released members
against the 77 unclaimed postes with electrical distances —
``grid_snapshot_reconstruct`` work, out of scope here. All kilometre figures
are internal units (~1.3–1.5× smaller than real km per landmark calibration);
they are consistent within and between the two datasets, which is all the
repair needs.

## Idempotence

The relaxation is anchored on the layout it reads, so re-running it on its own
output would keep drifting. Each repaired grid carries a ``layout_repair.json``
provenance record; a grid whose ``grid_layout.json`` still hashes to the
recorded output is skipped. Use ``--force`` to relax again from the current
file. Run the tool on the RAW reconstruction layouts.

Run::

    python scripts/game_mode/matpower/repair_layout.py            # all grids
    python scripts/game_mode/matpower/repair_layout.py --dry-run  # report only
    python scripts/game_mode/matpower/repair_layout.py --report-suspect-anchors
"""
from __future__ import annotations

import argparse
import base64
import collections
import gzip
import hashlib
import json
import math
import re
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

REPO = Path(__file__).resolve().parents[3]
GRIDS = REPO / "data" / "rte_matpower" / "grids"

#: Locality weight of ordinary free voltage levels (pull toward the raw
#: reconstruction position). See the lambda sweep in the v1 docstring history.
LAMBDA = 1.0

#: Locality weight of RELEASED ex-identities. Their raw position is the wrong
#: pile they were released from — pulling them back there defeats the release,
#: so the graph decides almost alone. Swept 0.02 / 0.05 / 0.1; see provenance.
LAMBDA_RELEASED = 0.05

#: Locality weight of 225 kV nodes snapped to a real THT site: strong pull so
#: the de-stacking sticks, while the topology still fine-tunes the position.
LAMBDA_SNAPPED = 4.0

#: Snap-radius schedule of the assign/relax rounds (internal km). Round 1 works
#: on the RAW positions, so it only trusts short moves (p99 of the raw
#: distance-to-nearest-site distribution is 31 km). Later rounds re-assign from
#: the RELAXED picture — a node's position then reflects its neighbours, so the
#: over-dense regions (e.g. the ~120 excess nodes stacked around Normandy) can
#: legitimately export nodes to the real-but-empty sites of the depleted
#: regions further away. Chosen against the 4x4 regional census: the schedule
#: halves its deviation from the THT reference while a single 35 km round
#: leaves it essentially unchanged.
SNAP_ROUNDS_KM = (35.0, 60.0, 90.0, 90.0)

#: Layout units are Mercator metres; France sits near 46 deg N, so one unit is
#: about cos(46 deg) real metres. Only used for human-readable reporting, and
#: landmark calibration suggests real distances are ~1.3-1.5x larger — every
#: km figure in this pipeline is a consistent internal unit, not geography.
KM_PER_UNIT = 0.695 / 1000.0

#: A branch longer than this is geographically implausible in the French grid
#: (the longest real 400 kV circuits are ~200 km). Used for reporting and for
#: flagging suspect identity matches.
LONG_BRANCH_KM = 100.0

#: A ``loose`` identity whose claimed position sits further than this from the
#: median of its own electrical neighbours is treated as contradicted and
#: released. 45 km is the largest such offset anywhere in the France THT
#: reference grid, i.e. the empirical ceiling of "geographically plausible".
MAX_IDENTITY_OFFSET_KM = 45.0

#: Safety cap on the release/relax rounds (see ``repair_positions``). The four
#: committed grids converge in 3.
MAX_RELEASE_ROUNDS = 8

_VL_TAG_RE = re.compile(
    r'<(?:\w+:)?voltageLevel\b[^>]*\bid="([^"]+)"[^>]*\bnominalV="([^"]+)"')
_BRANCH_TAG_RE = re.compile(r'<(?:\w+:)?(?:line|twoWindingsTransformer)\b([^>]*)>')
_TYPED_BRANCH_TAG_RE = re.compile(r'<(?:\w+:)?(line|twoWindingsTransformer)\b([^>]*)>')
_V1_RE = re.compile(r'voltageLevelId1="([^"]+)"')
_V2_RE = re.compile(r'voltageLevelId2="([^"]+)"')


def load_network_xml(grid_dir: Path) -> str:
    """Network XIIDM text, decoding the committed ``.gz.b64`` transport form."""
    direct = grid_dir / "network.xiidm"
    if direct.is_file():
        return direct.read_text(encoding="utf-8", errors="replace")
    packed = grid_dir / "network.xiidm.gz.b64"
    if packed.is_file():
        return gzip.decompress(base64.b64decode(packed.read_bytes())).decode(
            "utf-8", errors="replace")
    raise FileNotFoundError(f"no network in {grid_dir}")


def parse_topology(xml: str) -> tuple[list[tuple[str, str]], dict[str, int]]:
    """``(branch VL pairs, {vl: nominal kV})`` — self-loops dropped."""
    pairs: list[tuple[str, str]] = []
    for m in _BRANCH_TAG_RE.finditer(xml):
        attrs = m.group(1)
        a, b = _V1_RE.search(attrs), _V2_RE.search(attrs)
        if a and b and a.group(1) != b.group(1):
            pairs.append((a.group(1), b.group(1)))
    kv: dict[str, int] = {}
    for vid, v in _VL_TAG_RE.findall(xml):
        try:
            kv[vid] = round(float(v))
        except ValueError:
            continue
    return pairs, kv


def transformer_pairs(xml: str) -> list[tuple[str, str]]:
    """VL pairs joined by a 2-winding transformer (same physical substation)."""
    out: list[tuple[str, str]] = []
    for m in _TYPED_BRANCH_TAG_RE.finditer(xml):
        if m.group(1) != "twoWindingsTransformer":
            continue
        a, b = _V1_RE.search(m.group(2)), _V2_RE.search(m.group(2))
        if a and b and a.group(1) != b.group(1):
            out.append((a.group(1), b.group(1)))
    return out


def identity_ids(substation_map: dict, layout: dict) -> dict[str, str]:
    """``{voltage level: match confidence}`` for every claimed RTE identity.

    ``rte_substation_map.json`` is keyed by MATPOWER bus number and the rebuild
    names each voltage level ``VL-<bus>``.
    """
    return {vl: info.get("confidence", "loose")
            for bus, info in substation_map.items()
            if (vl := f"VL-{bus}") in layout}


def identity_postes(substation_map: dict, layout: dict) -> dict[str, str]:
    """``{voltage level: claimed poste}`` — names ``.strip()``-ed (the map
    carries claims like ``'CERN '`` whose trailing space breaks THT lookups)."""
    return {vl: info["substation"].strip()
            for bus, info in substation_map.items()
            if (vl := f"VL-{bus}") in layout}


def build_adjacency(pairs: list[tuple[str, str]]) -> dict[str, set]:
    adj: dict[str, set] = collections.defaultdict(set)
    for a, b in pairs:
        adj[a].add(b)
        adj[b].add(a)
    return dict(adj)


def neighbour_offsets(pos: dict, pairs: list[tuple[str, str]]) -> dict[str, float]:
    """``{voltage level: km between it and the median of its neighbours}``."""
    neighbours: dict[str, list] = collections.defaultdict(list)
    for a, b in pairs:
        if a in pos and b in pos:
            neighbours[a].append(pos[b])
            neighbours[b].append(pos[a])
    return {
        v: math.hypot(pos[v][0] - statistics.median(p[0] for p in ns),
                      pos[v][1] - statistics.median(p[1] for p in ns)) * KM_PER_UNIT
        for v, ns in neighbours.items()
    }


def select_anchors(pos: dict, pairs: list[tuple[str, str]], identities: dict[str, str],
                   max_offset_km: float = MAX_IDENTITY_OFFSET_KM,
                   ) -> tuple[set[str], set[str]]:
    """Split the claimed identities into ``(anchored, released)`` geometrically.

    A ``loose`` identity contradicted by its own electrical neighbourhood by
    more than ``max_offset_km`` is released — the per-node rule that catches
    stragglers the poste-level vetting has no opinion on.
    """
    offsets = neighbour_offsets(pos, pairs)
    released = {vl for vl, conf in identities.items()
                if conf == "loose" and offsets.get(vl, 0.0) > max_offset_km}
    return set(identities) - released, released


def relax(layout: dict, pairs: list[tuple[str, str]], anchors: set[str],
          lam: float = LAMBDA, *, anchor_positions: dict | None = None,
          lam_overrides: dict | None = None, target_overrides: dict | None = None,
          ) -> dict[str, tuple[float, float]]:
    """Anchored Laplacian relaxation with per-node locality weights/targets.

    Solves ``(L + diag(lam_v)) x = lam_v * target_v + (anchor contributions)``
    exactly, once per axis. ``anchors`` are held fixed — at ``layout`` position
    unless overridden in ``anchor_positions``. Free nodes are pulled toward
    ``target_overrides`` (default: their ``layout`` position) with weight
    ``lam_overrides`` (default ``lam``).
    """
    import numpy as np
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import spsolve

    anchor_positions = anchor_positions or {}
    lam_overrides = lam_overrides or {}
    target_overrides = target_overrides or {}

    def apos(v):
        p = anchor_positions.get(v) or layout[v]
        return (p[0], p[1])

    free = [v for v in layout if v not in anchors]
    out = {v: apos(v) if v in anchors else (float(layout[v][0]), float(layout[v][1]))
           for v in layout}
    if not free:
        return out
    index = {v: i for i, v in enumerate(free)}
    n = len(free)

    # Unique neighbour pairs: parallel circuits between the same two postes say
    # nothing new about where those postes are.
    neighbours: dict[str, set[str]] = collections.defaultdict(set)
    for a, b in pairs:
        if a in layout and b in layout:
            neighbours[a].add(b)
            neighbours[b].add(a)

    rows: list[int] = []
    cols: list[int] = []
    vals: list[float] = []
    rhs = np.zeros((n, 2))
    for v, i in index.items():
        ns = neighbours.get(v, ())
        lam_v = lam_overrides.get(v, lam)
        tx, ty = target_overrides.get(v) or layout[v]
        rows.append(i)
        cols.append(i)
        vals.append(len(ns) + lam_v)
        rhs[i, 0] = lam_v * tx
        rhs[i, 1] = lam_v * ty
        for u in ns:
            j = index.get(u)
            if j is None:  # anchored neighbour -> known term
                ux, uy = apos(u)
                rhs[i, 0] += ux
                rhs[i, 1] += uy
            else:
                rows.append(i)
                cols.append(j)
                vals.append(-1.0)

    a_mat = coo_matrix((vals, (rows, cols)), shape=(n, n)).tocsc()
    sol = np.column_stack([spsolve(a_mat, rhs[:, 0]), spsolve(a_mat, rhs[:, 1])])
    for v, i in index.items():
        out[v] = (float(sol[i, 0]), float(sol[i, 1]))
    return out


# ---------------------------------------------------------------- 225 kV stage

def transformer_pins_225(layout: dict, tx_pairs: list[tuple[str, str]],
                         kv: dict[str, int], anchored_postes: dict[str, str],
                         tht) -> dict[str, tuple[float, float]]:
    """Pin 225 kV VLs transformer-connected to an anchored identity at that
    poste's real THT 225 kV position.

    A 400/225 transformer lives inside one physical substation, so the claim is
    near-certain. Postes without a 225 kV level in THT are skipped. When a
    poste pins several children, each takes one of its THT 225 sites; the
    overflow lands on a small deterministic ring around the poste's 225 kV
    centroid so nodes never coincide.
    """
    children: dict[str, list[str]] = collections.defaultdict(list)
    for a, b in tx_pairs:
        for v225, v_other in ((a, b), (b, a)):
            poste = anchored_postes.get(v_other)
            if poste and kv.get(v225) == 225 and v225 in layout:
                children[poste].append(v225)

    pins: dict[str, tuple[float, float]] = {}
    for poste, vls in children.items():
        info = tht.info(poste)
        if info is None:
            continue
        sites = [(x, y) for _, k, x, y in info.vls if k == 225 and x is not None]
        if not sites:
            continue
        centroid = info.centroid_at(225)
        for i, v in enumerate(sorted(set(vls))):
            if v in pins:
                continue
            if i < len(sites):
                pins[v] = sites[i]
            else:
                ang = 2 * math.pi * (i - len(sites)) / max(1, len(vls) - len(sites))
                r = 1500.0  # ~1 internal km
                pins[v] = (centroid[0] + r * math.cos(ang), centroid[1] + r * math.sin(ang))
    return pins


def snap_free_225(positions: dict, free: list[str],
                  pins: dict[str, tuple[float, float]], tht,
                  cutoff_km: float) -> dict[str, tuple[float, float]]:
    """Capacity-limited assignment of free 225 kV nodes onto real THT sites.

    The raw positions are individually good (median 2.5 km from a real site)
    but stacked — several nodes on one site, most sites empty, so site
    coverage is worse than a uniform random scatter. This assigns at most ONE
    node per THT 225 kV site (sites taken by a transformer pin excluded),
    minimum-total-distance via sparse bipartite matching, within ``cutoff_km``
    of each node's ``positions`` entry. Falls back to greedy nearest-pair-first
    when a full matching is infeasible (over-stacked pockets). The result
    feeds the locality TERM (weight ``LAMBDA_SNAPPED``), not a hard pin.
    """
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import min_weight_full_bipartite_matching
    from scipy.spatial import cKDTree

    if not tht.sites_225 or not free:
        return {}
    site_xy = [(s[0], s[1]) for s in tht.sites_225]
    tree = cKDTree(site_xy)
    taken_sites: set[int] = set()
    for px, py in pins.values():
        d, s = tree.query((px, py))
        if d < 2000.0:  # a pin placed AT a site (jitter-ring overflow pins are not)
            taken_sites.add(int(s))
    avail = [i for i in range(len(site_xy)) if i not in taken_sites]
    if not avail:
        return {}
    avail_xy = [site_xy[i] for i in avail]
    avail_tree = cKDTree(avail_xy)

    cutoff = cutoff_km / KM_PER_UNIT
    k = min(60, len(avail_xy))
    dists, idxs = avail_tree.query([positions[v] for v in free], k=k,
                                   distance_upper_bound=cutoff)
    if k == 1:
        dists = dists.reshape(-1, 1)
        idxs = idxs.reshape(-1, 1)
    rows, cols, vals = [], [], []
    for i in range(len(free)):
        for j in range(k):
            if math.isfinite(dists[i][j]):
                rows.append(i)
                cols.append(int(idxs[i][j]))
                # +1 so a zero distance stays a real (nonzero) sparse entry.
                vals.append(float(dists[i][j]) + 1.0)
    if not rows:
        return {}
    matrix = coo_matrix((vals, (rows, cols)),
                        shape=(len(free), len(avail_xy))).tocsr()
    try:
        ri, ci = min_weight_full_bipartite_matching(matrix)
        matched = list(zip(ri, ci))
    except ValueError:
        # No full matching exists (an over-stacked pocket outnumbers its
        # reachable sites): greedy nearest-pair-first still de-stacks it.
        order = sorted(zip(vals, rows, cols))
        done: set[int] = set()
        used: set[int] = set()
        matched = []
        for _, r, c in order:
            if r in done or c in used:
                continue
            done.add(r)
            used.add(c)
            matched.append((r, c))

    assigned: dict[str, tuple[float, float]] = {}
    for r, c in matched:
        d = math.hypot(positions[free[r]][0] - avail_xy[c][0],
                       positions[free[r]][1] - avail_xy[c][1])
        if d <= cutoff:
            assigned[free[r]] = avail_xy[c]
    return assigned


# ------------------------------------------------------------------ statistics

def _percentiles(values: list[float]) -> dict:
    v = sorted(values)
    n = len(v)
    if not n:
        return {}
    return {
        "n": n,
        "p50": round(v[n // 2], 1),
        "p90": round(v[min(n - 1, int(n * 0.9))], 1),
        "p99": round(v[min(n - 1, int(n * 0.99))], 1),
        "max": round(v[-1], 1),
        "over_100km": sum(1 for x in v if x > LONG_BRANCH_KM),
        "over_200km": sum(1 for x in v if x > 2 * LONG_BRANCH_KM),
    }


def branch_length_stats(pos: dict, pairs: list[tuple[str, str]]) -> dict:
    """Branch-length distribution in km."""
    return _percentiles([
        math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]) * KM_PER_UNIT
        for a, b in pairs if a in pos and b in pos])


def neighbourhood_offset_stats(pos: dict, pairs: list[tuple[str, str]]) -> dict:
    """How far each VL sits from the median of its electrical neighbours (km).

    This is the statistic the France THT reference is neat on (max ~45 km) and
    the raw Matpower layout is not (max ~370 km).
    """
    return _percentiles(list(neighbour_offsets(pos, pairs).values()))


def fidelity_225_stats(pos: dict, kv: dict[str, int], tht) -> dict:
    """Both directions of 225 kV point-cloud fidelity vs the THT reference.

    ``forward``: each matpower 225 kV node's distance to the nearest real THT
    225 kV site (are drawn points at plausible sites?). ``coverage``: each THT
    site's distance to the nearest matpower node (is the real web represented?).
    The v1 regression: forward p50 7.0 km, coverage degraded below random.
    """
    from scipy.spatial import cKDTree

    mp = [pos[v] for v in pos if kv.get(v) == 225]
    sites = [(s[0], s[1]) for s in tht.sites_225]
    if not mp or not sites:
        return {}
    fwd = cKDTree(sites).query(mp)[0] * KM_PER_UNIT
    cov = cKDTree(mp).query(sites)[0] * KM_PER_UNIT
    pct = lambda a, t: round(100.0 * sum(1 for x in a if x <= t) / len(a), 1)  # noqa: E731
    return {
        "forward_km": _percentiles(list(fwd)) | {"within_3km_pct": pct(fwd, 3.0)},
        "coverage_km": _percentiles(list(cov)) | {"within_10km_pct": pct(cov, 10.0)},
    }


def suspect_anchor_branches(pos: dict, pairs: list[tuple[str, str]],
                            anchors: set[str], substation_map: dict,
                            kv: dict[str, int]) -> list[dict]:
    """Implausibly long branches still joining two anchored postes.

    Neither end can be moved, so these are Rosetta identification errors to be
    reported upstream — not layout errors.
    """
    seen: set[tuple[str, str]] = set()
    out = []
    for a, b in pairs:
        if a not in pos or b not in pos or a not in anchors or b not in anchors:
            continue
        key = (a, b) if a < b else (b, a)
        if key in seen:
            continue
        seen.add(key)
        km = math.hypot(pos[a][0] - pos[b][0], pos[a][1] - pos[b][1]) * KM_PER_UNIT
        if km <= LONG_BRANCH_KM:
            continue
        out.append({
            "km": round(km),
            "vl1": a, "vl2": b,
            "kv": max(kv.get(a, 0), kv.get(b, 0)),
            "substation1": (substation_map.get(a.split("-", 1)[1], {}).get("substation") or "").strip() or None,
            "substation2": (substation_map.get(b.split("-", 1)[1], {}).get("substation") or "").strip() or None,
        })
    out.sort(key=lambda r: -r["km"])
    return out


# -------------------------------------------------------------------- pipeline

def repair_positions(layout: dict, pairs: list[tuple[str, str]],
                     identities: dict[str, str], lam: float = LAMBDA,
                     max_rounds: int = MAX_RELEASE_ROUNDS, *,
                     initial_released: set[str] | None = None,
                     anchor_positions: dict | None = None,
                     lam_overrides: dict | None = None,
                     target_overrides: dict | None = None,
                     ) -> tuple[dict, set[str], set[str]]:
    """Relax the layout, releasing identities the relaxed picture contradicts.

    Moving one poste changes what its neighbours' positions imply, so a
    contradicted identity can only be spotted once the others have settled —
    the rounds re-check ``select_anchors`` on each relaxed picture. Every round
    relaxes from the ORIGINAL layout — never from the previous round's output —
    so the locality term keeps referring to the reconstruction and the result
    cannot drift. ``initial_released`` seeds the released set (the poste-level
    vetting verdict); released identities relax at ``LAMBDA_RELEASED`` unless
    ``lam_overrides`` says otherwise.

    Returns ``(positions, anchors, released)``.
    """
    raw = {k: (v[0], v[1]) for k, v in layout.items()}
    lam_overrides = dict(lam_overrides or {})

    released = set(initial_released or ())
    live = {vl: conf for vl, conf in identities.items() if vl not in released}
    anchors, geo_released = select_anchors(raw, pairs, live)
    released |= geo_released

    def do_relax():
        for v in released:
            lam_overrides.setdefault(v, LAMBDA_RELEASED)
        return relax(layout, pairs, anchors, lam,
                     anchor_positions=anchor_positions,
                     lam_overrides=lam_overrides,
                     target_overrides=target_overrides)

    # Only ``loose`` claims are geometrically releasable: ``strict`` is
    # upstream's confident identification, and ``derived`` anchors passed a
    # stronger topology test (>=2 independent G_THT-adjacent supporters, LOO
    # precision 0.90) that the neighbour-median heuristic cannot overrule — it
    # mis-fires on high-degree hubs whose neighbours legitimately spread wide
    # (e.g. the derived Cordemais hub joining Brittany to the Loire valley).
    pos = do_relax()
    for _ in range(max_rounds):
        offsets = neighbour_offsets(pos, pairs)
        newly = {vl for vl, conf in identities.items()
                 if conf == "loose" and vl in anchors
                 and offsets.get(vl, 0.0) > MAX_IDENTITY_OFFSET_KM}
        if not newly:
            break
        anchors -= newly
        released |= newly
        pos = do_relax()
    return pos, anchors, released


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repair_grid(grid_dir: Path, *, dry_run: bool = False, force: bool = False,
                lam: float = LAMBDA, tht=None) -> dict:
    """Repair one grid folder; returns the before/after report."""
    from identity_vetting import derive_identities, vet_identities
    from tht_reference import load_tht_reference

    layout_path = grid_dir / "grid_layout.json"
    provenance_path = grid_dir / "layout_repair.json"
    layout = json.loads(layout_path.read_text(encoding="utf-8"))
    substation_map = json.loads(
        (grid_dir / "rte_substation_map.json").read_text(encoding="utf-8"))
    xml = load_network_xml(grid_dir)
    pairs, kv = parse_topology(xml)
    raw = {k: (v[0], v[1]) for k, v in layout.items()}
    confidences = identity_ids(substation_map, layout)
    postes = identity_postes(substation_map, layout)
    if tht is None:
        tht = load_tht_reference()

    report = {
        "grid": grid_dir.name,
        "voltage_levels": len(layout),
        "branches": len(pairs),
        "identities": len(confidences),
        "lambda": lam,
        "before": {
            "branch_km": branch_length_stats(raw, pairs),
            "neighbour_offset_km": neighbourhood_offset_stats(raw, pairs),
            "fidelity_225": fidelity_225_stats(raw, kv, tht),
        },
    }

    provenance = (json.loads(provenance_path.read_text(encoding="utf-8"))
                  if provenance_path.is_file() else {})
    if provenance.get("output_sha256") == _sha256(layout_path) and not force:
        released = set(provenance.get("released_identities", ()))
        anchors = (set(confidences) - released) | set(provenance.get("derived_anchors", ()))
        report.update({
            "skipped": "already repaired",
            "anchors": len(anchors),
            "released_identities": sorted(released),
            "derived_anchors": provenance.get("derived_anchors", {}),
            "pinned_225": provenance.get("pinned_225", 0),
            "snapped_225": provenance.get("snapped_225", 0),
            "after": report["before"],
            "displacement_km": {},
            "suspect_anchor_branches": suspect_anchor_branches(
                raw, pairs, anchors, substation_map, kv),
        })
        return report

    # Stage 1 — identity vetting + derivation against THT ground truth.
    adjacency = build_adjacency(pairs)
    kept, vet_released, reasons = vet_identities(postes, confidences, adjacency, tht)
    vls_380 = {v for v, k in kv.items() if k == 380 and v in layout}
    derived = derive_identities(vls_380, postes, kept, adjacency, tht)
    anchor_positions: dict = {}
    for v, rec in derived.items():
        c = tht.info(rec["poste"]).centroid_at(380)
        if c:
            anchor_positions[v] = c
    derived_ids = {v: "derived" for v in anchor_positions}

    # Stage 2a — settle the 380 kV anchor set (geometric rounds on the vetted set).
    pos, anchors_380, released = repair_positions(
        layout, pairs, {**confidences, **derived_ids}, lam,
        initial_released=vet_released, anchor_positions=anchor_positions)
    for vl in released:
        reasons.setdefault(vl, "geometric-neighbour-median")

    # Stage 2b — 225 kV pins from the surviving anchors, then the de-stacking
    # assign/relax rounds. Round 1 assigns from the RAW positions (the best
    # per-node prior); later rounds re-assign from the relaxed picture, whose
    # positions already reflect each node's neighbours, so over-dense regions
    # can export their surplus to the real-but-empty sites further out.
    anchored_postes = {v: postes[v] for v in anchors_380 if v in postes}
    anchored_postes.update({v: derived[v]["poste"] for v in anchors_380 if v in derived})
    pins = transformer_pins_225(layout, transformer_pairs(xml), kv, anchored_postes, tht)
    free_225 = [v for v in layout if kv.get(v) == 225 and v not in pins]
    src = {v: (layout[v][0], layout[v][1]) for v in free_225}
    snapped: dict = {}
    for cutoff_km in SNAP_ROUNDS_KM:
        snapped = snap_free_225(src, free_225, pins, tht, cutoff_km)
        lam_overrides = {v: LAMBDA_RELEASED for v in released}
        lam_overrides.update({v: LAMBDA_SNAPPED for v in snapped})
        pos = relax(layout, pairs, anchors_380 | set(pins), lam,
                    anchor_positions={**anchor_positions, **pins},
                    lam_overrides=lam_overrides, target_overrides=snapped)
        src = {v: pos[v] for v in free_225}

    report["anchors"] = len(anchors_380)
    report["released_identities"] = sorted(released)
    report["derived_anchors"] = {v: derived[v]["poste"] for v in anchor_positions}
    report["pinned_225"] = len(pins)
    report["snapped_225"] = len(snapped)
    report["after"] = {
        "branch_km": branch_length_stats(pos, pairs),
        "neighbour_offset_km": neighbourhood_offset_stats(pos, pairs),
        "fidelity_225": fidelity_225_stats(pos, kv, tht),
    }
    report["displacement_km"] = _percentiles([
        math.hypot(pos[k][0] - raw[k][0], pos[k][1] - raw[k][1]) * KM_PER_UNIT
        for k in raw])
    report["suspect_anchor_branches"] = suspect_anchor_branches(
        pos, pairs, anchors_380, substation_map, kv)

    if not dry_run:
        # Kept identities are written verbatim (byte-identical to the raw
        # reconstruction — the repair's contract). Every computed position is
        # rounded to millimetres so a re-run is canonical: spsolve carries
        # ~1e-10-unit float noise that would otherwise flip the output hash.
        kept_map_ids = anchors_380 & set(confidences)
        layout_path.write_text(
            json.dumps({k: ([v[0], v[1]] if k in kept_map_ids
                            else [round(v[0], 3), round(v[1], 3)])
                        for k, v in pos.items()}), encoding="utf-8")
        provenance_path.write_text(json.dumps({
            "algorithm": "vetted-anchored-laplacian-v3",
            "lambda": lam,
            "lambda_released": LAMBDA_RELEASED,
            "lambda_snapped": LAMBDA_SNAPPED,
            "snap_rounds_km": list(SNAP_ROUNDS_KM),
            "max_identity_offset_km": MAX_IDENTITY_OFFSET_KM,
            "identities": len(confidences),
            "anchors": len(anchors_380),
            "released_identities": sorted(released),
            "release_reasons": dict(collections.Counter(reasons.values())),
            "derived_anchors": report["derived_anchors"],
            "pinned_225": len(pins),
            "snapped_225": len(snapped),
            "after_stats": report["after"],
            "source_sha256": hashlib.sha256(
                json.dumps({k: [v[0], v[1]] for k, v in raw.items()}).encode()
            ).hexdigest(),
            "output_sha256": _sha256(layout_path),
        }, indent=2) + "\n", encoding="utf-8")
    return report


def _fmt(stats: dict) -> str:
    if not stats:
        return "-"
    return (f"p50={stats['p50']:6.1f} p90={stats['p90']:6.1f} "
            f"p99={stats['p99']:6.1f} max={stats['max']:6.1f}"
            f"  >100km={stats['over_100km']:4d} >200km={stats['over_200km']:3d}")


def _fmt_fid(fid: dict) -> str:
    if not fid:
        return "-"
    f, c = fid["forward_km"], fid["coverage_km"]
    return (f"to-site p50={f['p50']:4.1f} (<=3km {f['within_3km_pct']:4.1f}%)  "
            f"site-coverage p50={c['p50']:4.1f} (<=10km {c['within_10km_pct']:4.1f}%)")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("grids", nargs="*", help="grid folder names (default: all)")
    ap.add_argument("--dry-run", action="store_true", help="report without writing")
    ap.add_argument("--force", action="store_true",
                    help="relax again even if already repaired")
    ap.add_argument("--lambda", dest="lam", type=float, default=LAMBDA)
    ap.add_argument("--report-suspect-anchors", action="store_true",
                    help="list the long branches joining two identified postes")
    ap.add_argument("--json", action="store_true", help="emit the reports as JSON")
    args = ap.parse_args(argv)

    from tht_reference import load_tht_reference
    tht = load_tht_reference()

    names = args.grids or sorted(d.name for d in GRIDS.iterdir() if d.is_dir())
    reports = []
    for name in names:
        rep = repair_grid(GRIDS / name, dry_run=args.dry_run, force=args.force,
                          lam=args.lam, tht=tht)
        reports.append(rep)
        if args.json:
            continue
        print(f"\n{rep['grid']}: {rep['voltage_levels']} VLs, {rep['branches']} "
              f"branches, {rep['anchors']}/{rep['identities']} identities anchored "
              f"({len(rep['released_identities'])} released"
              + (f", {len(rep.get('derived_anchors', {}))} derived, "
                 f"{rep.get('pinned_225', 0)} x225 pinned, "
                 f"{rep.get('snapped_225', 0)} x225 snapped" if "pinned_225" in rep else "")
              + ")" + (f"  [{rep['skipped']}]" if rep.get("skipped") else ""))
        print(f"  branch length      before  {_fmt(rep['before']['branch_km'])}")
        print(f"                     after   {_fmt(rep['after']['branch_km'])}")
        print(f"  neighbour offset   before  {_fmt(rep['before']['neighbour_offset_km'])}")
        print(f"                     after   {_fmt(rep['after']['neighbour_offset_km'])}")
        print(f"  225kV fidelity     before  {_fmt_fid(rep['before']['fidelity_225'])}")
        print(f"                     after   {_fmt_fid(rep['after']['fidelity_225'])}")
        if rep["displacement_km"]:
            d = rep["displacement_km"]
            print(f"  VL displacement            p50={d['p50']:6.1f} p90={d['p90']:6.1f} "
                  f"p99={d['p99']:6.1f} max={d['max']:6.1f}")
        sus = rep["suspect_anchor_branches"]
        print(f"  suspect identity matches   {len(sus)} branches >{LONG_BRANCH_KM:.0f} km "
              f"between two identified postes (upstream Rosetta issue)")
        if args.report_suspect_anchors:
            for row in sus[:20]:
                print(f"      {row['km']:>4} km  {row['kv']:>3} kV  "
                      f"{row['substation1']} -- {row['substation2']} "
                      f"({row['vl1']} -- {row['vl2']})")

    if args.json:
        print(json.dumps(reports, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
