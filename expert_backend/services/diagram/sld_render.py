# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""SLD (Single Line Diagram) extraction helpers."""
from __future__ import annotations

import logging
from typing import Any

logger = logging.getLogger(__name__)


def extract_sld_svg_and_metadata(sld: Any) -> tuple:
    """Extract ``(svg, metadata)`` from a pypowsybl SLD diagram object.

    The metadata JSON contains ``feederNodes`` with ``{id, equipmentId}``
    entries that map SVG element IDs back to network equipment IDs.
    Falls back to ``sld._repr_svg_()`` / ``sld._metadata`` when the
    primary extraction raises.
    """
    try:
        from pypowsybl_jupyter.util import _get_svg_metadata, _get_svg_string
        svg = _get_svg_string(sld)
        metadata = _get_svg_metadata(sld)
    except Exception as e:
        logger.debug("Primary SLD extraction failed, trying fallback: %s", e)
        try:
            svg = sld._repr_svg_()
        except Exception as e:
            logger.debug("SVG extraction fallback: %s", e)
            svg = str(sld)
        metadata = getattr(sld, "_metadata", None)
    return svg, metadata
