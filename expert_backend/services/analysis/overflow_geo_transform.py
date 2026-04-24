# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Client-side-free repositioning of the overflow-graph HTML.

The ``expert_op4grid_recommender`` library produces an interactive
overflow HTML with graphviz's *hierarchical* (``dot``) layout.  That
file contains a fully-styled SVG (colours, arrows, overloads,
tooltips, search, layer toggles — all preserved).  Each node carries
a ``data-name`` attribute that matches the substation ID used in
``grid_layout.json``.

For the "Geo" toggle on the Overflow Analysis tab we want substations
placed at their geographical coordinates **without** round-tripping
through graphviz again.  This module reads a hierarchical HTML,
rewrites the SVG geometry using a layout map, and returns the
transformed HTML string.

The transform is purely structural: no graphviz, no
``expert_op4grid_recommender.config`` flags, no ``env.name_sub``
alignment.  Any node whose ``data-name`` is absent from the layout
map keeps its original hierarchical position — the caller gets a
mixed-mode graph instead of a 400 — and the helper logs which names
were missing so operators can fix the file.

Design notes:
* Node repositioning is done by wrapping the node group's inner
  children in ``<g transform="translate(dx, -dy)">``.  This avoids
  having to walk every inner SVG primitive (ellipse, polygon, text,
  nested paths …) and preserves their internal relationships (label
  offset from circle centre, multi-shape nodes …).  The SVG y-axis
  grows down while graphviz (and ``data-attr-pos``) uses y-up, so the
  vertical delta is negated.
* Edges are redrawn as straight lines between the new node centres.
  The original ``dot`` spline routing is discarded because it is
  optimised for a layered layout, not a geographic one — a straight
  "as-the-crow-flies" edge is the right visual for geo anyway.
* The viewBox is preserved; layout coordinates are fitted uniformly
  into it (with a small margin) so geographic aspect ratio is kept.
"""
from __future__ import annotations

import logging
import math
import re
from typing import Mapping

from lxml import etree

logger = logging.getLogger(__name__)

# Graphviz's SVG puts a top-level `scale(1 1) translate(4 -1868.2)`
# wrapper that flips the y-axis so children can use y-up positions.
# When we insert additional coordinates (edge paths, arrowheads, edge
# label text) we therefore negate y to stay consistent with the
# ellipse `cy="-Y"` convention the file already uses.

_ARROW_LEN = 14.0   # px, size of the redrawn arrowhead
_ARROW_HALF = 6.0   # px, half-width of the arrowhead base
_MARGIN = 40.0      # px, inner padding inside the viewBox when fitting
                    # the layout bbox
_NODE_GAP = 18.0    # px, pull the arrowhead back this much from the
                    # target node's centre so the tip lands on the
                    # node's outline, not inside it
_NODE_RADIUS_PX = 27.0  # matches the `rx` the library's graphviz
                        # output uses on ellipses — the default node
                        # width (0.75in × 72pt/in) rounded to the
                        # graphviz shape.
_TARGET_SPACING_RATIO = 6.0  # target average inter-node distance,
                             # expressed as multiples of node radius.
                             # Keeps edges visible with a clear tail
                             # and leaves room for the midpoint label.
_MIN_VIEWBOX_DIM = 600.0     # px, viewBox floor so tiny grids still
                             # get a usable canvas.
_MAX_VIEWBOX_DIM = 4000.0    # px, viewBox ceiling so extreme spread
                             # grids don't blow up the iframe.


def _fmt(v: float) -> str:
    """Trim trailing zeros on the SVG attribute float formatting."""
    return f"{v:.3f}".rstrip("0").rstrip(".")


def _local_tag(elem) -> str:
    """Tag name without XML namespace prefix. Returns '' for
    non-Element nodes (lxml exposes XML comments and PIs with a
    callable `.tag` attribute)."""
    tag = elem.tag
    if not isinstance(tag, str):
        return ""
    return tag.rpartition("}")[-1] if "}" in tag else tag


def _has_class(elem, cls: str) -> bool:
    raw = elem.get("class")
    if not raw:
        return False
    return cls in raw.split()


def transform_html(html: str, layout: Mapping[str, tuple[float, float]]) -> str:
    """Return a copy of ``html`` with its SVG nodes placed at
    geographical coordinates taken from ``layout`` and edges redrawn
    as straight lines.

    Parameters
    ----------
    html : str
        The full hierarchical overflow-graph HTML, as produced by
        ``make_overflow_graph_visualization`` → alphaDeesp Printer.
    layout : Mapping[str, tuple[float, float]]
        Substation id → (x, y) in whatever units the operator's
        ``grid_layout.json`` uses. The bounding box is fitted
        uniformly into the existing SVG viewBox, so the absolute
        scale of ``layout`` does not matter — only the relative
        positions.

    Returns
    -------
    str
        Transformed HTML.  Raises ``ValueError`` when the HTML does
        not contain an ``<svg>`` block or no positioned nodes.
    """
    svg_match = re.search(r"<svg[^>]*>.*?</svg>", html, re.DOTALL)
    if not svg_match:
        raise ValueError("Hierarchical overflow HTML has no <svg> block")

    svg_str = svg_match.group(0)
    parser = etree.XMLParser(remove_blank_text=False, recover=True)
    svg_root = etree.fromstring(svg_str.encode("utf-8"), parser)
    if svg_root is None:
        raise ValueError("Could not parse <svg> block")

    # --------------------------------------------------------------
    # 1. Collect current node positions from data-attr-pos
    # --------------------------------------------------------------
    nodes_by_name: dict[str, etree._Element] = {}
    old_positions: dict[str, tuple[float, float]] = {}
    for g in svg_root.iter():
        if _local_tag(g) != "g" or not _has_class(g, "node"):
            continue
        name = g.get("data-name")
        pos_attr = g.get("data-attr-pos")
        if not name or not pos_attr:
            continue
        try:
            ox_str, oy_str = pos_attr.split(",")
            ox, oy = float(ox_str), float(oy_str)
        except ValueError:
            continue
        nodes_by_name[name] = g
        old_positions[name] = (ox, oy)

    if not old_positions:
        raise ValueError("No positioned nodes (data-attr-pos) found in SVG")

    matched = [layout[n] for n in old_positions if n in layout]
    missing = [n for n in old_positions if n not in layout]
    if missing:
        logger.warning(
            "Overflow geo transform: %d/%d HTML nodes have no layout entry "
            "— they will keep their hierarchical position. Missing sample: %r.",
            len(missing), len(old_positions), missing[:5],
        )
    if not matched:
        raise ValueError(
            "None of the HTML node names match entries in the layout map; "
            "cannot build a geo layout."
        )

    # --------------------------------------------------------------
    # 2. Choose scale from layout spacing + rewrite viewBox
    # --------------------------------------------------------------
    # The library's hierarchical HTML uses a narrow viewBox
    # (optimised for graphviz's top-down tree layout). Fitting a wide
    # geographic bbox into it squashes everything horizontally and the
    # straight-line edges end up almost fully hidden behind the two
    # node circles — only the arrowhead peeks out. We fix this by:
    #   (a) picking a scale that makes the average inter-substation
    #       distance ≈ _TARGET_SPACING_RATIO × node radius, so edges
    #       keep a clear tail,
    #   (b) rewriting the SVG viewBox to the natural aspect ratio of
    #       the layout bbox, and
    #   (c) re-anchoring the graphviz top-level
    #       `<g class="graph"> transform="... translate(Ox Oy)"` so
    #       its y-down/y-up flip lands the content inside the new
    #       viewBox.
    min_lx = min(p[0] for p in matched)
    max_lx = max(p[0] for p in matched)
    min_ly = min(p[1] for p in matched)
    max_ly = max(p[1] for p in matched)
    span_x = max_lx - min_lx or 1.0
    span_y = max_ly - min_ly or 1.0

    scale = _scale_for_target_spacing(matched)

    # Natural viewBox size from the chosen scale.
    natural_w = span_x * scale + 2 * _MARGIN
    natural_h = span_y * scale + 2 * _MARGIN
    # Clamp the LARGER dimension to [_MIN_VIEWBOX_DIM, _MAX_VIEWBOX_DIM]
    # and rescale the other side proportionally so the geographic
    # aspect ratio is preserved even at the caps.
    largest = max(natural_w, natural_h)
    if largest < _MIN_VIEWBOX_DIM:
        boost = _MIN_VIEWBOX_DIM / largest
        scale *= boost
        natural_w *= boost
        natural_h *= boost
    elif largest > _MAX_VIEWBOX_DIM:
        shrink = _MAX_VIEWBOX_DIM / largest
        scale *= shrink
        natural_w *= shrink
        natural_h *= shrink
    new_w, new_h = natural_w, natural_h

    svg_root.set("viewBox", f"0 0 {_fmt(new_w)} {_fmt(new_h)}")
    svg_root.set("width", f"{_fmt(new_w)}pt")
    svg_root.set("height", f"{_fmt(new_h)}pt")
    _reanchor_graph_transform(svg_root, new_h)

    def project(lx: float, ly: float) -> tuple[float, float]:
        """Layout (x, y) → graphviz-local (x, y_up). The graph-level
        transform maps this to screen via translate(MARGIN, new_h - MARGIN)
        + cy=-Y_up → screen_y = (new_h - MARGIN) - Y_up."""
        return (lx - min_lx) * scale, (ly - min_ly) * scale

    new_positions: dict[str, tuple[float, float]] = {}
    for name, old in old_positions.items():
        new_positions[name] = project(*layout[name]) if name in layout else old

    # --------------------------------------------------------------
    # 3. Reposition each node group
    # --------------------------------------------------------------
    for name, g in nodes_by_name.items():
        ox, oy = old_positions[name]
        nx, ny = new_positions[name]
        dx, dy = nx - ox, ny - oy
        if dx == 0 and dy == 0:
            continue  # unchanged (unmatched node)
        # Wrap children in an inner translate-<g>.  Graphviz y-up vs
        # SVG y-down: graphviz `cy="-Y"` means "visually up" for a
        # positive Y input.  A positive geographic dy should therefore
        # move the node visually up in the rendered SVG, which
        # corresponds to a NEGATIVE translation on the svg's own y
        # axis.  Hence `-dy`.
        children = list(g)
        wrapper = etree.SubElement(g, "g")
        wrapper.set("transform", f"translate({_fmt(dx)} {_fmt(-dy)})")
        # Keep <title> at the top level of the node group for a11y /
        # tooltip libraries that read it directly.
        for child in children:
            tag = _local_tag(child)
            if tag == "title":
                continue  # leave <title> untranslated
            g.remove(child)
            wrapper.append(child)
        # Also update data-attr-pos so re-transforming (e.g. clicking
        # Geo again after a fresh Step-2) picks up the new position.
        g.set("data-attr-pos", f"{_fmt(nx)},{_fmt(ny)}")

    # --------------------------------------------------------------
    # 4. Redraw edges as straight lines
    # --------------------------------------------------------------
    for g in svg_root.iter():
        if _local_tag(g) != "g" or not _has_class(g, "edge"):
            continue
        src = g.get("data-source")
        tgt = g.get("data-target")
        if not src or not tgt:
            continue
        if src not in new_positions or tgt not in new_positions:
            continue
        sx, sy = new_positions[src]
        tx, ty = new_positions[tgt]
        # Graphviz flips y at the top of the tree: we output
        # `M sx,-sy L tx,-ty` so paths render correctly.
        sxn, syn = sx, -sy
        txn, tyn = tx, -ty
        # Pull the arrowhead slightly back so its tip lands on the
        # node outline rather than the node centre.
        ex, ey = _pull_back(sxn, syn, txn, tyn, _NODE_GAP)

        for child in g.iter():
            tag = _local_tag(child)
            if tag == "path":
                child.set("d", f"M{_fmt(sxn)},{_fmt(syn)} L{_fmt(ex)},{_fmt(ey)}")
            elif tag == "polygon":
                child.set("points", _arrowhead_points(sxn, syn, ex, ey))
            elif tag == "text":
                # Edge label sits at midpoint.
                mx = (sxn + ex) / 2
                my = (syn + ey) / 2
                child.set("x", _fmt(mx))
                child.set("y", _fmt(my))

    # --------------------------------------------------------------
    # 5. Serialise back
    # --------------------------------------------------------------
    new_svg = etree.tostring(svg_root, pretty_print=False).decode("utf-8")
    return html[: svg_match.start()] + new_svg + html[svg_match.end():]


def _pull_back(sx: float, sy: float, tx: float, ty: float, distance: float) -> tuple[float, float]:
    """Return a point on the segment (sx,sy)->(tx,ty) that sits
    ``distance`` px short of (tx,ty).  If the segment is too short,
    returns (tx, ty) unchanged."""
    dx, dy = tx - sx, ty - sy
    length = math.hypot(dx, dy)
    if length <= distance or length == 0:
        return tx, ty
    ratio = (length - distance) / length
    return sx + dx * ratio, sy + dy * ratio


def _scale_for_target_spacing(points: list[tuple[float, float]]) -> float:
    """Pick a layout-to-viewBox scale so the median nearest-neighbour
    distance between points becomes ``_TARGET_SPACING_RATIO × node
    radius`` pixels.  That keeps edge tails visible without letting
    one far-away substation blow up the overall canvas (as a bbox /
    mean-distance scaling would).  Falls back to 1.0 when fewer than
    two points are available."""
    if len(points) < 2:
        return 1.0
    # Nearest-neighbour distance per point, then the median over the
    # whole set — O(N²) but N is the number of substations in the
    # overflow graph (typically < 500, usually dozens).
    nearest: list[float] = []
    for i, (ax, ay) in enumerate(points):
        best = float("inf")
        for j, (bx, by) in enumerate(points):
            if i == j:
                continue
            d = math.hypot(ax - bx, ay - by)
            if d < best:
                best = d
        if best != float("inf") and best > 0:
            nearest.append(best)
    if not nearest:
        return 1.0
    nearest.sort()
    median = nearest[len(nearest) // 2]
    target_px = _TARGET_SPACING_RATIO * _NODE_RADIUS_PX
    return target_px / median


def _reanchor_graph_transform(svg_root, new_h: float) -> None:
    """Rewrite the top-level ``<g class="graph"> transform`` so its
    y-flip lands on the new viewBox.  The library emits something like
    ``scale(1 1) rotate(0) translate(4 1352)`` where 1352 was the
    original viewBox height.  We replace the last translate pair with
    ``translate(MARGIN, new_h - MARGIN)`` so ``cy=-Y_up`` renders at
    ``screen_y = (new_h - MARGIN) - Y_up``, inside the padded new
    viewBox."""
    for g in svg_root.iter():
        if _local_tag(g) != "g" or not _has_class(g, "graph"):
            continue
        t = g.get("transform", "")
        new_translate = f"translate({_fmt(_MARGIN)} {_fmt(new_h - _MARGIN)})"
        if "translate(" in t:
            t = re.sub(r"translate\([^)]*\)", new_translate, t)
        else:
            t = f"{t} {new_translate}".strip()
        g.set("transform", t)
        return


def _arrowhead_points(sx: float, sy: float, ex: float, ey: float) -> str:
    """Return the `points` attribute for a triangular arrowhead whose
    tip is at (ex, ey) and whose base is perpendicular to the
    (sx, sy) → (ex, ey) direction with half-width ``_ARROW_HALF``."""
    dx, dy = ex - sx, ey - sy
    length = math.hypot(dx, dy)
    if length == 0:
        return f"{_fmt(ex)},{_fmt(ey)} {_fmt(ex)},{_fmt(ey)} {_fmt(ex)},{_fmt(ey)}"
    ux, uy = dx / length, dy / length           # unit along
    px, py = -uy, ux                            # unit perpendicular
    base_x = ex - ux * _ARROW_LEN
    base_y = ey - uy * _ARROW_LEN
    left_x = base_x + px * _ARROW_HALF
    left_y = base_y + py * _ARROW_HALF
    right_x = base_x - px * _ARROW_HALF
    right_y = base_y - py * _ARROW_HALF
    return (
        f"{_fmt(ex)},{_fmt(ey)} "
        f"{_fmt(left_x)},{_fmt(left_y)} "
        f"{_fmt(right_x)},{_fmt(right_y)}"
    )
