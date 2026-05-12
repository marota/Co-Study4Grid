# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Pre-flight validation of action dictionary entries against the loaded network.

Sampling models (Random / RandomOverflow) cannot rely on simulation to
weed out actions that target equipment absent from the current network
— they just pick uniformly. A user pointing the app at a small grid
but a large action dictionary (built for a wider grid) ends up with
suggestions whose target VoltageLevelId / line id is unknown to the
network, which then surface as "Network element not found" in the UI.

This module provides a defensive existence check the random recommenders
apply before sampling. It is purely a sanity filter — it is NOT a
substitute for the expert rule validator, which restricts actions to
the overflow-graph paths.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable, Optional, Tuple

logger = logging.getLogger(__name__)


def _network_existence_sets(network: Any) -> Optional[Tuple[set, set]]:
    """Read VL and branch identifiers off a pypowsybl Network.

    Returns ``(vl_ids, branch_ids)`` or ``None`` when the network is
    missing or the expected API is unavailable. ``branch_ids`` is the
    union of lines and 2-winding transformers — anything addressable
    via ``set_bus.lines_or_id`` / ``set_bus.lines_ex_id`` in a grid2op
    action.
    """
    if network is None:
        return None
    try:
        vl_ids = set(network.get_voltage_levels().index)
    except Exception as e:
        logger.debug("Cannot read voltage levels from network: %s", e)
        return None
    try:
        line_ids = set(network.get_lines().index)
    except Exception as e:
        logger.debug("Cannot read lines from network: %s", e)
        line_ids = set()
    try:
        twt_ids = set(network.get_2_windings_transformers().index)
    except Exception as e:
        logger.debug("Cannot read 2-winding transformers from network: %s", e)
        twt_ids = set()
    return vl_ids, line_ids | twt_ids


def _action_targets_known_elements(
    entry: Any,
    vl_ids: set,
    branch_ids: set,
) -> bool:
    """Return True when every target referenced by the dict entry exists.

    Checked references:

    - ``VoltageLevelId`` / ``voltage_level_id``         (switch-based actions)
    - ``content.set_bus.lines_or_id`` / ``lines_ex_id`` (line actions)

    An entry that does NOT mention any of these is accepted by default
    — we can't prove non-existence, so we let the simulation pipeline
    decide (it gracefully no-ops on unresolvable targets).
    """
    if not isinstance(entry, dict):
        return False

    vl = entry.get("VoltageLevelId") or entry.get("voltage_level_id")
    if vl and vl not in vl_ids:
        return False

    content = entry.get("content")
    if isinstance(content, dict):
        set_bus = content.get("set_bus")
        if isinstance(set_bus, dict):
            for key in ("lines_or_id", "lines_ex_id"):
                ids = set_bus.get(key)
                if isinstance(ids, dict):
                    for branch_id in ids:
                        if branch_id not in branch_ids:
                            return False

    return True


def filter_to_existing_network_elements(
    candidate_ids: Iterable[str],
    dict_action: Any,
    network: Any,
) -> list[str]:
    """Drop candidate action IDs whose targets are unknown to the network.

    Conservative when network introspection fails (returns the input
    list unchanged) — we never want to silently empty the candidate
    pool just because the existence check itself errored.
    """
    sets = _network_existence_sets(network)
    if sets is None:
        return list(candidate_ids)
    vl_ids, branch_ids = sets

    if not dict_action:
        return list(candidate_ids)

    kept: list[str] = []
    dropped: list[str] = []
    for aid in candidate_ids:
        entry = dict_action.get(aid)
        if entry is None:
            continue
        if _action_targets_known_elements(entry, vl_ids, branch_ids):
            kept.append(aid)
        else:
            dropped.append(aid)

    if dropped:
        logger.info(
            "[network-existence-filter] dropped %d action(s) whose target "
            "VL / line is not on the loaded network (sample: %s)",
            len(dropped), dropped[:3],
        )
    return kept
