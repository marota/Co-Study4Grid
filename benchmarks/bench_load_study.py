#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""End-to-end profile of a Load Study backend round-trip.

Mimics what `/api/config` + the 4 subsequent parallel XHRs do on a
real UI click, without the HTTP stack. Used to track the cumulative
wall-clock gains documented in `docs/perf-loading-parallel.md`
(v6 → v18+ trace entries).

Usage:

    BENCH_NETWORK_PATH=/path/to/grid_dir python benchmarks/bench_load_study.py
"""
from __future__ import annotations

import time
from types import SimpleNamespace

from _bench_common import ACTION_FILE, NETWORK_PATH


def main() -> None:
    print(f"Network:    {NETWORK_PATH}")
    print(f"Action file: {ACTION_FILE}")

    from expert_backend.services.network_service import network_service
    from expert_backend.services.recommender_service import recommender_service

    settings = SimpleNamespace(
        network_path=NETWORK_PATH,
        action_file_path=ACTION_FILE,
        layout_path=f"{NETWORK_PATH}/grid_layout.json",
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

    # Step 1 — recommender_service.reset() (clears all caches; drains
    # any stale NAD prefetch from the previous run).
    t0 = time.perf_counter()
    recommender_service.reset()
    dt_reset = (time.perf_counter() - t0) * 1000

    # Step 2 — pypowsybl network parse (~2 s on the PyPSA-EUR France
    # 118 MB xiidm, dominated by JNI serialisation).
    t0 = time.perf_counter()
    network_service.load_network(NETWORK_PATH)
    dt_load = (time.perf_counter() - t0) * 1000

    # Step 3 — update_config: the big one. Spawns the base-NAD
    # prefetch worker early (see docs/perf-nad-prefetch-earlier-spawn.md),
    # runs enrich_actions_lazy (NetworkTopologyCache — now ~700 ms
    # since 0.2.0.post5+post6), sets up SimulationEnvironment.
    t0 = time.perf_counter()
    recommender_service.update_config(settings)
    dt_update = (time.perf_counter() - t0) * 1000

    # Step 4 — the 4 post-config XHRs fired in parallel by the frontend.
    t0 = time.perf_counter()
    total_lines = len(network_service.get_disconnectable_elements())
    monitored = len(network_service.get_monitored_elements())
    vls = len(network_service.get_voltage_levels())
    nominals = len(network_service.get_nominal_voltages())
    dt_resp = (time.perf_counter() - t0) * 1000

    total = dt_reset + dt_load + dt_update + dt_resp

    print(f"\n{'reset()':<32} {dt_reset:>8.1f} ms")
    print(f"{'load_network':<32} {dt_load:>8.1f} ms")
    print(f"{'update_config':<32} {dt_update:>8.1f} ms")
    print(f"{'response XHRs (4)':<32} {dt_resp:>8.1f} ms")
    print(f"{'TOTAL':<32} {total:>8.1f} ms ({total / 1000:.1f} s)")
    print(
        f"\nCounts: lines={total_lines}  monitored={monitored}  "
        f"vls={vls}  nominals={nominals}"
    )

    # Step 5 — NAD prefetch overflow: time spent AFTER the 4 XHRs
    # waiting for the background worker to finish. Should be ~0 ms
    # if the prefetch was spawned early enough in update_config.
    ev = getattr(recommender_service, "_prefetched_base_nad_event", None)
    if ev is not None:
        t0 = time.perf_counter()
        ev.wait(timeout=30)
        dt_wait = (time.perf_counter() - t0) * 1000
        print(f"\nNAD worker overflow after endpoint: {dt_wait:.1f} ms")


if __name__ == "__main__":
    main()
