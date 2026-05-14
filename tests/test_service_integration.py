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

from unittest.mock import MagicMock, patch

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


# ---------------------------------------------------------------------
# Step-2 overflow-graph cache on the production (model-aware) path.
#
# The overflow graph is model-INDEPENDENT — only action discovery
# consumes the recommender — so a re-run with the same contingency +
# Step-2 inputs but a different model must REUSE the cached graph and
# skip `run_analysis_step2_graph`. The cache lived only on the legacy
# `AnalysisMixin.run_analysis_step2`, which `_service_integration`
# shadows; this guards the port into `_run_analysis_step2_with_model`.
# ---------------------------------------------------------------------
def _seed_step2_state(svc, tmp_path):
    """Put `svc` into the post-step1 state and stub the per-instance
    helpers so `_run_analysis_step2_with_model` runs end to end without
    the heavy pipeline. Returns the fake produced-HTML path."""
    svc._reset_model_settings()
    svc._last_disconnected_elements = ["LINE_C"]
    svc._analysis_context = {
        "lines_overloaded_names": ["L1"],
        "lines_overloaded_ids": [0],
        "lines_overloaded_ids_kept": [0],
        "lines_we_care_about": None,
    }
    svc._last_step2_context = None
    svc._last_step2_signature = None
    svc._overflow_layout_cache = {}
    pdf = tmp_path / "overflow.html"
    pdf.write_text("<html></html>")
    svc._narrow_context_to_selected_overloads = MagicMock(side_effect=lambda ctx, *a, **k: ctx)
    svc._get_latest_pdf_path = MagicMock(return_value=str(pdf))
    svc._enrich_actions = MagicMock(return_value={})
    svc._augment_combined_actions_with_target_max_rho = MagicMock()
    svc._compute_mw_start_for_scores = MagicMock(return_value={})
    return str(pdf)


def _graph_required_recommender(name="expert"):
    rec = MagicMock()
    rec.requires_overflow_graph = True
    rec.name = name
    return rec


_DISCOVERY_RESULT = {
    "prioritized_actions": {},
    "action_scores": {},
    "lines_overloaded_names": ["L1"],
}


def test_unchanged_signature_reuses_overflow_graph(tmp_path):
    """Re-running with an identical signature (only the model swapped)
    skips `run_analysis_step2_graph` and reuses the cached graph —
    discovery still re-runs because it's the model-dependent step."""
    svc = RecommenderService()
    expected_pdf = _seed_step2_state(svc, tmp_path)

    with patch(
        "expert_backend.recommenders._service_integration.build_recommender",
        return_value=_graph_required_recommender(),
    ), patch(
        "expert_backend.services.analysis_mixin.run_analysis_step2_graph",
        side_effect=lambda ctx: ctx,
    ) as mock_graph, patch(
        "expert_backend.services.analysis_mixin.run_analysis_step2_discovery",
        return_value=dict(_DISCOVERY_RESULT),
    ) as mock_discovery:
        kwargs = dict(
            selected_overloads=["L1"], all_overloads=["L1"],
            monitor_deselected=False, additional_lines_to_cut=["EXTRA"],
        )
        # First run — builds the graph and seeds the cache.
        events1 = list(RecommenderService.run_analysis_step2(svc, **kwargs))
        assert mock_graph.call_count == 1
        assert svc._last_step2_signature is not None
        pdf_event1 = next(e for e in events1 if e.get("type") == "pdf")
        assert pdf_event1["pdf_path"] == expected_pdf

        # Second run, identical signature — graph rebuild is skipped,
        # discovery re-runs (a model swap only affects discovery).
        events2 = list(RecommenderService.run_analysis_step2(svc, **kwargs))
        assert mock_graph.call_count == 1            # NOT rebuilt
        assert mock_discovery.call_count == 2        # discovery re-ran
        pdf_event2 = next(e for e in events2 if e.get("type") == "pdf")
        assert pdf_event2["pdf_path"] == expected_pdf
        assert pdf_event2.get("cached") is True


def test_changed_additional_lines_rebuilds_overflow_graph(tmp_path):
    """Changing the `additional_lines_to_cut` hypothesis changes the
    signature, so the overflow graph MUST be rebuilt."""
    svc = RecommenderService()
    _seed_step2_state(svc, tmp_path)

    with patch(
        "expert_backend.recommenders._service_integration.build_recommender",
        return_value=_graph_required_recommender(),
    ), patch(
        "expert_backend.services.analysis_mixin.run_analysis_step2_graph",
        side_effect=lambda ctx: ctx,
    ) as mock_graph, patch(
        "expert_backend.services.analysis_mixin.run_analysis_step2_discovery",
        return_value=dict(_DISCOVERY_RESULT),
    ):
        list(RecommenderService.run_analysis_step2(
            svc, selected_overloads=["L1"], all_overloads=["L1"],
            monitor_deselected=False, additional_lines_to_cut=["EXTRA"],
        ))
        assert mock_graph.call_count == 1

        list(RecommenderService.run_analysis_step2(
            svc, selected_overloads=["L1"], all_overloads=["L1"],
            monitor_deselected=False, additional_lines_to_cut=["OTHER"],
        ))
        assert mock_graph.call_count == 2  # rebuilt for the new signature


def test_graph_skipping_model_does_not_reuse_or_seed_cache(tmp_path):
    """A model that doesn't need the overflow graph never builds OR
    reuses it — and clears the signature so a later graph-requiring run
    can't false-hit on it."""
    svc = RecommenderService()
    _seed_step2_state(svc, tmp_path)
    # Pre-seed a stale cache to prove the no-graph path clears it.
    svc._last_step2_signature = ("stale",)
    svc._last_step2_context = {"stale": True}

    no_graph_rec = MagicMock()
    no_graph_rec.requires_overflow_graph = False
    no_graph_rec.name = "random"

    with patch(
        "expert_backend.recommenders._service_integration.build_recommender",
        return_value=no_graph_rec,
    ), patch(
        "expert_backend.services.analysis_mixin.run_analysis_step2_graph",
    ) as mock_graph, patch(
        "expert_backend.services.analysis_mixin.run_analysis_step2_discovery",
        return_value=dict(_DISCOVERY_RESULT),
    ):
        # compute_overflow_graph defaults to False after _reset_model_settings,
        # so a non-requiring model skips the graph entirely.
        svc._compute_overflow_graph = False
        events = list(RecommenderService.run_analysis_step2(
            svc, selected_overloads=["L1"], all_overloads=["L1"],
            monitor_deselected=False, additional_lines_to_cut=[],
        ))

    mock_graph.assert_not_called()
    pdf_event = next(e for e in events if e.get("type") == "pdf")
    assert pdf_event["pdf_path"] is None
    assert svc._last_step2_signature is None
    assert svc._last_step2_context is None
