#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""Run every benchmark in this directory sequentially.

Handy for catching cross-cutting regressions before pushing a perf
patch. Each sub-benchmark preserves its own output (stdout only —
nothing is written to disk).
"""
from __future__ import annotations

import runpy
from pathlib import Path

BENCHMARKS = [
    "bench_load_study.py",
    "bench_topology_cache.py",
    "bench_voltage_level_queries.py",
    "bench_n1_diagram.py",
]


def main() -> None:
    root = Path(__file__).resolve().parent
    for script in BENCHMARKS:
        banner = f" ▶ {script} "
        print("\n" + "=" * 80)
        print(banner.center(80, "="))
        print("=" * 80)
        runpy.run_path(str(root / script), run_name="__main__")


if __name__ == "__main__":
    main()
