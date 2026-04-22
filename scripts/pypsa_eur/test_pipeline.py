"""
test_pipeline.py
================
Tests for the PyPSA-EUR → XIIDM network generation pipeline.

Pipeline under test:
  1. fetch_osm_names.py         — OSM name fetching
  2. convert_pypsa_to_xiidm.py  — CSV → XIIDM conversion
  3. calibrate_thermal_limits.py — thermal limit calibration
  4. add_detailed_topology.py   — double-busbar + coupling breakers
  5. generate_n1_overloads.py   — N-1 overload report

These tests validate the already-generated pipeline outputs without
re-running the (slow) generation scripts. Unit tests for pure helper
functions are also included.

Fixtures (network_dir / actions / grid_layout / ... / expected_counts)
are defined in conftest.py and parametrized by the ``--pypsa-network``
pytest option (default: ``pypsa_eur_fr225_400``).

Usage:
    python -m pytest scripts/pypsa_eur/test_pipeline.py -v
    python -m pytest scripts/pypsa_eur/test_pipeline.py -v --pypsa-network pypsa_eur_fr400
"""

import json
import os
import re
import sys
from pathlib import Path

import pytest

# Make scripts importable for unit tests of helper functions
sys.path.insert(0, str(Path(__file__).resolve().parent))


# ===========================================================================
# 1. Pure helper function tests (no generated files needed)
# ===========================================================================

class TestSafeId:
    """Tests for the safe_id() helper used by convert_pypsa_to_xiidm.py."""

    def test_basic_replacement(self):
        from convert_pypsa_to_xiidm import safe_id
        assert safe_id("relation/13260100-400") == "relation_13260100-400"

    def test_virtual_prefix(self):
        from convert_pypsa_to_xiidm import safe_id
        assert safe_id("virtual_relation/19874522:0-400") == "virtual_relation_19874522_0-400"

    def test_merged_prefix(self):
        from convert_pypsa_to_xiidm import safe_id
        assert safe_id("merged_relation/6221844:a-400+1") == "merged_relation_6221844_a-400_1"

    def test_alphanumeric_passthrough(self):
        from convert_pypsa_to_xiidm import safe_id
        assert safe_id("ABC_123-test.x") == "ABC_123-test.x"

    def test_empty_string(self):
        from convert_pypsa_to_xiidm import safe_id
        assert safe_id("") == ""


class TestFetchOsmNamesParsers:
    """Tests for the OSM ID parsers in fetch_osm_names.py."""

    def test_parse_bus_relation(self):
        from fetch_osm_names import _parse_bus_osm_id
        osm_type, osm_id = _parse_bus_osm_id("relation/13260100-400")
        assert osm_type == "relation"
        assert osm_id == "13260100"

    def test_parse_bus_virtual_relation(self):
        from fetch_osm_names import _parse_bus_osm_id
        osm_type, osm_id = _parse_bus_osm_id("virtual_relation/19874522:0-400")
        assert osm_type == "relation"
        assert osm_id == "19874522"

    def test_parse_bus_way(self):
        from fetch_osm_names import _parse_bus_osm_id
        osm_type, osm_id = _parse_bus_osm_id("way/100087916-400")
        assert osm_type == "way"
        assert osm_id == "100087916"

    def test_parse_bus_virtual_way(self):
        from fetch_osm_names import _parse_bus_osm_id
        osm_type, osm_id = _parse_bus_osm_id("virtual_way/1346026649:1-400")
        assert osm_type == "way"
        assert osm_id == "1346026649"

    def test_parse_bus_invalid(self):
        from fetch_osm_names import _parse_bus_osm_id
        assert _parse_bus_osm_id("garbage") == (None, None)

    def test_parse_line_merged_relation(self):
        from fetch_osm_names import _parse_line_osm_id
        osm_type, osm_id = _parse_line_osm_id("merged_relation/6221844:a-400+1")
        assert osm_type == "relation"
        assert osm_id == "6221844"

    def test_parse_line_merged_way(self):
        from fetch_osm_names import _parse_line_osm_id
        osm_type, osm_id = _parse_line_osm_id("merged_way/100497456-400+1")
        assert osm_type == "way"
        assert osm_id == "100497456"

    def test_parse_line_invalid(self):
        from fetch_osm_names import _parse_line_osm_id
        assert _parse_line_osm_id("not_a_line") == (None, None)

    def test_extract_tags(self):
        from fetch_osm_names import _extract_tags
        element = {
            "tags": {
                "name": "Avelin - Weppes 1",
                "ref:FR:RTE": "AVELIL71WEPPE",
                "ref:FR:RTE_nom": "AVELIN",
                "power": "circuit",
                "voltage": "400000",
                "operator:short": "RTE",
                "circuits": "2",
            }
        }
        result = _extract_tags(element)
        assert result["name"] == "Avelin - Weppes 1"
        assert result["ref_rte"] == "AVELIL71WEPPE"
        assert result["ref_rte_nom"] == "AVELIN"
        assert result["display_name"] == "AVELIN"  # ref_rte_nom preferred
        assert result["power"] == "circuit"
        assert result["operator"] == "RTE"
        assert result["circuits"] == "2"

    def test_extract_tags_name_fallback(self):
        from fetch_osm_names import _extract_tags
        element = {"tags": {"name": "Some Line"}}
        result = _extract_tags(element)
        assert result["display_name"] == "Some Line"

    def test_extract_tags_empty(self):
        from fetch_osm_names import _extract_tags
        result = _extract_tags({"tags": {}})
        assert result["display_name"] == ""


# ===========================================================================
# 2. Source CSV files — verify the raw inputs exist and are parseable
# ===========================================================================

class TestSourceCSVs:
    """Ensure the raw PyPSA-EUR OSM CSVs are present and well-formed."""

    @pytest.mark.parametrize("filename", ["buses.csv", "lines.csv", "transformers.csv"])
    def test_csv_exists(self, filename, osm_dir):
        assert (osm_dir / filename).exists(), f"Missing {filename}"

    def test_buses_csv_has_expected_columns(self, osm_dir):
        import pandas as pd
        df = pd.read_csv(osm_dir / "buses.csv", index_col=0, nrows=5)
        for col in ["voltage", "country", "dc", "x", "y", "under_construction"]:
            assert col in df.columns, f"Missing column '{col}' in buses.csv"

    def test_lines_csv_has_expected_columns(self, osm_dir):
        import pandas as pd
        df = pd.read_csv(osm_dir / "lines.csv", index_col=0, nrows=5, quotechar="'")
        for col in ["bus0", "bus1", "r", "x", "b"]:
            assert col in df.columns, f"Missing column '{col}' in lines.csv"

    def test_transformers_csv_has_expected_columns(self, osm_dir):
        import pandas as pd
        df = pd.read_csv(osm_dir / "transformers.csv", index_col=0, nrows=5, quotechar="'")
        for col in ["bus0", "bus1", "s_nom"]:
            assert col in df.columns, f"Missing column '{col}' in transformers.csv"

    def test_buses_has_fr_400kv_entries(self, osm_dir):
        import pandas as pd
        df = pd.read_csv(osm_dir / "buses.csv", index_col=0)
        fr400 = df[
            (df["country"] == "FR")
            & (df["voltage"].isin([380, 400]))
            & (df["dc"] == "f")
        ]
        assert len(fr400) >= 150, f"Expected >=150 FR 400kV buses, got {len(fr400)}"


# ===========================================================================
# 3. Generated output files — existence and structure
# ===========================================================================

class TestOutputFiles:
    """Verify that all pipeline output files exist."""

    @pytest.mark.parametrize("filename", [
        "network.xiidm",
        "grid_layout.json",
        "bus_id_mapping.json",
        "line_id_names.json",
        "vl_next_node.json",
        "actions.json",
        "osm_names.json",
        "n1_overload_contingencies.json",
    ])
    def test_file_exists(self, filename, data_dir):
        path = data_dir / filename
        assert path.exists(), f"Missing output: {filename}"
        assert path.stat().st_size > 0, f"Empty output: {filename}"


# ===========================================================================
# 4. osm_names.json — name fetching results
# ===========================================================================

class TestOsmNames:
    """Validate the structure and content of osm_names.json."""

    def test_top_level_keys(self, osm_names):
        for key in ["substations", "circuits", "bus_to_name", "line_to_name"]:
            assert key in osm_names, f"Missing key '{key}'"

    def test_bus_to_name_coverage(self, osm_names):
        mapping = osm_names["bus_to_name"]
        assert len(mapping) >= 150, f"Expected >=150 bus->name mappings, got {len(mapping)}"

    def test_line_to_name_coverage(self, osm_names):
        mapping = osm_names["line_to_name"]
        assert len(mapping) >= 300, f"Expected >=300 line->name mappings, got {len(mapping)}"

    def test_bus_entry_has_display_name(self, osm_names):
        for bus_id, info in list(osm_names["bus_to_name"].items())[:10]:
            assert "display_name" in info, f"Bus {bus_id} missing display_name"
            assert "osm_key" in info, f"Bus {bus_id} missing osm_key"

    def test_line_entry_has_display_name(self, osm_names):
        for line_id, info in list(osm_names["line_to_name"].items())[:10]:
            assert "display_name" in info, f"Line {line_id} missing display_name"
            assert "osm_key" in info, f"Line {line_id} missing osm_key"

    def test_substations_have_display_name(self, osm_names):
        subs = osm_names["substations"]
        assert len(subs) >= 100, f"Expected >=100 substations, got {len(subs)}"
        non_empty = sum(1 for v in subs.values() if v.get("display_name"))
        assert non_empty > len(subs) * 0.5, "More than half of substations should have names"

    def test_circuits_have_names(self, osm_names):
        circuits = osm_names["circuits"]
        assert len(circuits) >= 200, f"Expected >=200 circuits, got {len(circuits)}"


# ===========================================================================
# 5. convert_pypsa_to_xiidm.py outputs
# ===========================================================================

class TestConversion:
    """Tests for the outputs of convert_pypsa_to_xiidm.py."""

    def test_bus_id_mapping_not_empty(self, bus_id_mapping):
        assert len(bus_id_mapping) >= 150, f"Expected >=150 buses, got {len(bus_id_mapping)}"

    def test_bus_id_mapping_roundtrip(self, bus_id_mapping):
        """Every safe_id key should be derivable from its original value."""
        for safe, original in bus_id_mapping.items():
            assert re.sub(r"[^A-Za-z0-9_\-\.]", "_", original) == safe

    def test_line_id_names_not_empty(self, line_id_names):
        assert len(line_id_names) >= 300, f"Expected >=300 lines, got {len(line_id_names)}"

    def test_line_id_names_have_real_names(self, line_id_names):
        """Most lines should have human-readable names (not raw IDs)."""
        named = sum(1 for name in line_id_names.values() if not name.startswith("merged_"))
        total = len(line_id_names)
        pct = named / total * 100
        assert pct > 60, f"Only {pct:.0f}% of lines have real names (expected >60%)"

    def test_vl_next_node_covers_buses(self, vl_next_node, bus_id_mapping):
        """Every bus should have a VL entry (counts may differ due to transformer-merged substations)."""
        assert len(vl_next_node) >= len(bus_id_mapping) * 0.9, (
            f"Expected vl_next_node count (~{len(bus_id_mapping)}) to closely match "
            f"bus count ({len(bus_id_mapping)}), got {len(vl_next_node)}"
        )

    def test_vl_next_node_values_valid(self, vl_next_node):
        """Node counters should be >= 2 (0=BBS1, 1=reserved for BBS2)."""
        for vl_id, counter in vl_next_node.items():
            assert counter >= 2, f"{vl_id} has invalid node counter {counter}"

    def test_grid_layout_has_entries(self, grid_layout, bus_id_mapping):
        # Layout should have at least one entry per bus/VL
        assert len(grid_layout) >= len(bus_id_mapping) * 0.9, (
            f"Expected >={int(len(bus_id_mapping) * 0.9)} layout entries, got {len(grid_layout)}"
        )

    def test_grid_layout_coordinates_are_geographic(self, grid_layout):
        """Coordinates should be consistent numeric pairs (x, y)."""
        for key, coords in list(grid_layout.items())[:50]:
            assert isinstance(coords, list) and len(coords) == 2, (
                f"{key} should be [x, y] pair, got {coords}"
            )
            assert all(isinstance(v, (int, float)) for v in coords), (
                f"{key} has non-numeric coords: {coords}"
            )


# ===========================================================================
# 6. actions.json — disconnection + coupling actions
# ===========================================================================

class TestActions:
    """Validate the actions.json file produced by the pipeline."""

    def test_disconnection_actions_match_lines(self, actions, expected_counts):
        """Disco actions ≈ lines + transformers (one per disconnectable element)."""
        disco = expected_counts["n_actions_disco"]
        n_lines = expected_counts["n_lines"]
        # disco = n_lines + a small number of transformers (usually a handful)
        assert disco >= n_lines, (
            f"Disco action count ({disco}) should be at least the line count ({n_lines})"
        )
        assert disco <= n_lines + 500, (
            f"Disco action count ({disco}) much larger than line count ({n_lines})"
        )

    def test_total_action_count_includes_couplers(self, expected_counts):
        """Total actions = disco + couplers (if couplers present)."""
        total = expected_counts["n_actions_total"]
        disco = expected_counts["n_actions_disco"]
        coupl = expected_counts["n_actions_coupler"]
        assert total == disco + coupl, (
            f"Total actions ({total}) != disco ({disco}) + couplers ({coupl})"
        )

    def test_coupler_actions_if_present(self, actions, expected_counts):
        """If couplers exist (full pipeline), validate their structure."""
        coupl = {k: v for k, v in actions.items() if k.startswith("open_coupler_")}
        if len(coupl) == 0:
            pytest.skip("No coupler actions — network at base pipeline stage")
        for action_id, data in coupl.items():
            assert "switches" in data, f"{action_id} missing switches"
            assert "VoltageLevelId" in data, f"{action_id} missing VoltageLevelId"
            assert len(data["switches"]) == 1, f"{action_id} should have exactly 1 switch"
            sw_id = list(data["switches"].keys())[0]
            assert sw_id.endswith("_COUPL"), f"{action_id} switch should end with _COUPL"
            assert data["switches"][sw_id] is True, f"{action_id} switch should be True (open)"

    def test_disco_action_structure(self, actions):
        disco_actions = {k: v for k, v in actions.items() if k.startswith("disco_")}
        for action_id, data in list(disco_actions.items())[:20]:
            assert "description" in data, f"{action_id} missing description"
            assert "description_unitaire" in data, f"{action_id} missing description_unitaire"
            assert "Disconnection" in data["description"] or "Ouverture" in data["description_unitaire"]

    def test_actions_have_display_names(self, actions):
        """Action descriptions should contain human-readable names, not raw IDs."""
        disco_actions = {k: v for k, v in actions.items() if k.startswith("disco_")}
        has_real_name = sum(
            1 for v in disco_actions.values()
            if not re.match(r".*'(merged_|relation_|way_).*'", v["description"])
        )
        total = len(disco_actions)
        pct = has_real_name / total * 100
        assert pct > 50, f"Only {pct:.0f}% of action descriptions use real names (expected >50%)"


# ===========================================================================
# 7. XIIDM network — structural validation via pypowsybl
# ===========================================================================

class TestNetworkXiidm:
    """Tests that load and inspect the generated network.xiidm file."""

    def test_bus_count(self, network, expected_counts):
        buses = network.get_buses()
        # With double-busbar, bus count can be higher than bus_id_mapping.
        # Legacy datasets may have a few orphan VL entries; allow ≤ 2 short.
        n_buses = expected_counts["n_buses"]
        assert len(buses) >= n_buses - 2, (
            f"Expected ≳ {n_buses} buses, got {len(buses)}"
        )

    def test_line_count(self, network, expected_counts):
        lines = network.get_lines()
        assert len(lines) == expected_counts["n_lines"], (
            f"Expected {expected_counts['n_lines']} lines, got {len(lines)}"
        )

    def test_transformer_count_reasonable(self, network, expected_counts):
        trafos = network.get_2_windings_transformers()
        # Trafos connect different voltage levels in the same substation
        assert len(trafos) >= 0, f"Got {len(trafos)} transformers"
        assert len(trafos) < expected_counts["n_buses"], (
            f"Unexpectedly high transformer count: {len(trafos)}"
        )

    def test_generator_count_matches_buses(self, network, expected_counts):
        gens = network.get_generators()
        # One generator per original bus. Legacy pypsa_eur_fr400 has a couple
        # of orphan bus entries; allow ≤ 2 missing.
        n_buses = expected_counts["n_buses"]
        assert n_buses - 2 <= len(gens) <= n_buses, (
            f"Expected ~{n_buses} generators, got {len(gens)}"
        )

    def test_load_count_matches_buses(self, network, expected_counts):
        loads = network.get_loads()
        n_buses = expected_counts["n_buses"]
        assert n_buses - 2 <= len(loads) <= n_buses, (
            f"Expected ~{n_buses} loads, got {len(loads)}"
        )

    def test_busbar_section_count(self, network, has_double_busbar, expected_counts):
        bbs = network.get_busbar_sections()
        n_vls = expected_counts["n_vls"]
        n_couplers = expected_counts["n_actions_coupler"]
        if has_double_busbar:
            expected = n_vls + n_couplers  # one extra BBS2 per coupler
            assert len(bbs) == expected, (
                f"Expected {expected} busbar sections ({n_vls} BBS1 + {n_couplers} BBS2), got {len(bbs)}"
            )
        else:
            assert len(bbs) == n_vls, (
                f"Expected {n_vls} busbar sections (BBS1 only), got {len(bbs)}"
            )

    def test_voltage_level_count(self, network, expected_counts):
        vls = network.get_voltage_levels()
        assert len(vls) == expected_counts["n_vls"], (
            f"Expected {expected_counts['n_vls']} voltage levels, got {len(vls)}"
        )

    def test_voltage_levels_nominal_in_target_range(self, network):
        vls = network.get_voltage_levels()
        allowed = {225.0, 380.0, 400.0}
        for vl_id, row in vls.iterrows():
            assert row["nominal_v"] in allowed, (
                f"{vl_id} has unexpected nominal_v={row['nominal_v']}, allowed: {allowed}"
            )

    def test_switch_kinds(self, network):
        sw = network.get_switches()
        kinds = sw["kind"].value_counts().to_dict()
        assert "DISCONNECTOR" in kinds
        assert "BREAKER" in kinds
        # In base topology: equal DISCO/BK counts; with double-busbar: more DISCOs
        assert kinds["DISCONNECTOR"] >= kinds["BREAKER"]

    def test_generators_have_voltage_regulation(self, network):
        gens = network.get_generators()
        assert all(gens["voltage_regulator_on"]), "All generators should have voltage regulation on"

    def test_lines_have_names(self, network):
        lines = network.get_lines()
        named = lines["name"].notna().sum()
        assert named == len(lines), f"Expected all {len(lines)} lines to have names, {named} do"

    def test_voltage_levels_have_names(self, network):
        vls = network.get_voltage_levels()
        named = vls["name"].notna().sum()
        assert named == len(vls), f"Expected all VLs to have names, {named}/{len(vls)} do"

    def test_vl_names_contain_voltage(self, network):
        """VL names should end with 'NNNkV' (e.g. 'BOUTRE 400kV')."""
        vls = network.get_voltage_levels()
        for vl_id, row in list(vls.iterrows())[:20]:
            name = row["name"]
            assert re.search(r"\d+kV$", name), f"VL name '{name}' doesn't end with voltage"

    def test_substations_have_names(self, network):
        ss = network.get_substations()
        named = ss["name"].notna().sum()
        pct = named / len(ss) * 100
        assert pct > 80, f"Only {pct:.0f}% of substations have names"

    def test_substation_country_is_fr(self, network):
        ss = network.get_substations()
        assert all(ss["country"] == "FR"), "All substations should be in France"

    def test_line_impedances_positive(self, network):
        """All lines should have positive R and X values."""
        lines = network.get_lines()
        assert (lines["r"] > 0).all(), "All line resistances should be positive"
        assert (lines["x"] > 0).all(), "All line reactances should be positive"


# ===========================================================================
# 8. Double-busbar topology — structural checks (skipped if not present)
# ===========================================================================

class TestDoubleBusbar:
    """Tests for the detailed double-busbar topology added by add_detailed_topology.py."""

    def test_bbs2_count_matches_couplers(self, network, has_double_busbar, expected_counts):
        if not has_double_busbar:
            pytest.skip("Network at base stage — no double-busbar topology")
        bbs = network.get_busbar_sections()
        bbs2 = [idx for idx in bbs.index if idx.endswith("_BBS2")]
        assert len(bbs2) == expected_counts["n_actions_coupler"], (
            f"Expected {expected_counts['n_actions_coupler']} BBS2 sections (one per coupler), got {len(bbs2)}"
        )

    def test_coupling_breakers_exist(self, network, has_double_busbar, expected_counts):
        if not has_double_busbar:
            pytest.skip("Network at base stage — no coupling breakers")
        sw = network.get_switches()
        couplers = [idx for idx in sw.index if idx.endswith("_COUPL")]
        assert len(couplers) == expected_counts["n_actions_coupler"], (
            f"Expected {expected_counts['n_actions_coupler']} coupling breakers, got {len(couplers)}"
        )

    def test_coupling_disconnectors_exist(self, network, has_double_busbar, expected_counts):
        if not has_double_busbar:
            pytest.skip("Network at base stage — no coupling disconnectors")
        sw = network.get_switches()
        n = expected_counts["n_actions_coupler"]
        d1s = [idx for idx in sw.index if idx.endswith("_COUPL_D1")]
        d2s = [idx for idx in sw.index if idx.endswith("_COUPL_D2")]
        assert len(d1s) == n, f"Expected {n} COUPL_D1, got {len(d1s)}"
        assert len(d2s) == n, f"Expected {n} COUPL_D2, got {len(d2s)}"

    def test_coupling_switches_all_closed(self, network, has_double_busbar):
        if not has_double_busbar:
            pytest.skip("Network at base stage")
        sw = network.get_switches()
        coupl_sw = sw[sw.index.str.contains("_COUPL")]
        open_couplers = coupl_sw[coupl_sw["open"] == True]
        assert len(open_couplers) == 0, f"{len(open_couplers)} coupling switches are unexpectedly open"

    def test_sa2_disconnectors_exist(self, network, has_double_busbar):
        if not has_double_busbar:
            pytest.skip("Network at base stage")
        sw = network.get_switches()
        sa2 = [idx for idx in sw.index if "_D2_" in idx and not idx.endswith("_COUPL_D2")]
        assert len(sa2) > 0, "No SA.2 disconnectors found"

    def test_round_robin_dispatch(self, network, has_double_busbar):
        """Branches should dispatch across BBS1 and BBS2 — not all on one bus."""
        if not has_double_busbar:
            pytest.skip("Network at base stage")
        sw = network.get_switches(all_attributes=True)
        sa1_open = 0
        sa1_closed = 0
        for idx, row in sw.iterrows():
            if row["kind"] == "DISCONNECTOR" and "_D_" in idx and "_D2_" not in idx:
                if "_COUPL" not in idx:
                    if row.get("node1", -1) == 0:
                        if row["open"]:
                            sa1_open += 1
                        else:
                            sa1_closed += 1

        total = sa1_open + sa1_closed
        if total > 0:
            ratio = sa1_open / total
            # On pypsa_eur_fr400 round-robin lands near 0.5. On the larger
            # pypsa_eur_fr225_400, many 225 kV VLs have only 2-3 branches so
            # the per-VL alternation can settle near 0.15–0.3 globally. We
            # only assert the dispatch isn't degenerate (all on one bus).
            assert 0.05 < ratio < 0.95, (
                f"Degenerate dispatch: only {ratio:.1%} of SA.1 DISCOs are "
                f"open ({sa1_open} open / {total} total) — expected some "
                f"branches on BBS2."
            )


# ===========================================================================
# 9. Operational limits
# ===========================================================================

class TestOperationalLimits:
    """Tests for limits added by convert/calibrate steps."""

    def test_all_lines_have_limits(self, network, has_limits):
        if not has_limits:
            pytest.skip("Network has no operational limits — base pipeline stage")
        limits = network.get_operational_limits()
        line_ids = set(network.get_lines().index)
        limited = set(limits.index.get_level_values(0)) & line_ids
        assert limited == line_ids, f"{len(line_ids - limited)} lines missing limits"

    def test_limits_are_positive(self, network, has_limits):
        if not has_limits:
            pytest.skip("Network has no operational limits")
        limits = network.get_operational_limits()
        if "type" in limits.index.names:
            current_limits = limits.xs("CURRENT", level="type")
        else:
            current_limits = limits[limits["type"] == "CURRENT"]
        assert (current_limits["value"] > 0).all(), "All current limits should be positive"


# ===========================================================================
# 10. AC loadflow convergence
# ===========================================================================

class TestLoadflow:
    """Verify the generated network converges under AC loadflow.

    The base conversion outputs placeholder gen/load values that won't converge
    under AC. The geographic dispatch from calibration/convert steps is needed
    for convergence. We skip these tests if the network is at the base pipeline
    stage (no limits).
    """

    def test_ac_loadflow_converges(self, network_file, has_limits):
        if not has_limits:
            pytest.skip("Network at base stage (no limits/dispatch) — AC loadflow requires full pipeline")
        import pypowsybl as pp
        n = pp.network.load(str(network_file))
        result = pp.loadflow.run_ac(n, pp.loadflow.Parameters(distributed_slack=True))
        status = str(result[0].status)
        assert "CONVERGED" in status, f"AC loadflow failed: {status}"

    def test_no_nan_voltages(self, network_file, has_limits):
        if not has_limits:
            pytest.skip("Network at base stage — skipping")
        import pypowsybl as pp
        n = pp.network.load(str(network_file))
        pp.loadflow.run_ac(n, pp.loadflow.Parameters(distributed_slack=True))
        buses = n.get_buses()
        nan_v = buses["v_mag"].isna().sum()
        assert nan_v == 0, f"{nan_v} buses have NaN voltage after loadflow"

    def test_generation_load_balance(self, network_file, has_limits):
        """Generators should produce enough power to meet loads."""
        if not has_limits:
            pytest.skip("Network at base stage — skipping")
        import pypowsybl as pp
        n = pp.network.load(str(network_file))
        pp.loadflow.run_ac(n, pp.loadflow.Parameters(distributed_slack=True))
        gens = n.get_generators()
        loads = n.get_loads()
        total_gen = gens["p"].abs().sum()
        total_load = loads["p0"].abs().sum()
        assert total_gen > total_load * 0.8, (
            f"Generation {total_gen:.0f} MW seems too low vs load {total_load:.0f} MW"
        )

    def test_dc_loadflow_converges(self, network_file, has_limits):
        """DC loadflow should converge with proper dispatch."""
        if not has_limits:
            pytest.skip("Network at base stage — DC loadflow requires geographic dispatch")
        import pypowsybl as pp
        n = pp.network.load(str(network_file))
        result = pp.loadflow.run_dc(n, pp.loadflow.Parameters(distributed_slack=True))
        status = str(result[0].status)
        assert "CONVERGED" in status, f"DC loadflow failed: {status}"

    def test_network_loadable(self, network):
        """The network file should load without errors regardless of pipeline stage."""
        assert network is not None
        buses = network.get_buses()
        assert len(buses) > 0, "Network has no buses"


# ===========================================================================
# 11. N-1 contingencies
# ===========================================================================

class TestContingencies:
    """Validate the n1_overload_contingencies.json file."""

    def test_has_contingencies(self, contingencies):
        assert len(contingencies["contingencies"]) > 0, "No contingencies found"

    def test_contingency_structure(self, contingencies):
        for c in contingencies["contingencies"]:
            assert "tripped_line" in c
            assert "tripped_line_name" in c
            assert "max_loading_pct" in c
            assert "overloaded_lines" in c

    def test_all_contingencies_have_overloads(self, contingencies):
        """Every listed contingency should have max loading >= 100%."""
        for c in contingencies["contingencies"]:
            assert c["max_loading_pct"] >= 100, (
                f"Contingency {c['tripped_line']} has loading {c['max_loading_pct']}% (<100%)"
            )

    def test_contingencies_have_display_names(self, contingencies):
        """Tripped lines and overloaded lines should have human-readable names."""
        for c in contingencies["contingencies"]:
            assert c.get("tripped_line_name"), f"Missing name for {c['tripped_line']}"
            assert c.get("tripped_vl1_name"), f"Missing VL1 name for {c['tripped_line']}"
            for ol in c.get("overloaded_lines", []):
                assert ol.get("line_name"), f"Overloaded line missing name: {ol.get('line_id')}"

    def test_peak_loading_above_100(self, contingencies):
        peak = contingencies.get("peak_loading_pct", 0)
        assert peak > 100, f"Peak loading {peak}% should be > 100%"

    def test_overloaded_lines_have_details(self, contingencies):
        for c in contingencies["contingencies"]:
            for ol in c["overloaded_lines"]:
                assert "line_id" in ol
                assert "loading_pct" in ol
                assert "current_a" in ol

    def test_metadata_fields(self, contingencies):
        assert "description" in contingencies
        assert "network" in contingencies
        assert "total_contingencies_tested" in contingencies
        assert contingencies["total_contingencies_tested"] > 0


# ===========================================================================
# 12. Cross-file consistency
# ===========================================================================

class TestCrossFileConsistency:
    """Validate consistency between different pipeline output files."""

    def test_actions_reference_existing_lines(self, actions, line_id_names):
        """Disconnection actions should reference lines that exist in line_id_names."""
        disco_actions = [k for k in actions if k.startswith("disco_")]
        for action_id in disco_actions[:50]:
            element_id = action_id[len("disco_"):]
            if not element_id.startswith("T_"):
                assert element_id in line_id_names, (
                    f"Action {action_id} references unknown line {element_id}"
                )

    def test_bus_mapping_matches_vl_next_node(self, bus_id_mapping, vl_next_node):
        """Most buses in the mapping should have a corresponding VL.

        Legacy pypsa_eur_fr400 has a handful of orphan VL entries
        (e.g. 380 kV stubs never wired into the main network) — allow up to
        1% mismatch before failing.
        """
        missing = [
            f"VL_{k}" for k in bus_id_mapping
            if f"VL_{k}" not in vl_next_node
        ]
        tolerance = max(2, len(bus_id_mapping) // 100)
        assert len(missing) <= tolerance, (
            f"{len(missing)} VLs missing from vl_next_node "
            f"(tolerance {tolerance}): {missing[:5]}"
        )

    def test_grid_layout_covers_all_vls(self, grid_layout, vl_next_node):
        """Layout keys should match VL IDs."""
        layout_keys = set(grid_layout.keys())
        vl_ids = set(vl_next_node.keys())
        missing = vl_ids - layout_keys
        assert len(missing) == 0, (
            f"{len(missing)} VLs missing from grid_layout: {sorted(missing)[:5]}"
        )

    def test_contingencies_reference_existing_lines(self, contingencies, line_id_names):
        """Tripped lines in contingencies should match known line IDs."""
        for c in contingencies["contingencies"]:
            tripped = c["tripped_line"]
            assert tripped in line_id_names, f"Contingency trips unknown line {tripped}"

    def test_coupler_actions_match_vls(self, actions, vl_next_node):
        """Coupler actions (if present) should reference VLs that exist."""
        coupler_actions = [k for k in actions if k.startswith("open_coupler_")]
        if not coupler_actions:
            pytest.skip("No coupler actions — base pipeline stage")
        for action_id in coupler_actions:
            vl_id = action_id[len("open_coupler_"):]
            assert vl_id in vl_next_node, f"Action {action_id} references unknown VL {vl_id}"

    def test_osm_names_cover_buses(self, osm_names, bus_id_mapping):
        """Bus-to-name mapping should cover most buses."""
        bus_to_name = osm_names.get("bus_to_name", {})
        covered = sum(1 for orig in bus_id_mapping.values() if orig in bus_to_name)
        pct = covered / len(bus_id_mapping) * 100
        assert pct > 80, f"Only {pct:.0f}% of buses have OSM names (expected >80%)"

    def test_osm_names_cover_lines(self, osm_names):
        """Line-to-name mapping in osm_names should reference known lines."""
        line_to_name = osm_names.get("line_to_name", {})
        assert len(line_to_name) > 0, "No line->name mappings"

    def test_network_lines_match_line_id_names(self, network, line_id_names):
        """Every line in the XIIDM network should appear in line_id_names."""
        net_lines = set(network.get_lines().index)
        name_lines = set(line_id_names.keys())
        assert net_lines == name_lines, (
            f"Mismatch: {len(net_lines - name_lines)} in network but not in names, "
            f"{len(name_lines - net_lines)} in names but not in network"
        )

    def test_network_vls_match_vl_next_node(self, network, vl_next_node):
        """Every VL in the network should appear in vl_next_node."""
        net_vls = set(network.get_voltage_levels().index)
        node_vls = set(vl_next_node.keys())
        assert net_vls == node_vls, (
            f"Mismatch: {len(net_vls - node_vls)} VLs in network but not in vl_next_node"
        )
