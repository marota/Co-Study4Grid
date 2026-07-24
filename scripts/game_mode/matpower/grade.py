# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Stage 2 of the France RTE Matpower game dataset: difficulty-grade the
non-antenna constraining N-1 contingencies of a built grid, driving the
Co-Study4Grid recommender offline.

RESUMABLE: each graded scenario is appended to ``graded.jsonl`` as it is
computed; a re-run skips contingencies already present, so a machine restart
continues where it stopped.

Difficulty (mirrors RTE7000 THT):
  easy   - a suggested unitary action resolves every contingency-attributable
           overload;
  medium - no unitary resolves, but a first-identified superposition pair does;
  hard   - neither.

Per the Co-Study4Grid N-overload rule, base overloads NOT worsened by the
contingency are not counted for resolution (base-relative).

Run:  python scripts/game_mode/matpower/grade.py <gridId> [--limit N] [--time]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[3]))
from expert_backend.main import ConfigRequest  # noqa: E402
from expert_backend.services.network_service import network_service  # noqa: E402
from expert_backend.services.recommender_service import recommender_service  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "data" / "rte_matpower"

# Matpower networks are bus-branch: no couplers/node topology, so the action
# space is line disconnection + injection actions. Coupling minima -> 0.
CONFIG_MINIMA = dict(
    min_line_reconnections=0.0, min_close_coupling=0.0, min_open_coupling=0.0,
    min_line_disconnections=3.0, min_pst=1.0, min_load_shedding=2.0,
    min_renewable_curtailment_actions=2, min_redispatch=2,
    n_prioritized_actions=15, monitoring_factor=0.95,
    pre_existing_overload_threshold=0.02, ignore_reconnections=False,
    pypowsybl_fast_mode=True,
)


def configure(grid_dir: Path):
    # `update_config` auto-generates a disco_ action per line and WRITES THEM
    # BACK into the action file (recommender_service ~L592). Pointing it at the
    # committed actions.json would bloat that source ~8x (curated open_coupler
    # ~450 KB -> ~3.7 MB of derived disco_) and dirty the tree on every grade.
    # So the backend writes to a throwaway runtime copy instead, seeded from
    # the curated file; the committed actions.json stays pristine. The runtime
    # copy lives under data/ (gitignored) and is reused across contingencies.
    actions = grid_dir / "actions.json"
    runtime = grid_dir / "actions.runtime.json"
    runtime.write_text(actions.read_text() if actions.exists() else "{}")
    cfg = ConfigRequest(
        network_path=str(grid_dir / "network.xiidm"),
        action_file_path=str(runtime),
        layout_path=str(grid_dir / "grid_layout.json"),
        **CONFIG_MINIMA,
    )
    recommender_service.reset()
    network_service.load_network(cfg.network_path)
    recommender_service.update_config(cfg)


def _step2_result(events):
    """Drain the step2 iterator; return the 'result' event payload."""
    out = {}
    for ev in events:
        if isinstance(ev, dict) and ev.get("type") == "result":
            out = ev
    return out


def _resolves(after_lines, new_overloads: set) -> bool:
    """An action resolves iff no contingency-attributable overload remains
    (base overloads it doesn't touch are ignored — the N-overload rule)."""
    return len(set(after_lines or []) & new_overloads) == 0


def _classify(step2: dict, new_overloads: set) -> tuple[str, dict]:
    actions = step2.get("actions") or {}
    combined = step2.get("combined_actions") or {}
    best_unitary = None
    for aid, a in actions.items():
        if a.get("non_convergence"):
            continue
        if _resolves(a.get("lines_overloaded_after"), new_overloads):
            return "easy", {"kind": "unitary", "action": aid,
                            "max_rho": a.get("max_rho")}
        if best_unitary is None or (a.get("max_rho", 9e9) < best_unitary[1]):
            best_unitary = (aid, a.get("max_rho", 9e9))
    for pid, p in combined.items():
        if p.get("is_islanded") or p.get("non_convergence"):
            continue
        if _resolves(p.get("lines_overloaded_after"), new_overloads) or \
                (p.get("is_rho_reduction") and float(p.get("max_rho", 9e9)) <= 1.0):
            return "medium", {"kind": "pair", "action": pid,
                              "max_rho": p.get("max_rho")}
    return "hard", {"kind": "none", "best_unitary": best_unitary,
                    "n_actions": len(actions), "n_pairs": len(combined)}


def grade_contingency(cont: dict) -> dict:
    cid = cont.get("tripped_line") or cont.get("contingency_id")
    rec = dict(contingency_id=cid)
    t0 = time.time()
    try:
        step1 = recommender_service.run_analysis_step1([cid])
    except Exception as ex:  # noqa: BLE001
        rec.update(difficulty="non_converged", error=f"step1:{type(ex).__name__}",
                   t_step1=round(time.time() - t0, 2))
        return rec
    t_s1 = time.time() - t0
    overloads = step1.get("lines_overloaded", []) or []
    can_proceed = bool(step1.get("can_proceed"))
    # The lines themselves, not just their count: the scenario database shows
    # the player which lines to bring back under the limit, and it must be the
    # RECOMMENDER's view (monitoring_factor 0.95, base-relative) rather than
    # the screening's, since that is what the session will be judged against.
    rec.update(n_overloads=len(overloads), overloaded_lines=list(overloads),
               can_proceed=can_proceed, t_step1=round(t_s1, 2))
    if not can_proceed or not overloads:
        rec["difficulty"] = "trivial"
        return rec
    t1 = time.time()
    try:
        res = _step2_result(recommender_service.run_analysis_step2(overloads, overloads))
    except Exception as ex:  # noqa: BLE001
        rec.update(difficulty="non_converged", error=f"step2:{type(ex).__name__}",
                   t_step2=round(time.time() - t1, 2))
        return rec
    rec["t_step2"] = round(time.time() - t1, 2)
    rec["n_actions"] = len(res.get("actions") or {})
    difficulty, solution = _classify(res, set(overloads))
    rec["difficulty"] = difficulty
    rec["solution"] = solution
    return rec


def grade_all(conts, grid_dir: Path, done: set, sink=None, reset_each: bool = True):
    """Grade `conts`, yielding ``(index, contingency_id, record)``.

    ``reset_each`` re-runs :func:`configure` before EVERY contingency, and is
    the default because it is a correctness requirement, not a tuning knob:
    ``run_analysis_step2`` mutates the shared network state, and grading in a
    plain loop poisons every subsequent contingency. Measured on
    ``grid_6be3a179`` (case6515rte), 12 contingencies both ways: the first
    three agree, then every remaining case collapses to ``trivial`` with zero
    overloads — 9/12 verdicts wrong, and wrong in the silent direction (a real
    ``hard`` scenario is dropped from the database as "nothing to solve").

    Reloading the 20 MB network each time costs ~4x (2.4 s -> 10.6 s per
    contingency on that grid). That is the price of a correct database.
    """
    configure(grid_dir)
    for i, cont in enumerate(conts):
        cid = cont.get("tripped_line") or cont.get("contingency_id")
        if cid in done:
            continue
        if reset_each and i:
            configure(grid_dir)
        rec = grade_contingency(cont)
        if sink is not None:
            sink(rec)
        yield i, cid, rec


def grids_to_grade(names) -> list[str]:
    """``all`` expands to every built grid, in a stable order."""
    if list(names) == ["all"]:
        return sorted(d.name for d in (DATA / "grids").iterdir() if d.is_dir())
    return list(names)


def grade_grid(grid: str, limit: int = 0, persist: bool = True,
               reset_each: bool = True) -> int:
    grid_dir = DATA / "grids" / grid
    n1 = json.loads((grid_dir / "n1_contingencies.json").read_text())
    conts = [c for c in n1.get("contingencies", []) if not c.get("antenna")]
    if limit:
        conts = conts[:limit]
    graded_path = grid_dir / "graded.jsonl"
    done = set()
    if graded_path.exists() and persist:
        for line in graded_path.read_text().splitlines():
            if line.strip():
                done.add(json.loads(line)["contingency_id"])
    todo = len(conts) - len(done & {c.get("tripped_line") for c in conts})
    print(f"[grade] {grid}: {len(conts)} non-antenna constraining "
          f"contingencies, {todo} à faire ({len(done)} déjà gradées)")

    def sink(rec):
        if persist:
            with graded_path.open("a") as f:
                f.write(json.dumps(rec) + "\n")

    t0 = time.time()
    n = 0
    for i, cid, rec in grade_all(conts, grid_dir, done, sink, reset_each):
        n += 1
        print(f"  [{i+1}/{len(conts)}] {cid}: {rec.get('difficulty')} "
              f"({rec.get('n_overloads')} surcharges, "
              f"{rec.get('t_step1', 0) + rec.get('t_step2', 0):.1f}s)")
    dt = time.time() - t0
    print(f"[grade] {grid}: {n} gradées en {dt:.0f}s ({dt/max(1, n):.1f}s each)")
    return n


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("grid", nargs="+",
                    help="grid id(s), ou 'all' pour tous les grids construits")
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--time", action="store_true", help="timing dump, don't persist")
    ap.add_argument("--no-reset", action="store_true",
                    help="NE PAS re-configurer le recommender entre les "
                         "contingences. Produit des verdicts FAUX (mesuré : "
                         "9/12 divergents, tout s'effondre en 'trivial') — "
                         "réservé au chronométrage brut.")
    args = ap.parse_args()
    total = 0
    for grid in grids_to_grade(args.grid):
        total += grade_grid(grid, args.limit, not args.time, not args.no_reset)
    print(f"[grade] total {total} contingences gradées")


if __name__ == "__main__":
    main()
