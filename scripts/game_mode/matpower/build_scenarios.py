#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Stage 3 of the France RTE Matpower game dataset: fold the per-grid
``graded.jsonl`` files into the packaged scenario database
``data/rte_matpower/scenarios.json``.

Same shape as the RTE7000 THT database (``data/rte7000_tht/scenarios.json``),
so every downstream consumer — ``sample_rte7000``-style CLI, the frontend
preset generator, the Game Mode session config — reads one schema for both
families.

Only genuinely playable scenarios are kept: a contingency graded ``trivial``
(nothing overloads once the recommender applies the 95 % monitoring factor and
the base-relative rule) or ``non_converged`` is not a game case. Antenna
contingencies never reach grading in the first place.

Dates stay hidden, exactly as in the THT family: the scenario carries only the
month + weekday + hour-period title from ``mapping_private.json``, and grids
live under opaque ``grid_<sha1[:8]>`` ids.

Run after grading:
    python scripts/game_mode/matpower/build_scenarios.py
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "data" / "rte_matpower"
#: Graded verdicts that are actual game scenarios.
PLAYABLE = ("easy", "medium", "hard")
#: Mirrors grade.CONFIG_MINIMA — recorded so a database states the regime it
#: was graded under rather than leaving it to the reader's memory.
MONITORING_FACTOR = 0.95


def scenario_id(grid_id: str, cid: str) -> str:
    """Stable opaque id: same grid + same contingency -> same id across
    rebuilds, so sessions and recorded solutions survive a regeneration."""
    digest = hashlib.sha1(f"{grid_id}|{cid}".encode()).hexdigest()[:6]
    return f"s_{grid_id.removeprefix('grid_')}_{digest}"


def load_graded(grid_dir: Path) -> dict:
    """``contingency_id -> record``, last write wins (the file is append-only
    and a re-run may re-grade a contingency)."""
    path = grid_dir / "graded.jsonl"
    if not path.exists():
        return {}
    out = {}
    for line in path.read_text().splitlines():
        if line.strip():
            rec = json.loads(line)
            out[rec["contingency_id"]] = rec
    return out


def load_screening(grid_dir: Path) -> dict:
    """``contingency_id -> screening record`` (peak loading, overloaded
    lines) from the stage-1 N-1 file."""
    n1 = json.loads((grid_dir / "n1_contingencies.json").read_text())
    return {c.get("tripped_line") or c.get("contingency_id"): c
            for c in n1.get("contingencies", [])}


def _best_rho(solution: dict) -> float | None:
    """Loading the best found action gets the worst line down to, in %."""
    rho = solution.get("max_rho")
    if rho is None and isinstance(solution.get("best_unitary"), list):
        rho = solution["best_unitary"][1] if len(solution["best_unitary"]) > 1 else None
    try:
        rho = float(rho)
    except (TypeError, ValueError):
        return None
    return None if rho >= 9e8 else round(rho * 100.0, 1)


def build_scenario(grid_id: str, meta: dict, cid: str, graded: dict,
                   screened: dict) -> dict:
    title = meta.get("period_title", grid_id)
    solution = graded.get("solution") or {}
    # The recommender's own view of what is overloaded is what the session is
    # judged against; the screening's list is only a fallback for records
    # graded before that field was recorded.
    lines = graded.get("overloaded_lines")
    if lines is None:
        lines = [ln.get("line_id") for ln in screened.get("overloaded_lines", [])]
    return {
        "id": scenario_id(grid_id, cid),
        "gridId": grid_id,
        "difficulty": graded["difficulty"],
        "title": title,
        "label": f"{title} — {cid}",
        "networkPath": f"data/rte_matpower/grids/{grid_id}/network.xiidm",
        "actionFilePath": f"data/rte_matpower/grids/{grid_id}/actions.json",
        "layoutPath": f"data/rte_matpower/grids/{grid_id}/grid_layout.json",
        "contingencyElementId": cid,
        "contingencyLabel": cid,
        "baselineMaxLoadingPct": screened.get("max_loading_pct"),
        "nOverloadedLines": graded.get("n_overloads", len(lines)),
        "overloadedLines": lines,
        "nActionsDiscovered": graded.get("n_actions", 0),
        "bestAchievableLoadingPct": _best_rho(solution),
        "solution": solution,
    }


def build(data_dir: Path = DATA) -> dict:
    mapping = json.loads((data_dir / "mapping_private.json").read_text())
    scenarios, skipped = [], {}
    for grid_id in sorted(mapping):
        grid_dir = data_dir / "grids" / grid_id
        if not grid_dir.is_dir():
            continue
        graded = load_graded(grid_dir)
        screened = load_screening(grid_dir)
        for cid, rec in sorted(graded.items()):
            verdict = rec.get("difficulty")
            if verdict not in PLAYABLE:
                skipped[verdict] = skipped.get(verdict, 0) + 1
                continue
            scenarios.append(build_scenario(grid_id, mapping[grid_id], cid,
                                            rec, screened.get(cid, {})))
    counts = {d: sum(1 for s in scenarios if s["difficulty"] == d)
              for d in PLAYABLE}
    return {
        "grid_family": "RTE Matpower France EHV",
        "description": (
            "Difficulty-graded N-1 scenarios on the public MATPOWER RTE cases "
            "(case6468/6470/6495/6515rte — real 2013 French EHV operating "
            "points), rebuilt as NODE_BREAKER so topological levers exist. "
            "Non-antenna only. Difficulty is the expert recommender's "
            f"solvability at the {MONITORING_FACTOR:.0%} monitoring factor: "
            "easy — a unitary action resolves; medium — a first-identified "
            "superposition pair resolves; hard — neither."),
        "monitoring_factor": MONITORING_FACTOR,
        "counts": counts,
        "n_scenarios": len(scenarios),
        "difficulties": list(PLAYABLE),
        "skipped": skipped,
        "scenarios": scenarios,
    }


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--data-dir", type=Path, default=DATA)
    ap.add_argument("--out", type=Path,
                    help="défaut: <data-dir>/scenarios.json")
    args = ap.parse_args()
    db = build(args.data_dir)
    out = args.out or (args.data_dir / "scenarios.json")
    out.write_text(json.dumps(db, indent=1, ensure_ascii=False))
    print(f"{db['n_scenarios']} scénarios -> {out}")
    print(f"  par difficulté : {db['counts']}")
    if db["skipped"]:
        print(f"  écartés (non jouables) : {db['skipped']}")
    if not db["n_scenarios"]:
        print("  ATTENTION: aucun scénario — les grids ont-ils été gradés "
              "(scripts/game_mode/matpower/grade.py all) ?")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
