# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import json
import pytest
import os
from pathlib import Path
from fastapi.testclient import TestClient
from expert_backend.services.recommender_service import RecommenderService
from expert_op4grid_recommender import config

@pytest.fixture
def service():
    return RecommenderService()

@pytest.fixture
def client():
    from expert_backend.main import app
    return TestClient(app)

@pytest.mark.skipif(not Path("/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_small_grid_test").exists(), reason="Test data not found")
def test_stream_pdf_integration(client, service):
    """
    Real integration test:
    1. Configure with real test data.
    2. Run Step 1.
    3. Run Step 2 and verify streaming events.
    4. Verify PDF actually exists.
    """
    # 1. Configure
    test_env = "/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_small_grid_test"
    test_actions = "/home/marotant/dev/Expert_op4grid_recommender/data/action_space/reduced_model_actions_test_pypowsybl.json"
    
    config_resp = client.post("/api/config", json={
        "network_path": test_env,
        "action_file_path": test_actions,
        "pypowsybl_fast_mode": True
    })
    assert config_resp.status_code == 200
    
    # 2. Run Step 1
    # Find a line that causes overloads (in small grid test, BEZI6 1 -> BEZI6 2 usually does)
    # We'll just try the first available branch
    branches = client.get("/api/branches").json()["branches"]
    target_branch = branches[0]
    
    step1_resp = client.post("/api/run-analysis-step1", json={"disconnected_element": target_branch})
    assert step1_resp.status_code == 200
    step1_data = step1_resp.json()
    
    if not step1_data["can_proceed"]:
        pytest.skip(f"Step 1 could not proceed for {target_branch}: {step1_data['message']}")
        
    overloads = step1_data["lines_overloaded"]
    assert len(overloads) > 0
    
    # 3. Run Step 2
    step2_resp = client.post("/api/run-analysis-step2", json={
        "selected_overloads": overloads[:1],
        "all_overloads": overloads,
        "monitor_deselected": True
    })
    assert step2_resp.status_code == 200
    
    # Parse NDJSON
    events = []
    for line in step2_resp.text.strip().split("\n"):
        if line.strip():
            events.append(json.loads(line))
            
    # Verify sequence
    assert len(events) >= 2
    assert events[0]["type"] == "pdf"
    assert "pdf_url" in events[0]
    assert "pdf_path" in events[0]
    
    # Verify overflow file existence. The backend now requests an HTML
    # viewer (VISUALIZATION_FORMAT="html"); .pdf remains acceptable for
    # environments with older expert_op4grid_recommender installs.
    pdf_path = events[0]["pdf_path"]
    assert pdf_path is not None
    assert os.path.exists(pdf_path)
    assert pdf_path.endswith((".html", ".pdf"))

    # Verify last event is result
    assert events[-1]["type"] == "result"
    assert "actions" in events[-1]

    print(f"Integration test passed! Overflow file generated at: {pdf_path}")
