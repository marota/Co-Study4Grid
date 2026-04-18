# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

"""Analysis mixin for RecommenderService.

Contains contingency analysis (step1/step2), action enrichment,
and MW/tap start computation methods.
"""

import glob
import io
import logging
import os
import threading
import time

import numpy as np

from expert_op4grid_recommender import config
from expert_op4grid_recommender.environment import load_interesting_lines
from expert_op4grid_recommender.main import (
    Backend, run_analysis, run_analysis_step1, run_analysis_step2,
    run_analysis_step2_graph, run_analysis_step2_discovery,
)
from expert_op4grid_recommender.utils.superposition import get_virtual_line_flow

from expert_backend.services.sanitize import sanitize_for_json

logger = logging.getLogger(__name__)


class AnalysisMixin:
    """Mixin providing contingency analysis and action enrichment methods."""

    def _enrich_actions(self, prioritized_actions_dict, lines_overloaded_names=None):
        """Helper to convert raw prioritized actions into enriched dict for JSON response.

        The discovery engine returns raw obs.rho values (physical loading
        fraction where 1.0 = 100% of the thermal limit).  We scale them
        by monitoring_factor so the frontend displays operational loading
        percentages (relative to the reduced operational limit).

        Args:
            prioritized_actions_dict: raw prioritized actions dict from the
                discovery engine.
            lines_overloaded_names: ordered list of N-1 overloaded line
                names (same ordering as the rho_before / rho_after arrays
                in action_data). Used to compute lines_overloaded_after
                for suggested actions that the discovery engine does not
                populate natively — without this, frontend overload
                highlights silently disappear on the Action tab for any
                persistent / newly-emerged overload.
        """
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        enriched_actions = {}

        for action_id, action_data in prioritized_actions_dict.items():
            rho_before_raw = action_data.get("rho_before")
            rho_after_raw = action_data.get("rho_after")
            max_rho_raw = action_data.get("max_rho")

            rho_before = [r * monitoring_factor for r in rho_before_raw] if rho_before_raw is not None else None
            rho_after = [r * monitoring_factor for r in rho_after_raw] if rho_after_raw is not None else None
            max_rho = (max_rho_raw * monitoring_factor) if max_rho_raw is not None else None

            non_convergence = action_data.get("non_convergence")
            if not non_convergence:
                obs = action_data.get("observation")
                if obs:
                    info = getattr(obs, "_last_info", {})
                    exc = info.get("exception")
                    if exc:
                        if isinstance(exc, list):
                            non_convergence = "; ".join([str(e) for e in exc])
                        else:
                            non_convergence = str(exc)

            # Compute lines_overloaded_after if the discovery engine did
            # not populate it. We pair rho_after_raw (N-1 overloaded
            # subset, unscaled) with lines_overloaded_names and keep
            # everything that is still >= 1.0 (i.e. still overloaded).
            # We also merge in max_rho_line when its raw value is >= 1.0
            # so new overloads introduced by the action are caught.
            raw_loa = action_data.get("lines_overloaded_after")
            if raw_loa is None or len(raw_loa) == 0:
                computed_loa: list[str] = []
                max_rho_line = action_data.get("max_rho_line", "")
                if lines_overloaded_names and rho_after_raw is not None:
                    for i, name in enumerate(lines_overloaded_names):
                        if i >= len(rho_after_raw):
                            break
                        val = rho_after_raw[i]
                        if val is not None and val >= 1.0:
                            computed_loa.append(name)
                if (
                    max_rho_raw is not None
                    and max_rho_raw >= 1.0
                    and max_rho_line
                    and max_rho_line not in computed_loa
                ):
                    computed_loa.append(max_rho_line)
                lines_overloaded_after = computed_loa
            else:
                lines_overloaded_after = list(raw_loa)

            enriched_actions[action_id] = {
                "description_unitaire": action_data.get("description_unitaire") or "No description available",
                "rho_before": sanitize_for_json(rho_before),
                "rho_after": sanitize_for_json(rho_after),
                "max_rho": sanitize_for_json(max_rho),
                "max_rho_line": action_data.get("max_rho_line", ""),
                "is_rho_reduction": bool(action_data.get("is_rho_reduction", False)),
                "non_convergence": non_convergence,
                "lines_overloaded_after": sanitize_for_json(lines_overloaded_after),
            }

            # Extract topology from the underlying action object
            action_obj = action_data.get("action")
            if action_obj is not None:
                topo = {}
                # pypowsybl Actions use these fields (including new power reduction fields)
                for field in ("lines_ex_bus", "lines_or_bus", "gens_bus", "loads_bus", "pst_tap", "substations", "switches", "loads_p", "gens_p"):
                    val = getattr(action_obj, field, None)
                    if val is None and isinstance(action_obj, dict):
                        val = action_obj.get(field)
                    topo[field] = sanitize_for_json(val) if val else {}

                # Supplement switches from the original action dictionary entry
                # (grid2op Action objects may not carry the 'switches' attribute;
                #  the raw dict_action entry always has it for switch-based actions)
                if not topo.get("switches") and self._dict_action:
                    dict_entry = self._dict_action.get(action_id)
                    if dict_entry:
                        sw = dict_entry.get("switches")
                        if not sw:
                            content = dict_entry.get("content")
                            if isinstance(content, dict):
                                sw = content.get("switches")
                        if sw:
                            topo["switches"] = sanitize_for_json(sw)

                enriched_actions[action_id]["action_topology"] = topo

            # Detect load shedding actions and compute shedded MW per load
            load_shedding = self._compute_load_shedding_details(action_data)
            if load_shedding:
                enriched_actions[action_id]["load_shedding_details"] = load_shedding

            # Detect renewable curtailment actions and compute curtailed MW per generator
            curtailment = self._compute_curtailment_details(action_data)
            if curtailment:
                enriched_actions[action_id]["curtailment_details"] = curtailment

            # Detect PST actions and compute tap details with bounds
            pst_details = self._compute_pst_details(action_data)
            if pst_details:
                enriched_actions[action_id]["pst_details"] = pst_details

        return enriched_actions

    def _compute_load_shedding_details(self, action_data, obs_n1=None):
        """Compute per-load shedding details by comparing N-1 and action observations.

        Returns a list of {load_name, voltage_level_id, shedded_mw} or None.
        Supports both legacy bus disconnection (bus = -1) and new power reduction
        (loads_p / set_load_p) formats from expert_op4grid_recommender.
        """
        action_obj = action_data.get("action")
        if action_obj is None:
            return None

        # Collect affected load names from both legacy and new formats
        shed_load_names = []

        # Legacy format: loads_bus with bus = -1
        loads_bus = getattr(action_obj, "loads_bus", None)
        if loads_bus is None and isinstance(action_obj, dict):
            loads_bus = action_obj.get("loads_bus")
        if loads_bus:
            shed_load_names.extend(name for name, bus in loads_bus.items() if bus == -1)

        # New power reduction format: loads_p (active power setpoint changes)
        loads_p = getattr(action_obj, "loads_p", None)
        if loads_p is None and isinstance(action_obj, dict):
            loads_p = action_obj.get("loads_p")
        if not loads_p:
            # Also check inside action content for set_load_p
            content = action_data.get("content")
            if isinstance(content, dict):
                loads_p = content.get("set_load_p")
        if loads_p and isinstance(loads_p, dict):
            for name in loads_p:
                if name not in shed_load_names:
                    shed_load_names.append(name)

        if not shed_load_names:
            return None

        obs_action = action_data.get("observation")
        if obs_action is None:
            return None

        # Get the N-1 observation from the analysis context if not provided
        if obs_n1 is None:
            if self._analysis_context and "obs_simu_defaut" in self._analysis_context:
                obs_n1 = self._analysis_context["obs_simu_defaut"]

        details = []
        from expert_backend.services.network_service import network_service

        for load_name in shed_load_names:
            # Compute shedded MW: difference between N-1 load_p and action load_p
            shedded_mw = 0.0
            if obs_n1 is not None and obs_action is not None:
                try:
                    load_idx = list(obs_action.name_load).index(load_name)
                    p_before = float(obs_n1.load_p[load_idx])
                    p_after = float(obs_action.load_p[load_idx])
                    shedded_mw = abs(p_before - p_after)
                except (ValueError, IndexError):
                    shedded_mw = 0.0

            # Resolve voltage level
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

        return details if details else None

    def _compute_curtailment_details(self, action_data, obs_n1=None):
        """Compute per-generator curtailment details by comparing N-1 and action observations.

        Returns a list of {gen_name, voltage_level_id, curtailed_mw} or None.
        Supports both legacy bus disconnection (bus = -1) and new power reduction
        (gens_p / set_gen_p) formats from expert_op4grid_recommender.
        """
        action_obj = action_data.get("action")
        if action_obj is None:
            return None

        # Collect affected generator names from both legacy and new formats
        curtailed_gen_names = []

        # Legacy format: gens_bus with bus = -1
        gens_bus = getattr(action_obj, "gens_bus", None)
        if gens_bus is None and isinstance(action_obj, dict):
            gens_bus = action_obj.get("gens_bus")
        if gens_bus:
            curtailed_gen_names.extend(name for name, bus in gens_bus.items() if bus == -1)

        # New power reduction format: gens_p (active power setpoint changes)
        gens_p = getattr(action_obj, "gens_p", None)
        if gens_p is None and isinstance(action_obj, dict):
            gens_p = action_obj.get("gens_p")
        if not gens_p:
            # Also check inside action content for set_gen_p
            content = action_data.get("content")
            if isinstance(content, dict):
                gens_p = content.get("set_gen_p")
        if gens_p and isinstance(gens_p, dict):
            for name in gens_p:
                if name not in curtailed_gen_names:
                    curtailed_gen_names.append(name)

        if not curtailed_gen_names:
            return None

        obs_action = action_data.get("observation")
        if obs_action is None:
            # If we don't have an observation (e.g. discovery stage), use disconnected_mw if available
            disconnected_mw = action_data.get("disconnected_mw")
            if not disconnected_mw:
                return None

            # Simple fallback: distribute disconnected_mw among gens if multiple (rare for curtailment)
            mw_per_gen = disconnected_mw / len(curtailed_gen_names)

            details = []
            from expert_backend.services.network_service import network_service
            for gen_name in curtailed_gen_names:
                if not self._is_renewable_gen(gen_name, obs=obs_action):
                    continue

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
            return details if details else None

        # Get the N-1 observation if not provided
        if obs_n1 is None:
            if self._analysis_context and "obs_simu_defaut" in self._analysis_context:
                obs_n1 = self._analysis_context["obs_simu_defaut"]

        details = []
        from expert_backend.services.network_service import network_service
        for gen_name in curtailed_gen_names:
            if not self._is_renewable_gen(gen_name, obs=obs_action or obs_n1):
                continue

            curtailed_mw = 0.0
            if obs_n1 is not None and obs_action is not None:
                try:
                    gen_idx = list(obs_action.name_gen).index(gen_name)
                    if hasattr(obs_n1, "gen_p"):
                        p_before = float(obs_n1.gen_p[gen_idx])
                        p_after = float(obs_action.gen_p[gen_idx])
                    else:
                        p_before = float(obs_n1.prod_p[gen_idx])
                        p_after = float(obs_action.prod_p[gen_idx])
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

        return details if details else None

    def _compute_pst_details(self, action_data):
        """Compute per-PST tap change details.

        Returns a list of {pst_name, tap_position, low_tap, high_tap} or None.
        Reads tap bounds from the network via get_pst_tap_info.
        """
        action_obj = action_data.get("action")
        content = action_data.get("content")
        if action_obj is None and content is None:
            return None

        # Collect affected PST names and their target tap positions
        pst_entries = {}

        # From action object attributes
        pst_tap_attr = getattr(action_obj, "pst_tap", None)
        if pst_tap_attr is None and isinstance(action_obj, dict):
            pst_tap_attr = action_obj.get("pst_tap")
        if pst_tap_attr and isinstance(pst_tap_attr, dict):
            for name, tap in pst_tap_attr.items():
                pst_entries[name] = int(tap)

        # From content dict (pst_tap key)
        if not pst_entries and isinstance(content, dict):
            pst_tap_content = content.get("pst_tap", {})
            if pst_tap_content and isinstance(pst_tap_content, dict):
                for name, tap in pst_tap_content.items():
                    pst_entries[name] = int(tap)

        # From action_topology
        action_topo = action_data.get("action_topology", {})
        if not pst_entries and action_topo:
            pst_tap_topo = action_topo.get("pst_tap", {})
            if pst_tap_topo and isinstance(pst_tap_topo, dict):
                for name, tap in pst_tap_topo.items():
                    pst_entries[name] = int(tap)

        if not pst_entries:
            return None

        details = []
        try:
            env = self._get_simulation_env()
            nm = env.network_manager
        except Exception as e:
            logger.debug("Suppressed exception: %s", e)
            nm = None

        for pst_name, tap_position in pst_entries.items():
            low_tap = None
            high_tap = None
            if nm is not None:
                try:
                    pst_info = nm.get_pst_tap_info(pst_name)
                    if pst_info:
                        low_tap = pst_info.get('low_tap')
                        high_tap = pst_info.get('high_tap')
                except Exception as e:
                    logger.debug("Suppressed exception: %s", e)

            details.append({
                "pst_name": pst_name,
                "tap_position": tap_position,
                "low_tap": low_tap,
                "high_tap": high_tap,
            })

        return details if details else None

    def _is_renewable_gen(self, gen_name, obs=None):
        """Identify if a generator is renewable (WIND/SOLAR)."""
        # 1. If observation is provided and has gen_type, use it for accuracy
        if obs is not None and hasattr(obs, 'gen_type') and hasattr(obs, 'name_gen'):
            try:
                gen_idx = list(obs.name_gen).index(gen_name)
                gen_type = str(obs.gen_type[gen_idx]).upper()
                if gen_type in ["WIND", "SOLAR"]:
                    return True
            except (ValueError, IndexError):
                pass
        
        # 2. Try querying the network directly via network_service
        from expert_backend.services.network_service import network_service
        try:
            gen_type = network_service.get_generator_type(gen_name)
            if gen_type:
                return str(gen_type).upper() in ["WIND", "SOLAR"]
        except Exception as e:
            logger.debug("Suppressed exception: %s", e)

        # 3. Fallback to name-based filtering
        gn = gen_name.upper()
        return "WIND" in gn or "SOLAR" in gn or "PV" in gn or "EOL" in gn

    def _compute_mw_start_for_scores(self, action_scores):
        """Compute MW at start for each action in action_scores.

        Adds a 'mw_start' dict ({action_id: float|null}) to each action type entry.
        For PST types, also adds 'tap_start' dict ({action_id: {tap, low_tap, high_tap}|null}).

        Rules per action type:
        - line_disconnection: abs(p_or) of the disconnected line in N-1 state
        - pst_tap_change:     abs(p_or) of the PST line in N-1 state
        - load_shedding:      load_p of the load in N-1 state
        - renewable_curtailment: prod_p of the generator in N-1 state
        - open_coupling:      sum of abs(p_or) of lines moved to a different bus (virtual line MW)
        - line_reconnection:  null (N/A)
        - close_coupling:     null (N/A)
        """
        if not action_scores:
            return action_scores

        # Get the N-1 observation from analysis context
        obs_n1 = None
        if self._analysis_context and "obs_simu_defaut" in self._analysis_context:
            obs_n1 = self._analysis_context["obs_simu_defaut"]
        if obs_n1 is None:
            return action_scores

        # Build name-to-index lookups
        line_name_to_idx = {name: i for i, name in enumerate(obs_n1.name_line)}
        load_name_to_idx = {name: i for i, name in enumerate(obs_n1.name_load)}
        gen_name_to_idx = {name: i for i, name in enumerate(obs_n1.name_gen)}

        for action_type, type_data in action_scores.items():
            scores = type_data.get("scores", {})
            if not scores:
                continue

            t = action_type.lower()
            is_reco = 'reco' in t or 'line_reconnection' in t
            is_close = 'close_coupling' in t
            is_na_type = is_reco or is_close
            is_pst = 'pst' in t

            mw_start = {}
            tap_start = {} if is_pst else None
            for action_id in scores:
                if is_na_type:
                    mw_start[action_id] = None
                    continue

                mw_val = self._get_action_mw_start(action_id, action_type, obs_n1,
                                                    line_name_to_idx, load_name_to_idx, gen_name_to_idx)
                mw_start[action_id] = mw_val

                # For PST types, also compute tap start info
                if is_pst:
                    tap_start[action_id] = self._get_pst_tap_start(action_id)

            type_data["mw_start"] = sanitize_for_json(mw_start)
            if tap_start is not None:
                type_data["tap_start"] = sanitize_for_json(tap_start)

        return action_scores

    def _get_pst_tap_start(self, action_id):
        """Return {pst_name, tap, low_tap, high_tap} for a PST action's N-state tap, or None.

        Priority for the N-state (start) tap value:
        1. Action's 'parameters' -> 'previous tap' (stored in the action JSON file)
        2. Stable cache captured at network load time (_initial_pst_taps)
        3. Simulation environment fallback (get_pst_tap_info)
        """
        action_entry = self._dict_action.get(action_id) if self._dict_action else None
        if action_entry is None:
            return None

        content = action_entry.get("content", {})
        if not content:
            return None

        pst_tap = content.get("pst_tap", {})
        if not pst_tap:
            pst_tap = content.get("redispatch", {}).get("pst_tap", {})
        if not pst_tap:
            return None

        # Get the first PST entry (most actions target a single PST)
        pst_name = next(iter(pst_tap))

        # Priority 1: read "previous tap" from action parameters (original N-state tap)
        params = action_entry.get("parameters", {})
        if params:
            prev_tap = params.get("previous tap")
            if prev_tap is not None:
                # Get bounds from cache or simulation env
                low_tap, high_tap = None, None
                if self._initial_pst_taps and pst_name in self._initial_pst_taps:
                    low_tap = self._initial_pst_taps[pst_name].get("low_tap")
                    high_tap = self._initial_pst_taps[pst_name].get("high_tap")
                elif hasattr(self, '_simulation_env') and self._simulation_env:
                    try:
                        nm = self._simulation_env.network_manager
                        pst_info = nm.get_pst_tap_info(pst_name)
                        if pst_info:
                            low_tap = pst_info.get("low_tap")
                            high_tap = pst_info.get("high_tap")
                    except Exception as e:
                        logger.debug("Suppressed exception: %s", e)
                return {
                    "pst_name": pst_name,
                    "tap": int(prev_tap),
                    "low_tap": low_tap,
                    "high_tap": high_tap,
                }

        # Priority 2: stable cache captured at network load time
        if self._initial_pst_taps and pst_name in self._initial_pst_taps:
            info = self._initial_pst_taps[pst_name]
            return {
                "pst_name": pst_name,
                "tap": info["tap"],
                "low_tap": info["low_tap"],
                "high_tap": info["high_tap"],
            }

        # Priority 3: simulation environment fallback
        try:
            env = self._get_simulation_env()
            nm = env.network_manager
            pst_info = nm.get_pst_tap_info(pst_name)
            if pst_info:
                return {
                    "pst_name": pst_name,
                    "tap": pst_info.get("tap"),
                    "low_tap": pst_info.get("low_tap"),
                    "high_tap": pst_info.get("high_tap"),
                }
        except Exception as e:
            logger.debug("Suppressed exception: %s", e)

        return None

    def _get_action_mw_start(self, action_id, action_type, obs_n1, line_idx_map, load_idx_map, gen_idx_map):
        """Return MW at start for a single action, or None if not computable."""
        t = action_type.lower()
        is_disco = 'disco' in t or 'line_disconnection' in t
        is_pst = 'pst' in t
        is_ls = 'load_shedding' in t or 'ls' in t
        is_curtail = 'renewable_curtailment' in t or 'curtail' in t
        is_open = 'open_coupling' in t

        action_entry = self._dict_action.get(action_id) if self._dict_action else None

        # For load shedding, try extracting the load name from the action ID
        # even if the action entry is missing or content is incomplete
        if is_ls:
            return self._mw_start_load_shedding(action_id, action_entry, obs_n1, load_idx_map)

        if is_curtail:
            return self._mw_start_curtailment(action_id, action_entry, obs_n1, gen_idx_map)

        if action_entry is None:
            return None

        content = action_entry.get("content", {})
        if not content:
            return None

        set_bus = content.get("set_bus", {})

        if is_disco:
            # Line disconnection: find the line being disconnected (bus = -1)
            for field in ("lines_or_id", "lines_ex_id"):
                bus_map = set_bus.get(field, {})
                for name, bus in bus_map.items():
                    if int(bus) == -1 and name in line_idx_map:
                        idx = line_idx_map[name]
                        return round(abs(float(obs_n1.p_or[idx])), 1)
            return None

        if is_pst:
            # PST: find the PST element — it may be in pst_tap or in content directly
            pst_tap = content.get("pst_tap", {})
            if not pst_tap:
                pst_tap = content.get("redispatch", {}).get("pst_tap", {})
            for pst_name in pst_tap:
                if pst_name in line_idx_map:
                    idx = line_idx_map[pst_name]
                    return round(abs(float(obs_n1.p_or[idx])), 1)
            return None

        if is_open:
            return self._mw_start_open_coupling(set_bus, obs_n1, line_idx_map, load_idx_map)

        return None

    def _mw_start_load_shedding(self, action_id, action_entry, obs_n1, load_idx_map):
        """Compute MW at start for a load shedding action.

        Tries multiple strategies:
        1a. Parse content.set_load_p for power reduction actions (new format)
        1b. Parse content.set_bus.loads_id for loads with bus=-1 (legacy format)
        2. Extract load name from the action ID pattern load_shedding_<name>
        """
        if action_entry is not None:
            content = action_entry.get("content", {})
            if content:
                # Strategy 1a: new power reduction format — set_load_p
                set_load_p = content.get("set_load_p", {})
                if set_load_p:
                    total_mw = 0.0
                    found = False
                    for load_name in set_load_p:
                        if load_name in load_idx_map:
                            idx = load_idx_map[load_name]
                            total_mw += abs(float(obs_n1.load_p[idx]))
                            found = True
                    if found:
                        return round(total_mw, 1)

                # Strategy 1b: legacy bus disconnection format — set_bus.loads_id
                set_bus = content.get("set_bus", {})
                loads = set_bus.get("loads_id", {})
                total_mw = 0.0
                found = False
                for load_name, bus in loads.items():
                    if int(bus) == -1 and load_name in load_idx_map:
                        idx = load_idx_map[load_name]
                        total_mw += abs(float(obs_n1.load_p[idx]))
                        found = True
                if found:
                    return round(total_mw, 1)

        # Strategy 2: extract load name from action_id pattern
        aid = action_id
        if aid.startswith("load_shedding_"):
            load_name = aid[len("load_shedding_"):]
            if load_name in load_idx_map:
                idx = load_idx_map[load_name]
                return round(abs(float(obs_n1.load_p[idx])), 1)

        return None

    def _mw_start_curtailment(self, action_id, action_entry, obs_n1, gen_idx_map):
        """Compute MW at start for a renewable curtailment action.

        Supports both new power reduction (set_gen_p) and legacy (set_bus.generators_id)
        formats.
        """
        if action_entry is not None:
            content = action_entry.get("content", {})
            if content:
                # New power reduction format — set_gen_p
                set_gen_p = content.get("set_gen_p", {})
                if set_gen_p:
                    total_mw = 0.0
                    found = False
                    for gen_name in set_gen_p:
                        if gen_name in gen_idx_map:
                            idx = gen_idx_map[gen_name]
                            if hasattr(obs_n1, "gen_p"):
                                total_mw += abs(float(obs_n1.gen_p[idx]))
                            else:
                                total_mw += abs(float(obs_n1.prod_p[idx]))
                            found = True
                    if found:
                        return round(total_mw, 1)

                # Legacy bus disconnection format — set_bus.generators_id
                set_bus = content.get("set_bus", {})
                gens = set_bus.get("generators_id", {})
                total_mw = 0.0
                found = False
                for gen_name, bus in gens.items():
                    if int(bus) == -1 and gen_name in gen_idx_map:
                        idx = gen_idx_map[gen_name]
                        if hasattr(obs_n1, "gen_p"):
                            total_mw += abs(float(obs_n1.gen_p[idx]))
                        else:
                            total_mw += abs(float(obs_n1.prod_p[idx]))
                        found = True
                if found:
                    return round(total_mw, 1)

        # Fallback to action ID pattern
        if action_id.startswith("curtail_"):
            gen_name = action_id[len("curtail_"):]
            if gen_name in gen_idx_map:
                idx = gen_idx_map[gen_name]
                if hasattr(obs_n1, "gen_p"):
                    return round(abs(float(obs_n1.gen_p[idx])), 1)
                else:
                    return round(abs(float(obs_n1.prod_p[idx])), 1)

        return None

    def _mw_start_open_coupling(self, set_bus, obs_n1, line_idx_map, load_idx_map):
        """Compute virtual line MW for an open coupling (node splitting) action.

        Delegates to ``get_virtual_line_flow()`` from expert_op4grid_recommender,
        after partitioning ``set_bus`` elements by their target bus assignment
        and collecting observation indices for bus 1 elements.

        Virtual line MW = |get_virtual_line_flow(obs, ind_load, ind_prod, ind_lor, ind_lex)|
        """
        # Determine which bus number represents "bus 1" (smallest positive).
        # Bus -1 means the element is disconnected and must be excluded.
        all_buses = set()
        for key in ("lines_or_id", "lines_ex_id", "generators_id", "loads_id"):
            for _name, bus in set_bus.get(key, {}).items():
                b = int(bus)
                if b > 0:
                    all_buses.add(b)

        if not all_buses:
            return None

        bus1 = min(all_buses)

        # Collect observation indices for elements on bus 1
        ind_lor = [line_idx_map[name] for name, bus in set_bus.get("lines_or_id", {}).items()
                    if int(bus) == bus1 and name in line_idx_map]
        ind_lex = [line_idx_map[name] for name, bus in set_bus.get("lines_ex_id", {}).items()
                    if int(bus) == bus1 and name in line_idx_map]

        gen_name_to_idx = {name: i for i, name in enumerate(obs_n1.name_gen)} if hasattr(obs_n1, 'name_gen') else {}
        ind_prod = [gen_name_to_idx[name] for name, bus in set_bus.get("generators_id", {}).items()
                     if int(bus) == bus1 and name in gen_name_to_idx]

        ind_load = [load_idx_map[name] for name, bus in set_bus.get("loads_id", {}).items()
                     if int(bus) == bus1 and name in load_idx_map]

        if not (ind_lor or ind_lex or ind_prod or ind_load):
            return None

        flow = get_virtual_line_flow(obs_n1, ind_load, ind_prod, ind_lor, ind_lex)
        return round(abs(flow), 1)

    def _get_latest_pdf_path(self, analysis_start_time=None):
        """Finds the latest PDF generated in the SAVE_FOLDER_VISUALIZATION."""
        save_folder = config.SAVE_FOLDER_VISUALIZATION
        pdfs = glob.glob(os.path.join(save_folder, "*.pdf"))
        if not pdfs: return None
        
        if analysis_start_time:
            # Only consider PDFs modified after we started
            # Use a tiny offset (1s) to be safe against filesystem drift
            recent_pdfs = [p for p in pdfs if os.path.getmtime(p) >= (analysis_start_time - 1.0)]
            if not recent_pdfs: return None
            return max(recent_pdfs, key=os.path.getmtime)
        else:
            # If no start time, just get the absolute latest
            return max(pdfs, key=os.path.getmtime)

    def run_analysis_step1(self, disconnected_element: str):
        """Runs the first step of analysis: contingency simulation and overload detection."""
        # Drain any in-flight NAD prefetch + position the shared Network on
        # the N variant before grid2op starts switching variants itself.
        # See docs/perf-grid2op-shared-network.md ("variant-state guard").
        self._ensure_n_state_ready()
        try:
            res_step1, context = run_analysis_step1(
                analysis_date=config.DATE,
                current_timestep=config.TIMESTEP,
                current_lines_defaut=[disconnected_element],
                backend=Backend.PYPOWSYBL,
                fast_mode=getattr(config, 'PYPOWSYBL_FAST_MODE', True),
                dict_action=self._dict_action,
                prebuilt_env_context=self._cached_env_context,
            )
            
            self._last_disconnected_element = disconnected_element
            
            if res_step1 is not None:
                # No overloads or grid broken apart
                self._analysis_context = None
                return {
                    "lines_overloaded": res_step1.get("lines_overloaded_names", []),
                    "message": "No overloads detected or grid broken apart.",
                    "can_proceed": False
                }
            
            self._analysis_context = context
            return {
                "lines_overloaded": context["lines_overloaded_names"],
                "message": f"Detected {len(context['lines_overloaded_names'])} overloads.",
                "can_proceed": True
            }
        except Exception as e:
            self._analysis_context = None
            raise e

    def run_analysis_step2(self, selected_overloads: list[str], all_overloads: list[str] = None, monitor_deselected: bool = False):
        """Runs the second step of analysis: graph generation and action discovery.

        No `_ensure_*_state_ready` guard here: step2 inherits the
        `_analysis_context` (observations, monitored lines, …) that
        step1 has already positioned. The NAD prefetch worker was
        already drained by step1's guard earlier in the same session.
        """
        if not self._analysis_context:
            raise ValueError("Analysis context not found. Run step 1 first.")
        
        context = self._analysis_context
        analysis_start_time = time.time()
        
        # Filter overloads in context based on user selection
        all_names = context["lines_overloaded_names"]
        selected_indices = [i for i, name in enumerate(all_names) if name in selected_overloads]
        
        # Update IDs
        original_ids = context["lines_overloaded_ids"]
        new_ids = [original_ids[i] for i in selected_indices]
        context["lines_overloaded_ids"] = new_ids
        
        # Update kept IDs (subset of original_ids that were also in kept)
        original_kept = set(context["lines_overloaded_ids_kept"])
        new_kept = [idx for idx in new_ids if idx in original_kept]
        context["lines_overloaded_ids_kept"] = new_kept
        
        # Update names
        context["lines_overloaded_names"] = [all_names[i] for i in selected_indices]

        # When not monitoring deselected overloads, remove them from lines_we_care_about
        # so they don't appear in max_rho_line calculation for action cards.
        if not monitor_deselected and all_overloads:
            deselected = set(all_overloads) - set(selected_overloads)
            if deselected and context.get("lines_we_care_about") is not None:
                care = context["lines_we_care_about"]
                before_count = len(care)
                if isinstance(care, set):
                    context["lines_we_care_about"] = care - deselected
                elif isinstance(care, (list, tuple)):
                    context["lines_we_care_about"] = [n for n in care if n not in deselected]
                else:
                    # Fallback: convert to set and subtract
                    context["lines_we_care_about"] = set(care) - deselected
                after_count = len(context["lines_we_care_about"])
                logger.info(f"[Step2] Excluded {before_count - after_count} deselected overloads from monitoring: {deselected}")
                logger.info(f"[Step2] lines_we_care_about: {before_count} -> {after_count}")
        else:
            logger.info(f"[Step2] monitor_deselected={monitor_deselected}, all_overloads={all_overloads} -> NOT filtering lines_we_care_about")

        try:
            # Part 1: Graph generation and PDF
            context = run_analysis_step2_graph(context)
            
            # Yield PDF event (graph is generated in Step 2 Part 1)
            yield {"type": "pdf", "pdf_path": self._get_latest_pdf_path(analysis_start_time)}
            
            # Part 2: Action discovery
            results = run_analysis_step2_discovery(context)
            self._last_result = results # Store for diagram generation

            # Build enriched actions the same way as run_analysis - with monitoring_factor applied and topology
            enriched_actions = self._enrich_actions(
                results["prioritized_actions"],
                lines_overloaded_names=results.get("lines_overloaded_names"),
            )

            # Safety filter: ensure no combined actions (with '+') leak into the main actions feed during initial analysis
            # They should only exist in combined_actions as estimations.
            enriched_actions = {aid: data for aid, data in enriched_actions.items() if "+" not in aid}

            # Compute MW at start for score tables
            action_scores = results.get("action_scores", {})
            # Debug: log disco scores for diagnosis
            _disco_scores = action_scores.get("line_disconnection", {}).get("scores", {})
            _disco_params = action_scores.get("line_disconnection", {}).get("params", {})
            logger.info(f"[DEBUG step2] line_disconnection scores: {len(_disco_scores)} entries, params={_disco_params}")
            for _aid, _s in list(_disco_scores.items())[:10]:
                logger.info(f"[DEBUG step2]   {_aid}: {_s}")
            if not _disco_scores:
                logger.info("[DEBUG step2] No disco scores found — checking overflow graph edges…")
                try:
                    import networkx as _nx
                    _g = results.get("_g_overflow_debug")
                    if _g is None:
                        logger.info("[DEBUG step2] No overflow graph in results (expected)")
                except Exception:
                    pass
            # Log all action score types and counts
            for _type, _data in action_scores.items():
                _cnt = len(_data.get("scores", {})) if isinstance(_data, dict) else 0
                logger.info(f"[DEBUG step2] action_scores[{_type}]: {_cnt} entries")
            action_scores = self._compute_mw_start_for_scores(action_scores)

            logger.info(f"[Step 2] Yielding final result event with {len(enriched_actions)} enriched actions")
            # Yield result
            lines_we_care_about = context.get("lines_we_care_about")
            yield sanitize_for_json({
                "type": "result",
                "actions": enriched_actions,
                "action_scores": action_scores,
                "lines_overloaded": results["lines_overloaded_names"],
                "pre_existing_overloads": results.get("pre_existing_overloads", []),
                "combined_actions": results.get("combined_actions", {}),
                "lines_we_care_about": list(lines_we_care_about) if lines_we_care_about is not None else None,
                "message": "Analysis completed",
                "dc_fallback": False,
            })
        except Exception as e:
            import traceback
            traceback.print_exc()
            yield {"type": "error", "message": f"Backend Error in Analysis Resolution: {str(e)}"}

    def run_analysis(self, disconnected_element: str):
        import io
        import threading
        from contextlib import redirect_stdout

        # Legacy full-analysis endpoint — still shares the same Network with
        # the NAD prefetch worker and grid2op. Must ensure the variant is
        # on N before kicking off the background analysis thread.
        self._ensure_n_state_ready()

        analysis_start_time = time.time()
        shared_state = {
            "analysis_message": "Analysis completed successfully using AC Load Flow.",
            "dc_fallback_used": False,
            "result": None,
            "output": "",
            "error": None,
            "done": False,
            "latest_pdf": None
        }
        
        save_folder = config.SAVE_FOLDER_VISUALIZATION

        def find_latest_pdf():
            pdfs = glob.glob(os.path.join(save_folder, "*.pdf"))
            if not pdfs: return None
            # Only consider PDFs modified after we started
            # Use a tiny offset (1s) to be safe against filesystem drift
            recent_pdfs = [p for p in pdfs if os.path.getmtime(p) >= (analysis_start_time - 1.0)]
            if not recent_pdfs: return None
            return max(recent_pdfs, key=os.path.getmtime)

        def _worker():
            try:
                # Attempt 1: AC
                config.USE_DC_LOAD_FLOW = False
                f_stdout = io.StringIO()
                with redirect_stdout(f_stdout):
                    res = run_analysis(
                        analysis_date=None,
                        current_timestep=0,
                        current_lines_defaut=[disconnected_element],
                        backend=Backend.PYPOWSYBL
                    )
                shared_state["result"] = res
                shared_state["output"] = f_stdout.getvalue()
            except RuntimeError as e:
                # Catch convergence error and try DC
                if "Initial contingency simulation failed" in str(e):
                    try:
                        config.USE_DC_LOAD_FLOW = True
                        shared_state["dc_fallback_used"] = True
                        shared_state["analysis_message"] = "Warning: AC Load Flow did not converge. Fallback to DC Load Flow was used."
                        f_stdout = io.StringIO()
                        with redirect_stdout(f_stdout):
                            res = run_analysis(
                                analysis_date=None,
                                current_timestep=0,
                                current_lines_defaut=[disconnected_element],
                                backend=Backend.PYPOWSYBL
                            )
                        shared_state["result"] = res
                        shared_state["output"] = f_stdout.getvalue()
                    except Exception as inner_e:
                        shared_state["error"] = RuntimeError(f"Analysis failed globally (AC and DC): {inner_e}")
                else:
                    shared_state["error"] = e
            except Exception as e:
                shared_state["error"] = e
            finally:
                shared_state["done"] = True

        thread = threading.Thread(target=_worker)
        thread.start()

        pdf_sent = False
        while not shared_state["done"]:
            # Check for PDF
            if not pdf_sent:
                latest = find_latest_pdf()
                if latest:
                    shared_state["latest_pdf"] = latest
                    yield {"type": "pdf", "pdf_path": str(latest)}
                    pdf_sent = True
            
            if shared_state["error"]:
                raise shared_state["error"]
            
            time.sleep(0.5)

        # Final check for error
        if shared_state["error"]:
            raise shared_state["error"]

        # Final check for PDF if not sent during loop
        if not pdf_sent:
            latest = find_latest_pdf()
            if latest:
                shared_state["latest_pdf"] = latest
                yield {"type": "pdf", "pdf_path": str(latest)}
                pdf_sent = True

        result = shared_state["result"]
        output = shared_state["output"]
        analysis_message = shared_state["analysis_message"]
        dc_fallback_used = shared_state["dc_fallback_used"]

        # Store the full result for later action variant diagram generation
        self._last_result = result
        self._last_disconnected_element = disconnected_element

        if result is None:
            if "No topological solution without load shedding" in output:
                analysis_message = "No topological solution found without load shedding. The grid might be too constrained."
            elif "Overload breaks the grid apart" in output:
                analysis_message = "Grid instability detected: Overload breaks the grid apart."
            else:
                analysis_message = "Analysis finished but no recommendations were found."
            enriched_actions = {}
            lines_overloaded = []
            action_scores = {}
        else:
            lines_overloaded = result.get("lines_overloaded_names", [])
            prioritized = result.get("prioritized_actions", {})
            action_scores = sanitize_for_json(result.get("action_scores", {}))
            # Debug: log disco scores for diagnosis
            _disco_scores = action_scores.get("line_disconnection", {}).get("scores", {})
            _disco_params = action_scores.get("line_disconnection", {}).get("params", {})
            logger.info(f"[DEBUG] line_disconnection scores: {len(_disco_scores)} entries, params={_disco_params}")
            for _aid, _s in list(_disco_scores.items())[:5]:
                logger.info(f"[DEBUG]   {_aid}: {_s}")
            action_scores = self._compute_mw_start_for_scores(action_scores)

            enriched_actions = self._enrich_actions(
                prioritized,
                lines_overloaded_names=lines_overloaded,
            )

        from expert_backend.services.network_service import network_service
        total_branches = len(network_service.get_disconnectable_elements())
        monitored_branches = len(network_service.get_monitored_elements())
        excluded_branches = total_branches - monitored_branches
        
        info_msg = f"Note: {monitored_branches} out of {total_branches} lines monitored ({excluded_branches} without permanent limits)."
        
        if analysis_message:
            analysis_message += " " + info_msg
        else:
            analysis_message = info_msg

        combined_actions = result.get("combined_actions", {}) if result else {}
        for data in combined_actions.values():
            data["is_estimated"] = True
        combined_actions = sanitize_for_json(combined_actions)

        # Safety filter: ensure no combined actions (with '+') leak into the main actions feed during initial analysis
        # They should only exist in combined_actions as estimations.
        enriched_actions = {aid: data for aid, data in enriched_actions.items() if "+" not in aid}

        care = self._analysis_context.get("lines_we_care_about") if self._analysis_context else None
        yield sanitize_for_json({
            "type": "result",
            "pdf_path": str(shared_state["latest_pdf"]) if shared_state["latest_pdf"] else None,
            "actions": enriched_actions,
            "action_scores": action_scores,
            "lines_overloaded": lines_overloaded,
            "combined_actions": combined_actions,
            "lines_we_care_about": list(care) if care is not None else None,
            "message": analysis_message,
            "dc_fallback": dc_fallback_used
        })
