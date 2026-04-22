# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Branch + asset flow extractors.

Both return dict-of-dicts snapshots that are cheap to compare
element-by-element downstream in :mod:`deltas`.
"""
from __future__ import annotations

from typing import Any

import numpy as np


def get_network_flows(network: Any) -> dict:
    """Extract ``p1/p2`` and ``q1/q2`` flows for every line + 2-winding transformer.

    Also extracts ``voltage_level1_id`` / ``voltage_level2_id`` so the
    frontend can determine which terminal corresponds to the SLD's VL.

    Returns a dict of six ``{branch_id: value}`` sub-dicts: ``p1, p2,
    q1, q2, vl1, vl2``.
    """
    import pandas as pd

    cols = ["p1", "p2", "q1", "q2", "voltage_level1_id", "voltage_level2_id"]
    lines = network.get_lines()[cols]
    trafos = network.get_2_windings_transformers()[cols]

    combined = pd.concat([lines, trafos])
    combined[["p1", "p2", "q1", "q2"]] = combined[["p1", "p2", "q1", "q2"]].fillna(0.0)

    return {
        "p1": combined["p1"].to_dict(),
        "p2": combined["p2"].to_dict(),
        "q1": combined["q1"].to_dict(),
        "q2": combined["q2"].to_dict(),
        "vl1": combined["voltage_level1_id"].to_dict(),
        "vl2": combined["voltage_level2_id"].to_dict(),
    }


def get_asset_flows(network: Any) -> dict:
    """Return ``{asset_id: {'p', 'q'}}`` for every load + generator.

    Narrow pypowsybl query + numpy vectorisation — the previous
    ``df.loc[lid, 'p']`` loop over 14 880 rows was ~1.17 s/call on the
    PyPSA-EUR France grid. This path runs in ~75 ms (15× faster).
    """
    loads = network.get_loads(attributes=["p", "q"])
    gens = network.get_generators(attributes=["p", "q"])

    loads_p = np.nan_to_num(loads["p"].values, nan=0.0)
    loads_q = np.nan_to_num(loads["q"].values, nan=0.0)
    gens_p = np.nan_to_num(gens["p"].values, nan=0.0)
    gens_q = np.nan_to_num(gens["q"].values, nan=0.0)

    flows: dict[str, dict[str, float]] = {}
    for i, lid in enumerate(loads.index.tolist()):
        flows[lid] = {"p": float(loads_p[i]), "q": float(loads_q[i])}
    for i, gid in enumerate(gens.index.tolist()):
        flows[gid] = {"p": float(gens_p[i]), "q": float(gens_q[i])}
    return flows
