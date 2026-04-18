#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""Profile N-state NAD generation times (Load Study base diagram).

Runs 3 iterations in a single Python process against the reference
grid defined by ``BENCH_NETWORK_PATH``. Iteration 1 is cold (fresh
JVM / pypowsybl caches), iterations 2-3 are warm.

Wraps ``recommender_service.get_network_diagram()`` with
``time.perf_counter()`` and captures the three sub-timings already
emitted by ``diagram_mixin._generate_diagram`` via a logging.Handler
parsing ``[RECO] Diagram generated: NAD Xs, SVG Ys, Meta Zs …``.

Outputs ``profiling_results.json`` at the project root + a stdout
summary. See ``docs/perf-nad-profile-bare-env.md``.

Usage:

    BENCH_NETWORK_PATH=/path/to/grid_dir \
        python benchmarks/bench_nad_n_state.py
"""
from __future__ import annotations

import json
import logging
import re
import time
from pathlib import Path
from statistics import median

from _bench_common import NETWORK_PATH, setup_service

_REPO_ROOT = Path(__file__).resolve().parent.parent

_DIAG_LINE_RE = re.compile(
    r"\[RECO\] Diagram generated: NAD ([\d.]+)s, SVG ([\d.]+)s, Meta ([\d.]+)s "
    r"\(SVG length=(\d+)\)"
)


class _DiagramTimingCapture(logging.Handler):
    """Capture the latest ``[RECO] Diagram generated: …`` log line."""

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


def _run(iteration: int, cold: bool, capture: _DiagramTimingCapture) -> dict:
    capture.last_match = None
    _, recommender_service, _ = setup_service(wait_for_nad_prefetch=False)

    t0 = time.perf_counter()
    res = recommender_service.get_network_diagram()
    total = time.perf_counter() - t0

    if capture.last_match is None:
        raise RuntimeError(
            "Did not capture `[RECO] Diagram generated` log line. "
            "Is diagram_mixin.py still emitting it at INFO level?"
        )

    svg_bytes = len(res["svg"])
    row = {
        "run": iteration,
        "cold": cold,
        "total_s": round(total, 3),
        "nad_s": capture.last_match["nad_s"],
        "svg_s": capture.last_match["svg_s"],
        "meta_s": capture.last_match["meta_s"],
        "svg_bytes": svg_bytes,
        "svg_mb": round(svg_bytes / (1024 * 1024), 2),
    }
    print(
        f"  run {iteration} ({'cold' if cold else 'warm'}): "
        f"total={row['total_s']}s  NAD={row['nad_s']}s  "
        f"SVG={row['svg_s']}s  Meta={row['meta_s']}s  "
        f"size={row['svg_mb']} MB"
    )
    return row


def main(iterations: int = 3) -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    capture = _DiagramTimingCapture()
    logging.getLogger().addHandler(capture)

    print(f"Network: {NETWORK_PATH}")
    print(f"Iterations: {iterations}\n")

    rows = [
        _run(i, cold=(i == 1), capture=capture)
        for i in range(1, iterations + 1)
    ]

    warm = [r for r in rows if not r["cold"]]
    warm_median = (
        {
            "nad_s": round(median(r["nad_s"] for r in warm), 3),
            "svg_s": round(median(r["svg_s"] for r in warm), 3),
            "meta_s": round(median(r["meta_s"] for r in warm), 3),
            "total_s": round(median(r["total_s"] for r in warm), 3),
        }
        if warm
        else None
    )

    out_file = _REPO_ROOT / "profiling_results.json"
    out_file.write_text(
        json.dumps(
            {"network_path": NETWORK_PATH, "runs": rows, "warm_median": warm_median},
            indent=2,
        )
    )
    print(f"\nSaved: {out_file}")
    if warm_median:
        print(
            f"Warm median: NAD={warm_median['nad_s']}s  "
            f"SVG={warm_median['svg_s']}s  Meta={warm_median['meta_s']}s  "
            f"total={warm_median['total_s']}s"
        )


if __name__ == "__main__":
    main()
