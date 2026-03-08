import json
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
import os

# Mock the services before importing the app
with patch("expert_backend.main.network_service"), \
     patch("expert_backend.main.recommender_service") as mock_rs:
    from expert_backend.main import app
    client = TestClient(app)

def test_early_pdf_reporting():
    """Verify that 'pdf' event is sent before 'result' event in /api/run-analysis-step2."""
    
    # Define a fake generator for the mocked service
    def fake_step2_gen(*args, **kwargs):
        yield {"type": "pdf", "pdf_path": "/tmp/test_overflow.pdf"}
        # Simulate some delay/work for action discovery
        yield {
            "type": "result",
            "prioritized_actions": {},
            "action_scores": {},
            "lines_overloaded_names": ["LINE_1"],
            "pre_existing_overloads": []
        }

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
    
    print(f"Status Code: {response.status_code}")
    print(f"Response Text: {response.text}")
    assert response.status_code == 200
    
    # Parse NDJSON lines
    lines = [line for line in response.text.strip().split("\n") if line.strip()]
    assert len(lines) == 2
    
    event1 = json.loads(lines[0])
    event2 = json.loads(lines[1])
    
    print(f"Event 1: {event1['type']}")
    print(f"Event 2: {event2['type']}")
    
    assert event1["type"] == "pdf"
    assert "pdf_url" in event1
    assert event2["type"] == "result"
    
    print("Verification successful: PDF sent before results.")

if __name__ == "__main__":
    test_early_pdf_reporting()
