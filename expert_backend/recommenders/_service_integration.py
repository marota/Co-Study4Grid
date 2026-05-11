# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Glue between :class:`RecommenderService` and the recommender registry.

Kept here, away from ``recommender_service.py`` and ``analysis_mixin.py``,
so the diff stays focused on what actually changes — the rest of the
service (network loading, NAD diagrams, simulation, ...) is fully
untouched. Three concerns are handled:

1. State + getters (model name, overflow-graph toggle) attached via
   :class:`ModelSelectionMixin`.
2. ``update_config`` wrapped to capture the two new fields from
   ``ConfigRequest`` every time the operator applies settings.
3. ``run_analysis_step2`` replaced with a model-aware generator that
   builds the recommender via the registry, conditionally skips the
   overflow-graph step, and threads the recommender through to
   ``run_analysis_step2_discovery``.

Applied by ``expert_backend/recommenders/__init__.py`` as a side-effect
of importing the package.
"""
from __future__ import annotations

import logging
import time

from expert_backend.recommenders.registry import build_recommender
from expert_backend.services.model_selection_mixin import ModelSelectionMixin
from expert_backend.services.recommender_service import (
    RecommenderService,
    recommender_service,
)
from expert_backend.services.sanitize import sanitize_for_json

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------
# 1. Attach ModelSelectionMixin members to RecommenderService.
# ---------------------------------------------------------------------
for _attr in (
    "_DEFAULT_MODEL",
    "_DEFAULT_COMPUTE_OVERFLOW_GRAPH",
    "_reset_model_settings",
    "_apply_model_settings",
    "get_active_model_name",
    "get_compute_overflow_graph",
):
    setattr(RecommenderService, _attr, getattr(ModelSelectionMixin, _attr))

# Initialise the existing singleton so any code that pokes at the
# getters before /api/config is called sees the defaults.
recommender_service._reset_model_settings()


# ---------------------------------------------------------------------
# 2. Wrap update_config to capture model + toggle.
# ---------------------------------------------------------------------
_orig_update_config = RecommenderService.update_config


def _update_config_with_model(self, settings):
    # Capture model selection FIRST so any downstream logging in the
    # original method sees the resolved values.
    self._apply_model_settings(settings)
    return _orig_update_config(self, settings)


RecommenderService.update_config = _update_config_with_model


# ---------------------------------------------------------------------
# 3. Wrap reset so model state is cleared along with the rest.
# ---------------------------------------------------------------------
_orig_reset = RecommenderService.reset


def _reset_with_model(self):
    self._reset_model_settings()
    return _orig_reset(self)


RecommenderService.reset = _reset_with_model


# ---------------------------------------------------------------------
# 4. Model-aware run_analysis_step2 — conditional graph build +
#    pluggable recommender dispatch.
# ---------------------------------------------------------------------
def _run_analysis_step2_with_model(
    self,
    selected_overloads,
    all_overloads=None,
    monitor_deselected=False,
    additional_lines_to_cut=None,
):
    """Generator yielding ``pdf`` and ``result`` NDJSON events.

    Drop-in replacement for ``AnalysisMixin.run_analysis_step2``. Same
    inputs and event shape so the FastAPI route and the React frontend
    don't need to change. Differences:

    - Builds the recommender from the registry (``settings.model``).
    - Skips ``run_analysis_step2_graph`` when the chosen model does
      not require it OR the operator disabled
      ``compute_overflow_graph`` — a None ``pdf_path`` is sent in that
      case so the UI knows there is no overflow HTML to render.
    - Passes the recommender to ``run_analysis_step2_discovery`` so
      the dispatch happens at the library boundary.
    """
    # Late imports so this module stays cheap at startup and matches
    # the test-patch points used by ``analysis_mixin``.
    from expert_op4grid_recommender import config
    from expert_op4grid_recommender.main import (
        run_analysis_step2_discovery,
        run_analysis_step2_graph,
    )

    if not self._analysis_context:
        raise ValueError("Analysis context not found. Run step 1 first.")

    try:
        recommender = build_recommender(self.get_active_model_name())
    except KeyError as exc:
        yield {"type": "error", "message": str(exc)}
        return

    needs_graph = (
        recommender.requires_overflow_graph
        and self.get_compute_overflow_graph()
    )

    context = self._narrow_context_to_selected_overloads(
        self._analysis_context,
        selected_overloads,
        all_overloads,
        monitor_deselected,
        additional_lines_to_cut=additional_lines_to_cut,
    )
    analysis_start_time = time.time()
    self._overflow_layout_cache = {}
    self._overflow_layout_mode = "hierarchical"

    try:
        if needs_graph:
            context = run_analysis_step2_graph(context)
            produced_pdf = self._get_latest_pdf_path(analysis_start_time)
            if produced_pdf:
                self._overflow_layout_cache["hierarchical"] = produced_pdf
            self._last_step2_context = context
            yield {"type": "pdf", "pdf_path": produced_pdf}
        else:
            # Model does not consume the overflow graph: emit an empty
            # `pdf` event so the frontend knows it should not wait for
            # an overflow HTML to appear.
            self._last_step2_context = None
            yield {"type": "pdf", "pdf_path": None}

        params = {"n_prioritized_actions": config.N_PRIORITIZED_ACTIONS}
        results = run_analysis_step2_discovery(
            context, recommender=recommender, params=params,
        )
        self._last_result = results

        enriched_actions = self._enrich_actions(
            results["prioritized_actions"],
            lines_overloaded_names=results.get("lines_overloaded_names"),
        )
        enriched_actions = {
            aid: data for aid, data in enriched_actions.items() if "+" not in aid
        }

        # Only the expert model populates `combined_actions` with the
        # `target_max_rho` decoration; for random models the call is a
        # no-op (combined_actions is empty), so we keep it unconditional.
        self._augment_combined_actions_with_target_max_rho(results, context)
        action_scores = self._compute_mw_start_for_scores(
            results.get("action_scores", {})
        )

        logger.info(
            "[Step 2] model=%s yielding result event with %d enriched actions",
            recommender.name, len(enriched_actions),
        )
        lines_we_care_about = context.get("lines_we_care_about")
        yield sanitize_for_json({
            "type": "result",
            "actions": enriched_actions,
            "action_scores": action_scores,
            "lines_overloaded": results["lines_overloaded_names"],
            "pre_existing_overloads": results.get("pre_existing_overloads", []),
            "combined_actions": results.get("combined_actions", {}),
            "lines_we_care_about":
                list(lines_we_care_about) if lines_we_care_about is not None else None,
            "message": "Analysis completed",
            "dc_fallback": False,
            # Echo the model that produced these actions so the UI can
            # surface it (and so saved sessions know what model the
            # results came from).
            "active_model": recommender.name,
            "compute_overflow_graph": self.get_compute_overflow_graph(),
        })
    except Exception as e:
        logger.exception("Backend Error in Analysis Resolution")
        yield {
            "type": "error",
            "message": f"Backend Error in Analysis Resolution: {str(e)}",
        }


RecommenderService.run_analysis_step2 = _run_analysis_step2_with_model
