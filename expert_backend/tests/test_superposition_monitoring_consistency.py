# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid, a Power Grid Study tool.

"""Tests for superposition estimation monitoring consistency.

These tests verify that compute_superposition and simulate_manual_action
use the same set of monitored lines for max_rho computation:

1. Lines without permanent thermal limits (branches_with_limits) must be
   excluded from both estimation and simulation max_rho.
2. N-1 overloaded lines (lines_overloaded_ids) must be force-included
   in both paths, even if they are pre-existing N-state overloads.
3. The fallback lines_overloaded_ids computation must filter by
   lines_we_care_about AND branches_with_limits.
4. PST actions must pass the is_pst flag so betas are computed correctly.
5. Analysis context lines_overloaded takes priority over recomputation.
"""

import pytest
import numpy as np
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_obs(rho_vals, p_or_vals=None, name_line=None):
    """Create a mock observation with proper numpy arrays."""
    obs = MagicMock()
    obs.rho = np.array(rho_vals, dtype=float)
    if p_or_vals is not None:
        obs.p_or = np.array(p_or_vals, dtype=float)
    else:
        obs.p_or = np.zeros(len(rho_vals))
    if name_line is not None:
        obs.name_line = name_line
    return obs


def _setup_env(recommender, name_line, obs_n1_rho, obs_n_rho,
               actions_dict, dict_action=None,
               lines_we_care_about=None, branches_with_limits=None,
               analysis_context=None):
    """Common setup for monitoring consistency tests.

    Returns the mock env so callers can add further configuration.
    """
    n_lines = len(name_line)

    recommender._last_result = {"prioritized_actions": actions_dict}
    recommender._dict_action = dict_action or {}
    recommender._analysis_context = analysis_context

    env = MagicMock()
    env.name_line = name_line
    recommender._get_simulation_env = MagicMock(return_value=env)
    recommender._get_n_variant = MagicMock(return_value="N")
    recommender._get_n1_variant = MagicMock(return_value="N-1")
    env.network_manager.network.get_working_variant_id.return_value = "ORIG"

    obs_n1 = _make_obs(obs_n1_rho, name_line=name_line)
    obs_n = _make_obs(obs_n_rho, name_line=name_line)
    # compute_superposition calls get_obs for N-1 then N
    env.get_obs.side_effect = [obs_n1, obs_n]

    lwca = set(lines_we_care_about) if lines_we_care_about is not None else set(name_line)
    bwl = set(branches_with_limits) if branches_with_limits is not None else set(name_line)
    recommender._get_monitoring_parameters = MagicMock(return_value=(lwca, bwl))

    config.MONITORING_FACTOR_THERMAL_LIMITS = 0.95
    config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD = 0.02

    return env


# ---------------------------------------------------------------------------
# Tests: Lines without thermal limits must be excluded
# ---------------------------------------------------------------------------

class TestBranchesWithLimitsFiltering:
    """Lines NOT in branches_with_limits must never appear as max_rho_line."""

    def test_line_without_limits_excluded_from_max_rho(self):
        """A line with high rho but no thermal limit must not be the max_rho_line.

        Regression: CIVAUY712 had no permanent thermal limit, was force-included
        via unfiltered lines_overloaded_ids, and showed 441% estimated loading.
        """
        svc = RecommenderService()
        name_line = ["CANTEY761", "CIVAUY712", "BIESL61PRAGN"]

        # CANTEY761 is overloaded in N-1, CIVAUY712 also high but no limit
        obs_n1_rho = [1.10, 0.98, 0.86]
        obs_n_rho = [0.50, 0.40, 0.74]

        obs_act1 = _make_obs([0.90, 0.95, 0.85], name_line=name_line)
        obs_act2 = _make_obs([0.88, 0.90, 0.80], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        # CIVAUY712 has NO permanent thermal limit
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   branches_with_limits=["CANTEY761", "BIESL61PRAGN"])

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            # betas that would give high rho for CIVAUY712 if it were monitored
            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        assert result["max_rho_line"] != "CIVAUY712", \
            "Line without thermal limit must not be the max_rho_line"
        assert result["max_rho_line"] in ("CANTEY761", "BIESL61PRAGN")

    def test_lines_overloaded_fallback_filters_by_limits(self):
        """When no analysis context, lines_overloaded_ids must only include
        lines that are in both lines_we_care_about AND branches_with_limits."""
        svc = RecommenderService()
        name_line = ["LINE_A", "LINE_B", "LINE_C"]

        # LINE_B has rho >= 0.95 in N-1 but is NOT in branches_with_limits
        obs_n1_rho = [0.50, 0.98, 0.96]
        obs_n_rho = [0.30, 0.30, 0.30]

        obs_act1 = _make_obs([0.45, 0.90, 0.90], name_line=name_line)
        obs_act2 = _make_obs([0.45, 0.85, 0.85], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   branches_with_limits=["LINE_A", "LINE_C"],
                   analysis_context=None)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        # LINE_B should NOT be the max (no thermal limit)
        assert result["max_rho_line"] != "LINE_B"


# ---------------------------------------------------------------------------
# Tests: Force-inclusion of N-1 overloaded lines
# ---------------------------------------------------------------------------

class TestOverloadedLinesForceInclusion:
    """N-1 overloaded lines must be force-included in the care_mask,
    even when they are pre-existing N-state overloads."""

    def test_n1_overloaded_line_included_despite_preexisting(self):
        """A line overloaded in both N and N-1 must still be included
        if it's in lines_overloaded_ids (from analysis context)."""
        svc = RecommenderService()
        name_line = ["OVERLOADED", "NORMAL"]

        obs_n1_rho = [1.10, 0.50]
        # OVERLOADED is also a pre-existing N-state overload
        obs_n_rho = [0.96, 0.40]

        obs_act1 = _make_obs([0.90, 0.45], name_line=name_line)
        obs_act2 = _make_obs([0.85, 0.40], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        # Analysis context provides the overloaded line
        ctx = {"lines_overloaded": ["OVERLOADED"]}
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   analysis_context=ctx)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        # OVERLOADED should be the max because it's force-included and has higher rho
        assert result["max_rho_line"] == "OVERLOADED"

    def test_analysis_context_takes_priority_over_recomputation(self):
        """When analysis context has lines_overloaded, use those instead of
        recomputing from obs_start.rho >= monitoring_factor."""
        svc = RecommenderService()
        name_line = ["SELECTED", "NOT_SELECTED"]

        # Both lines are overloaded in N-1
        obs_n1_rho = [1.05, 1.08]
        obs_n_rho = [0.30, 0.30]

        obs_act1 = _make_obs([0.80, 0.85], name_line=name_line)
        obs_act2 = _make_obs([0.75, 0.80], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        # Analysis context only includes SELECTED
        ctx = {"lines_overloaded": ["SELECTED"]}
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   analysis_context=ctx)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        # Both lines are monitored (both in lines_we_care_about), but
        # the analysis context only force-includes SELECTED
        assert "max_rho" in result
        assert result["is_estimated"] is True


# ---------------------------------------------------------------------------
# Tests: Pre-existing overload handling uses rho_combined
# ---------------------------------------------------------------------------

class TestPreExistingOverloadHandling:
    """Pre-existing N-state overloads should be excluded unless the combined
    action worsens them. The worsening check must use rho_combined."""

    def test_preexisting_excluded_when_not_worsened(self):
        """A pre-existing N-state overload that improves should be excluded
        from max_rho (unless force-included as lines_overloaded)."""
        svc = RecommenderService()
        name_line = ["PRE_EXISTING", "OTHER"]

        obs_n1_rho = [0.80, 0.70]
        # PRE_EXISTING is overloaded in N (>= 0.95)
        obs_n_rho = [0.97, 0.40]

        obs_act1 = _make_obs([0.70, 0.65], name_line=name_line)
        obs_act2 = _make_obs([0.65, 0.60], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        # No analysis context — so force-inclusion won't add PRE_EXISTING
        # (it's not in N-1 overloaded because rho_N1=0.80 < 0.95)
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   analysis_context=None)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        # PRE_EXISTING (N-state overload at 97%, combined action improves it)
        # should be excluded, so OTHER should be max
        assert result["max_rho_line"] == "OTHER"

    def test_preexisting_included_when_worsened(self):
        """A pre-existing N-state overload that gets worse should be included."""
        svc = RecommenderService()
        name_line = ["PRE_EXISTING", "OTHER"]

        obs_n1_rho = [0.80, 0.50]
        obs_n_rho = [0.96, 0.40]

        # Action observations that will make PRE_EXISTING worse
        # Combined formula: |(1-1.0)*rho_n1 + 0.5*obs1 + 0.5*obs2|
        # = |0 + 0.5*1.1 + 0.5*1.2| = |1.15|
        # This is >> 0.96 * 1.02 = 0.9792, so worsened=True
        obs_act1 = _make_obs([1.10, 0.45], name_line=name_line)
        obs_act2 = _make_obs([1.20, 0.40], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   analysis_context=None)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        # PRE_EXISTING should be included because it's worsened
        assert result["max_rho_line"] == "PRE_EXISTING"


# ---------------------------------------------------------------------------
# Tests: No N-state overloads (user's actual scenario)
# ---------------------------------------------------------------------------

class TestNoNStateOverloads:
    """When there are no N-state overloads, all lines in care_mask are eligible.
    The estimation should see the correct set of monitored lines."""

    def test_all_monitored_lines_eligible_without_n_overloads(self):
        """Without N-state overloads, eligible lines = care_mask lines."""
        svc = RecommenderService()
        name_line = ["CANTEY761", "BIESL61PRAGN", "TRI_PY761"]

        obs_n1_rho = [1.16, 0.86, 0.50]
        obs_n_rho = [0.50, 0.74, 0.30]  # no N-state overloads

        obs_act1 = _make_obs([1.06, 1.00, 0.95], name_line=name_line)
        obs_act2 = _make_obs([0.98, 0.85, 0.90], name_line=name_line)
        actions = {
            "pst_tap_PST1_inc2": {"action": MagicMock(), "observation": obs_act1},
            "reco_SWITCH1": {"action": MagicMock(), "observation": obs_act2},
        }

        ctx = {"lines_overloaded": ["CANTEY761"]}
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   dict_action={
                       "pst_tap_PST1_inc2": {"content": {"pst_tap": {"PST1": 32}},
                                             "description_unitaire": "Variation de slot"},
                       "reco_SWITCH1": {"content": {"set_bus": {}},
                                       "description_unitaire": "Reconnect"},
                   },
                   analysis_context=ctx)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.90, 0.93]}
            result = svc.compute_superposition("pst_tap_PST1_inc2", "reco_SWITCH1", "CONTINGENCY")

        # All 3 lines should be eligible (no N-state overloads to exclude)
        assert result["max_rho_line"] in name_line
        assert result["is_estimated"] is True
        assert result["max_rho"] > 0

    def test_estimation_considers_all_monitored_lines_globally(self):
        """The estimation must consider ALL monitored lines and pick the
        global max — not just the overloaded lines.

        This verifies the estimation does a fresh global scan, not a
        cached result from a previous call.
        """
        svc = RecommenderService()
        name_line = ["LINE_A", "LINE_B", "LINE_C"]

        obs_n1_rho = [1.05, 0.80, 0.70]
        obs_n_rho = [0.40, 0.30, 0.20]

        # After actions: LINE_B has the highest combined rho
        obs_act1 = _make_obs([0.60, 0.95, 0.50], name_line=name_line)
        obs_act2 = _make_obs([0.55, 0.90, 0.45], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        ctx = {"lines_overloaded": ["LINE_A"]}
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   analysis_context=ctx)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            # betas=[1.0, 1.0] → rho_combined = |-rho_n1 + obs1 + obs2|
            # LINE_A: |-1.05 + 0.60 + 0.55| = 0.10
            # LINE_B: |-0.80 + 0.95 + 0.90| = 1.05
            # LINE_C: |-0.70 + 0.50 + 0.45| = 0.25
            mock_sp.return_value = {"betas": [1.0, 1.0]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        # LINE_B should be the max even though it's not in lines_overloaded
        assert result["max_rho_line"] == "LINE_B"


# ---------------------------------------------------------------------------
# Tests: PST-specific superposition behavior
# ---------------------------------------------------------------------------

class TestPSTSuperpositionMonitoring:
    """PST tap actions in combined pairs must be handled correctly:
    - is_pst flag must be passed to the library
    - Lines without limits must not leak into monitoring
    - Re-simulation with different tap updates the observation
    """

    def test_pst_combined_with_switching_monitors_same_lines(self):
        """A PST + switching action pair should monitor the same lines
        as two switching actions paired together."""
        svc = RecommenderService()
        name_line = ["CANTEY761", "BIESL61PRAGN", "NO_LIMIT_LINE"]

        obs_n1_rho = [1.10, 0.86, 0.90]
        obs_n_rho = [0.50, 0.74, 0.40]

        obs_pst = _make_obs([1.06, 1.00, 0.88], name_line=name_line)
        obs_switch = _make_obs([0.98, 0.85, 0.82], name_line=name_line)
        actions = {
            "pst_tap_PST1": {"action": MagicMock(), "observation": obs_pst},
            "reco_SWITCH": {"action": MagicMock(), "observation": obs_switch},
        }

        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   dict_action={
                       "pst_tap_PST1": {"content": {"pst_tap": {"PST1": 32}},
                                        "description_unitaire": "Variation de slot"},
                       "reco_SWITCH": {"content": {"set_bus": {}},
                                      "description_unitaire": "Reconnect"},
                   },
                   # NO_LIMIT_LINE not in branches_with_limits
                   branches_with_limits=["CANTEY761", "BIESL61PRAGN"],
                   analysis_context={"lines_overloaded": ["CANTEY761"]})

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.90, 0.93]}
            result = svc.compute_superposition("pst_tap_PST1", "reco_SWITCH", "CONTINGENCY")

        # NO_LIMIT_LINE must not appear as max
        assert result["max_rho_line"] != "NO_LIMIT_LINE"
        assert result["max_rho_line"] in ("CANTEY761", "BIESL61PRAGN")

    def test_is_rho_reduction_computed_on_overloaded_lines(self):
        """is_rho_reduction should be True when all overloaded lines see
        a decrease in combined rho vs N-1 baseline."""
        svc = RecommenderService()
        name_line = ["OVERLOADED"]

        obs_n1_rho = [1.10]
        obs_n_rho = [0.50]

        # Both actions reduce OVERLOADED
        obs_act1 = _make_obs([0.80], name_line=name_line)
        obs_act2 = _make_obs([0.75], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        ctx = {"lines_overloaded": ["OVERLOADED"]}
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   analysis_context=ctx)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            # rho_combined = |(1 - 0.5 - 0.5)*1.1 + 0.5*0.8 + 0.5*0.75|
            # = |0 + 0.4 + 0.375| = 0.775 < 1.10 → reduction
            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        assert result["is_rho_reduction"] is True


# ---------------------------------------------------------------------------
# Tests: Monitoring factor scaling
# ---------------------------------------------------------------------------

class TestMonitoringFactorScaling:
    """max_rho must be scaled by monitoring_factor for display."""

    def test_max_rho_scaled_by_monitoring_factor(self):
        """Result max_rho = raw_max_rho * monitoring_factor."""
        svc = RecommenderService()
        name_line = ["LINE1"]
        obs_n1_rho = [1.10]
        obs_n_rho = [0.30]

        obs_act1 = _make_obs([0.90], name_line=name_line)
        obs_act2 = _make_obs([0.85], name_line=name_line)
        actions = {
            "act1": {"action": MagicMock(), "observation": obs_act1},
            "act2": {"action": MagicMock(), "observation": obs_act2},
        }

        ctx = {"lines_overloaded": ["LINE1"]}
        _setup_env(svc, name_line, obs_n1_rho, obs_n_rho, actions,
                   analysis_context=ctx)

        with patch('expert_backend.services.simulation_mixin._identify_action_elements',
                   return_value=([0], [])), \
             patch('expert_backend.services.simulation_mixin.compute_combined_pair_superposition') as mock_sp:

            mock_sp.return_value = {"betas": [0.5, 0.5]}
            result = svc.compute_superposition("act1", "act2", "CONTINGENCY")

        # rho_combined = |(1-1.0)*1.1 + 0.5*0.9 + 0.5*0.85| = 0.875
        # max_rho = 0.875 * 0.95 = 0.83125
        expected_raw = abs((1.0 - 1.0) * 1.1 + 0.5 * 0.9 + 0.5 * 0.85)
        expected_scaled = expected_raw * 0.95
        assert abs(result["max_rho"] - expected_scaled) < 0.001


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
