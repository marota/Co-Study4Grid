# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

"""Tests for RecommenderService._terminal_aware_delta, _select_terminal_for_branch, and _compute_deltas."""

import pytest
from expert_backend.services.recommender_service import RecommenderService


def _make_flows(p1, p2, q1=None, q2=None, vl1=None, vl2=None):
    """Helper to build a flows dict with optional Q and VL defaults."""
    if q1 is None:
        q1 = {k: 0.0 for k in p1}
    if q2 is None:
        q2 = {k: 0.0 for k in p2}
    if vl1 is None:
        vl1 = {k: f"VL1_{k}" for k in p1}
    if vl2 is None:
        vl2 = {k: f"VL2_{k}" for k in p1}
    return {"p1": p1, "p2": p2, "q1": q1, "q2": q2, "vl1": vl1, "vl2": vl2}


class TestTerminalAwareDelta:
    """Tests for _terminal_aware_delta static method.

    Convention: positive value = power enters at that terminal.
    Delta is computed using a single terminal's values in two states.
    Reference direction = direction of the state with the strongest abs value.
    """

    def test_same_direction_increased(self):
        """After stronger, same direction → positive delta, no flip."""
        # Terminal value: after=200, before=100 (both positive / entering)
        delta, flip = RecommenderService._terminal_aware_delta(200, 100)
        assert delta == pytest.approx(100.0)
        assert flip is False

    def test_same_direction_decreased(self):
        """After weaker, same direction → negative delta, no flip."""
        delta, flip = RecommenderService._terminal_aware_delta(100, 200)
        assert delta == pytest.approx(-100.0)
        assert flip is False

    def test_same_direction_negative(self):
        """Both states negative (power leaving) → positive delta when after stronger."""
        # after=-85 (leaving, |85|), before=-55 (leaving, |55|)
        # ref = after (stronger), ref_positive = False
        # signed_after = +85 (same dir), signed_before = +55 (same dir)
        # delta = 85 - 55 = 30
        delta, flip = RecommenderService._terminal_aware_delta(-85, -55)
        assert delta == pytest.approx(30.0)
        assert flip is False

    def test_direction_reversal_before_stronger(self):
        """Direction reverses, before is stronger → negative delta, flip=True."""
        # after=-80 (leaving), before=100 (entering)
        # ref = before (|100| > |80|), ref_positive = True
        # signed_after: -80 is negative, ref_positive is True → opposite → -80
        # signed_before: 100 is positive, ref_positive is True → same → +100
        # delta = -80 - 100 = -180
        delta, flip = RecommenderService._terminal_aware_delta(-80, 100)
        assert delta == pytest.approx(-180.0)
        assert flip is True

    def test_direction_reversal_after_stronger(self):
        """Direction reverses, after is stronger → positive delta, no flip."""
        # after=-100 (leaving, |100|), before=80 (entering, |80|)
        # ref = after (stronger), ref_positive = False
        # signed_after: -100, same dir as ref → +100
        # signed_before: 80, opposite dir to ref → -80
        # delta = 100 - (-80) = 180
        delta, flip = RecommenderService._terminal_aware_delta(-100, 80)
        assert delta == pytest.approx(180.0)
        assert flip is False

    def test_equal_magnitude_same_direction(self):
        """Equal magnitude, same direction → zero delta, no flip."""
        delta, flip = RecommenderService._terminal_aware_delta(100, 100)
        assert delta == pytest.approx(0.0)
        assert flip is False

    def test_both_zero(self):
        """Both states zero → zero delta, no flip."""
        delta, flip = RecommenderService._terminal_aware_delta(0, 0)
        assert delta == pytest.approx(0.0)
        assert flip is False

    def test_one_state_zero_after_has_flow(self):
        """After has flow, before is zero → delta = abs(after)."""
        delta, flip = RecommenderService._terminal_aware_delta(50, 0)
        assert delta == pytest.approx(50.0)
        assert flip is False

    def test_one_state_zero_before_has_flow(self):
        """Before has flow, after is zero → negative delta."""
        delta, flip = RecommenderService._terminal_aware_delta(0, 50)
        assert delta == pytest.approx(-50.0)
        assert flip is False

    def test_small_negative_values(self):
        """Both small negative values, after stronger magnitude."""
        delta, flip = RecommenderService._terminal_aware_delta(-15.5, -10.3)
        assert delta == pytest.approx(5.2)
        assert flip is False


class TestSelectTerminalForBranch:
    """Tests for _select_terminal_for_branch static method."""

    def test_vl1_in_set(self):
        """Terminal 1 selected when vl1 matches requested VL."""
        avl1 = {"L": "PYMONP3"}
        avl2 = {"L": "CPVANP3"}
        result = RecommenderService._select_terminal_for_branch(
            "L", avl1, avl2, {}, {}, {"PYMONP3"}
        )
        assert result == 1

    def test_vl2_in_set(self):
        """Terminal 2 selected when vl2 matches requested VL."""
        avl1 = {"L": "CPVANP3"}
        avl2 = {"L": "PYMONP3"}
        result = RecommenderService._select_terminal_for_branch(
            "L", avl1, avl2, {}, {}, {"PYMONP3"}
        )
        assert result == 2

    def test_both_in_set_defaults_to_t1(self):
        """Falls back to terminal 1 when both VLs are in the set."""
        avl1 = {"L": "VLA"}
        avl2 = {"L": "VLB"}
        result = RecommenderService._select_terminal_for_branch(
            "L", avl1, avl2, {}, {}, {"VLA", "VLB"}
        )
        assert result == 1

    def test_neither_in_set_defaults_to_t1(self):
        """Falls back to terminal 1 when neither VL is in the set."""
        avl1 = {"L": "VLA"}
        avl2 = {"L": "VLB"}
        result = RecommenderService._select_terminal_for_branch(
            "L", avl1, avl2, {}, {}, {"VLC"}
        )
        assert result == 1

    def test_empty_vl_set_defaults_to_t1(self):
        """Falls back to terminal 1 when no VLs specified."""
        avl1 = {"L": "VLA"}
        avl2 = {"L": "VLB"}
        result = RecommenderService._select_terminal_for_branch(
            "L", avl1, avl2, {}, {}, set()
        )
        assert result == 1

    def test_fallback_to_before_vl_info(self):
        """Uses before-state VL info when after-state lacks the branch."""
        bvl1 = {"L": "PYMONP3"}
        bvl2 = {"L": "CPVANP3"}
        result = RecommenderService._select_terminal_for_branch(
            "L", {}, {}, bvl1, bvl2, {"CPVANP3"}
        )
        assert result == 2


class TestComputeDeltas:
    """Tests for terminal-aware flow delta computation between two network states."""

    def setup_method(self):
        self.service = RecommenderService()

    def test_identical_flows_zero_deltas(self):
        """When before and after flows are identical, all deltas should be zero."""
        flows = _make_flows(
            p1={"LINE_A": 100.0, "LINE_B": 200.0},
            p2={"LINE_A": -98.0, "LINE_B": -195.0},
        )
        result = self.service._compute_deltas(flows, flows)
        for info in result["flow_deltas"].values():
            assert info["delta"] == 0.0
            assert info["flip_arrow"] is False

    def test_positive_delta_same_direction(self):
        """Increased flow (same direction) → positive delta, no arrow flip."""
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == 100.0
        assert result["L"]["category"] == "positive"
        assert result["L"]["flip_arrow"] is False

    def test_negative_delta_same_direction(self):
        """Decreased flow (same direction) → negative delta, no arrow flip."""
        before = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        after = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == -100.0
        assert result["L"]["category"] == "negative"
        assert result["L"]["flip_arrow"] is False

    def test_direction_reversal(self):
        """Flow reverses direction: delta reflects the full swing at terminal 1."""
        # Terminal 1: before=100 (entering), after=-80 (leaving)
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": -80.0}, p2={"L": 85.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        # ref = before (|100| > |80|, positive)
        # signed_after = -80 (opposite dir), signed_before = +100
        # delta = -80 - 100 = -180
        assert result["L"]["delta"] == -180.0
        assert result["L"]["flip_arrow"] is True

    def test_small_delta_below_threshold_is_grey(self):
        """Deltas below 5% of max are categorized as grey."""
        before = _make_flows(
            p1={"A": 100.0, "B": 100.0},
            p2={"A": -98.0, "B": -98.0},
        )
        after = _make_flows(
            p1={"A": 200.0, "B": 101.0},
            p2={"A": -198.0, "B": -99.0},
        )
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["A"]["category"] == "positive"
        assert result["B"]["category"] == "grey"

    def test_empty_flows(self):
        """Empty flow sets should produce empty deltas."""
        empty = _make_flows(p1={}, p2={})
        result = self.service._compute_deltas(empty, empty)
        assert result["flow_deltas"] == {}
        assert result["reactive_flow_deltas"] == {}

    def test_lines_in_after_not_in_before(self):
        before = _make_flows(p1={}, p2={})
        after = _make_flows(p1={"L": 50.0}, p2={"L": -48.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == 50.0

    def test_lines_in_before_not_in_after(self):
        before = _make_flows(p1={"L": 50.0}, p2={"L": -48.0})
        after = _make_flows(p1={}, p2={})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == -50.0

    def test_delta_rounding(self):
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": 133.333}, p2={"L": -131.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == 33.3

    def test_output_has_flip_arrow(self):
        """Output should include flip_arrow boolean."""
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert "flip_arrow" in result["L"]
        assert isinstance(result["L"]["flip_arrow"], bool)

    # --- Terminal selection with voltage_level_ids ---

    def test_vl_selects_terminal_2(self):
        """When the observed VL is at terminal 2, delta uses t2 values."""
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            vl1={"L": "CPVANP3"}, vl2={"L": "PYMONP3"},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            vl1={"L": "CPVANP3"}, vl2={"L": "PYMONP3"},
        )
        result = self.service._compute_deltas(
            after, before, voltage_level_ids=["PYMONP3"]
        )["flow_deltas"]
        # Terminal 2: after=-198, before=-98 (both negative/leaving)
        # ref = after (|198| > |98|), ref_positive = False
        # signed_after = +198, signed_before = +98
        # delta = 198 - 98 = 100
        assert result["L"]["delta"] == 100.0

    def test_vl_selects_terminal_1_by_default(self):
        """Without VL filter, defaults to terminal 1."""
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            vl1={"L": "VLA"}, vl2={"L": "VLB"},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            vl1={"L": "VLA"}, vl2={"L": "VLB"},
        )
        result_no_vl = self.service._compute_deltas(after, before)["flow_deltas"]
        result_vl_a = self.service._compute_deltas(
            after, before, voltage_level_ids=["VLA"]
        )["flow_deltas"]
        # Both should give the same result (terminal 1)
        assert result_no_vl["L"]["delta"] == result_vl_a["L"]["delta"]

    def test_different_vl_gives_different_delta(self):
        """Selecting different terminals can yield different delta values."""
        # Asymmetric flows: t1 and t2 have different magnitudes
        before = _make_flows(
            p1={"L": 50.0}, p2={"L": -46.0},
            vl1={"L": "VLA"}, vl2={"L": "VLB"},
        )
        after = _make_flows(
            p1={"L": 80.0}, p2={"L": -75.0},
            vl1={"L": "VLA"}, vl2={"L": "VLB"},
        )
        delta_t1 = self.service._compute_deltas(
            after, before, voltage_level_ids=["VLA"]
        )["flow_deltas"]["L"]["delta"]
        delta_t2 = self.service._compute_deltas(
            after, before, voltage_level_ids=["VLB"]
        )["flow_deltas"]["L"]["delta"]
        # t1: 80 - 50 = 30; t2: |-75| - |-46| = 75 - 46 = 29
        assert delta_t1 == 30.0
        assert delta_t2 == 29.0

    # --- Reactive power delta tests ---

    def test_reactive_independent_from_p(self):
        """Q delta should be computed with its own reference direction, independent of P."""
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            q1={"L": 10.0}, q2={"L": -8.0},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            q1={"L": 30.0}, q2={"L": -28.0},
        )
        result = self.service._compute_deltas(after, before)
        # Terminal 1: Q after=30, before=10, same direction → delta = 20
        assert result["reactive_flow_deltas"]["L"]["delta"] == 20.0

    def test_reactive_uses_selected_terminal(self):
        """Q delta uses the terminal selected by voltage_level_ids."""
        before = _make_flows(
            p1={"L": -50.0}, p2={"L": 55.0},
            q1={"L": -8.0}, q2={"L": 10.0},
            vl1={"L": "VLA"}, vl2={"L": "VLB"},
        )
        after = _make_flows(
            p1={"L": -80.0}, p2={"L": 85.0},
            q1={"L": -10.0}, q2={"L": 15.0},
            vl1={"L": "VLA"}, vl2={"L": "VLB"},
        )
        # Select terminal 2 (VLB)
        result = self.service._compute_deltas(
            after, before, voltage_level_ids=["VLB"]
        )
        # P at t2: after=85, before=55, same dir → delta = 30
        assert result["flow_deltas"]["L"]["delta"] == 30.0
        # Q at t2: after=15, before=10, same dir → delta = 5
        assert result["reactive_flow_deltas"]["L"]["delta"] == 5.0

    def test_reactive_zero_when_q_unchanged(self):
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            q1={"L": 10.0}, q2={"L": -8.0},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            q1={"L": 10.0}, q2={"L": -8.0},
        )
        result = self.service._compute_deltas(after, before)
        assert result["reactive_flow_deltas"]["L"]["delta"] == 0.0

    def test_q_flip_arrow_independent_from_p(self):
        """Q's flip_arrow should be independent from P's flip_arrow."""
        # P at t1: same direction both states → no flip
        # Q at t1: direction reverses, before stronger → flip
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            q1={"L": 20.0}, q2={"L": -15.0},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            q1={"L": -5.0}, q2={"L": 10.0},
        )
        result = self.service._compute_deltas(after, before)
        # P at t1: after=200, before=100, same dir → no flip
        assert result["flow_deltas"]["L"]["flip_arrow"] is False
        # Q at t1: after=-5, before=20. ref=before (|20| > |5|), ref_positive=True
        # direction reversed (-5 neg, 20 pos) → flip=True
        assert result["reactive_flow_deltas"]["L"]["flip_arrow"] is True

    def test_p_flip_q_no_flip(self):
        """P flips but Q does not when they have independent directions."""
        before = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            q1={"L": 10.0}, q2={"L": -8.0},
        )
        after = _make_flows(
            p1={"L": -100.0}, p2={"L": 105.0},
            q1={"L": 15.0}, q2={"L": -12.0},
        )
        result = self.service._compute_deltas(after, before)
        # P at t1: after=-100, before=200. ref=before (|200| > |100|), ref_positive=True
        # direction reversed → flip=True
        assert result["flow_deltas"]["L"]["flip_arrow"] is True
        # Q at t1: after=15, before=10, same direction → no flip
        assert result["reactive_flow_deltas"]["L"]["flip_arrow"] is False

    def test_reactive_has_flip_arrow_field(self):
        """Reactive flow deltas should always include flip_arrow."""
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            q1={"L": 10.0}, q2={"L": -8.0},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            q1={"L": 20.0}, q2={"L": -18.0},
        )
        result = self.service._compute_deltas(after, before)
        assert "flip_arrow" in result["reactive_flow_deltas"]["L"]
        assert isinstance(result["reactive_flow_deltas"]["L"]["flip_arrow"], bool)

    # --- Branch coloring based on deltaP ---

    def test_positive_delta_is_orange(self):
        """Positive deltaP → category 'positive' (orange)."""
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["category"] == "positive"

    def test_negative_delta_is_blue(self):
        """Negative deltaP → category 'negative' (blue)."""
        before = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        after = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["category"] == "negative"

    def test_insignificant_delta_is_grey(self):
        """Insignificant deltaP → category 'grey'."""
        before = _make_flows(
            p1={"A": 100.0, "B": 100.0},
            p2={"A": -98.0, "B": -98.0},
        )
        after = _make_flows(
            p1={"A": 200.0, "B": 100.5},
            p2={"A": -198.0, "B": -98.5},
        )
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        # A: delta=100 (max), B: delta=0.5, threshold=5 → B is grey
        assert result["A"]["category"] == "positive"
        assert result["B"]["category"] == "grey"

    def test_independent_q_category_positive(self):
        """Branch Q gets 'positive' while P gets 'negative'."""
        # P: 200 -> 100 (delta -100, negative)
        # Q: 10 -> 20 (delta +10, positive)
        # Note: _make_flows requires p1, p2, q1, q2
        before = _make_flows(p1={"L": 200.0}, p2={"L": -198.0}, q1={"L": 10.0}, q2={"L": -8.0})
        after = _make_flows(p1={"L": 100.0}, p2={"L": -98.0}, q1={"L": 20.0}, q2={"L": -18.0})
        
        result = self.service._compute_deltas(after, before)
        assert result["flow_deltas"]["L"]["category"] == "negative"
        assert result["reactive_flow_deltas"]["L"]["category"] == "positive"

    def test_independent_q_category_grey(self):
        """Branch Q gets 'grey' independently of a large P delta."""
        # A: P delta 100 (max), Q delta 1 (threshold_q = 5% of max_q)
        # B: P delta 1, Q delta 10 (max_q)
        before = _make_flows(
            p1={"A": 100.0, "B": 100.0},
            p2={"A": -98.0, "B": -98.0},
            q1={"A": 10.0, "B": 10.0},
            q2={"A": -8.0, "B": -8.0}
        )
        after = _make_flows(
            p1={"A": 200.0, "B": 101.0},
            p2={"A": -198.0, "B": -99.0},
            q1={"A": 11.0, "B": 20.0},
            q2={"A": -9.0, "B": -18.0}
        )
        result = self.service._compute_deltas(after, before)
        
        # P max_abs=100 -> thresh=5. A=100 (pos), B=1 (grey)
        assert result["flow_deltas"]["A"]["category"] == "positive"
        assert result["flow_deltas"]["B"]["category"] == "grey"
        
        # Q max_abs=10 (for B) -> thresh=0.5. A=1 (pos), B=10 (pos)
        # Wait, if Q max_abs is 10, then A delta 1 > 0.5 -> positive.
        # Let's make A delta Q even smaller to be grey.
        after_v2 = _make_flows(
            p1={"A": 200.0, "B": 101.0},
            p2={"A": -198.0, "B": -99.0},
            q1={"A": 10.1, "B": 20.0}
        )
        result_v2 = self.service._compute_deltas(after_v2, before)
        # Q max_abs=10 -> thresh=0.5. A delta=0.1 < 0.5 -> grey
        assert result_v2["reactive_flow_deltas"]["A"]["category"] == "grey"
        assert result_v2["reactive_flow_deltas"]["B"]["category"] == "positive"


class TestComputeAssetDeltas:
    """Tests for load/generator asset delta computation."""

    def setup_method(self):
        self.service = RecommenderService()

    def test_identical_assets_zero_deltas(self):
        flows = {"GEN_A": {"p": 100.0, "q": 20.0}}
        result = self.service._compute_asset_deltas(flows, flows)
        assert result["GEN_A"]["delta_p"] == 0.0
        assert result["GEN_A"]["delta_q"] == 0.0

    def test_positive_asset_delta(self):
        before = {"GEN_A": {"p": 100.0, "q": 20.0}}
        after = {"GEN_A": {"p": 200.0, "q": 20.0}}
        result = self.service._compute_asset_deltas(after, before)
        assert result["GEN_A"]["delta_p"] == 100.0
        assert result["GEN_A"]["category"] == "positive"

    def test_category_based_on_p_not_q(self):
        before = {"GEN_A": {"p": 100.0, "q": 20.0}}
        after = {"GEN_A": {"p": 100.0, "q": 50.0}}
        result = self.service._compute_asset_deltas(after, before)
        assert result["GEN_A"]["delta_q"] == 30.0
        assert result["GEN_A"]["category"] in ("grey", "negative")

    def test_empty_asset_flows(self):
        result = self.service._compute_asset_deltas({}, {})
        assert result == {}

    def test_zero_delta_is_grey_when_all_zeros(self):
        """Assets with delta_p=0 must be grey even when ALL deltas are zero (threshold=0 edge case)."""
        flows = {"LOAD_A": {"p": 100.0, "q": 20.0}, "LOAD_B": {"p": 200.0, "q": 30.0}}
        result = self.service._compute_asset_deltas(flows, flows)
        # max_abs = 0.0 → threshold = 0.0 → must still categorize as grey
        assert result["LOAD_A"]["category"] == "grey"
        assert result["LOAD_B"]["category"] == "grey"
        assert result["LOAD_A"]["delta_p"] == 0.0
        assert result["LOAD_B"]["delta_p"] == 0.0

    def test_asset_categories_independent_p_and_q(self):
        """Assets return category_p, category_q, and legacy category tracking P."""
        before = {"GEN_A": {"p": 100.0, "q": 100.0}}
        after = {"GEN_A": {"p": 50.0, "q": 150.0}} # P -50 (neg), Q +50 (pos)
        
        result = self.service._compute_asset_deltas(after, before)
        res = result["GEN_A"]
        
        assert res["delta_p"] == -50.0
        assert res["delta_q"] == 50.0
        assert res["category_p"] == "negative"
        assert res["category_q"] == "positive"
        assert res["category"] == "negative" # Legacy field follows P

    def test_asset_q_category_positive_with_p_negative(self):
        """Asset independent colors where Q is positive and P is negative."""
        before = {
            "GEN_A": {"p": 100.0, "q": 10.0},
            "GEN_B": {"p": 10.0, "q": 100.0}
        }
        after = {
            "GEN_A": {"p": 50.0, "q": 15.0},  # P delta -50, Q delta +5
            "GEN_B": {"p": 15.0, "q": 50.0}   # P delta +5, Q delta -50
        }
        result = self.service._compute_asset_deltas(after, before)
        
        # GEN_A: P is major delta (-50), Q is minor (+5)
        # thresholds: P=50*0.05=2.5, Q=50*0.05=2.5
        assert result["GEN_A"]["category_p"] == "negative"
        assert result["GEN_A"]["category_q"] == "positive"
        
        # GEN_B: P is minor (+5), Q is major (-50)
        assert result["GEN_B"]["category_p"] == "positive"
        assert result["GEN_B"]["category_q"] == "negative"
