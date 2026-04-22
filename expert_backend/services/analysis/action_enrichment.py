# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Stateless helpers that enrich raw prioritized actions.

These used to live as instance methods on ``AnalysisMixin`` where each
reached into ``self._analysis_context``, ``self._dict_action``, and the
``network_service`` singleton.  Pulled out here as pure functions that
take their dependencies as arguments — makes them unit-testable with
plain mocks and documents the data flow explicitly.
"""
from __future__ import annotations

import logging
from typing import Any, Iterable

from expert_backend.services.sanitize import sanitize_for_json

logger = logging.getLogger(__name__)

# Topology fields pypowsybl Actions expose as attributes.  Both dict-style
# action objects (restored from saved sessions) and attribute-style
# objects (standard grid2op) are handled.
ACTION_TOPOLOGY_FIELDS: tuple[str, ...] = (
    "lines_ex_bus",
    "lines_or_bus",
    "gens_bus",
    "loads_bus",
    "pst_tap",
    "substations",
    "switches",
    "loads_p",
    "gens_p",
)

# Non-convergence marker substrings used across the expert_op4grid
# discovery pipeline.  Exported so tests can pin the exact contract.


def _get(action_obj: Any, attr: str) -> Any:
    """Read ``attr`` from a grid2op Action or a plain dict."""
    val = getattr(action_obj, attr, None)
    if val is None and isinstance(action_obj, dict):
        val = action_obj.get(attr)
    return val


def normalise_non_convergence(exc: Any) -> str | None:
    """Convert an exception (or list of exceptions) to a user-facing message."""
    if not exc:
        return None
    if isinstance(exc, list):
        return "; ".join(str(e) for e in exc)
    return str(exc)


def derive_non_convergence(action_data: dict) -> str | None:
    """Resolve the non-convergence field, preferring the explicit one then the observation's."""
    explicit = action_data.get("non_convergence")
    if explicit:
        return explicit
    obs = action_data.get("observation")
    if obs is None:
        return None
    info = getattr(obs, "_last_info", {}) or {}
    return normalise_non_convergence(info.get("exception"))


def extract_action_topology(action_obj: Any, action_id: str, dict_action: dict | None) -> dict:
    """Read topology fields off an action and backfill ``switches`` from the dict entry."""
    topo: dict[str, Any] = {}
    for field in ACTION_TOPOLOGY_FIELDS:
        val = _get(action_obj, field)
        topo[field] = sanitize_for_json(val) if val else {}

    # grid2op Actions may not carry 'switches'; the raw dict_action entry
    # always does for switch-based actions.
    if not topo.get("switches") and dict_action:
        entry = dict_action.get(action_id)
        if entry:
            sw = entry.get("switches")
            if not sw:
                content = entry.get("content")
                if isinstance(content, dict):
                    sw = content.get("switches")
            if sw:
                topo["switches"] = sanitize_for_json(sw)
    return topo


def compute_lines_overloaded_after(
    raw_loa: Iterable[str] | None,
    rho_after_raw: list[float] | None,
    lines_overloaded_names: list[str] | None,
    max_rho_raw: float | None,
    max_rho_line: str,
) -> list[str]:
    """Compute the post-action list of still-overloaded lines.

    The discovery engine sometimes leaves this empty for suggested
    actions — we reconstruct it by pairing ``rho_after_raw`` with
    ``lines_overloaded_names`` (still >= 1.0) and adding the
    ``max_rho_line`` when it crosses 1.0 too.
    """
    if raw_loa:
        return list(raw_loa)
    computed: list[str] = []
    if lines_overloaded_names and rho_after_raw is not None:
        for i, name in enumerate(lines_overloaded_names):
            if i >= len(rho_after_raw):
                break
            val = rho_after_raw[i]
            if val is not None and val >= 1.0:
                computed.append(name)
    if (
        max_rho_raw is not None
        and max_rho_raw >= 1.0
        and max_rho_line
        and max_rho_line not in computed
    ):
        computed.append(max_rho_line)
    return computed


def _gather_load_shed_names(action_obj: Any, content: Any) -> list[str]:
    """Collect load names shed by an action — legacy bus=-1 and new ``loads_p`` formats."""
    shed: list[str] = []
    loads_bus = _get(action_obj, "loads_bus")
    if loads_bus:
        shed.extend(name for name, bus in loads_bus.items() if bus == -1)

    loads_p = _get(action_obj, "loads_p")
    if not loads_p and isinstance(content, dict):
        loads_p = content.get("set_load_p")
    if loads_p and isinstance(loads_p, dict):
        for name in loads_p:
            if name not in shed:
                shed.append(name)
    return shed


def compute_load_shedding_details(
    action_data: dict,
    obs_n1: Any,
    network_service: Any,
) -> list[dict] | None:
    """Per-load shedding MW details by comparing N-1 and action observations.

    Returns ``[{load_name, voltage_level_id, shedded_mw}, ...]`` or ``None``.
    Supports both legacy bus disconnection (bus=-1) and new power reduction
    (loads_p / set_load_p) formats from ``expert_op4grid_recommender``.
    """
    action_obj = action_data.get("action")
    if action_obj is None:
        return None

    content = action_data.get("content")
    shed_names = _gather_load_shed_names(action_obj, content)
    if not shed_names:
        return None

    obs_action = action_data.get("observation")
    if obs_action is None:
        return None

    details: list[dict] = []
    for load_name in shed_names:
        shedded_mw = 0.0
        if obs_n1 is not None:
            try:
                idx = list(obs_action.name_load).index(load_name)
                p_before = float(obs_n1.load_p[idx])
                p_after = float(obs_action.load_p[idx])
                shedded_mw = abs(p_before - p_after)
            except (ValueError, IndexError):
                shedded_mw = 0.0

        vl_id = None
        try:
            vl_id = network_service.get_load_voltage_level(load_name)
        except Exception as e:
            logger.debug("Suppressed exception: %s", e)

        details.append({
            "load_name": load_name,
            "voltage_level_id": vl_id,
            "shedded_mw": round(shedded_mw, 1),
        })
    return details or None


def _gather_curtailment_names(action_obj: Any, content: Any) -> list[str]:
    """Collect generator names curtailed by an action — legacy bus=-1 and new ``gens_p`` formats."""
    names: list[str] = []
    gens_bus = _get(action_obj, "gens_bus")
    if gens_bus:
        names.extend(name for name, bus in gens_bus.items() if bus == -1)

    gens_p = _get(action_obj, "gens_p")
    if not gens_p and isinstance(content, dict):
        gens_p = content.get("set_gen_p")
    if gens_p and isinstance(gens_p, dict):
        for name in gens_p:
            if name not in names:
                names.append(name)
    return names


def _gen_active_power(obs: Any, idx: int) -> float:
    """Return ``abs(gen_p[idx])`` preferring ``gen_p`` (new) over ``prod_p`` (legacy)."""
    if hasattr(obs, "gen_p"):
        return float(obs.gen_p[idx])
    return float(obs.prod_p[idx])


def is_renewable_gen(gen_name: str, obs: Any, network_service: Any) -> bool:
    """Detect WIND / SOLAR generators — obs.gen_type first, then network, then name heuristic."""
    if obs is not None and hasattr(obs, "gen_type") and hasattr(obs, "name_gen"):
        try:
            idx = list(obs.name_gen).index(gen_name)
            gen_type = str(obs.gen_type[idx]).upper()
            if gen_type in {"WIND", "SOLAR"}:
                return True
        except (ValueError, IndexError):
            pass

    try:
        gen_type = network_service.get_generator_type(gen_name)
        if gen_type:
            return str(gen_type).upper() in {"WIND", "SOLAR"}
    except Exception as e:
        logger.debug("Suppressed exception: %s", e)

    gn = gen_name.upper()
    return "WIND" in gn or "SOLAR" in gn or "PV" in gn or "EOL" in gn


def compute_curtailment_details(
    action_data: dict,
    obs_n1: Any,
    network_service: Any,
    is_renewable_fn: Any = None,
) -> list[dict] | None:
    """Per-generator curtailment MW details, filtered to renewable generators.

    ``is_renewable_fn(gen_name, obs)`` is injected so callers (mixin,
    tests) can plug their own renewable-detection logic without
    reaching into the module internals. Falls back to the local
    :func:`is_renewable_gen` helper when not provided.
    """
    if is_renewable_fn is None:
        def is_renewable_fn(gen_name, obs):
            return is_renewable_gen(gen_name, obs, network_service)

    action_obj = action_data.get("action")
    if action_obj is None:
        return None

    content = action_data.get("content")
    curtailed = _gather_curtailment_names(action_obj, content)
    if not curtailed:
        return None

    obs_action = action_data.get("observation")
    obs_for_type = obs_action or obs_n1

    # No observation at all — fall back to disconnected_mw distributed over
    # the (renewable) gens. Rare path, but used during the discovery stage.
    if obs_action is None:
        disconnected_mw = action_data.get("disconnected_mw")
        if not disconnected_mw:
            return None
        renewable = [g for g in curtailed if is_renewable_fn(g, obs_for_type)]
        if not renewable:
            return None
        mw_per_gen = disconnected_mw / len(renewable)
        details: list[dict] = []
        for gen_name in renewable:
            vl_id = None
            try:
                vl_id = network_service.get_generator_voltage_level(gen_name)
            except Exception as e:
                logger.debug("Suppressed exception: %s", e)
            details.append({
                "gen_name": gen_name,
                "voltage_level_id": vl_id,
                "curtailed_mw": round(mw_per_gen, 1),
            })
        return details or None

    details = []
    for gen_name in curtailed:
        if not is_renewable_fn(gen_name, obs_for_type):
            continue
        curtailed_mw = 0.0
        if obs_n1 is not None:
            try:
                idx = list(obs_action.name_gen).index(gen_name)
                p_before = _gen_active_power(obs_n1, idx)
                p_after = _gen_active_power(obs_action, idx)
                curtailed_mw = abs(p_before - p_after)
            except (ValueError, IndexError, AttributeError):
                curtailed_mw = 0.0

        vl_id = None
        try:
            vl_id = network_service.get_generator_voltage_level(gen_name)
        except Exception as e:
            logger.debug("Suppressed exception: %s", e)

        details.append({
            "gen_name": gen_name,
            "voltage_level_id": vl_id,
            "curtailed_mw": round(curtailed_mw, 1),
        })
    return details or None


def _gather_pst_targets(action_obj: Any, content: Any, action_topology: Any) -> dict[str, int]:
    """Collect PST targets from the first source that has them."""
    entries: dict[str, int] = {}

    pst_tap_attr = _get(action_obj, "pst_tap")
    if pst_tap_attr and isinstance(pst_tap_attr, dict):
        for name, tap in pst_tap_attr.items():
            entries[name] = int(tap)

    if not entries and isinstance(content, dict):
        pst = content.get("pst_tap", {})
        if pst and isinstance(pst, dict):
            for name, tap in pst.items():
                entries[name] = int(tap)

    if not entries and isinstance(action_topology, dict):
        pst = action_topology.get("pst_tap", {})
        if pst and isinstance(pst, dict):
            for name, tap in pst.items():
                entries[name] = int(tap)

    return entries


def compute_pst_details(
    action_data: dict,
    pst_tap_info_fn: Any,
) -> list[dict] | None:
    """Per-PST tap change details, including current bounds.

    ``pst_tap_info_fn(pst_name) -> {'tap', 'low_tap', 'high_tap'} | None`` is
    injected so tests can run without a real network manager.
    """
    action_obj = action_data.get("action")
    content = action_data.get("content")
    if action_obj is None and content is None:
        return None

    pst_entries = _gather_pst_targets(action_obj, content, action_data.get("action_topology", {}))
    if not pst_entries:
        return None

    details: list[dict] = []
    for pst_name, tap_position in pst_entries.items():
        low_tap = None
        high_tap = None
        if pst_tap_info_fn is not None:
            try:
                info = pst_tap_info_fn(pst_name)
                if info:
                    low_tap = info.get("low_tap")
                    high_tap = info.get("high_tap")
            except Exception as e:
                logger.debug("Suppressed exception: %s", e)
        details.append({
            "pst_name": pst_name,
            "tap_position": tap_position,
            "low_tap": low_tap,
            "high_tap": high_tap,
        })
    return details or None


def scale_rho_series(values: list[float] | None, monitoring_factor: float) -> list[float] | None:
    """Scale a raw rho series by ``monitoring_factor`` (percentage → operational)."""
    if values is None:
        return None
    return [r * monitoring_factor for r in values]
