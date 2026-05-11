# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Synthetic action factories used by :class:`RandomRecommender`.

The random model is meant as a sanity-check baseline: it augments the
user-supplied action dictionary with simple reconnection, load-shedding
and curtailment actions derived from the post-fault observation, then
picks uniformly at random. The factories below are best-effort — any
action the underlying ``env.action_space`` rejects is skipped silently
(logged at debug level).
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Iterable, Optional

logger = logging.getLogger(__name__)


def build_reconnection_actions(
    env: Any,
    non_connected_reconnectable_lines: Optional[Iterable[str]],
) -> Dict[str, Any]:
    """One reconnection action per known reconnectable line."""
    out: Dict[str, Any] = {}
    for line in non_connected_reconnectable_lines or []:
        action_id = f"random_reco_{line}"
        content = {
            "set_bus": {
                "lines_or_id": {line: 1},
                "lines_ex_id": {line: 1},
            }
        }
        try:
            out[action_id] = env.action_space(content)
        except Exception as e:
            logger.debug("Skipping reconnection of %s: %s", line, e)
    return out


def build_load_shedding_actions(
    env: Any,
    obs: Any,
    k: int = 8,
    fraction: float = 0.1,
) -> Dict[str, Any]:
    """Up to ``k`` synthetic shedding actions, one per non-zero load.

    Each entry sheds ``fraction`` of the load's current MW. Skips loads
    with zero (or unknown) consumption.
    """
    out: Dict[str, Any] = {}
    if not hasattr(obs, "name_load") or not hasattr(obs, "load_p"):
        return out
    names = list(obs.name_load)
    loads_p = list(obs.load_p)
    for load_name, load_p in zip(names[:k], loads_p[:k]):
        try:
            load_p_value = float(load_p)
        except (TypeError, ValueError):
            continue
        if load_p_value <= 0:
            continue
        action_id = f"random_shed_{load_name}"
        # `redispatch` is the only universal handle we have on the
        # action space across grid2op + pypowsybl backends; some grids
        # may reject negative load redispatch — best-effort.
        content = {"redispatch": [(load_name, -fraction * load_p_value)]}
        try:
            out[action_id] = env.action_space(content)
        except Exception as e:
            logger.debug("Skipping shedding of %s: %s", load_name, e)
    return out


def build_curtailment_actions(
    env: Any,
    obs: Any,
    k: int = 8,
    fraction: float = 0.1,
) -> Dict[str, Any]:
    """Up to ``k`` synthetic curtailment actions, one per non-zero generator."""
    out: Dict[str, Any] = {}
    if not hasattr(obs, "name_gen") or not hasattr(obs, "gen_p"):
        return out
    names = list(obs.name_gen)
    gen_p = list(obs.gen_p)
    for gen_name, gen_p_value in zip(names[:k], gen_p[:k]):
        try:
            gen_p_float = float(gen_p_value)
        except (TypeError, ValueError):
            continue
        if gen_p_float <= 0:
            continue
        action_id = f"random_curt_{gen_name}"
        content = {"curtail": [(gen_name, -fraction * gen_p_float)]}
        try:
            out[action_id] = env.action_space(content)
        except Exception as e:
            logger.debug("Skipping curtailment of %s: %s", gen_name, e)
    return out
