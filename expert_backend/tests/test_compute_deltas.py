"""Tests for RecommenderService._compute_deltas flow delta computation."""

import pytest
from expert_backend.services.recommender_service import RecommenderService


def _make_flows(p1, p2, q1=None, q2=None):
    """Helper to build a flows dict with optional Q defaults."""
    if q1 is None:
        q1 = {k: 0.0 for k in p1}
    if q2 is None:
        q2 = {k: 0.0 for k in p2}
    return {"p1": p1, "p2": p2, "q1": q1, "q2": q2}


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

    def test_positive_delta_same_direction(self):
        """Increased flow (same direction) → positive delta."""
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == 100.0
        assert result["L"]["category"] == "positive"

    def test_negative_delta_same_direction(self):
        """Decreased flow (same direction) → negative delta."""
        before = _make_flows(p1={"L": 200.0}, p2={"L": -198.0})
        after = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        assert result["L"]["delta"] == -100.0
        assert result["L"]["category"] == "negative"

    def test_direction_reversal(self):
        """Flow reverses direction: delta reflects the full swing."""
        # before: 100 enters t1; after: 80 enters t2 (reversed at t1 = -80)
        before = _make_flows(p1={"L": 100.0}, p2={"L": -98.0})
        after = _make_flows(p1={"L": -80.0}, p2={"L": 85.0})
        result = self.service._compute_deltas(after, before)["flow_deltas"]
        # Reference = before (stronger, t1). delta = -80 - 100 = -180
        assert result["L"]["delta"] == -180.0

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

    # --- Reactive power delta tests ---

    def test_reactive_uses_same_terminal_as_p(self):
        """Q delta should be computed at the same terminal as P."""
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
        """When P enters at t2, Q delta should also use t2."""
        # P enters at t2 in both states (p2 > p1).
        # Q at t2: after=-13, before=-6 → delta = -13-(-6) = -7
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
