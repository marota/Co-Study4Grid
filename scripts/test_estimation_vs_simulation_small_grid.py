#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Diagnose the combined-pair estimation vs. simulation discrepancy.

Targets the Co-Study4Grid backend running on the small test grid with
contingency P.SAOL31RONCI, reproducing the gap observed in the
"Combine Actions → Computed Pairs" modal between the library's
superposition estimate (``estimated_max_rho`` / ``target_max_rho``)
and the backend's post-action simulation (``max_rho`` returned by
``/api/simulate-manual-action``).

Runs step1 → step2 → per-pair simulate and prints:

    • per-pair breakdown:
        - library estimate (from step2 `combined_actions`)
        - library's OWN internal simulation (embedded in step2 payload as
          ``max_rho_simulated`` when ``VERIFY_SUPERPOSITION_MAX_RHO`` is on
          — this is the <2% "ground-truth" reference the user's library
          report was computed from)
        - backend's simulation (what the UI "Re-Simulate" button calls)
    • variant-bug flag (simulated line == contingency?)
    • monitoring-scope mismatch flag (est line absent from sim overloads)
    • aggregate stats: two gap columns — library_est vs library_sim, and
      library_sim vs backend_sim (the real discrepancy to explain)

Usage:
    # 1. Start the backend (from project root):
    python -m expert_backend.main

    # 2. Run this script:
    python scripts/test_estimation_vs_simulation_small_grid.py

Env:
    BACKEND_URL   - backend base URL (default http://127.0.0.1:8000)
    TOP_N_PAIRS   - how many pairs to diagnose, by estimated_max_rho (default 15)
"""

from __future__ import annotations

import json
import os
import sys
from statistics import median

import numpy as np
import requests


BACKEND_URL = os.environ.get("BACKEND_URL", "http://127.0.0.1:8000")
TOP_N_PAIRS = int(os.environ.get("TOP_N_PAIRS", "15"))
ONLY_PAIR = os.environ.get("DIAGNOSE_ONLY_PAIR", "").strip()  # exact combined_actions key

NETWORK_PATH = "/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_small_grid_test/grid.xiidm"
ACTION_FILE_PATH = "/home/marotant/dev/Expert_op4grid_recommender/data/action_space/reduced_model_actions_test.json"
CONTINGENCY = "P.SAOL31RONCI"


# ---------------------------------------------------------------------------
# HTTP helpers
# ---------------------------------------------------------------------------

def api_post(path, payload, *, timeout=300):
    resp = requests.post(f"{BACKEND_URL}{path}", json=payload, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def api_get(path, *, timeout=60):
    resp = requests.get(f"{BACKEND_URL}{path}", timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def api_post_ndjson(path, payload, *, timeout=600):
    resp = requests.post(f"{BACKEND_URL}{path}", json=payload, stream=True, timeout=timeout)
    resp.raise_for_status()
    events = []
    for line in resp.iter_lines():
        if line:
            events.append(json.loads(line))
    return events


# ---------------------------------------------------------------------------
# Pipeline steps
# ---------------------------------------------------------------------------

def load_config():
    print(f"[CONFIG] network: {NETWORK_PATH}")
    print(f"[CONFIG] actions: {ACTION_FILE_PATH}")
    payload = {
        "network_path": NETWORK_PATH,
        "action_file_path": ACTION_FILE_PATH,
        "min_line_reconnections": 2,
        "min_close_coupling": 3,
        "min_open_coupling": 2,
        "min_line_disconnections": 3,
        "min_pst": 1,
        "min_load_shedding": 2,
        "min_renewable_curtailment_actions": 0,
        "n_prioritized_actions": 15,
        "monitoring_factor": 0.95,
        "pre_existing_overload_threshold": 0.02,
        "ignore_reconnections": False,
        "pypowsybl_fast_mode": True,
    }
    api_post("/api/config", payload)
    print("[CONFIG] applied\n")


def run_step1():
    print(f"[STEP1] contingency = {CONTINGENCY}")
    result = api_post("/api/run-analysis-step1", {"disconnected_element": CONTINGENCY})
    overloads = result.get("lines_overloaded", []) or []
    print(f"[STEP1] overloads: {overloads}")
    if not overloads:
        raise SystemExit("[STEP1] no overloads detected — contingency mislabeled or monitoring path off")
    print()
    return overloads


def run_step2(overloads):
    print(f"[STEP2] resolving {len(overloads)} overloads (streaming NDJSON)")
    events = api_post_ndjson(
        "/api/run-analysis-step2",
        {
            "selected_overloads": overloads,
            "all_overloads": overloads,
            "monitor_deselected": False,
        },
    )
    result_event = next((e for e in events if e.get("type") == "result"), None)
    if not result_event:
        raise SystemExit("[STEP2] no result event received")
    combined = result_event.get("combined_actions", {}) or {}
    prioritized = result_event.get("actions", {}) or {}
    lwca = result_event.get("lines_we_care_about")
    print(f"[STEP2] prioritized_actions: {len(prioritized)} | combined_pairs: {len(combined)}")
    if lwca is not None:
        print(f"[STEP2] lines_we_care_about: {len(lwca)} lines")
    print()
    return prioritized, combined, lwca


def simulate_pair(pair_id):
    return api_post(
        "/api/simulate-manual-action",
        {"action_id": pair_id, "disconnected_element": CONTINGENCY},
    )


def recompute_superposition(action1_id, action2_id):
    try:
        return api_post(
            "/api/compute-superposition",
            {
                "action1_id": action1_id,
                "action2_id": action2_id,
                "disconnected_element": CONTINGENCY,
            },
        )
    except requests.HTTPError as e:
        return {"error": str(e)}


# ---------------------------------------------------------------------------
# Diagnostic
# ---------------------------------------------------------------------------

def _fmt_rho(v):
    return f"{v:.4f}" if isinstance(v, (int, float)) and v is not None else str(v)


def _betas_close(b1, b2, tol=1e-3):
    if not b1 or not b2 or len(b1) != len(b2):
        return False
    return all(abs(a - b) <= tol for a, b in zip(b1, b2))


def diagnose_pair(pair_key, pair_data, sim_result):
    print("=" * 80)
    print(f"PAIR: {pair_key}")
    print("=" * 80)

    est_rho = pair_data.get("max_rho")
    est_line = pair_data.get("max_rho_line")
    target_rho = pair_data.get("target_max_rho")
    target_line = pair_data.get("target_max_rho_line")
    betas = pair_data.get("betas") or []

    # Library's OWN internal simulation, embedded in step2 payload when
    # VERIFY_SUPERPOSITION_MAX_RHO is on. This is the "ground-truth"
    # reference that the user's previous <2% gap report came from.
    lib_sim_rho = pair_data.get("max_rho_simulated")
    lib_sim_line = pair_data.get("max_rho_line_simulated")
    lib_sim_gap = pair_data.get("max_rho_gap")
    lib_sim_match = pair_data.get("max_rho_line_match")

    sim_rho = sim_result.get("max_rho")
    sim_line = sim_result.get("max_rho_line")
    sim_overloaded = sim_result.get("lines_overloaded_after") or []
    sim_nc = sim_result.get("non_convergence")
    sim_islanded = sim_result.get("is_islanded")

    print("  [LIBRARY ESTIMATE (step2 superposition formula)]")
    print(f"    max_rho (global):              {_fmt_rho(est_rho)}  on {est_line}")
    print(f"    target_max_rho (overload set): {_fmt_rho(target_rho)}  on {target_line}")
    print(f"    betas:                         {betas}")

    if lib_sim_rho is not None:
        print("  [LIBRARY INTERNAL SIMULATION (_verify_pair_max_rho_by_simulation)]")
        print(f"    max_rho_simulated:             {_fmt_rho(lib_sim_rho)}  on {lib_sim_line}")
        print(f"    max_rho_gap (est - lib_sim):   {_fmt_rho(lib_sim_gap)}  "
              f"(line_match={lib_sim_match})")
    else:
        print("  [LIBRARY INTERNAL SIMULATION] not present in step2 payload "
              "(VERIFY_SUPERPOSITION_MAX_RHO disabled?)")

    print("  [BACKEND SIMULATION (/api/simulate-manual-action — what the UI calls)]")
    print(f"    max_rho:                       {_fmt_rho(sim_rho)}  on {sim_line}")
    print(f"    overloaded_after:              {sim_overloaded}")
    print(f"    non_convergence:               {sim_nc}")
    print(f"    is_islanded:                   {sim_islanded}")

    flags = []

    # Variant-bug flag
    if sim_line == CONTINGENCY:
        flags.append(
            f"VARIANT-BUG? backend sim max_rho_line IS the contingency ({CONTINGENCY})"
        )

    # Estimation vs backend simulation line mismatch
    line_match_est_bsim = est_line == sim_line
    if not line_match_est_bsim:
        note = "est line != backend_sim line"
        if est_line and sim_overloaded and est_line not in sim_overloaded:
            note += f" — '{est_line}' absent from backend's overloaded_after"
        flags.append(note)

    # Library_sim vs backend_sim line mismatch — these should match since
    # both are AC simulations of the same combined action on N-1.
    if lib_sim_line is not None and sim_line is not None and lib_sim_line != sim_line:
        flags.append(
            f"SIM-PATH DIVERGENCE: library_sim line '{lib_sim_line}' "
            f"!= backend_sim line '{sim_line}'"
        )

    # Gaps
    def _gap(a, b):
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            return a - b
        return None

    gap_est_libsim = _gap(est_rho, lib_sim_rho)      # library estimate vs library simulation (expected <2%)
    gap_est_bsim   = _gap(est_rho, sim_rho)          # library estimate vs backend sim (UI-visible gap)
    gap_libsim_bsim = _gap(lib_sim_rho, sim_rho)     # library sim vs backend sim (same formula, different path)

    print("  [GAPS]")
    print(f"    est       - lib_sim          = {_fmt_rho(gap_est_libsim)}  "
          "(library internal; expected <2%)")
    print(f"    est       - backend_sim      = {_fmt_rho(gap_est_bsim)}  "
          "(UI-visible 'Max Loading (Est.)' vs 'Simulated Max Rho')")
    print(f"    lib_sim   - backend_sim      = {_fmt_rho(gap_libsim_bsim)}  "
          "(two sims of the same action — should be ~0; non-zero = backend sim-path bug)")

    if flags:
        print("  [FLAGS]")
        for f in flags:
            print(f"    ⚠ {f}")

    print()

    return {
        "pair_key": pair_key,
        "est_rho": est_rho,
        "est_line": est_line,
        "lib_sim_rho": lib_sim_rho,
        "lib_sim_line": lib_sim_line,
        "sim_rho": sim_rho,
        "sim_line": sim_line,
        "gap_est_libsim": gap_est_libsim,
        "gap_est_bsim": gap_est_bsim,
        "gap_libsim_bsim": gap_libsim_bsim,
        "line_match_est_bsim": line_match_est_bsim,
        "line_match_libsim_bsim": (
            lib_sim_line is not None and sim_line is not None and lib_sim_line == sim_line
        ),
        "is_variant_bug": sim_line == CONTINGENCY,
    }


def aggregate(rows):
    def _clean(vals):
        return [v for v in vals if isinstance(v, (int, float))]

    gaps_est_libsim = _clean([r["gap_est_libsim"] for r in rows])
    gaps_est_bsim = _clean([r["gap_est_bsim"] for r in rows])
    gaps_libsim_bsim = _clean([r["gap_libsim_bsim"] for r in rows])
    n = len(rows)
    line_match_est_bsim_n = sum(1 for r in rows if r["line_match_est_bsim"])
    line_match_libsim_bsim_n = sum(1 for r in rows if r["line_match_libsim_bsim"])
    variant_n = sum(1 for r in rows if r["is_variant_bug"])

    def _stats(vals, label):
        if not vals:
            print(f"  {label}: n=0")
            return
        arr = np.asarray(vals, dtype=float)
        print(
            f"  {label}: n={len(vals)} "
            f"mean_signed={arr.mean():+.4f} "
            f"mean_abs={np.abs(arr).mean():.4f} "
            f"median_abs={median(np.abs(arr)):.4f} "
            f"max_abs={np.abs(arr).max():.4f} "
            f"rmse={float(np.sqrt((arr ** 2).mean())):.4f}"
        )

    print("=" * 80)
    print(f"AGGREGATE over {n} pairs")
    print("=" * 80)
    _stats(gaps_est_libsim,  "est       - lib_sim     ")
    _stats(gaps_est_bsim,    "est       - backend_sim ")
    _stats(gaps_libsim_bsim, "lib_sim   - backend_sim ")
    print(f"  line match est vs backend_sim:     {line_match_est_bsim_n}/{n}")
    print(f"  line match lib_sim vs backend_sim: {line_match_libsim_bsim_n}/{n}")
    print(f"  variant-bug flags:                 {variant_n}/{n}")
    print()
    print("INTERPRETATION:")
    print("  • est - lib_sim  should be <~2% (the user's known-good reference).")
    print("  • lib_sim - backend_sim is the real discrepancy: both are AC")
    print("    simulations of the SAME combined action on N-1, so any gap here")
    print("    points to a divergence in how the backend's simulate_manual_action")
    print("    constructs the simulation (different obs_start, different rebuilt")
    print("    action object, or different simulate() parameters).")
    print("  • est - backend_sim = (est - lib_sim) + (lib_sim - backend_sim),")
    print("    and the bulk is in the second term.")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main():
    load_config()
    overloads = run_step1()
    prioritized, combined, _ = run_step2(overloads)

    if not combined:
        print("[DONE] No combined pairs produced by step2 — nothing to diagnose.")
        return 0

    # Rank pairs by estimated_max_rho desc; narrow to a single pair if asked.
    if ONLY_PAIR:
        if ONLY_PAIR not in combined:
            print(f"[FATAL] DIAGNOSE_ONLY_PAIR={ONLY_PAIR!r} not in combined_actions")
            return 1
        pairs_ranked = [(ONLY_PAIR, combined[ONLY_PAIR])]
    else:
        pairs_ranked = sorted(
            combined.items(),
            key=lambda kv: (kv[1].get("max_rho") or 0.0),
            reverse=True,
        )[:TOP_N_PAIRS]

    print(f"[DIAGNOSE] Top {len(pairs_ranked)} pairs by estimated_max_rho\n")

    rows = []
    for pair_key, pair_data in pairs_ranked:
        try:
            sim_result = simulate_pair(pair_key)
        except requests.HTTPError as e:
            print(f"[{pair_key}] simulate failed: {e}")
            continue

        row = diagnose_pair(pair_key, pair_data, sim_result)
        rows.append(row)

    if rows:
        aggregate(rows)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except requests.ConnectionError:
        print(f"[FATAL] backend not reachable at {BACKEND_URL} — start it first.")
        sys.exit(1)
    except Exception as e:
        print(f"[FATAL] {type(e).__name__}: {e}")
        sys.exit(1)
