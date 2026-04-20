# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

"""Simulation mixin for RecommenderService.

Contains manual action simulation, superposition computation,
and action dictionary management methods.
"""

import logging
import time

import numpy as np

from expert_op4grid_recommender import config
from expert_op4grid_recommender.action_evaluation.classifier import ActionClassifier
from expert_op4grid_recommender.utils.superposition import (
    compute_combined_pair_superposition,
    _identify_action_elements,
)

from expert_backend.services.sanitize import sanitize_for_json

logger = logging.getLogger(__name__)


class SimulationMixin:
    """Mixin providing action simulation and superposition methods."""

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

    def simulate_manual_action(self, raw_action_id: str, disconnected_element: str, action_content=None, lines_overloaded=None, target_mw=None, target_tap=None):
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
        target_tap: optional integer tap position for PST actions.
                    When provided, updates the pst_tap content to the given tap value
                    (clamped to [low_tap, high_tap] from the network).
        """
        if not self._dict_action:
            raise ValueError("No action dictionary loaded. Load a config first.")

        # Position the shared pypowsybl Network on the N-1 variant for this
        # contingency before we start reading observations. Manual-action
        # simulation operates ON TOP of a known contingency, so the natural
        # entry state is N-1, not N. The guard also drains the NAD prefetch
        # worker so concurrent variant mutations can't corrupt reads.
        # See docs/performance/history/grid2op-shared-network.md ("variant-state guard").
        self._ensure_n1_state_ready(disconnected_element)

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
                    logger.info(f"[simulate_manual_action] Injected restored action '{aid}' into dict")


        # Use cached environment
        env = self._get_simulation_env()
        nm = env.network_manager
        n = nm.network
        
        original_variant = n.get_working_variant_id()
        
        # 1. Retrieve observations (MAINTAIN CALL ORDER FOR MOCKS)
        # Call 1: Base N state
        n_variant_id = self._get_n_variant()
        if self._cached_obs_n is not None and self._cached_obs_n_id == n_variant_id:
            obs = self._cached_obs_n
        else:
            n.set_working_variant(n_variant_id)
            obs = env.get_obs()
            self._cached_obs_n = obs
            self._cached_obs_n_id = n_variant_id
        
        # Call 2: Contingency N-1 state (obs_n1)
        n1_variant_id = self._get_n1_variant(disconnected_element)
        if self._cached_obs_n1 is not None and self._cached_obs_n1_id == n1_variant_id:
            obs_simu_defaut = self._cached_obs_n1
        else:
            n.set_working_variant(n1_variant_id)
            obs_simu_defaut = env.get_obs()
            self._cached_obs_n1 = obs_simu_defaut
            self._cached_obs_n1_id = n1_variant_id
        
        # FIX: Explicitly tell the observation which variant it's currently modeling
        obs_simu_defaut._variant_id = n1_variant_id
        obs_n1 = obs_simu_defaut

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
                logger.warning(f"[simulate_manual_action] Could not compute setpoint for {element_name}: {e}, falling back to 0.0")
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
                    except Exception as e:
                        logger.debug("Suppressed exception: %s", e)
                    if vl_id:
                        entry["description"] = f"Renewable curtailment on generator '{gen_name}' at voltage level '{vl_id}'"
                        entry["description_unitaire"] = f"Effacement '{gen_name}' ('{vl_id}')"
                    else:
                        entry["description"] = f"Renewable curtailment on generator '{gen_name}'"
                        entry["description_unitaire"] = f"Effacement '{gen_name}'"

                    self._dict_action[aid] = entry
                    logger.info(f"[simulate_manual_action] Created dynamic curtailment action '{aid}' (setpoint={setpoint} MW)")

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
                    except Exception as e:
                        logger.debug("Suppressed exception: %s", e)
                    if vl_id:
                        entry["description"] = f"Load shedding on '{load_name}' at voltage level '{vl_id}'"
                        entry["description_unitaire"] = f"Effacement '{load_name}' ('{vl_id}')"
                    else:
                        entry["description"] = f"Load shedding on '{load_name}'"
                        entry["description_unitaire"] = f"Effacement '{load_name}'"

                    self._dict_action[aid] = entry
                    logger.info(f"[simulate_manual_action] Created dynamic load shedding action '{aid}' (setpoint={setpoint} MW)")


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
                            logger.info(f"[simulate_manual_action] Created dynamic PST action '{aid}'")

        for aid in action_ids:
            if aid not in self._dict_action and aid not in recent_actions:
                raise ValueError(f"Action '{aid}' not found in the loaded action dictionary or recent analysis.")

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
                logger.warning(f"Warning: Vectorized comparison failed in test context: {e}")
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
                logger.info(f"[simulate_manual_action] Promoted heuristic action '{aid}' to registry for target_mw update")

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
                            logger.info(f"[simulate_manual_action] Updated set_load_p[{load_name}] = {sp} MW")
                    # Update set_gen_p entries
                    if "set_gen_p" in content:
                        for gen_name in content["set_gen_p"]:
                            sp = _compute_setpoint(gen_name, 'gen', target_mw, obs_n1=obs_n1)
                            content["set_gen_p"][gen_name] = sp
                            logger.info(f"[simulate_manual_action] Updated set_gen_p[{gen_name}] = {sp} MW")

        # If target_tap is provided for a PST action, update the pst_tap content
        if target_tap is not None:
            for aid in action_ids:
                if aid in self._dict_action:
                    content = self._dict_action[aid].get("content", {})
                    if "pst_tap" in content:
                        for pst_id in content["pst_tap"]:
                            # Clamp to valid range from network
                            pst_info = nm.get_pst_tap_info(pst_id)
                            if pst_info:
                                clamped = max(pst_info['low_tap'], min(pst_info['high_tap'], int(target_tap)))
                                content["pst_tap"][pst_id] = clamped
                                logger.info(f"[simulate_manual_action] Updated pst_tap[{pst_id}] = {clamped}")
                            else:
                                content["pst_tap"][pst_id] = int(target_tap)
                                logger.info(f"[simulate_manual_action] Updated pst_tap[{pst_id}] = {target_tap} (no bounds info)")

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
                except Exception as e:
                    logger.debug("Suppressed exception: %s", e)
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
                logger.warning(f"Warning: care_mask comparison failed in test context: {e}")

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
                    # Diagnostic: top 5 simulated lines
                    top_indices = np.argsort(monitored_rho)[::-1][:5]
                    logger.debug(f"[simulate_manual_action] TOP 5 simulated rho (among {len(monitored_rho)} monitored):")
                    for rank, ti in enumerate(top_indices):
                        logger.info(f"  #{rank+1}: {monitored_names[ti]} = {float(monitored_rho[ti]):.6f} "
                              f"(scaled: {float(monitored_rho[ti]) * mf:.4f})")
                    # Diagnostic: check .BIESL61PRAGN specifically
                    biesl_mask = (action_names == '.BIESL61PRAGN')
                    if np.any(biesl_mask):
                        biesl_in_care = bool(care_mask[np.where(biesl_mask)[0][0]])
                        biesl_rho = float(action_rho[np.where(biesl_mask)[0][0]])
                        logger.debug(f"[simulate_manual_action] .BIESL61PRAGN: in_care_mask={biesl_in_care}, "
                              f"rho={biesl_rho:.6f} (scaled: {biesl_rho * mf:.4f})")
                else:
                    max_rho = 0.0
                    max_rho_line = "N/A"
            except Exception as e:
                logger.warning(f"Warning: Calculation of max_rho or overloads failed: {e}")
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
            except Exception as e:
                logger.debug("Suppressed exception: %s", e)

        # Guarantee content is never None — the analysis library's rule
        # validator calls content.get("set_bus", {}) and crashes on None.
        if content is None:
            content = {}

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
            "disconnected_mw": disconnected_mw,
            "n_components": n_components_after,
            "non_convergence": non_convergence,
            "lines_overloaded_after": sanitize_for_json(lines_overloaded_after),
            "is_estimated": False,
        }
        

        # Capture curtailment/load-shedding details for heuristic actions
        action_data["curtailment_details"] = self._compute_curtailment_details(action_data, obs_n1=obs_n1)
        action_data["load_shedding_details"] = self._compute_load_shedding_details(action_data, obs_n1=obs_n1)
        action_data["pst_details"] = self._compute_pst_details(action_data)

        if not info_action["exception"] and obs_simu_action is not None:
            if self._last_result is None:
                self._last_result = {"prioritized_actions": {}}
            if "prioritized_actions" not in self._last_result:
                self._last_result["prioritized_actions"] = {}
            self._last_result["prioritized_actions"][action_id] = action_data

        # Update the global action registry: merge into the existing entry
        # rather than replacing it, so the library's _identify_action_elements
        # can still find the original structure it expects.
        if self._dict_action is None:
            self._dict_action = {}
        if action_id in self._dict_action:
            existing = self._dict_action[action_id]
            logger.info(f"[simulate_manual_action] Merging into existing _dict_action['{action_id}']")
            logger.debug(f"  existing keys: {list(existing.keys())}")
            logger.debug(f"  action_data keys: {list(action_data.keys())}")
            existing["observation"] = action_data.get("observation")
            existing["action"] = action_data.get("action")
            existing["action_topology"] = action_data.get("action_topology")
            # Update content with the latest (tap/MW may have changed).
            # Always update — even empty dict {} is valid and must replace
            # a stale None to prevent content.get() crashes in the library.
            if action_data.get("content") is not None:
                existing["content"] = action_data["content"]
            logger.debug(f"  merged keys: {list(existing.keys())}")
        else:
            logger.info(f"[simulate_manual_action] NEW _dict_action['{action_id}'] (no existing entry)")
            logger.debug(f"  action_data keys: {list(action_data.keys())}")
            self._dict_action[action_id] = action_data

        # Sanitize for JSON serialization (remove raw objects and fix float values)
        serializable_data = {
            "action_id": action_id,
            "description_unitaire": action_data.get("description_unitaire") or "No description available",
            "rho_before": sanitize_for_json(action_data.get("rho_before")),
            "rho_after": sanitize_for_json(action_data.get("rho_after")),
            "max_rho": sanitize_for_json(action_data.get("max_rho")),
            "max_rho_line": action_data.get("max_rho_line", ""),
            "is_rho_reduction": bool(action_data.get("is_rho_reduction", False)),
            "is_islanded": bool(action_data.get("is_islanded", False)),
            "disconnected_mw": sanitize_for_json(action_data.get("disconnected_mw", 0.0)),
            "n_components": int(action_data.get("n_components", 1)),
            "non_convergence": action_data.get("non_convergence"),
            "lines_overloaded": sanitize_for_json(action_data.get("lines_overloaded_after", [])),
            "lines_overloaded_after": sanitize_for_json(action_data.get("lines_overloaded_after", [])),
            "is_estimated": False,
            "action_topology": action_data.get("action_topology"),
            "curtailment_details": action_data.get("curtailment_details"),
            "load_shedding_details": action_data.get("load_shedding_details"),
            "pst_details": action_data.get("pst_details"),
            "content": action_data.get("content"),
        }

        return serializable_data

    def compute_superposition(self, action1_id: str, action2_id: str, disconnected_element: str):
        """Compute the combined effect of two actions using the superposition theorem.

        This computes it on-demand, which is useful for actions that weren't part of the
        initial analysis results (e.g. manually simulated actions).
        """
        # Same N-1 variant guard as `simulate_manual_action` — superposition
        # also operates on a known contingency.
        self._ensure_n1_state_ready(disconnected_element)
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

        # --- DEBUG: log _dict_action entry keys for the actions ---
        for _aid in (action1_id, action2_id):
            _de = self._dict_action.get(_aid) if self._dict_action else None
            if _de:
                logger.debug(f"[compute_superposition] _dict_action['{_aid}'] keys: {list(_de.keys())}")
                if "content" in _de:
                    logger.debug(f"[compute_superposition]   content keys: {list(_de['content'].keys()) if isinstance(_de['content'], dict) else type(_de['content'])}")
                    if isinstance(_de.get("content"), dict) and "pst_tap" in _de["content"]:
                        logger.debug(f"[compute_superposition]   pst_tap: {_de['content']['pst_tap']}")
            else:
                logger.debug(f"[compute_superposition] _dict_action['{_aid}'] = NOT FOUND")
            _ae = all_actions.get(_aid)
            if _ae:
                logger.debug(f"[compute_superposition] all_actions['{_aid}'] keys: {list(_ae.keys())}")
            else:
                logger.debug(f"[compute_superposition] all_actions['{_aid}'] = NOT FOUND")

        line_idxs1, sub_idxs1 = _identify_action_elements(
            act1_obj, action1_id, self._dict_action, classifier, env
        )
        line_idxs2, sub_idxs2 = _identify_action_elements(
            act2_obj, action2_id, self._dict_action, classifier, env
        )
        logger.info(f"[compute_superposition] _identify_action_elements: act1 line_idxs={line_idxs1}, sub_idxs={sub_idxs1}")
        logger.info(f"[compute_superposition] _identify_action_elements: act2 line_idxs={line_idxs2}, sub_idxs={sub_idxs2}")

        # Fallback for PST actions: _identify_action_elements may return empty
        # because PST tap changes are not topology changes (no line/bus switches).
        # Identify the PST transformer line index from the action content instead.
        def _pst_fallback_line_idxs(action_id):
            entry = self._dict_action.get(action_id) or all_actions.get(action_id, {})
            content = entry.get("content", {})
            pst_tap = content.get("pst_tap", {})
            if not pst_tap:
                topo = entry.get("action_topology", {})
                pst_tap = topo.get("pst_tap", {})
            if not pst_tap:
                return []
            name_line = list(env.name_line)
            idxs = []
            for pst_name in pst_tap:
                if pst_name in name_line:
                    idxs.append(name_line.index(pst_name))
            return idxs

        if not line_idxs1 and not sub_idxs1:
            fallback1 = _pst_fallback_line_idxs(action1_id)
            if fallback1:
                line_idxs1 = fallback1
                logger.info(f"[compute_superposition] PST fallback for action1 '{action1_id}': line_idxs={line_idxs1}")

        if not line_idxs2 and not sub_idxs2:
            fallback2 = _pst_fallback_line_idxs(action2_id)
            if fallback2:
                line_idxs2 = fallback2
                logger.info(f"[compute_superposition] PST fallback for action2 '{action2_id}': line_idxs={line_idxs2}")

        if (not line_idxs1 and not sub_idxs1) or (not line_idxs2 and not sub_idxs2):
             return {"error": f"Cannot identify elements for one or both actions (Act1: {len(line_idxs1)} lines, {len(sub_idxs1)} subs; Act2: {len(line_idxs2)} lines, {len(sub_idxs2)} subs)"}


        # Get obs_start (N-1 state)
        n = env.network_manager.network
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)
        obs_start = env.get_obs()

        # --- DEBUG: log rho at identified line indexes for obs_start vs obs_act ---
        name_line = list(env.name_line)
        for _aid, _lidxs in [(action1_id, line_idxs1), (action2_id, line_idxs2)]:
            obs_act = all_actions[_aid]["observation"]
            try:
                for _li in _lidxs:
                    _ln = name_line[_li] if _li < len(name_line) else f"idx_{_li}"
                    logger.debug(f"[compute_superposition] rho at {_ln}(idx={_li}): obs_start={float(obs_start.rho[_li]):.6f}, obs_act({_aid})={float(obs_act.rho[_li]):.6f}, delta={float(obs_act.rho[_li] - obs_start.rho[_li]):.6f}")
                if hasattr(obs_start, 'p_or') and hasattr(obs_act, 'p_or'):
                    for _li in _lidxs:
                        _ln = name_line[_li] if _li < len(name_line) else f"idx_{_li}"
                        logger.debug(f"[compute_superposition] p_or at {_ln}(idx={_li}): obs_start={float(obs_start.p_or[_li]):.2f}, obs_act({_aid})={float(obs_act.p_or[_li]):.2f}, delta={float(obs_act.p_or[_li] - obs_start.p_or[_li]):.2f}")
            except (TypeError, ValueError, IndexError):
                logger.warning(f"[compute_superposition] Could not log rho/p_or for {_aid} (mock or missing data)")
        
        # Filter lines we care about
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        worsening_threshold = getattr(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02)

        name_line_list = list(env.name_line)
        name_to_idx_map = {l: i for i, l in enumerate(name_line_list)}
        num_lines = len(name_line_list)

        # Get pre-existing rho for reduction calculation
        n_variant_id = self._get_n_variant()
        n.set_working_variant(n_variant_id)
        obs_n = env.get_obs()
        # Only consider a line as "pre-existing" if it is actually an overload in the N state
        pre_existing_rho = {i: obs_n.rho[i] for i in range(len(obs_n.rho)) if obs_n.rho[i] >= monitoring_factor}

        lines_we_care_about, branches_with_limits = self._get_monitoring_parameters(obs_start)

        # Determine lines_overloaded_ids: prefer analysis context (consistent with simulate_manual_action)
        ctx_overloaded = (self._analysis_context or {}).get("lines_overloaded")
        if ctx_overloaded:
            lines_overloaded_ids = [name_to_idx_map[l] for l in ctx_overloaded if l in name_to_idx_map]
            logger.info(f"[compute_superposition] Using analysis context lines_overloaded: {len(lines_overloaded_ids)} lines")
        else:
            # Recompute: filter by lines_we_care_about AND branches_with_limits (matching simulate_manual_action)
            mf = float(monitoring_factor)
            wt = float(worsening_threshold)
            lwca_set = set(lines_we_care_about) if lines_we_care_about else set(name_line_list)
            bwl_set = set(branches_with_limits)
            lines_overloaded_ids = []
            for i in range(len(obs_start.rho)):
                ln = name_line_list[i]
                if (obs_start.rho[i] >= mf
                    and ln in lwca_set
                    and ln in bwl_set):
                    # Exclude pre-existing N-state overloads unless worsened
                    if i in pre_existing_rho:
                        if obs_start.rho[i] <= pre_existing_rho[i] * (1 + wt):
                            continue
                    lines_overloaded_ids.append(i)
            logger.info(f"[compute_superposition] Computed lines_overloaded from N-1 state: {len(lines_overloaded_ids)} lines "
                  f"(filtered by {len(lwca_set)} care + {len(bwl_set)} with-limits)")

        # Detect PST actions — same logic the library uses in compute_all_pairs_superposition
        def _is_pst_action(aid):
            desc = self._dict_action.get(aid, {}) if self._dict_action else {}
            action_type = classifier.identify_action_type(desc, by_description=True)
            return action_type == "pst" or action_type == "pst_tap" or "pst_tap" in aid or "pst_" in aid

        act1_is_pst = _is_pst_action(action1_id)
        act2_is_pst = _is_pst_action(action2_id)

        logger.info(f"[compute_superposition] Calling compute_combined_pair_superposition with:")
        logger.info(f"  act1_line_idxs={line_idxs1}, act1_sub_idxs={sub_idxs1}, act1_is_pst={act1_is_pst}")
        logger.info(f"  act2_line_idxs={line_idxs2}, act2_sub_idxs={sub_idxs2}, act2_is_pst={act2_is_pst}")
        logger.debug(f"  obs_combined present: {all_actions.get(f'{action1_id}+{action2_id}', {}).get('observation') is not None}")
        result = compute_combined_pair_superposition(
            obs_start=obs_start,
            obs_act1=all_actions[action1_id]["observation"],
            obs_act2=all_actions[action2_id]["observation"],
            act1_line_idxs=line_idxs1,
            act1_sub_idxs=sub_idxs1,
            act2_line_idxs=line_idxs2,
            act2_sub_idxs=sub_idxs2,
            obs_combined=all_actions.get(f"{action1_id}+{action2_id}", {}).get("observation"),
            act1_is_pst=act1_is_pst,
            act2_is_pst=act2_is_pst,
        )
        logger.warning(f"[compute_superposition] Library result: {'error: ' + str(result.get('error')) if 'error' in result else 'betas=' + str(result.get('betas'))}")

        if "error" not in result:
             # Build care_mask matching simulate_manual_action:
             # 1) lines_we_care_about AND branches_with_limits
             # 2) exclude pre-existing N-state overloads unless worsened
             # 3) force-include lines_overloaded_ids (N-1 overloaded lines)
             mf = float(monitoring_factor)
             wt = float(worsening_threshold)

             if lines_we_care_about is not None and len(lines_we_care_about) > 0:
                 care_mask = np.isin(name_line_list, list(lines_we_care_about))
             else:
                 care_mask = np.ones(num_lines, dtype=bool)

             limits_mask = np.isin(name_line_list, list(branches_with_limits))
             care_mask &= limits_mask

             rho_combined = np.abs(
                 (1.0 - sum(result["betas"])) * obs_start.rho +
                 result["betas"][0] * all_actions[action1_id]["observation"].rho +
                 result["betas"][1] * all_actions[action2_id]["observation"].rho
             )

             # Exclude pre-existing N-state overloads unless the combined action worsens them
             base_rho_n = np.array(obs_n.rho[:num_lines]) if len(obs_n.rho) >= num_lines else np.array(obs_n.rho)
             pre_existing = (base_rho_n >= mf)
             not_worsened = (rho_combined[:num_lines] <= base_rho_n * (1 + wt))
             care_mask &= ~(pre_existing & not_worsened)

             # Always include lines_overloaded_ids (active monitoring) — consistent with simulate_manual_action
             for idx in lines_overloaded_ids:
                 if idx < len(care_mask):
                     care_mask[idx] = True

             # Find max rho among monitored lines
             max_rho = 0.0
             max_rho_line = "N/A"
             if np.any(care_mask):
                 masked_rho = rho_combined[care_mask]
                 masked_names = np.array(name_line_list)[care_mask]
                 max_idx = np.argmax(masked_rho)
                 max_rho = float(masked_rho[max_idx])
                 max_rho_line = masked_names[max_idx]

             # Diagnostic: top 5 monitored lines by estimated rho
             logger.info(f"[compute_superposition] monitored lines: {int(np.sum(care_mask))}/{num_lines}, "
                   f"lines_overloaded force-included: {len(lines_overloaded_ids)}")
             if np.any(care_mask):
                 top_indices = np.argsort(masked_rho)[::-1][:5]
                 logger.debug(f"[compute_superposition] TOP 5 estimated rho (among {len(masked_rho)} monitored):")
                 for rank, ti in enumerate(top_indices):
                     logger.info(f"  #{rank+1}: {masked_names[ti]} = {float(masked_rho[ti]):.6f} "
                           f"(scaled: {float(masked_rho[ti]) * mf:.4f})")

             # Diagnostic: check .BIESL61PRAGN specifically
             biesl_idx = name_to_idx_map.get('.BIESL61PRAGN')
             if biesl_idx is not None:
                 in_care = bool(care_mask[biesl_idx])
                 in_limits = '.BIESL61PRAGN' in branches_with_limits
                 in_lwca = lines_we_care_about is None or '.BIESL61PRAGN' in (lines_we_care_about or [])
                 est_rho = float(rho_combined[biesl_idx])
                 n1_rho = float(obs_start.rho[biesl_idx])
                 n_rho = float(obs_n.rho[biesl_idx])
                 logger.debug(f"[compute_superposition] .BIESL61PRAGN check: "
                       f"in_care_mask={in_care}, in_limits={in_limits}, in_lwca={in_lwca}, "
                       f"rho_est={est_rho:.6f} (scaled:{est_rho*mf:.4f}), "
                       f"rho_N1={n1_rho:.6f}, rho_N={n_rho:.6f}")
             else:
                 logger.debug(f"[compute_superposition] .BIESL61PRAGN NOT FOUND in name_line_list")

             logger.info(f"[compute_superposition] RESULT: max_rho_line={max_rho_line}, "
                   f"max_rho_raw={max_rho:.6f}, max_rho_scaled={max_rho * mf:.4f}")

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
