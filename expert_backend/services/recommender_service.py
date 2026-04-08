# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import expert_op4grid_recommender
from expert_op4grid_recommender import config
from expert_op4grid_recommender.main import (
    Backend, run_analysis, run_analysis_step1, run_analysis_step2,
    run_analysis_step2_graph, run_analysis_step2_discovery
)
from expert_op4grid_recommender.data_loader import load_actions, enrich_actions_lazy
from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter
import os
import glob
import time
from pathlib import Path
import numpy as np

from expert_op4grid_recommender.environment import load_interesting_lines
from expert_op4grid_recommender.utils.superposition import (
    compute_combined_pair_superposition,
    _identify_action_elements,
    get_virtual_line_flow,
)
from expert_op4grid_recommender.action_evaluation.classifier import ActionClassifier

def sanitize_for_json(obj):
    if isinstance(obj, bool):
        return obj
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    elif isinstance(obj, (np.floating, float)):
        if np.isnan(obj) or np.isinf(obj):
            return None
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    elif isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_for_json(i) for i in obj]
    elif isinstance(obj, (str, bool, type(None))):
        return obj
    else:
        # Fallback for unknown objects
        try:
            if hasattr(obj, "to_dict"):
                d = obj.to_dict()
                if isinstance(d, dict):
                    return sanitize_for_json(d)
                return str(obj)
            return sanitize_for_json(vars(obj))
        except (TypeError, ValueError):
            return str(obj)

class RecommenderService:
    def __init__(self):
        self._last_result = None
        self._is_running = False
        self._generator = None
        self._base_network = None
        self._simulation_env = None
        self._last_disconnected_element = None
        self._dict_action = None
        self._analysis_context = None
        self._saved_computed_pairs = None
        # Phase 2 caches for faster manual action simulation
        self._cached_obs_n = None
        self._cached_obs_n_id = None
        self._cached_obs_n1 = None
        self._cached_obs_n1_id = None
        # Pre-built SimulationEnvironment reused across contingency analyses
        self._cached_env_context = None

    def reset(self):
        """Clear all cached analysis state. Called when loading a new study."""
        self._last_result = None
        self._is_running = False
        self._generator = None
        self._base_network = None
        self._simulation_env = None
        self._last_disconnected_element = None
        self._dict_action = None
        self._analysis_context = None
        self._saved_computed_pairs = None
        # Phase 2 caches for faster manual action simulation
        self._cached_obs_n = None
        self._cached_obs_n_id = None
        self._cached_obs_n1 = None
        self._cached_obs_n1_id = None
        self._cached_env_context = None

    def restore_analysis_context(self, lines_we_care_about, disconnected_element=None, lines_overloaded=None, computed_pairs=None):
        """Restore analysis context from a saved session.

        This sets _analysis_context so that subsequent simulate_manual_action
        calls use the same monitored lines (lines_we_care_about) that were
        determined during the original analysis.  Without this, session reload
        falls back to _get_monitoring_parameters which may return a different
        set of lines and produce inconsistent max_rho values.
        """
        self._analysis_context = {
            "lines_we_care_about": list(lines_we_care_about) if lines_we_care_about else None,
        }
        if disconnected_element:
            self._last_disconnected_element = disconnected_element
        if lines_overloaded is not None:
            self._analysis_context["lines_overloaded"] = list(lines_overloaded)
        if computed_pairs is not None:
            self._saved_computed_pairs = computed_pairs
        print(f"[restore_analysis_context] Restored context: "
              f"{len(lines_we_care_about) if lines_we_care_about else 0} monitored lines, "
              f"disconnected={disconnected_element}, "
              f"{len(lines_overloaded) if lines_overloaded else 0} overloaded lines, "
              f"{len(computed_pairs) if computed_pairs else 0} computed pairs")

    def get_saved_computed_pairs(self):
        """Return saved computed pairs from session restore, or None."""
        return self._saved_computed_pairs

    def _enrich_actions(self, prioritized_actions_dict):
        """Helper to convert raw prioritized actions into enriched dict for JSON response.

        The discovery engine returns raw obs.rho values (physical loading
        fraction where 1.0 = 100% of the thermal limit).  We scale them
        by monitoring_factor so the frontend displays operational loading
        percentages (relative to the reduced operational limit).
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

            enriched_actions[action_id] = {
                "description_unitaire": action_data.get("description_unitaire") or "No description available",
                "rho_before": sanitize_for_json(rho_before),
                "rho_after": sanitize_for_json(rho_after),
                "max_rho": sanitize_for_json(max_rho),
                "max_rho_line": action_data.get("max_rho_line", ""),
                "is_rho_reduction": bool(action_data.get("is_rho_reduction", False)),
                "non_convergence": non_convergence,
                "lines_overloaded_after": sanitize_for_json(action_data.get("lines_overloaded_after", [])),
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
            except Exception:
                pass

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
                except Exception:
                    pass

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
            except Exception:
                pass

            details.append({
                "gen_name": gen_name,
                "voltage_level_id": vl_id,
                "curtailed_mw": round(curtailed_mw, 1),
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
        except Exception:
            pass

        # 3. Fallback to name-based filtering
        gn = gen_name.upper()
        return "WIND" in gn or "SOLAR" in gn or "PV" in gn or "EOL" in gn


    def _compute_mw_start_for_scores(self, action_scores):
        """Compute MW at start for each action in action_scores.

        Adds a 'mw_start' dict ({action_id: float|null}) to each action type entry.

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

            mw_start = {}
            for action_id in scores:
                if is_na_type:
                    mw_start[action_id] = None
                    continue

                mw_val = self._get_action_mw_start(action_id, action_type, obs_n1,
                                                    line_name_to_idx, load_name_to_idx, gen_name_to_idx)
                mw_start[action_id] = mw_val

            type_data["mw_start"] = sanitize_for_json(mw_start)

        return action_scores

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

    def update_config(self, settings):
        # Update the global config of the package
        path_obj = Path(settings.network_path)
        config.ENV_NAME = path_obj.name
        config.ENV_FOLDER = path_obj.parent
        config.ENV_PATH = path_obj
        
        config.ACTION_FILE_PATH = Path(settings.action_file_path)
        
        # Apply the new settings parameters
        config.MIN_LINE_RECONNECTIONS = settings.min_line_reconnections
        config.MIN_CLOSE_COUPLING = settings.min_close_coupling
        config.MIN_OPEN_COUPLING = settings.min_open_coupling
        config.MIN_LINE_DISCONNECTIONS = settings.min_line_disconnections
        config.N_PRIORITIZED_ACTIONS = settings.n_prioritized_actions
        if hasattr(settings, 'monitoring_factor'):
            config.MONITORING_FACTOR_THERMAL_LIMITS = settings.monitoring_factor
        if hasattr(settings, 'pre_existing_overload_threshold') and settings.pre_existing_overload_threshold is not None:
            config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD = settings.pre_existing_overload_threshold
        if hasattr(settings, 'ignore_reconnections') and settings.ignore_reconnections is not None:
            config.IGNORE_RECONNECTIONS = settings.ignore_reconnections
        if hasattr(settings, 'pypowsybl_fast_mode') and settings.pypowsybl_fast_mode is not None:
            config.PYPOWSYBL_FAST_MODE = settings.pypowsybl_fast_mode
        if hasattr(settings, 'min_pst') and settings.min_pst is not None:
            config.MIN_PST = settings.min_pst
        if hasattr(settings, 'min_load_shedding') and settings.min_load_shedding is not None:
            config.MIN_LOAD_SHEDDING = settings.min_load_shedding
        if hasattr(settings, 'min_renewable_curtailment_actions') and settings.min_renewable_curtailment_actions is not None:
            config.MIN_RENEWABLE_CURTAILMENT_ACTIONS = settings.min_renewable_curtailment_actions
        
        # New layout file path
        if hasattr(settings, 'layout_path') and settings.layout_path:
            config.LAYOUT_FILE_PATH = Path(settings.layout_path)
        else:
            config.LAYOUT_FILE_PATH = None

        # Force the requested global flags
        config.MAX_RHO_BOTH_EXTREMITIES = True
        
        # Handle lines monitoring optionally
        if hasattr(settings, 'lines_monitoring_path') and settings.lines_monitoring_path:
            if os.path.exists(settings.lines_monitoring_path):
                config.IGNORE_LINES_MONITORING = False
                config.LINES_MONITORING_FILE = Path(settings.lines_monitoring_path)
            else:
                config.IGNORE_LINES_MONITORING = True
                config.LINES_MONITORING_FILE = None
                config.MONITORED_LINES_COUNT = 0
                print(f"Ignoring lines monitoring (file path {settings.lines_monitoring_path} does not exist).")
        else:
            # No monitoring file specified by UI → monitor all lines.
            # The library's setup_environment_configs_pypowsybl will set
            # lines_we_care_about = all lines when IGNORE_LINES_MONITORING is True.
            config.IGNORE_LINES_MONITORING = True
            config.LINES_MONITORING_FILE = None
            config.MONITORED_LINES_COUNT = 0

        if not getattr(config, 'IGNORE_LINES_MONITORING', True):
            try:
                from expert_op4grid_recommender.data_loader import load_interesting_lines
                lines = list(load_interesting_lines(file_name=config.LINES_MONITORING_FILE))
                config.MONITORED_LINES_COUNT = len(lines)
                print(f"Loaded lines monitoring file: {config.LINES_MONITORING_FILE} ({config.MONITORED_LINES_COUNT} lines)")
            except Exception as e:
                print(f"Failed to count lines in {config.LINES_MONITORING_FILE}: {e}")
                config.MONITORED_LINES_COUNT = -1
        
        # Load and cache the action dictionary immediately if path changed or not loaded
        new_action_path = Path(settings.action_file_path)
        if getattr(self, '_last_action_path', None) != new_action_path or self._dict_action is None:
            raw_dict_action = load_actions(config.ACTION_FILE_PATH)
            self._last_action_path = new_action_path

            # Auto-generate disco actions if none exist in the file
            has_disco = any(k.startswith("disco_") for k in raw_dict_action)
            if not has_disco:
                from expert_backend.services.network_service import network_service
                branches = network_service.get_disconnectable_elements()
                for branch in branches:
                    action_id = f"disco_{branch}"
                    raw_dict_action[action_id] = {
                        "description": f"Disconnection of line/transformer '{branch}'",
                        "description_unitaire": f"Ouverture de la ligne '{branch}'",
                    }
                print(f"[RecommenderService] Auto-generated {len(branches)} disco_ actions")

                # Save the raw entries (without content) so the core analysis engine can read them
                import json
                with open(config.ACTION_FILE_PATH, 'w') as f:
                    json.dump(raw_dict_action, f, indent=2)

            # Wrap with LazyActionDict so 'content' is computed on demand from 'switches'
            from expert_backend.services.network_service import network_service
            self._dict_action = enrich_actions_lazy(raw_dict_action, network_service.network)
        else:
            print("Action dictionary already loaded, skipping reload.")

        # Inject missing config parameter and redirect output
        config.DO_VISUALIZATION = getattr(settings, 'do_visualization', True)
        # Don't check all actions
        config.CHECK_ACTION_SIMULATION = False

        # Set visualization output to local 'Overflow_Graph' directory in backend/
        # uvicorn runs from root, so 'Overflow_Graph' in CWD
        config.SAVE_FOLDER_VISUALIZATION = Path(os.getcwd()) / "Overflow_Graph"
        if not config.SAVE_FOLDER_VISUALIZATION.exists():
            config.SAVE_FOLDER_VISUALIZATION.mkdir(parents=True, exist_ok=True)

        # Pre-build SimulationEnvironment so run_analysis_step1 can reuse it
        # (avoids ~4s network load + AC/DC LF + ~3.8s detect_non_reconnectable_lines on every call)
        try:
            from expert_op4grid_recommender.environment_pypowsybl import setup_environment_configs_pypowsybl
            env, _obs, env_path, chronic_name, custom_layout, _raw_dict, lines_non_reconnectable, lines_we_care_about = \
                setup_environment_configs_pypowsybl()
            self._cached_env_context = {
                'env': env,
                'path_chronic': env_path,
                'chronic_name': chronic_name,
                'custom_layout': custom_layout,
                'lines_non_reconnectable': lines_non_reconnectable,
                'lines_we_care_about': lines_we_care_about,
            }
            print("[RecommenderService] SimulationEnvironment pre-built and cached.")
        except Exception as e:
            print(f"[RecommenderService] Warning: Failed to pre-build SimulationEnvironment: {e}")
            self._cached_env_context = None

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
        """Runs the second step of analysis: graph generation and action discovery."""
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
                print(f"[Step2] Excluded {before_count - after_count} deselected overloads from monitoring: {deselected}")
                print(f"[Step2] lines_we_care_about: {before_count} -> {after_count}")
        else:
            print(f"[Step2] monitor_deselected={monitor_deselected}, all_overloads={all_overloads} -> NOT filtering lines_we_care_about")

        try:
            # Part 1: Graph generation and PDF
            context = run_analysis_step2_graph(context)
            
            # Yield PDF event (graph is generated in Step 2 Part 1)
            yield {"type": "pdf", "pdf_path": self._get_latest_pdf_path(analysis_start_time)}
            
            # Part 2: Action discovery
            results = run_analysis_step2_discovery(context)
            self._last_result = results # Store for diagram generation

            # Build enriched actions the same way as run_analysis - with monitoring_factor applied and topology
            enriched_actions = self._enrich_actions(results["prioritized_actions"])

            # Safety filter: ensure no combined actions (with '+') leak into the main actions feed during initial analysis
            # They should only exist in combined_actions as estimations.
            enriched_actions = {aid: data for aid, data in enriched_actions.items() if "+" not in aid}

            # Compute MW at start for score tables
            action_scores = self._compute_mw_start_for_scores(results.get("action_scores", {}))

            print(f"[Step 2] Yielding final result event with {len(enriched_actions)} enriched actions")
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
            action_scores = self._compute_mw_start_for_scores(action_scores)

            enriched_actions = self._enrich_actions(prioritized)

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

    def _run_ac_with_fallback(self, network, params):
        import pypowsybl.loadflow as lf
        
        is_fast_mode = getattr(config, 'PYPOWSYBL_FAST_MODE', False)
        if is_fast_mode:
            fast_params = lf.Parameters.from_json(params.to_json())
            fast_params.transformer_voltage_control_on = False
            fast_params.shunt_compensator_voltage_control_on = False
            try:
                results = lf.run_ac(network, parameters=fast_params)
                if results and results[0].status == lf.ComponentStatus.CONVERGED:
                    return results
            except Exception as e:
                print(f"Warning: Fast mode AC load flow failed ({e}). Retrying in slow mode...")
                
        return lf.run_ac(network, parameters=params)

    def _get_base_network(self):
        """Load and return the base pypowsybl network from config path, caching it."""
        if self._base_network is not None:
            return self._base_network

        import pypowsybl as pp

        network_file = config.ENV_PATH
        if network_file.is_dir():
            files = [f for f in network_file.iterdir() if f.suffix.lower() in ['.xiidm', '.iidm', '.xml']]
            if files:
                network_file = files[0]
            else:
                # Also check in grid/ subfolder
                grid_folder = network_file / "grid"
                if grid_folder.is_dir():
                    files = [f for f in grid_folder.iterdir() if f.suffix.lower() in ['.xiidm', '.iidm', '.xml']]
                    if files:
                        network_file = files[0]

        if not network_file.exists():
            raise FileNotFoundError(f"Network file not found: {network_file}")
        
        n = pp.network.load(str(network_file))
        # Convenience method not in pypowsybl API: return line IDs as a list
        n.get_line_ids = lambda: n.get_lines().index.tolist()
        self._base_network = n
        return self._base_network

    def _get_n_variant(self):
        """Return the variant ID for the N state, creating and simulating it if necessary."""
        n = self._get_base_network()
        variant_id = "N_state_cached"
        if variant_id not in n.get_variant_ids():
            original_variant = n.get_working_variant_id()
            n.clone_variant(original_variant, variant_id)
            n.set_working_variant(variant_id)
            params = create_olf_rte_parameter()
            self._run_ac_with_fallback(n, params)
            n.set_working_variant(original_variant)
        return variant_id

    def _get_n1_variant(self, contingency: str):
        """Return the variant ID for the N-1 state, creating and simulating it if necessary."""
        n = self._get_base_network()
        safe_cont = contingency.replace(" ", "_").replace("-", "_") if contingency else "none"
        variant_id = f"N_1_state_{safe_cont}"
        
        if variant_id not in n.get_variant_ids():
            original_variant = n.get_working_variant_id()
            n.clone_variant(original_variant, variant_id)
            n.set_working_variant(variant_id)
            if contingency:
                try:
                    n.disconnect(contingency)
                except Exception as e:
                    print(f"Failed to disconnect {contingency} for N-1 variant: {e}")
            params = create_olf_rte_parameter()
            self._run_ac_with_fallback(n, params)
            n.set_working_variant(original_variant)
        return variant_id

    def _get_simulation_env(self):
        """Return a SimulationEnvironment instance, caching it."""
        if self._simulation_env is not None:
            return self._simulation_env

        from expert_op4grid_recommender.pypowsybl_backend.simulation_env import SimulationEnvironment
        
        n = self._get_base_network()
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        
        # Initialize SimulationEnvironment with the pre-loaded network
        self._simulation_env = SimulationEnvironment(
            network=n,
            threshold_thermal_limit=monitoring_factor
        )
        return self._simulation_env

    def _get_monitoring_parameters(self, obs):
        """Get monitoring parameters (lines_we_care_about, branches_with_limits)."""
        # 1. Identify branches with permanent limits in pypowsybl
        try:
            n_grid = obs._network_manager.network
            limits = n_grid.get_operational_limits()
            if not limits.empty:
                # Filter for permanent thermal limits (type=CURRENT, duration=-1)
                perm_limits = limits[(limits['type'] == 'CURRENT') & (limits['acceptable_duration'] == -1)]
                branches_with_limits = set(perm_limits['element_id'].unique())
            else:
                branches_with_limits = set()
        except Exception as e:
            print(f"Warning: Failed to identify branches with limits: {e}")
            branches_with_limits = set(obs.name_line)

        # 2. Prefer using lines_we_care_about from active analysis context (respects user selection in Suggestions Feed)
        if self._analysis_context and "lines_we_care_about" in self._analysis_context:
            care = self._analysis_context["lines_we_care_about"]
            lines_we_care_about = list(care) if care is not None else list(obs.name_line)
            return lines_we_care_about, branches_with_limits

        # 3. Fallback to global config or full line list
        if not getattr(config, 'IGNORE_LINES_MONITORING', True) and getattr(config, 'LINES_MONITORING_FILE', None):
            try:
                lines_we_care_about = list(load_interesting_lines(file_name=config.LINES_MONITORING_FILE))
            except Exception as e:
                print(f"Failed to load lines_we_care_about from file: {e}")
                lines_we_care_about = list(obs.name_line)
        else:
            lines_we_care_about = list(obs.name_line)

        return lines_we_care_about, branches_with_limits

    def _load_layout(self):
        """Load layout DataFrame from grid_layout.json if available."""
        import pandas as pd
        import json

        layout_file = getattr(config, 'LAYOUT_FILE_PATH', None)
        if layout_file and layout_file.exists():
            try:
                with open(layout_file, 'r') as f:
                    layout_data = json.load(f)
                records = [{'id': k, 'x': v[0], 'y': v[1]} for k, v in layout_data.items()]
                return pd.DataFrame(records).set_index('id')
            except Exception as e:
                print(f"Warning: Could not load layout: {e}")
        return None

    def _default_nad_parameters(self):
        """Return default NadParameters for diagram generation."""
        from pypowsybl.network import NadParameters
        return NadParameters(
            edge_name_displayed=False,
            id_displayed=False,
            edge_info_along_edge=True,
            power_value_precision=1,
            angle_value_precision=0,
            current_value_precision=1,
            voltage_value_precision=0,
            bus_legend=True,
            substation_description_displayed=True
        )

    def _generate_diagram(self, network, voltage_level_ids=None, depth=0):
        """Generate NAD and return svg + metadata dict."""
        from pypowsybl_jupyter.util import _get_svg_string, _get_svg_metadata
        import time

        print(f"[RECO] Generating diagram (VLs={voltage_level_ids}, depth={depth})...")
        t0 = time.time()
        
        df_layout = self._load_layout()
        npars = self._default_nad_parameters()

        kwargs = dict(nad_parameters=npars)
        if df_layout is not None:
            kwargs['fixed_positions'] = df_layout
        if voltage_level_ids is not None:
            kwargs['voltage_level_ids'] = voltage_level_ids
            kwargs['depth'] = depth

        diagram = network.get_network_area_diagram(**kwargs)
        t1 = time.time()
        
        svg = _get_svg_string(diagram)
        t2 = time.time()
        
        meta = _get_svg_metadata(diagram)
        t3 = time.time()
        
        print(f"[RECO] Diagram generated: NAD {t1-t0:.2f}s, SVG {t2-t1:.2f}s, Meta {t3-t2:.2f}s (SVG length={len(svg)})")

        if "NaN" in svg:
            try:
                from lxml import etree
                parser = etree.XMLParser(recover=True, huge_tree=True)
                root = etree.fromstring(svg.encode('utf-8'), parser=parser)
                
                # Find all elements that have at least one attribute containing "NaN"
                to_remove = []
                for el in root.iter():
                    if any("NaN" in str(val) for val in el.attrib.values()):
                        to_remove.append(el)
                
                for el in to_remove:
                    parent = el.getparent()
                    if parent is not None:
                        parent.remove(el)
                
                svg = etree.tostring(root, encoding='unicode')
                print(f"[RECO] NaN-stripping complete: removed {len(to_remove)} elements.")
            except Exception as e:
                print(f"Warning: Failed to strip NaN from SVG: {e}")

        return {
            "svg": svg,
            "metadata": meta,
        }

    def get_network_diagram(self, voltage_level_ids=None, depth=0):
        import pypowsybl as pp
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n_variant_id = self._get_n_variant()
        n.set_working_variant(n_variant_id)

        try:
            diagram = self._generate_diagram(n, voltage_level_ids=voltage_level_ids, depth=depth)
            diagram["lines_overloaded"] = self._get_overloaded_lines(n, lines_we_care_about=self._get_lines_we_care_about())
            # Cache N-state element currents for N-1 comparison
            self._n_state_currents = self._get_element_max_currents(n)
            return diagram
        finally:
            n.set_working_variant(original_variant) # Restore original variant

    def get_n1_diagram(self, disconnected_element: str, voltage_level_ids=None, depth=0):
        import pypowsybl as pp
        import time

        print(f"[RECO] Generating N-1 diagram for {disconnected_element} (VLs={voltage_level_ids}, depth={depth})...")
        t_start = time.time()

        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)

        try:
            # Check convergence — partial AC results are still better than DC
            # (DC only computes angles/power, not voltage magnitudes).
            # We need to re-run AC to get the results object for status
            t0 = time.time()
            params = create_olf_rte_parameter()
            results = self._run_ac_with_fallback(n, params)
            converged = any(r.status.name == 'CONVERGED' for r in results)
            lf_status = results[0].status.name if results else "UNKNOWN"
            if not converged:
                print(f"Warning: AC load flow did not converge for N-1 ({disconnected_element}): {lf_status}")
            print(f"[RECO] N-1 LF check {disconnected_element}: {time.time()-t0:.2f}s")

            diagram = self._generate_diagram(n, voltage_level_ids=voltage_level_ids, depth=depth)
            diagram["lf_converged"] = converged
            diagram["lf_status"] = lf_status

            # Include flow deltas vs base (N) state
            try:
                # IMPORTANT: Extract N-1 flows while N-1 variant is STILL ACTIVE on 'n'
                n1_flows = self._get_network_flows(n)
                n1_assets = self._get_asset_flows(n)

                n_base = self._get_base_network()
                original_variant_base = n_base.get_working_variant_id()
                n_variant_id_base = self._get_n_variant()
                n_base.set_working_variant(n_variant_id_base)

                base_flows = self._get_network_flows(n_base)
                base_assets = self._get_asset_flows(n_base)

                deltas = self._compute_deltas(n1_flows, base_flows)
                diagram["flow_deltas"] = deltas["flow_deltas"]
                diagram["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
                diagram["asset_deltas"] = self._compute_asset_deltas(n1_assets, base_assets)
                
                n_base.set_working_variant(original_variant_base) # Restore original variant for base network
            except Exception as e:
                print(f"Warning: Failed to compute N-1 flow deltas: {e}")
                diagram["flow_deltas"] = {}
                diagram["reactive_flow_deltas"] = {}
                diagram["asset_deltas"] = {}

            # Exclude pre-existing overloads (already overloaded in N) unless worsened
            n_state_currents = getattr(self, '_n_state_currents', None)
            diagram["lines_overloaded"] = self._get_overloaded_lines(
                n, n_state_currents=n_state_currents, lines_we_care_about=self._get_lines_we_care_about()
            )
            return diagram
        finally:
            n.set_working_variant(original_variant) # Restore original variant

    def get_action_variant_diagram(self, action_id, voltage_level_ids=None, depth=0, mode="network"):
        """Generate a NAD showing the network state after applying a remedial action.

        Uses the variant ID and network manager stored in the observation from
        the last analysis run to switch to the post-action network state
        directly, avoiding the need to replay disconnections on a fresh network.

        Args:
            action_id: ID of the action to visualize
            voltage_level_ids: list of VL IDs to center on (None = full grid)
            depth: number of hops from center VLs to include
            mode: "network" for bare NAD, "delta" to include flow deltas vs N-1
        """
        import pypowsybl as pp
        
        if not self._last_result or not self._last_result.get("prioritized_actions"):
            raise ValueError("No analysis result available. Run analysis first.")

        actions = self._last_result["prioritized_actions"]
        if action_id not in actions:
            raise ValueError(f"Action '{action_id}' not found in last analysis result.")

        obs = actions[action_id]["observation"]

        # Extract the variant ID and network manager from the observation
        variant_id = obs._variant_id
        nm = obs._network_manager

        # Switch to the action's variant which already contains the
        # post-action network state with load flow results
        nm.set_working_variant(variant_id)

        # Use the underlying pypowsybl network directly
        network = nm.network

        diagram = self._generate_diagram(network, voltage_level_ids=voltage_level_ids, depth=depth)
        diagram["action_id"] = action_id

        # Capture convergence status for the map banner
        info_action = getattr(obs, '_last_info', {})
        sim_exception = info_action.get("exception")
        diagram["lf_converged"] = not bool(sim_exception)
        non_convergence = None
        if sim_exception:
            if isinstance(sim_exception, list):
                non_convergence = "; ".join([str(e) for e in sim_exception])
            else:
                non_convergence = str(sim_exception)
        diagram["lf_status"] = non_convergence if non_convergence else "CONVERGED"
        diagram["non_convergence"] = non_convergence

        # Always include flow deltas so mode switching is instant on the frontend
        try:
            # Get Action flows
            action_flows = self._get_network_flows(network)
            action_assets = self._get_asset_flows(network)

            # Get N-1 flows (re-simulate contingency on a fresh network)
            n1_flows = self._get_n1_flows(self._last_disconnected_element)
            
            n1_network = self._get_base_network() # Need a network object to get assets
            original_variant_n1 = n1_network.get_working_variant_id()
            n1_variant_id_n1 = self._get_n1_variant(self._last_disconnected_element)
            n1_network.set_working_variant(n1_variant_id_n1)
            n1_assets = self._get_asset_flows(n1_network)
            n1_network.set_working_variant(original_variant_n1)

            deltas = self._compute_deltas(action_flows, n1_flows, voltage_level_ids=voltage_level_ids)
            diagram["flow_deltas"] = deltas["flow_deltas"]
            diagram["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            diagram["asset_deltas"] = self._compute_asset_deltas(action_assets, n1_assets)
        except Exception as e:
            print(f"Warning: Failed to compute flow deltas: {e}")
            diagram["flow_deltas"] = {}
            diagram["reactive_flow_deltas"] = {}
            diagram["asset_deltas"] = {}

        return diagram

    def get_action_variant_sld(self, action_id: str, voltage_level_id: str) -> dict:
        """Generate a Single Line Diagram (SLD) for a specific VL in the post-action state.

        Args:
            action_id: ID of the action to visualize
            voltage_level_id: ID of the voltage level to diagram
        """
        if not self._last_result or not self._last_result.get("prioritized_actions"):
            raise ValueError("No analysis result available. Run analysis first.")

        actions = self._last_result["prioritized_actions"]
        if action_id not in actions:
            raise ValueError(f"Action '{action_id}' not found in last analysis result.")

        # Get original action variant and the base N-1 variant 
        obs = actions[action_id]["observation"]
        action_variant_id = obs._variant_id
        nm = obs._network_manager
        
        # Switch to action variant to generate SLD and get flows
        nm.set_working_variant(action_variant_id)
        network = nm.network
        sld = network.get_single_line_diagram(voltage_level_id)
        svg, sld_metadata = self._extract_sld_svg_and_metadata(sld)
        
        result = {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "action_id": action_id,
            "voltage_level_id": voltage_level_id,
        }

        # Capture convergence status for the SLD
        info_action = getattr(obs, '_last_info', {})
        sim_exception = info_action.get("exception")
        result["lf_converged"] = not bool(sim_exception)
        non_convergence = None
        if sim_exception:
            if isinstance(sim_exception, list):
                non_convergence = "; ".join([str(e) for e in sim_exception])
            else:
                non_convergence = str(sim_exception)
        result["lf_status"] = non_convergence if non_convergence else "CONVERGED"
        result["non_convergence"] = non_convergence
        
        try:
            # We already have action flows from the network (still on action variant)
            action_flows = self._get_network_flows(network)
            action_assets = self._get_asset_flows(network)

            # Capture action switch states before switching variant
            try:
                action_switches_df = network.get_switches()
            except Exception:
                action_switches_df = None

            # Switch back to N-1 variant to get reference flows for the deltas
            n1_flows = self._get_n1_flows(self._last_disconnected_element)

            n1_network = self._get_base_network()
            original_variant_n1 = n1_network.get_working_variant_id()
            n1_variant_id_n1 = self._get_n1_variant(self._last_disconnected_element)
            n1_network.set_working_variant(n1_variant_id_n1)
            n1_assets = self._get_asset_flows(n1_network)

            # Compare switch states between N-1 and action to find changed switches
            changed_switches = {}
            if action_switches_df is not None:
                try:
                    n1_switches_df = n1_network.get_switches()
                    for sw_id in action_switches_df.index:
                        if sw_id in n1_switches_df.index:
                            a_open = bool(action_switches_df.loc[sw_id, 'open'])
                            n1_open = bool(n1_switches_df.loc[sw_id, 'open'])
                            if a_open != n1_open:
                                changed_switches[sw_id] = {
                                    'from_open': n1_open,
                                    'to_open': a_open,
                                }
                except Exception as e:
                    print(f"Warning: Failed to compare switch states: {e}")
            result["changed_switches"] = changed_switches

            n1_network.set_working_variant(original_variant_n1)

            deltas = self._compute_deltas(action_flows, n1_flows, voltage_level_ids=[voltage_level_id])
            result["flow_deltas"] = deltas["flow_deltas"]
            result["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            result["asset_deltas"] = self._compute_asset_deltas(action_assets, n1_assets)
        except Exception as e:
            print(f"Warning: Failed to compute SLD flow deltas for manual action: {e}")
            result["flow_deltas"] = {}
            result["reactive_flow_deltas"] = {}
            result["asset_deltas"] = {}

        return result

    def get_n_sld(self, voltage_level_id: str) -> dict:
        """Generate a Single Line Diagram (SLD) in the base N state."""
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n_variant_id = self._get_n_variant()
        n.set_working_variant(n_variant_id)

        sld = n.get_single_line_diagram(voltage_level_id)
        svg, sld_metadata = self._extract_sld_svg_and_metadata(sld)

        n.set_working_variant(original_variant) # Restore original variant
        return {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "voltage_level_id": voltage_level_id,
        }

    def get_n1_sld(self, disconnected_element: str, voltage_level_id: str) -> dict:
        """Generate a Single Line Diagram (SLD) in the N-1 state."""
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)

        sld = n.get_single_line_diagram(voltage_level_id)
        svg, sld_metadata = self._extract_sld_svg_and_metadata(sld)

        result = {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "voltage_level_id": voltage_level_id,
            "disconnected_element": disconnected_element
        }
        
        try:
            # IMPORTANT: Extract N-1 flows while N-1 variant is STILL ACTIVE on 'n'
            n1_flows = self._get_network_flows(n)
            n1_assets = self._get_asset_flows(n)

            n_base = self._get_base_network()
            original_variant_base = n_base.get_working_variant_id()
            n_variant_id_base = self._get_n_variant()
            n_base.set_working_variant(n_variant_id_base)

            base_flows = self._get_network_flows(n_base)
            base_assets = self._get_asset_flows(n_base)

            deltas = self._compute_deltas(n1_flows, base_flows, voltage_level_ids=[voltage_level_id])
            result["flow_deltas"] = deltas["flow_deltas"]
            result["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            result["asset_deltas"] = self._compute_asset_deltas(n1_assets, base_assets)
            
            n_base.set_working_variant(original_variant_base) # Restore original variant for base network
        except Exception as e:
            print(f"Warning: Failed to compute SLD flow deltas for N-1: {e}")
            result["flow_deltas"] = {}
            result["reactive_flow_deltas"] = {}
            result["asset_deltas"] = {}

        n.set_working_variant(original_variant) # Restore original variant
        return result

    @staticmethod
    def _extract_sld_svg_and_metadata(sld) -> tuple:
        """Extract SVG string and metadata JSON from a pypowsybl SLD diagram object.

        Returns (svg_str, metadata_str_or_None).
        The metadata JSON contains 'feederNodes' with {id, equipmentId} entries
        that map SVG element IDs back to network equipment IDs.
        """
        try:
            from pypowsybl_jupyter.util import _get_svg_string, _get_svg_metadata
            svg = _get_svg_string(sld)
            metadata = _get_svg_metadata(sld)
        except Exception:
            try:
                svg = sld._repr_svg_()
            except Exception:
                svg = str(sld)
            metadata = getattr(sld, '_metadata', None)
        return svg, metadata

    def _get_lines_we_care_about(self):
        """Return the set of monitored line IDs, or None if all lines are monitored."""
        if not getattr(config, 'IGNORE_LINES_MONITORING', True) and getattr(config, 'LINES_MONITORING_FILE', None):
            try:
                from expert_op4grid_recommender.data_loader import load_interesting_lines
                return set(load_interesting_lines(file_name=config.LINES_MONITORING_FILE))
            except Exception as e:
                print(f"Warning: Failed to load lines_we_care_about: {e}")
        return None

    def _get_overloaded_lines(self, network, n_state_currents=None, lines_we_care_about=None):
        """Get overloaded lines and transformers.

        Args:
            network: pypowsybl network after load flow.
            n_state_currents: If provided, dict {element_id: max_i_N} from the
                N-state.  Pre-existing overloads (elements also overloaded in N)
                are excluded unless their current increased by more than the
                worsening threshold.
            lines_we_care_about: If provided, set of element IDs to monitor.
                Only these elements are checked for overloads.
        """
        import numpy as np
        limits = network.get_operational_limits()
        if limits.empty:
            limit_dict = {}
        else:
            limits = limits.reset_index()
            current_limits = limits[(limits['type'] == 'CURRENT') & (limits['acceptable_duration'] == -1)]
            limit_dict = dict(zip(current_limits['element_id'], current_limits['value']))
        
        overloaded = []
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        worsening_threshold = getattr(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02)
        default_limit = 9999.0  # Same default as the recommender

        # Check both lines and 2-winding transformers
        for df in [network.get_lines()[['i1', 'i2']], network.get_2_windings_transformers()[['i1', 'i2']]]:
            for element_id, row in df.iterrows():
                # Skip elements not in the monitored set
                if lines_we_care_about is not None and element_id not in lines_we_care_about:
                    continue
                
                limit = limit_dict.get(element_id)
                if limit is None:
                    # No permanent limit found for this branch, skip monitoring
                    continue
                    
                i1 = row['i1']
                i2 = row['i2']
                if not np.isnan(i1) and not np.isnan(i2):
                    max_i = max(abs(i1), abs(i2))
                    if max_i > limit * monitoring_factor:
                        # If N-state currents provided, filter pre-existing overloads
                        if n_state_currents is not None and element_id in n_state_currents:
                            n_max_i = n_state_currents[element_id]
                            if n_max_i > limit * monitoring_factor:
                                # Was already overloaded in N — only keep if worsened
                                if max_i <= n_max_i * (1 + worsening_threshold):
                                    continue
                        overloaded.append(element_id)
        return sanitize_for_json(overloaded)

    def _get_element_max_currents(self, network):
        """Return {element_id: max(|i1|, |i2|)} for all lines and transformers."""
        import numpy as np
        currents = {}
        for df in [network.get_lines()[['i1', 'i2']], network.get_2_windings_transformers()[['i1', 'i2']]]:
            for element_id, row in df.iterrows():
                i1, i2 = row['i1'], row['i2']
                if not np.isnan(i1) and not np.isnan(i2):
                    currents[element_id] = max(abs(i1), abs(i2))
        return currents

    def _get_n1_flows(self, contingency: str) -> dict:
        """Retrieve the branch flows of the network in the N-1 state using a cached variant."""
        n = self._get_base_network()
        var_id = self._get_n1_variant(contingency)
        original_variant = n.get_working_variant_id()
        
        n.set_working_variant(var_id)
        flows = self._get_network_flows(n)
        n.set_working_variant(original_variant)
        return flows

    def _get_network_flows(self, network):
        """Extract p1/p2 and q1/q2 flows for lines and transformers from a simulated network.

        Also extracts voltage_level1_id and voltage_level2_id so the frontend
        can determine which terminal corresponds to the SLD voltage level.
        """
        import numpy as np
        import pandas as pd

        lines = network.get_lines()[['p1', 'p2', 'q1', 'q2', 'voltage_level1_id', 'voltage_level2_id']]
        trafos = network.get_2_windings_transformers()[['p1', 'p2', 'q1', 'q2', 'voltage_level1_id', 'voltage_level2_id']]

        # Vectorized approach
        combined = pd.concat([lines, trafos])
        
        # Fill NaN with 0.0
        combined[['p1', 'p2', 'q1', 'q2']] = combined[['p1', 'p2', 'q1', 'q2']].fillna(0.0)
        
        # Convert to dicts
        return {
            "p1": combined['p1'].to_dict(),
            "p2": combined['p2'].to_dict(),
            "q1": combined['q1'].to_dict(),
            "q2": combined['q2'].to_dict(),
            "vl1": combined['voltage_level1_id'].to_dict(),
            "vl2": combined['voltage_level2_id'].to_dict(),
        }

    def _get_asset_flows(self, network):
        """Extract p/q flows for loads and generators from a simulated network."""
        import numpy as np

        loads = network.get_loads()[['p', 'q']]
        gens = network.get_generators()[['p', 'q']]

        flows = {}
        for lid in loads.index:
            pv = loads.loc[lid, 'p'] if not np.isnan(loads.loc[lid, 'p']) else 0.0
            qv = loads.loc[lid, 'q'] if not np.isnan(loads.loc[lid, 'q']) else 0.0
            flows[lid] = {"p": pv, "q": qv}
        for gid in gens.index:
            pv = gens.loc[gid, 'p'] if not np.isnan(gens.loc[gid, 'p']) else 0.0
            qv = gens.loc[gid, 'q'] if not np.isnan(gens.loc[gid, 'q']) else 0.0
            flows[gid] = {"p": pv, "q": qv}

        return flows

    @staticmethod
    def _terminal_aware_delta(after_val, before_val):
        """Compute a direction-aware delta at a single observed terminal.

        pypowsybl sign convention: positive = power *enters* at that terminal.

        Algorithm:
          1. Take absolute values of both states at the observed terminal.
          2. Reference direction = sign (direction) of the state with the
             strongest absolute value.
          3. Transform each value to match the reference direction:
             +abs(val) if same direction as reference, -abs(val) if opposite.
          4. delta = transformed_after - transformed_before.
          5. flip_arrow = True when the reference is the before state AND
             the two states have different signs (direction reversed).

        The delta sign is consistent with the category colour:
          positive (orange) = flow increased
          negative (blue)   = flow decreased

        Returns (delta: float, flip_arrow: bool).
        """
        abs_after = abs(after_val)
        abs_before = abs(before_val)

        # Reference: the state with the strongest absolute value
        if abs_after >= abs_before:
            ref_positive = (after_val >= 0)
            ref_is_before = False
        else:
            ref_positive = (before_val >= 0)
            ref_is_before = True

        # Transform: +abs if same direction as reference, -abs if opposite
        def _signed(val):
            if val == 0:
                return 0.0
            same_dir = (val > 0) == ref_positive
            return abs(val) if same_dir else -abs(val)

        delta = _signed(after_val) - _signed(before_val)

        # flip_arrow when the Action SVG visual arrow (which points based on after_val's sign)
        # is geometrically opposite to the Reference state visual arrow (which points based on ref_positive).
        # Since pypowsybl draws IN/OUT based purely on positive/negative value:
        after_positive = (after_val >= 0)
        flip_arrow = bool(after_positive != ref_positive)

        return delta, flip_arrow

    @staticmethod
    def _select_terminal_for_branch(lid, avl1, avl2, bvl1, bvl2, vl_set):
        """Select which terminal (1 or 2) to observe for a given branch.

        Picks the terminal whose voltage level is in the requested set.
        Falls back to terminal 1 when both or neither match.
        """
        if not vl_set:
            return 1
        v1 = avl1.get(lid) or bvl1.get(lid)
        v2 = avl2.get(lid) or bvl2.get(lid)
        if v1 in vl_set and v2 not in vl_set:
            return 1
        if v2 in vl_set and v1 not in vl_set:
            return 2
        return 1

    @staticmethod
    def _apply_threshold(deltas):
        """Categorise raw deltas using a 5 % threshold of the max absolute delta.

        Returns {id: {delta, category}}.
        """
        if deltas:
            max_abs = max(abs(d) for d in deltas.values())
        else:
            max_abs = 0.0
        threshold = max_abs * 0.05

        result = {}
        for lid, delta in deltas.items():
            if abs(delta) < threshold:
                cat = "grey"
            elif delta > 0:
                cat = "positive"
            else:
                cat = "negative"
            result[lid] = {"delta": round(float(delta), 1), "category": cat}
        return result

    def _compute_deltas(self, after_flows, before_flows, voltage_level_ids=None):
        """Compute per-line active AND reactive flow deltas between two flow sets.

        Terminal-aware computation: for each branch, selects the terminal
        whose voltage level matches one of *voltage_level_ids* (the VLs
        displayed in the diagram).  P and Q deltas are computed
        **independently** using ``_terminal_aware_delta`` on the selected
        terminal's values.

        Vectorized implementation (pandas/numpy).
        """
        import numpy as np
        import pandas as pd

        # Build DataFrames for fast alignment
        # after_flows keys are p1, p2, q1, q2, vl1, vl2
        df_after = pd.DataFrame(after_flows)
        df_before = pd.DataFrame(before_flows)
        
        # Combine to ensure we have all branches
        all_ids = df_after.index.union(df_before.index)
        df_after = df_after.reindex(all_ids).fillna(0.0)
        df_before = df_before.reindex(all_ids).fillna(0.0)
        
        # 1. Terminal selection logic (vectorized version of _select_terminal_for_branch)
        vl_set = set(voltage_level_ids) if voltage_level_ids else set()
        terminal_mask = np.ones(len(all_ids), dtype=int)
        if vl_set:
            v1 = df_after["vl1"]
            v2 = df_after["vl2"]
            is_v1 = v1.isin(vl_set)
            is_v2 = v2.isin(vl_set)
            # Terminal 2 if side 2 matches but side 1 doesn't (arbitrary priority)
            terminal_mask[~is_v1 & is_v2] = 2
            
        # 2. Extract active and reactive flows based on selected terminal
        a_p = np.where(terminal_mask == 1, df_after["p1"], df_after["p2"])
        b_p = np.where(terminal_mask == 1, df_before["p1"], df_before["p2"])
        a_q = np.where(terminal_mask == 1, df_after["q1"], df_after["q2"])
        b_q = np.where(terminal_mask == 1, df_before["q1"], df_before["q2"])

        # 3. Delta computation logic (vectorized version of _terminal_aware_delta)
        def compute_delta_vectorized(after_val, before_val):
            abs_a = np.abs(after_val)
            abs_b = np.abs(before_val)
            # Reference: the state with the strongest absolute value
            ref_pos = np.where(abs_a >= abs_b, after_val >= 0, before_val >= 0)
            
            # Transform value: val if ref_pos else -val
            a_ref = np.where(ref_pos, after_val, -after_val)
            b_ref = np.where(ref_pos, before_val, -before_val)
            delta = a_ref - b_ref
            
            # flip_arrow when after_val orientation diffs from reference orientation
            flip = (after_val >= 0) != ref_pos
            return delta, flip

        dp, flip_p = compute_delta_vectorized(a_p, b_p)
        dq, flip_q = compute_delta_vectorized(a_q, b_q)

        # 4. Independent category classification for P and Q
        def get_categories_vectorized(deltas):
            max_abs = np.max(np.abs(deltas)) if len(deltas) > 0 else 0.0
            thresh = max_abs * 0.05
            cats = np.full(len(deltas), "grey", dtype=object)
            if max_abs > 0:
                mask_sig = np.abs(deltas) >= thresh
                cats[mask_sig] = np.where(deltas[mask_sig] > 0, "positive", "negative")
            return cats

        cats_p = get_categories_vectorized(dp)
        cats_q = get_categories_vectorized(dq)

        # 5. Pack results back into dict format
        res_p = {}
        res_q = {}
        for i, lid in enumerate(all_ids):
            res_p[lid] = {
                "delta": round(float(dp[i]), 1),
                "category": cats_p[i],
                "flip_arrow": bool(flip_p[i]),
            }
            res_q[lid] = {
                "delta": round(float(dq[i]), 1),
                "category": cats_q[i],
                "flip_arrow": bool(flip_q[i]),
            }

        return {
            "flow_deltas": res_p,
            "reactive_flow_deltas": res_q,
        }

    def _compute_asset_deltas(self, after_asset_flows, before_asset_flows):
        """Compute delta P and Q for loads and generators.

        Returns {asset_id: {delta_p, delta_q, category, category_p, category_q}}.
        Category colors for P and Q are calculated independently.
        The legacy 'category' key follows the P delta.
        """
        all_ids = set(after_asset_flows.keys()) | set(before_asset_flows.keys())
        raw_p = {}
        raw_q = {}
        for aid in all_ids:
            a = after_asset_flows.get(aid, {"p": 0.0, "q": 0.0})
            b = before_asset_flows.get(aid, {"p": 0.0, "q": 0.0})
            raw_p[aid] = a["p"] - b["p"]
            raw_q[aid] = a["q"] - b["q"]

        # Threshold based on active power deltas
        if raw_p:
            max_abs_p = max(abs(d) for d in raw_p.values())
        else:
            max_abs_p = 0.0
        threshold_p = max_abs_p * 0.05
        
        # Threshold based on reactive power deltas
        if raw_q:
            max_abs_q = max(abs(d) for d in raw_q.values())
        else:
            max_abs_q = 0.0
        threshold_q = max_abs_q * 0.05

        result = {}
        for aid in all_ids:
            dp = raw_p[aid]
            dq = raw_q[aid]
            
            # P category
            if max_abs_p == 0.0 or abs(dp) < threshold_p:
                cat_p = "grey"
            elif dp > 0:
                cat_p = "positive"
            else:
                cat_p = "negative"
                
            # Q category
            if max_abs_q == 0.0 or abs(dq) < threshold_q:
                cat_q = "grey"
            elif dq > 0:
                cat_q = "positive"
            else:
                cat_q = "negative"
                
            result[aid] = {
                "delta_p": round(float(dp), 1),
                "delta_q": round(float(dq), 1),
                "category": cat_p,
                "category_p": cat_p,
                "category_q": cat_q,
            }

        return result

    def get_all_action_ids(self):
        """Return a list of {id, description, type} for every action in the loaded dictionary."""
        if not self._dict_action:
            raise ValueError("No action dictionary loaded. Load a config first.")
        
        from expert_op4grid_recommender.action_evaluation.classifier import ActionClassifier
        classifier = ActionClassifier()
        
        result = []
        for action_id, action_desc in self._dict_action.items():
            result.append({
                "id": action_id,
                "description": action_desc.get("description_unitaire",
                                               action_desc.get("description", "")),
                "type": classifier.identify_action_type(action_desc)
            })
        return result

    @staticmethod
    def _canonicalize_id(action_id: str) -> str:
        if not action_id or "+" not in action_id:
            return action_id
        return "+".join(sorted([p.strip() for p in action_id.split("+")]))

    @staticmethod
    def _build_action_entry_from_topology(action_id, topo):
        """Build an action dict entry from saved topology fields.

        Converts action_topology (lines_ex_bus, lines_or_bus, gens_bus,
        loads_bus, substations) back into a content dict that
        env.action_space(content) can parse.
        """
        entry = {"description_unitaire": f"Restored action: {action_id}"}
        content = {}

        # Build set_bus from element-level topology (dict format, matching raw action files)
        set_bus = {}
        topo_to_content = {
            "lines_ex_bus": "lines_ex_id",
            "lines_or_bus": "lines_or_id",
            "gens_bus": "generators_id",
            "loads_bus": "loads_id",
        }
        for topo_field, content_field in topo_to_content.items():
            vals = topo.get(topo_field)
            if vals and isinstance(vals, dict):
                set_bus[content_field] = {name: int(bus) for name, bus in vals.items()}

        # Include substations (critical for node_merging_* actions)
        subs = topo.get("substations") or {}
        if subs:
            set_bus["substations_id"] = [
                (int(sub_id), [int(b) for b in bus_array])
                for sub_id, bus_array in subs.items()
            ]

        if set_bus:
            content["set_bus"] = set_bus

        # Include switches if present
        switches = topo.get("switches") or {}
        if switches:
            content["switches"] = switches

        # Include PST tap if present
        pst_tap = topo.get("pst_tap") or {}
        if pst_tap:
            content["pst_tap"] = pst_tap

        # Power reduction actions: set_load_p / set_gen_p (new format)
        loads_p = topo.get("loads_p") or {}
        if loads_p and isinstance(loads_p, dict):
            content["set_load_p"] = {name: float(p) for name, p in loads_p.items()}

        gens_p = topo.get("gens_p") or {}
        if gens_p and isinstance(gens_p, dict):
            content["set_gen_p"] = {name: float(p) for name, p in gens_p.items()}

        entry["content"] = content if content else {}
        return entry

    def simulate_manual_action(self, raw_action_id: str, disconnected_element: str, action_content=None, lines_overloaded=None, target_mw=None):
        """Simulate a single or combined action and return its impact.

        raw_action_id can be a single ID or multiple IDs combined with '+' (e.g. 'act1+act2').
        action_content: optional dict with topology fields (switches, lines_ex_bus, etc.)
                        for actions not in the dictionary (e.g. restored from a saved session).
        lines_overloaded: optional list of overloaded line names from the saved session,
                          used when _analysis_context is missing (e.g. after session reload)
                          to determine which lines to report rho_before/rho_after for.
        target_mw: optional MW reduction amount for load shedding / curtailment actions.
                   When provided, the action reduces power by this amount instead of fully
                   shedding/curtailing. The resulting setpoint is (current_mw - target_mw).
        """
        if not self._dict_action:
            raise ValueError("No action dictionary loaded. Load a config first.")

        action_id = self._canonicalize_id(raw_action_id.strip())
        if lines_overloaded is None:
            lines_overloaded = []

        action_ids = action_id.split("+")
        recent_actions = self._last_result.get("prioritized_actions", {}) if self._last_result else {}

        # If action_content is provided, inject unknown actions into the dict.
        # action_content can be:
        #   - A single topology dict (for individual actions)
        #   - A dict mapping action_id -> topology (for combined actions)
        if action_content:
            # Normalize: if it looks like a topology dict (has topology keys),
            # wrap it as {action_id: topology} for uniform handling.
            topo_keys = {"lines_ex_bus", "lines_or_bus", "gens_bus", "loads_bus", "substations", "switches", "loads_p", "gens_p"}
            if any(k in action_content for k in topo_keys):
                # Single topology — apply to all unknown action_ids
                per_action = {aid: action_content for aid in action_ids}
            else:
                # Dict mapping action_id -> topology
                per_action = action_content

            for aid in action_ids:
                if aid not in self._dict_action and aid not in recent_actions:
                    topo = per_action.get(aid)
                    if not topo:
                        continue
                    entry = self._build_action_entry_from_topology(aid, topo)
                    self._dict_action[aid] = entry
                    print(f"[simulate_manual_action] Injected restored action '{aid}' into dict")

        # 1. Retrieve N-1 observation once for the entire call
        obs_n1 = None
        try:
            env_tmp = self._get_simulation_env()
            nm_tmp = env_tmp.network_manager
            n_tmp = nm_tmp.network
            n1_var = self._get_n1_variant(disconnected_element)
            if self._cached_obs_n1 is not None and self._cached_obs_n1_id == n1_var:
                obs_n1 = self._cached_obs_n1
            else:
                n_tmp.set_working_variant(n1_var)
                obs_n1 = env_tmp.get_obs()
                self._cached_obs_n1 = obs_n1
                self._cached_obs_n1_id = n1_var
        except Exception as e:
            print(f"[simulate_manual_action] Warning: Could not retrieve N-1 observation: {e}")

        # Helper: compute the power setpoint for a load/gen given target_mw reduction
        def _compute_setpoint(element_name, element_type, target_mw_val, obs_n1=None):
            """Compute remaining MW setpoint: current_mw - target_mw, clamped to >= 0.

            element_type: 'load' or 'gen'
            Returns the setpoint (remaining MW after reduction).
            If the N-1 observation is unavailable, falls back to 0.0 (full reduction).
            """
            if target_mw_val is None:
                return 0.0
            
            if obs_n1 is None:
                return 0.0
                
            try:
                if element_type == 'load':
                    idx = list(obs_n1.name_load).index(element_name)
                    current_mw = float(obs_n1.load_p[idx])
                else:
                    idx = list(obs_n1.name_gen).index(element_name)
                    current_mw = float(obs_n1.gen_p[idx])

                remaining = max(0.0, abs(current_mw) - float(target_mw_val))
                return round(remaining, 2)
            except Exception as e:
                print(f"[simulate_manual_action] Could not compute setpoint for {element_name}: {e}, falling back to 0.0")
                return 0.0

        # Handle dynamic action creation for special prefixes (load shedding, PST)
        for aid in action_ids:
            if aid not in self._dict_action and aid not in recent_actions:
                # Try to create on-the-fly
                if aid.startswith("curtail_"):

                    gen_name = aid[len("curtail_"):]
                    # New power reduction format: set generator output to target MW
                    setpoint = _compute_setpoint(gen_name, 'gen', target_mw, obs_n1=obs_n1)
                    topo = {"gens_p": {gen_name: setpoint}}
                    entry = self._build_action_entry_from_topology(aid, topo)

                    # Align with suggested action description format to help frontend discovery
                    vl_id = None
                    try:
                        from expert_backend.services.network_service import network_service as ns
                        vl_id = ns.get_generator_voltage_level(gen_name)
                    except Exception:
                        pass
                    if vl_id:
                        entry["description"] = f"Renewable curtailment on generator '{gen_name}' at voltage level '{vl_id}'"
                        entry["description_unitaire"] = f"Effacement '{gen_name}' ('{vl_id}')"
                    else:
                        entry["description"] = f"Renewable curtailment on generator '{gen_name}'"
                        entry["description_unitaire"] = f"Effacement '{gen_name}'"

                    self._dict_action[aid] = entry
                    print(f"[simulate_manual_action] Created dynamic curtailment action '{aid}' (setpoint={setpoint} MW)")

                elif aid.startswith("load_shedding_"):
                    load_name = aid[len("load_shedding_"):]
                    # New power reduction format: set load consumption to target MW
                    setpoint = _compute_setpoint(load_name, 'load', target_mw, obs_n1=obs_n1)
                    topo = {"loads_p": {load_name: setpoint}}
                    entry = self._build_action_entry_from_topology(aid, topo)

                    vl_id = None
                    try:
                        from expert_backend.services.network_service import network_service as ns
                        vl_id = ns.get_load_voltage_level(load_name)
                    except Exception:
                        pass
                    if vl_id:
                        entry["description"] = f"Load shedding on '{load_name}' at voltage level '{vl_id}'"
                        entry["description_unitaire"] = f"Effacement '{load_name}' ('{vl_id}')"
                    else:
                        entry["description"] = f"Load shedding on '{load_name}'"
                        entry["description_unitaire"] = f"Effacement '{load_name}'"

                    self._dict_action[aid] = entry
                    print(f"[simulate_manual_action] Created dynamic load shedding action '{aid}' (setpoint={setpoint} MW)")


                elif aid.startswith("pst_tap_") or aid.startswith("pst_"):
                    # Example: pst_tap_PST_ID_inc1 or pst_tap_PST_ID_dec2
                    import re
                    # Look for pattern pst_tap_<id>_(inc|dec)<val> or pst_<id>_(inc|dec)<val>
                    match = re.match(r'(pst(?:_tap)?_(.+))_(inc|dec)(\d+)$', aid)
                    if match:
                        _, pst_id, direction, val_str = match.groups()
                        val = int(val_str)
                        
                        # Get current tap info from network
                        env = self._get_simulation_env()
                        nm = env.network_manager
                        pst_info = nm.get_pst_tap_info(pst_id)
                        
                        if pst_info:
                            current_tap = pst_info['tap']
                            variation = val if direction == 'inc' else -val
                            new_tap = current_tap + variation
                            # Clamp to bounds
                            new_tap = max(pst_info['low_tap'], min(pst_info['high_tap'], new_tap))
                            
                            topo = {"pst_tap": {pst_id: new_tap}}
                            entry = self._build_action_entry_from_topology(aid, topo)
                            entry["description"] = f"PST tap change for {pst_id} (tap: {current_tap} -> {new_tap})"
                            entry["description_unitaire"] = f"Variation PST {pst_id}"
                            self._dict_action[aid] = entry
                            print(f"[simulate_manual_action] Created dynamic PST action '{aid}'")

        for aid in action_ids:
            if aid not in self._dict_action and aid not in recent_actions:
                raise ValueError(f"Action '{aid}' not found in the loaded action dictionary or recent analysis.")

        # Use cached environment
        env = self._get_simulation_env()
        nm = env.network_manager
        n = nm.network
        
        original_variant = n.get_working_variant_id()
        n_variant_id = self._get_n_variant()
        if self._cached_obs_n is not None and self._cached_obs_n_id == n_variant_id:
            obs = self._cached_obs_n
        else:
            n.set_working_variant(n_variant_id)
            obs = env.get_obs()
            self._cached_obs_n = obs
            self._cached_obs_n_id = n_variant_id
        
        # Get N-1 observation (contingency state)
        n1_variant_id = self._get_n1_variant(disconnected_element)
        if self._cached_obs_n1 is not None and self._cached_obs_n1_id == n1_variant_id:
            obs_simu_defaut = self._cached_obs_n1
        else:
            n.set_working_variant(n1_variant_id)
            obs_simu_defaut = env.get_obs()
            self._cached_obs_n1 = obs_simu_defaut
            self._cached_obs_n1_id = n1_variant_id
        
        # FIX: Explicitly tell the observation which variant it's currently modeling
        # so that obs_simu_defaut.simulate() branches from N-1 and not the base network.
        obs_simu_defaut._variant_id = n1_variant_id
        
        # Store globally so downstream diagram functions know what to compare against
        self._last_disconnected_element = disconnected_element
        
        # Get monitoring parameters and filtering logic
        lines_we_care_about, branches_with_limits = self._get_monitoring_parameters(obs_simu_defaut)
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        worsening_threshold = getattr(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02)

        # Determine which lines are "overloaded" for rho_before/rho_after reporting.
        # Priority: 1) saved analysis context, 2) caller-provided list, 3) recompute
        name_to_idx = {l: i for i, l in enumerate(obs_simu_defaut.name_line)}

        ctx_overloaded = (self._analysis_context or {}).get("lines_overloaded")
        if ctx_overloaded:
            # Use overloaded lines from the restored analysis context
            lines_overloaded_ids = [name_to_idx[l] for l in ctx_overloaded if l in name_to_idx]
            lines_overloaded_names = [obs_simu_defaut.name_line[i] for i in lines_overloaded_ids]
        elif lines_overloaded:
            # Use caller-provided lines (e.g. from saved session without analysis context)
            lines_overloaded_ids = [name_to_idx[l] for l in lines_overloaded if l in name_to_idx]
            lines_overloaded_names = [obs_simu_defaut.name_line[i] for i in lines_overloaded_ids]
        else:
            # Vectorized overload detection
            # NOTE: Coerce to numpy arrays for consistency with legacy tests using mocks/lists
            action_names = np.atleast_1d(obs_simu_defaut.name_line)
            action_rho = np.atleast_1d(obs_simu_defaut.rho)
            base_rho = np.atleast_1d(obs.rho)
            
            # Ensure monitoring_factor/worsening_threshold are numeric for comparison (handle mocks)
            mf = float(monitoring_factor)
            wt = float(worsening_threshold)
            
            mask = np.isin(action_names, list(lines_we_care_about))
            mask &= np.isin(action_names, list(branches_with_limits))
            
            # Use try-except for comparisons to handle MagicMocks in legacy tests
            try:
                rho_mask = (action_rho >= mf)
                # Exclude pre-existing N overloads unless worsened
                pre_existing = (base_rho >= mf)
                not_worsened = (action_rho <= base_rho * (1 + wt))
                mask &= (rho_mask & ~(pre_existing & not_worsened))
            except Exception as e:
                # Fallback for mocks that don't support vectorized comparison
                print(f"Warning: Vectorized comparison failed in test context: {e}")
                mask = np.zeros(len(action_names), dtype=bool)
            
            lines_overloaded_ids = np.where(mask)[0].tolist()
            lines_overloaded_names = action_names[mask].tolist()

        # Ensure heuristic actions from recent_actions are promoted to the registry
        # so that target_mw updates can be applied to their content.
        for aid in action_ids:
            if aid not in self._dict_action and aid in recent_actions:
                a_obj = recent_actions[aid]["action"]
                # Extract topology from the Grid2Op Action object
                # (Standard Grid2Op actions carry these as attributes)
                topo = {}
                for field in ("lines_ex_bus", "lines_or_bus", "gens_bus", "loads_bus", "pst_tap", "substations", "switches", "loads_p", "gens_p"):
                    val = getattr(a_obj, field, None)
                    if val:
                        topo[field] = val # _build_action_entry_from_topology will sanitize
                
                # Build a dictionary entry with reconstructed topology
                res = self._build_action_entry_from_topology(aid, topo)
                if recent_actions[aid].get("description_unitaire"):
                    res["description_unitaire"] = recent_actions[aid]["description_unitaire"]
                if recent_actions[aid].get("description"):
                    res["description"] = recent_actions[aid]["description"]
                
                self._dict_action[aid] = res
                print(f"[simulate_manual_action] Promoted heuristic action '{aid}' to registry for target_mw update")

        # If target_mw is provided for an existing action, update its content
        # with the new setpoint before building the action object
        if target_mw is not None:
            for aid in action_ids:
                if aid in self._dict_action:
                    content = self._dict_action[aid].get("content", {})
                    # Update set_load_p entries
                    if "set_load_p" in content:
                        for load_name in content["set_load_p"]:
                            sp = _compute_setpoint(load_name, 'load', target_mw, obs_n1=obs_n1)
                            content["set_load_p"][load_name] = sp
                            print(f"[simulate_manual_action] Updated set_load_p[{load_name}] = {sp} MW")
                    # Update set_gen_p entries
                    if "set_gen_p" in content:
                        for gen_name in content["set_gen_p"]:
                            sp = _compute_setpoint(gen_name, 'gen', target_mw, obs_n1=obs_n1)
                            content["set_gen_p"][gen_name] = sp
                            print(f"[simulate_manual_action] Updated set_gen_p[{gen_name}] = {sp} MW")

        # Build the action object
        try:
            action = None
            for aid in action_ids:
                if aid in self._dict_action:
                    a_obj = env.action_space(self._dict_action[aid]["content"])
                else:
                    a_obj = recent_actions[aid]["action"]

                if action is None:
                    action = a_obj
                else:
                    action = action + a_obj
        except Exception as e:
            raise ValueError(f"Could not create action from description: {e}")

        # Simulate action starting from the N-1 converged state
        actual_fast_mode = getattr(config, 'PYPOWSYBL_FAST_MODE', False)
        obs_simu_action, _, _, info_action = obs_simu_defaut.simulate(
            action,
            time_step=0,
            keep_variant=True,
            fast_mode=actual_fast_mode
        )

        n.set_working_variant(original_variant) # Restore variant

        # Post-process results
        _t = time.perf_counter()
        if len(action_ids) == 1:
            aid = action_ids[0]
            if aid in self._dict_action:
                description_unitaire = self._dict_action[aid].get(
                    "description_unitaire", self._dict_action[aid].get("description", "No description")
                )
            else:
                description_unitaire = recent_actions[aid].get("description_unitaire", aid)
        else:
            def get_desc(aid):
                if aid in self._dict_action:
                    return self._dict_action[aid].get("description_unitaire") or self._dict_action[aid].get("description") or aid
                return recent_actions.get(aid, {}).get("description_unitaire") or recent_actions.get(aid, {}).get("description") or aid
            
            description_unitaire = "[COMBINED] " + " + ".join([str(get_desc(aid)) for aid in action_ids])
        
        # Important: Extract rho as 1D array to support indexing even if it's a mock/list
        # Return raw rho values (physical loading fraction) — monitoring_factor is only
        # a threshold, not a display scaling factor.
        rho_before = (np.atleast_1d(obs_simu_defaut.rho)[lines_overloaded_ids] * float(monitoring_factor)).tolist() if lines_overloaded_ids else []
        rho_after = None
        max_rho = 0.0
        max_rho_line = "N/A"
        is_rho_reduction = False
        is_islanded = False
        n_components_after = 1
        disconnected_mw = 0.0

        if not info_action["exception"]:
            # Check for islanding compared to N state or N-1 state
            n_components_after = obs_simu_action.n_components
            if n_components_after > obs.n_components or n_components_after > obs_simu_defaut.n_components:
                is_islanded = True
                # Compute disconnected MW
                disconnected_mw = float(max(0.0, obs_simu_defaut.main_component_load_mw - obs_simu_action.main_component_load_mw))
            
            rho_after = (np.atleast_1d(obs_simu_action.rho)[lines_overloaded_ids] * float(monitoring_factor)).tolist()
            if rho_before:
                try:
                    is_rho_reduction = bool(np.all(np.array(rho_after) + 0.01 < np.array(rho_before)))
                except Exception:
                    is_rho_reduction = False
            
            # Build care_mask for max_rho computation.
            # Always include lines_overloaded_ids — these are the lines we're
            # actively monitoring and their post-action loading must be reported.
            # Ensure action state is coerced to numpy for vectorized masking
            action_names = np.atleast_1d(obs_simu_action.name_line)
            action_rho = np.atleast_1d(obs_simu_action.rho)
            base_rho = np.atleast_1d(obs.rho)
            mf = float(monitoring_factor)
            wt = float(worsening_threshold)

            care_mask = np.isin(action_names, list(lines_we_care_about))
            limits_mask = np.isin(action_names, list(branches_with_limits))
            care_mask &= limits_mask

            # Use try-except to handle mocks in legacy tests
            try:
                # Exclude pre-existing overloads unless worsened
                pre_existing = (base_rho >= mf)
                not_worsened = (action_rho <= base_rho * (1 + wt))
                care_mask &= ~(pre_existing & not_worsened)
            except Exception as e:
                print(f"Warning: care_mask comparison failed in test context: {e}")

            # Always include lines_overloaded_ids (active monitoring)
            for idx in lines_overloaded_ids:
                if idx < len(care_mask):
                    care_mask[idx] = True
            
            # Handle potential mock failures by coercing or safe-accessing
            try:
                # Filter by care_mask if available
                monitored_rho = action_rho[care_mask] if care_mask is not None else action_rho
                monitored_names = action_names[care_mask] if care_mask is not None else action_names

                # 1. Update lines_overloaded_after: ANY MONITORED line above mf
                overload_mask = (monitored_rho >= mf)
                lines_overloaded_after = monitored_names[overload_mask].tolist()

                # 2. Update max_rho: global worst case among MONITORED lines after the action
                # Scale by monitoring_factor for operational loading display
                if len(monitored_rho) > 0:
                    max_rho = float(np.max(monitored_rho)) * mf
                    max_rho_line = monitored_names[np.argmax(monitored_rho)]
                else:
                    max_rho = 0.0
                    max_rho_line = "N/A"
            except Exception as e:
                print(f"Warning: Calculation of max_rho or overloads failed: {e}")
                max_rho = 0.0
                max_rho_line = "N/A"
                lines_overloaded_after = []
        else:
            lines_overloaded_after = []

        # Capture non-convergence reason
        sim_exception = info_action.get("exception")
        non_convergence = None
        if sim_exception:
            if isinstance(sim_exception, list):
                non_convergence = "; ".join([str(e) for e in sim_exception])
            else:
                non_convergence = str(sim_exception)

        # Store the observation so get_action_variant_diagram can generate the NAD
        # Refresh topo and content for the combined result dictionary
        topo = {}
        for field in ("lines_ex_bus", "lines_or_bus", "gens_bus", "loads_bus", "pst_tap", "substations", "switches", "loads_p", "gens_p"):
            val = getattr(action, field, None)
            if val:
                topo[field] = sanitize_for_json(val)

        # Supplement switches from the original action dictionary entry
        if not topo.get("switches") and self._dict_action:
            dict_entry = self._dict_action.get(action_id)
            if dict_entry:
                sw = dict_entry.get("switches")
                if not sw:
                    content_in_dict = dict_entry.get("content")
                    if isinstance(content_in_dict, dict):
                        sw = content_in_dict.get("switches")
                if sw:
                    topo["switches"] = sanitize_for_json(sw)

        # Manually inject topology for heuristic actions (Standard Grid2Op actions don't have these attributes as public members)
        if action_id.startswith("curtail_") and not topo.get("gens_p"):
            gen_name = action_id.replace("curtail_", "")
            reg_content = self._dict_action.get(action_id, {}).get("content", {})
            reg_gen_p = reg_content.get("set_gen_p", {})
            topo["gens_p"] = {gen_name: reg_gen_p.get(gen_name, 0.0)}
        elif action_id.startswith("load_shedding_") and not topo.get("loads_p"):
            load_name = action_id.replace("load_shedding_", "")
            reg_content = self._dict_action.get(action_id, {}).get("content", {})
            reg_load_p = reg_content.get("set_load_p", {})
            topo["loads_p"] = {load_name: reg_load_p.get(load_name, 0.0)}

        # Retrieve the full description and content from the dictionary if available
        description = description_unitaire
        content = None
        if self._dict_action:
            dict_entry = self._dict_action.get(action_id)
            if dict_entry:
                if "description" in dict_entry:
                    description = dict_entry["description"]
                if "content" in dict_entry:
                    content = dict_entry["content"]
        
        if content is None and topo:
            # Best-effort reconstruction for manual/combined actions from topology
            try:
                restored = RecommenderService._build_action_entry_from_topology(action_id, topo)
                content = restored.get("content")
            except Exception:
                content = None

        action_data = {
            "content": content,
            "observation": obs_simu_action,
            "description": description or description_unitaire or "",
            "description_unitaire": description_unitaire or "",
            "action": action,
            "action_topology": topo,
            "rho_before": rho_before,
            "rho_after": rho_after,
            "max_rho": max_rho,
            "max_rho_line": max_rho_line,
            "is_rho_reduction": is_rho_reduction,
            "is_islanded": is_islanded,
            "non_convergence": non_convergence,
            "lines_overloaded_after": sanitize_for_json(lines_overloaded_after),
            "is_estimated": False,
        }
        

        # Capture curtailment/load-shedding details for heuristic actions
        action_data["curtailment_details"] = self._compute_curtailment_details(action_data, obs_n1=obs_n1)
        action_data["load_shedding_details"] = self._compute_load_shedding_details(action_data, obs_n1=obs_n1)

        if not info_action["exception"] and obs_simu_action is not None:
            if self._last_result is None:
                self._last_result = {"prioritized_actions": {}}
            if "prioritized_actions" not in self._last_result:
                self._last_result["prioritized_actions"] = {}
            self._last_result["prioritized_actions"][action_id] = action_data

        # CRITICAL: Also update the global action registry used by the SLD generator
        if self._dict_action is None:
            self._dict_action = {}
        self._dict_action[action_id] = action_data

        # Sanitize for JSON serialization (remove raw objects and fix float values)
        serializable_data = {
            "description_unitaire": action_data.get("description_unitaire") or "No description available",
            "rho_before": sanitize_for_json(action_data.get("rho_before")),
            "rho_after": sanitize_for_json(action_data.get("rho_after")),
            "max_rho": sanitize_for_json(action_data.get("max_rho")),
            "max_rho_line": action_data.get("max_rho_line", ""),
            "is_rho_reduction": bool(action_data.get("is_rho_reduction", False)),
            "is_islanded": bool(action_data.get("is_islanded", False)),
            "non_convergence": action_data.get("non_convergence"),
            "lines_overloaded_after": sanitize_for_json(action_data.get("lines_overloaded_after", [])),
            "is_estimated": False,
            "action_topology": action_data.get("action_topology"),
            "curtailment_details": action_data.get("curtailment_details"),
            "load_shedding_details": action_data.get("load_shedding_details"),
            "content": action_data.get("content"),
        }

        return serializable_data

    def compute_superposition(self, action1_id: str, action2_id: str, disconnected_element: str):
        """Compute the combined effect of two actions using the superposition theorem.

        This computes it on-demand, which is useful for actions that weren't part of the
        initial analysis results (e.g. manually simulated actions).
        """
        if not self._last_result or "prioritized_actions" not in self._last_result:
            # If no analysis run, we might need to get observations first.
            # But usually this is called when we have some actions already simulated.
            pass

        # We need the observations for both actions.
        # If they aren't in self._last_result['prioritized_actions'], they must be in
        # the global cache of simulated actions or we need to simulate them now.
        
        all_actions = self._last_result.get("prioritized_actions", {}) if self._last_result else {}
        
        if action1_id not in all_actions or action2_id not in all_actions:
            # If not in the result, try to simulate them if we have the dictionary entries
            # (Note: this might be slow, but it's on-demand).
            # For now, let's assume they are in all_actions (user selects from simulated actions).
            if action1_id not in all_actions:
                self.simulate_manual_action(action1_id, disconnected_element)
                all_actions = self._last_result["prioritized_actions"]
            if action2_id not in all_actions:
                self.simulate_manual_action(action2_id, disconnected_element)
                all_actions = self._last_result["prioritized_actions"]

        env = self._get_simulation_env()
        classifier = ActionClassifier()
        
        # Identify elements for both actions
        # First check if they have action topology enriched
        act1_obj = all_actions[action1_id]["action"]
        act2_obj = all_actions[action2_id]["action"]

        line_idxs1, sub_idxs1 = _identify_action_elements(
            act1_obj, action1_id, self._dict_action, classifier, env
        )
        line_idxs2, sub_idxs2 = _identify_action_elements(
            act2_obj, action2_id, self._dict_action, classifier, env
        )

        if not line_idxs1 and not sub_idxs1 and not line_idxs2 and not sub_idxs2:
             # Fallback: if they are in _dict_action, maybe identify_action_elements needs it
             # but they were already identified above?
             pass

        if (not line_idxs1 and not sub_idxs1) or (not line_idxs2 and not sub_idxs2):
             return {"error": f"Cannot identify elements for one or both actions (Act1: {len(line_idxs1)} lines, {len(sub_idxs1)} subs; Act2: {len(line_idxs2)} lines, {len(sub_idxs2)} subs)"}


        # Get obs_start (N-1 state)
        n = env.network_manager.network
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)
        obs_start = env.get_obs()
        
        # Filter lines we care about
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        lines_overloaded_ids = []
        for i in range(len(obs_start.rho)):
            if obs_start.rho[i] >= monitoring_factor:
                 lines_overloaded_ids.append(i)
                 
        # Get pre-existing rho for reduction calculation
        n_variant_id = self._get_n_variant()
        n.set_working_variant(n_variant_id)
        obs_n = env.get_obs()
        # Only consider a line as "pre-existing" if it is actually an overload in the N state
        pre_existing_rho = {i: obs_n.rho[i] for i in range(len(obs_n.rho)) if obs_n.rho[i] >= monitoring_factor}
                 
        lines_we_care_about, branches_with_limits = self._get_monitoring_parameters(obs_start)

        result = compute_combined_pair_superposition(
            obs_start=obs_start,
            obs_act1=all_actions[action1_id]["observation"],
            obs_act2=all_actions[action2_id]["observation"],
            act1_line_idxs=line_idxs1,
            act1_sub_idxs=sub_idxs1,
            act2_line_idxs=line_idxs2,
            act2_sub_idxs=sub_idxs2,
            obs_combined=all_actions.get(f"{action1_id}+{action2_id}", {}).get("observation")
        )
        
        if "error" not in result:
             # Logic to compute max_rho and other details, similar to compute_all_pairs_superposition
             name_line = list(env.name_line)
             num_lines = len(name_line)
             worsening_threshold = getattr(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02)

             pre_existing_baseline = np.zeros(num_lines)
             is_pre_existing = np.zeros(num_lines, dtype=bool)
             for idx, rho_val in pre_existing_rho.items():
                 pre_existing_baseline[idx] = rho_val
                 is_pre_existing[idx] = True

             if lines_we_care_about is not None and len(lines_we_care_about) > 0:
                 care_mask = np.isin(name_line, list(lines_we_care_about))
             else:
                 care_mask = np.ones(num_lines, dtype=bool)

             # Filter out branches without explicit thermal limits in pypowsybl (consistency with simulation)
             for i, l in enumerate(name_line):
                 if care_mask[i] and l not in branches_with_limits:
                     care_mask[i] = False

             rho_combined = np.abs(
                 (1.0 - sum(result["betas"])) * obs_start.rho +
                 result["betas"][0] * all_actions[action1_id]["observation"].rho +
                 result["betas"][1] * all_actions[action2_id]["observation"].rho
             )

             # Max rho among monitored lines
             worsened_mask = rho_combined > pre_existing_baseline * (1 + worsening_threshold)
             eligible_mask = care_mask & (~is_pre_existing | worsened_mask)

             max_rho = 0.0
             max_rho_line = "N/A"
             if np.any(eligible_mask):
                 masked_rho = rho_combined[eligible_mask]
                 max_idx = np.argmax(masked_rho)
                 max_rho = float(masked_rho[max_idx])
                 max_rho_line = name_line[np.where(eligible_mask)[0][max_idx]]

             # Scale by monitoring_factor for operational loading display
             res_max_rho = max_rho * monitoring_factor
             res_rho_after = (rho_combined[lines_overloaded_ids] * monitoring_factor).tolist()
             res_rho_before = (obs_start.rho[lines_overloaded_ids] * monitoring_factor).tolist()

             # Check if it reduces loading on ALL overloaded lines
             # Use 0.01 (1%) as a robust epsilon for "reduction"
             rho_after = rho_combined[lines_overloaded_ids]
             baseline_rho = obs_start.rho[lines_overloaded_ids]
             is_rho_reduction = bool(np.all(rho_after + 0.01 < baseline_rho))

             result.update({
                 "max_rho": res_max_rho,
                 "max_rho_line": max_rho_line,
                 "is_rho_reduction": is_rho_reduction,
                 "rho_after": res_rho_after,
                 "rho_before": res_rho_before,
                 "is_estimated": True,
             })

        n.set_working_variant(original_variant)
        return sanitize_for_json(result)

recommender_service = RecommenderService()
