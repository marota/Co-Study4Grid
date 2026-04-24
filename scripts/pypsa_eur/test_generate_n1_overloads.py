"""
test_generate_n1_overloads.py
=============================

Unit tests for ``generate_n1_overloads.py``.

The script runs argparse at module load (not inside ``main()``), so importing
it eagerly calls ``parser.parse_args()`` and asserts that ``network.xiidm``
exists at the configured path. To keep the tests hermetic we:

* Write a stub network directory into ``tmp_path`` with a minimal XIIDM file.
* Re-import the module via ``importlib.util.spec_from_file_location`` with
  ``sys.argv`` pointed at that stub directory.

That gives us access to the pure helpers (``_get_line_limits_from_xml``,
``_get_lf_params``) without running the full security analysis. The CLI
surface is also exercised via subprocess ``--help``.

Usage::

    pytest scripts/pypsa_eur/test_generate_n1_overloads.py -v
"""
from __future__ import annotations

import importlib.util
import subprocess
import sys
from pathlib import Path

import pytest


SCRIPT_PATH = Path(__file__).resolve().parent / "generate_n1_overloads.py"
BASE_DIR = Path(__file__).resolve().parent.parent.parent


MINIMAL_XIIDM = """<?xml version="1.0" encoding="UTF-8"?>
<iidm:network xmlns:iidm="http://www.powsybl.org/schema/iidm/1_10" id="net" caseDate="2024-01-01T00:00:00Z" forecastDistance="0" sourceFormat="code">
  <iidm:line id="LINE_A" r="0.01" x="0.1" g1="0" b1="0" g2="0" b2="0" voltageLevelId1="VL_A" voltageLevelId2="VL_B" bus1="VL_A_0" bus2="VL_B_0">
    <iidm:operationalLimitsGroup1 id="DEFAULT">
      <iidm:currentLimits permanentLimit="1000.0"/>
    </iidm:operationalLimitsGroup1>
  </iidm:line>
  <iidm:line id="LINE_B" r="0.02" x="0.2" g1="0" b1="0" g2="0" b2="0" voltageLevelId1="VL_B" voltageLevelId2="VL_C" bus1="VL_B_0" bus2="VL_C_0">
    <iidm:operationalLimitsGroup1 id="DEFAULT">
      <iidm:currentLimits permanentLimit="750.0"/>
    </iidm:operationalLimitsGroup1>
  </iidm:line>
  <iidm:line id="LINE_NO_LIMIT" r="0.03" x="0.3" g1="0" b1="0" g2="0" b2="0" voltageLevelId1="VL_C" voltageLevelId2="VL_D" bus1="VL_C_0" bus2="VL_D_0">
  </iidm:line>
</iidm:network>
"""


pytest.importorskip("pypowsybl")  # module imports pypowsybl eagerly


@pytest.fixture
def stub_network(tmp_path):
    """Return a tmp directory containing a minimal network.xiidm stub."""
    network_dir = tmp_path / "fake_network"
    network_dir.mkdir()
    xiidm_path = network_dir / "network.xiidm"
    xiidm_path.write_text(MINIMAL_XIIDM, encoding="utf-8")
    return network_dir


@pytest.fixture
def gno_module(stub_network, monkeypatch):
    """Import ``generate_n1_overloads`` against the stub network directory."""
    monkeypatch.setattr(
        sys, "argv",
        ["generate_n1_overloads.py", "--network", str(stub_network)],
    )
    # Use a unique module name so repeated imports stay isolated.
    spec = importlib.util.spec_from_file_location(
        f"gno_test_{stub_network.name}", SCRIPT_PATH
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ===========================================================================
# _get_line_limits_from_xml — XML parser helper
# ===========================================================================

class TestGetLineLimitsFromXml:
    """Test the XIIDM XML limit parser."""

    def test_parses_all_lines_with_limits(self, gno_module, stub_network):
        limits = gno_module._get_line_limits_from_xml(stub_network / "network.xiidm")
        assert "LINE_A" in limits
        assert "LINE_B" in limits
        assert limits["LINE_A"] == pytest.approx(1000.0)
        assert limits["LINE_B"] == pytest.approx(750.0)

    def test_skips_lines_without_limit(self, gno_module, stub_network):
        limits = gno_module._get_line_limits_from_xml(stub_network / "network.xiidm")
        assert "LINE_NO_LIMIT" not in limits

    def test_returns_only_lines_from_line_blocks(self, gno_module, stub_network):
        """The helper only scans <iidm:line> elements, not trafos or VLs."""
        limits = gno_module._get_line_limits_from_xml(stub_network / "network.xiidm")
        expected_ids = {"LINE_A", "LINE_B"}
        assert set(limits.keys()) == expected_ids


# ===========================================================================
# Module-level constants
# ===========================================================================

class TestModuleConstants:
    """Verify argparse resolution of paths."""

    def test_threshold_default_converted_to_fraction(self, gno_module):
        """Default --threshold=100 translates to THRESHOLD=1.0 (fraction)."""
        assert gno_module.THRESHOLD == pytest.approx(1.0)

    def test_network_dir_resolved(self, gno_module, stub_network):
        assert gno_module.NETWORK_DIR == stub_network

    def test_default_output_path(self, gno_module, stub_network):
        assert gno_module.OUTPUT_PATH == stub_network / "n1_overload_contingencies.json"


# ===========================================================================
# CLI surface
# ===========================================================================

class TestCLISurface:
    """Verify the CLI boundary (help output + bad paths)."""

    def test_help_exits_cleanly(self):
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--help"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "--network" in result.stdout
        assert "--threshold" in result.stdout
        assert "--dc" in result.stdout
        assert "--include-transformers" in result.stdout

    def test_missing_network_raises_assertion(self, tmp_path):
        """A nonexistent network dir must surface via the assertion."""
        missing = tmp_path / "does_not_exist"
        result = subprocess.run(
            [sys.executable, str(SCRIPT_PATH), "--network", str(missing)],
            capture_output=True, text=True,
        )
        assert result.returncode != 0
        assert "network.xiidm" in (result.stderr + result.stdout)


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
