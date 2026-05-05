# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""End-to-end tests for the overflow-graph viewer layer-toggle bug
fixes. The tests build a small handcrafted overflow graph that
exercises every category of edge / node the layer toggles classify
(hub, on_constrained_path, in_red_loop, is_overload, is_monitored,
plus colour and style discriminators), render it through the upstream
``build_interactive_html`` viewer, and assert the resulting MODEL JSON
+ injected SVG carry the right layer membership. The HTML output is
also re-injected through the Co-Study4Grid overlay so the dynamic
``/results/pdf/{filename}`` route is covered.

The dim semantics of the JS template are verified via a small jsdom
simulation: we re-implement the recompute rule (``shouldDim``) in
Python — byte-equivalent to the JS — and assert it against the model
membership map. This avoids spinning up Node just to run a few cases
and keeps the contract easy to read.
"""

from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any, Dict, List, Set

import networkx as nx
import pytest

pydot = pytest.importorskip("pydot")

from alphaDeesp.core.graphsAndPaths import OverFlowGraph  # noqa: E402
from alphaDeesp.core.interactive_html import build_interactive_html  # noqa: E402
from alphaDeesp.tests.graphs_test_helpers import make_ofg_with_graph  # noqa: E402

from expert_backend.services.overflow_overlay import inject_overlay


# ---------------------------------------------------------------------
# Fixture: a graph that touches every layer the viewer surfaces
# ---------------------------------------------------------------------

def _build_full_layer_graph() -> OverFlowGraph:
    """Return an OverFlowGraph stub carrying:

    * one overload edge (black, also tagged is_overload)
    * one constrained-path edge (blue, on_constrained_path)
    * one red-loop edge (coral, in_red_loop, in a coral component)
    * one positive-overflow-only edge (coral, NOT in any red loop because
      its endpoint has a non-coral neighbour — actually for simplicity
      we use a dedicated dyad)
    * one monitored line (compound color + is_monitored)
    * one reconnectable (dashed) edge
    * one non-reconnectable (dotted) edge
    * a hub node (is_hub) which by definition picks up
      on_constrained_path + in_red_loop
    """
    g = nx.MultiDiGraph()
    # Nodes
    g.add_node("HUB",   shape="oval")
    g.add_node("OVL_A", shape="oval")  # constrained / overload endpoint
    g.add_node("OVL_B", shape="oval")
    g.add_node("RL_X",  shape="oval")  # red-loop interior (will collapse)
    g.add_node("RL_Y",  shape="oval")
    g.add_node("MON_A", shape="oval")  # monitored line endpoint
    g.add_node("MON_B", shape="oval")
    g.add_node("RC_A",  shape="oval")  # reconnectable edge endpoint
    g.add_node("RC_B",  shape="oval")
    g.add_node("NR_A",  shape="oval")  # non-reconnectable
    g.add_node("NR_B",  shape="oval")

    # Overload (black) — also part of constrained path
    g.add_edge("OVL_A", "OVL_B", name="L_OVL", color="black", label="100")
    # Constrained-path blue edge
    g.add_edge("OVL_B", "HUB",   name="L_BLUE", color="blue", label="-30")
    # Pure red-loop component (RL_X — RL_Y, both coral)
    g.add_edge("RL_X", "RL_Y", name="L_CORAL_RL", color="coral", label="5")
    g.add_edge("RL_Y", "RL_X", name="L_CORAL_RL2", color="coral", label="5")
    # Monitored coral line (will get is_monitored)
    g.add_edge("MON_A", "MON_B", name="L_MON", color="coral", label="50")
    # Reconnectable (dashed) edge — gray-style
    g.add_edge("RC_A", "RC_B", name="L_RECO", color="gray", style="dashed", label="0")
    # Non-reconnectable (dotted) edge — gray-style
    g.add_edge("NR_A", "NR_B", name="L_NRECO", color="gray", style="dotted", label="0")

    ofg = make_ofg_with_graph(g)
    # Tag pipeline (mirrors visualization.py order)
    ofg.set_hubs_shape(["HUB"], shape_hub="diamond")
    ofg.highlight_significant_line_loading({
        "L_OVL": {"before": 95, "after": 110},
        "L_MON": {"before": 80, "after": 92},
    })
    ofg.tag_constrained_path(
        lines_constrained_path=["L_OVL", "L_BLUE"],
        nodes_constrained_path=["OVL_A", "OVL_B"],
    )
    ofg.collapse_red_loops()
    # Source-of-truth red-loop tagging — simulates what the
    # recommender's ``get_dispatch_edges_nodes(only_loop_paths=True)``
    # would return for this fixture: only the RL_X-RL_Y dyad
    # participates in a cycle path. MON_A/MON_B is intentionally NOT
    # tagged (no cycle).
    ofg.tag_red_loops(
        lines_red_loops=["L_CORAL_RL", "L_CORAL_RL2"],
        nodes_red_loops=["RL_X", "RL_Y"],
    )
    return ofg


def _build_html_and_model() -> tuple[str, Dict[str, Any]]:
    ofg = _build_full_layer_graph()
    pg = nx.drawing.nx_pydot.to_pydot(ofg.g)
    html = build_interactive_html(pg, title="layer-coverage")
    m = re.search(r"const MODEL = (\{.*?\});\n\(function", html, re.S)
    assert m, "Embedded MODEL JSON not found"
    return html, json.loads(m.group(1))


def _layers_by_key(model: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {layer["key"]: layer for layer in model["layers"]}


# ---------------------------------------------------------------------
# Layer-membership assertions (source-truth, no symbol reinterpretation)
# ---------------------------------------------------------------------

class TestLayerMembershipsFromSourceFlags:
    def test_hubs_layer_includes_only_hub_node(self):
        _, model = _build_html_and_model()
        hubs = _layers_by_key(model)["semantic:is_hub"]
        assert hubs["nodes"] == ["HUB"]
        assert hubs["edges"] == []

    def test_hub_is_also_in_red_loop_and_constrained_path(self):
        _, model = _build_html_and_model()
        layers = _layers_by_key(model)
        assert "HUB" in set(layers["semantic:in_red_loop"]["nodes"])
        assert "HUB" in set(layers["semantic:on_constrained_path"]["nodes"])

    def test_constrained_path_excludes_coral_edges(self):
        _, model = _build_html_and_model()
        cp = _layers_by_key(model)["semantic:on_constrained_path"]
        # Match by edge-id → look up edge color via model.edges.
        edge_colors = {e["id"]: e["attrs"].get("color", "") for e in model["edges"]}
        for eid in cp["edges"]:
            color = edge_colors[eid]
            base = color.split(":", 1)[0].strip().strip('"').lower()
            assert base != "coral", (
                f"edge {eid} (color={color!r}) leaked into constrained-path"
            )

    def test_constrained_path_includes_blue_and_black(self):
        _, model = _build_html_and_model()
        cp = _layers_by_key(model)["semantic:on_constrained_path"]
        edges_by_id = {e["id"]: e for e in model["edges"]}
        names = {edges_by_id[eid]["attrs"].get("name") for eid in cp["edges"]}
        assert "L_OVL" in names
        assert "L_BLUE" in names

    def test_red_loop_layer_matches_explicit_source_of_truth(self):
        """in_red_loop tagging is now driven by the explicit list passed
        from the recommender's ``get_dispatch_edges_nodes(only_loop_paths
        =True)`` — which itself iterates ``red_loops.Path`` (actual
        cycle paths). The viewer no longer derives membership from
        heuristics over the local graph, so a coral edge can be in or
        out of the layer regardless of its endpoints' shape."""
        _, model = _build_html_and_model()
        rl = _layers_by_key(model)["semantic:in_red_loop"]
        edges_by_id = {e["id"]: e for e in model["edges"]}
        red_loop_names = {edges_by_id[eid]["attrs"].get("name") for eid in rl["edges"]}
        # Fixture explicitly tagged the RL_X-RL_Y dyad as the loop.
        assert "L_CORAL_RL" in red_loop_names
        assert "L_CORAL_RL2" in red_loop_names
        # The monitored coral line MON_A-MON_B is NOT in the cycle.
        assert "L_MON" not in red_loop_names
        rl_node_names = set(rl["nodes"])
        # HUB is auto-tagged by `set_hubs_shape` (hubs are by
        # definition in red loops). RL_X / RL_Y come from the
        # explicit ``tag_red_loops`` call.
        assert rl_node_names == {"HUB", "RL_X", "RL_Y"}

    def test_red_loop_excludes_blue_and_black_edges(self):
        _, model = _build_html_and_model()
        rl = _layers_by_key(model)["semantic:in_red_loop"]
        edges_by_id = {e["id"]: e for e in model["edges"]}
        for eid in rl["edges"]:
            base = edges_by_id[eid]["attrs"].get("color", "").split(":", 1)[0]
            base = base.strip().strip('"').lower()
            assert base == "coral", (
                f"edge {eid} (color={base!r}) leaked into red-loop layer"
            )

    def test_overload_layer_only_contains_black_edges(self):
        _, model = _build_html_and_model()
        layer = _layers_by_key(model)["semantic:is_overload"]
        edges_by_id = {e["id"]: e for e in model["edges"]}
        names = {edges_by_id[eid]["attrs"].get("name") for eid in layer["edges"]}
        assert names == {"L_OVL"}

    def test_monitored_layer_includes_overloads_as_subset(self):
        _, model = _build_html_and_model()
        mon = _layers_by_key(model)["semantic:is_monitored"]
        edges_by_id = {e["id"]: e for e in model["edges"]}
        names = {edges_by_id[eid]["attrs"].get("name") for eid in mon["edges"]}
        # Every entry in dict_significant_change is a low-margin /
        # monitored line. The overload subset is also tagged as
        # overload — they are NOT mutually exclusive layers.
        assert names == {"L_MON", "L_OVL"}

    def test_reconnectable_layer_only_contains_dashed_edges(self):
        _, model = _build_html_and_model()
        layer = _layers_by_key(model).get("style:dashed")
        assert layer is not None
        edges_by_id = {e["id"]: e for e in model["edges"]}
        for eid in layer["edges"]:
            assert edges_by_id[eid]["attrs"].get("style", "").lower() == "dashed"
        names = {edges_by_id[eid]["attrs"].get("name") for eid in layer["edges"]}
        assert names == {"L_RECO"}

    def test_non_reconnectable_layer_only_contains_dotted_edges(self):
        _, model = _build_html_and_model()
        layer = _layers_by_key(model).get("style:dotted")
        assert layer is not None
        edges_by_id = {e["id"]: e for e in model["edges"]}
        for eid in layer["edges"]:
            assert edges_by_id[eid]["attrs"].get("style", "").lower() == "dotted"
        names = {edges_by_id[eid]["attrs"].get("name") for eid in layer["edges"]}
        assert names == {"L_NRECO"}


# ---------------------------------------------------------------------
# Dim semantics (Python twin of the JS `shouldDim`)
# ---------------------------------------------------------------------

def _should_dim(memberships: List[int], checked_set: Set[int], total: int) -> bool:
    """Byte-equivalent of the JS rule in interactive_html.py:

    * `allChecked` (every layer is on) → never dim.
    * Element with no memberships → dim whenever `allChecked` is False.
    * Else: dim iff none of its memberships is in `checked_set`.
    """
    all_checked = len(checked_set) == total
    if all_checked:
        return False
    if not memberships:
        return True
    return not any(idx in checked_set for idx in memberships)


def _node_memberships(model: Dict[str, Any]) -> Dict[str, List[int]]:
    out: Dict[str, List[int]] = {}
    for i, layer in enumerate(model["layers"]):
        for n in layer.get("nodes", []) or []:
            out.setdefault(n, []).append(i)
    return out


def _edge_memberships(model: Dict[str, Any]) -> Dict[str, List[int]]:
    out: Dict[str, List[int]] = {}
    for i, layer in enumerate(model["layers"]):
        for e in layer.get("edges", []) or []:
            out.setdefault(e, []).append(i)
    return out


class TestDimSemantics:
    """Confirms the bug fixes the user flagged on 2026-05-04 — the
    must-have invariants of the layer-toggle UX."""

    def test_unselect_all_dims_every_node(self):
        _, model = _build_html_and_model()
        node_mem = _node_memberships(model)
        # Empty checked set = "Unselect all"
        for name in {n["name"] for n in model["nodes"]}:
            assert _should_dim(
                node_mem.get(name, []), set(), len(model["layers"])
            ), f"node {name} stayed visible after unselect-all"

    def test_unselect_all_dims_every_edge(self):
        _, model = _build_html_and_model()
        edge_mem = _edge_memberships(model)
        for e in model["edges"]:
            assert _should_dim(
                edge_mem.get(e["id"], []), set(), len(model["layers"])
            ), f"edge {e['id']} stayed visible after unselect-all"

    def test_select_all_keeps_every_element_visible(self):
        _, model = _build_html_and_model()
        node_mem = _node_memberships(model)
        edge_mem = _edge_memberships(model)
        all_idx = set(range(len(model["layers"])))
        for name in {n["name"] for n in model["nodes"]}:
            assert not _should_dim(
                node_mem.get(name, []), all_idx, len(model["layers"])
            )
        for e in model["edges"]:
            assert not _should_dim(
                edge_mem.get(e["id"], []), all_idx, len(model["layers"])
            )

    def test_constrained_path_only_visible_with_only_that_layer(self):
        _, model = _build_html_and_model()
        layer_keys = [layer["key"] for layer in model["layers"]]
        cp_idx = layer_keys.index("semantic:on_constrained_path")
        checked = {cp_idx}

        node_mem = _node_memberships(model)
        edge_mem = _edge_memberships(model)
        cp_layer = _layers_by_key(model)["semantic:on_constrained_path"]
        cp_node_set = set(cp_layer["nodes"])
        cp_edge_set = set(cp_layer["edges"])

        # Every node IN the constrained-path layer is visible.
        for n in cp_node_set:
            assert not _should_dim(
                node_mem.get(n, []), checked, len(model["layers"])
            ), f"constrained-path node {n} was wrongly dimmed"
        # Every node NOT in any layer claimed by the checked set is
        # dimmed — including all nodes whose only memberships were
        # color/style/other semantic layers.
        for n in {n["name"] for n in model["nodes"]} - cp_node_set:
            assert _should_dim(
                node_mem.get(n, []), checked, len(model["layers"])
            ), f"non-constrained-path node {n} stayed visible"
        # Edge mirror.
        for eid in cp_edge_set:
            assert not _should_dim(
                edge_mem.get(eid, []), checked, len(model["layers"])
            )
        for e in model["edges"]:
            if e["id"] in cp_edge_set:
                continue
            assert _should_dim(
                edge_mem.get(e["id"], []), checked, len(model["layers"])
            ), f"non-constrained edge {e['id']} stayed visible"

    def test_red_loop_only_visible_with_only_that_layer(self):
        _, model = _build_html_and_model()
        layer_keys = [layer["key"] for layer in model["layers"]]
        rl_idx = layer_keys.index("semantic:in_red_loop")
        checked = {rl_idx}

        edge_mem = _edge_memberships(model)
        rl_layer = _layers_by_key(model)["semantic:in_red_loop"]
        rl_edge_set = set(rl_layer["edges"])

        # Hub belongs to the red-loop layer (definition-level).
        node_mem = _node_memberships(model)
        assert not _should_dim(
            node_mem.get("HUB", []), checked, len(model["layers"])
        )

        # No black/blue edge survives in red-loop-only view.
        edges_by_id = {e["id"]: e for e in model["edges"]}
        for e in model["edges"]:
            if e["id"] in rl_edge_set:
                continue
            assert _should_dim(
                edge_mem.get(e["id"], []), checked, len(model["layers"])
            ), (
                f"non-red-loop edge {e['id']} "
                f"(color={edges_by_id[e['id']]['attrs'].get('color')!r}) "
                f"stayed visible"
            )

    def test_reconnectable_only_visible_with_only_that_layer(self):
        _, model = _build_html_and_model()
        layer_keys = [layer["key"] for layer in model["layers"]]
        rec_idx = layer_keys.index("style:dashed")
        checked = {rec_idx}

        edge_mem = _edge_memberships(model)
        rec_layer = _layers_by_key(model)["style:dashed"]
        rec_edge_set = set(rec_layer["edges"])

        # Dashed edges visible.
        for eid in rec_edge_set:
            assert not _should_dim(
                edge_mem.get(eid, []), checked, len(model["layers"])
            )
        # Coloured non-dashed edges (e.g. blue, coral) must NOT be
        # visible — that was the explicit bug the user reported.
        for e in model["edges"]:
            if e["id"] in rec_edge_set:
                continue
            assert _should_dim(
                edge_mem.get(e["id"], []), checked, len(model["layers"])
            ), f"non-dashed edge {e['id']} stayed visible"

    def test_non_reconnectable_only_visible_with_only_that_layer(self):
        _, model = _build_html_and_model()
        layer_keys = [layer["key"] for layer in model["layers"]]
        nr_idx = layer_keys.index("style:dotted")
        checked = {nr_idx}

        edge_mem = _edge_memberships(model)
        nr_layer = _layers_by_key(model)["style:dotted"]
        nr_edge_set = set(nr_layer["edges"])

        for eid in nr_edge_set:
            assert not _should_dim(
                edge_mem.get(eid, []), checked, len(model["layers"])
            )
        # Coloured non-dotted edges must NOT survive.
        for e in model["edges"]:
            if e["id"] in nr_edge_set:
                continue
            assert _should_dim(
                edge_mem.get(e["id"], []), checked, len(model["layers"])
            )


# ---------------------------------------------------------------------
# Co-Study4Grid overlay carries the dblclick→SLD wiring
# ---------------------------------------------------------------------

class TestOverlayDoubleClickWiring:
    def test_overflow_html_includes_dblclick_postmessage(self):
        html, _ = _build_html_and_model()
        # Upstream JS forwards dblclick to the parent window.
        assert "cs4g:overflow-node-double-clicked" in html

    def test_inject_overlay_does_not_strip_dblclick_wiring(self):
        html, _ = _build_html_and_model()
        injected = inject_overlay(html)
        assert "cs4g:overflow-node-double-clicked" in injected
        # Overlay-side script also present.
        assert "cs4g-overlay-script" in injected


# ---------------------------------------------------------------------
# End-to-end against the user's small-grid config (P.SAOL31RONCI)
# ---------------------------------------------------------------------

class TestSmallGridOverflowGraphLayers:
    """Regression test against the actual ``Overflow_Graph_P.SAOL31RONCI*.html``
    produced by the recommender on the bare_env_small_grid_test fixture.

    Skipped if the HTML hasn't been generated yet (e.g. a fresh
    checkout running tests before any analysis run). The asserts
    capture the user-reported bug class — extras nodes leaking into
    the constrained-path layer and missing hub auto-flags."""

    # Resolve relative to the project root so the test works on any
    # checkout (CI, dev machine, container) — not just the original
    # author's home dir.  Test file lives at
    # ``<root>/expert_backend/tests/test_overflow_html_dim_logic.py``,
    # so the project root is two parents above this file.
    PROJECT_ROOT = Path(__file__).resolve().parents[2]
    HTML_PATH = str(
        PROJECT_ROOT
        / "Overflow_Graph"
        / (
            "Overflow_Graph_P.SAOL31RONCI_chronic_grid.xiidm_"
            "timestep_9_hierarchi_only_signif_edges_no_consoli.html"
        )
    )

    def _load_model(self):
        import os
        if not os.path.isfile(self.HTML_PATH):
            pytest.skip(f"Generated HTML not present: {self.HTML_PATH}")
        with open(self.HTML_PATH, "r", encoding="utf-8") as fh:
            html = fh.read()
        import re
        m = re.search(r"const MODEL = (\{.*?\});\n\(function", html, re.S)
        return json.loads(m.group(1))

    def _layers(self, model):
        return {layer["key"]: layer for layer in model["layers"]}

    def test_constrained_path_does_not_include_side_branch_nodes(self):
        """Side-branch nodes (e.g. MAGNYP3, MAGNYP6, ZCRIMP3) live in
        ``other_blue_nodes`` upstream — they must NOT appear on the
        strict constrained path."""
        model = self._load_model()
        cp = self._layers(model).get("semantic:on_constrained_path")
        assert cp is not None
        cp_nodes = set(cp["nodes"])
        forbidden = {"MAGNYP3", "MAGNYP6", "ZCRIMP3"}
        leak = cp_nodes & forbidden
        assert not leak, f"Side-branch nodes leaked into constrained path: {leak}"

    def test_constrained_path_excludes_coral_edges(self):
        model = self._load_model()
        cp = self._layers(model).get("semantic:on_constrained_path")
        edges_by_id = {e["id"]: e for e in model["edges"]}
        for eid in cp["edges"]:
            color = edges_by_id[eid]["attrs"].get("color", "")
            base = (
                color.split(":", 1)[0].strip().strip('"').lower()
                if isinstance(color, str)
                else ""
            )
            assert base != "coral", (
                f"coral edge {eid} (color={color!r}) on constrained path"
            )

    def test_every_hub_is_in_red_loop_and_on_constrained_path(self):
        """Hubs are by definition in both layers — verify on real data."""
        model = self._load_model()
        layers = self._layers(model)
        hubs = layers.get("semantic:is_hub")
        rl = layers.get("semantic:in_red_loop")
        cp = layers.get("semantic:on_constrained_path")
        assert hubs and rl and cp
        rl_set, cp_set = set(rl["nodes"]), set(cp["nodes"])
        for h in hubs["nodes"]:
            assert h in rl_set, f"hub {h} missing from red-loop layer"
            assert h in cp_set, f"hub {h} missing from constrained-path layer"

    def test_overload_layer_has_exactly_the_overload(self):
        """Only the BEON-CPVAN overloaded line (1 edge) should be
        flagged ``is_overload`` for this scenario."""
        model = self._load_model()
        ovl = self._layers(model).get("semantic:is_overload")
        assert ovl is not None
        assert len(ovl["edges"]) == 1, (
            f"expected exactly 1 overload edge, got {len(ovl['edges'])}"
        )

    def test_every_red_loop_edge_has_endpoints_among_red_loop_nodes(self):
        """Source-of-truth invariant: every in_red_loop edge connects
        two nodes that are themselves in_red_loop. Both come from the
        recommender's ``get_dispatch_edges_nodes(only_loop_paths=True)``
        — the line filter keeps only edges whose endpoints are in the
        node list, so this invariant is symmetric by construction."""
        model = self._load_model()
        rl = self._layers(model).get("semantic:in_red_loop")
        edges_by_id = {e["id"]: e for e in model["edges"]}
        rl_node_set = set(rl["nodes"])
        for eid in rl["edges"]:
            e = edges_by_id[eid]
            assert e["source"] in rl_node_set, (
                f"red-loop edge {eid} source {e['source']!r} not in red-loop nodes"
            )
            assert e["target"] in rl_node_set, (
                f"red-loop edge {eid} target {e['target']!r} not in red-loop nodes"
            )

    def test_user_listed_edges_ARE_on_constrained_path(self):
        """Direct twin of the user's complaint: the four edges they
        called out as missing must be on the constrained-path layer."""
        model = self._load_model()
        cp = self._layers(model).get("semantic:on_constrained_path")
        edges_by_id = {e["id"]: e for e in model["edges"]}
        cp_set = set(cp["edges"])
        # (source, target, expected line names — BLUE only; the dimgray
        # CPVANY632 is NOT on CP because it's null-flow)
        wanted = {
            ("SSV.OP7", "GROSNP7"): {"GROSNL71SSV.O"},
            ("CHALOP6", "CPVANP6"): {"CHALOL61CPVAN"},
            ("CPVANP6", "CPVANP3"): {"CPVANY631", "CPVANY633"},
            ("VIELMP7", "VIELMP6"): {"VIELMY762", "VIELMY763"},
        }
        for (s, t), expected_names in wanted.items():
            on_cp = set()
            for e in model["edges"]:
                if (e["source"] == s and e["target"] == t) or (
                    e["source"] == t and e["target"] == s
                ):
                    if e["id"] in cp_set:
                        on_cp.add(e["attrs"].get("name"))
            assert expected_names <= on_cp, (
                f"{s}↔{t}: expected {expected_names} on CP, got {on_cp}"
            )

    def test_svg_data_attrs_consistent_with_titles(self):
        """Regression for the user-reported edge-id misalignment:
        graphviz emits SVG and JSON edge IDs in independent orders, so
        before the alignment pass the SVG element ``edgeN`` could carry
        ``data-source`` / ``data-target`` referring to a different edge
        than its own ``<title>`` says. After the fix, every SVG edge's
        title and data-* attributes must agree."""
        import html as _html_mod
        import os
        if not os.path.isfile(self.HTML_PATH):
            pytest.skip(f"Generated HTML not present: {self.HTML_PATH}")
        with open(self.HTML_PATH, "r", encoding="utf-8") as f:
            html = f.read()
        svg_block = re.search(r"<svg[^>]*>.*?</svg>", html, re.S).group(0)
        edge_blocks = re.findall(
            r'<g id="(edge\d+)" class="edge"[^>]*'
            r'data-source="([^"]*)"[^>]*data-target="([^"]*)"[^>]*>'
            r'\s*<title>([^<]*)</title>',
            svg_block,
        )
        assert edge_blocks, "no edge blocks parsed"
        mismatches = []
        for gid, src, tgt, title in edge_blocks:
            t = _html_mod.unescape(title)
            for sep in ("->", "--"):
                if sep in t:
                    a, b = t.split(sep, 1)
                    if (a.strip(), b.strip()) != (src, tgt):
                        mismatches.append(
                            (gid, (a.strip(), b.strip()), (src, tgt))
                        )
                    break
        assert not mismatches, (
            f"{len(mismatches)} edges have title ≠ data-source/data-target: "
            + "; ".join(
                f"{gid}: title{tt} ≠ data{dd}"
                for gid, tt, dd in mismatches[:5]
            )
        )

    def test_constrained_path_only_blue_or_black_edges(self):
        """Direct twin of the user's complaint: NO non-blue/black edges
        from VIELMP7, SSV.OP7, CPVANP6, CHALOP6 (or anywhere else)
        should be on the constrained-path layer."""
        model = self._load_model()
        cp = self._layers(model).get("semantic:on_constrained_path")
        edges_by_id = {e["id"]: e for e in model["edges"]}
        leaks = []
        for eid in cp["edges"]:
            e = edges_by_id[eid]
            color = e["attrs"].get("color", "")
            base = (
                color.split(":", 1)[0].strip().strip('"').lower()
                if isinstance(color, str)
                else ""
            )
            if base not in ("blue", "black"):
                leaks.append(
                    f"{e['attrs'].get('name')} ({e['source']}→{e['target']},"
                    f" color={color!r})"
                )
        assert not leaks, (
            "Non-blue/black edges leaked into constrained path: "
            + ", ".join(leaks)
        )

    def test_red_loop_is_consistent_with_recommender_cycle_paths(self):
        """For the small-grid scenario, the recommender's
        ``red_loops.Path`` includes the cycle ``[CHALOP6, CHALOP3,
        LOUHAP3]``. Therefore the CHALOY63x transformers AND the
        dashed CHALOL31LOUHA edge are part of a red loop.

        This documents the source-of-truth contract: the viewer
        propagates whatever the recommender's structured analysis
        returned. Any disagreement with the operator's mental model
        should be raised against the recommender's ``find_loops``
        algorithm — not the viewer."""
        model = self._load_model()
        rl = self._layers(model).get("semantic:in_red_loop")
        edges_by_id = {e["id"]: e for e in model["edges"]}
        rl_names = {edges_by_id[eid]["attrs"].get("name") for eid in rl["edges"]}
        # The cycle CHALOP6→CHALOP3→LOUHAP3→...→CHALOP6 is in the
        # recommender's red_loops.Path — so the parallel transformers
        # belong to it. (See the dump in test data setup.)
        assert "CHALOY631" in rl_names
        assert "CHALOY632" in rl_names
        assert "CHALOY633" in rl_names
        rl_node_set = set(rl["nodes"])
        assert {"CHALOP6", "CHALOP3", "LOUHAP3"} <= rl_node_set
