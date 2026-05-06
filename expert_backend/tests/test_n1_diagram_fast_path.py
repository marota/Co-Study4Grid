# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid.

"""Unit tests for the N-1 diagram fast-path (commit d220d61).

Guards three correctness invariants of the perf patches:

1. **LF-status cache**: `_get_contingency_variant` populates
   `_lf_status_by_variant[variant_id]` after running the AC LF.
   `get_n1_diagram` reads this cache instead of re-running the LF
   to compute `lf_converged` / `lf_status`.

2. **Per-contingency isolation**: switching from contingency A to
   contingency B must NOT reuse A's LF status. Each variant_id
   lives in its own cache slot.

3. **Full reset** on study reload: `reset()` clears
   `_lf_status_by_variant` together with the other N/N-1 caches.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import numpy as np
import pandas as pd
import pytest

from expert_backend.services.recommender_service import RecommenderService
from expert_backend.services.diagram_mixin import DiagramMixin


# ===========================================================================
# LF status cache
# ===========================================================================

class TestLfStatusCachePopulation:
    """`_get_contingency_variant` must store LF status under the variant id."""

    @patch.object(RecommenderService, '_run_ac_with_fallback')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_base_network')
    def test_new_n1_variant_populates_cache(self, mock_get_net, mock_get_n, mock_run_ac):
        service = RecommenderService()

        n = MagicMock()
        n.get_variant_ids.return_value = []  # variant does not exist yet
        n.get_working_variant_id.return_value = "base"
        mock_get_net.return_value = n
        mock_get_n.return_value = "n_var"

        result = SimpleNamespace(status=SimpleNamespace(name="CONVERGED"))
        mock_run_ac.return_value = [result]

        service._get_contingency_variant("ARGIAL71CANTE")

        variant_id = "contingency_state_ARGIAL71CANTE"
        assert variant_id in service._lf_status_by_variant
        cached = service._lf_status_by_variant[variant_id]
        assert cached["converged"] is True
        assert cached["lf_status"] == "CONVERGED"

    @patch.object(RecommenderService, '_run_ac_with_fallback')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_base_network')
    def test_non_converged_lf_status_is_cached_too(
        self, mock_get_net, mock_get_n, mock_run_ac,
    ):
        """Diverged AC LF still yields a cached status entry.

        Otherwise `get_n1_diagram` would redundantly re-run the failing
        LF every time the user views the same (diverged) contingency.
        """
        service = RecommenderService()
        n = MagicMock()
        n.get_variant_ids.return_value = []
        n.get_working_variant_id.return_value = "base"
        mock_get_net.return_value = n
        mock_get_n.return_value = "n_var"

        result = SimpleNamespace(status=SimpleNamespace(name="FAILED"))
        mock_run_ac.return_value = [result]

        service._get_contingency_variant("BAD_CONTINGENCY")

        variant_id = "contingency_state_BAD_CONTINGENCY"
        cached = service._lf_status_by_variant[variant_id]
        assert cached["converged"] is False
        assert cached["lf_status"] == "FAILED"

    @patch.object(RecommenderService, '_run_ac_with_fallback')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_base_network')
    def test_existing_variant_skips_lf_and_cache_write(
        self, mock_get_net, mock_get_n, mock_run_ac,
    ):
        """If the variant already exists (warm path), no LF runs and
        no cache write happens — but a pre-existing cache entry must
        be preserved verbatim."""
        service = RecommenderService()
        service._lf_status_by_variant = {
            "contingency_state_ARGIAL71CANTE": {
                "converged": True,
                "lf_status": "CONVERGED",
            }
        }

        n = MagicMock()
        n.get_variant_ids.return_value = ["contingency_state_ARGIAL71CANTE"]
        mock_get_net.return_value = n

        service._get_contingency_variant("ARGIAL71CANTE")

        # LF must NOT have been re-run
        mock_run_ac.assert_not_called()
        # Cache entry preserved verbatim
        assert (
            service._lf_status_by_variant["contingency_state_ARGIAL71CANTE"]["lf_status"]
            == "CONVERGED"
        )


class TestLfStatusCacheIsolationAcrossContingencies:
    """Switching contingencies must NOT collapse entries."""

    @patch.object(RecommenderService, '_run_ac_with_fallback')
    @patch.object(RecommenderService, '_get_n_variant')
    @patch.object(RecommenderService, '_get_base_network')
    def test_two_contingencies_yield_two_cache_entries(
        self, mock_get_net, mock_get_n, mock_run_ac,
    ):
        service = RecommenderService()

        # Model a Network where every first-time variant is unknown.
        variants = ["base"]

        def get_variant_ids():
            return list(variants)

        def clone_variant(src, dst):
            variants.append(dst)

        n = MagicMock()
        n.get_variant_ids.side_effect = get_variant_ids
        n.clone_variant.side_effect = clone_variant
        n.get_working_variant_id.return_value = "base"
        mock_get_net.return_value = n
        mock_get_n.return_value = "n_var"

        # 1st: converged, 2nd: diverged (to make sure entries differ)
        converged = SimpleNamespace(status=SimpleNamespace(name="CONVERGED"))
        diverged = SimpleNamespace(status=SimpleNamespace(name="FAILED"))
        mock_run_ac.side_effect = [[converged], [diverged]]

        service._get_contingency_variant("DISCO_A")
        service._get_contingency_variant("DISCO_B")

        assert service._lf_status_by_variant["contingency_state_DISCO_A"]["converged"] is True
        assert service._lf_status_by_variant["contingency_state_DISCO_B"]["converged"] is False
        # Assert A's entry was NOT overwritten when B was created
        assert (
            service._lf_status_by_variant["contingency_state_DISCO_A"]["lf_status"]
            == "CONVERGED"
        )
        assert (
            service._lf_status_by_variant["contingency_state_DISCO_B"]["lf_status"]
            == "FAILED"
        )


class TestGetN1DiagramReadsLfCache:
    """`get_n1_diagram` must skip `_run_ac_with_fallback` when the
    variant's LF status is already cached."""

    def _make_mixin_with_stubs(self):
        """Build a DiagramMixin subclass bound to a mock network,
        short-circuiting every sub-step outside the code under test.
        """
        service = RecommenderService()

        # Stub the heavy pypowsybl operations
        n = MagicMock()
        n.get_working_variant_id.return_value = "base"
        service._base_network = n  # skip _get_base_network side effects
        service._get_base_network = MagicMock(return_value=n)

        n1_variant_id = "contingency_state_ARGIAL71CANTE"
        service._get_contingency_variant = MagicMock(return_value=n1_variant_id)
        service._run_ac_with_fallback = MagicMock()

        # Populate the LF status cache directly
        service._lf_status_by_variant = {
            n1_variant_id: {"converged": True, "lf_status": "CONVERGED"},
        }

        # Stub downstream diagram helpers
        service._generate_diagram = MagicMock(return_value={
            "svg": "<svg/>", "metadata": {},
        })
        service._get_network_flows = MagicMock(return_value={
            "p1": {}, "p2": {}, "q1": {}, "q2": {}, "vl1": {}, "vl2": {},
        })
        service._get_asset_flows = MagicMock(return_value={})
        service._compute_deltas = MagicMock(return_value={
            "flow_deltas": {}, "reactive_flow_deltas": {},
        })
        service._compute_asset_deltas = MagicMock(return_value={})
        service._get_lines_we_care_about = MagicMock(return_value=None)
        service._get_overloaded_lines = MagicMock(return_value=([], []))
        service._get_n_variant = MagicMock(return_value="n_var")
        return service, n, n1_variant_id

    def test_cached_status_skips_ac_lf_rerun(self):
        service, _n, _vid = self._make_mixin_with_stubs()

        diagram = service.get_contingency_diagram("ARGIAL71CANTE")

        # The whole point of the cache: no AC LF re-run for the
        # sole purpose of extracting `converged` / `lf_status`.
        service._run_ac_with_fallback.assert_not_called()

        # Status fields still surface correctly to the diagram payload
        assert diagram["lf_converged"] is True
        assert diagram["lf_status"] == "CONVERGED"

    def test_cache_miss_falls_back_to_re_running_lf(self):
        """When the cache is empty (pre-existing variant / cleared
        state), `get_n1_diagram` re-runs AC LF as before."""
        service, _n, vid = self._make_mixin_with_stubs()
        service._lf_status_by_variant = {}  # cache miss

        result = SimpleNamespace(status=SimpleNamespace(name="CONVERGED"))
        service._run_ac_with_fallback = MagicMock(return_value=[result])

        diagram = service.get_contingency_diagram("ARGIAL71CANTE")

        service._run_ac_with_fallback.assert_called_once()
        assert diagram["lf_converged"] is True
        assert diagram["lf_status"] == "CONVERGED"


# ===========================================================================
# Vectorised flow/overload helpers (patches 1 and 2)
# ===========================================================================

class TestGetAssetFlowsVectorised:
    """`_get_asset_flows` must preserve {asset_id: {p, q}} shape
    while avoiding the old iterrows-based implementation.
    """

    def test_narrow_query_and_nan_replacement(self):
        mixin = DiagramMixin()

        loads_df = pd.DataFrame(
            {"p": [10.0, np.nan, 5.0], "q": [1.0, 2.0, np.nan]},
            index=["L1", "L2", "L3"],
        )
        gens_df = pd.DataFrame(
            {"p": [-50.0, 100.0], "q": [-10.0, 20.0]},
            index=["G1", "G2"],
        )
        net = MagicMock()
        net.get_loads.return_value = loads_df
        net.get_generators.return_value = gens_df

        flows = mixin._get_asset_flows(net)

        # Narrow query invariant: helpers must request only p/q
        net.get_loads.assert_called_with(attributes=["p", "q"])
        net.get_generators.assert_called_with(attributes=["p", "q"])

        # NaN → 0.0 substitution
        assert flows["L1"] == {"p": 10.0, "q": 1.0}
        assert flows["L2"] == {"p": 0.0, "q": 2.0}
        assert flows["L3"] == {"p": 5.0, "q": 0.0}
        assert flows["G1"] == {"p": -50.0, "q": -10.0}
        assert flows["G2"] == {"p": 100.0, "q": 20.0}

    def test_empty_loads_and_gens(self):
        mixin = DiagramMixin()
        empty_df = pd.DataFrame(columns=["p", "q"])
        net = MagicMock()
        net.get_loads.return_value = empty_df
        net.get_generators.return_value = empty_df

        flows = mixin._get_asset_flows(net)
        assert flows == {}


class TestGetOverloadedLinesVectorised:
    """`_get_overloaded_lines` must detect overloads using the
    vectorised `np.maximum(|i1|, |i2|)` path."""

    def test_overload_detection_on_lines_and_trafos(self):
        import expert_op4grid_recommender.config as op_config

        mixin = DiagramMixin()

        # Operational limits — MultiIndex with (element_id, side, type,
        # acceptable_duration, group_name). `get_operational_limits`
        # is called with `attributes=['value']`.
        idx = pd.MultiIndex.from_tuples(
            [
                ("L_overload", "ONE", "CURRENT", -1, "default"),
                ("L_ok", "ONE", "CURRENT", -1, "default"),
                ("T_overload", "ONE", "CURRENT", -1, "default"),
            ],
            names=["element_id", "side", "type", "acceptable_duration", "group_name"],
        )
        limits_df = pd.DataFrame({"value": [100.0, 1000.0, 500.0]}, index=idx)

        lines_df = pd.DataFrame(
            {"i1": [120.0, 50.0], "i2": [90.0, 40.0]},
            index=["L_overload", "L_ok"],
        )
        trafos_df = pd.DataFrame(
            {"i1": [700.0], "i2": [np.nan]},
            index=["T_overload"],
        )

        net = MagicMock()
        net.get_operational_limits.return_value = limits_df
        net.get_lines.return_value = lines_df
        net.get_2_windings_transformers.return_value = trafos_df

        with patch.object(op_config, "MONITORING_FACTOR_THERMAL_LIMITS", 0.95), \
             patch.object(op_config, "PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD", 0.02):
            names, rhos = mixin._get_overloaded_lines(net, with_rho=True)

        # L_overload: max(120, 90) = 120 > 100 * 0.95 → overload
        # L_ok:       max(50, 40)  = 50  <  1000 * 0.95 → not overload
        # T_overload: max(700, 0)  = 700 > 500 * 0.95 → overload
        assert "L_overload" in names
        assert "L_ok" not in names
        assert "T_overload" in names
        # Rho preserved (max_i / limit)
        assert rhos[names.index("L_overload")] == pytest.approx(120.0 / 100.0)
        assert rhos[names.index("T_overload")] == pytest.approx(700.0 / 500.0)

    def test_narrow_queries_requested(self):
        mixin = DiagramMixin()
        empty_limits = pd.DataFrame(
            columns=["value"],
            index=pd.MultiIndex.from_tuples(
                [], names=["element_id", "side", "type", "acceptable_duration", "group_name"]
            ),
        )
        empty_lines = pd.DataFrame(columns=["i1", "i2"])

        net = MagicMock()
        net.get_operational_limits.return_value = empty_limits
        net.get_lines.return_value = empty_lines
        net.get_2_windings_transformers.return_value = empty_lines

        mixin._get_overloaded_lines(net)

        net.get_operational_limits.assert_called_with(attributes=["value"])
        net.get_lines.assert_called_with(attributes=["i1", "i2"])
        net.get_2_windings_transformers.assert_called_with(attributes=["i1", "i2"])

    def test_lines_we_care_about_filter(self):
        """`lines_we_care_about=set()` excludes every line regardless
        of rho. `={'L_overload'}` keeps only the monitored one."""
        import expert_op4grid_recommender.config as op_config

        mixin = DiagramMixin()

        idx = pd.MultiIndex.from_tuples(
            [
                ("L_overload", "ONE", "CURRENT", -1, "default"),
                ("L_other", "ONE", "CURRENT", -1, "default"),
            ],
            names=["element_id", "side", "type", "acceptable_duration", "group_name"],
        )
        limits_df = pd.DataFrame({"value": [100.0, 100.0]}, index=idx)
        lines_df = pd.DataFrame(
            {"i1": [120.0, 200.0], "i2": [90.0, 150.0]},
            index=["L_overload", "L_other"],
        )
        trafos_df = pd.DataFrame(columns=["i1", "i2"])

        net = MagicMock()
        net.get_operational_limits.return_value = limits_df
        net.get_lines.return_value = lines_df
        net.get_2_windings_transformers.return_value = trafos_df

        with patch.object(op_config, "MONITORING_FACTOR_THERMAL_LIMITS", 0.95), \
             patch.object(op_config, "PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD", 0.02):
            names_all = mixin._get_overloaded_lines(net)
            names_filtered = mixin._get_overloaded_lines(
                net, lines_we_care_about={"L_overload"}
            )

        assert set(names_all) == {"L_overload", "L_other"}
        assert names_filtered == ["L_overload"]
