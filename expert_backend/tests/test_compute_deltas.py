"""Tests for RecommenderService._compute_deltas flow delta computation."""

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


class TestPickReferenceTerminal:
    """Tests for _pick_reference_terminal."""

    def test_after_stronger_t1(self):
        """After state stronger, entering at terminal 1."""
        assert RecommenderService._pick_reference_terminal(150, -148, 100, -98) is True

    def test_after_stronger_t2(self):
        """After state stronger, entering at terminal 2."""
        assert RecommenderService._pick_reference_terminal(-80, 85, -50, 55) is False

    def test_before_stronger_t1(self):
        """Before state stronger, entering at terminal 1."""
        assert RecommenderService._pick_reference_terminal(50, -48, 100, -98) is True

    def test_before_stronger_t2(self):
        """Before state stronger, entering at terminal 2."""
        assert RecommenderService._pick_reference_terminal(-30, 35, -80, 85) is False

    def test_equal_magnitude_prefers_after(self):
        """Equal magnitude → prefer after state."""
        assert RecommenderService._pick_reference_terminal(100, -98, 100, -98) is True

    def test_both_zero(self):
        """Both states zero → terminal 1 (abs(0) >= abs(0))."""
        assert RecommenderService._pick_reference_terminal(0, 0, 0, 0) is True


class TestComputeDeltas:
    """Tests for flow delta computation between two network states."""

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
            assert info["delta_t1"] == 0.0
            assert info["delta_t2"] == 0.0

    def test_positive_delta_same_direction(self):
        """Increased flow (same direction) → positive delta, no arrow flip."""
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == 100.0
        assert result["L"]["delta_t1"] == 100.0
        assert result["L"]["delta_t2"] == -100.0
        assert result["L"]["category"] == "positive"
        # Same direction → no flip
        assert result["L"]["flip_arrow"] is False

    def test_negative_delta_same_direction(self):
        """Decreased flow (same direction) → negative delta, no arrow flip."""
        before = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        after = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == -100.0
        assert result["L"]["delta_t1"] == -100.0
        assert result["L"]["delta_t2"] == 100.0
        assert result["L"]["category"] == "negative"
        # Same direction, before is stronger BUT direction didn't reverse → no flip
        assert result["L"]["flip_arrow"] is False

    def test_direction_reversal(self):
        """Flow reverses direction: delta reflects the full swing."""
        # before: 100 enters t1; after: 80 enters t2 (reversed at t1 = -80)
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": -80.0}, p2={"L": 85.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        # Reference = before (stronger, t1). delta = -80 - 100 = -180
        assert result["L"]["delta"] == -180.0
        assert result["L"]["delta_t1"] == -180.0
        assert result["L"]["delta_t2"] == 183.0  # 85 - (-98)
        # Before is stronger AND direction reversed → flip_arrow = True
        assert result["L"]["flip_arrow"] is True

    def test_direction_reversal_after_stronger_no_flip(self):
        """When after is stronger and direction reversed, no flip needed
        (SVG shows the stronger state's direction already)."""
        before = _make_flows(p1={"L": 50.0}, p2={"L": -48.0})
        after = _make_flows(p1={"L": -100.0}, p2={"L": 105.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        # After is stronger → reference is after → SVG already correct
        assert result["L"]["flip_arrow"] is False

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

    def test_vl_mapping_present(self):
        """VL IDs should be included in the delta output."""
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            vl1={"L": "COUCHP6"}, vl2={"L": "PYMONP3"},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            vl1={"L": "COUCHP6"}, vl2={"L": "PYMONP3"},
        )
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["vl1"] == "COUCHP6"
        assert result["L"]["vl2"] == "PYMONP3"

    def test_terminal_deltas_differ(self):
        """delta_t1 and delta_t2 should be different (opposite sign, different magnitude due to losses)."""
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -95.0},  # 5 MW losses
            q1={"L": 10.0}, q2={"L": -3.0},     # 7 MVar reactive losses
        )
        after = _make_flows(
            p1={"L": 150.0}, p2={"L": -140.0},  # 10 MW losses
            q1={"L": 20.0}, q2={"L": -2.0},     # 18 MVar reactive losses
        )
        fd = self.service._compute_deltas(after, before)["flow_deltas"]
        # At t1: 150 - 100 = 50
        assert fd["L"]["delta_t1"] == 50.0
        # At t2: -140 - (-95) = -45
        assert fd["L"]["delta_t2"] == -45.0
        # Reference terminal = after t1 (stronger): delta = 50
        assert fd["L"]["delta"] == 50.0

        rd = self.service._compute_deltas(after, before)["reactive_flow_deltas"]
        # Q at t1: 20 - 10 = 10
        assert rd["L"]["delta_t1"] == 10.0
        # Q at t2: -2 - (-3) = 1
        assert rd["L"]["delta_t2"] == 1.0

    # --- Reactive power delta tests ---

    def test_reactive_uses_same_terminal_as_p(self):
        """Q reference delta should be computed at the same terminal as P."""
        # P enters at t1 in both states (t1 > t2). Reference = after (stronger).
        # Q at t1: after=30, before=10 → delta = 20
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            q1={"L": 10.0}, q2={"L": -8.0},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            q1={"L": 30.0}, q2={"L": -28.0},
        )
        result = self.service._compute_deltas(after, before)
        assert result["reactive_flow_deltas"]["L"]["delta"] == 20.0

    def test_reactive_at_t2_when_p_enters_t2(self):
        """When P enters at t2, Q reference delta should also use t2."""
        # P enters at t2 in both states (p2 > p1).
        # Q at t2: after=15, before=10 → delta = 5
        before = _make_flows(
            p1={"L": -50.0}, p2={"L": 55.0},
            q1={"L": -8.0}, q2={"L": 10.0},
        )
        after = _make_flows(
            p1={"L": -80.0}, p2={"L": 85.0},
            q1={"L": -10.0}, q2={"L": 15.0},
        )
        result = self.service._compute_deltas(after, before)
        # P at t2: 85 - 55 = 30
        assert result["flow_deltas"]["L"]["delta"] == 30.0
        # Q at t2: 15 - 10 = 5
        assert result["reactive_flow_deltas"]["L"]["delta"] == 5.0

    def test_reactive_both_terminals_available(self):
        """Both terminal Q deltas should be available for SLD use."""
        before = _make_flows(
            p1={"L": 100.0}, p2={"L": -98.0},
            q1={"L": 10.0}, q2={"L": -3.0},
        )
        after = _make_flows(
            p1={"L": 200.0}, p2={"L": -198.0},
            q1={"L": 19.0}, q2={"L": -12.0},
        )
        rd = self.service._compute_deltas(after, before)["reactive_flow_deltas"]
        # Q at t1: 19 - 10 = 9
        assert rd["L"]["delta_t1"] == 9.0
        # Q at t2: -12 - (-3) = -9
        assert rd["L"]["delta_t2"] == -9.0
        # Reference delta = t1 (P enters t1)
        assert rd["L"]["delta"] == 9.0

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
        assert result["reactive_flow_deltas"]["L"]["delta_t1"] == 0.0
        assert result["reactive_flow_deltas"]["L"]["delta_t2"] == 0.0


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
