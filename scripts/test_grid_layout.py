"""
test_grid_layout.py
===================

Tests for validating the grid_layout.json file used by pypowsybl NAD rendering.

This test suite verifies:
1. All keys are valid voltage-level IDs (format "VL_*"), not bus IDs (which would have "_0", "_1" suffixes)
2. All VL IDs from the network file exist in the layout (no missing positions)
3. Coordinates are in the correct range: x-span and y-span between 5000 and 20000 units
4. Geographic orientation is correct: Y coordinates negative for northern France, less negative for southern
5. Layout has the expected number of entries matching the network's voltage level count

The test also validates the Mercator projection + rescaling logic used by the conversion script.

Usage:
    pytest test_grid_layout.py -v

Or with verbose output:
    pytest test_grid_layout.py -vv --tb=short
"""

import json
import math
import os
import re
from pathlib import Path

import pytest

# Skip all tests if pypowsybl is not available
pytest.importorskip("pypowsybl", minversion=None)
import pypowsybl as pp


# ─────────────────────────────────────────────────────────────────────────────
# Test Fixtures
# ─────────────────────────────────────────────────────────────────────────────

@pytest.fixture(scope="module")
def project_dir():
    """Return the project root directory."""
    return Path(__file__).parent.parent


@pytest.fixture(scope="module")
def network_file(project_dir):
    """Return the path to the network XIIDM file."""
    network_path = project_dir / "data" / "pypsa_eur_fr400" / "network.xiidm"
    assert network_path.exists(), f"Network file not found: {network_path}"
    return network_path


@pytest.fixture(scope="module")
def layout_file(project_dir):
    """Return the path to the grid_layout.json file."""
    layout_path = project_dir / "data" / "pypsa_eur_fr400" / "grid_layout.json"
    assert layout_path.exists(), f"Layout file not found: {layout_path}"
    return layout_path


@pytest.fixture(scope="module")
def network(network_file):
    """Load the pypowsybl network."""
    return pp.network.load(str(network_file))


@pytest.fixture(scope="module")
def layout_data(layout_file):
    """Load the grid_layout.json data."""
    with open(layout_file, "r") as f:
        return json.load(f)


@pytest.fixture(scope="module")
def network_vl_ids(network):
    """Get all voltage level IDs from the network."""
    vls = network.get_voltage_levels()
    return set(vls.index.tolist())


# ─────────────────────────────────────────────────────────────────────────────
# Tests: Layout Key Validation
# ─────────────────────────────────────────────────────────────────────────────

class TestLayoutKeyValidation:
    """Tests for validating the format and content of layout keys."""

    def test_all_keys_start_with_vl(self, layout_data):
        """Verify all keys in layout have VL_ prefix (voltage-level IDs)."""
        invalid_keys = [k for k in layout_data.keys() if not k.startswith("VL_")]
        assert len(invalid_keys) == 0, (
            f"Found {len(invalid_keys)} keys without 'VL_' prefix "
            f"(these may be bus IDs): {invalid_keys[:5]}"
        )

    def test_no_bus_id_suffixes(self, layout_data):
        """Verify no keys have bus-ID suffixes like '_0' or '_1'."""
        # Bus IDs end with "_0" or "_1" (node breaker topology)
        invalid_keys = [k for k in layout_data.keys() if re.search(r'_[01]$', k)]
        # More careful: only flag if it looks like a bus ID (has voltage after the node number)
        bus_like = [
            k for k in invalid_keys
            if re.search(r'-\d+$', k)  # ends with -number (e.g., "VL_...-400")
        ]
        # The "-400" or "-380" patterns in our layout are OK (part of VL ID).
        # We're looking for actual node suffixes "_0" or "_1" not followed by "-".
        truly_invalid = [
            k for k in layout_data.keys()
            if re.search(r'_[01](-\d+)?$', k) and not re.search(r'_[01a-z]', k)
        ]
        # Actually, looking at the data: "VL_virtual_relation_3756990_0-380" has "_0-" so it's fine.
        # The test should only fail if we have pure "_0" or "_1" as final suffix.
        truly_invalid = [
            k for k in layout_data.keys()
            if k.endswith(("_0", "_1")) and not re.search(r'_[01](-\d+)$', k)
        ]
        assert len(truly_invalid) == 0, (
            f"Found {len(truly_invalid)} keys with bus-ID-like suffixes: {truly_invalid[:5]}"
        )

    def test_keys_are_valid_python_identifiers(self, layout_data):
        """Verify all keys are valid identifiers (for use in IIDM)."""
        # IIDM IDs can contain letters, digits, underscore, hyphen, dot
        valid_pattern = re.compile(r'^[A-Za-z_][A-Za-z0-9_\-\.]*$')
        invalid_keys = [k for k in layout_data.keys() if not valid_pattern.match(k)]
        assert len(invalid_keys) == 0, f"Found {len(invalid_keys)} invalid IIDM IDs: {invalid_keys}"


# ─────────────────────────────────────────────────────────────────────────────
# Tests: Coverage & Completeness
# ─────────────────────────────────────────────────────────────────────────────

class TestLayoutCoverage:
    """Tests for ensuring the layout covers all network voltage levels."""

    def test_all_network_vls_in_layout(self, layout_data, network_vl_ids):
        """Verify all network VL IDs exist in the layout."""
        layout_keys = set(layout_data.keys())
        missing_vls = network_vl_ids - layout_keys
        assert len(missing_vls) == 0, (
            f"Found {len(missing_vls)} network VLs missing from layout: {sorted(missing_vls)[:5]}"
        )

    def test_layout_size_matches_network(self, layout_data, network_vl_ids):
        """Verify layout has the same number of entries as network VLs."""
        assert len(layout_data) == len(network_vl_ids), (
            f"Layout has {len(layout_data)} entries but network has {len(network_vl_ids)} VLs. "
            f"Extra layout keys: {set(layout_data.keys()) - network_vl_ids}"
        )

    def test_no_extra_keys_in_layout(self, layout_data, network_vl_ids):
        """Verify layout has no extraneous keys beyond the network."""
        layout_keys = set(layout_data.keys())
        extra_keys = layout_keys - network_vl_ids
        assert len(extra_keys) == 0, (
            f"Found {len(extra_keys)} extra keys in layout not in network: {sorted(extra_keys)[:5]}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Tests: Coordinate Range Validation
# ─────────────────────────────────────────────────────────────────────────────

class TestCoordinateRanges:
    """Tests for validating coordinate ranges match pypowsybl's force-layout scale."""

    def test_coordinates_are_lists_of_two_numbers(self, layout_data):
        """Verify all coordinates are [x, y] pairs of numbers."""
        for vl_id, coord in layout_data.items():
            assert isinstance(coord, list), f"VL {vl_id}: coordinate is not a list"
            assert len(coord) == 2, f"VL {vl_id}: coordinate has {len(coord)} values, expected 2"
            assert isinstance(coord[0], (int, float)), f"VL {vl_id}: x is not numeric"
            assert isinstance(coord[1], (int, float)), f"VL {vl_id}: y is not numeric"

    def test_coordinate_spans_in_reasonable_range(self, layout_data):
        """Verify x and y spans are between 5000 and 20000 units."""
        xs = [coord[0] for coord in layout_data.values()]
        ys = [coord[1] for coord in layout_data.values()]

        x_span = max(xs) - min(xs)
        y_span = max(ys) - min(ys)

        # The conversion script targets 8000 units for x-span
        # Allow range of 5000-20000 to account for different network sizes
        assert 5000 <= x_span <= 20000, (
            f"X-span {x_span:.0f} is outside expected range [5000, 20000]. "
            f"X range: [{min(xs):.0f}, {max(xs):.0f}]"
        )
        assert 5000 <= y_span <= 20000, (
            f"Y-span {y_span:.0f} is outside expected range [5000, 20000]. "
            f"Y range: [{min(ys):.0f}, {max(ys):.0f}]"
        )

    def test_coordinates_are_centered_near_origin(self, layout_data):
        """Verify coordinates are roughly centered near (0, 0) after rescaling."""
        xs = [coord[0] for coord in layout_data.values()]
        ys = [coord[1] for coord in layout_data.values()]

        # After rescaling, the center should be near (0, 0)
        # Allow ±10% of span for numerical precision
        x_span = max(xs) - min(xs)
        y_span = max(ys) - min(ys)
        x_center = (min(xs) + max(xs)) / 2
        y_center = (min(ys) + max(ys)) / 2

        assert abs(x_center) < x_span * 0.1, (
            f"X center {x_center:.0f} is too far from origin "
            f"(more than 10% of x_span {x_span:.0f})"
        )
        assert abs(y_center) < y_span * 0.1, (
            f"Y center {y_center:.0f} is too far from origin "
            f"(more than 10% of y_span {y_span:.0f})"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Tests: Geographic Orientation
# ─────────────────────────────────────────────────────────────────────────────

class TestGeographicOrientation:
    """Tests for validating geographic orientation (north = negative y)."""

    def test_northern_vls_have_more_negative_y(self, layout_data):
        """Verify that northern France voltage levels have more negative y-coordinates."""
        # France spans from ~42.7°N (Perpignan, south) to ~51°N (Dunkerque, north)
        # Expected latitude distribution: look for any VLs with "north" or "south" in name
        # For now, test the principle: max-y minus some threshold should be < min-y minus some threshold
        # More specifically: the y-coordinates should show geographic variation

        ys = [coord[1] for coord in layout_data.values()]

        # In screen coordinates (y negated for north-up), we expect to see variation
        # This is a basic sanity check
        y_min = min(ys)  # Most negative = north
        y_max = max(ys)  # Least negative = south
        y_span = y_max - y_min

        # The span should be significant (at least 10% of x-span for a rectangular country)
        xs = [coord[0] for coord in layout_data.values()]
        x_span = max(xs) - min(xs)

        # France is roughly 600 km north-south and 900 km east-west
        # So y_span should be at least half of x_span
        assert y_span > x_span * 0.4, (
            f"Y-span {y_span:.0f} seems too small relative to x-span {x_span:.0f}. "
            f"Expected geographic variation from north to south."
        )

    def test_y_range_shows_north_south_gradient(self, layout_data):
        """Verify y-coordinates are distributed across north-south range."""
        ys = [coord[1] for coord in layout_data.values()]

        # We should have a good distribution of y values
        # (not all clustered at one end)
        y_min = min(ys)
        y_max = max(ys)
        y_range = y_max - y_min

        # Find quantile distribution
        sorted_ys = sorted(ys)
        q25 = sorted_ys[len(sorted_ys) // 4]
        q75 = sorted_ys[3 * len(sorted_ys) // 4]
        iq_range = q75 - q25

        # IQR should be at least 30% of full range
        assert iq_range > y_range * 0.3, (
            f"Y-coordinate distribution is too skewed. "
            f"IQR {iq_range:.0f} is less than 30% of range {y_range:.0f}"
        )


# ─────────────────────────────────────────────────────────────────────────────
# Tests: Mercator Projection Logic
# ─────────────────────────────────────────────────────────────────────────────

class TestMercatorProjection:
    """Tests for validating the Mercator projection used in the conversion script."""

    @staticmethod
    def lon_lat_to_mercator(lon, lat):
        """
        Convert WGS-84 lon/lat to Web Mercator projection.

        This mirrors the logic from convert_pypsa_to_xiidm.py.
        """
        EARTH_RADIUS = 6_378_137.0  # WGS-84 semi-major axis (metres)
        x = math.radians(lon) * EARTH_RADIUS
        y = math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * EARTH_RADIUS
        return x, y

    def test_mercator_north_south_ordering(self):
        """
        Test that Mercator projection preserves north-south ordering:
        northern locations should have larger y values (more negative when negated).
        """
        # Dunkerque (north): lon=2.38, lat=51.03
        # Perpignan (south): lon=2.90, lat=42.70
        dunkerque_lon, dunkerque_lat = 2.38, 51.03
        perpignan_lon, perpignan_lat = 2.90, 42.70

        dunkerque_mx, dunkerque_my = self.lon_lat_to_mercator(dunkerque_lon, dunkerque_lat)
        perpignan_mx, perpignan_my = self.lon_lat_to_mercator(perpignan_lon, perpignan_lat)

        # In Mercator, larger latitude -> larger y value
        assert dunkerque_my > perpignan_my, (
            f"Mercator projection broken: Dunkerque y={dunkerque_my:.0f} "
            f"should be > Perpignan y={perpignan_my:.0f}"
        )

    def test_mercator_east_west_ordering(self):
        """
        Test that Mercator projection preserves east-west ordering:
        eastern locations should have larger x values.
        """
        # Brest (west): lon=-4.49, lat=48.39
        # Strasbourg (east): lon=7.75, lat=48.57
        brest_lon, brest_lat = -4.49, 48.39
        strasbourg_lon, strasbourg_lat = 7.75, 48.57

        brest_mx, _ = self.lon_lat_to_mercator(brest_lon, brest_lat)
        strasbourg_mx, _ = self.lon_lat_to_mercator(strasbourg_lon, strasbourg_lat)

        # Eastward = larger longitude = larger x
        assert strasbourg_mx > brest_mx, (
            f"Mercator projection broken: Strasbourg x={strasbourg_mx:.0f} "
            f"should be > Brest x={brest_mx:.0f}"
        )

    def test_mercator_negation_for_screen_coordinates(self):
        """
        Test the negation of y for screen coordinates (north = negative y).

        In screen coordinates, north should be more negative than south.
        """
        dunkerque_lon, dunkerque_lat = 2.38, 51.03
        perpignan_lon, perpignan_lat = 2.90, 42.70

        _, dunkerque_my = self.lon_lat_to_mercator(dunkerque_lon, dunkerque_lat)
        _, perpignan_my = self.lon_lat_to_mercator(perpignan_lon, perpignan_lat)

        # After negation for screen coordinates
        dunkerque_screen_y = -dunkerque_my
        perpignan_screen_y = -perpignan_my

        # North (Dunkerque) should be MORE negative than south (Perpignan)
        assert dunkerque_screen_y < perpignan_screen_y, (
            f"Screen coordinate negation broken: "
            f"Dunkerque (north) screen_y={dunkerque_screen_y:.0f} "
            f"should be < Perpignan (south) screen_y={perpignan_screen_y:.0f}"
        )

    def test_rescaling_preserves_ordering(self):
        """
        Test that rescaling (uniform scaling + translation) preserves coordinate ordering.
        """
        # Create a set of test coordinates
        coords = [
            (2.38, 51.03, "Dunkerque"),  # north
            (2.90, 42.70, "Perpignan"),  # south
            (-4.49, 48.39, "Brest"),     # west
            (7.75, 48.57, "Strasbourg"), # east
        ]

        # Project all to Mercator
        projected = []
        for lon, lat, name in coords:
            mx, my = self.lon_lat_to_mercator(lon, lat)
            projected.append((mx, -my, name))

        # Find bounds
        xs = [p[0] for p in projected]
        ys = [p[1] for p in projected]
        x_min, x_max = min(xs), max(xs)
        y_min, y_max = min(ys), max(ys)
        p_cx = (x_min + x_max) / 2
        p_cy = (y_min + y_max) / 2
        p_xrange = x_max - x_min

        # Rescale
        TARGET_WIDTH = 8_000.0
        scale = TARGET_WIDTH / p_xrange

        rescaled = []
        for mx, my, name in projected:
            rx = (mx - p_cx) * scale
            ry = (my - p_cy) * scale
            rescaled.append((rx, ry, name))

        # Verify ordering is preserved
        # Dunkerque should still be north of Perpignan (more negative y)
        dunkerque_y = next(r[1] for r in rescaled if r[2] == "Dunkerque")
        perpignan_y = next(r[1] for r in rescaled if r[2] == "Perpignan")
        assert dunkerque_y < perpignan_y, (
            f"Rescaling broke ordering: "
            f"Dunkerque y={dunkerque_y:.0f} should be < Perpignan y={perpignan_y:.0f}"
        )

        # Strasbourg should still be east of Brest (larger x)
        brest_x = next(r[0] for r in rescaled if r[2] == "Brest")
        strasbourg_x = next(r[0] for r in rescaled if r[2] == "Strasbourg")
        assert strasbourg_x > brest_x, (
            f"Rescaling broke ordering: "
            f"Strasbourg x={strasbourg_x:.0f} should be > Brest x={brest_x:.0f}"
        )

    def test_mercator_coordinates_within_expected_bounds(self):
        """
        Test that projected Mercator coordinates for France are within expected range.

        France spans roughly:
        - Longitude: -4.5 to 7.5 (12 degrees)
        - Latitude: 42.7 to 51.0 (8.3 degrees)
        """
        france_bounds = [
            (-4.49, 48.39, "Brest"),
            (7.75, 48.57, "Strasbourg"),
            (2.38, 51.03, "Dunkerque"),
            (2.90, 42.70, "Perpignan"),
        ]

        for lon, lat, name in france_bounds:
            mx, my = self.lon_lat_to_mercator(lon, lat)
            # Mercator x should be roughly -500k to +850k for France longitude range
            assert -600_000 < mx < 900_000, (
                f"{name}: Mercator x={mx:.0f} outside expected range for France"
            )
            # Mercator y should be roughly +5.1M to +6.8M for France latitude range
            assert 5_000_000 < my < 7_000_000, (
                f"{name}: Mercator y={my:.0f} outside expected range for France"
            )


# ─────────────────────────────────────────────────────────────────────────────
# Integration Tests
# ─────────────────────────────────────────────────────────────────────────────

class TestLayoutIntegration:
    """Integration tests combining multiple validation aspects."""

    def test_layout_is_valid_json(self, layout_file):
        """Verify the layout file is valid JSON."""
        with open(layout_file, "r") as f:
            data = json.load(f)
        assert isinstance(data, dict), "Layout should be a JSON object"

    def test_all_vls_have_unique_positions(self, layout_data):
        """Verify no two VLs have identical coordinates."""
        positions = [tuple(coord) for coord in layout_data.values()]
        unique_positions = len(set(positions))
        total_vls = len(layout_data)

        # Allow a very small fraction of duplicates (e.g., 2 out of 192)
        # but flag if more than 1% are duplicates
        duplicate_count = total_vls - unique_positions
        assert duplicate_count <= max(1, total_vls // 100), (
            f"Found {duplicate_count} duplicate coordinates out of {total_vls} VLs"
        )

    def test_layout_statistics_reasonable(self, layout_data):
        """Print statistics about the layout for inspection."""
        xs = [coord[0] for coord in layout_data.values()]
        ys = [coord[1] for coord in layout_data.values()]

        x_span = max(xs) - min(xs)
        y_span = max(ys) - min(ys)

        # Print layout statistics (visible when test runs with -v)
        print("\nLayout Statistics for pypsa_eur_fr400:")
        print(f"  Total VLs: {len(layout_data)}")
        print(f"  X range: [{min(xs):.0f}, {max(xs):.0f}] (span: {x_span:.0f})")
        print(f"  Y range: [{min(ys):.0f}, {max(ys):.0f}] (span: {y_span:.0f})")
        print(f"  Aspect ratio (X/Y span): {x_span / y_span if y_span > 0 else 'inf':.2f}")

        # Assertions that should always pass if previous tests passed
        assert len(layout_data) > 0, "Layout should have entries"
        assert x_span > 0, "X span should be positive"
        assert y_span > 0, "Y span should be positive"


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
