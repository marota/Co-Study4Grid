# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
import os

# Define a fake generator for the mocked service
def fake_step2_gen(*args, **kwargs):
    yield {"type": "pdf", "pdf_path": "/tmp/test_overflow.pdf"}
    yield {
        "type": "result",
        "actions": {},
        "action_scores": {},
        "lines_overloaded": ["LINE_1"],
        "pre_existing_overloads": [],
        "message": "Analysis completed",
        "dc_fallback": False
    }

def test_early_pdf_reporting():
    """Verify that 'pdf' event is sent before 'result' event in /api/run-analysis-step2."""
    
    # Mock the recommender_service in main.py
    with patch("expert_backend.main.recommender_service") as mock_rs:
        from expert_backend.main import app
        client = TestClient(app)
        
        mock_rs.run_analysis_step2.side_effect = fake_step2_gen

        # Call the endpoint
        response = client.post(
            "/api/run-analysis-step2",
            json={
                "selected_overloads": ["LINE_1"],
                "all_overloads": ["LINE_1", "LINE_2"],
                "monitor_deselected": True,
            }
        )
        
        assert response.status_code == 200
        
        # Parse NDJSON lines
        lines = [line for line in response.text.strip().split("\n") if line.strip()]
        
        # If it failed with 1 line, let's see why
        if len(lines) != 2:
            print(f"Response content: {response.text}")
            
        assert len(lines) == 2
        
        event1 = json.loads(lines[0])
        event2 = json.loads(lines[1])
        
        assert event1["type"] == "pdf"
        assert "pdf_url" in event1
        assert event2["type"] == "result"


def fake_step2_gen_html(*args, **kwargs):
    """Variant of the step-2 generator that emits an .html overflow file
    — reflects the default VISUALIZATION_FORMAT after the HTML switch."""
    yield {"type": "pdf", "pdf_path": "/tmp/test_overflow.html"}
    yield {
        "type": "result",
        "actions": {},
        "action_scores": {},
        "lines_overloaded": ["LINE_1"],
        "pre_existing_overloads": [],
        "message": "Analysis completed",
        "dc_fallback": False,
    }


def test_early_reporting_with_html_file():
    """pdf_url wrapping must work for .html overflow files too — the
    event field names stay the same for session-schema compatibility,
    only the served file type changes."""
    with patch("expert_backend.main.recommender_service") as mock_rs:
        from expert_backend.main import app
        client = TestClient(app)

        mock_rs.run_analysis_step2.side_effect = fake_step2_gen_html

        response = client.post(
            "/api/run-analysis-step2",
            json={
                "selected_overloads": ["LINE_1"],
                "all_overloads": ["LINE_1", "LINE_2"],
                "monitor_deselected": True,
            },
        )

        assert response.status_code == 200
        lines = [ln for ln in response.text.strip().split("\n") if ln.strip()]
        event1 = json.loads(lines[0])
        assert event1["type"] == "pdf"
        assert event1["pdf_url"].endswith(".html")
        assert event1["pdf_url"] == "/results/pdf/test_overflow.html"
