"""
test_calibrate_thermal_limits.py
================================

Unit tests for ``calibrate_thermal_limits.py``.

These tests exercise the pure helpers that don't need pypowsybl:

* ``_patch_xiidm_limits`` — regex rewriter of ``permanentLimit`` values in
  XIIDM XML.
* ``_overload_fraction`` — per-contingency overload statistics helper.

The slow pypowsybl-driven ``_run_security`` is exercised indirectly by the
calibrated network in ``test_n1_calibration.py``; we don't duplicate it here.

Usage::

    pytest scripts/pypsa_eur/test_calibrate_thermal_limits.py -v
"""
from __future__ import annotations

import sys
from pathlib import Path

import pytest

# The calibrate module imports pypowsybl eagerly, so skip the whole file when
# pypowsybl isn't available.
pytest.importorskip("pypowsybl")

# Let us import the script by filename (it lives in this folder).
sys.path.insert(0, str(Path(__file__).resolve().parent))
import calibrate_thermal_limits as mod  # noqa: E402


# ===========================================================================
# _patch_xiidm_limits — regex rewriter
# ===========================================================================

MINIMAL_XIIDM = """<?xml version="1.0" encoding="UTF-8"?>
<iidm:network xmlns:iidm="http://www.powsybl.org/schema/iidm/1_10" id="net" caseDate="2024-01-01T00:00:00Z" forecastDistance="0" sourceFormat="code">
  <iidm:line id="L1" r="0.01" x="0.1" g1="0" b1="0" g2="0" b2="0" voltageLevelId1="VL_A" voltageLevelId2="VL_B" bus1="VL_A_0" bus2="VL_B_0">
    <iidm:currentLimits1 permanentLimit="1000.0"/>
    <iidm:currentLimits2 permanentLimit="1000.0"/>
  </iidm:line>
  <iidm:line id="L2" r="0.02" x="0.2" g1="0" b1="0" g2="0" b2="0" voltageLevelId1="VL_B" voltageLevelId2="VL_C" bus1="VL_B_0" bus2="VL_C_0">
    <iidm:currentLimits1 permanentLimit="500.0"/>
    <iidm:currentLimits2 permanentLimit="500.0"/>
  </iidm:line>
  <iidm:line id="L3_no_limit" r="0.03" x="0.3" g1="0" b1="0" g2="0" b2="0" voltageLevelId1="VL_C" voltageLevelId2="VL_D" bus1="VL_C_0" bus2="VL_D_0">
  </iidm:line>
</iidm:network>
"""


@pytest.fixture
def xiidm_file(tmp_path):
    path = tmp_path / "network.xiidm"
    path.write_text(MINIMAL_XIIDM, encoding="utf-8")
    return path


class TestPatchXiidmLimits:
    """Test the permanentLimit regex rewriter."""

    def test_rewrites_line_with_new_limit(self, xiidm_file, tmp_path):
        out_path = tmp_path / "out.xiidm"
        mod._patch_xiidm_limits(xiidm_file, out_path, {"L1": 1234.56})

        text = out_path.read_text(encoding="utf-8")
        # Both currentLimits1 and currentLimits2 in L1 block must be updated.
        assert text.count('permanentLimit="1234.56"') == 2, (
            "L1 has two currentLimits entries; both should be rewritten."
        )
        # L2 untouched.
        assert text.count('permanentLimit="500.0"') == 2

    def test_untouched_lines_preserve_original_limits(self, xiidm_file, tmp_path):
        out_path = tmp_path / "out.xiidm"
        mod._patch_xiidm_limits(xiidm_file, out_path, {"L1": 999.0})

        text = out_path.read_text(encoding="utf-8")
        # L2 must keep its 500.0 limit exactly.
        assert 'permanentLimit="500.0"' in text

    def test_line_without_current_limits_is_untouched(self, xiidm_file, tmp_path):
        """A line without <currentLimits> blocks should be left alone."""
        out_path = tmp_path / "out.xiidm"
        mod._patch_xiidm_limits(
            xiidm_file, out_path, {"L3_no_limit": 42.0, "L1": 1000.0}
        )
        text = out_path.read_text(encoding="utf-8")
        assert 'id="L3_no_limit"' in text
        # No permanentLimit attribute was injected into L3's block.
        # Extract the L3 block to verify.
        start = text.find('id="L3_no_limit"')
        end = text.find("</iidm:line>", start)
        l3_block = text[start:end]
        assert "permanentLimit" not in l3_block

    def test_id_not_in_new_limits_skipped(self, xiidm_file, tmp_path):
        """Lines absent from new_limits dict keep original values."""
        out_path = tmp_path / "out.xiidm"
        mod._patch_xiidm_limits(xiidm_file, out_path, {"L2": 750.0})

        text = out_path.read_text(encoding="utf-8")
        assert text.count('permanentLimit="750.00"') == 2  # L2 rewritten
        assert text.count('permanentLimit="1000.0"') == 2  # L1 unchanged

    def test_preserves_xml_structure(self, xiidm_file, tmp_path):
        """The patched XML should still be well-formed."""
        import xml.etree.ElementTree as ET

        out_path = tmp_path / "out.xiidm"
        mod._patch_xiidm_limits(xiidm_file, out_path, {"L1": 1500.0, "L2": 800.0})

        # This raises ParseError if the XML is broken.
        ET.parse(out_path)


# ===========================================================================
# _overload_fraction helper
# ===========================================================================

class TestOverloadFraction:
    """Test the post-contingency overload statistics helper."""

    def test_simple_overload_counts(self):
        import pandas as pd

        post = pd.DataFrame({
            "contingency_id": ["C1", "C1", "C2", "C3"],
            "branch_id":       ["L1", "L2", "L3", "L4"],
            "i":               [1200, 500, 1500, 400],
        })
        limits = pd.Series({"L1": 1000, "L2": 1000, "L3": 1000, "L4": 1000})

        n_over, n_total, peak = mod._overload_fraction(post, limits)
        # C1 (1200>1000) and C2 (1500>1000) overload; C3 (400) does not.
        assert n_over == 2
        assert n_total == 3
        assert peak == pytest.approx(150.0)  # 1500/1000 * 100

    def test_no_overload(self):
        import pandas as pd

        post = pd.DataFrame({
            "contingency_id": ["C1", "C2"],
            "branch_id":       ["L1", "L2"],
            "i":               [100, 200],
        })
        limits = pd.Series({"L1": 1000, "L2": 1000})

        n_over, n_total, peak = mod._overload_fraction(post, limits)
        assert n_over == 0
        assert n_total == 2
        assert peak == pytest.approx(20.0)

    def test_threshold_parameter(self):
        import pandas as pd

        post = pd.DataFrame({
            "contingency_id": ["C1", "C2"],
            "branch_id":       ["L1", "L2"],
            "i":               [800, 950],
        })
        limits = pd.Series({"L1": 1000, "L2": 1000})

        # At default 100% threshold, nothing overloads.
        n_over, _, _ = mod._overload_fraction(post, limits)
        assert n_over == 0

        # At 85% threshold, only C2 (95%) exceeds.
        n_over, _, _ = mod._overload_fraction(post, limits, threshold_pct=85.0)
        assert n_over == 1

    def test_zero_limit_safely_ignored(self):
        """Branches with limit=0 must not cause a divide-by-zero."""
        import pandas as pd

        post = pd.DataFrame({
            "contingency_id": ["C1", "C2"],
            "branch_id":       ["L1", "L2"],
            "i":               [1200, 0],
        })
        limits = pd.Series({"L1": 1000, "L2": 0})  # L2 has no limit

        n_over, n_total, peak = mod._overload_fraction(post, limits)
        # Only C1 is overloaded; C2 with zero limit is NaN and not counted.
        assert n_over == 1
        assert n_total == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
