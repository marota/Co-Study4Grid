# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import unittest
from unittest.mock import MagicMock, patch
import pandas as pd
import json
from pathlib import Path

# Add the project path to sys.path
import sys
project_root = "/Users/antoine/Dev/Co-Study4Grid"
if project_root not in sys.path:
    sys.path.append(project_root)

# Mock config BEFORE importing
mock_config = MagicMock()
mock_config.LAYOUT_FILE_PATH = Path("/tmp/grid_layout.json")
sys.modules["expert_op4grid_recommender.config"] = mock_config

from expert_backend.services.recommender_service import RecommenderService

class TestRecommenderRegressions(unittest.TestCase):
    
    def setUp(self):
        self.service = RecommenderService()

    def test_load_layout_exists(self):
        """Test that _load_layout is present and handles missing file."""
        self.assertTrue(hasattr(self.service, '_load_layout'))
        # With non-existent file path
        mock_config.LAYOUT_FILE_PATH = Path("/non/existent/path")
        layout = self.service._load_layout()
        self.assertIsNone(layout)

    def test_default_nad_parameters_exists(self):
        """Test that _default_nad_parameters is present."""
        self.assertTrue(hasattr(self.service, '_default_nad_parameters'))
        with patch('pypowsybl.network.NadParameters', return_value=MagicMock()) as mock_nad:
            params = self.service._default_nad_parameters()
            self.assertIsNotNone(params)
            mock_nad.assert_called_once()

    def test_generate_diagram_parameters(self):
        """Test that _generate_diagram passes parameters correctly."""
        mock_network = MagicMock()
        
        # Patch dependencies
        with patch.object(self.service, '_load_layout', return_value=None), \
             patch.object(self.service, '_default_nad_parameters', return_value=MagicMock()), \
             patch('pypowsybl_jupyter.util._get_svg_string', return_value="<svg>"), \
             patch('pypowsybl_jupyter.util._get_svg_metadata', return_value={}):
            
            # Case 1: Minimal call
            self.service._generate_diagram(mock_network)
            _, kwargs = mock_network.get_network_area_diagram.call_args
            self.assertIn('nad_parameters', kwargs)
            self.assertNotIn('voltage_level_ids', kwargs)

            # Case 2: With VL filtering
            self.service._generate_diagram(mock_network, voltage_level_ids=["VL1"], depth=2)
            _, kwargs = mock_network.get_network_area_diagram.call_args
            self.assertEqual(kwargs['voltage_level_ids'], ["VL1"])
            self.assertEqual(kwargs['depth'], 2)

    def test_diagram_getters_signatures(self):
        """Test that getters have the correct signatures to prevent regression."""
        import inspect
        
        # get_network_diagram(self, voltage_level_ids=None, depth=0)
        sig = inspect.signature(self.service.get_network_diagram)
        self.assertIn('voltage_level_ids', sig.parameters)
        self.assertIn('depth', sig.parameters)

        # get_n1_diagram(self, disconnected_element: str, voltage_level_ids=None, depth=0)
        sig = inspect.signature(self.service.get_n1_diagram)
        self.assertIn('disconnected_element', sig.parameters)
        self.assertIn('voltage_level_ids', sig.parameters)
        self.assertIn('depth', sig.parameters)

if __name__ == '__main__':
    unittest.main()
