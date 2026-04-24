# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Tests for the overflow-graph geo-layout transform.

The transform takes the hierarchical overflow HTML produced by
``expert_op4grid_recommender`` and rewrites its SVG so that each
substation (``<g class="node" data-name="...">``) is placed at the
coordinates given in ``grid_layout.json`` and each edge is redrawn
as a straight line between the new node centres. These tests exercise
the pure function directly — no recommender, no graphviz.
"""
from __future__ import annotations

import re

import pytest

from expert_backend.services.analysis.overflow_geo_transform import (
    transform_html,
)


HIERARCHICAL_HTML = """\
<!doctype html>
<html><head></head><body>
<svg width="400pt" height="400pt" viewBox="0 0 400 400" xmlns="http://www.w3.org/2000/svg">
  <g class="graph">
    <g id="node1" class="node" data-name="A" data-attr-pos="10,20">
      <title>A</title>
      <ellipse cx="10" cy="-20" rx="5" ry="5" stroke="red"/>
      <text x="10" y="-18">A</text>
    </g>
    <g id="node2" class="node" data-name="B" data-attr-pos="50,60">
      <title>B</title>
      <ellipse cx="50" cy="-60" rx="5" ry="5" stroke="darkgreen"/>
      <text x="50" y="-58">B</text>
    </g>
    <g id="edge1" class="edge" data-source="A" data-target="B" data-attr-color="coral">
      <title>A-&gt;B</title>
      <path fill="none" stroke="coral" d="M 10,-20 C 20,-30 40,-50 50,-60"/>
      <polygon fill="coral" points="52,-58 48,-62 46,-60"/>
      <text x="30" y="-40">flow</text>
    </g>
  </g>
</svg>
</body></html>
"""


def _parse_ellipse_center(html: str, node_name: str) -> tuple[float, float]:
    """Return (cx, cy) of the ellipse inside the named node group,
    accounting for any wrapper `<g transform="translate(dx dy)">` the
    transform adds to reposition the node."""
    # Isolate the <g ... data-name="node_name"> group
    m = re.search(
        rf'<g[^>]*data-name="{node_name}"[^>]*>(.*?)</g>\s*(?:<g\s+data-name|</g>)',
        html,
        re.DOTALL,
    )
    if not m:
        m = re.search(
            rf'<g[^>]*data-name="{node_name}"[^>]*>(.*?)</g>',
            html,
            re.DOTALL,
        )
    assert m, f"Could not find node {node_name}"
    inner = m.group(1)
    # Find translate() wrapper if any
    tx, ty = 0.0, 0.0
    mt = re.search(r'transform="translate\(([-\d.]+)\s+([-\d.]+)\)"', inner)
    if mt:
        tx = float(mt.group(1))
        ty = float(mt.group(2))
    me = re.search(r'<ellipse[^>]*cx="([-\d.]+)"[^>]*cy="([-\d.]+)"', inner)
    assert me, f"No ellipse in node {node_name}"
    return float(me.group(1)) + tx, float(me.group(2)) + ty


def test_rejects_html_without_svg():
    with pytest.raises(ValueError, match="<svg>"):
        transform_html("<html></html>", {"A": (0, 0)})


def test_rejects_when_no_layout_overlaps():
    with pytest.raises(ValueError, match="None of the HTML node names"):
        transform_html(HIERARCHICAL_HTML, {"Z": (0, 0)})


def test_moves_matched_node_to_new_position():
    """A node whose data-name is in the layout must end up at a
    visually different ellipse centre."""
    layout = {"A": (0.0, 0.0), "B": (1000.0, 1000.0)}
    out = transform_html(HIERARCHICAL_HTML, layout)
    # Ellipse effective centres for A and B must change relative to
    # the original (10,-20) and (50,-60).
    ax, ay = _parse_ellipse_center(out, "A")
    bx, by = _parse_ellipse_center(out, "B")
    assert (ax, ay) != (10, -20)
    assert (bx, by) != (50, -60)
    # B has a larger layout (x, y) than A, so its projected x must be
    # greater (geo x-axis preserved) and its effective y must be
    # visually "higher" (i.e. smaller SVG y) because the transform
    # keeps graphviz's y-up convention.
    assert bx > ax
    assert by < ay


def test_updates_data_attr_pos_so_retransform_is_idempotent():
    """After a transform, the ``data-attr-pos`` of each moved node is
    rewritten to the new position so a second pass with the same
    layout becomes a no-op."""
    layout = {"A": (0.0, 0.0), "B": (100.0, 100.0)}
    once = transform_html(HIERARCHICAL_HTML, layout)
    twice = transform_html(once, layout)

    # The data-attr-pos must be consistent between passes.
    positions_once = re.findall(r'data-name="(\w+)" data-attr-pos="([-\d.]+,[-\d.]+)"', once)
    positions_twice = re.findall(r'data-name="(\w+)" data-attr-pos="([-\d.]+,[-\d.]+)"', twice)
    assert dict(positions_once) == dict(positions_twice)


def test_edge_redrawn_as_straight_line_between_new_centres():
    """The edge path becomes `M x1,y1 L x2,y2` (plus arrow pull-back)."""
    layout = {"A": (0.0, 0.0), "B": (1000.0, 1000.0)}
    out = transform_html(HIERARCHICAL_HTML, layout)
    # Locate the edge path
    m = re.search(
        r'<g[^>]*data-source="A"[^>]*data-target="B"[^>]*>.*?'
        r'<path[^>]*d="(M[^"]+)"',
        out,
        re.DOTALL,
    )
    assert m, "No edge path found"
    d = m.group(1)
    # The redrawn path must have exactly one M and one L.
    assert d.count("M") == 1
    assert d.count("L") == 1
    assert "C" not in d  # no bezier curve anymore


def test_edge_arrowhead_has_three_points():
    layout = {"A": (0.0, 0.0), "B": (1000.0, 1000.0)}
    out = transform_html(HIERARCHICAL_HTML, layout)
    m = re.search(
        r'<g[^>]*data-source="A"[^>]*data-target="B"[^>]*>.*?'
        r'<polygon[^>]*points="([^"]+)"',
        out,
        re.DOTALL,
    )
    assert m, "No arrowhead polygon found"
    # "x1,y1 x2,y2 x3,y3"
    pts = m.group(1).split()
    assert len(pts) == 3


def test_edge_label_placed_at_midpoint():
    layout = {"A": (0.0, 0.0), "B": (1000.0, 1000.0)}
    out = transform_html(HIERARCHICAL_HTML, layout)
    # Grab text x,y inside the edge group
    m = re.search(
        r'<g[^>]*data-source="A"[^>]*data-target="B"[^>]*>.*?'
        r'<text[^>]*x="([-\d.]+)"[^>]*y="([-\d.]+)"',
        out,
        re.DOTALL,
    )
    assert m, "No edge label text"
    # The label must no longer be at its original (30, -40) position.
    tx, ty = float(m.group(1)), float(m.group(2))
    assert (tx, ty) != (30, -40)


def test_unknown_node_kept_at_original_position():
    """A node whose data-name is absent from the layout is left where
    graphviz put it; only nodes in the layout are repositioned."""
    html = HIERARCHICAL_HTML.replace(
        '<g id="node2" class="node" data-name="B"',
        '<g id="node2" class="node" data-name="UNKNOWN"',
    ).replace(
        'data-source="A" data-target="B"', 'data-source="A" data-target="UNKNOWN"',
    ).replace(
        '<title>B</title>', '<title>UNKNOWN</title>',
    )
    layout = {"A": (0.0, 0.0)}
    out = transform_html(html, layout)
    # UNKNOWN's ellipse cx must still be 50 because the transform left
    # it alone (no wrapper <g translate>, no rewrite of data-attr-pos).
    cx, cy = _parse_ellipse_center(out, "UNKNOWN")
    assert (cx, cy) == (50, -60)


def test_preserves_styling_attributes():
    """Colors, stroke widths and tooltips survive the transform."""
    layout = {"A": (0.0, 0.0), "B": (100.0, 100.0)}
    out = transform_html(HIERARCHICAL_HTML, layout)
    assert 'stroke="red"' in out
    assert 'stroke="coral"' in out
    assert '<title>A</title>' in out
    assert 'data-name="A"' in out
    assert 'data-source="A"' in out


def test_viewbox_rewritten_to_layout_aspect_ratio():
    """The transform MUST rewrite the SVG viewBox so a wide
    geographic layout doesn't get squashed into graphviz's narrow
    hierarchical canvas — otherwise edges render with no visible
    tail (only the arrowhead peeks out from behind the target node)."""
    # Horizontally-wide layout (3:1 aspect).
    layout = {"A": (0.0, 0.0), "B": (3000.0, 1000.0)}
    out = transform_html(HIERARCHICAL_HTML, layout)
    m = re.search(r'<svg[^>]*viewBox="([^"]+)"', out)
    assert m, "Missing viewBox"
    parts = m.group(1).split()
    assert len(parts) == 4
    vb_w = float(parts[2])
    vb_h = float(parts[3])
    # Old viewBox was 400x400 (1:1) — it must have changed.
    assert (vb_w, vb_h) != (400.0, 400.0)
    # The new viewBox must roughly preserve the layout's 3:1 aspect.
    assert vb_w > vb_h


def test_graph_transform_reanchored_to_new_viewbox():
    """The top-level `<g class=graph>` transform keeps the y-flip
    landing inside the new viewBox. After the rewrite the translate
    pair reads ``(MARGIN, new_h - MARGIN)``."""
    layout = {"A": (0.0, 0.0), "B": (100.0, 100.0)}
    out = transform_html(HIERARCHICAL_HTML, layout)
    # Expect the graph-level transform to contain translate(40 ...)
    m = re.search(r'<g[^>]*class="graph"[^>]*transform="([^"]+)"', out)
    assert m, "Missing graph transform"
    assert "translate(40 " in m.group(1)
