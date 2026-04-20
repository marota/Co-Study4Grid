#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""Benchmark `/api/voltage-levels`, `/api/nominal-voltages` and the
operational-limits query used by `/api/branches::get_monitored_elements`.

Documents the narrow-query + vectorisation gains from
`docs/performance/history/narrow-voltage-level-queries.md`:

  - `/api/voltage-levels`   7.5 ms →  4.5 ms    (attributes=[])
  - `/api/nominal-voltages` 144 ms  →  5.7 ms   (narrow + no iterrows, ~25×)
  - get_monitored_elements  265 ms  → 175 ms    (attributes=[])
  - _get_switches_with_topology 174 ms → 141 ms (drop `kind` attr)

Usage:

    BENCH_NETWORK_PATH=/path/to/grid_dir python benchmarks/bench_voltage_level_queries.py
"""
from __future__ import annotations

import pypowsybl.network as pn

from _bench_common import NETWORK_PATH, bench


def main() -> None:
    from expert_backend.services.network_service import NetworkService

    grid = f"{NETWORK_PATH}/grid.xiidm"
    net = pn.load(grid)
    svc = NetworkService()
    svc.network = net

    print(f"Grid: {grid}")

    print("\n=== /api/voltage-levels ===")
    bench("default get_voltage_levels()", lambda: net.get_voltage_levels())
    bench("narrow get_voltage_levels(attributes=[])", lambda: net.get_voltage_levels(attributes=[]))
    vl_list = bench("NetworkService.get_voltage_levels", svc.get_voltage_levels)
    print(f"  returned {len(vl_list)} VLs")

    print("\n=== /api/nominal-voltages ===")
    nv = bench("NetworkService.get_nominal_voltages", svc.get_nominal_voltages)
    print(f"  returned {len(nv)} mappings, unique kV: {sorted(set(nv.values()))}")

    print("\n=== /api/branches::get_monitored_elements ===")
    bench(
        "default get_operational_limits()",
        lambda: net.get_operational_limits(),
    )
    bench(
        "narrow get_operational_limits(attributes=[])",
        lambda: net.get_operational_limits(attributes=[]),
    )
    mon = bench("NetworkService.get_monitored_elements", svc.get_monitored_elements)
    print(f"  returned {len(mon)} monitored elements")

    print("\n=== _get_switches_with_topology ===")
    from expert_op4grid_recommender.utils.conversion_actions_repas import (
        _get_switches_with_topology,
        _is_node_breaker_network,
    )
    is_nb = _is_node_breaker_network(net)
    sw = bench(
        "_get_switches_with_topology (post8 narrow, no `kind`)",
        lambda: _get_switches_with_topology(net, node_breaker=is_nb),
    )
    print(f"  shape={sw.shape}  cols={list(sw.columns)}")


if __name__ == "__main__":
    main()
