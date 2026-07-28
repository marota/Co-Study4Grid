# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Repair the geographic layout of the France RTE Matpower game grids.

``grid_snapshot_reconstruct`` positions each MATPOWER case by matching its
400 kV postes against a named THT snapshot (Rosetta electrical-distance
percolation) and then propagating everything else along the graph. The
identity-matched 380 kV postes land within ~2 km of their real RTE position,
but the *propagated* voltage levels — 225 kV and the whole 63 / 90 / 150 kV
sub-transmission layer, which carry **no identity claim** — have a fat tail of
placements that are geographically impossible:

    offset from the median of a VL's own electrical neighbours
                     p50    p90    p99    max
    France THT      5.4    15.0   30.0   45.1 km    <- neat reference
    Matpower (raw)  2.8    23.8   91.5  369.8 km    <- the tail we repair

Those outliers are what draws lines across the whole map: 265 branches longer
than 100 km on ``grid_6be3a179``, including 63 kV "lines" spanning 334 km.

## What this does

Free voltage levels are re-placed by an **anchored Laplacian relaxation**: the
minimiser of

    sum over branches   |x_u - x_v|^2      (pull neighbours together)
  + LAMBDA * sum over free VLs  |x_v - x_v_raw|^2   (stay where you were)

with the identity-matched VLs held **fixed** at their real RTE position. It is
solved exactly as one sparse SPD linear system per axis — no iteration count to
tune, deterministic, order-independent.

``LAMBDA`` was swept on ``grid_6be3a179``; 1.0 is the knee — most of the tail
goes, the layout barely deforms, and local spread is preserved (a too-small
LAMBDA collapses trees onto their anchor, which shows up as the median
nearest-neighbour distance falling):

    LAMBDA   branches >100 km   edge p90   median VL displacement   median NN
    raw            265          40.6 km            0.0 km            0.88 km
    8.0            216          32.3 km            0.6 km            0.96 km
    3.0            167          30.5 km            1.4 km            0.99 km
    1.0            113          28.1 km            3.6 km            1.01 km   <-
    0.3             94          25.1 km            8.5 km            0.94 km
    0.05            85          18.8 km           19.6 km            0.63 km   collapsing

## Contradicted identities

Some anchors are themselves the problem. ``rte_substation_map.json`` labels
each match ``strict`` or ``loose``, and the loose ones are where the Rosetta
percolation over-assigns: on ``grid_6be3a179`` a single poste, ``SCHEE``,
claims **52** 380 kV voltage levels (``MARSI`` 34, ``GRAV5`` 17) — real French
400 kV postes have 4, 6 or 9 nodes. Pinning dozens of unrelated buses onto one
point is what draws 400 km "400 kV lines" between two supposedly identified
postes: 56 of the 65 such branches have a ``loose`` end.

So an identity is released — the VL becomes free — when it is **loose AND its
claimed position is contradicted by its own electrical neighbourhood** by more
than ``MAX_IDENTITY_OFFSET_KM`` (45 km, the largest offset observed anywhere in
the neat France THT reference). ``strict`` matches are never released. That
costs 40 of 452 anchors on ``grid_6be3a179`` and buys most of what dropping
every loose match would, at a fraction of the identity loss:

    anchor policy                    anchors  branches >100 km  >200 km  offset p99
    (raw, no repair)                    452         265            53      91.5 km
    keep every identity                 452         113            26      51.2 km
    release contradicted loose ones     412          83            13      41.0 km   <-
    keep only strict matches            151          71             5      37.8 km

``rte_substation_map.json`` is NOT rewritten: the identity record upstream
produced stands, only the drawing moves.

## What this deliberately does NOT fix

Residual long branches joining two ``strict`` postes (9 on ``grid_6be3a179``)
are left alone: both ends are pinned to a position upstream is confident about,
so no layout pass can shorten them without contradicting that. They are
reported (``--report-suspect-anchors``) for upstream ``grid_snapshot_reconstruct``
to re-examine, not silently papered over.

## Idempotence

The relaxation is anchored on the layout it reads, so re-running it on its own
output would keep drifting. Each repaired grid therefore carries a
``layout_repair.json`` provenance record; a grid whose ``grid_layout.json``
still hashes to the recorded output is skipped. Use ``--force`` to relax again
from the current file.

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

REPO = Path(__file__).resolve().parents[3]
GRIDS = REPO / "data" / "rte_matpower" / "grids"

#: Weight of the "stay where the reconstruction put you" term. See the sweep in
#: the module docstring — 1.0 is the knee.
LAMBDA = 1.0

#: Layout units are Mercator metres; France sits near 46 deg N, so one unit is
#: about cos(46 deg) real metres. Only used for human-readable reporting.
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


def identity_ids(substation_map: dict, layout: dict) -> dict[str, str]:
    """``{voltage level: match confidence}`` for every claimed RTE identity.

    ``rte_substation_map.json`` is keyed by MATPOWER bus number and the rebuild
    names each voltage level ``VL-<bus>``.
    """
    return {vl: info.get("confidence", "loose")
            for bus, info in substation_map.items()
            if (vl := f"VL-{bus}") in layout}


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
    """Split the claimed identities into ``(anchored, released)``.

    A ``loose`` identity contradicted by its own electrical neighbourhood by
    more than ``max_offset_km`` is released — see the module docstring.
    """
    offsets = neighbour_offsets(pos, pairs)
    released = {vl for vl, conf in identities.items()
                if conf != "strict" and offsets.get(vl, 0.0) > max_offset_km}
    return set(identities) - released, released


def relax(layout: dict[str, list], pairs: list[tuple[str, str]],
          anchors: set[str], lam: float = LAMBDA) -> dict[str, tuple[float, float]]:
    """Anchored Laplacian relaxation of the free voltage levels.

    Solves ``(L + lam*I_free) x = lam*x_raw + (anchor contributions)`` exactly,
    once per axis. Anchored VLs are returned unchanged.
    """
    import numpy as np
    from scipy.sparse import coo_matrix
    from scipy.sparse.linalg import spsolve

    free = [v for v in layout if v not in anchors]
    if not free:
        return {k: (v[0], v[1]) for k, v in layout.items()}
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
        rows.append(i)
        cols.append(i)
        vals.append(len(ns) + lam)
        rhs[i, 0] = lam * layout[v][0]
        rhs[i, 1] = lam * layout[v][1]
        for u in ns:
            j = index.get(u)
            if j is None:  # anchored neighbour -> known term
                rhs[i, 0] += layout[u][0]
                rhs[i, 1] += layout[u][1]
            else:
                rows.append(i)
                cols.append(j)
                vals.append(-1.0)

    a_mat = coo_matrix((vals, (rows, cols)), shape=(n, n)).tocsc()
    sol = np.column_stack([spsolve(a_mat, rhs[:, 0]), spsolve(a_mat, rhs[:, 1])])

    out = {k: (float(v[0]), float(v[1])) for k, v in layout.items()}
    for v, i in index.items():
        out[v] = (float(sol[i, 0]), float(sol[i, 1]))
    return out


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
            "substation1": substation_map.get(a.split("-", 1)[1], {}).get("substation"),
            "substation2": substation_map.get(b.split("-", 1)[1], {}).get("substation"),
        })
    out.sort(key=lambda r: -r["km"])
    return out


def repair_positions(layout: dict, pairs: list[tuple[str, str]],
                     identities: dict[str, str], lam: float = LAMBDA,
                     max_rounds: int = MAX_RELEASE_ROUNDS,
                     ) -> tuple[dict, set[str], set[str]]:
    """Relax the layout, releasing identities the relaxed picture contradicts.

    Moving one poste changes what its neighbours' positions imply, so a
    contradicted identity can only be spotted once the others have settled: on
    ``grid_6be3a179`` the first pass releases 40 and two more rounds release 15
    more, which drops the longest branch from 399 km to 286 km. Every round
    relaxes from the ORIGINAL layout — never from the previous round's output —
    so the locality term keeps referring to the reconstruction and the result
    cannot drift.

    Returns ``(positions, anchors, released)``.
    """
    raw = {k: (v[0], v[1]) for k, v in layout.items()}
    anchors, released = select_anchors(raw, pairs, identities)
    pos = relax(layout, pairs, anchors, lam)
    for _ in range(max_rounds):
        offsets = neighbour_offsets(pos, pairs)
        newly = {vl for vl, conf in identities.items()
                 if conf != "strict" and vl in anchors
                 and offsets.get(vl, 0.0) > MAX_IDENTITY_OFFSET_KM}
        if not newly:
            break
        anchors -= newly
        released |= newly
        pos = relax(layout, pairs, anchors, lam)
    return pos, anchors, released


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def repair_grid(grid_dir: Path, *, dry_run: bool = False, force: bool = False,
                lam: float = LAMBDA) -> dict:
    """Repair one grid folder; returns the before/after report."""
    layout_path = grid_dir / "grid_layout.json"
    provenance_path = grid_dir / "layout_repair.json"
    layout = json.loads(layout_path.read_text(encoding="utf-8"))
    substation_map = json.loads(
        (grid_dir / "rte_substation_map.json").read_text(encoding="utf-8"))
    pairs, kv = parse_topology(load_network_xml(grid_dir))
    raw = {k: (v[0], v[1]) for k, v in layout.items()}
    identities = identity_ids(substation_map, layout)
    report = {
        "grid": grid_dir.name,
        "voltage_levels": len(layout),
        "branches": len(pairs),
        "identities": len(identities),
        "lambda": lam,
        "before": {
            "branch_km": branch_length_stats(raw, pairs),
            "neighbour_offset_km": neighbourhood_offset_stats(raw, pairs),
        },
    }

    provenance = (json.loads(provenance_path.read_text(encoding="utf-8"))
                  if provenance_path.is_file() else {})
    if provenance.get("output_sha256") == _sha256(layout_path) and not force:
        released = set(provenance.get("released_identities", ()))
        anchors = set(identities) - released
        report.update({
            "skipped": "already repaired",
            "anchors": len(anchors),
            "released_identities": sorted(released),
            "after": report["before"],
            "displacement_km": {},
            "suspect_anchor_branches": suspect_anchor_branches(
                raw, pairs, anchors, substation_map, kv),
        })
        return report

    pos, anchors, released = repair_positions(layout, pairs, identities, lam)
    report["anchors"] = len(anchors)
    report["released_identities"] = sorted(released)
    report["after"] = {
        "branch_km": branch_length_stats(pos, pairs),
        "neighbour_offset_km": neighbourhood_offset_stats(pos, pairs),
    }
    report["displacement_km"] = _percentiles([
        math.hypot(pos[k][0] - raw[k][0], pos[k][1] - raw[k][1]) * KM_PER_UNIT
        for k in raw])
    report["suspect_anchor_branches"] = suspect_anchor_branches(
        pos, pairs, anchors, substation_map, kv)

    if not dry_run:
        layout_path.write_text(
            json.dumps({k: [v[0], v[1]] for k, v in pos.items()}), encoding="utf-8")
        provenance_path.write_text(json.dumps({
            "algorithm": "anchored-laplacian-relaxation",
            "lambda": lam,
            "max_identity_offset_km": MAX_IDENTITY_OFFSET_KM,
            "identities": len(identities),
            "anchors": len(anchors),
            "released_identities": sorted(released),
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

    names = args.grids or sorted(d.name for d in GRIDS.iterdir() if d.is_dir())
    reports = []
    for name in names:
        rep = repair_grid(GRIDS / name, dry_run=args.dry_run, force=args.force,
                          lam=args.lam)
        reports.append(rep)
        if args.json:
            continue
        print(f"\n{rep['grid']}: {rep['voltage_levels']} VLs, {rep['branches']} "
              f"branches, {rep['anchors']}/{rep['identities']} identities anchored "
              f"({len(rep['released_identities'])} contradicted, released)"
              + (f"  [{rep['skipped']}]" if rep.get("skipped") else ""))
        print(f"  branch length      before  {_fmt(rep['before']['branch_km'])}")
        print(f"                     after   {_fmt(rep['after']['branch_km'])}")
        print(f"  neighbour offset   before  {_fmt(rep['before']['neighbour_offset_km'])}")
        print(f"                     after   {_fmt(rep['after']['neighbour_offset_km'])}")
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
