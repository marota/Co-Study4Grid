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

@pytest.fixture
def mock_rs():
    """Mock the recommender service."""
    with patch("expert_backend.main.recommender_service") as mock:
        yield mock

@pytest.fixture
def client(mock_rs):
    """Create a test client with mocked service."""
    from expert_backend.main import app
    return TestClient(app)

def test_run_analysis_step1_success(client, mock_rs):
    """Verify Step 1 endpoint returns overloads."""
    mock_rs.run_analysis_step1.return_value = {
        "lines_overloaded": ["LINE_1", "LINE_2"],
        "message": "Detected 2 overloads.",
        "can_proceed": True
    }
    
    response = client.post("/api/run-analysis-step1", json={"disconnected_element": "GEN_1"})
    assert response.status_code == 200
    data = response.json()
    assert data["lines_overloaded"] == ["LINE_1", "LINE_2"]
    assert data["can_proceed"] is True
    mock_rs.run_analysis_step1.assert_called_with("GEN_1")

def test_run_analysis_step2_success(client, mock_rs):
    """Verify Step 2 endpoint streams results and respects selection."""
    def fake_step2(overloads, **kwargs):
        yield {"type": "pdf", "pdf_path": "/tmp/graph.pdf"}
        yield {"type": "result", "actions": {}, "action_scores": {}, "lines_overloaded": overloads}

    mock_rs.run_analysis_step2.side_effect = fake_step2
    
    response = client.post("/api/run-analysis-step2", json={
        "selected_overloads": ["LINE_1"],
        "all_overloads": ["LINE_1", "LINE_2"],
        "monitor_deselected": True
    })
    assert response.status_code == 200
    
    lines = [line for line in response.text.strip().split("\n") if line.strip()]
    assert len(lines) == 2
    pdf_event = json.loads(lines[0])
    result_event = json.loads(lines[1])
    
    assert pdf_event["type"] == "pdf"
    assert pdf_event["pdf_url"] == "/results/pdf/graph.pdf"
    assert result_event["type"] == "result"
    assert result_event["lines_overloaded"] == ["LINE_1"]
    mock_rs.run_analysis_step2.assert_called_with(
        ["LINE_1"],
        all_overloads=["LINE_1", "LINE_2"],
        monitor_deselected=True
    )

def test_run_analysis_step1_error(client, mock_rs):
    """Verify Step 1 handles errors."""
    mock_rs.run_analysis_step1.side_effect = Exception("Step 1 failed")
    
    response = client.post("/api/run-analysis-step1", json={"disconnected_element": "GEN_1"})
    assert response.status_code == 400
    assert "Step 1 failed" in response.json()["detail"]
