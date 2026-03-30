# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import unittest
import os

class TestUIRegressions(unittest.TestCase):
    
    def test_critical_ui_strings(self):
        """Verify that standalone_interface.html contains fixed regressions."""
        # Use relative path from this test file
        test_dir = os.path.dirname(os.path.abspath(__file__))
        ui_file = os.path.abspath(os.path.join(test_dir, "../../standalone_interface.html"))
        self.assertTrue(os.path.exists(ui_file), f"File not found: {ui_file}")
        
        with open(ui_file, 'r') as f:
            content = f.read()
            
        # 1. Flow deltas check
        self.assertIn('!flowDeltas && !assetDeltas', content, "Regression: check for assetDeltas missing in standalone_interface.html")
        
        # 2. Action highlight class
        self.assertIn('sld-highlight-action', content, "Regression: highlight class 'sld-highlight-action' missing in standalone_interface.html")
        
        # 3. Placeholder text
        self.assertIn('Select an action card to view its network variant', content, "Regression: placeholder text 'Select an action card to view its network variant' missing in standalone_interface.html")

if __name__ == '__main__':
    unittest.main()
