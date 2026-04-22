# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Shared helpers for the Co-Study4Grid performance benchmarks.

Each script in this directory measures a distinct slice of the Load
Study critical path so that regressions can be caught on the real
PyPSA-EUR France 400 kV grid without standing up the full web stack.

Usage from each benchmark:

    from _bench_common import bench, setup_service, NETWORK_PATH, ACTION_FILE

    net = pn.load(NETWORK_PATH + "/grid.xiidm")
    bench("my op", lambda: my_op(net))
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from typing import Callable, Iterable

# Make `expert_backend` importable when running a benchmark directly.
_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(_REPO_ROOT))

# Default reference grid — overridable via env var so benchmarks can
# also run on smaller test cases in CI.
NETWORK_PATH = os.environ.get(
    "BENCH_NETWORK_PATH",
    "/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_20240828T0100Z",
)
ACTION_FILE = os.environ.get(
    "BENCH_ACTION_FILE",
    "/home/marotant/dev/Expert_op4grid_recommender/data/action_space/"
    "reduced_model_actions_20240828T0100Z_dijon.json",
)


def bench(label: str, fn: Callable, reps: int = 5, width: int = 60) -> object:
    """Time `fn` over `reps` runs and print median/min.

    Returns the last call's return value so the caller can assert
    semantic equivalence across variants.
    """
    dts: list[float] = []
    ret = None
    for _ in range(reps):
        t0 = time.perf_counter()
        ret = fn()
        dts.append((time.perf_counter() - t0) * 1000)
    dts.sort()
    med = dts[len(dts) // 2]
    mn = dts[0]
    print(f"  {label:<{width}} median={med:>7.1f} ms  min={mn:>7.1f}")
    return ret


def setup_service(
    network_path: str = NETWORK_PATH,
    action_file: str = ACTION_FILE,
    wait_for_nad_prefetch: bool = True,
) -> tuple[object, object, float]:
    """Prepare `network_service` + `recommender_service` with a
    realistic config, mimicking `/api/config` from the UI.

    Returns `(network_service, recommender_service, dt_setup_ms)`.
    """
    from expert_backend.services.network_service import network_service
    from expert_backend.services.recommender_service import recommender_service

    settings = SimpleNamespace(
        network_path=network_path,
        action_file_path=action_file,
        layout_path=f"{network_path}/grid_layout.json",
        min_line_reconnections=2.0,
        min_close_coupling=3.0,
        min_open_coupling=2.0,
        min_line_disconnections=3.0,
        n_prioritized_actions=10,
        monitoring_factor=0.95,
        pre_existing_overload_threshold=0.02,
        ignore_reconnections=False,
        pypowsybl_fast_mode=True,
        min_pst=1.5,
        min_load_shedding=2.5,
        min_renewable_curtailment_actions=1,
        lines_monitoring_path=None,
        do_visualization=True,
    )

    t0 = time.perf_counter()
    recommender_service.reset()
    network_service.load_network(network_path)
    recommender_service.update_config(settings)
    if wait_for_nad_prefetch:
        ev = getattr(recommender_service, "_prefetched_base_nad_event", None)
        if ev is not None:
            ev.wait(timeout=30)
    dt_setup = (time.perf_counter() - t0) * 1000
    return network_service, recommender_service, dt_setup


def timed(name: str, orig: Callable, store: dict) -> Callable:
    """Wrap `orig` so every call appends its duration to `store[name]`.

    Used to instrument a live service method without changing its code:

        steps = {}
        mixin._generate_diagram = timed("generate", mixin._generate_diagram, steps)
        mixin.get_n1_diagram(...)
        print(steps)
    """
    def wrapped(*a, **kw):
        t0 = time.perf_counter()
        try:
            return orig(*a, **kw)
        finally:
            store.setdefault(name, []).append((time.perf_counter() - t0) * 1000)
    return wrapped


def print_step_summary(steps: dict, header: str = "Step timings") -> None:
    print(f"\n--- {header} ---")
    for k, dts in steps.items():
        if not dts:
            continue
        total = sum(dts)
        last = dts[-1]
        print(f"  {k:<55}  last={last:>8.1f} ms  count={len(dts)}  total={total:>8.1f} ms")
