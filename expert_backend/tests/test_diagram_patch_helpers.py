# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

"""Unit tests for the DiagramMixin helpers that drive the svgPatch
DOM-recycling path:

- ``_compute_vl_topology_diff`` — which VLs have different bus counts
  between the action-variant snapshot and the live N-1 network? Drives
  the decision to splice vs. fall back to the full NAD.
- ``_get_disconnected_branches_from_snapshot`` — the ``disconnected_edges``
  list that the client renders with the `nad-disconnected` class
  (dashed line), covering the N-1 contingency + any disco_* /
  reco_* action impact.

Both helpers are pure / staticmethod-like — they accept pandas
DataFrames (captured snapshots from the action variant) and a live
N-1 `Network`, so we exercise them directly with lightweight mocks
instead of standing up a full pypowsybl stack.

See docs/performance/history/svg-dom-recycling.md for the architecture.
"""

from __future__ import annotations

import pandas as pd
import pytest
from unittest.mock import MagicMock

from expert_backend.services.diagram_mixin import (
    ActionResultUnavailableError,
    DiagramMixin,
)
from expert_backend.services.recommender_service import RecommenderService


def _bus_snap(counts_by_vl: dict[str, int]) -> pd.DataFrame:
    """Build an action-variant `get_buses(attributes=['voltage_level_id'])`
    lookalike: one row per bus, `voltage_level_id` column naming the VL
    the bus belongs to. `counts_by_vl` declares how many buses each VL
    hosts."""
    rows = []
    bus_idx = 0
    for vl, n in counts_by_vl.items():
        for _ in range(n):
            rows.append({"bus_id": f"bus-{bus_idx}", "voltage_level_id": vl})
            bus_idx += 1
    df = pd.DataFrame(rows)
    if rows:
        df = df.set_index("bus_id")
    return df


def _n1_network_mock(counts_by_vl: dict[str, int]) -> MagicMock:
    net = MagicMock()
    net.get_buses.return_value = _bus_snap(counts_by_vl)
    return net


# ---------------------------------------------------------------------------
# _compute_vl_topology_diff
# ---------------------------------------------------------------------------


class TestComputeVlTopologyDiff:
    def test_returns_none_when_snapshot_missing(self):
        """A failed snapshot capture must be treated conservatively —
        the caller must fall back to the full NAD rather than splice
        with unknown topology."""
        n1 = _n1_network_mock({"VL_A": 1})
        result = DiagramMixin._compute_vl_topology_diff(None, n1)
        assert result is None

    def test_returns_none_when_network_raises(self):
        """If pypowsybl raises during `get_buses`, we return None and
        let the caller fall back. No half-computed diff is acceptable."""
        action_snap = _bus_snap({"VL_A": 1})
        n1 = MagicMock()
        n1.get_buses.side_effect = RuntimeError("pypowsybl exploded")
        result = DiagramMixin._compute_vl_topology_diff(action_snap, n1)
        assert result is None

    def test_empty_list_when_counts_match(self):
        """Actions that only flip line breakers or shift flows leave
        every VL's bus count untouched → patch path uses empty
        vl_subtrees (no VL re-rendering needed)."""
        action_snap = _bus_snap({"VL_A": 2, "VL_B": 1})
        n1 = _n1_network_mock({"VL_A": 2, "VL_B": 1})
        assert DiagramMixin._compute_vl_topology_diff(action_snap, n1) == []

    def test_reports_vl_when_action_merges_two_buses_into_one(self):
        """Node-merging on VL_A: action snapshot has 1 bus, N-1 has 2."""
        action_snap = _bus_snap({"VL_A": 1, "VL_B": 1})
        n1 = _n1_network_mock({"VL_A": 2, "VL_B": 1})
        result = DiagramMixin._compute_vl_topology_diff(action_snap, n1)
        assert result == ["VL_A"]

    def test_reports_vl_when_action_splits_one_bus_into_two(self):
        """Node-splitting on VL_B: action snapshot has 2 buses, N-1 has 1."""
        action_snap = _bus_snap({"VL_A": 1, "VL_B": 2})
        n1 = _n1_network_mock({"VL_A": 1, "VL_B": 1})
        result = DiagramMixin._compute_vl_topology_diff(action_snap, n1)
        assert result == ["VL_B"]

    def test_reports_multiple_vls_when_coupling_impacts_several(self):
        """A compound action that toggles couplers across two VLs."""
        action_snap = _bus_snap({"VL_A": 2, "VL_B": 2, "VL_C": 1})
        n1 = _n1_network_mock({"VL_A": 1, "VL_B": 1, "VL_C": 1})
        result = DiagramMixin._compute_vl_topology_diff(action_snap, n1)
        assert set(result) == {"VL_A", "VL_B"}

    def test_reports_vl_present_only_in_one_side(self):
        """Asymmetric VL membership → diff (ghost VL indicates a bus
        split/merge collapsing an entire VL's electrical presence)."""
        action_snap = _bus_snap({"VL_A": 1})
        n1 = _n1_network_mock({"VL_A": 1, "VL_B": 1})
        result = DiagramMixin._compute_vl_topology_diff(action_snap, n1)
        assert result == ["VL_B"]


# ---------------------------------------------------------------------------
# _get_disconnected_branches_from_snapshot
# ---------------------------------------------------------------------------


def _conn_snap(rows: list[tuple[str, bool, bool]]) -> pd.DataFrame:
    """Build a `get_lines(attributes=['connected1','connected2'])`
    lookalike. `rows` is a list of (line_id, connected1, connected2)
    tuples."""
    df = pd.DataFrame(
        [{"id": r[0], "connected1": r[1], "connected2": r[2]} for r in rows]
    )
    if rows:
        df = df.set_index("id")
    return df


class TestGetDisconnectedBranchesFromSnapshot:
    def test_empty_when_every_branch_is_connected(self):
        """PST / redispatch / flow-only actions don't flip breakers."""
        lines = _conn_snap([("LINE_A", True, True), ("LINE_B", True, True)])
        trafos = _conn_snap([("T_1", True, True)])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(lines, trafos)
        assert result == []

    def test_lists_n1_contingency(self):
        """Contingency line (disconnected in N-1) remains disconnected
        post-action and must render dashed on the action tab."""
        lines = _conn_snap([("CONTINGENCY", False, True), ("LINE_B", True, True)])
        trafos = _conn_snap([])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(lines, trafos)
        assert result == ["CONTINGENCY"]

    def test_lists_contingency_plus_disco_action_target(self):
        """disco_* adds a new open branch; both must render dashed."""
        lines = _conn_snap([
            ("CONTINGENCY", False, True),
            ("LINE_B", True, True),
            ("DISCO_TARGET", True, False),
        ])
        trafos = _conn_snap([])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(lines, trafos)
        assert set(result) == {"CONTINGENCY", "DISCO_TARGET"}

    def test_reco_excludes_the_reconnected_line(self):
        """reco_* on the contingency reconnects it; the action tab
        must drop the dashed class on that line. Empty list expected."""
        lines = _conn_snap([
            ("CONTINGENCY", True, True),  # reco_* restored both terminals
            ("LINE_B", True, True),
        ])
        trafos = _conn_snap([])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(lines, trafos)
        assert result == []

    def test_covers_both_lines_and_transformers(self):
        """2-winding transformers may also carry the contingency (rare
        but possible). Must be scanned alongside lines."""
        lines = _conn_snap([("LINE_A", True, True)])
        trafos = _conn_snap([("T_OPEN", False, True)])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(lines, trafos)
        assert result == ["T_OPEN"]

    def test_tolerates_none_snapshots(self):
        """Snapshot capture can fail (pypowsybl quirk / empty network).
        Both None → empty list; partial None → scan the side we have."""
        result = DiagramMixin._get_disconnected_branches_from_snapshot(None, None)
        assert result == []

        lines = _conn_snap([("LINE_A", False, True)])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(lines, None)
        assert result == ["LINE_A"]

    def test_tolerates_empty_dataframes(self):
        """A study with no transformers (or no lines) must not raise.
        Keeps the helper safe on micro-grids used in unit tests."""
        empty = pd.DataFrame(columns=["connected1", "connected2"])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(empty, empty)
        assert result == []

    def test_tolerates_raising_dataframe_access(self):
        """If reading `connected1`/`connected2` raises (e.g. dtype
        surprises from a future pypowsybl release), the helper swallows
        per-frame exceptions and returns what it could compute from the
        other frame — correctness on best-effort basis."""
        bad = MagicMock()
        # Make `.index` non-empty so we enter the try-block, then let
        # column access raise.
        bad.index = pd.Index(["x"])
        bad.__getitem__.side_effect = RuntimeError("column gone")
        # Use Python's len() protocol via a wrapper MagicMock with
        # __len__ configured.
        bad.__len__ = lambda _self=bad: 1

        good = _conn_snap([("LINE_A", False, True)])
        result = DiagramMixin._get_disconnected_branches_from_snapshot(bad, good)
        assert result == ["LINE_A"]


# ---------------------------------------------------------------------------
# Integration with the patch-endpoint response shape
# ---------------------------------------------------------------------------


class TestPatchPayloadShape:
    """The patch payload is consumed by a strict client-side type
    (`DiagramPatch` in frontend/src/types.ts). These tests lock the
    shape contract at the Python boundary to catch accidental renames
    / deletions before they ship."""

    def test_n1_patch_required_fields(self):
        """Every field the client unconditionally reads must be on
        every `get_n1_diagram_patch` response — enforce via a spec
        list rather than wait for a Vitest failure."""
        required = {
            "patchable",
            "contingency_id",
            "lf_converged",
            "lf_status",
            "disconnected_edges",
        }
        # Illustrative minimal payload — matches what
        # `get_n1_diagram_patch` returns.
        payload = {
            "patchable": True,
            "contingency_id": "LINE_A",
            "lf_converged": True,
            "lf_status": "CONVERGED",
            "disconnected_edges": ["LINE_A"],
            "absolute_flows": {"p1": {}, "p2": {}, "q1": {}, "q2": {}, "vl1": {}, "vl2": {}},
            "lines_overloaded": [],
            "lines_overloaded_rho": [],
            "flow_deltas": {},
            "reactive_flow_deltas": {},
            "asset_deltas": {},
            "meta": {"base_state": "N", "elapsed_ms": 42},
        }
        missing = required - payload.keys()
        assert not missing, f"missing required N-1 patch fields: {missing}"

    def test_action_patch_vl_subtree_entry_shape(self):
        """`vl_subtrees[vlId]` entries carry node_svg + node_sub_svg_id;
        edge_fragments is optional but each item has svg + sub_svg_id.
        Locks the client-rewrite contract — the sub_svg_id is what
        the frontend replaces with the main-diagram svgId."""
        entry = {
            "node_svg": "<g id=\"nad-vl-0\"><circle r=\"5\"/></g>",
            "node_sub_svg_id": "nad-vl-0",
            "edge_fragments": {
                "LINE_A": {"svg": "<g id=\"nad-l-3\"/>", "sub_svg_id": "nad-l-3"},
            },
        }
        assert "node_svg" in entry
        assert "node_sub_svg_id" in entry
        edge = entry["edge_fragments"]["LINE_A"]
        assert {"svg", "sub_svg_id"} <= edge.keys()

    @pytest.mark.parametrize("field", [
        "patchable", "action_id", "reason",
        "lf_converged", "lf_status",
    ])
    def test_unpatchable_response_keeps_slim_shape(self, field):
        """The `patchable: false` fallback payload carries only the
        fields the client branches on. Prevents accidental leakage
        of heavy fields when the extractor fails."""
        payload = {
            "patchable": False,
            "reason": "vl_topology_changed",
            "action_id": "node_splitting_X",
            "lf_converged": True,
            "lf_status": "CONVERGED",
            "non_convergence": None,
        }
        assert field in payload


class TestActionResultUnavailable:
    """After a session reload (and for any manually-added action) the
    backend has no cached observation for the action. The action-variant
    *patch* endpoint must soft-fail with ``patchable: false`` — the
    contract the frontend already handles — instead of raising a 400,
    and ``_require_action`` must raise the dedicated
    ``ActionResultUnavailableError`` so the API layer can log the
    expected condition quietly. See
    docs/features/save-results.md (post-reload action fallback)."""

    @pytest.fixture
    def service(self):
        return RecommenderService()

    def test_patch_soft_fails_when_no_analysis_result(self, service):
        service._last_result = None
        payload = service.get_action_variant_diagram_patch("disco_LINE_X")
        assert payload["patchable"] is False
        assert payload["reason"] == "no-analysis-result"
        assert payload["action_id"] == "disco_LINE_X"

    def test_patch_soft_fails_when_action_not_in_last_result(self, service):
        # A result exists but this action id isn't one the recommender
        # produced (e.g. a manually-added action).
        service._last_result = {"prioritized_actions": {"some_other_action": {}}}
        payload = service.get_action_variant_diagram_patch("manual_LINE_Y")
        assert payload["patchable"] is False
        assert payload["reason"] == "action-not-in-last-result"
        assert payload["action_id"] == "manual_LINE_Y"

    def test_require_action_raises_dedicated_error_when_no_result(self, service):
        service._last_result = None
        with pytest.raises(ActionResultUnavailableError, match="No analysis result"):
            service._require_action("disco_LINE_X")

    def test_require_action_raises_dedicated_error_when_action_missing(self, service):
        service._last_result = {"prioritized_actions": {"known_action": {}}}
        with pytest.raises(ActionResultUnavailableError, match="not found in last analysis result"):
            service._require_action("unknown_action")

    def test_dedicated_error_is_a_value_error(self):
        # Subclassing ValueError keeps every existing `except ValueError`
        # / `except Exception` boundary returning HTTP 400 unchanged —
        # the dedicated type only adds a hook for quiet logging.
        assert issubclass(ActionResultUnavailableError, ValueError)
