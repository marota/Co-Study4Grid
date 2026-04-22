# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""NAD generation primitive — pure function over pypowsybl objects.

Takes a positioned network + NadParameters + optional VL focus and
returns ``{"svg", "metadata"}``. Post-processes the SVG to strip any
element that still carries a ``NaN`` attribute (rare on malformed
sub-grids — prevents rendering crashes downstream).
"""
from __future__ import annotations

import logging
import time
from typing import Any

logger = logging.getLogger(__name__)


def _strip_nan_elements(svg: str) -> str:
    """Remove any SVG element whose attributes contain the literal ``"NaN"``.

    Silent no-op on parse errors.
    """
    if "NaN" not in svg:
        return svg
    try:
        from lxml import etree
        parser = etree.XMLParser(recover=True, huge_tree=True)
        root = etree.fromstring(svg.encode("utf-8"), parser=parser)

        to_remove = [el for el in root.iter()
                     if any("NaN" in str(val) for val in el.attrib.values())]
        for el in to_remove:
            parent = el.getparent()
            if parent is not None:
                parent.remove(el)

        logger.info("[RECO] NaN-stripping complete: removed %d elements.", len(to_remove))
        return etree.tostring(root, encoding="unicode")
    except Exception as e:
        logger.warning("Warning: Failed to strip NaN from SVG: %s", e)
        return svg


def generate_diagram(
    network: Any,
    df_layout: Any = None,
    nad_parameters: Any = None,
    voltage_level_ids: list[str] | None = None,
    depth: int = 0,
) -> dict:
    """Generate a NAD for ``network`` and return ``{"svg", "metadata"}``.

    ``df_layout`` is the pre-loaded ``grid_layout`` DataFrame (pass
    ``None`` to let pypowsybl auto-layout). ``voltage_level_ids`` +
    ``depth`` produce a focused sub-diagram; omit for the full grid.
    """
    from pypowsybl_jupyter.util import _get_svg_metadata, _get_svg_string

    logger.info("[RECO] Generating diagram (VLs=%s, depth=%d)...", voltage_level_ids, depth)
    t0 = time.time()

    kwargs: dict = {"nad_parameters": nad_parameters}
    if df_layout is not None:
        kwargs["fixed_positions"] = df_layout
    if voltage_level_ids is not None:
        kwargs["voltage_level_ids"] = voltage_level_ids
        kwargs["depth"] = depth

    diagram = network.get_network_area_diagram(**kwargs)
    t1 = time.time()

    svg = _get_svg_string(diagram)
    t2 = time.time()

    meta = _get_svg_metadata(diagram)
    t3 = time.time()

    logger.info(
        "[RECO] Diagram generated: NAD %.2fs, SVG %.2fs, Meta %.2fs (SVG length=%d)",
        t1 - t0, t2 - t1, t3 - t2, len(svg),
    )

    svg = _strip_nan_elements(svg)
    return {"svg": svg, "metadata": meta}
