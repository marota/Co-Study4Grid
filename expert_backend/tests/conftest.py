"""Shared fixtures for backend tests.

The domain-specific packages (pypowsybl, expert_op4grid_recommender) are not
available in CI/test environments.  We install lightweight mocks into
``sys.modules`` *before* any production module is imported so that collection
and import succeed without the real packages.

When the real packages *are* installed (e.g. local development), we prefer
them over mocks so that integration-style tests (TestRecommenderSimulationRealData)
can run against the real implementations.
"""

import sys
import importlib
from unittest.mock import MagicMock

# ---------------------------------------------------------------------------
# Mock heavy domain packages that are not available in test environments.
# Try to import each package first; only install a mock when the real package
# cannot be found.
# ---------------------------------------------------------------------------
_MOCK_MODULES = [
    "pypowsybl",
    "pypowsybl.network",
    "pypowsybl.loadflow",
    "pypowsybl_jupyter",
    "pypowsybl_jupyter.util",
    "expert_op4grid_recommender",
    "expert_op4grid_recommender.config",
    "expert_op4grid_recommender.main",
    "expert_op4grid_recommender.data_loader",
    "expert_op4grid_recommender.utils",
    "expert_op4grid_recommender.utils.make_env_utils",
    "expert_op4grid_recommender.action_evaluation",
    "expert_op4grid_recommender.action_evaluation.classifier",
    "expert_op4grid_recommender.environment_pypowsybl",
    "expert_op4grid_recommender.utils.simulation_pypowsybl",
    "expert_op4grid_recommender.environment",
    "expert_op4grid_recommender.pypowsybl_backend",
    "expert_op4grid_recommender.pypowsybl_backend.simulation_env",
]

for mod_name in _MOCK_MODULES:
    if mod_name not in sys.modules:
        try:
            importlib.import_module(mod_name)
        except (ImportError, ModuleNotFoundError):
            sys.modules[mod_name] = MagicMock()

# ---------------------------------------------------------------------------
# Now it is safe to import production code
# ---------------------------------------------------------------------------
import pytest
import pandas as pd
import numpy as np


@pytest.fixture
def mock_network():
    """Create a mock pypowsybl network with realistic data."""
    network = MagicMock()
    network.id = "test_network"

    lines_data = pd.DataFrame(
        {
            "voltage_level1_id": ["VL1", "VL1", "VL2"],
            "voltage_level2_id": ["VL2", "VL3", "VL3"],
            "i1": [100.0, 200.0, 150.0],
            "i2": [95.0, 190.0, 148.0],
            "p1": [50.0, 80.0, 60.0],
            "p2": [-48.0, -78.0, -58.0],
        },
        index=["LINE_A", "LINE_B", "LINE_C"],
    )

    transformers_data = pd.DataFrame(
        {
            "voltage_level1_id": ["VL1", "VL3"],
            "voltage_level2_id": ["VL4", "VL5"],
            "i1": [300.0, 250.0],
            "i2": [290.0, 245.0],
            "p1": [120.0, 100.0],
            "p2": [-118.0, -98.0],
        },
        index=["TRAFO_1", "TRAFO_2"],
    )

    voltage_levels_data = pd.DataFrame(
        {"nominal_v": [400.0, 225.0, 90.0, 63.0, 20.0]},
        index=["VL1", "VL2", "VL3", "VL4", "VL5"],
    )

    network.get_lines.return_value = lines_data
    network.get_2_windings_transformers.return_value = transformers_data
    network.get_voltage_levels.return_value = voltage_levels_data

    return network


@pytest.fixture
def mock_network_service(mock_network):
    """Create a NetworkService with a pre-loaded mock network."""
    from expert_backend.services.network_service import NetworkService

    service = NetworkService()
    service.network = mock_network
    return service


@pytest.fixture
def recommender_service_instance():
    """Create a fresh RecommenderService instance."""
    from expert_backend.services.recommender_service import RecommenderService

    return RecommenderService()
