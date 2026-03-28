# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import pytest
from unittest.mock import MagicMock, patch
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config

class TestMonitoringConsistency:
    @patch("expert_op4grid_recommender.config")
    def test_get_monitoring_parameters_prioritizes_context(self, mock_config):
        # Setup
        service = RecommenderService()
        mock_obs = MagicMock()
        mock_obs.name_line = ["L1", "L2", "L3"]
        
        # Mock network component and limits
        mock_grid = MagicMock()
        mock_obs._network_manager.network = mock_grid
        import pandas as pd
        mock_grid.get_operational_limits.return_value = pd.DataFrame({
            'type': ['CURRENT', 'CURRENT'],
            'acceptable_duration': [-1, 60],
            'element_id': ['L1', 'L2']
        })
        
        # 1. Test with analysis context (user deselected L2)
        service._analysis_context = {
            "lines_we_care_about": ["L1", "L3"]
        }
        
        lines, limits = service._get_monitoring_parameters(mock_obs)
        
        assert lines == ["L1", "L3"]
        assert "L1" in limits
        assert "L2" not in limits # L2 has duration 60, not -1
        
    @patch("expert_backend.services.recommender_service.config")
    def test_get_monitoring_parameters_fallback_to_config(self, mock_config):
        service = RecommenderService()
        service._analysis_context = None # No context
        
        mock_config.IGNORE_LINES_MONITORING = False
        mock_config.LINES_MONITORING_FILE = "some_file.csv"
        
        mock_obs = MagicMock()
        mock_obs.name_line = ["L1", "L2", "L3"]
        
        # Mock limits to avoid errors
        mock_grid = MagicMock()
        mock_obs._network_manager.network = mock_grid
        import pandas as pd
        mock_grid.get_operational_limits.return_value = pd.DataFrame()

        with patch("expert_backend.services.recommender_service.load_interesting_lines") as mock_load:
            mock_load.return_value = ["L2"]
            lines, _ = service._get_monitoring_parameters(mock_obs)
            assert lines == ["L2"]

    @patch("expert_backend.services.recommender_service._identify_action_elements")
    @patch("expert_backend.services.recommender_service.compute_combined_pair_superposition")
    def test_compute_superposition_uses_monitoring_parameters(self, mock_superposition, mock_identify):
        service = RecommenderService()
        mock_obs = MagicMock()
        mock_obs.name_line = ["L1", "L2"]
        mock_obs.rho = [0.8, 0.9] # L2 is overloaded if limit is 0.95 and factor is 0.95? Wait.
        
        # Setup analysis context to only care about L1
        service._analysis_context = {
             "lines_we_care_about": ["L1"],
             "lines_overloaded_ids": [0, 1]
        }
        
        # Mock _get_monitoring_parameters to return only L1
        service._get_monitoring_parameters = MagicMock(return_value=(["L1"], {"L1"}))
        
        # Setup _last_result with the mock actions to avoid simulation calls
        mock_act1 = MagicMock()
        mock_act2 = MagicMock()
        service._last_result = {
            "prioritized_actions": {
                "act1": {"action": mock_act1, "observation": MagicMock()},
                "act2": {"action": mock_act2, "observation": MagicMock()}
            }
        }
        
        # Mock other dependencies for compute_superposition
        service._enrich_actions = MagicMock(return_value={})
        service._dict_action = {}
        service._get_simulation_env = MagicMock()
        service._get_n1_variant = MagicMock(return_value="v1")
        service._get_n_variant = MagicMock(return_value="v0")
        mock_identify.return_value = ([1], [1])
        
        # Mock result of superposition
        mock_superposition.return_value = {
            "betas": [1.0, 1.0],
            "p_or_combined": [100.0, 200.0]
        }
        
        # Call compute_superposition
        try:
            service.compute_superposition("act1", "act2", "contingency")
        except Exception as e:
            # We don't care if it fails later, we want to see if monitoring params were requested
            pass
            
        service._get_monitoring_parameters.assert_called_once()
