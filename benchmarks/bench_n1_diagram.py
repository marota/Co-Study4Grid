#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""Profile a full `get_n1_diagram(contingency)` call end-to-end.

Covers the three fast-path patches documented in
`docs/performance/history/n1-diagram-fast-path.md`:

  1. `_get_asset_flows` vectorised   (1 168 ms → 75 ms)
  2. `_get_overloaded_lines` vect.   (1 161 ms → 98 ms)
  3. LF-status cache per variant     (600-1000 ms saved per view)

Measures both the COLD call (N-1 variant created + AC LF) and the
WARM call (variant cached + LF status cached), which is what the
user experiences when re-visiting the same contingency.

Usage:

    python benchmarks/bench_n1_diagram.py              # default ARGIAL71CANTE
    BENCH_CONTINGENCY='DISCO_X' python bench_n1_diagram.py
"""
from __future__ import annotations

import os
import time

from _bench_common import NETWORK_PATH, print_step_summary, setup_service, timed

CONTINGENCY = os.environ.get("BENCH_CONTINGENCY", "ARGIAL71CANTE")


def _instrument(recommender_service):
    """Wrap each hot method with the `timed` helper.

    Returns `(steps_dict, restore_fn)`. The caller should invoke
    `restore_fn()` after benchmarking so the service goes back to
    normal behaviour.
    """
    from expert_backend.services import diagram_mixin as _dm

    steps: dict = {}

    originals = {
        "_generate_diagram": (_dm.DiagramMixin, "_generate_diagram"),
        "_run_ac_with_fallback": (recommender_service, "_run_ac_with_fallback"),
        "_get_n1_variant": (recommender_service, "_get_n1_variant"),
        "_get_network_flows": (_dm.DiagramMixin, "_get_network_flows"),
        "_get_asset_flows": (_dm.DiagramMixin, "_get_asset_flows"),
        "_compute_deltas": (_dm.DiagramMixin, "_compute_deltas"),
        "_compute_asset_deltas": (_dm.DiagramMixin, "_compute_asset_deltas"),
        "_get_overloaded_lines": (_dm.DiagramMixin, "_get_overloaded_lines"),
    }

    backup = {}
    for label, (obj, attr) in originals.items():
        orig = getattr(obj, attr)
        backup[label] = (obj, attr, orig)
        setattr(obj, attr, timed(label, orig, steps))

    def restore() -> None:
        for _label, (obj, attr, orig) in backup.items():
            setattr(obj, attr, orig)

    return steps, restore


def main() -> None:
    print(f"Network:    {NETWORK_PATH}")
    print(f"Contingency: {CONTINGENCY}")

    _ns, recommender_service, dt_setup = setup_service()
    print(f"Setup done in {dt_setup:.0f} ms\n")

    steps, restore = _instrument(recommender_service)

    try:
        # --- COLD call ---
        print(f"=== Call 1 (COLD: creates N-1 variant + LF status) ===")
        t0 = time.perf_counter()
        d1 = recommender_service.get_n1_diagram(CONTINGENCY)
        dt_cold = (time.perf_counter() - t0) * 1000
        print(f"Total: {dt_cold:.1f} ms")
        print(f"  SVG size: {len(d1['svg']):,} bytes")
        print(f"  overloaded lines: {len(d1['lines_overloaded'])}")
        print(f"  flow_deltas: {len(d1['flow_deltas'])}")
        print(f"  asset_deltas: {len(d1['asset_deltas'])}")
        print_step_summary(steps, "COLD call step timings")

        # Reset counters for warm call
        for key in steps:
            steps[key] = []

        # --- WARM call (variant + LF status both cached) ---
        print(f"\n=== Call 2 (WARM: variant cached + LF status cached) ===")
        t0 = time.perf_counter()
        d2 = recommender_service.get_n1_diagram(CONTINGENCY)
        dt_warm = (time.perf_counter() - t0) * 1000
        print(f"Total: {dt_warm:.1f} ms")
        print_step_summary(steps, "WARM call step timings")

        print(f"\n=== Summary ===")
        print(f"  COLD: {dt_cold/1000:.2f} s")
        print(f"  WARM: {dt_warm/1000:.2f} s  (Δ = {(dt_cold-dt_warm)/1000:+.2f} s)")
    finally:
        restore()


if __name__ == "__main__":
    main()
