# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid.

"""Unit tests for :mod:`expert_backend.services.diagram_mixin`.

Focused on invariants guaranteed by :meth:`DiagramMixin._default_nad_parameters`:
in particular the ``layout_type=GEOGRAPHICAL`` choice which — paired with
the ``fixed_positions`` passed from ``grid_layout.json`` — skips pypowsybl's
force-directed refinement step and cuts NAD generation by ~11 % on large
grids (see commit 413fa61).
"""
from __future__ import annotations

import pytest

pypowsybl = pytest.importorskip("pypowsybl")

from pypowsybl.network import NadLayoutType, NadParameters

from expert_backend.services.diagram_mixin import DiagramMixin


class TestDefaultNadParameters:
    """Guard against regressions on the NAD parameter defaults.

    The GEOGRAPHICAL layout is a deliberate choice — reverting to the
    default FORCE_LAYOUT would silently add ~450 ms per NAD generation
    on the PyPSA-EUR France 118 MB grid. See
    ``docs/perf-geographical-layout.md`` and the docstring on
    :meth:`DiagramMixin._default_nad_parameters`.
    """

    def test_returns_nad_parameters_instance(self):
        mixin = DiagramMixin()
        params = mixin._default_nad_parameters()
        assert isinstance(params, NadParameters)

    def test_uses_geographical_layout_type(self):
        """layout_type must be GEOGRAPHICAL (not FORCE_LAYOUT).

        Regression guard: if someone reverts to `FORCE_LAYOUT` (or removes
        the kwarg so pypowsybl defaults apply), NAD gen slows back down.
        """
        mixin = DiagramMixin()
        params = mixin._default_nad_parameters()
        # The NadParameters Java wrapper doesn't expose layout_type as a
        # readable attribute on every pypowsybl version, so we verify via
        # a patched NadParameters constructor (next test).
        # Here we just make sure the call does not blow up when the enum
        # value is applied.
        assert params is not None

    def test_passes_geographical_layout_type_to_constructor(self, mocker=None):
        """Verify NadParameters is invoked with layout_type=GEOGRAPHICAL."""
        from unittest.mock import patch

        mixin = DiagramMixin()
        with patch("pypowsybl.network.NadParameters") as mock_cls:
            mock_cls.return_value = object()
            mixin._default_nad_parameters()
            mock_cls.assert_called_once()
            kwargs = mock_cls.call_args.kwargs
            assert "layout_type" in kwargs, (
                "NadParameters must receive an explicit layout_type kwarg"
            )
            assert kwargs["layout_type"] == NadLayoutType.GEOGRAPHICAL, (
                f"Expected GEOGRAPHICAL layout, got {kwargs['layout_type']!r}. "
                "Reverting to FORCE_LAYOUT would regress NAD gen by ~11 % "
                "on 118 MB grids."
            )

    def test_other_expected_parameters_still_present(self):
        """Companion kwargs must remain — no accidental regression of the
        legend / precision / edge-info flags we've tuned over time."""
        from unittest.mock import patch

        mixin = DiagramMixin()
        with patch("pypowsybl.network.NadParameters") as mock_cls:
            mock_cls.return_value = object()
            mixin._default_nad_parameters()
            kwargs = mock_cls.call_args.kwargs

        expected = {
            "edge_name_displayed": False,
            "id_displayed": False,
            "edge_info_along_edge": True,
            "power_value_precision": 1,
            "angle_value_precision": 0,
            "current_value_precision": 1,
            "voltage_value_precision": 0,
            "bus_legend": True,
            "substation_description_displayed": True,
        }
        for key, value in expected.items():
            assert kwargs.get(key) == value, (
                f"NadParameters kwarg {key!r} expected {value!r}, got {kwargs.get(key)!r}"
            )
