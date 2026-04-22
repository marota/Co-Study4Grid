# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

"""Diagram generation mixin for RecommenderService.

Thin orchestrator around the seven focused modules under
``services/diagram/``:

 - ``layout_cache``   — `(path, mtime)`-keyed ``grid_layout.json`` loader
 - ``nad_params``     — default ``NadParameters`` factory
 - ``nad_render``     — ``generate_diagram`` + NaN element stripping
 - ``sld_render``     — SLD SVG + metadata extraction
 - ``overloads``      — overload filtering + per-element current scans
 - ``flows``          — branch + asset flow extractors
 - ``deltas``         — terminal-aware delta math (pure)

Public method signatures are unchanged. Each method is a short
orchestrator that switches the right variant, calls the stateless
helpers, and mutates the per-service caches (``_layout_cache``,
``_n_state_currents``, ``_lf_status_by_variant``).
"""

import logging
import time

from expert_op4grid_recommender import config
from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter

from expert_backend.services.diagram.deltas import (
    apply_threshold,
    compute_asset_deltas,
    compute_deltas,
    select_terminal_for_branch,
    terminal_aware_delta,
)
from expert_backend.services.diagram.flows import (
    get_asset_flows,
    get_network_flows,
)
from expert_backend.services.diagram.layout_cache import load_layout
from expert_backend.services.diagram.nad_params import default_nad_parameters
from expert_backend.services.diagram.nad_render import generate_diagram
from expert_backend.services.diagram.overloads import (
    get_element_max_currents,
    get_overloaded_lines,
)
from expert_backend.services.diagram.sld_render import extract_sld_svg_and_metadata

logger = logging.getLogger(__name__)


class DiagramMixin:
    """Mixin providing diagram generation and flow analysis methods."""

    # ------------------------------------------------------------------
    # Layout / NAD parameter helpers — thin wrappers around the stateless
    # helpers. Kept as methods so existing tests that patch them on the
    # service instance keep working.
    # ------------------------------------------------------------------

    def _load_layout(self):
        """Load layout DataFrame from ``grid_layout.json``, cached by ``(path, mtime)``."""
        layout_file = getattr(config, "LAYOUT_FILE_PATH", None)
        return load_layout(
            layout_file,
            get_cache=lambda: getattr(self, "_layout_cache", None),
            set_cache=lambda value: setattr(self, "_layout_cache", value),
        )

    def _default_nad_parameters(self):
        """Return default ``NadParameters`` for diagram generation."""
        return default_nad_parameters()

    def _generate_diagram(self, network, voltage_level_ids=None, depth=0):
        """Generate NAD and return svg + metadata dict."""
        return generate_diagram(
            network,
            df_layout=self._load_layout(),
            nad_parameters=self._default_nad_parameters(),
            voltage_level_ids=voltage_level_ids,
            depth=depth,
        )

    # ------------------------------------------------------------------
    # Flow / overload helpers — stateless wrappers for legacy tests.
    # ------------------------------------------------------------------

    def _get_element_max_currents(self, network):
        return get_element_max_currents(network)

    def _get_overloaded_lines(
        self, network, n_state_currents=None, lines_we_care_about=None, with_rho=False
    ):
        return get_overloaded_lines(
            network,
            n_state_currents=n_state_currents,
            lines_we_care_about=lines_we_care_about,
            with_rho=with_rho,
            monitoring_factor=getattr(config, "MONITORING_FACTOR_THERMAL_LIMITS", 0.95),
            worsening_threshold=getattr(config, "PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD", 0.02),
        )

    def _get_network_flows(self, network):
        return get_network_flows(network)

    def _get_asset_flows(self, network):
        return get_asset_flows(network)

    def _get_n1_flows(self, contingency: str) -> dict:
        """Branch flows of the network in the N-1 state using a cached variant."""
        n = self._get_base_network()
        var_id = self._get_n1_variant(contingency)
        original_variant = n.get_working_variant_id()

        n.set_working_variant(var_id)
        flows = get_network_flows(n)
        n.set_working_variant(original_variant)
        return flows

    # ------------------------------------------------------------------
    # Delta helpers — thin wrappers so existing tests that reference
    # them directly on the mixin keep working. The heavy math lives in
    # :mod:`diagram.deltas`.
    # ------------------------------------------------------------------

    @staticmethod
    def _terminal_aware_delta(after_val, before_val):
        return terminal_aware_delta(after_val, before_val)

    @staticmethod
    def _select_terminal_for_branch(lid, avl1, avl2, bvl1, bvl2, vl_set):
        return select_terminal_for_branch(lid, avl1, avl2, bvl1, bvl2, vl_set)

    @staticmethod
    def _apply_threshold(deltas):
        return apply_threshold(deltas)

    def _compute_deltas(self, after_flows, before_flows, voltage_level_ids=None):
        return compute_deltas(after_flows, before_flows, voltage_level_ids)

    def _compute_asset_deltas(self, after_asset_flows, before_asset_flows):
        return compute_asset_deltas(after_asset_flows, before_asset_flows)

    def _get_lines_we_care_about(self):
        """Return the set of monitored line IDs, or ``None`` when all lines are monitored."""
        if not getattr(config, "IGNORE_LINES_MONITORING", True) and getattr(config, "LINES_MONITORING_FILE", None):
            try:
                from expert_op4grid_recommender.data_loader import load_interesting_lines
                return set(load_interesting_lines(file_name=config.LINES_MONITORING_FILE))
            except Exception as e:
                logger.warning("Warning: Failed to load lines_we_care_about: %s", e)
        return None

    @staticmethod
    def _extract_sld_svg_and_metadata(sld):
        return extract_sld_svg_and_metadata(sld)

    # ------------------------------------------------------------------
    # Public NAD endpoints
    # ------------------------------------------------------------------

    def get_network_diagram(self, voltage_level_ids=None, depth=0):
        """Base-state (N) NAD."""
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
            n.set_working_variant(original_variant)

    def get_n1_diagram(self, disconnected_element: str, voltage_level_ids=None, depth=0):
        """Post-contingency (N-1) NAD with flow deltas vs N."""
        logger.info(
            "[RECO] Generating N-1 diagram for %s (VLs=%s, depth=%d)...",
            disconnected_element, voltage_level_ids, depth,
        )

        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)

        try:
            converged, lf_status = self._lf_status_for_variant(n, n1_variant_id, disconnected_element)
            if not converged:
                logger.warning(
                    "Warning: AC load flow did not converge for N-1 (%s): %s",
                    disconnected_element, lf_status,
                )

            diagram = self._generate_diagram(n, voltage_level_ids=voltage_level_ids, depth=depth)
            diagram["lf_converged"] = converged
            diagram["lf_status"] = lf_status

            self._attach_flow_deltas_vs_base(diagram, n, voltage_level_ids=None)

            # Exclude pre-existing overloads (already overloaded in N) unless worsened.
            names, rhos = self._get_overloaded_lines(
                n,
                n_state_currents=getattr(self, "_n_state_currents", None),
                lines_we_care_about=self._get_lines_we_care_about(),
                with_rho=True,
            )
            diagram["lines_overloaded"] = names
            diagram["lines_overloaded_rho"] = rhos
            return diagram
        finally:
            n.set_working_variant(original_variant)

    def get_action_variant_diagram(self, action_id, voltage_level_ids=None, depth=0, mode="network"):
        """Generate a NAD showing the network state after applying a remedial action.

        Uses the variant ID and network manager stored in the observation
        from the last analysis run to switch to the post-action network
        state directly, avoiding the need to replay disconnections on a
        fresh network.
        """
        actions = self._require_action(action_id)
        obs = actions[action_id]["observation"]
        nm = obs._network_manager
        nm.set_working_variant(obs._variant_id)

        network = nm.network
        diagram = self._generate_diagram(network, voltage_level_ids=voltage_level_ids, depth=depth)
        diagram["action_id"] = action_id
        self._attach_convergence_from_obs(diagram, obs)

        # Always include flow deltas so mode switching is instant on the frontend.
        try:
            action_flows = get_network_flows(network)
            action_assets = get_asset_flows(network)
            n1_flows, n1_assets = self._snapshot_n1_state(self._last_disconnected_element)
            deltas = compute_deltas(action_flows, n1_flows, voltage_level_ids=voltage_level_ids)
            diagram["flow_deltas"] = deltas["flow_deltas"]
            diagram["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            diagram["asset_deltas"] = compute_asset_deltas(action_assets, n1_assets)
        except Exception as e:
            logger.warning("Warning: Failed to compute flow deltas: %s", e)
            diagram["flow_deltas"] = {}
            diagram["reactive_flow_deltas"] = {}
            diagram["asset_deltas"] = {}

        return diagram

    # ------------------------------------------------------------------
    # Public SLD endpoints
    # ------------------------------------------------------------------

    def get_n_sld(self, voltage_level_id: str) -> dict:
        """Single Line Diagram in the base N state."""
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n.set_working_variant(self._get_n_variant())
        try:
            sld = n.get_single_line_diagram(voltage_level_id)
            svg, sld_metadata = extract_sld_svg_and_metadata(sld)
        finally:
            n.set_working_variant(original_variant)
        return {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "voltage_level_id": voltage_level_id,
        }

    def get_n1_sld(self, disconnected_element: str, voltage_level_id: str) -> dict:
        """Single Line Diagram in the N-1 state."""
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n.set_working_variant(self._get_n1_variant(disconnected_element))

        try:
            sld = n.get_single_line_diagram(voltage_level_id)
            svg, sld_metadata = extract_sld_svg_and_metadata(sld)
            result = {
                "svg": svg,
                "sld_metadata": sld_metadata,
                "voltage_level_id": voltage_level_id,
                "disconnected_element": disconnected_element,
            }
            self._attach_flow_deltas_vs_base(result, n, voltage_level_ids=[voltage_level_id])
            return result
        finally:
            n.set_working_variant(original_variant)

    def get_action_variant_sld(self, action_id: str, voltage_level_id: str) -> dict:
        """Single Line Diagram in the post-action state, with flow deltas vs N-1."""
        actions = self._require_action(action_id)
        obs = actions[action_id]["observation"]
        nm = obs._network_manager
        nm.set_working_variant(obs._variant_id)
        network = nm.network
        sld = network.get_single_line_diagram(voltage_level_id)
        svg, sld_metadata = extract_sld_svg_and_metadata(sld)

        result = {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "action_id": action_id,
            "voltage_level_id": voltage_level_id,
        }
        self._attach_convergence_from_obs(result, obs)

        # Capture the switch-state diff BEFORE attempting flow deltas —
        # if flow extraction fails on a mock/malformed network, we still
        # want `changed_switches` populated on the response.
        try:
            action_switches_df = network.get_switches()
        except Exception as e:
            logger.debug("Suppressed exception: %s", e)
            action_switches_df = None

        n1_network = self._get_base_network()
        original_variant_n1 = n1_network.get_working_variant_id()
        n1_network.set_working_variant(self._get_n1_variant(self._last_disconnected_element))
        try:
            result["changed_switches"] = self._diff_switches(action_switches_df, n1_network)
        except Exception as e:
            logger.warning("Warning: Failed to diff switches: %s", e)
            result["changed_switches"] = {}

        try:
            action_flows = get_network_flows(network)
            action_assets = get_asset_flows(network)
            n1_flows = self._get_n1_flows(self._last_disconnected_element)
            n1_assets = get_asset_flows(n1_network)

            deltas = compute_deltas(action_flows, n1_flows, voltage_level_ids=[voltage_level_id])
            result["flow_deltas"] = deltas["flow_deltas"]
            result["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            result["asset_deltas"] = compute_asset_deltas(action_assets, n1_assets)
        except Exception as e:
            logger.warning("Warning: Failed to compute SLD flow deltas for manual action: %s", e)
            result["flow_deltas"] = {}
            result["reactive_flow_deltas"] = {}
            result["asset_deltas"] = {}
        finally:
            n1_network.set_working_variant(original_variant_n1)

        return result

    # ------------------------------------------------------------------
    # Private orchestrator helpers
    # ------------------------------------------------------------------

    def _require_action(self, action_id: str) -> dict:
        """Return the prioritized actions dict, or raise if the action is missing."""
        if not self._last_result or not self._last_result.get("prioritized_actions"):
            raise ValueError("No analysis result available. Run analysis first.")
        actions = self._last_result["prioritized_actions"]
        if action_id not in actions:
            raise ValueError(f"Action '{action_id}' not found in last analysis result.")
        return actions

    def _lf_status_for_variant(self, network, variant_id: str, disconnected_element: str):
        """Return ``(converged, lf_status)`` for ``variant_id``.

        Prefers the cached status from ``_get_n1_variant`` (populated
        when the variant was first created) — avoids a ~600 ms-1 s
        re-run of the AC LF per diagram on large grids.
        """
        cached = getattr(self, "_lf_status_by_variant", {}).get(variant_id)
        if cached is not None:
            logger.info("[RECO] N-1 LF status for %s served from cache", disconnected_element)
            return cached["converged"], cached["lf_status"]

        t0 = time.time()
        params = create_olf_rte_parameter()
        results = self._run_ac_with_fallback(network, params)
        converged = any(r.status.name == "CONVERGED" for r in results)
        lf_status = results[0].status.name if results else "UNKNOWN"
        logger.info("[RECO] N-1 LF check %s: %.2fs", disconnected_element, time.time() - t0)
        return converged, lf_status

    def _snapshot_n1_state(self, disconnected_element: str) -> tuple[dict, dict]:
        """Fetch ``(branch_flows, asset_flows)`` in the N-1 state.

        Positions the base network on the contingency variant, reads
        both snapshots, restores the original variant. Used by the
        action-variant diagram to produce deltas against N-1.
        """
        n1_flows = self._get_n1_flows(disconnected_element)
        n1_network = self._get_base_network()
        original_variant = n1_network.get_working_variant_id()
        n1_network.set_working_variant(self._get_n1_variant(disconnected_element))
        try:
            n1_assets = get_asset_flows(n1_network)
        finally:
            n1_network.set_working_variant(original_variant)
        return n1_flows, n1_assets

    def _attach_flow_deltas_vs_base(self, diagram: dict, n_contingency_network, voltage_level_ids):
        """Populate ``flow_deltas`` / ``reactive_flow_deltas`` / ``asset_deltas`` on ``diagram``.

        ``n_contingency_network`` MUST already be positioned on the
        contingency variant. The function snapshots the flows, then
        positions the base network on N, takes another snapshot, and
        restores the original variant.
        """
        try:
            # IMPORTANT: flows must be read while the contingency variant
            # is still active on the caller's network object.
            n1_flows = get_network_flows(n_contingency_network)
            n1_assets = get_asset_flows(n_contingency_network)

            n_base = self._get_base_network()
            original_variant_base = n_base.get_working_variant_id()
            n_base.set_working_variant(self._get_n_variant())
            base_flows = get_network_flows(n_base)
            base_assets = get_asset_flows(n_base)

            deltas = compute_deltas(n1_flows, base_flows, voltage_level_ids=voltage_level_ids)
            diagram["flow_deltas"] = deltas["flow_deltas"]
            diagram["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            diagram["asset_deltas"] = compute_asset_deltas(n1_assets, base_assets)
            n_base.set_working_variant(original_variant_base)
        except Exception as e:
            logger.warning("Warning: Failed to compute flow deltas: %s", e)
            diagram["flow_deltas"] = {}
            diagram["reactive_flow_deltas"] = {}
            diagram["asset_deltas"] = {}

    @staticmethod
    def _attach_convergence_from_obs(diagram: dict, obs) -> None:
        """Copy ``lf_converged`` / ``lf_status`` / ``non_convergence`` from an observation."""
        info_action = getattr(obs, "_last_info", {}) or {}
        sim_exception = info_action.get("exception")
        diagram["lf_converged"] = not bool(sim_exception)
        if sim_exception:
            if isinstance(sim_exception, list):
                non_convergence = "; ".join(str(e) for e in sim_exception)
            else:
                non_convergence = str(sim_exception)
        else:
            non_convergence = None
        diagram["lf_status"] = non_convergence if non_convergence else "CONVERGED"
        diagram["non_convergence"] = non_convergence

    @staticmethod
    def _diff_switches(action_switches_df, n1_network) -> dict:
        """Return ``{switch_id: {from_open, to_open}}`` for each switch whose state changed."""
        if action_switches_df is None:
            return {}
        changed: dict[str, dict] = {}
        try:
            n1_switches_df = n1_network.get_switches()
            for sw_id in action_switches_df.index:
                if sw_id in n1_switches_df.index:
                    a_open = bool(action_switches_df.loc[sw_id, "open"])
                    n1_open = bool(n1_switches_df.loc[sw_id, "open"])
                    if a_open != n1_open:
                        changed[sw_id] = {"from_open": n1_open, "to_open": a_open}
        except Exception as e:
            logger.warning("Warning: Failed to compare switch states: %s", e)
        return changed
