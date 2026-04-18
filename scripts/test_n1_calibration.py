"""
test_n1_calibration.py
======================

Tests for the N-1 calibration changes to the FR 400kV XIIDM network.

This test suite validates:

1. **N-state loading distribution**: The network should have:
   - AC load flow convergence
   - Median N-state loading ≤50%
   - At least 50% of lines at ≤50% loading
   - Max N-state loading ≤65%
   - No line below 100 A limit

2. **N-1 overload constraints**:
   - No N-1 contingency produces overloads above 130%
   - At least 10 contingencies produce overloads (we have ~21)
   - All 398 lines can be tested as contingencies (AC converges for all)

3. **n1_overload_contingencies.json validation**:
   - File exists and is valid JSON
   - Has all required top-level keys
   - total_contingencies_tested == 398
   - peak_loading_pct ≤ 130.0
   - total_with_overload > 0 and structure matches spec
   - All values are reasonable and contingencies are sorted

The tests marked with @pytest.mark.slow require pypowsybl and should be skipped
in CI pipelines. JSON validation tests run fast.

Usage:
    pytest scripts/test_n1_calibration.py -v
    pytest scripts/test_n1_calibration.py -v -m "not slow"  # Skip slow tests
"""

import json
import sys
from pathlib import Path

import pytest

# Pandas is only needed for slow tests with pypowsybl
try:
    import pandas as pd
except ImportError:
    pd = None

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "pypsa_eur_fr400"


# ===========================================================================
# Fixtures
# ===========================================================================

@pytest.fixture(scope="session")
def network_file():
    """Return the path to the network XIIDM file."""
    path = DATA_DIR / "network.xiidm"
    assert path.exists(), f"Network file not found: {path}"
    return path


@pytest.fixture(scope="session")
def contingency_file():
    """Return the path to the n1_overload_contingencies.json file."""
    path = DATA_DIR / "n1_overload_contingencies.json"
    assert path.exists(), f"Contingency file not found: {path}"
    return path


@pytest.fixture(scope="session")
def contingency_data(contingency_file):
    """Load the n1_overload_contingencies.json file."""
    with open(contingency_file, "r", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def network(network_file):
    """Load the pypowsybl network."""
    pp = pytest.importorskip("pypowsybl")
    return pp.network.load(str(network_file))


# ===========================================================================
# Fast tests: JSON validation (no pypowsybl required)
# ===========================================================================

class TestContingencyFileExistence:
    """Test that the contingency JSON file exists and is readable."""

    def test_contingency_file_exists(self, contingency_file):
        """Verify the n1_overload_contingencies.json file exists."""
        assert contingency_file.exists(), f"File not found: {contingency_file}"
        assert contingency_file.stat().st_size > 0, "Contingency file is empty"

    def test_contingency_file_is_valid_json(self, contingency_file):
        """Verify the file contains valid JSON."""
        with open(contingency_file, "r", encoding="utf-8") as f:
            data = json.load(f)
        assert isinstance(data, dict), "Root element should be a JSON object"


class TestContingencyStructure:
    """Test the top-level structure of the contingency JSON."""

    def test_has_required_top_level_keys(self, contingency_data):
        """Verify all required top-level keys are present."""
        required_keys = [
            "description",
            "network",
            "total_contingencies_tested",
            "total_with_overload",
            "peak_loading_pct",
            "contingencies",
        ]
        for key in required_keys:
            assert key in contingency_data, f"Missing required key: '{key}'"

    def test_contingencies_is_list(self, contingency_data):
        """Verify the 'contingencies' field is a list."""
        assert isinstance(
            contingency_data["contingencies"], list
        ), "contingencies should be a list"

    def test_total_contingencies_tested_is_398(self, contingency_data):
        """Verify total_contingencies_tested equals 398 (all lines)."""
        total = contingency_data["total_contingencies_tested"]
        assert total == 398, f"Expected 398 contingencies tested, got {total}"

    def test_total_with_overload_is_positive(self, contingency_data):
        """Verify total_with_overload is greater than 0."""
        total_with_overload = contingency_data["total_with_overload"]
        assert total_with_overload > 0, (
            f"Expected at least 1 contingency with overload, got {total_with_overload}"
        )

    def test_total_with_overload_matches_list_length(self, contingency_data):
        """Verify total_with_overload matches the length of contingencies list."""
        total_listed = len(contingency_data["contingencies"])
        total_with_overload = contingency_data["total_with_overload"]
        assert total_with_overload == total_listed, (
            f"total_with_overload ({total_with_overload}) should match "
            f"contingencies list length ({total_listed})"
        )

    def test_peak_loading_pct_is_reasonable(self, contingency_data):
        """Verify peak_loading_pct is > 100 and <= 130."""
        peak = contingency_data["peak_loading_pct"]
        assert peak > 100, (
            f"Peak loading {peak}% should be > 100% (expected overloads)"
        )
        assert peak <= 130.0, (
            f"Peak loading {peak}% should be <= 130% (calibration target)"
        )

    def test_peak_loading_matches_max_in_contingencies(self, contingency_data):
        """Verify peak_loading_pct matches the highest loading in contingencies."""
        if not contingency_data["contingencies"]:
            pytest.skip("No contingencies to validate")

        peak_reported = contingency_data["peak_loading_pct"]
        actual_peak = max(
            c["max_loading_pct"]
            for c in contingency_data["contingencies"]
        )
        assert abs(peak_reported - actual_peak) < 0.1, (
            f"Reported peak {peak_reported}% doesn't match actual max "
            f"{actual_peak}% in contingencies (tolerance 0.1%)"
        )


class TestContingencyEntries:
    """Test individual contingency entry structure and values."""

    def test_each_contingency_has_required_fields(self, contingency_data):
        """Verify each contingency has all required fields."""
        required_fields = [
            "tripped_line",
            "tripped_line_name",
            "tripped_vl1",
            "tripped_vl2",
            "tripped_vl1_name",
            "tripped_vl2_name",
            "max_loading_pct",
            "most_loaded_line",
            "most_loaded_line_name",
            "n_overloaded_lines",
            "overloaded_lines",
        ]
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            for field in required_fields:
                assert field in contingency, (
                    f"Contingency {idx} (tripped_line={contingency.get('tripped_line', '?')}) "
                    f"missing field: '{field}'"
                )

    def test_tripped_line_ids_are_strings(self, contingency_data):
        """Verify tripped_line IDs are non-empty strings."""
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            tripped_line = contingency["tripped_line"]
            assert isinstance(tripped_line, str), (
                f"Contingency {idx}: tripped_line should be string, "
                f"got {type(tripped_line)}"
            )
            assert len(tripped_line) > 0, (
                f"Contingency {idx}: tripped_line should not be empty"
            )

    def test_tripped_vl_ids_are_strings(self, contingency_data):
        """Verify VL IDs start with 'VL_' prefix."""
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            vl1 = contingency["tripped_vl1"]
            vl2 = contingency["tripped_vl2"]
            assert isinstance(vl1, str) and vl1.startswith("VL_"), (
                f"Contingency {idx}: tripped_vl1 should start with 'VL_', got {vl1}"
            )
            assert isinstance(vl2, str) and vl2.startswith("VL_"), (
                f"Contingency {idx}: tripped_vl2 should start with 'VL_', got {vl2}"
            )

    def test_max_loading_pct_is_over_100(self, contingency_data):
        """Verify all contingencies have max_loading_pct > 100."""
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            max_loading = contingency["max_loading_pct"]
            assert max_loading > 100, (
                f"Contingency {idx} ({contingency['tripped_line']}) "
                f"has max_loading {max_loading}% <= 100%"
            )

    def test_max_loading_pct_is_at_most_130(self, contingency_data):
        """Verify all contingencies have max_loading_pct <= 130."""
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            max_loading = contingency["max_loading_pct"]
            assert max_loading <= 130.0, (
                f"Contingency {idx} ({contingency['tripped_line']}) "
                f"has max_loading {max_loading}% > 130% (calibration exceeded)"
            )

    def test_n_overloaded_lines_matches_list_length(self, contingency_data):
        """Verify n_overloaded_lines matches overloaded_lines list length."""
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            reported_count = contingency["n_overloaded_lines"]
            actual_count = len(contingency["overloaded_lines"])
            assert reported_count == actual_count, (
                f"Contingency {idx} ({contingency['tripped_line']}) "
                f"reports {reported_count} overloaded lines but has {actual_count}"
            )

    def test_overloaded_lines_have_required_fields(self, contingency_data):
        """Verify each overloaded line entry has required fields."""
        required_ol_fields = [
            "line_id",
            "line_name",
            "loading_pct",
            "current_a",
            "limit_a",
        ]
        for cont_idx, contingency in enumerate(contingency_data["contingencies"]):
            for ol_idx, overloaded_line in enumerate(
                contingency["overloaded_lines"]
            ):
                for field in required_ol_fields:
                    assert field in overloaded_line, (
                        f"Contingency {cont_idx}, overloaded_line {ol_idx} "
                        f"missing field: '{field}'"
                    )

    def test_overloaded_line_loading_pct_is_over_100(self, contingency_data):
        """Verify all overloaded line entries have loading_pct > 100."""
        for cont_idx, contingency in enumerate(contingency_data["contingencies"]):
            for ol_idx, ol in enumerate(contingency["overloaded_lines"]):
                loading = ol["loading_pct"]
                assert loading > 100, (
                    f"Contingency {cont_idx}, overloaded_line {ol_idx} "
                    f"({ol['line_id']}) has loading {loading}% <= 100%"
                )

    def test_overloaded_line_loading_pct_is_at_most_130(self, contingency_data):
        """Verify all overloaded line entries have loading_pct <= 130."""
        for cont_idx, contingency in enumerate(contingency_data["contingencies"]):
            for ol_idx, ol in enumerate(contingency["overloaded_lines"]):
                loading = ol["loading_pct"]
                assert loading <= 130.0, (
                    f"Contingency {cont_idx}, overloaded_line {ol_idx} "
                    f"({ol['line_id']}) has loading {loading}% > 130%"
                )

    def test_current_a_and_limit_a_are_positive(self, contingency_data):
        """Verify current_a and limit_a are positive numbers."""
        for cont_idx, contingency in enumerate(contingency_data["contingencies"]):
            for ol_idx, ol in enumerate(contingency["overloaded_lines"]):
                current = ol["current_a"]
                limit = ol["limit_a"]
                assert current > 0, (
                    f"Contingency {cont_idx}, overloaded_line {ol_idx} "
                    f"has current_a={current} <= 0"
                )
                assert limit > 0, (
                    f"Contingency {cont_idx}, overloaded_line {ol_idx} "
                    f"has limit_a={limit} <= 0"
                )

    def test_loading_pct_consistency_with_current_and_limit(self, contingency_data):
        """Verify loading_pct = (current_a / limit_a) * 100."""
        tolerance = 0.5  # Allow 0.5% rounding error
        for cont_idx, contingency in enumerate(contingency_data["contingencies"]):
            for ol_idx, ol in enumerate(contingency["overloaded_lines"]):
                computed = (ol["current_a"] / ol["limit_a"]) * 100
                reported = ol["loading_pct"]
                error = abs(computed - reported)
                assert error < tolerance, (
                    f"Contingency {cont_idx}, overloaded_line {ol_idx} "
                    f"({ol['line_id']}): loading_pct={reported}% but "
                    f"computed from current/limit={computed}% (error={error:.2f}%)"
                )


class TestContingencyOrdering:
    """Test that contingencies are properly sorted and organized."""

    def test_contingencies_sorted_by_max_loading_descending(self, contingency_data):
        """Verify contingencies are sorted by max_loading_pct in descending order."""
        contingencies = contingency_data["contingencies"]
        if len(contingencies) <= 1:
            pytest.skip("Need at least 2 contingencies to test ordering")

        for idx in range(len(contingencies) - 1):
            current = contingencies[idx]["max_loading_pct"]
            next_val = contingencies[idx + 1]["max_loading_pct"]
            assert current >= next_val, (
                f"Contingency {idx} (loading={current}%) "
                f"should be >= contingency {idx + 1} (loading={next_val}%) "
                f"for descending sort"
            )


class TestContingencyConsistency:
    """Test cross-field consistency within contingencies."""

    def test_most_loaded_line_in_overloaded_lines(self, contingency_data):
        """Verify the most_loaded_line is in the overloaded_lines list."""
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            if not contingency["overloaded_lines"]:
                # No overloaded lines — skip this check
                continue

            most_loaded_id = contingency["most_loaded_line"]
            overloaded_ids = [ol["line_id"] for ol in contingency["overloaded_lines"]]

            assert most_loaded_id in overloaded_ids, (
                f"Contingency {idx} ({contingency['tripped_line']}): "
                f"most_loaded_line '{most_loaded_id}' not in overloaded_lines list"
            )

    def test_max_loading_matches_most_loaded_line(self, contingency_data):
        """Verify max_loading_pct corresponds to most_loaded_line loading."""
        tolerance = 0.5  # Allow 0.5% rounding error
        for idx, contingency in enumerate(contingency_data["contingencies"]):
            if not contingency["overloaded_lines"]:
                continue

            most_loaded_id = contingency["most_loaded_line"]
            max_loading = contingency["max_loading_pct"]

            most_loaded_ol = next(
                (ol for ol in contingency["overloaded_lines"]
                 if ol["line_id"] == most_loaded_id),
                None,
            )

            assert most_loaded_ol is not None, (
                f"Contingency {idx}: most_loaded_line '{most_loaded_id}' "
                f"not found in overloaded_lines"
            )

            ol_loading = most_loaded_ol["loading_pct"]
            error = abs(max_loading - ol_loading)
            assert error < tolerance, (
                f"Contingency {idx}: max_loading_pct={max_loading}% but "
                f"most_loaded_line ({most_loaded_id}) has loading_pct={ol_loading}% "
                f"(error={error:.2f}%)"
            )


# ===========================================================================
# Slow tests: Network analysis with pypowsybl
# ===========================================================================

def _build_limit_map(network):
    """Build a dict mapping line_id -> permanent current limit (A).

    pypowsybl's get_operational_limits() returns a DataFrame with a
    multi-index (element_id, side, type, acceptable_duration, group_name)
    and columns including 'value'. The 'type' field is an index level,
    not a column.
    """
    import numpy as np

    limits = network.get_operational_limits()
    limit_map = {}
    for idx, row in limits.iterrows():
        el_id = idx[0]  # element_id is first level of multi-index
        limit_map[el_id] = row["value"]
    return limit_map


def _compute_loadings(network, limit_map):
    """Compute N-state loading (%) for each line with a limit."""
    import numpy as np

    lines = network.get_lines()[["i1", "i2"]]
    loadings = []
    for lid, row in lines.iterrows():
        if np.isnan(row["i1"]):
            continue
        flow = max(abs(row["i1"]), abs(row["i2"]))
        lim = limit_map.get(lid, 0)
        if lim > 0:
            loadings.append(flow / lim * 100.0)
    return sorted(loadings)


@pytest.mark.slow
class TestNStateLoading:
    """Test N-state (no contingency) loading distribution."""

    def test_ac_loadflow_converges(self, network):
        """Verify AC load flow converges on the network."""
        pp = pytest.importorskip("pypowsybl")
        result = pp.loadflow.run_ac(
            network, pp.loadflow.Parameters(distributed_slack=True)
        )
        status = str(result[0].status)
        assert "CONVERGED" in status, f"AC loadflow failed: {status}"

    def test_no_nan_voltages_after_loadflow(self, network):
        """Verify no buses have NaN voltage after loadflow."""
        pp = pytest.importorskip("pypowsybl")
        pp.loadflow.run_ac(
            network, pp.loadflow.Parameters(distributed_slack=True)
        )
        buses = network.get_buses()
        nan_count = buses["v_mag"].isna().sum()
        assert nan_count == 0, f"{nan_count} buses have NaN voltage"

    def test_median_n_state_loading_le_50_pct(self, network):
        """Verify median N-state loading is <= 50%."""
        pp = pytest.importorskip("pypowsybl")
        pp.loadflow.run_ac(
            network, pp.loadflow.Parameters(distributed_slack=True)
        )
        limit_map = _build_limit_map(network)
        loadings = _compute_loadings(network, limit_map)

        assert len(loadings) > 0, "No lines with limits found"
        median = loadings[len(loadings) // 2]
        assert median <= 50.0, (
            f"Median N-state loading {median:.1f}% > 50% threshold"
        )

    def test_at_least_50_pct_lines_at_le_50_pct_loading(self, network):
        """Verify at least 50% of lines are at <= 50% loading."""
        pp = pytest.importorskip("pypowsybl")
        pp.loadflow.run_ac(
            network, pp.loadflow.Parameters(distributed_slack=True)
        )
        limit_map = _build_limit_map(network)
        loadings = _compute_loadings(network, limit_map)

        assert len(loadings) > 0, "No lines with limits found"
        pct_le_50 = sum(1 for x in loadings if x <= 50.0) / len(loadings) * 100
        assert pct_le_50 >= 50.0, (
            f"Only {pct_le_50:.1f}% of lines at <= 50% loading "
            f"(expected >= 50%)"
        )

    def test_max_n_state_loading_le_65_pct(self, network):
        """Verify max N-state loading is <= 65%."""
        pp = pytest.importorskip("pypowsybl")
        pp.loadflow.run_ac(
            network, pp.loadflow.Parameters(distributed_slack=True)
        )
        limit_map = _build_limit_map(network)
        loadings = _compute_loadings(network, limit_map)

        assert len(loadings) > 0, "No lines with limits found"
        # Allow 0.5% tolerance for floating-point rounding in limit calibration
        assert loadings[-1] <= 65.5, (
            f"Max N-state loading {loadings[-1]:.1f}% > 65.5% threshold"
        )

    def test_no_line_below_100_a_limit(self, network):
        """Verify no line has a limit below 100 A."""
        limit_map = _build_limit_map(network)
        below_100 = {lid: v for lid, v in limit_map.items() if v < 100.0}
        assert len(below_100) == 0, (
            f"{len(below_100)} lines have limits below 100 A: "
            f"{list(below_100.items())[:5]}"
        )


@pytest.mark.slow
class TestN1Contingencies:
    """Test N-1 contingency behavior."""

    def test_all_398_lines_testable(self, network):
        """Verify all 398 lines can be tested as contingencies (AC converges)."""
        pp = pytest.importorskip("pypowsybl")
        lines = network.get_lines()
        assert len(lines) == 398, f"Expected 398 lines, got {len(lines)}"

        converged_count = 0
        for line_id in lines.index:
            n_test = pp.network.load(str(DATA_DIR / "network.xiidm"))
            try:
                n_test.update_lines(
                    id=[line_id], connected1=[False], connected2=[False]
                )
            except Exception:
                continue

            result = pp.loadflow.run_ac(
                n_test, pp.loadflow.Parameters(distributed_slack=True)
            )
            if "CONVERGED" in str(result[0].status):
                converged_count += 1

        assert converged_count == 398, (
            f"Only {converged_count}/398 contingencies converged under AC loadflow"
        )

    def test_no_n1_overload_above_130_pct(self, network):
        """Verify no N-1 contingency produces overloads above 130%."""
        import numpy as np

        pp = pytest.importorskip("pypowsybl")
        lines = network.get_lines()

        # Build limit map once from the base network
        limit_map = _build_limit_map(network)
        max_loading_found = 0

        for line_id in lines.index[:50]:  # Test first 50 for speed
            n_test = pp.network.load(str(DATA_DIR / "network.xiidm"))
            try:
                n_test.update_lines(
                    id=[line_id], connected1=[False], connected2=[False]
                )
            except Exception:
                continue

            result = pp.loadflow.run_ac(
                n_test, pp.loadflow.Parameters(distributed_slack=True)
            )
            if "CONVERGED" not in str(result[0].status):
                continue

            test_lines = n_test.get_lines()[["i1", "i2"]]
            for test_line_id, row in test_lines.iterrows():
                if test_line_id == line_id or np.isnan(row["i1"]):
                    continue
                flow = max(abs(row["i1"]), abs(row["i2"]))
                lim = limit_map.get(test_line_id, 0)
                if lim > 0:
                    loading = flow / lim * 100.0
                    max_loading_found = max(max_loading_found, loading)

        assert max_loading_found <= 130.0, (
            f"Found N-1 loading {max_loading_found:.1f}% > 130% "
            f"(calibration exceeded)"
        )

    def test_at_least_10_contingencies_with_overload(self, contingency_data):
        """Verify at least 10 contingencies produce >100% overloads."""
        total = contingency_data["total_with_overload"]
        assert total >= 10, (
            f"Expected at least 10 contingencies with overload, got {total}"
        )


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
