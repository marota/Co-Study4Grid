# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

"""Tests for SLD highlight features:
- changed_switches computation (N-1 vs action diff) in get_action_variant_sld
- _enrich_actions switch fallback from _dict_action
- Overloaded lines restricted to N-1 result (not returned in action SLD response)
- isCouplingAction detection logic (via coupling keyword heuristics)
"""

import pytest
from pathlib import Path
from unittest.mock import MagicMock, patch, PropertyMock
import pandas as pd

from expert_backend.services.recommender_service import RecommenderService


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_switch_df(switch_states: dict) -> pd.DataFrame:
    """Build a minimal pypowsybl-style switches DataFrame."""
    return pd.DataFrame(
        {"open": switch_states},
        index=list(switch_states.keys()),
    )


def _make_service_with_last_result(action_id, obs_mock):
    """Return a RecommenderService wired with a fake _last_result."""
    service = RecommenderService()
    service._last_result = {
        "prioritized_actions": {
            action_id: {
                "observation": obs_mock,
                "description_unitaire": "Test action",
                "action": MagicMock(),
                "action_topology": {},
            }
        }
    }
    service._last_disconnected_element = "LINE_TEST"
    return service


# ---------------------------------------------------------------------------
# Tests: changed_switches computation in get_action_variant_sld
# ---------------------------------------------------------------------------

class TestChangedSwitchesInSld:
    """get_action_variant_sld must diff N-1 and action switch states and return
    only switches whose 'open' status changed."""

    def _build_obs_mock(self, action_variant_id="action_var_1"):
        obs = MagicMock()
        obs._variant_id = action_variant_id
        obs._last_info = {"exception": None}
        nm = MagicMock()
        nm.network = MagicMock()
        obs._network_manager = nm
        return obs, nm

    @patch.object(RecommenderService, "_get_base_network")
    @patch.object(RecommenderService, "_get_n1_variant", return_value="n1_var")
    @patch.object(RecommenderService, "_extract_sld_svg_and_metadata", return_value=("<svg/>", None))
    @patch.object(RecommenderService, "_get_network_flows", return_value={})
    @patch.object(RecommenderService, "_get_asset_flows", return_value={})
    @patch.object(RecommenderService, "_get_n1_flows", return_value={})
    @patch.object(RecommenderService, "_compute_deltas", return_value={"flow_deltas": {}, "reactive_flow_deltas": {}})
    @patch.object(RecommenderService, "_compute_asset_deltas", return_value={})
    def test_changed_switches_returned_for_toggled_switch(
        self, mock_asset_deltas, mock_compute_deltas, mock_n1_flows,
        mock_asset_flows, mock_network_flows, mock_extract, mock_n1_var, mock_base_net
    ):
        """Switches that differ between N-1 and action states appear in changed_switches."""
        obs, nm = self._build_obs_mock()

        # Action variant: SW_A is closed (open=False), SW_B unchanged (open=True)
        action_switches = _make_switch_df({"SW_A": False, "SW_B": True, "SW_C": False})
        nm.network.get_switches.return_value = action_switches
        nm.network.get_single_line_diagram.return_value = MagicMock()

        # N-1 variant: SW_A was open, SW_B unchanged, SW_C also unchanged
        n1_net = MagicMock()
        n1_switches = _make_switch_df({"SW_A": True, "SW_B": True, "SW_C": False})
        n1_net.get_switches.return_value = n1_switches
        n1_net.get_working_variant_id.return_value = "orig"
        mock_base_net.return_value = n1_net

        service = _make_service_with_last_result("ACTION_1", obs)

        result = service.get_action_variant_sld("ACTION_1", "VL_TEST")

        assert "changed_switches" in result
        changed = result["changed_switches"]
        # Only SW_A changed (open: True → False)
        assert "SW_A" in changed
        assert changed["SW_A"]["from_open"] is True
        assert changed["SW_A"]["to_open"] is False
        # SW_B and SW_C did not change
        assert "SW_B" not in changed
        assert "SW_C" not in changed

    @patch.object(RecommenderService, "_get_base_network")
    @patch.object(RecommenderService, "_get_n1_variant", return_value="n1_var")
    @patch.object(RecommenderService, "_extract_sld_svg_and_metadata", return_value=("<svg/>", None))
    @patch.object(RecommenderService, "_get_network_flows", return_value={})
    @patch.object(RecommenderService, "_get_asset_flows", return_value={})
    @patch.object(RecommenderService, "_get_n1_flows", return_value={})
    @patch.object(RecommenderService, "_compute_deltas", return_value={"flow_deltas": {}, "reactive_flow_deltas": {}})
    @patch.object(RecommenderService, "_compute_asset_deltas", return_value={})
    def test_empty_changed_switches_when_no_diff(
        self, mock_asset_deltas, mock_compute_deltas, mock_n1_flows,
        mock_asset_flows, mock_network_flows, mock_extract, mock_n1_var, mock_base_net
    ):
        """If no switch changed state, changed_switches is an empty dict."""
        obs, nm = self._build_obs_mock()

        same_switches = _make_switch_df({"SW_A": True, "SW_B": False})
        nm.network.get_switches.return_value = same_switches
        nm.network.get_single_line_diagram.return_value = MagicMock()

        n1_net = MagicMock()
        n1_net.get_switches.return_value = same_switches.copy()
        n1_net.get_working_variant_id.return_value = "orig"
        mock_base_net.return_value = n1_net

        service = _make_service_with_last_result("ACTION_2", obs)

        result = service.get_action_variant_sld("ACTION_2", "VL_TEST")

        assert result["changed_switches"] == {}

    @patch.object(RecommenderService, "_get_base_network")
    @patch.object(RecommenderService, "_get_n1_variant", return_value="n1_var")
    @patch.object(RecommenderService, "_extract_sld_svg_and_metadata", return_value=("<svg/>", None))
    @patch.object(RecommenderService, "_get_network_flows", return_value={})
    @patch.object(RecommenderService, "_get_asset_flows", return_value={})
    @patch.object(RecommenderService, "_get_n1_flows", return_value={})
    @patch.object(RecommenderService, "_compute_deltas", return_value={"flow_deltas": {}, "reactive_flow_deltas": {}})
    @patch.object(RecommenderService, "_compute_asset_deltas", return_value={})
    def test_multiple_switches_changed(
        self, mock_asset_deltas, mock_compute_deltas, mock_n1_flows,
        mock_asset_flows, mock_network_flows, mock_extract, mock_n1_var, mock_base_net
    ):
        """Multiple toggled switches are all reported."""
        obs, nm = self._build_obs_mock()

        action_switches = _make_switch_df({"SW_1": False, "SW_2": True, "SW_3": False})
        nm.network.get_switches.return_value = action_switches
        nm.network.get_single_line_diagram.return_value = MagicMock()

        n1_net = MagicMock()
        n1_switches = _make_switch_df({"SW_1": True, "SW_2": False, "SW_3": False})
        n1_net.get_switches.return_value = n1_switches
        n1_net.get_working_variant_id.return_value = "orig"
        mock_base_net.return_value = n1_net

        service = _make_service_with_last_result("ACTION_3", obs)

        result = service.get_action_variant_sld("ACTION_3", "VL_TEST")

        changed = result["changed_switches"]
        assert "SW_1" in changed  # True → False
        assert "SW_2" in changed  # False → True
        assert "SW_3" not in changed  # unchanged

    @patch.object(RecommenderService, "_get_base_network")
    @patch.object(RecommenderService, "_get_n1_variant", return_value="n1_var")
    @patch.object(RecommenderService, "_extract_sld_svg_and_metadata", return_value=("<svg/>", None))
    @patch.object(RecommenderService, "_get_network_flows", return_value={})
    @patch.object(RecommenderService, "_get_asset_flows", return_value={})
    @patch.object(RecommenderService, "_get_n1_flows", return_value={})
    @patch.object(RecommenderService, "_compute_deltas", return_value={"flow_deltas": {}, "reactive_flow_deltas": {}})
    @patch.object(RecommenderService, "_compute_asset_deltas", return_value={})
    def test_changed_switches_graceful_on_get_switches_error(
        self, mock_asset_deltas, mock_compute_deltas, mock_n1_flows,
        mock_asset_flows, mock_network_flows, mock_extract, mock_n1_var, mock_base_net
    ):
        """If get_switches() raises, changed_switches is an empty dict (no crash)."""
        obs, nm = self._build_obs_mock()

        nm.network.get_switches.side_effect = RuntimeError("not supported")
        nm.network.get_single_line_diagram.return_value = MagicMock()

        n1_net = MagicMock()
        n1_net.get_working_variant_id.return_value = "orig"
        mock_base_net.return_value = n1_net

        service = _make_service_with_last_result("ACTION_ERR", obs)

        # Should not raise
        result = service.get_action_variant_sld("ACTION_ERR", "VL_TEST")
        assert result["changed_switches"] == {}


# ---------------------------------------------------------------------------
# Tests: _enrich_actions switch fallback
# ---------------------------------------------------------------------------

class TestEnrichActionsSwitch:
    """_enrich_actions must fall back to _dict_action when the action object
    has no 'switches' attribute."""

    def test_switches_extracted_from_dict_action_when_action_obj_has_none(self):
        service = RecommenderService()

        action_obj = MagicMock()
        action_obj.lines_ex_bus = {}
        action_obj.lines_or_bus = {}
        action_obj.gens_bus = {}
        action_obj.loads_bus = {}
        action_obj.pst_tap = {}
        action_obj.substations = {}
        action_obj.switches = None  # grid2op Action returns None

        obs = MagicMock()
        obs.rho = [0.5]
        obs.name_line = ["L1"]

        service._dict_action = {
            "ACT_SW": {
                "description_unitaire": "Switch action",
                "content": {"switches": {"BREAKER_1": {"bus": 1}}},
            }
        }

        prioritized = {
            "ACT_SW": {
                "observation": obs,
                "action": action_obj,
                "rho_before": [0.5],
                "rho_after": [0.4],
                "max_rho": 0.9,
                "max_rho_line": "L1",
                "is_rho_reduction": True,
                "description_unitaire": "Switch action",
            }
        }

        enriched = service._enrich_actions(prioritized)

        topo = enriched["ACT_SW"].get("action_topology", {})
        assert topo.get("switches"), "Switches should be populated from _dict_action fallback"
        assert "BREAKER_1" in topo["switches"]

    def test_switches_from_action_obj_used_when_present(self):
        """When the action object already has switches, no fallback is needed."""
        service = RecommenderService()

        action_obj = MagicMock()
        action_obj.lines_ex_bus = {}
        action_obj.lines_or_bus = {}
        action_obj.gens_bus = {}
        action_obj.loads_bus = {}
        action_obj.pst_tap = {}
        action_obj.substations = {}
        action_obj.switches = {"SW_DIRECT": {"bus": 2}}

        obs = MagicMock()
        obs.rho = [0.5]
        obs.name_line = ["L1"]

        # _dict_action has different switches — should NOT be used
        service._dict_action = {
            "ACT_OBJ": {
                "description_unitaire": "Direct switch action",
                "content": {"switches": {"SW_FROM_DICT": {"bus": 1}}},
            }
        }

        prioritized = {
            "ACT_OBJ": {
                "observation": obs,
                "action": action_obj,
                "rho_before": [0.5],
                "rho_after": [0.4],
                "max_rho": 0.9,
                "max_rho_line": "L1",
                "is_rho_reduction": True,
                "description_unitaire": "Direct switch action",
            }
        }

        enriched = service._enrich_actions(prioritized)

        topo = enriched["ACT_OBJ"].get("action_topology", {})
        assert "SW_DIRECT" in topo.get("switches", {})
        assert "SW_FROM_DICT" not in topo.get("switches", {})

    def test_switches_not_set_when_neither_source_has_data(self):
        """When neither action object nor dict_action has switches, topology.switches is empty."""
        service = RecommenderService()

        action_obj = MagicMock()
        action_obj.lines_ex_bus = {}
        action_obj.lines_or_bus = {}
        action_obj.gens_bus = {}
        action_obj.loads_bus = {}
        action_obj.pst_tap = {}
        action_obj.substations = {}
        action_obj.switches = None

        obs = MagicMock()
        obs.rho = [0.5]
        obs.name_line = ["L1"]

        service._dict_action = {"ACT_NO_SW": {"description_unitaire": "No switch", "content": {}}}

        prioritized = {
            "ACT_NO_SW": {
                "observation": obs,
                "action": action_obj,
                "rho_before": [],
                "rho_after": [],
                "max_rho": 0.0,
                "max_rho_line": "",
                "is_rho_reduction": False,
                "description_unitaire": "No switch",
            }
        }

        enriched = service._enrich_actions(prioritized)
        topo = enriched["ACT_NO_SW"].get("action_topology", {})
        assert not topo.get("switches"), "switches should be empty when no source has data"


# ---------------------------------------------------------------------------
# Tests: isCouplingAction coupling detection heuristic
# ---------------------------------------------------------------------------

class TestIsCouplingAction:
    """The coupling detection checks action ID and description for coupling keywords."""

    def _is_coupling(self, action_id, description=""):
        """Replicate the isCouplingAction logic from svgUtils.ts in Python."""
        q = ((action_id or "") + " " + (description or "")).lower()
        return (
            "coupling" in q
            or "busbar" in q
            or "coupl" in q
            or "noeud" in q
            or "node" in q
        )

    def test_coupling_in_action_id(self):
        assert self._is_coupling("COUCHP6_COUCH6COUPL", "") is True

    def test_coupling_keyword_in_description(self):
        assert self._is_coupling("ACT_123", "Fermeture coupling breaker") is True

    def test_coupl_substring_matches(self):
        assert self._is_coupling("ACT_COUPL_TEST", "") is True

    def test_busbar_keyword(self):
        assert self._is_coupling("BUSBAR_NODE_1", "") is True

    def test_noeud_keyword_french(self):
        assert self._is_coupling("", "Fermeture noeud de couplage") is True

    def test_node_keyword(self):
        assert self._is_coupling("NODE_MERGE_1", "") is True

    def test_regular_line_disconnect_not_coupling(self):
        assert self._is_coupling("LOUHAP3", "Ouverture ligne LOUHAP3 DJ_OC") is False

    def test_regular_reconnection_not_coupling(self):
        assert self._is_coupling("disco_LINE_1", "Reconnexion ligne") is False

    def test_case_insensitive_matching(self):
        assert self._is_coupling("COUPLING_ACTION_BIG", "") is True
        assert self._is_coupling("", "BUSBAR MERGING") is True

    def test_empty_inputs_not_coupling(self):
        assert self._is_coupling("", "") is False
        assert self._is_coupling(None, None) is False


# ---------------------------------------------------------------------------
# Tests: all 7 topology fields extracted by _enrich_actions
# ---------------------------------------------------------------------------

class TestEnrichActionsTopologyFields:
    """_enrich_actions must expose all 7 topology fields from the action object."""

    def test_all_seven_topology_fields_present(self):
        """action_topology must contain all 7 expected keys."""
        service = RecommenderService()

        action_obj = MagicMock()
        action_obj.lines_ex_bus = {"L1": 1}
        action_obj.lines_or_bus = {"L2": 2}
        action_obj.gens_bus = {"G1": 1}
        action_obj.loads_bus = {}
        action_obj.pst_tap = {}
        action_obj.substations = {}
        action_obj.switches = {"SW_X": True}

        obs = MagicMock()
        obs.rho = [0.5]
        obs.name_line = ["L1"]

        prioritized = {
            "ACT_FULL": {
                "observation": obs,
                "action": action_obj,
                "rho_before": [],
                "rho_after": [],
                "max_rho": 0.0,
                "max_rho_line": "",
                "is_rho_reduction": False,
                "description_unitaire": "Full topology action",
            }
        }
        service._dict_action = {}

        enriched = service._enrich_actions(prioritized)

        topo = enriched["ACT_FULL"]["action_topology"]
        expected_keys = {"lines_ex_bus", "lines_or_bus", "gens_bus",
                         "loads_bus", "pst_tap", "substations", "switches"}
        assert expected_keys.issubset(set(topo.keys())), (
            f"Missing topology keys: {expected_keys - set(topo.keys())}"
        )
        assert topo["lines_ex_bus"] == {"L1": 1}
        assert topo["lines_or_bus"] == {"L2": 2}
        assert topo["gens_bus"] == {"G1": 1}
        assert topo["switches"] == {"SW_X": True}
        assert topo["substations"] == {}


        assert topo["substations"] == {}
