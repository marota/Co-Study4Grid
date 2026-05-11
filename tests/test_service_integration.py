# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# SPDX-License-Identifier: MPL-2.0
"""Tests for the side-effects of importing :mod:`expert_backend.recommenders`.

The package's ``__init__`` performs three structural patches on
:class:`RecommenderService`:

  1. attaches :class:`ModelSelectionMixin` helpers,
  2. wraps ``update_config`` and ``reset`` to capture model selection,
  3. replaces ``run_analysis_step2`` with a model-aware generator.

These tests verify the wiring without exercising the heavy analysis
pipeline.
"""
from __future__ import annotations

import pytest

# Import triggers the registry side-effects.
import expert_backend.recommenders  # noqa: F401
from expert_backend.services.recommender_service import (
    RecommenderService,
    recommender_service,
)


def test_service_class_has_model_selection_helpers():
    for attr in (
        "get_active_model_name",
        "get_compute_overflow_graph",
        "_reset_model_settings",
        "_apply_model_settings",
    ):
        assert hasattr(RecommenderService, attr), f"missing {attr!r}"


def test_update_config_is_wrapped():
    # The wrapper exposes its own qualified name so we can assert on it.
    assert RecommenderService.update_config.__name__ == "_update_config_with_model"


def test_reset_is_wrapped():
    assert RecommenderService.reset.__name__ == "_reset_with_model"


def test_run_analysis_step2_is_replaced():
    assert (
        RecommenderService.run_analysis_step2.__name__
        == "_run_analysis_step2_with_model"
    )


def test_singleton_has_default_model_state():
    # Importing the package initialises the existing singleton's state.
    assert recommender_service.get_active_model_name() == "expert"
    assert recommender_service.get_compute_overflow_graph() is True


def test_wrapped_run_analysis_step2_requires_context():
    """Without step-1 having populated the context, step-2 must error out."""
    # Touch _analysis_context to make sure it's None for this test.
    recommender_service._analysis_context = None
    gen = RecommenderService.run_analysis_step2(
        recommender_service, selected_overloads=[],
    )
    with pytest.raises(ValueError, match="Analysis context not found"):
        next(gen)


def test_wrapped_run_analysis_step2_emits_error_for_unknown_model():
    """Unknown model -> single error event then closes the stream."""
    # Fake a non-empty context so we reach the model build step.
    recommender_service._analysis_context = {
        "lines_overloaded_names": [],
        "lines_overloaded_ids": [],
        "lines_overloaded_ids_kept": [],
        "lines_we_care_about": None,
    }
    recommender_service._recommender_model_name = "__not_a_model__"
    recommender_service._compute_overflow_graph = False

    events = list(
        RecommenderService.run_analysis_step2(
            recommender_service,
            selected_overloads=[],
            all_overloads=[],
            monitor_deselected=False,
            additional_lines_to_cut=[],
        )
    )
    # Reset so other tests aren't affected.
    recommender_service._reset_model_settings()
    recommender_service._analysis_context = None

    assert len(events) == 1
    assert events[0]["type"] == "error"
    assert "__not_a_model__" in events[0]["message"]
