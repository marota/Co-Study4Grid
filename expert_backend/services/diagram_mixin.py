# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

"""Diagram generation mixin for RecommenderService.

Contains all methods related to NAD/SLD diagram generation,
flow delta computation, and overload detection.
"""

import logging
import time

import numpy as np

from expert_op4grid_recommender import config
from expert_op4grid_recommender.environment import load_interesting_lines
from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter

from expert_backend.services.sanitize import sanitize_for_json

logger = logging.getLogger(__name__)


class DiagramMixin:
    """Mixin providing diagram generation and flow analysis methods."""

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
                logger.warning(f"Warning: Could not load layout: {e}")
        return None

    def _default_nad_parameters(self):
        """Return default NadParameters for diagram generation.

        `layout_type=GEOGRAPHICAL` — we already provide fixed substation
        positions via `fixed_positions` (loaded from `grid_layout.json`).
        With the default `FORCE_LAYOUT`, pypowsybl still runs force-
        directed iterations on top of the pinned positions; GEOGRAPHICAL
        tells it to place nodes directly from the supplied coordinates
        without refinement.

        Measured on the 118 MB PyPSA-EUR France xiidm:
          - FORCE_LAYOUT + fixed_positions (previous): 3 918 ms
          - GEOGRAPHICAL + fixed_positions (now):      3 470 ms
          - Gain: ~−450 ms (~−11 %)

        SVG size unchanged (13.6 MB). Visual output identical — same
        positions are used, only the force-refinement step is skipped.
        """
        from pypowsybl.network import NadParameters, NadLayoutType
        return NadParameters(
            edge_name_displayed=False,
            id_displayed=False,
            edge_info_along_edge=True,
            power_value_precision=1,
            angle_value_precision=0,
            current_value_precision=1,
            voltage_value_precision=0,
            bus_legend=True,
            substation_description_displayed=True,
            layout_type=NadLayoutType.GEOGRAPHICAL,
        )

    def _generate_diagram(self, network, voltage_level_ids=None, depth=0):
        """Generate NAD and return svg + metadata dict."""
        from pypowsybl_jupyter.util import _get_svg_string, _get_svg_metadata
        import time

        logger.info(f"[RECO] Generating diagram (VLs={voltage_level_ids}, depth={depth})...")
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
        
        logger.info(f"[RECO] Diagram generated: NAD {t1-t0:.2f}s, SVG {t2-t1:.2f}s, Meta {t3-t2:.2f}s (SVG length={len(svg)})")

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
                logger.info(f"[RECO] NaN-stripping complete: removed {len(to_remove)} elements.")
            except Exception as e:
                logger.warning(f"Warning: Failed to strip NaN from SVG: {e}")

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
            names, rhos = self._get_overloaded_lines(
                n, lines_we_care_about=self._get_lines_we_care_about(), with_rho=True
            )
            diagram["lines_overloaded"] = names
            diagram["lines_overloaded_rho"] = rhos
            # Cache N-state element currents for N-1 comparison
            self._n_state_currents = self._get_element_max_currents(n)
            return diagram
        finally:
            n.set_working_variant(original_variant) # Restore original variant

    def get_n1_diagram(self, disconnected_element: str, voltage_level_ids=None, depth=0):
        import pypowsybl as pp
        import time

        logger.info(f"[RECO] Generating N-1 diagram for {disconnected_element} (VLs={voltage_level_ids}, depth={depth})...")
        t_start = time.time()

        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)

        try:
            # Check convergence. `_get_n1_variant` already ran the AC LF
            # when creating the variant and cached the status — reading
            # it here avoids a redundant ~600 ms re-run per diagram on
            # the PyPSA-EUR France grid (cold path) and ~1 s on the warm
            # path (repeat views of same contingency). Falls back to
            # re-running the LF if the cache is empty.
            cached_status = getattr(self, '_lf_status_by_variant', {}).get(n1_variant_id)
            if cached_status is not None:
                converged = cached_status["converged"]
                lf_status = cached_status["lf_status"]
                logger.info(f"[RECO] N-1 LF status for {disconnected_element} served from cache")
            else:
                t0 = time.time()
                params = create_olf_rte_parameter()
                results = self._run_ac_with_fallback(n, params)
                converged = any(r.status.name == 'CONVERGED' for r in results)
                lf_status = results[0].status.name if results else "UNKNOWN"
                logger.info(f"[RECO] N-1 LF check {disconnected_element}: {time.time()-t0:.2f}s")
            if not converged:
                logger.warning(f"Warning: AC load flow did not converge for N-1 ({disconnected_element}): {lf_status}")

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
                logger.warning(f"Warning: Failed to compute N-1 flow deltas: {e}")
                diagram["flow_deltas"] = {}
                diagram["reactive_flow_deltas"] = {}
                diagram["asset_deltas"] = {}

            # Exclude pre-existing overloads (already overloaded in N) unless worsened
            n_state_currents = getattr(self, '_n_state_currents', None)
            names, rhos = self._get_overloaded_lines(
                n,
                n_state_currents=n_state_currents,
                lines_we_care_about=self._get_lines_we_care_about(),
                with_rho=True,
            )
            diagram["lines_overloaded"] = names
            diagram["lines_overloaded_rho"] = rhos
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
            logger.warning(f"Warning: Failed to compute flow deltas: {e}")
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
            except Exception as e:
                logger.debug("Suppressed exception: %s", e)
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
                    logger.warning(f"Warning: Failed to compare switch states: {e}")
            result["changed_switches"] = changed_switches

            n1_network.set_working_variant(original_variant_n1)

            deltas = self._compute_deltas(action_flows, n1_flows, voltage_level_ids=[voltage_level_id])
            result["flow_deltas"] = deltas["flow_deltas"]
            result["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            result["asset_deltas"] = self._compute_asset_deltas(action_assets, n1_assets)
        except Exception as e:
            logger.warning(f"Warning: Failed to compute SLD flow deltas for manual action: {e}")
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
            logger.warning(f"Warning: Failed to compute SLD flow deltas for N-1: {e}")
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
        except Exception as e:
            logger.debug("Primary extraction failed, trying fallback: %s", e)
            try:
                svg = sld._repr_svg_()
            except Exception as e:
                logger.debug("SVG extraction fallback: %s", e)
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
                logger.warning(f"Warning: Failed to load lines_we_care_about: {e}")
        return None

    def _get_overloaded_lines(self, network, n_state_currents=None, lines_we_care_about=None, with_rho=False):
        """Get overloaded lines and transformers.

        Args:
            network: pypowsybl network after load flow.
            n_state_currents: If provided, dict {element_id: max_i_N} from the
                N-state.  Pre-existing overloads (elements also overloaded in N)
                are excluded unless their current increased by more than the
                worsening threshold.
            lines_we_care_about: If provided, set of element IDs to monitor.
                Only these elements are checked for overloads.
            with_rho: If True, also return a parallel list of rho (I/limit ratio)
                values aligned with the returned overloaded element names.

        Returns:
            list[str] of overloaded element IDs by default.
            If ``with_rho`` is True, a tuple ``(names, rhos)`` where ``rhos`` is
            a list of floats aligned with ``names``.
        """
        import numpy as np
        # Narrow the limits query — only `value` is read as a column;
        # `element_id`, `type`, `acceptable_duration` live in the
        # MultiIndex. Skips ~90 ms of unused column materialisation on
        # the 55 k-row PyPSA-EUR France limit table.
        limits = network.get_operational_limits(attributes=['value'])
        if len(limits.index) == 0:
            limit_dict = {}
        else:
            limits = limits.reset_index()
            current_limits = limits[(limits['type'] == 'CURRENT') & (limits['acceptable_duration'] == -1)]
            limit_dict = dict(zip(current_limits['element_id'], current_limits['value']))

        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        worsening_threshold = getattr(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02)

        # Narrow pypowsybl queries — only i1/i2 are used. Previously the
        # default `get_lines()[['i1','i2']]` fetched ~30 columns then
        # sliced in pandas (wasted serialisation). Combined with the
        # vectorised max-current scan below, this section drops from
        # ~1 170 ms to ~330 ms per call.
        lines = network.get_lines(attributes=['i1', 'i2'])
        trafos = network.get_2_windings_transformers(attributes=['i1', 'i2'])

        overloaded = []
        overloaded_rho = []

        for df in [lines, trafos]:
            if len(df.index) == 0:
                continue
            idx = df.index.values
            i1_arr = np.nan_to_num(df['i1'].values, nan=0.0)
            i2_arr = np.nan_to_num(df['i2'].values, nan=0.0)
            max_i_arr = np.maximum(np.abs(i1_arr), np.abs(i2_arr))

            for j, element_id in enumerate(idx):
                # Skip elements not in the monitored set
                if lines_we_care_about is not None and element_id not in lines_we_care_about:
                    continue

                limit = limit_dict.get(element_id)
                if limit is None:
                    # No permanent limit found for this branch, skip monitoring
                    continue

                max_i = max_i_arr[j]
                if max_i > limit * monitoring_factor:
                    # If N-state currents provided, filter pre-existing overloads
                    if n_state_currents is not None and element_id in n_state_currents:
                        n_max_i = n_state_currents[element_id]
                        if n_max_i > limit * monitoring_factor:
                            # Was already overloaded in N — only keep if worsened
                            if max_i <= n_max_i * (1 + worsening_threshold):
                                continue
                    overloaded.append(element_id)
                    overloaded_rho.append(float(max_i / limit) if limit else 0.0)

        if with_rho:
            return sanitize_for_json(overloaded), sanitize_for_json(overloaded_rho)
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
        """Extract p/q flows for loads and generators from a simulated network.

        Optimised: narrow pypowsybl query + numpy vectorisation. The
        previous `df.loc[lid, 'p']` inside a Python loop over 14 880
        rows was ~1.17 s per call on the PyPSA-EUR France grid. Narrow
        attrs + `nan_to_num` on the raw arrays drops this to ~75 ms
        (15× faster). `get_n1_diagram` calls this helper twice → saves
        ~2 s per N-1 diagram.
        """
        import numpy as np

        # Narrow — only p/q are read downstream. The default query
        # materialises ~20 columns per row (voltage_level_id, bus_id,
        # target_p, min_p, max_p, energy_source, ...).
        loads = network.get_loads(attributes=['p', 'q'])
        gens = network.get_generators(attributes=['p', 'q'])

        # Raw numpy arrays — NaN-safe via nan_to_num.
        loads_p = np.nan_to_num(loads['p'].values, nan=0.0)
        loads_q = np.nan_to_num(loads['q'].values, nan=0.0)
        gens_p = np.nan_to_num(gens['p'].values, nan=0.0)
        gens_q = np.nan_to_num(gens['q'].values, nan=0.0)

        load_ids = loads.index.tolist()
        gen_ids = gens.index.tolist()

        flows = {}
        for i, lid in enumerate(load_ids):
            flows[lid] = {"p": float(loads_p[i]), "q": float(loads_q[i])}
        for i, gid in enumerate(gen_ids):
            flows[gid] = {"p": float(gens_p[i]), "q": float(gens_q[i])}

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
