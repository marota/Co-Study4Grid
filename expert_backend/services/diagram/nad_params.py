# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Default ``NadParameters`` factory for NAD generation.

Centralised so the performance tuning (layout type, precision, toggles)
lives in one place instead of being inlined in the mixin.

Measured trade-offs (see docs/performance/history/):

  layout_type=GEOGRAPHICAL (vs FORCE_LAYOUT):    ~-450 ms
  bus_legend=False:                               ~-110 ms, ~-1.0 MB
  substation_description_displayed=False:         ~-0.2 MB
  power_value_precision=0 (vs 1):                 few chars per label
  injections_added=False (default):               keeps SVG small

Combined gain vs prior defaults:                  ~-130 ms, ~-1.2 MB.

The ``force_layout`` opt-in flag swaps GEOGRAPHICAL for FORCE_LAYOUT at
~+450 ms generation cost. It is intended as an escape hatch for
PyPSA-derived grids whose collocated voltage levels (e.g. Paris,
Lyon on the French 225/400 kV slice) chevauchent visuellement when
rendered at their real lat/lon coordinates. The force layout
spreads them out at the cost of losing geographic faithfulness.
"""
from __future__ import annotations


def default_nad_parameters(*, force_layout: bool = False):
    """Return the default ``NadParameters`` used by every diagram call.

    Pass ``force_layout=True`` to switch from GEOGRAPHICAL to
    FORCE_LAYOUT. Geographic layout is the default because it preserves
    real-world positioning and saves ~450 ms on large grids; force
    layout is the readability fallback for dense urban substations.
    """
    from pypowsybl.network import NadLayoutType, NadParameters
    layout = NadLayoutType.FORCE_LAYOUT if force_layout else NadLayoutType.GEOGRAPHICAL
    return NadParameters(
        edge_name_displayed=False,
        id_displayed=False,
        edge_info_along_edge=True,
        power_value_precision=0,
        angle_value_precision=0,
        current_value_precision=1,
        voltage_value_precision=0,
        bus_legend=False,
        substation_description_displayed=False,
        voltage_level_details=False,
        injections_added=False,
        layout_type=layout,
    )
