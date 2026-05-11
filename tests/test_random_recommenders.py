# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# SPDX-License-Identifier: MPL-2.0
"""Tests for the canonical :class:`RandomRecommender` /
:class:`RandomOverflowRecommender` shipped with Co-Study4Grid.

The tests use ``unittest.mock`` to fake the simulation environment, so
they run without a live pypowsybl / grid2op stack.
"""
from __future__ import annotations

import random
from unittest.mock import MagicMock

import pytest

from expert_op4grid_recommender.models.base import RecommenderInputs
from expert_backend.recommenders.random_basic import RandomRecommender
from expert_backend.recommenders.random_overflow import RandomOverflowRecommender


@pytest.fixture(autouse=True)
def _seed_random():
    """Deterministic sampling across the suite."""
    random.seed(42)
    yield


def _mock_env_accepting_all():
    env = MagicMock()
    env.action_space = MagicMock(side_effect=lambda content: ("ACT", content))
    return env


def _mock_obs(load_count=2, gen_count=2):
    obs = MagicMock()
    obs.name_load = [f"load_{i}" for i in range(load_count)]
    obs.load_p = [10.0 for _ in range(load_count)]
    obs.name_gen = [f"gen_{i}" for i in range(gen_count)]
    obs.gen_p = [20.0 for _ in range(gen_count)]
    return obs


def _empty_obs():
    return MagicMock(name_load=[], load_p=[], name_gen=[], gen_p=[])


def _inputs(*, dict_action=None, filtered=None, non_connected=None,
            env=None, obs=None, obs_defaut=None):
    return RecommenderInputs(
        obs=obs if obs is not None else _mock_obs(),
        obs_defaut=obs_defaut if obs_defaut is not None else _mock_obs(),
        lines_defaut=[],
        lines_overloaded_names=[],
        lines_overloaded_ids=[],
        dict_action=dict_action or {},
        env=env if env is not None else _mock_env_accepting_all(),
        classifier=None,
        non_connected_reconnectable_lines=non_connected or [],
        filtered_candidate_actions=filtered,
    )


# =====================================================================
# RandomRecommender
# =====================================================================

class TestRandomMetadata:
    def test_name_and_flags(self):
        assert RandomRecommender.name == "random"
        assert RandomRecommender.requires_overflow_graph is False

    def test_params_spec_is_minimal(self):
        specs = RandomRecommender.params_spec()
        assert len(specs) == 1
        assert specs[0].name == "n_prioritized_actions"
        assert specs[0].kind == "int"


class TestRandomSampling:
    def test_samples_n_from_dict_action(self):
        rec = RandomRecommender()
        inputs = _inputs(
            dict_action={
                "a1": {"content": {}}, "a2": {"content": {}},
                "a3": {"content": {}}, "a4": {"content": {}},
            },
            obs_defaut=_empty_obs(),
            non_connected=[],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 2})
        assert len(out.prioritized_actions) == 2

    def test_caps_at_pool_size(self):
        rec = RandomRecommender()
        inputs = _inputs(
            dict_action={"a1": {"content": {}}},
            obs_defaut=_empty_obs(),
            non_connected=[],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 50})
        # Pool only has one entry — no crash, just returns it.
        assert len(out.prioritized_actions) == 1
        assert "a1" in out.prioritized_actions

    def test_empty_pool_returns_empty(self):
        rec = RandomRecommender()
        inputs = _inputs(
            dict_action={},
            obs_defaut=_empty_obs(),
            non_connected=[],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 5})
        assert out.prioritized_actions == {}

    def test_augments_with_reconnections(self):
        rec = RandomRecommender()
        inputs = _inputs(
            dict_action={},
            obs_defaut=_empty_obs(),
            non_connected=["LINE_X", "LINE_Y"],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 5})
        assert any(
            k.startswith("random_reco_") for k in out.prioritized_actions
        )

    def test_skips_actions_that_action_space_refuses(self):
        rec = RandomRecommender()
        env = MagicMock()

        def fake_action_space(content):
            if isinstance(content, dict) and content.get("kind") == "bad":
                raise ValueError("invalid")
            return ("ACT", content)

        env.action_space = MagicMock(side_effect=fake_action_space)
        obs = _empty_obs()
        inputs = RecommenderInputs(
            obs=obs, obs_defaut=obs,
            lines_defaut=[], lines_overloaded_names=[],
            lines_overloaded_ids=[],
            dict_action={
                "a_ok": {"content": {"kind": "ok"}},
                "a_bad": {"content": {"kind": "bad"}},
            },
            env=env, classifier=None,
            non_connected_reconnectable_lines=[],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 10})
        assert "a_bad" not in out.prioritized_actions
        assert "a_ok" in out.prioritized_actions

    def test_skips_entries_without_content(self):
        rec = RandomRecommender()
        inputs = _inputs(
            dict_action={
                "with": {"content": {"foo": 1}},
                "without": {"description": "no content"},
            },
            obs_defaut=_empty_obs(),
            non_connected=[],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 10})
        assert "without" not in out.prioritized_actions
        assert "with" in out.prioritized_actions


# =====================================================================
# RandomOverflowRecommender
# =====================================================================

class TestRandomOverflowMetadata:
    def test_name_and_flags(self):
        assert RandomOverflowRecommender.name == "random_overflow"
        assert RandomOverflowRecommender.requires_overflow_graph is True

    def test_params_spec_is_minimal(self):
        specs = RandomOverflowRecommender.params_spec()
        assert len(specs) == 1
        assert specs[0].name == "n_prioritized_actions"


class TestRandomOverflowSampling:
    def test_samples_only_from_filtered_set(self):
        rec = RandomOverflowRecommender()
        inputs = _inputs(
            dict_action={
                "a1": {"content": {}}, "a2": {"content": {}},
                "a3": {"content": {}}, "a4": {"content": {}},
            },
            filtered=["a1", "a3"],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 5})
        assert set(out.prioritized_actions) <= {"a1", "a3"}
        # a2 / a4 must NEVER appear when they're outside the filtered set.
        assert "a2" not in out.prioritized_actions
        assert "a4" not in out.prioritized_actions

    def test_falls_back_to_dict_when_filtered_is_none(self):
        rec = RandomOverflowRecommender()
        inputs = _inputs(
            dict_action={
                "a1": {"content": {}}, "a2": {"content": {}},
            },
            filtered=None,
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 5})
        assert set(out.prioritized_actions) <= {"a1", "a2"}
        assert len(out.prioritized_actions) > 0

    def test_falls_back_to_dict_when_filtered_is_empty(self):
        rec = RandomOverflowRecommender()
        inputs = _inputs(
            dict_action={"a1": {"content": {}}, "a2": {"content": {}}},
            filtered=[],  # explicitly empty
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 5})
        # Falsy candidate list triggers fallback (see implementation).
        assert len(out.prioritized_actions) > 0

    def test_empty_when_no_filtered_and_no_dict(self):
        rec = RandomOverflowRecommender()
        inputs = _inputs(dict_action={}, filtered=[])
        out = rec.recommend(inputs, params={"n_prioritized_actions": 5})
        assert out.prioritized_actions == {}

    def test_skips_unknown_action_ids_in_filtered(self):
        rec = RandomOverflowRecommender()
        inputs = _inputs(
            dict_action={"a1": {"content": {}}},
            # The filter lists an id that's NOT in dict_action — it must be skipped
            # without raising.
            filtered=["a1", "unknown_id"],
        )
        out = rec.recommend(inputs, params={"n_prioritized_actions": 5})
        assert set(out.prioritized_actions) <= {"a1"}
