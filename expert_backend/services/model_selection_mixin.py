# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Tracks the active recommendation model + overflow-graph toggle.

Kept as a tiny standalone mixin so :class:`RecommenderService` only
gains a few attributes and helper methods without rewriting its (large)
constructor. Call :meth:`_apply_model_settings` from ``update_config``
and :meth:`_reset_model_settings` from ``reset()`` so the rest of the
service can stay unaware of model selection.
"""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


class ModelSelectionMixin:
    """Pluggable-recommender state for :class:`RecommenderService`.

    Two pieces of state:

    - ``_recommender_model_name``: identifier of the registered model
      (see :mod:`expert_backend.recommenders`). Defaults to ``"expert"``
      so untouched clients keep the legacy behaviour.
    - ``_compute_overflow_graph``: toggle for the (expensive) step-2
      graph build. Only effective when the chosen model flags
      ``requires_overflow_graph=True``; otherwise the analysis pipeline
      skips the graph step regardless.
    """

    _DEFAULT_MODEL = "expert"
    _DEFAULT_COMPUTE_OVERFLOW_GRAPH = True

    def _reset_model_settings(self) -> None:
        self._recommender_model_name = self._DEFAULT_MODEL
        self._compute_overflow_graph = self._DEFAULT_COMPUTE_OVERFLOW_GRAPH

    def _apply_model_settings(self, settings: Any) -> None:
        """Read the two model-selection fields from a ConfigRequest.

        Unknown model names are NOT validated here — they're rejected
        downstream at ``build_recommender`` time so the service surfaces
        a clear error instead of silently falling back.
        """
        name = getattr(settings, "model", None)
        if isinstance(name, str) and name.strip():
            self._recommender_model_name = name.strip()
        else:
            self._recommender_model_name = self._DEFAULT_MODEL

        toggle = getattr(settings, "compute_overflow_graph", None)
        if toggle is None:
            self._compute_overflow_graph = self._DEFAULT_COMPUTE_OVERFLOW_GRAPH
        else:
            self._compute_overflow_graph = bool(toggle)

        logger.info(
            "[RecommenderService] active model=%r, compute_overflow_graph=%r",
            self._recommender_model_name, self._compute_overflow_graph,
        )

    # ------------------------------------------------------------------
    # Public getters — used by /api/config to echo the active setup back
    # to the frontend (mismatch-detection), and by analysis_mixin to
    # branch on the toggle.
    # ------------------------------------------------------------------

    def get_active_model_name(self) -> str:
        return getattr(self, "_recommender_model_name", self._DEFAULT_MODEL)

    def get_compute_overflow_graph(self) -> bool:
        return getattr(self, "_compute_overflow_graph", self._DEFAULT_COMPUTE_OVERFLOW_GRAPH)
