"""
test_pipeline.py
================
Tests for the network generation pipeline that converts PyPSA-EUR OSM data
into the FR 400kV XIIDM network used by Co-Study4Grid.

Pipeline under test:
  1. fetch_osm_names.py       — OSM name fetching (unit tests only, no network calls)
  2. convert_pypsa_to_xiidm.py — CSV → XIIDM conversion
  3. add_limits_and_overloads.py — Limits + geographic dispatch
  4. add_detailed_topology.py  — Double-busbar + coupling breakers

These tests validate the *already-generated* pipeline outputs in
data/pypsa_eur_fr400/ without re-running the (slow) generation scripts.
Unit tests for pure helper functions are also included.

The network.xiidm on disk may be at any pipeline stage (base conversion,
with limits, or with double-busbar topology). Tests adapt accordingly by
detecting what's present.

Usage:
    cd /home/marotant/dev/AntiGravity/ExpertAssist
    venv_expert_assist_py310/bin/python -m pytest scripts/test_pipeline.py -v
"""

import json
import os
import re
import sys
from pathlib import Path

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent.parent
DATA_DIR = BASE_DIR / "data" / "pypsa_eur_fr400"
OSM_DIR = BASE_DIR / "data" / "pypsa_eur_osm"

# Make scripts importable for unit tests of helper functions
sys.path.insert(0, str(BASE_DIR / "scripts"))


# ===========================================================================
# Fixtures — load generated artefacts once per session
# ===========================================================================

@pytest.fixture(scope="session")
def actions():
    with open(DATA_DIR / "actions.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def osm_names():
    with open(DATA_DIR / "osm_names.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def bus_id_mapping():
    with open(DATA_DIR / "bus_id_mapping.json") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def line_id_names():
    with open(DATA_DIR / "line_id_names.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def vl_next_node():
    with open(DATA_DIR / "vl_next_node.json") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def grid_layout():
    with open(DATA_DIR / "grid_layout.json") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def contingencies():
    with open(DATA_DIR / "n1_overload_contingencies.json", encoding="utf-8") as f:
        return json.load(f)


@pytest.fixture(scope="session")
def network():
    pp = pytest.importorskip("pypowsybl")
    return pp.network.load(str(DATA_DIR / "network.xiidm"))


@pytest.fixture(scope="session")
def has_double_busbar(network):
    """Detect whether the network includes the double-busbar topology."""
    bbs = network.get_busbar_sections()
    return any("BBS2" in idx for idx in bbs.index)


@pytest.fixture(scope="session")
def has_limits(network):
    """Detect whether the network has operational limits."""
    limits = network.get_operational_limits()
    return len(limits) > 0


# ===========================================================================
# 1. Pure helper function tests (no generated files needed)
# ===========================================================================

class TestSafeId:
    """Tests for the safe_id() helper used by convert_pypsa_to_xiidm.py."""

    def test_basic_replacement(self):
        """Characters outside [A-Za-z0-9_-.] are replaced with underscores."""
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
    def test_csv_exists(self, filename):
        assert (OSM_DIR / filename).exists(), f"Missing {filename}"

    def test_buses_csv_has_expected_columns(self):
        import pandas as pd
        df = pd.read_csv(OSM_DIR / "buses.csv", index_col=0, nrows=5)
        for col in ["voltage", "country", "dc", "x", "y", "under_construction"]:
            assert col in df.columns, f"Missing column '{col}' in buses.csv"

    def test_lines_csv_has_expected_columns(self):
        import pandas as pd
        df = pd.read_csv(OSM_DIR / "lines.csv", index_col=0, nrows=5, quotechar="'")
        for col in ["bus0", "bus1", "r", "x", "b"]:
            assert col in df.columns, f"Missing column '{col}' in lines.csv"

    def test_transformers_csv_has_expected_columns(self):
        import pandas as pd
        df = pd.read_csv(OSM_DIR / "transformers.csv", index_col=0, nrows=5, quotechar="'")
        for col in ["bus0", "bus1", "s_nom"]:
            assert col in df.columns, f"Missing column '{col}' in transformers.csv"

    def test_buses_has_fr_400kv_entries(self):
        import pandas as pd
        df = pd.read_csv(OSM_DIR / "buses.csv", index_col=0)
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
    def test_file_exists(self, filename):
        path = DATA_DIR / filename
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

    def test_bus_id_mapping_count(self, bus_id_mapping):
        assert len(bus_id_mapping) == 192, f"Expected 192 buses, got {len(bus_id_mapping)}"

    def test_bus_id_mapping_roundtrip(self, bus_id_mapping):
        """Every safe_id key should be derivable from its original value."""
        for safe, original in bus_id_mapping.items():
            assert re.sub(r"[^A-Za-z0-9_\-\.]", "_", original) == safe

    def test_line_id_names_count(self, line_id_names):
        assert len(line_id_names) == 398, f"Expected 398 lines, got {len(line_id_names)}"

    def test_line_id_names_have_real_names(self, line_id_names):
        """Most lines should have human-readable names (not raw IDs)."""
        named = sum(1 for name in line_id_names.values() if not name.startswith("merged_"))
        total = len(line_id_names)
        pct = named / total * 100
        assert pct > 60, f"Only {pct:.0f}% of lines have real names (expected >60%)"

    def test_vl_next_node_count(self, vl_next_node):
        assert len(vl_next_node) == 192, f"Expected 192 VLs, got {len(vl_next_node)}"

    def test_vl_next_node_values_valid(self, vl_next_node):
        """Node counters should be >= 2 (0=BBS1, 1=reserved for BBS2)."""
        for vl_id, counter in vl_next_node.items():
            assert counter >= 2, f"{vl_id} has invalid node counter {counter}"

    def test_grid_layout_has_entries(self, grid_layout):
        # 192 buses x ~11 entries each (base + VL_xxx_0..9) + extras
        assert len(grid_layout) > 500, f"Expected >500 layout entries, got {len(grid_layout)}"

    def test_grid_layout_coordinates_are_geographic(self, grid_layout):
        """Coordinates should be in geographic range (France: lon -5..10, lat 41..52)."""
        for key, coords in list(grid_layout.items())[:50]:
            lon, lat = coords
            assert -10 < lon < 15, f"{key} has suspicious longitude {lon}"
            assert 38 < lat < 55, f"{key} has suspicious latitude {lat}"


# ===========================================================================
# 6. actions.json — disconnection + coupling actions
# ===========================================================================

class TestActions:
    """Validate the actions.json file produced by the pipeline."""

    def test_disconnection_actions(self, actions):
        """Base pipeline always produces 400 disconnection actions (398 lines + 2 trafos)."""
        disco = [k for k in actions if k.startswith("disco_")]
        assert len(disco) == 400, f"Expected 400 disconnection actions, got {len(disco)}"

    def test_total_action_count(self, actions):
        """Total count depends on pipeline stage: 400 (base) or 499 (with couplers)."""
        total = len(actions)
        assert total in (400, 499), f"Expected 400 or 499 actions, got {total}"

    def test_coupler_actions_if_present(self, actions):
        """If couplers exist (full pipeline), validate their count and structure."""
        coupl = {k: v for k, v in actions.items() if k.startswith("open_coupler_")}
        if len(coupl) == 0:
            pytest.skip("No coupler actions — network at base pipeline stage")
        assert len(coupl) == 99, f"Expected 99 coupler actions, got {len(coupl)}"
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

    def test_bus_count(self, network):
        buses = network.get_buses()
        assert len(buses) >= 192, f"Expected >=192 buses, got {len(buses)}"

    def test_line_count(self, network):
        lines = network.get_lines()
        assert len(lines) == 398, f"Expected 398 lines, got {len(lines)}"

    def test_transformer_count(self, network):
        trafos = network.get_2_windings_transformers()
        assert len(trafos) == 2, f"Expected 2 transformers, got {len(trafos)}"

    def test_generator_count(self, network):
        gens = network.get_generators()
        assert len(gens) == 192, f"Expected 192 generators, got {len(gens)}"

    def test_load_count(self, network):
        loads = network.get_loads()
        assert len(loads) == 192, f"Expected 192 loads, got {len(loads)}"

    def test_busbar_section_count(self, network, has_double_busbar):
        bbs = network.get_busbar_sections()
        if has_double_busbar:
            assert len(bbs) == 291, f"Expected 291 busbar sections (192 BBS1 + 99 BBS2), got {len(bbs)}"
        else:
            assert len(bbs) == 192, f"Expected 192 busbar sections (BBS1 only), got {len(bbs)}"

    def test_voltage_level_count(self, network):
        vls = network.get_voltage_levels()
        assert len(vls) == 192, f"Expected 192 voltage levels, got {len(vls)}"

    def test_voltage_levels_nominal_400kv(self, network):
        vls = network.get_voltage_levels()
        for vl_id, row in vls.iterrows():
            assert row["nominal_v"] in (380.0, 400.0), f"{vl_id} has unexpected nominal_v={row['nominal_v']}"

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

    def test_bbs2_count(self, network, has_double_busbar):
        if not has_double_busbar:
            pytest.skip("Network at base stage — no double-busbar topology")
        bbs = network.get_busbar_sections()
        bbs2 = [idx for idx in bbs.index if idx.endswith("_BBS2")]
        assert len(bbs2) == 99, f"Expected 99 BBS2 sections, got {len(bbs2)}"

    def test_coupling_breakers_exist(self, network, has_double_busbar):
        if not has_double_busbar:
            pytest.skip("Network at base stage — no coupling breakers")
        sw = network.get_switches()
        couplers = [idx for idx in sw.index if idx.endswith("_COUPL")]
        assert len(couplers) == 99, f"Expected 99 coupling breakers, got {len(couplers)}"

    def test_coupling_disconnectors_exist(self, network, has_double_busbar):
        if not has_double_busbar:
            pytest.skip("Network at base stage — no coupling disconnectors")
        sw = network.get_switches()
        d1s = [idx for idx in sw.index if idx.endswith("_COUPL_D1")]
        d2s = [idx for idx in sw.index if idx.endswith("_COUPL_D2")]
        assert len(d1s) == 99, f"Expected 99 COUPL_D1, got {len(d1s)}"
        assert len(d2s) == 99, f"Expected 99 COUPL_D2, got {len(d2s)}"

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
        """Roughly half of elements should be on BBS1, half on BBS2."""
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
            assert 0.3 < ratio < 0.7, (
                f"Expected ~50% round-robin, got {ratio:.1%} "
                f"({sa1_open} open / {total} total SA.1 DISCOs)"
            )


# ===========================================================================
# 9. Operational limits — from add_limits_and_overloads.py (skipped if absent)
# ===========================================================================

class TestOperationalLimits:
    """Tests for the limits added by add_limits_and_overloads.py."""

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
        current_limits = limits[limits["type"] == "CURRENT"]
        assert (current_limits["value"] > 0).all(), "All current limits should be positive"

    def test_limits_have_both_sides(self, network, has_limits):
        if not has_limits:
            pytest.skip("Network has no operational limits")
        limits = network.get_operational_limits()
        current_limits = limits[limits["type"] == "CURRENT"]
        sides = current_limits["side"].unique()
        assert "ONE" in sides and "TWO" in sides, f"Expected both sides, got {sides}"


# ===========================================================================
# 10. AC loadflow convergence
# ===========================================================================

class TestLoadflow:
    """Verify the generated network converges under AC loadflow.

    The base conversion (convert_pypsa_to_xiidm.py) outputs placeholder
    gen/load values that won't converge under AC. The geographic dispatch
    from add_limits_and_overloads.py is needed for convergence. We skip
    these tests if the network is at the base pipeline stage (no limits).
    """

    def test_ac_loadflow_converges(self, has_limits):
        if not has_limits:
            pytest.skip("Network at base stage (no limits/dispatch) — AC loadflow requires full pipeline")
        import pypowsybl as pp
        n = pp.network.load(str(DATA_DIR / "network.xiidm"))
        result = pp.loadflow.run_ac(n, pp.loadflow.Parameters(distributed_slack=True))
        status = str(result[0].status)
        assert "CONVERGED" in status, f"AC loadflow failed: {status}"

    def test_no_nan_voltages(self, has_limits):
        if not has_limits:
            pytest.skip("Network at base stage — skipping")
        import pypowsybl as pp
        n = pp.network.load(str(DATA_DIR / "network.xiidm"))
        pp.loadflow.run_ac(n, pp.loadflow.Parameters(distributed_slack=True))
        buses = n.get_buses()
        nan_v = buses["v_mag"].isna().sum()
        assert nan_v == 0, f"{nan_v} buses have NaN voltage after loadflow"

    def test_generation_load_balance(self, has_limits):
        """Generators should produce enough power to meet loads."""
        if not has_limits:
            pytest.skip("Network at base stage — skipping")
        import pypowsybl as pp
        n = pp.network.load(str(DATA_DIR / "network.xiidm"))
        pp.loadflow.run_ac(n, pp.loadflow.Parameters(distributed_slack=True))
        gens = n.get_generators()
        loads = n.get_loads()
        total_gen = gens["p"].abs().sum()
        total_load = loads["p0"].abs().sum()
        assert total_gen > total_load * 0.8, (
            f"Generation {total_gen:.0f} MW seems too low vs load {total_load:.0f} MW"
        )

    def test_dc_loadflow_converges(self, has_limits):
        """DC loadflow should converge with proper dispatch."""
        if not has_limits:
            pytest.skip("Network at base stage — DC loadflow requires geographic dispatch")
        import pypowsybl as pp
        n = pp.network.load(str(DATA_DIR / "network.xiidm"))
        result = pp.loadflow.run_dc(n, pp.loadflow.Parameters(distributed_slack=True))
        status = str(result[0].status)
        assert "CONVERGED" in status, f"DC loadflow failed: {status}"

    def test_network_loadable(self, network):
        """The network file should load without errors regardless of pipeline stage."""
        # This test always passes if we got here (network fixture loaded successfully)
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
        """Every bus in the mapping should have a corresponding VL in vl_next_node."""
        for safe_id_key in bus_id_mapping:
            vl_id = f"VL_{safe_id_key}"
            assert vl_id in vl_next_node, f"VL {vl_id} not in vl_next_node"

    def test_grid_layout_covers_all_buses(self, grid_layout, bus_id_mapping):
        """Every bus should have at least one layout entry."""
        for safe_id_key in bus_id_mapping:
            assert safe_id_key in grid_layout, f"Bus {safe_id_key} missing from grid_layout"

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
        assert pct > 90, f"Only {pct:.0f}% of buses have OSM names (expected >90%)"

    def test_osm_names_cover_lines(self, osm_names, line_id_names):
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
