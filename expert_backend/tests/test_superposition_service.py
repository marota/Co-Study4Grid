# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import pytest
import numpy as np
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config


@pytest.fixture
def recommender():
    svc = RecommenderService()
    svc._dict_action = {}
    svc._last_result = {"prioritized_actions": {}}
    return svc


def _make_obs(rho_vals, p_or_vals=None):
    """Create a mock observation with proper numpy arrays."""
    obs = MagicMock()
    obs.rho = np.array(rho_vals)
    if p_or_vals is not None:
        obs.p_or = np.array(p_or_vals)
    else:
        del obs.p_or  # Remove the auto-created MagicMock attribute
    return obs


def _setup_superposition_env(recommender, actions_dict, dict_action, name_line=None):
    """Common setup for superposition tests: mock env, variants, observations."""
    if name_line is None:
        name_line = ["LINE1"]

    recommender._last_result["prioritized_actions"] = actions_dict
    recommender._dict_action = dict_action
    recommender._get_simulation_env = MagicMock()
    recommender._get_n_variant = MagicMock(return_value="N")
    recommender._get_n1_variant = MagicMock(return_value="N-1")

    env = recommender._get_simulation_env.return_value
    env.name_line = name_line

    n_lines = len(name_line)
    obs_n1 = _make_obs([1.1] * n_lines, [100.0] * n_lines)
    obs_n = _make_obs([0.8] * n_lines, [80.0] * n_lines)
    env.get_obs.side_effect = [obs_n1, obs_n]
    env.network_manager.network.get_working_variant_id.return_value = "ORIG"

    # Ensure config attributes used in compute_superposition are real numbers
    config.MONITORING_FACTOR_THERMAL_LIMITS = 0.95
    config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD = 0.02

    return env


def test_compute_superposition_on_demand(recommender):
    """Verify on-demand superposition returns betas and max_rho."""
    aid1, aid2 = "act1", "act2"
    obs1 = _make_obs([0.9], [90.0])
    obs2 = _make_obs([0.9], [85.0])
    actions = {
        aid1: {"action": MagicMock(), "observation": obs1},
        aid2: {"action": MagicMock(), "observation": obs2},
    }
    _setup_superposition_env(recommender, actions, {})

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {
            "betas": [0.5, 0.5],
            "p_or_combined": [100.0]
        }

        result = recommender.compute_superposition(aid1, aid2, "contingency")

        assert "betas" in result
        assert result["max_rho"] is not None
        assert result["is_estimated"] is True


def test_compute_superposition_triggers_simulation(recommender):
    """When one action is missing from results, simulate_manual_action is called."""
    aid1, aid2 = "act1", "act2"
    obs1 = _make_obs([0.9], [90.0])
    actions = {
        aid1: {"action": MagicMock(), "observation": obs1},
    }
    da = {aid2: {"content": "content2", "description_unitaire": "Desc 2"}}

    def mock_simulate(aid, cont):
        recommender._last_result["prioritized_actions"][aid] = {
            "action": MagicMock(),
            "observation": _make_obs([0.9], [85.0]),
        }

    recommender.simulate_manual_action = MagicMock(side_effect=mock_simulate)
    _setup_superposition_env(recommender, actions, da)

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {"betas": [0.5, 0.5]}
        result = recommender.compute_superposition(aid1, aid2, "contingency")

        recommender.simulate_manual_action.assert_called_with(aid2, "contingency")
        assert "betas" in result


def test_compute_superposition_passes_pst_flag_for_pst_action(recommender):
    """When one action is a PST tap action, act1_is_pst must be True so the
    library uses flow-based no-op detection instead of line-status comparison."""
    pst_id = "pst_tap_.ARKA_TD_661_inc2"
    other_id = "reco_LINE_A"

    obs_pst = _make_obs([0.9], [95.0])
    obs_other = _make_obs([0.85], [90.0])
    actions = {
        pst_id: {"action": MagicMock(), "observation": obs_pst},
        other_id: {"action": MagicMock(), "observation": obs_other},
    }
    da = {
        pst_id: {"content": {"pst_tap": {".ARKA TD 661": 32}}, "description_unitaire": "Variation de slot"},
        other_id: {"content": {"set_bus": {"lines_or_bus": {"LINE_A": 2}}}, "description_unitaire": "Reconnect LINE_A"},
    }
    _setup_superposition_env(recommender, actions, da)

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {"betas": [0.6, 0.4]}
        recommender.compute_superposition(pst_id, other_id, "contingency")

        call_kwargs = mock_combine.call_args
        assert call_kwargs.kwargs.get("act1_is_pst") is True, "act1_is_pst should be True for PST action"
        assert call_kwargs.kwargs.get("act2_is_pst") is False, "act2_is_pst should be False for non-PST action"


def test_compute_superposition_pst_flag_true_when_pst_is_second(recommender):
    """When PST action is the second argument, act2_is_pst should be True."""
    other_id = "reco_LINE_A"
    pst_id = "pst_tap_.ARKA_TD_661_inc2"

    obs_other = _make_obs([0.85], [90.0])
    obs_pst = _make_obs([0.9], [95.0])
    actions = {
        other_id: {"action": MagicMock(), "observation": obs_other},
        pst_id: {"action": MagicMock(), "observation": obs_pst},
    }
    da = {
        other_id: {"content": {"set_bus": {"lines_or_bus": {"LINE_A": 2}}}, "description_unitaire": "Reconnect"},
        pst_id: {"content": {"pst_tap": {".ARKA TD 661": 32}}, "description_unitaire": "Variation de slot"},
    }
    _setup_superposition_env(recommender, actions, da)

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {"betas": [0.5, 0.5]}
        recommender.compute_superposition(other_id, pst_id, "contingency")

        call_kwargs = mock_combine.call_args
        assert call_kwargs.kwargs.get("act1_is_pst") is False, "act1_is_pst should be False for non-PST action"
        assert call_kwargs.kwargs.get("act2_is_pst") is True, "act2_is_pst should be True for PST action"


def test_compute_superposition_pst_flag_false_for_non_pst(recommender):
    """Non-PST actions should have act_is_pst=False."""
    aid1, aid2 = "reco_LINE_A", "reco_LINE_B"

    obs1 = _make_obs([0.9], [90.0])
    obs2 = _make_obs([0.85], [85.0])
    actions = {
        aid1: {"action": MagicMock(), "observation": obs1},
        aid2: {"action": MagicMock(), "observation": obs2},
    }
    da = {
        aid1: {"content": {"set_bus": {"lines_or_bus": {"LINE_A": 2}}}, "description_unitaire": "Reconnect"},
        aid2: {"content": {"set_bus": {"lines_or_bus": {"LINE_B": 2}}}, "description_unitaire": "Reconnect"},
    }
    _setup_superposition_env(recommender, actions, da)

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {"betas": [0.5, 0.5]}
        recommender.compute_superposition(aid1, aid2, "contingency")

        call_kwargs = mock_combine.call_args
        assert call_kwargs.kwargs.get("act1_is_pst") is False
        assert call_kwargs.kwargs.get("act2_is_pst") is False


def test_pst_fallback_line_idxs_used_when_identify_returns_empty(recommender):
    """When _identify_action_elements returns empty for a PST action, the
    fallback should find the line index from the pst_tap content."""
    pst_id = "pst_tap_.ARKA_TD_661_inc2"
    other_id = "reco_LINE_B"

    obs_pst = _make_obs([0.9], [95.0])
    obs_other = _make_obs([0.85], [90.0])
    actions = {
        pst_id: {"action": MagicMock(), "observation": obs_pst},
        other_id: {"action": MagicMock(), "observation": obs_other},
    }
    da = {
        pst_id: {"content": {"pst_tap": {".ARKA TD 661": 32}}, "description_unitaire": "Variation de slot"},
        other_id: {"content": {"set_bus": {"lines_or_bus": {"LINE_B": 2}}}, "description_unitaire": "Reconnect"},
    }
    _setup_superposition_env(recommender, actions, da, name_line=[".ARKA TD 661", "LINE_B"])

    # _identify_action_elements returns empty for PST, non-empty for other
    def side_effect(act_obj, aid, dict_action, classifier, env):
        if aid == pst_id:
            return ([], [])  # PST actions often return empty
        return ([1], [])  # LINE_B at index 1

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', side_effect=side_effect), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:

        mock_combine.return_value = {"betas": [0.6, 0.4]}
        recommender.compute_superposition(pst_id, other_id, "contingency")

        call_kwargs = mock_combine.call_args
        # Fallback should have found index 0 (.ARKA TD 661) for the PST action
        assert call_kwargs.kwargs.get("act1_line_idxs") == [0]
        assert call_kwargs.kwargs.get("act1_is_pst") is True


def test_dict_action_merge_preserves_original_keys(recommender):
    """After re-simulation, _dict_action entry must retain original keys
    from the library while updating observation/action/content."""

    original_entry = {
        "content": {"pst_tap": {".ARKA TD 661": 29}},
        "description": "PST action",
        "description_unitaire": "Variation de slot .ARKA TD 661 to 29",
        "observation": MagicMock(),
        "action": MagicMock(),
        "action_topology": {"pst_tap": {".ARKA TD 661": 29}},
        # Library-specific keys that must survive re-simulation
        "library_extra_field": "some_value",
        "action_type_info": {"type": "pst_tap"},
    }

    svc = RecommenderService()
    svc._dict_action = {"pst_action_1": dict(original_entry)}

    # Simulate the merge that happens after re-simulation
    new_data = {
        "content": {"pst_tap": {".ARKA TD 661": 32}},
        "observation": MagicMock(),
        "action": MagicMock(),
        "action_topology": {"pst_tap": {".ARKA TD 661": 32}},
    }

    existing = svc._dict_action["pst_action_1"]
    existing["observation"] = new_data["observation"]
    existing["action"] = new_data["action"]
    existing["action_topology"] = new_data["action_topology"]
    if new_data.get("content"):
        existing["content"] = new_data["content"]

    result = svc._dict_action["pst_action_1"]

    # Original library keys must still be present
    assert result["library_extra_field"] == "some_value"
    assert result["action_type_info"] == {"type": "pst_tap"}
    # Updated keys should reflect the new values
    assert result["content"]["pst_tap"][".ARKA TD 661"] == 32
    assert result["observation"] is new_data["observation"]
    assert result["action"] is new_data["action"]


def test_compute_superposition_reuses_context_obs_simu_defaut(recommender):
    """Regression: on-demand `compute_superposition` must use the N-1
    observation captured by step1 (stored on `_analysis_context`) as
    `obs_start` rather than fetching a fresh `env.get_obs()`.

    Background: step2's `run_analysis_step2_discovery` pre-computes betas
    using `context["obs_simu_defaut"]`. Grid2Op's
    `obs.simulate(action, keep_variant=True)` (used by
    `simulate_manual_action`) can mutate the shared N-1 variant, so a
    fresh fetch here would see a drifted baseline and produce betas
    that diverge from the "Computed Pairs" view for the same pair.
    Reusing the context obs keeps the two paths numerically consistent.
    """
    aid1, aid2 = "act1", "act2"
    obs1 = _make_obs([0.9], [90.0])
    obs2 = _make_obs([0.9], [85.0])
    actions = {
        aid1: {"action": MagicMock(), "observation": obs1},
        aid2: {"action": MagicMock(), "observation": obs2},
    }
    _setup_superposition_env(recommender, actions, {})

    # Simulate what step1 leaves behind: a context carrying the original
    # N-1 observation. A later fresh `env.get_obs()` would return a
    # drifted observation (different rho values) — the reuse must pick
    # the context obs, not the drifted fresh fetch.
    ctx_obs = _make_obs([1.5], [150.0])
    recommender._analysis_context = {"obs_simu_defaut": ctx_obs}

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:
        mock_combine.return_value = {"betas": [0.5, 0.5], "p_or_combined": [100.0]}

        recommender.compute_superposition(aid1, aid2, "contingency")

        obs_start_passed = mock_combine.call_args.kwargs["obs_start"]
        assert obs_start_passed is ctx_obs, (
            "compute_superposition should pass the context's obs_simu_defaut as "
            "obs_start so betas match the step2 pre-computed values"
        )


def test_compute_superposition_falls_back_to_fresh_fetch_without_context(recommender):
    """When no analysis context exists (first-time pair estimation with
    no prior step1), `compute_superposition` must still work by fetching
    `obs_start` from `env.get_obs()`. This test pins the fallback so the
    new context-preferred path does not silently break the no-context
    case.
    """
    aid1, aid2 = "act1", "act2"
    obs1 = _make_obs([0.9], [90.0])
    obs2 = _make_obs([0.9], [85.0])
    actions = {
        aid1: {"action": MagicMock(), "observation": obs1},
        aid2: {"action": MagicMock(), "observation": obs2},
    }
    env = _setup_superposition_env(recommender, actions, {})
    recommender._analysis_context = None

    with patch('expert_backend.services.simulation_mixin._identify_action_elements', return_value=([0], [])), \
         patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_combine:
        mock_combine.return_value = {"betas": [0.5, 0.5], "p_or_combined": [100.0]}

        recommender.compute_superposition(aid1, aid2, "contingency")

        assert env.get_obs.call_count == 2, "expected fresh fetch for both N-1 and N in fallback path"


def test_superposition_lines_overloaded_reads_context_ids_or_names(recommender):
    """`_superposition_lines_overloaded` must prefer the step1-populated
    keys (``lines_overloaded_ids`` and ``lines_overloaded_names``) so the
    on-demand monitoring set matches what step2's discovery used —
    previously only the session-reload key ``lines_overloaded`` was
    consulted, causing fresh-analysis on-demand re-estimation to
    recompute from ``obs_start`` and drift from the pre-computed view.
    """
    name_line = ["L0", "L1", "L2", "L3"]
    obs_start = _make_obs([0.5, 0.8, 0.99, 1.1])

    # Case 1: step1-populated `lines_overloaded_ids` wins.
    recommender._analysis_context = {"lines_overloaded_ids": [1, 3]}
    ids = recommender._superposition_lines_overloaded(
        obs_start, name_line, {n: i for i, n in enumerate(name_line)},
        pre_existing_rho={}, lines_we_care_about=set(name_line),
        branches_with_limits=set(name_line),
        monitoring_factor=0.95, worsening_threshold=0.02,
    )
    assert ids == [1, 3]

    # Case 2: only names present — still resolved via name_to_idx_map.
    recommender._analysis_context = {"lines_overloaded_names": ["L2", "L3"]}
    ids = recommender._superposition_lines_overloaded(
        obs_start, name_line, {n: i for i, n in enumerate(name_line)},
        pre_existing_rho={}, lines_we_care_about=set(name_line),
        branches_with_limits=set(name_line),
        monitoring_factor=0.95, worsening_threshold=0.02,
    )
    assert ids == [2, 3]

    # Case 3: session-reload key still honoured for backwards compat.
    recommender._analysis_context = {"lines_overloaded": ["L0"]}
    ids = recommender._superposition_lines_overloaded(
        obs_start, name_line, {n: i for i, n in enumerate(name_line)},
        pre_existing_rho={}, lines_we_care_about=set(name_line),
        branches_with_limits=set(name_line),
        monitoring_factor=0.95, worsening_threshold=0.02,
    )
    assert ids == [0]


if __name__ == "__main__":
    pytest.main([__file__])
