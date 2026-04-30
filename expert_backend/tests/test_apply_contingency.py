# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Tests for ``RecommenderService._apply_contingency``.

Regression guard. ``pypowsybl.network.disconnect()`` silently returns
``False`` on some grids (small test grids, certain RTE xiidm exports)
when the equipment's terminals don't expose the breaker model the
high-level API expects. The previous ``try / except Exception`` in
``_get_n1_variant`` caught only raised exceptions, missed the False
return, and left the N-1 variant identical to N — every overload-
dependent UI element (sidebar N-1 overloads, orange halos on the N-1
diagram) then reported "no overloads" even when step1 (which runs
through grid2op's own network) correctly detected them.

The helper must fall back to ``update_lines`` /
``update_2_windings_transformers`` so the variant reflects the
contingency regardless of which pypowsybl API path works.
"""
from __future__ import annotations

from unittest.mock import MagicMock

import pandas as pd

from expert_backend.services.recommender_service import RecommenderService


def _make_net(disconnect_return, line_ids=("LINE_A",), tfo_ids=()):
    net = MagicMock(name="net")
    net.disconnect = MagicMock(return_value=disconnect_return)
    net.update_lines = MagicMock()
    net.update_2_windings_transformers = MagicMock()
    net.get_lines = MagicMock(return_value=pd.DataFrame(index=list(line_ids)))
    net.get_2_windings_transformers = MagicMock(
        return_value=pd.DataFrame(index=list(tfo_ids))
    )
    return net


def test_disconnect_success_skips_fallback():
    service = RecommenderService()
    net = _make_net(disconnect_return=True)
    assert service._apply_contingency(net, "LINE_A") is True
    net.disconnect.assert_called_once_with("LINE_A")
    net.update_lines.assert_not_called()
    net.update_2_windings_transformers.assert_not_called()


def test_falls_back_to_update_lines_when_disconnect_returns_false():
    """Real-world regression: pypowsybl returned False silently for
    P.SAOL31RONCI on the bare_env_small_grid_test grid, leaving the
    N-1 variant identical to N and blanking the sidebar overloads +
    orange halos."""
    service = RecommenderService()
    net = _make_net(disconnect_return=False)
    assert service._apply_contingency(net, "LINE_A") is True
    net.update_lines.assert_called_once_with(
        id="LINE_A", connected1=False, connected2=False
    )
    net.update_2_windings_transformers.assert_not_called()


def test_falls_back_to_update_2wt_for_transformer():
    service = RecommenderService()
    net = _make_net(disconnect_return=False, line_ids=(), tfo_ids=("TRAFO_1",))
    assert service._apply_contingency(net, "TRAFO_1") is True
    net.update_2_windings_transformers.assert_called_once_with(
        id="TRAFO_1", connected1=False, connected2=False
    )
    net.update_lines.assert_not_called()


def test_disconnect_exception_also_triggers_fallback():
    service = RecommenderService()
    net = _make_net(disconnect_return=False)
    net.disconnect = MagicMock(side_effect=RuntimeError("boom"))
    assert service._apply_contingency(net, "LINE_A") is True
    net.update_lines.assert_called_once()


def test_returns_false_when_element_not_found():
    """Unknown equipment id — no fallback available; log + return
    False so the caller can surface the issue."""
    service = RecommenderService()
    net = _make_net(disconnect_return=False, line_ids=(), tfo_ids=())
    assert service._apply_contingency(net, "MYSTERY_X") is False
    net.update_lines.assert_not_called()
    net.update_2_windings_transformers.assert_not_called()
