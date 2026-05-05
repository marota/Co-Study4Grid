# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Regression tests for re-simulate double-click bug and serialization issues.
"""

import numpy as np
import pytest
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService


class MockAction:
    """Minimal mock matching the shape of a grid2op action object."""
    def __init__(self, content):
        self.loads_p = content.get("set_load_p", {})
        self.gens_p = content.get("set_gen_p", {})
        self.pst_tap = content.get("pst_tap", {})
        self.switches = content.get("switches", {})
        self.substations = content.get("substations", {})


def _setup_env_mock(name_load=None, load_p=None, name_gen=None, gen_p=None):
    """Create a patched environment mock."""
    patcher = patch(
        "expert_backend.services.recommender_service.RecommenderService._get_simulation_env"
    )
    mock_get_env = patcher.start()
    env = MagicMock()
    mock_get_env.return_value = env

    # N state (base)
    obs_n = MagicMock()
    obs_n.n_components = 1
    obs_n.main_component_load_mw = 1000.0
    obs_n.name_line = ["LINE_1"]
    obs_n.rho = np.array([0.1]) # Healthy in N
    obs_n.name_load = name_load or ["LOAD_A"]
    obs_n.load_p = np.array(load_p or [100.0])
    obs_n.name_gen = name_gen or ["GEN_WIND"]
    obs_n.gen_p = np.array(gen_p or [80.0])

    # N-1 state (contingency default)
    obs_n1 = MagicMock()
    obs_n1.n_components = 1
    obs_n1.main_component_load_mw = 1000.0
    obs_n1.name_line = ["LINE_1"]
    # Overloaded in N-1. obs.rho is mf-scaled (grid2op divides by
    # ``limit * mf``), so values >= 1.0 are above the monitoring threshold.
    obs_n1.rho = np.array([1.05])
    obs_n1.name_load = obs_n.name_load
    obs_n1.load_p = obs_n.load_p
    obs_n1.name_gen = obs_n.name_gen
    obs_n1.gen_p = obs_n.gen_p

    # N-1 state after action
    sim_obs = MagicMock()
    sim_obs.n_components = 1
    sim_obs.main_component_load_mw = 1000.0
    sim_obs.rho = np.array([0.8]) # Better after action
    sim_obs.name_line = ["LINE_1"]
    sim_obs.name_load = obs_n.name_load
    sim_obs.load_p = np.array([30.0])
    sim_obs.name_gen = obs_n.name_gen
    sim_obs.gen_p = np.array([3.8])

    obs_n1.simulate.return_value = (sim_obs, 0.5, False, {"exception": None})
    
    # env.get_obs() is called twice: 
    # 1. Base N state
    # 2. Contingency N-1 state (base for simulation)
    env.get_obs.side_effect = [obs_n, obs_n1]
    env.action_space.side_effect = lambda c: MockAction(c)

    return patcher, env


class TestResimulateRegressions:
    """Tests for heuristic promotion and response sanitization."""

    def test_heuristic_action_promotion(self):
        """Action in recent_actions but not in _dict_action should be promoted and updated."""
        svc = RecommenderService()
        svc._dict_action = {"dummy": {}} # Bypass "no action dictionary" check
        
        # Mock a heuristic action object in recent_actions
        mock_a_obj = MagicMock()
        mock_a_obj.gens_p = {"GEN_WIND": 0.0}
        mock_a_obj.loads_p = {}
        mock_a_obj.pst_tap = {}
        mock_a_obj.switches = {}
        
        recent_actions = {
            "curtail_GEN_WIND": {
                "action": mock_a_obj,
                "description_unitaire": "Initial Suggestion"
            }
        }
        
        patcher, env = _setup_env_mock(name_gen=["GEN_WIND"], gen_p=[6.8])
        try:
            with patch.object(svc, "_last_result", {"prioritized_actions": recent_actions}), \
                 patch.object(svc, "_get_monitoring_parameters", return_value=(set(["LINE_1"]), set(["LINE_1"]))), \
                 patch.object(svc, "_get_n1_variant", return_value="LINE_X_VAR"), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                
                # First call: should promote and apply target_mw=3.8
                # Since we start at 6.8, target_mw=3.8 means reduction=3.0, setpoint=3.8
                result = svc.simulate_manual_action(
                    "curtail_GEN_WIND", "LINE_X", target_mw=3.0
                )
                
            # Verify promotion
            assert "curtail_GEN_WIND" in svc._dict_action
            entry = svc._dict_action["curtail_GEN_WIND"]
            # 6.8 (current) - 3.0 (target reduction) = 3.8 (setpoint)
            assert entry["content"]["set_gen_p"]["GEN_WIND"] == 3.8
            assert entry["description_unitaire"] == "Initial Suggestion"
            
        finally:
            patcher.stop()

    def test_response_sanitization(self):
        """Simulation response must not contain raw objects and must have sanitized numbers."""
        svc = RecommenderService()
        svc._dict_action = {
            "test_action": {"content": {}, "description_unitaire": "Test"}
        }
        
        patcher, env = _setup_env_mock()
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(["LINE_1"]), set(["LINE_1"]))), \
                 patch.object(svc, "_get_n1_variant", return_value="LINE_X_VAR"), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                
                result = svc.simulate_manual_action("test_action", "LINE_X")
                
            # JSON sanitization checks
            assert "observation" not in result
            assert "action" not in result
            
            # Verify numerical types are standard Python floats (not numpy)
            assert isinstance(result["max_rho"], float)
            assert isinstance(result["rho_before"], list)
            assert isinstance(result["rho_before"][0], float)
            assert isinstance(result["rho_after"], list)
            assert isinstance(result["rho_after"][0], float)
            
        finally:
            patcher.stop()

    def test_curtailment_details_computation(self):
        """curtailment_details should be correctly populated in the response."""
        svc = RecommenderService()
        svc._dict_action = {
            "curtail_GEN_WIND": {
                "content": {"set_gen_p": {"GEN_WIND": 3.8}},
                "description_unitaire": "Curtail"
            }
        }
        
        # 6.8 initial, 3.8 simulation result -> 3.0 delta
        patcher, env = _setup_env_mock(name_gen=["GEN_WIND"], gen_p=[6.8])
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(["LINE_1"]), set(["LINE_1"]))), \
                 patch.object(svc, "_get_n1_variant", return_value="LINE_X_VAR"), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                
                result = svc.simulate_manual_action("curtail_GEN_WIND", "LINE_X")
                
            assert "curtailment_details" in result
            details = result["curtailment_details"]
            assert len(details) == 1
            assert details[0]["gen_name"] == "GEN_WIND"
            # 6.8 (obs_n1) - 3.8 (obs_simu) = 3.0
            assert approx(details[0]["curtailed_mw"]) == 3.0
            
        finally:
            patcher.stop()

def approx(val):
    return pytest.approx(val, rel=1e-3)
