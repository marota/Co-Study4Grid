#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""Benchmark a matrix of ``NadParameters`` toggle combinations.

Drives ``recommender_service.get_network_diagram()`` with several
``NadParameters`` overrides (applied via monkey-patching
``DiagramMixin._default_nad_parameters``) to quantify the per-toggle
impact on NAD generation time and SVG size.

The matrix below validates the "minimal-render" choices documented in
``docs/performance/nad-profile-bare-env.md`` (section "Results — after #6")
and surfaces the cost of ``injections_added=True`` so the trade-off
can be revisited later.

Outputs ``profiling_toggles_results.json`` at the project root +
a comparison table on stdout.

Usage:

    BENCH_NETWORK_PATH=/path/to/grid_dir \
        python benchmarks/bench_nad_toggles.py
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from statistics import median

from _bench_common import NETWORK_PATH, setup_service

from expert_backend.services.diagram_mixin import DiagramMixin
from pypowsybl.network import NadLayoutType, NadParameters

_REPO_ROOT = Path(__file__).resolve().parent.parent

_DIAG_LINE_RE = re.compile(
    r"\[RECO\] Diagram generated: NAD ([\d.]+)s, SVG ([\d.]+)s, Meta ([\d.]+)s "
    r"\(SVG length=(\d+)\)"
)

# Mirror the actual production defaults in
# `DiagramMixin._default_nad_parameters` so any override below is a
# pure diff. Keep this dict in sync if that method changes.
_PROD_KWARGS = dict(
    edge_name_displayed=False,
    id_displayed=False,
    edge_info_along_edge=True,
    power_value_precision=0,
    angle_value_precision=0,
    current_value_precision=1,
    voltage_value_precision=0,
    bus_legend=False,
    substation_description_displayed=False,
    voltage_level_details=False,
    injections_added=False,
    layout_type=NadLayoutType.GEOGRAPHICAL,
)


class _DiagramTimingCapture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(level=logging.INFO)
        self.last_match: dict | None = None

    def emit(self, record: logging.LogRecord) -> None:
        m = _DIAG_LINE_RE.search(record.getMessage())
        if m:
            self.last_match = {
                "nad_s": float(m.group(1)),
                "svg_s": float(m.group(2)),
                "meta_s": float(m.group(3)),
                "svg_len": int(m.group(4)),
            }


def _make_factory(overrides: dict):
    """Return a bound-method replacement for `_default_nad_parameters`."""
    kwargs = dict(_PROD_KWARGS)
    kwargs.update(overrides)

    def _override(_self):
        return NadParameters(**kwargs)

    return _override


def _run_config(name, overrides, capture, iterations=3):
    DiagramMixin._default_nad_parameters = _make_factory(overrides)

    print(f"\n>>> Config: {name}")
    print(f"    overrides: {overrides or '(prod defaults)'}")

    rows = []
    for i in range(1, iterations + 1):
        capture.last_match = None
        _, recommender_service, _ = setup_service(wait_for_nad_prefetch=False)

        t0 = time.perf_counter()
        res = recommender_service.get_network_diagram()
        total = time.perf_counter() - t0

        if capture.last_match is None:
            raise RuntimeError("Did not capture [RECO] Diagram generated line")

        svg_bytes = len(res["svg"])
        rows.append({
            "run": i,
            "total_s": round(total, 3),
            "nad_s": capture.last_match["nad_s"],
            "svg_bytes": svg_bytes,
            "svg_mb": round(svg_bytes / (1024 * 1024), 2),
        })
        print(
            f"  run {i}: total={rows[-1]['total_s']}s  "
            f"NAD={rows[-1]['nad_s']}s  size={rows[-1]['svg_mb']} MB"
        )

    # Warm median excludes run 1 (JVM/pypowsybl warm-up absorbed there).
    warm = rows[1:]
    return {
        "config": name,
        "overrides": overrides,
        "runs": rows,
        "warm_median": {
            "nad_s": round(median(r["nad_s"] for r in warm), 3),
            "total_s": round(median(r["total_s"] for r in warm), 3),
            "svg_mb": round(median(r["svg_mb"] for r in warm), 2),
        },
    }


def main(iterations: int = 3) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    capture = _DiagramTimingCapture()
    logging.getLogger().addHandler(capture)

    # Revert each toggle individually from the production minimal-render
    # defaults to quantify its contribution. Plus two "regress" rows for
    # `injections_added=True` which was measured and *rejected*.
    configs = [
        ("prod defaults (minimal-render)", {}),
        ("+ bus_legend=True (pre-#6 default)", {"bus_legend": True}),
        (
            "+ substation_description_displayed=True (pre-#6 default)",
            {"substation_description_displayed": True},
        ),
        ("+ voltage_level_details=True (pypowsybl default)", {"voltage_level_details": True}),
        ("+ injections_added=True (NOT APPLIED, cost check)", {"injections_added": True}),
    ]

    print(f"Network: {NETWORK_PATH}")
    results = [_run_config(n, o, capture, iterations) for n, o in configs]

    out_file = _REPO_ROOT / "profiling_toggles_results.json"
    out_file.write_text(
        json.dumps({"network_path": NETWORK_PATH, "configs": results}, indent=2)
    )

    print("\n" + "=" * 100)
    print(f"{'Config':<65} | {'NAD(s)':>8} | {'Total(s)':>9} | {'SVG(MB)':>8}")
    print("-" * 100)
    baseline = results[0]["warm_median"]
    for res in results:
        wm = res["warm_median"]
        suffix = ""
        if res["config"] != "prod defaults (minimal-render)":
            suffix = (
                f"  Δ nad={wm['nad_s'] - baseline['nad_s']:+.2f}  "
                f"total={wm['total_s'] - baseline['total_s']:+.2f}  "
                f"mb={wm['svg_mb'] - baseline['svg_mb']:+.1f}"
            )
        print(
            f"{res['config']:<65} | {wm['nad_s']:>8.3f} | "
            f"{wm['total_s']:>9.3f} | {wm['svg_mb']:>8.2f}{suffix}"
        )
    print("=" * 100)
    print(f"\nSaved: {out_file}")


if __name__ == "__main__":
    main()
