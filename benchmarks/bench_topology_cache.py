#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0

"""Breakdown of `NetworkTopologyCache(n)` initialisation.

Validates the cumulative gains of the upstream vectorisation series
(`expert_op4grid_recommender` 0.2.0.post3 → post8) documented in
`docs/performance/history/vectorize-topology-cache.md` and
`docs/performance/history/topology-cache-iter2.md`. Also exercises the narrow
`_get_switches_with_topology` / `_get_branch_with_bus_breaker_info`
variants (post6 / post8).

Usage:

    BENCH_NETWORK_PATH=/path/to/grid_dir python benchmarks/bench_topology_cache.py
"""
from __future__ import annotations

import pypowsybl as pp
import pypowsybl.network as pn

from _bench_common import NETWORK_PATH, bench


def main() -> None:
    grid = f"{NETWORK_PATH}/grid.xiidm"
    print(f"pypowsybl {pp.__version__}")
    print(f"Grid: {grid}")
    net = pn.load(grid)

    from expert_op4grid_recommender.utils.conversion_actions_repas import (
        NetworkTopologyCache,
        _is_node_breaker_network,
        _get_switches_with_topology,
        _get_injection_with_bus_breaker_info,
        _get_branch_with_bus_breaker_info,
    )

    is_nb = _is_node_breaker_network(net)
    print(f"node_breaker: {is_nb}")

    print("\n=== Individual helpers ===")
    bench(
        "_get_switches_with_topology",
        lambda: _get_switches_with_topology(net, node_breaker=is_nb),
    )
    bench(
        "_get_injection_with_bus_breaker_info (loads)",
        lambda: _get_injection_with_bus_breaker_info(net, "get_loads", node_breaker=is_nb),
    )
    bench(
        "_get_injection_with_bus_breaker_info (gens)",
        lambda: _get_injection_with_bus_breaker_info(net, "get_generators", node_breaker=is_nb),
    )
    bench(
        "_get_branch_with_bus_breaker_info (branches)",
        lambda: _get_branch_with_bus_breaker_info(net, "get_branches", node_breaker=is_nb),
    )
    bench(
        "_get_branch_with_bus_breaker_info (lines)",
        lambda: _get_branch_with_bus_breaker_info(net, "get_lines", node_breaker=is_nb),
    )

    print("\n=== Full NetworkTopologyCache(net) init ===")
    bench("NetworkTopologyCache(net)", lambda: NetworkTopologyCache(net), reps=3)


if __name__ == "__main__":
    main()
