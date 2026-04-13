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
import numpy as np

class TestRecommenderNonConvergence:
    def setup_method(self):
        self.service = RecommenderService()
        self.service._last_result = {"prioritized_actions": {}}
        # Create a dummy observation class that mimics the expected structure
        class MockObs:
            def __init__(self, converged=True, exception=None):
                self._last_info = {"exception": exception}
                self.rho = np.array([0.1])
                self.name_line = ["LINE_1"]
                self.converged = converged
                self._variant_id = "some_variant"
                self._network_manager = MagicMock()
            
            def simulate(self, *args, **kwargs):
                return MagicMock(), None, None, self._last_info

        self.MockObs = MockObs

    def test_enrich_actions_captures_non_convergence_from_obs(self):
        """Verify that _enrich_actions extracts non-convergence from the observation's _last_info."""
        mock_obs = self.MockObs(converged=False, exception="Matrix is singular")
        
        prioritized = {
            "action_1": {
                "observation": mock_obs,
                "description_unitaire": "Test Action",
                "rho_before": [1.0],
                "rho_after": [1.1],
                "max_rho": 1.1,
                "max_rho_line": "LINE_1"
            }
        }
        
        enriched = self.service._enrich_actions(prioritized)
        assert enriched["action_1"]["non_convergence"] == "Matrix is singular"

    def test_enrich_actions_handles_list_exception(self):
        """Verify that _enrich_actions handles list of exceptions."""
        mock_obs = self.MockObs(converged=False, exception=["Error 1", "Error 2"])

        prioritized = {
            "action_1": {
                "observation": mock_obs,
                "description_unitaire": "Test Action"
            }
        }

        enriched = self.service._enrich_actions(prioritized)
        assert enriched["action_1"]["non_convergence"] == "Error 1; Error 2"

    def test_enrich_actions_computes_lines_overloaded_after_when_missing(self):
        """When the discovery engine does not populate lines_overloaded_after
        on an action, _enrich_actions must compute it from rho_after (raw,
        unscaled) + the N-1 overloaded line list, so the frontend's Action
        tab overload highlights stay visible for persistent and new
        overloads."""
        config.MONITORING_FACTOR_THERMAL_LIMITS = 0.95

        prioritized = {
            "action_still_overloaded": {
                # N-1 overloads: LINE_A, LINE_B. After this action rho_after
                # values are [0.8, 1.10] — LINE_A is solved but LINE_B
                # stays overloaded.
                "rho_before": [1.05, 1.20],
                "rho_after": [0.80, 1.10],
                "max_rho": 1.10,
                "max_rho_line": "LINE_B",
                "is_rho_reduction": True,
                "description_unitaire": "still overloaded",
            },
            "action_new_overload": {
                # Both N-1 overloads are solved (rho_after < 1.0), but
                # the action creates a NEW overload on LINE_C (captured
                # as max_rho_line with max_rho >= 1.0).
                "rho_before": [1.05, 1.20],
                "rho_after": [0.85, 0.90],
                "max_rho": 1.30,
                "max_rho_line": "LINE_C",
                "is_rho_reduction": True,
                "description_unitaire": "new overload elsewhere",
            },
            "action_solves_all": {
                # Every overload is fully resolved. lines_overloaded_after
                # must stay empty.
                "rho_before": [1.05, 1.20],
                "rho_after": [0.70, 0.75],
                "max_rho": 0.75,
                "max_rho_line": "LINE_A",
                "is_rho_reduction": True,
                "description_unitaire": "solves all",
            },
        }

        enriched = self.service._enrich_actions(
            prioritized,
            lines_overloaded_names=["LINE_A", "LINE_B"],
        )

        assert enriched["action_still_overloaded"]["lines_overloaded_after"] == ["LINE_B"]
        # New overload on LINE_C must be captured even though it was not
        # in the original N-1 overload list.
        assert enriched["action_new_overload"]["lines_overloaded_after"] == ["LINE_C"]
        # An action that solves every overload must keep the list empty.
        assert enriched["action_solves_all"]["lines_overloaded_after"] == []

    def test_enrich_actions_preserves_existing_lines_overloaded_after(self):
        """When the discovery engine already provides lines_overloaded_after
        (e.g. simulated actions coming through simulate_manual_action that
        were merged into _last_result), the enrichment must not overwrite
        it with a recomputed list — the library's value is authoritative."""
        config.MONITORING_FACTOR_THERMAL_LIMITS = 0.95

        prioritized = {
            "action_1": {
                "rho_before": [1.05],
                "rho_after": [1.10],
                "max_rho": 1.10,
                "max_rho_line": "LINE_A",
                "is_rho_reduction": False,
                "description_unitaire": "already enriched",
                "lines_overloaded_after": ["LINE_ALREADY_LISTED"],
            },
        }

        enriched = self.service._enrich_actions(
            prioritized,
            lines_overloaded_names=["LINE_A"],
        )
        assert enriched["action_1"]["lines_overloaded_after"] == ["LINE_ALREADY_LISTED"]

    def test_enrich_actions_without_lines_overloaded_names_defaults_to_max_rho_line_only(self):
        """Back-compat: callers that do not pass lines_overloaded_names
        (e.g. legacy call sites) should still get a non-empty
        lines_overloaded_after when the action creates/keeps an overload,
        falling back to max_rho_line when max_rho >= 1.0."""
        config.MONITORING_FACTOR_THERMAL_LIMITS = 0.95

        prioritized = {
            "action_1": {
                "rho_before": [1.10],
                "rho_after": [1.05],
                "max_rho": 1.05,
                "max_rho_line": "LINE_MAX",
                "is_rho_reduction": True,
                "description_unitaire": "no N-1 names passed",
            },
        }

        enriched = self.service._enrich_actions(prioritized)
        assert enriched["action_1"]["lines_overloaded_after"] == ["LINE_MAX"]

    @patch("expert_backend.services.recommender_service.config")
    def test_simulate_manual_action_returns_non_convergence(self, mock_config):
        """Verify that simulate_manual_action captures and returns non-convergence info."""
        mock_config.MONITORING_FACTOR_THERMAL_LIMITS = 0.95
        mock_config.PYPOWSYBL_FAST_MODE = False
        
        mock_env = MagicMock()
        self.service._simulation_env = mock_env
        
        # Mocking the network variant logic
        mock_nm = mock_env.network_manager
        mock_n = mock_nm.network
        mock_n.get_working_variant_id.return_value = "base"
        
        mock_obs_n1 = self.MockObs(converged=True)
        mock_info = {"exception": "Load flow diverged"}
        
        # Define a mock action that has the expected attributes
        mock_action = MagicMock()
        for field in ("lines_ex_bus", "lines_or_bus", "gens_bus", "loads_bus"):
            setattr(mock_action, field, {})

        with patch.object(self.service, "_get_base_network"), \
             patch.object(self.service, "_get_n_variant"), \
             patch.object(self.service, "_get_n1_variant"), \
             patch.object(mock_env, "get_obs", side_effect=[MagicMock(), mock_obs_n1]), \
             patch.object(mock_obs_n1, "simulate", return_value=(MagicMock(), None, None, mock_info)), \
             patch.object(mock_env, "action_space", return_value=mock_action), \
             patch.object(self.service, "_get_monitoring_parameters", return_value=(set(["LINE_1"]), set(["LINE_1"]))), \
             patch.object(self.service, "_compute_deltas"), \
             patch.dict(self.service._dict_action if self.service._dict_action is not None else {}, {"act_1": {"content": {}}}, clear=True):
            
            # Ensure _dict_action is not None for the patch.dict to work if it was None
            if self.service._dict_action is None:
                self.service._dict_action = {"act_1": {"content": {}}}
            
            result = self.service.simulate_manual_action("act_1", "line_1")
            assert result["non_convergence"] == "Load flow diverged"

    def test_diagram_payload_includes_convergence_info(self):
        """Verify that get_action_variant_diagram includes convergence status in its response."""
        mock_obs = self.MockObs(converged=False, exception="Divergence detected")
        self.service._last_result = {
            "prioritized_actions": {
                "act_1": {
                    "observation": mock_obs,
                    "non_convergence": "Divergence detected"
                }
            }
        }
        
        with patch("expert_backend.services.recommender_service.enrich_actions_lazy"), \
             patch.object(self.service, "_generate_diagram") as mock_gen, \
             patch.object(self.service, "_get_network_flows"), \
             patch.object(self.service, "_get_asset_flows"), \
             patch.object(self.service, "_get_n1_flows"), \
             patch.object(self.service, "_get_base_network"), \
             patch.object(self.service, "_get_n1_variant"), \
             patch.object(self.service, "_compute_deltas") as mock_deltas:
            
            mock_gen.return_value = {"svg": "<svg></svg>", "metadata": {}}
            mock_deltas.return_value = {"flow_deltas": {}, "reactive_flow_deltas": {}, "asset_deltas": {}}
            
            payload = self.service.get_action_variant_diagram("act_1")
            assert payload["lf_converged"] is False
            assert payload["non_convergence"] == "Divergence detected"

    def test_sld_payload_includes_convergence_info(self):
        """Verify that get_action_variant_sld includes convergence status in its response."""
        mock_obs = self.MockObs(converged=False, exception="Divergence detected")
        self.service._last_result = {
            "prioritized_actions": {
                "act_1": {
                    "observation": mock_obs,
                    "non_convergence": "Divergence detected"
                }
            }
        }
        
        # SLD needs to mock network.get_single_line_diagram
        mock_nm = mock_obs._network_manager
        mock_n = mock_nm.network
        mock_n.get_single_line_diagram.return_value = MagicMock()

        with patch.object(self.service, "_extract_sld_svg_and_metadata") as mock_extract, \
             patch.object(self.service, "_get_network_flows"), \
             patch.object(self.service, "_get_asset_flows"), \
             patch.object(self.service, "_get_n1_flows"), \
             patch.object(self.service, "_get_base_network"), \
             patch.object(self.service, "_get_n1_variant"), \
             patch.object(self.service, "_compute_deltas") as mock_deltas:
            
            mock_extract.return_value = ("<svg></svg>", {})
            mock_deltas.return_value = {"flow_deltas": {}, "reactive_flow_deltas": {}}
            
            payload = self.service.get_action_variant_sld("act_1", "Substation A")
            assert payload["lf_converged"] is False
            assert payload["non_convergence"] == "Divergence detected"
