"""Tests for FastAPI API endpoints using TestClient with mocked services."""

import json
import pytest
from unittest.mock import patch, MagicMock, PropertyMock
from fastapi.testclient import TestClient


@pytest.fixture
def mock_services():
    """Patch both singleton services before importing the app."""
    with patch(
        "expert_backend.main.network_service"
    ) as mock_ns, patch(
        "expert_backend.main.recommender_service"
    ) as mock_rs:
        yield mock_ns, mock_rs


@pytest.fixture
def client(mock_services):
    """Create a TestClient with mocked services."""
    from expert_backend.main import app

    return TestClient(app)


class TestGetBranches:
    def test_success(self, client, mock_services):
        mock_ns, _ = mock_services
        mock_ns.get_disconnectable_elements.return_value = [
            "LINE_A",
            "LINE_B",
            "TRAFO_1",
        ]

        response = client.get("/api/branches")
        assert response.status_code == 200
        data = response.json()
        assert data["branches"] == ["LINE_A", "LINE_B", "TRAFO_1"]

    def test_error_returns_400(self, client, mock_services):
        mock_ns, _ = mock_services
        mock_ns.get_disconnectable_elements.side_effect = ValueError("Network not loaded")

        response = client.get("/api/branches")
        assert response.status_code == 400
        assert "Network not loaded" in response.json()["detail"]


class TestGetVoltageLevels:
    def test_success(self, client, mock_services):
        mock_ns, _ = mock_services
        mock_ns.get_voltage_levels.return_value = ["VL1", "VL2", "VL3"]

        response = client.get("/api/voltage-levels")
        assert response.status_code == 200
        assert response.json()["voltage_levels"] == ["VL1", "VL2", "VL3"]


class TestGetNominalVoltages:
    def test_success(self, client, mock_services):
        mock_ns, _ = mock_services
        mock_ns.get_nominal_voltages.return_value = {"VL1": 400.0, "VL2": 225.0}

        response = client.get("/api/nominal-voltages")
        assert response.status_code == 200
        data = response.json()
        assert data["mapping"] == {"VL1": 400.0, "VL2": 225.0}
        assert data["unique_kv"] == [225.0, 400.0]


class TestGetElementVoltageLevels:
    def test_success(self, client, mock_services):
        mock_ns, _ = mock_services
        mock_ns.get_element_voltage_levels.return_value = ["VL1", "VL2"]

        response = client.get("/api/element-voltage-levels?element_id=LINE_A")
        assert response.status_code == 200
        assert response.json()["voltage_level_ids"] == ["VL1", "VL2"]

    def test_missing_param(self, client, mock_services):
        response = client.get("/api/element-voltage-levels")
        assert response.status_code == 422  # Validation error


class TestGetNetworkDiagram:
    def test_success(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.get_network_diagram.return_value = {
            "svg": "<svg>diagram</svg>",
            "metadata": '{"nodes":[],"edges":[]}',
        }

        response = client.get("/api/network-diagram")
        assert response.status_code == 200
        data = response.json()
        assert "svg" in data
        assert "metadata" in data

    def test_error_returns_400(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.get_network_diagram.side_effect = Exception("No network loaded")

        response = client.get("/api/network-diagram")
        assert response.status_code == 400


class TestGetN1Diagram:
    def test_success(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.get_n1_diagram.return_value = {
            "svg": "<svg>n1</svg>",
            "metadata": "{}",
            "lf_converged": True,
            "lf_status": "CONVERGED",
        }

        response = client.post(
            "/api/n1-diagram",
            json={"disconnected_element": "LINE_A"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["lf_converged"] is True

    def test_missing_element(self, client, mock_services):
        response = client.post("/api/n1-diagram", json={})
        assert response.status_code == 422


class TestRunAnalysis:
    def test_streaming_response(self, client, mock_services):
        _, mock_rs = mock_services

        def fake_analysis(element):
            yield {"type": "pdf", "pdf_path": "/tmp/graph.pdf"}
            yield {
                "type": "result",
                "actions": {},
                "action_scores": {},
                "lines_overloaded": [],
                "message": "Analysis completed",
                "dc_fallback": False,
            }

        mock_rs.run_analysis.return_value = fake_analysis("LINE_A")

        response = client.post(
            "/api/run-analysis",
            json={"disconnected_element": "LINE_A"},
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/x-ndjson"

        # Parse NDJSON lines
        lines = [
            line for line in response.text.strip().split("\n") if line.strip()
        ]
        assert len(lines) == 2
        pdf_event = json.loads(lines[0])
        result_event = json.loads(lines[1])
        assert pdf_event["type"] == "pdf"
        assert pdf_event["pdf_url"] == "/results/pdf/graph.pdf"
        assert result_event["type"] == "result"
        assert result_event["message"] == "Analysis completed"

    def test_error_in_analysis(self, client, mock_services):
        _, mock_rs = mock_services

        def failing_analysis(element):
            raise RuntimeError("Analysis exploded")

        mock_rs.run_analysis.side_effect = failing_analysis

        response = client.post(
            "/api/run-analysis",
            json={"disconnected_element": "LINE_A"},
        )
        assert response.status_code == 200  # Streaming always returns 200
        lines = [
            line for line in response.text.strip().split("\n") if line.strip()
        ]
        error_event = json.loads(lines[0])
        assert error_event["type"] == "error"


class TestRunAnalysisStep1:
    def test_success(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.run_analysis_step1.return_value = {
            "lines_overloaded": ["LINE_1", "LINE_2"],
            "message": "Detected 2 overloads.",
            "can_proceed": True,
        }

        response = client.post(
            "/api/run-analysis-step1",
            json={"disconnected_element": "LINE_A"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["lines_overloaded"] == ["LINE_1", "LINE_2"]
        assert data["can_proceed"] is True

    def test_error_in_service(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.run_analysis_step1.side_effect = Exception("Step 1 failed")

        response = client.post(
            "/api/run-analysis-step1",
            json={"disconnected_element": "LINE_A"},
        )
        assert response.status_code == 400
        assert "Step 1 failed" in response.json()["detail"]


class TestRunAnalysisStep2:
    def test_streaming_response_success(self, client, mock_services):
        _, mock_rs = mock_services

        def fake_analysis_step2(selected_overloads, all_overloads=None, monitor_deselected=False):
            yield {"type": "pdf", "pdf_path": "/tmp/graph.pdf"}
            yield {
                "type": "result",
                "actions": {},
                "action_scores": {},
                "lines_overloaded": ["LINE_1"],
                "message": "Analysis completed",
                "dc_fallback": False,
            }

        mock_rs.run_analysis_step2.side_effect = fake_analysis_step2

        response = client.post(
            "/api/run-analysis-step2",
            json={
                "selected_overloads": ["LINE_1"],
                "all_overloads": ["LINE_1", "LINE_2"],
                "monitor_deselected": True,
            },
        )
        assert response.status_code == 200
        assert response.headers["content-type"] == "application/x-ndjson"

        # Parse NDJSON lines
        lines = [
            line for line in response.text.strip().split("\n") if line.strip()
        ]
        assert len(lines) == 2
        pdf_event = json.loads(lines[0])
        result_event = json.loads(lines[1])
        
        assert pdf_event["type"] == "pdf"
        assert pdf_event["pdf_url"] == "/results/pdf/graph.pdf"
        assert result_event["type"] == "result"
        assert result_event["lines_overloaded"] == ["LINE_1"]

        # Verify service call parameters
        mock_rs.run_analysis_step2.assert_called_once_with(
            ["LINE_1"],
            all_overloads=["LINE_1", "LINE_2"],
            monitor_deselected=True
        )

    def test_error_in_streaming(self, client, mock_services):
        _, mock_rs = mock_services

        def failing_analysis_step2(*args, **kwargs):
            raise RuntimeError("Step 2 exploded")

        mock_rs.run_analysis_step2.side_effect = failing_analysis_step2

        response = client.post(
            "/api/run-analysis-step2",
            json={"selected_overloads": ["LINE_1"]},
        )
        assert response.status_code == 200  # Streaming response
        lines = [
            line for line in response.text.strip().split("\n") if line.strip()
        ]
        error_event = json.loads(lines[0])
        assert error_event["type"] == "error"
        assert "Step 2 exploded" in error_event["message"]


class TestActionVariantDiagram:
    def test_success(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.get_action_variant_diagram.return_value = {
            "svg": "<svg>action</svg>",
            "metadata": "{}",
            "action_id": "action_1",
        }

        response = client.post(
            "/api/action-variant-diagram",
            json={"action_id": "action_1"},
        )
        assert response.status_code == 200
        assert response.json()["action_id"] == "action_1"

    def test_with_mode(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.get_action_variant_diagram.return_value = {
            "svg": "<svg/>",
            "metadata": "{}",
        }

        response = client.post(
            "/api/action-variant-diagram",
            json={"action_id": "action_1", "mode": "delta"},
        )
        assert response.status_code == 200
        mock_rs.get_action_variant_diagram.assert_called_once_with(
            "action_1", mode="delta"
        )


class TestFocusedDiagram:
    def test_with_disconnected_element(self, client, mock_services):
        mock_ns, mock_rs = mock_services
        mock_ns.get_element_voltage_levels.return_value = ["VL1"]
        mock_rs.get_n1_diagram.return_value = {
            "svg": "<svg>focused</svg>",
            "metadata": "{}",
        }

        response = client.post(
            "/api/focused-diagram",
            json={
                "element_id": "LINE_A",
                "depth": 2,
                "disconnected_element": "LINE_B",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["voltage_level_ids"] == ["VL1"]
        assert data["depth"] == 2

    def test_without_disconnected_element(self, client, mock_services):
        mock_ns, mock_rs = mock_services
        mock_ns.get_element_voltage_levels.return_value = ["VL1", "VL2"]
        mock_rs.get_network_diagram.return_value = {
            "svg": "<svg>base</svg>",
            "metadata": "{}",
        }

        response = client.post(
            "/api/focused-diagram",
            json={"element_id": "LINE_A"},
        )
        assert response.status_code == 200

    def test_no_voltage_levels_returns_404(self, client, mock_services):
        mock_ns, _ = mock_services
        mock_ns.get_element_voltage_levels.return_value = []

        response = client.post(
            "/api/focused-diagram",
            json={"element_id": "NONEXISTENT"},
        )
        assert response.status_code == 404


class TestGetActions:
    def test_success(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.get_all_action_ids.return_value = [
            {"id": "action_1", "description": "Test action", "type": "line_disconnection"},
        ]

        response = client.get("/api/actions")
        assert response.status_code == 200
        data = response.json()
        assert len(data["actions"]) == 1
        assert data["actions"][0]["id"] == "action_1"


class TestSimulateManualAction:
    def test_success(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.simulate_manual_action.return_value = {
            "action_id": "action_1",
            "description_unitaire": "Open line X",
            "rho_before": [0.95],
            "rho_after": [0.80],
            "max_rho": 0.80,
            "max_rho_line": "LINE_A",
            "is_rho_reduction": True,
            "lines_overloaded": ["LINE_A"],
        }

        response = client.post(
            "/api/simulate-manual-action",
            json={
                "action_id": "action_1",
                "disconnected_element": "LINE_B",
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["is_rho_reduction"] is True
        assert data["max_rho"] == 0.80

    def test_missing_fields(self, client, mock_services):
        response = client.post(
            "/api/simulate-manual-action",
            json={"action_id": "action_1"},
        )
        assert response.status_code == 422


class TestPydanticModels:
    """Test request model validation."""

    def test_config_request_defaults(self, client, mock_services):
        """ConfigRequest should use default values for optional fields."""
        mock_ns, mock_rs = mock_services
        mock_ns.get_disconnectable_elements.return_value = []

        # Mock the import of expert_op4grid_recommender.config
        with patch("expert_backend.main.network_service", mock_ns):
            # Just test the model itself
            from expert_backend.main import ConfigRequest

            config = ConfigRequest(
                network_path="/test/path",
                action_file_path="/test/actions.json",
            )
            assert config.min_line_reconnections == 2.0
            assert config.min_close_coupling == 3.0
            assert config.min_open_coupling == 2.0
            assert config.min_line_disconnections == 3.0
            assert config.n_prioritized_actions == 10
            assert config.monitoring_factor == 0.95
            assert config.pre_existing_overload_threshold == 0.02
            assert config.ignore_reconnections is False
            assert config.pypowsybl_fast_mode is True
            assert config.lines_monitoring_path is None

    def test_analysis_request_validation(self):
        from expert_backend.main import AnalysisRequest

        req = AnalysisRequest(disconnected_element="LINE_A")
        assert req.disconnected_element == "LINE_A"

    def test_focused_diagram_request_defaults(self):
        from expert_backend.main import FocusedDiagramRequest

        req = FocusedDiagramRequest(element_id="LINE_A")
        assert req.depth == 1
        assert req.disconnected_element is None

    def test_action_variant_request_defaults(self):
        from expert_backend.main import ActionVariantRequest

        req = ActionVariantRequest(action_id="act_1")
        assert req.mode == "network"


class TestRestoreAnalysisContext:
    """Tests for POST /api/restore-analysis-context endpoint."""

    def test_restore_with_all_fields(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.restore_analysis_context.return_value = None

        response = client.post(
            "/api/restore-analysis-context",
            json={
                "lines_we_care_about": ["LINE_A", "LINE_B", "LINE_C"],
                "disconnected_element": "LINE_X",
                "lines_overloaded": ["LINE_A"],
                "computed_pairs": {"LINE_A+LINE_B": {"max_rho": 0.5}},
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["lines_we_care_about_count"] == 3
        assert data["computed_pairs_count"] == 1

        mock_rs.restore_analysis_context.assert_called_once_with(
            lines_we_care_about=["LINE_A", "LINE_B", "LINE_C"],
            disconnected_element="LINE_X",
            lines_overloaded=["LINE_A"],
            computed_pairs={"LINE_A+LINE_B": {"max_rho": 0.5}},
        )

    def test_restore_with_minimal_fields(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.restore_analysis_context.return_value = None

        response = client.post(
            "/api/restore-analysis-context",
            json={
                "lines_we_care_about": ["LINE_A"],
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "success"
        assert data["lines_we_care_about_count"] == 1
        assert data["computed_pairs_count"] == 0

    def test_restore_with_null_lines(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.restore_analysis_context.return_value = None

        response = client.post(
            "/api/restore-analysis-context",
            json={
                "lines_we_care_about": None,
            },
        )
        assert response.status_code == 200
        data = response.json()
        assert data["lines_we_care_about_count"] == 0

    def test_restore_error_returns_400(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.restore_analysis_context.side_effect = Exception("Restore failed")

        response = client.post(
            "/api/restore-analysis-context",
            json={
                "lines_we_care_about": ["LINE_A"],
            },
        )
        assert response.status_code == 400
        assert "Restore failed" in response.json()["detail"]


class TestRestoreAnalysisContextModel:
    """Tests for the RestoreAnalysisContextRequest Pydantic model."""

    def test_defaults(self):
        from expert_backend.main import RestoreAnalysisContextRequest

        req = RestoreAnalysisContextRequest()
        assert req.lines_we_care_about is None
        assert req.disconnected_element is None
        assert req.lines_overloaded is None
        assert req.computed_pairs is None

    def test_full_model(self):
        from expert_backend.main import RestoreAnalysisContextRequest

        req = RestoreAnalysisContextRequest(
            lines_we_care_about=["L1", "L2"],
            disconnected_element="LINE_X",
            lines_overloaded=["L1"],
            computed_pairs={"pair1": {"betas": [0.1, 0.2]}},
        )
        assert req.lines_we_care_about == ["L1", "L2"]
        assert req.disconnected_element == "LINE_X"
        assert req.lines_overloaded == ["L1"]
        assert req.computed_pairs == {"pair1": {"betas": [0.1, 0.2]}}


class TestRunAnalysisLinesWeCareAbout:
    """Tests that analysis result events include lines_we_care_about."""

    def test_run_analysis_includes_lines_we_care_about(self, client, mock_services):
        _, mock_rs = mock_services

        def fake_analysis(element):
            yield {"type": "pdf", "pdf_path": "/tmp/graph.pdf"}
            yield {
                "type": "result",
                "actions": {},
                "action_scores": {},
                "lines_overloaded": ["LINE_A"],
                "lines_we_care_about": ["LINE_A", "LINE_B", "LINE_C"],
                "message": "Analysis completed",
                "dc_fallback": False,
            }

        mock_rs.run_analysis.return_value = fake_analysis("LINE_X")

        response = client.post(
            "/api/run-analysis",
            json={"disconnected_element": "LINE_X"},
        )
        assert response.status_code == 200

        lines = [line for line in response.text.strip().split("\n") if line.strip()]
        result_event = json.loads(lines[1])
        assert result_event["type"] == "result"
        assert result_event["lines_we_care_about"] == ["LINE_A", "LINE_B", "LINE_C"]

    def test_run_analysis_null_lines_we_care_about(self, client, mock_services):
        _, mock_rs = mock_services

        def fake_analysis(element):
            yield {
                "type": "result",
                "actions": {},
                "action_scores": {},
                "lines_overloaded": [],
                "lines_we_care_about": None,
                "message": "Done",
                "dc_fallback": False,
            }

        mock_rs.run_analysis.return_value = fake_analysis("LINE_X")

        response = client.post(
            "/api/run-analysis",
            json={"disconnected_element": "LINE_X"},
        )
        lines = [line for line in response.text.strip().split("\n") if line.strip()]
        result_event = json.loads(lines[0])
        assert result_event["lines_we_care_about"] is None

    def test_step2_includes_lines_we_care_about(self, client, mock_services):
        _, mock_rs = mock_services

        def fake_step2(selected_overloads, all_overloads=None, monitor_deselected=False):
            yield {
                "type": "result",
                "actions": {},
                "action_scores": {},
                "lines_overloaded": ["LINE_1"],
                "lines_we_care_about": ["LINE_1", "LINE_2"],
                "combined_actions": {},
                "pre_existing_overloads": [],
                "message": "Done",
                "dc_fallback": False,
            }

        mock_rs.run_analysis_step2.side_effect = fake_step2

        response = client.post(
            "/api/run-analysis-step2",
            json={
                "selected_overloads": ["LINE_1"],
                "all_overloads": ["LINE_1", "LINE_2"],
            },
        )
        lines = [line for line in response.text.strip().split("\n") if line.strip()]
        result_event = json.loads(lines[0])
        assert result_event["lines_we_care_about"] == ["LINE_1", "LINE_2"]


class TestSimulateManualActionWithContext:
    """Tests that simulate_manual_action passes lines_overloaded to the service."""

    def test_passes_lines_overloaded(self, client, mock_services):
        _, mock_rs = mock_services
        mock_rs.simulate_manual_action.return_value = {
            "action_id": "action_1",
            "description_unitaire": "Open line X",
            "rho_before": [0.95],
            "rho_after": [0.70],
            "max_rho": 0.70,
            "max_rho_line": "LINE_A",
            "is_rho_reduction": True,
            "lines_overloaded": ["LINE_A"],
        }

        response = client.post(
            "/api/simulate-manual-action",
            json={
                "action_id": "action_1",
                "disconnected_element": "LINE_B",
                "lines_overloaded": ["LINE_A", "LINE_C"],
            },
        )
        assert response.status_code == 200
        # Verify lines_overloaded was passed through to the service
        call_kwargs = mock_rs.simulate_manual_action.call_args
        assert call_kwargs[1].get("lines_overloaded") == ["LINE_A", "LINE_C"] or \
               (len(call_kwargs[0]) >= 4 and call_kwargs[0][3] == ["LINE_A", "LINE_C"])
