# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

"""Tests for configurable MW reduction in load shedding and curtailment actions.

When target_mw is provided to simulate_manual_action, the backend should:
1. For dynamic actions: compute setpoint = current_mw - target_mw (clamped >= 0)
2. For existing actions: update set_load_p / set_gen_p before simulation
"""

import numpy as np
import pytest
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService


class MockAction:
    """Minimal mock matching the shape of a grid2op action object."""
    def __init__(self, content):
        set_bus = content.get("set_bus", {})
        self.loads_bus = set_bus.get("loads_id", {})
        self.generators_bus = set_bus.get("generators_id", {})
        self.lines_ex_bus = set_bus.get("lines_ex_id", {})
        self.lines_or_bus = set_bus.get("lines_or_id", {})
        self.pst_tap = content.get("pst_tap", {})
        self.loads_p = content.get("set_load_p", {})
        self.gens_p = content.get("set_gen_p", {})


def _setup_env_mock(name_load=None, load_p=None, name_gen=None, gen_p=None):
    """Create a patched environment mock and return (patcher, env)."""
    patcher = patch(
        "expert_backend.services.recommender_service.RecommenderService._get_simulation_env"
    )
    mock_get_env = patcher.start()
    env = MagicMock()
    mock_get_env.return_value = env

    obs = MagicMock()
    obs.n_components = 1
    obs.main_component_load_mw = 1000.0
    obs.name_line = ["LINE_1"]
    obs.rho = np.array([0.1])
    obs.name_load = name_load or ["LOAD_A"]
    obs.load_p = np.array(load_p or [100.0])
    obs.name_gen = name_gen or ["GEN_WIND"]
    obs.gen_p = np.array(gen_p or [80.0])

    sim_obs = MagicMock()
    sim_obs.n_components = 1
    sim_obs.main_component_load_mw = 1000.0
    sim_obs.rho = np.array([0.05])
    sim_obs.name_line = ["LINE_1"]
    sim_obs.name_load = name_load or ["LOAD_A"]
    sim_obs.load_p = np.array([0.0])
    sim_obs.name_gen = name_gen or ["GEN_WIND"]
    sim_obs.gen_p = np.array([0.0])

    obs.simulate.return_value = (sim_obs, 0.5, False, {"exception": None})
    env.get_obs.return_value = obs
    env.action_space.side_effect = lambda c: MockAction(c) if getattr(env, "_use_mock_action", True) else MagicMock(spec=[])

    return patcher, env


class TestDynamicLoadSheddingWithTargetMw:
    """Dynamic load_shedding_<name> actions with configurable target_mw."""

    def test_partial_load_shedding(self):
        """target_mw=30 on a 100 MW load should set loads_p to 70 MW."""
        svc = RecommenderService()
        svc._dict_action = {"dummy": {}}

        patcher, env = _setup_env_mock(
            name_load=["LOAD_A"], load_p=[100.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                result = svc.simulate_manual_action(
                    "load_shedding_LOAD_A", "LINE_X", target_mw=30.0
                )

            entry = svc._dict_action["load_shedding_LOAD_A"]
            assert entry["content"]["set_load_p"]["LOAD_A"] == 70.0
        finally:
            patcher.stop()

    def test_full_load_shedding_no_target(self):
        """Without target_mw, load should be fully shed (setpoint = 0)."""
        svc = RecommenderService()
        svc._dict_action = {"dummy": {}}

        patcher, env = _setup_env_mock(
            name_load=["LOAD_A"], load_p=[100.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                svc.simulate_manual_action(
                    "load_shedding_LOAD_A", "LINE_X"
                )

            entry = svc._dict_action["load_shedding_LOAD_A"]
            assert entry["content"]["set_load_p"]["LOAD_A"] == 0.0
        finally:
            patcher.stop()

    def test_target_mw_exceeds_current_clamps_to_zero(self):
        """target_mw > current MW should clamp setpoint to 0."""
        svc = RecommenderService()
        svc._dict_action = {"dummy": {}}

        patcher, env = _setup_env_mock(
            name_load=["LOAD_A"], load_p=[50.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                svc.simulate_manual_action(
                    "load_shedding_LOAD_A", "LINE_X", target_mw=80.0
                )

            entry = svc._dict_action["load_shedding_LOAD_A"]
            assert entry["content"]["set_load_p"]["LOAD_A"] == 0.0
        finally:
            patcher.stop()


class TestDynamicCurtailmentWithTargetMw:
    """Dynamic curtail_<name> actions with configurable target_mw."""

    def test_partial_curtailment(self):
        """target_mw=20 on an 80 MW gen should set gens_p to 60 MW."""
        svc = RecommenderService()
        svc._dict_action = {"dummy": {}}

        patcher, env = _setup_env_mock(
            name_gen=["GEN_WIND"], gen_p=[80.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                svc.simulate_manual_action(
                    "curtail_GEN_WIND", "LINE_X", target_mw=20.0
                )

            entry = svc._dict_action["curtail_GEN_WIND"]
            assert entry["content"]["set_gen_p"]["GEN_WIND"] == 60.0
        finally:
            patcher.stop()

    def test_full_curtailment_no_target(self):
        """Without target_mw, gen should be fully curtailed (setpoint = 0)."""
        svc = RecommenderService()
        svc._dict_action = {"dummy": {}}

        patcher, env = _setup_env_mock(
            name_gen=["GEN_WIND"], gen_p=[80.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                svc.simulate_manual_action(
                    "curtail_GEN_WIND", "LINE_X"
                )

            entry = svc._dict_action["curtail_GEN_WIND"]
            assert entry["content"]["set_gen_p"]["GEN_WIND"] == 0.0
        finally:
            patcher.stop()


class TestExistingActionResimulationWithTargetMw:
    """Re-simulating existing actions with a new target_mw value."""

    def test_resimulate_load_shedding_with_target_mw(self):
        """Existing action with set_load_p should be updated with new setpoint."""
        svc = RecommenderService()
        # Pre-existing action that was previously fully shed
        svc._dict_action = {
            "load_shedding_LOAD_A": {
                "content": {"set_load_p": {"LOAD_A": 0.0}},
                "description": "Load shedding on LOAD_A",
                "description_unitaire": "Effacement 'LOAD_A'",
            }
        }

        patcher, env = _setup_env_mock(
            name_load=["LOAD_A"], load_p=[100.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                result = svc.simulate_manual_action(
                    "load_shedding_LOAD_A", "LINE_X", target_mw=40.0
                )
            content = svc._dict_action["load_shedding_LOAD_A"]["content"]
            assert content["set_load_p"]["LOAD_A"] == 60.0

            # Verify response shape
            assert "load_shedding_details" in result
            assert len(result["load_shedding_details"]) == 1
            # Mock behavior: full reduction
            assert result["load_shedding_details"][0]["shedded_mw"] == 100.0
        finally:
            patcher.stop()

    def test_resimulate_curtailment_with_target_mw(self):
        """Existing action with set_gen_p should be updated with new setpoint."""
        svc = RecommenderService()
        svc._dict_action = {
            "curtail_GEN_WIND": {
                "content": {"set_gen_p": {"GEN_WIND": 0.0}},
                "description": "Curtailment on GEN_WIND",
                "description_unitaire": "Effacement 'GEN_WIND'",
            }
        }

        patcher, env = _setup_env_mock(
            name_gen=["GEN_WIND"], gen_p=[80.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                result = svc.simulate_manual_action(
                    "curtail_GEN_WIND", "LINE_X", target_mw=25.0
                )

            content = svc._dict_action["curtail_GEN_WIND"]["content"]
            assert content["set_gen_p"]["GEN_WIND"] == 55.0

            # Verify response shape
            assert "curtailment_details" in result
            assert len(result["curtailment_details"]) == 1
            # Mock behavior: full reduction
            assert result["curtailment_details"][0]["curtailed_mw"] == 80.0
        finally:
            patcher.stop()

    def test_resimulate_without_target_mw_leaves_content_unchanged(self):
        """Re-simulating without target_mw should NOT change the content."""
        svc = RecommenderService()
        svc._dict_action = {
            "load_shedding_LOAD_A": {
                "content": {"set_load_p": {"LOAD_A": 30.0}},
                "description": "Load shedding on LOAD_A",
                "description_unitaire": "Effacement 'LOAD_A'",
            }
        }

        patcher, env = _setup_env_mock(
            name_load=["LOAD_A"], load_p=[100.0]
        )
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                svc.simulate_manual_action(
                    "load_shedding_LOAD_A", "LINE_X"
                )

            # Content should be unchanged since target_mw was not provided
            content = svc._dict_action["load_shedding_LOAD_A"]["content"]
            assert content["set_load_p"]["LOAD_A"] == 30.0
        finally:
            patcher.stop()


class TestActionTopologyPersistence:
    """Verify that action_topology reflects the correct setpoints after simulation."""

    def test_resimulate_topology_persistence(self):
        """action_topology should contain the calculated setpoint, not hardcoded 0.0."""
        svc = RecommenderService()
        svc._dict_action = {
            "curtail_GEN_WIND": {
                "content": {"set_gen_p": {"GEN_WIND": 0.0}},
                "description": "Curtailment on GEN_WIND",
                "description_unitaire": "Effacement 'GEN_WIND'",
            }
        }

        patcher, env = _setup_env_mock(
            name_gen=["GEN_WIND"], gen_p=[80.0]
        )
        # Simulate a Grid2Op-like action that DOES NOT have a public .gens_p attribute
        env._use_mock_action = False 
        
        try:
            with patch.object(svc, "_get_monitoring_parameters", return_value=(set(), set())), \
                 patch.object(svc, "_compute_deltas", return_value={}):
                # Simulate a 20 MW reduction (so setpoint should be 60.0)
                result = svc.simulate_manual_action(
                    "curtail_GEN_WIND", "LINE_X", target_mw=20.0
                )

            # The returned action_topology should have gens_p: {GEN_WIND: 60.0}
            assert "action_topology" in result
            topo = result["action_topology"]
            assert "gens_p" in topo
            assert topo["gens_p"]["GEN_WIND"] == 60.0
        finally:
            patcher.stop()
