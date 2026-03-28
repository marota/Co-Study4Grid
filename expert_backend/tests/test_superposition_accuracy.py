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
from expert_op4grid_recommender.action_evaluation.classifier import ActionClassifier

@pytest.fixture
def mock_env():
    env = MagicMock()
    env.name_line = ["LINE1", "LINE2", "LINE3"]
    env.action_space = MagicMock()
    env.get_thermal_limit.return_value = np.array([100.0, 100.0, 100.0])
    return env

@pytest.fixture
def service(mock_env):
    with patch('expert_backend.services.recommender_service.load_actions', return_value={"dummy": {"content": {}}}):
        service = RecommenderService()
        service._env = mock_env
        service._dict_action = {"dummy": {"content": {}}}
        return service

def test_superposition_vs_simulation_discrepancy(service, mock_env):
    # Setup a scenario where superposition should NOT be perfectly identical to simulation
    # (e.g. by having some non-linearity or just checking that we don't accidentally return the same object)
    
    # Mock observation for N-1
    obs_n1 = MagicMock()
    obs_n1.rho = np.array([0.5, 0.5, 0.5])
    obs_n1.name_line = ["LINE1", "LINE2", "LINE3"]
    obs_n1.p_or = np.array([50.0, 50.0, 50.0])
    obs_n1.n_components = 1
    
    # Mock observation for Action 1
    obs_act1 = MagicMock()
    obs_act1.rho = np.array([0.4, 0.6, 0.5])
    obs_act1.name_line = ["LINE1", "LINE2", "LINE3"]
    obs_act1.p_or = np.array([40.0, 60.0, 50.0])
    
    # Mock observation for Action 2
    obs_act2 = MagicMock()
    obs_act2.rho = np.array([0.6, 0.4, 0.5])
    obs_act2.name_line = ["LINE1", "LINE2", "LINE3"]
    obs_act2.p_or = np.array([60.0, 40.0, 50.0])

    # Simulation results for single actions
    service._last_result = {
        "prioritized_actions": {
            "act1": {
                "observation": obs_act1,
                "action": MagicMock(),
                "max_rho": 0.6,
                "max_rho_line": "LINE2"
            },
            "act2": {
                "observation": obs_act2,
                "action": MagicMock(),
                "max_rho": 0.6,
                "max_rho_line": "LINE1"
            }
        },
        "combined_actions": {}
    }

    # Mock compute_combined_pair_superposition to return something based on linear combination
    # (1.0 - sum(betas))*rho_start + beta1*rho_act1 + beta2*rho_act2
    # If we use betas [1.0, 1.0], it would be: -1.0*rho_start + 1.0*rho_act1 + 1.0*rho_act2
    # = - [0.5, 0.5, 0.5] + [0.4, 0.6, 0.5] + [0.6, 0.4, 0.5] = [0.5, 0.5, 0.5]
    
    with patch('expert_backend.services.recommender_service.compute_combined_pair_superposition') as mock_super:
        mock_super.return_value = {
            "betas": [1.0, 1.0],
            "p_or_combined": [50.0, 50.0, 50.0]
        }
        
        # We need to mock _identify_action_elements too
        with patch('expert_backend.services.recommender_service._identify_action_elements', return_value=([0], [])):
            with patch('expert_backend.services.recommender_service.config') as mock_config:
                mock_config.MONITORING_FACTOR_THERMAL_LIMITS = 1.0
                mock_config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD = 0.02
                
                # Mock monitoring parameters
                service._get_monitoring_parameters = MagicMock(return_value=(["LINE1", "LINE2", "LINE3"], ["LINE1", "LINE2", "LINE3"]))
                
                # Mock variant helpers
                service._get_simulation_env = MagicMock(return_value=mock_env)
                service._get_n_variant = MagicMock(return_value="N")
                service._get_n1_variant = MagicMock(return_value="N1")
                mock_env.network_manager.network.get_working_variant_id.return_value = "ORIG"
                
                # Mock environment observations
                obs_n = MagicMock()
                obs_n.rho = np.array([0.3, 0.3, 0.3])
                obs_n.name_line = ["LINE1", "LINE2", "LINE3"]
                obs_n.n_components = 1
                
                # compute_superposition calls get_obs twice (N-1 then N)
                # simulate_manual_action calls get_obs twice (N then N-1)
                mock_env.get_obs.side_effect = [obs_n1, obs_n, obs_n, obs_n1]
                
                # 1. First, check Estimation
                est = service.compute_superposition("act1", "act2", "CONTINGENCY")
                estimated_max_rho = est["max_rho"]
                
                # 2. Then, check Simulation
                # Setup a slightly different result for simulation (to show non-linearity)
                obs_sim = MagicMock()
                obs_sim.rho = np.array([0.55, 0.45, 0.5]) # Slightly different from 0.5
                obs_sim.name_line = ["LINE1", "LINE2", "LINE3"]
                obs_sim.n_components = 1
                
                obs_n1.simulate.return_value = (obs_sim, None, None, {"exception": None})
                
                sim = service.simulate_manual_action("act1+act2", "CONTINGENCY")
                simulated_max_rho = sim["max_rho"]
                
                print(f"Estimated: {estimated_max_rho}, Simulated: {simulated_max_rho}")
                
                # They SHOULD be different if the mock works
                assert estimated_max_rho != simulated_max_rho
                
                # Now check if they are identical in the stored results
                # In App.tsx logic: simulatedData = analysisResult.actions[id]
                # data = analysisResult.combined_actions[id]
                
                # In our service:
                # estimation is returned by compute_superposition
                # simulation is in self._last_result["prioritized_actions"]["act1+act2"]
                
                # Wait! I just realized something.
                # If simulate_manual_action updates prioritized_actions, but the modal
                # still shows the estimation in the "Max Loading (Est.)" column...
                # BOTH should be visible and DIFFERENT.
