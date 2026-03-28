# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import pytest
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService

class TestIslandingMWReporting:
    def setup_method(self):
        self.service = RecommenderService()

    @patch("expert_backend.services.recommender_service.enrich_actions_lazy")
    @patch("expert_backend.services.recommender_service.load_actions")
    def test_simulate_manual_action_with_islanding(self, mock_load, mock_enrich):
        """Verify that disconnected_mw is correctly calculated and returned when islanding occurs."""
        # 1. Setup mocks
        mock_load.return_value = {"action_1": {"switches": {"S1": True}}}
        mock_enrich.return_value = {"action_1": {"switches": {"S1": True}, "content": {"set_bus": {}}}}
        self.service._dict_action = mock_enrich.return_value

        env = MagicMock()
        self.service._get_simulation_env = MagicMock(return_value=env)
        
        # Initial observation (N)
        obs = MagicMock()
        obs.n_components = 1
        env.get_obs.return_value = obs

        # N-1 observation (obs_simu_defaut)
        obs_n1 = MagicMock()
        obs_n1.n_components = 1
        obs_n1.main_component_load_mw = 1000.0  # Mainland load before action
        
        # Simulation observation (obs_simu_action)
        obs_action = MagicMock()
        obs_action.n_components = 2  # Islanding detected!
        obs_action.main_component_load_mw = 950.0   # Mainland load after action
        
        # mock obs.simulate(action) -> (obs_simu, reward, done, info)
        obs_n1.simulate.return_value = (obs_action, 0.0, False, {"exception": []})
        
        # Override get_obs to return obs_n1 on the second call (N-1)
        env.get_obs.side_effect = [obs, obs_n1]

        with patch.object(self.service, "_get_monitoring_parameters", return_value=(set(), set())), \
             patch.object(self.service, "_compute_deltas", return_value={}), \
             patch.object(self.service, "_get_n_variant", return_value="variant_n"), \
             patch.object(self.service, "_get_n1_variant", return_value="variant_n1"):
            
            # Execute
            result = self.service.simulate_manual_action("action_1", "LINE_1")
            
            # Verify
            assert result["is_islanded"] is True
            # disconnected_mw = obs_n1.main_component_load_mw - obs_action.main_component_load_mw
            # 1000.0 - 950.0 = 50.0
            assert result["disconnected_mw"] == 50.0
            assert result["n_components"] == 2

    @patch("expert_backend.services.recommender_service.enrich_actions_lazy")
    @patch("expert_backend.services.recommender_service.load_actions")
    def test_simulate_manual_action_no_islanding(self, mock_load, mock_enrich):
        """Verify that disconnected_mw is not returned (or is 0) when no islanding occurs."""
        mock_load.return_value = {"action_1": {"switches": {"S1": True}}}
        mock_enrich.return_value = {"action_1": {"switches": {"S1": True}, "content": {"set_bus": {}}}}
        self.service._dict_action = mock_enrich.return_value

        env = MagicMock()
        self.service._get_simulation_env = MagicMock(return_value=env)
        
        obs = MagicMock()
        obs.n_components = 1
        env.get_obs.return_value = obs

        obs_n1 = MagicMock()
        obs_n1.n_components = 1
        obs_n1.main_component_load_mw = 1000.0
        
        obs_action = MagicMock()
        obs_action.n_components = 1  # No islanding
        obs_action.main_component_load_mw = 1000.0
        
        obs_n1.simulate.return_value = (obs_action, 0.0, False, {"exception": []})
        env.get_obs.side_effect = [obs, obs_n1]

        with patch.object(self.service, "_get_monitoring_parameters", return_value=(set(), set())), \
             patch.object(self.service, "_compute_deltas", return_value={}), \
             patch.object(self.service, "_get_n_variant", return_value="variant_n"), \
             patch.object(self.service, "_get_n1_variant", return_value="variant_n1"):
            
            result = self.service.simulate_manual_action("action_1", "LINE_1")
            
            assert result["is_islanded"] is False
            assert result["disconnected_mw"] == 0.0
