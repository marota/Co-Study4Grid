# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# SPDX-License-Identifier: MPL-2.0
"""Tests for :mod:`expert_backend.recommenders.registry`."""
from __future__ import annotations

import pytest

from expert_op4grid_recommender.models.base import (
    ParamSpec,
    RecommenderModel,
    RecommenderOutput,
)
from expert_backend.recommenders.registry import (
    DEFAULT_MODEL,
    build_recommender,
    get_model_class,
    list_models,
    register,
    unregister,
)


class _StubModel(RecommenderModel):
    name = "stub_for_registry_test"
    label = "Stub"
    requires_overflow_graph = False

    @classmethod
    def params_spec(cls):
        return [ParamSpec("k", "K", "int", default=3)]

    def recommend(self, inputs, params):
        return RecommenderOutput(prioritized_actions={})


@pytest.fixture
def stub_registered():
    register(_StubModel)
    yield
    unregister(_StubModel.name)


def test_default_model_constant():
    assert DEFAULT_MODEL == "expert"


def test_register_then_build(stub_registered):
    rec = build_recommender(_StubModel.name)
    assert isinstance(rec, _StubModel)


def test_register_returns_class_for_decorator_use(stub_registered):
    # Re-registration is idempotent and returns the class so it can be
    # used as a decorator: ``@register class Foo(...): ...``
    out = register(_StubModel)
    assert out is _StubModel


def test_register_rejects_class_without_name():
    class _BadModel(RecommenderModel):
        name = ""
        label = "Bad"

        @classmethod
        def params_spec(cls):
            return []

        def recommend(self, inputs, params):
            return RecommenderOutput(prioritized_actions={})

    with pytest.raises(ValueError, match="non-empty"):
        register(_BadModel)


def test_build_unknown_raises():
    with pytest.raises(KeyError, match="Unknown"):
        build_recommender("__does_not_exist__")


def test_build_empty_string_falls_back_to_default():
    rec = build_recommender("")
    assert rec.name == DEFAULT_MODEL


def test_build_none_falls_back_to_default():
    rec = build_recommender(None)  # type: ignore[arg-type]
    assert rec.name == DEFAULT_MODEL


def test_unregister_unknown_is_noop():
    # Must not raise — enables safe test cleanup of optionally-registered models.
    unregister("__not_a_real_model_xyz__")


def test_get_model_class_returns_none_on_miss():
    assert get_model_class("__does_not_exist__") is None


def test_get_model_class_returns_class_on_hit(stub_registered):
    assert get_model_class(_StubModel.name) is _StubModel


# ---------------------------------------------------------------------
# list_models() shape + canonical registrations
# ---------------------------------------------------------------------

def test_list_models_includes_canonical_three():
    names = {m["name"] for m in list_models()}
    assert {"expert", "random", "random_overflow"}.issubset(names)


def test_list_models_marks_expert_as_default():
    expert = next(m for m in list_models() if m["name"] == "expert")
    assert expert["is_default"] is True


def test_list_models_marks_non_default_models():
    random = next(m for m in list_models() if m["name"] == "random")
    assert random["is_default"] is False


def test_list_models_descriptor_shape():
    for descriptor in list_models():
        assert set(descriptor) >= {
            "name", "label", "requires_overflow_graph",
            "is_default", "params",
        }
        assert isinstance(descriptor["params"], list)
        for param in descriptor["params"]:
            assert {"name", "label", "kind", "default"}.issubset(param)


def test_random_model_exposes_only_n_prioritized():
    random = next(m for m in list_models() if m["name"] == "random")
    param_names = {p["name"] for p in random["params"]}
    assert param_names == {"n_prioritized_actions"}


def test_random_overflow_requires_overflow_graph():
    desc = next(m for m in list_models() if m["name"] == "random_overflow")
    assert desc["requires_overflow_graph"] is True


def test_random_does_not_require_overflow_graph():
    desc = next(m for m in list_models() if m["name"] == "random")
    assert desc["requires_overflow_graph"] is False


def test_expert_exposes_expert_specific_knobs():
    expert = next(m for m in list_models() if m["name"] == "expert")
    names = {p["name"] for p in expert["params"]}
    assert "min_line_reconnections" in names
    assert "ignore_reconnections" in names
