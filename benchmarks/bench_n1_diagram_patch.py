#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""Profile the N-1 patch endpoint (SVG-less payload) vs the full-SVG
endpoint, end-to-end on the reference bare_env_20240828T0100Z grid.

The patch endpoint skips pypowsybl's `get_network_area_diagram` call
and the ~12 MB SVG serialisation entirely. The frontend then clones
the already-loaded N-state SVG DOM and applies the patch in-place,
avoiding the 20-28 MB transfer and re-parse on each contingency
selection.

See `docs/performance/history/svg-dom-recycling.md` for the wider
context and payload schema; this script captures the backend cost
delta alone (wire + client parse are measured in the frontend).

Usage:
    python benchmarks/bench_n1_diagram_patch.py                 # default contingency
    BENCH_CONTINGENCY='DISCO_X' python bench_n1_diagram_patch.py
"""
from __future__ import annotations

import json
import os
import time

from _bench_common import NETWORK_PATH, setup_service

CONTINGENCY = os.environ.get("BENCH_CONTINGENCY", "ARGIAL71CANTE")
RESULTS_FILE = os.environ.get(
    "BENCH_RESULTS_FILE",
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
        "profiling_patch_results.json",
    ),
)


def _payload_bytes(payload: dict) -> int:
    """Rough on-wire size of a JSON payload, pre-gzip."""
    return len(json.dumps(payload, default=str).encode("utf-8"))


def _measure(fn, reps: int = 3) -> tuple[float, list[float]]:
    """Run `fn` `reps` times, return (median_ms, all_dts_ms)."""
    dts: list[float] = []
    for _ in range(reps):
        t0 = time.perf_counter()
        fn()
        dts.append((time.perf_counter() - t0) * 1000)
    dts_sorted = sorted(dts)
    return dts_sorted[len(dts_sorted) // 2], dts


def main() -> None:
    print(f"Network:     {NETWORK_PATH}")
    print(f"Contingency: {CONTINGENCY}")

    _ns, recommender_service, dt_setup = setup_service()
    print(f"Setup done in {dt_setup:.0f} ms\n")

    # --- COLD full fetch (sets up N-1 variant, AC LF, overload cache) ---
    print("=== Full /api/n1-diagram (COLD) ===")
    t0 = time.perf_counter()
    full_cold = recommender_service.get_n1_diagram(CONTINGENCY)
    full_cold_ms = (time.perf_counter() - t0) * 1000
    full_cold_size = _payload_bytes(full_cold)
    full_cold_svg_mb = len(full_cold["svg"]) / 1_000_000
    print(f"  total:             {full_cold_ms:>8.1f} ms")
    print(f"  full payload size: {full_cold_size / 1_000_000:>8.2f} MB")
    print(f"  SVG size:          {full_cold_svg_mb:>8.2f} MB")
    print(f"  flow_deltas:       {len(full_cold.get('flow_deltas', {}))}")

    # --- WARM full fetch (variant + LF cached) — median of 3 ---
    print("\n=== Full /api/n1-diagram (WARM median of 3) ===")
    full_warm_ms, full_warm_all = _measure(
        lambda: recommender_service.get_n1_diagram(CONTINGENCY), reps=3
    )
    print(f"  median:            {full_warm_ms:>8.1f} ms")
    print(f"  all runs:          {[f'{d:.0f}' for d in full_warm_all]}")

    # --- COLD patch (expected to reuse LF cache already populated by
    #    the full-fetch call above; still avoids the ~2-4 s
    #    `_generate_diagram` NAD call + ~12 MB SVG serialisation) ---
    print("\n=== Patch /api/n1-diagram-patch (COLD) ===")
    t0 = time.perf_counter()
    patch_cold = recommender_service.get_n1_diagram_patch(CONTINGENCY)
    patch_cold_ms = (time.perf_counter() - t0) * 1000
    patch_cold_size = _payload_bytes(patch_cold)
    print(f"  total:             {patch_cold_ms:>8.1f} ms")
    print(f"  patch payload:     {patch_cold_size / 1_000_000:>8.3f} MB")
    print(f"  patchable:         {patch_cold['patchable']}")
    print(f"  flow_deltas:       {len(patch_cold.get('flow_deltas', {}))}")
    print(f"  absolute_flows:    {sum(len(patch_cold.get('absolute_flows', {}).get(k, {})) for k in ('p1','p2','q1','q2'))}")

    # --- WARM patch — median of 3 ---
    print("\n=== Patch /api/n1-diagram-patch (WARM median of 3) ===")
    patch_warm_ms, patch_warm_all = _measure(
        lambda: recommender_service.get_n1_diagram_patch(CONTINGENCY), reps=3
    )
    print(f"  median:            {patch_warm_ms:>8.1f} ms")
    print(f"  all runs:          {[f'{d:.0f}' for d in patch_warm_all]}")

    # --- Summary ---
    print(f"\n=== Summary (lower is better) ===")
    print(f"  FULL  cold: {full_cold_ms/1000:>5.2f} s   warm: {full_warm_ms/1000:>5.2f} s")
    print(f"  PATCH cold: {patch_cold_ms/1000:>5.2f} s   warm: {patch_warm_ms/1000:>5.2f} s")
    warm_savings = full_warm_ms - patch_warm_ms
    cold_savings = full_cold_ms - patch_cold_ms
    print(f"  Δ cold:    -{cold_savings/1000:>5.2f} s "
          f"({-100 * cold_savings / full_cold_ms:>5.1f}%)")
    print(f"  Δ warm:    -{warm_savings/1000:>5.2f} s "
          f"({-100 * warm_savings / full_warm_ms:>5.1f}%)")
    print(f"  Payload reduction: "
          f"{(full_warm_all[0] and full_cold_size) and full_cold_size / 1_000_000:>5.2f} MB → "
          f"{patch_cold_size / 1_000_000:>5.3f} MB "
          f"({100 * patch_cold_size / max(full_cold_size, 1):.1f}% of full)")

    # --- Persist to JSON for the perf retrospective doc ---
    out = {
        "network_path": NETWORK_PATH,
        "contingency": CONTINGENCY,
        "full": {
            "cold_ms": full_cold_ms,
            "warm_ms_median": full_warm_ms,
            "warm_ms_all": full_warm_all,
            "payload_bytes": full_cold_size,
            "svg_mb": full_cold_svg_mb,
        },
        "patch": {
            "cold_ms": patch_cold_ms,
            "warm_ms_median": patch_warm_ms,
            "warm_ms_all": patch_warm_all,
            "payload_bytes": patch_cold_size,
            "patchable": patch_cold["patchable"],
        },
        "savings": {
            "cold_ms": cold_savings,
            "cold_pct": 100 * cold_savings / max(full_cold_ms, 1),
            "warm_ms": warm_savings,
            "warm_pct": 100 * warm_savings / max(full_warm_ms, 1),
            "payload_ratio_pct": 100 * patch_cold_size / max(full_cold_size, 1),
        },
    }
    with open(RESULTS_FILE, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2)
    print(f"\n  JSON: {RESULTS_FILE}")


if __name__ == "__main__":
    main()
