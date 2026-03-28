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

class TestDynamicActions:
    @pytest.fixture
    def service(self):
        s = RecommenderService()
        s._dict_action = {"dummy": {}} # Bypass "No action dictionary loaded" check
        return s

    @pytest.fixture
    def mock_env(self):
        with patch("expert_backend.services.recommender_service.RecommenderService._get_simulation_env") as mock_get_env:
            env = MagicMock()
            mock_get_env.return_value = env
            
            # Mock observe/simulate results
            obs = MagicMock()
            obs.n_components = 1
            obs.main_component_load_mw = 1000.0
            obs.name_line = ["LINE_1"]
            obs.rho = np.array([0.1])
            obs.name_load = ["LOAD123"]
            obs.load_p = np.array([50.0])
            
            sim_obs = MagicMock()
            sim_obs.n_components = 1
            sim_obs.main_component_load_mw = 1000.0
            sim_obs.rho = np.array([0.05])
            sim_obs.name_line = ["LINE_1"]
            sim_obs.name_load = ["LOAD123"]
            sim_obs.load_p = np.array([0.0])
            
            obs.simulate.return_value = (sim_obs, 0.5, False, {"exception": None})
            env.get_obs.return_value = obs
            
            # Mock action_space to return an object with loads_bus/pst_tap
            class MockAction:
                def __init__(self, content):
                    set_bus = content.get("set_bus", {})
                    self.loads_bus = set_bus.get("loads_id", {})
                    self.generators_bus = set_bus.get("generators_id", {})
                    self.lines_ex_bus = set_bus.get("lines_ex_id", {})
                    self.lines_or_bus = set_bus.get("lines_or_id", {})
                    self.pst_tap = content.get("pst_tap", {})

            def mock_action_space_func(content):
                return MockAction(content)
            
            env.action_space.side_effect = mock_action_space_func
            
            yield env

    def test_simulate_manual_load_shedding_dynamic(self, service, mock_env):
        """Test that a non-existent load_shedding action is created on the fly."""
        action_id = "load_shedding_LOAD123"
        contingency = "LINE_X"
        
        # Ensure it's not in the dict initially (except the dummy)
        service._dict_action = {"dummy": {}}
        
        with patch.object(service, "_get_monitoring_parameters", return_value=(set(), set())), \
             patch.object(service, "_compute_deltas", return_value={}):
            
            result = service.simulate_manual_action(action_id, contingency)
            
            assert result["action_id"] == action_id
            assert "Effacement" in result["description_unitaire"]
            
            assert action_id in service._dict_action
            action_entry = service._dict_action[action_id]
            assert "content" in action_entry
            assert action_entry["content"]["set_bus"]["loads_id"]["LOAD123"] == -1

    def test_simulate_manual_pst_tap_inc_dynamic(self, service, mock_env):
        """Test that a non-existent pst_tap_..._incX action is created on the fly."""
        action_id = "pst_tap_PST_A_inc2"
        contingency = "LINE_X"
        
        service._dict_action = {"dummy": {}}
        
        # Mock PST tap info: current=5, min=0, max=10
        pst_info = {"tap": 5, "low_tap": 0, "high_tap": 10}
        
        # Patching NetworkManager on the ENV instance
        mock_env.network_manager.get_pst_tap_info.return_value = pst_info
        
        with patch.object(service, "_get_monitoring_parameters", return_value=(set(), set())), \
             patch.object(service, "_compute_deltas", return_value={}):
            
            result = service.simulate_manual_action(action_id, contingency)
            
            assert result["action_id"] == action_id
            assert "Variation PST" in result["description_unitaire"]
            
            # Verify it was injected into _dict_action
            assert action_id in service._dict_action
            action_entry = service._dict_action[action_id]
            assert action_entry["content"]["pst_tap"]["PST_A"] == 7

    def test_simulate_manual_pst_dec_dynamic(self, service, mock_env):
        """Test that a non-existent pst_..._decX action is created on the fly (alternative prefix)."""
        action_id = "pst_PST_B_dec1"
        contingency = "LINE_X"
        
        service._dict_action = {"dummy": {}}
        pst_info = {"tap": 5, "low_tap": 0, "high_tap": 10}
        mock_env.network_manager.get_pst_tap_info.return_value = pst_info
        
        with patch.object(service, "_get_monitoring_parameters", return_value=(set(), set())), \
             patch.object(service, "_compute_deltas", return_value={}):
            
            result = service.simulate_manual_action(action_id, contingency)
            
            assert result["action_id"] == action_id
            assert "Variation PST" in result["description_unitaire"]
            assert service._dict_action[action_id]["content"]["pst_tap"]["PST_B"] == 4

    def test_simulate_manual_action_not_found_error(self, service, mock_env):
        """Test that an unknown action ID that DOES NOT match dynamic patterns still raises error."""
        action_id = "unknown_action_999"
        contingency = "LINE_X"
        service._dict_action = {"dummy": {}}
        
        with pytest.raises(ValueError, match="not found"):
            service.simulate_manual_action(action_id, contingency)

    def test_simulate_manual_action_untrimmed(self, service, mock_env):
        """Test that untrimmed IDs also work (common in manual entry)."""
        # GIVEN: a service and an untrimmed ID
        raw_aid = "  load_shedding_LOAD123  "
        clean_aid = "load_shedding_LOAD123"
        contingency = "LINE_X"
        
        # Patching necessary methods to avoid full simulation logic
        with patch.object(service, "_get_monitoring_parameters", return_value=(set(), set())), \
             patch.object(service, "_compute_deltas", return_value={}):
            
            # WHEN: simulating
            res = service.simulate_manual_action(raw_aid, contingency)
            
            # THEN: it should work and be stored with the clean ID
            assert res['action_id'] == clean_aid
            assert clean_aid in service._dict_action
            assert "Effacement" in res["description_unitaire"]
