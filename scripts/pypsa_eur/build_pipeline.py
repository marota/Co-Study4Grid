"""
build_pipeline.py
=================
End-to-end orchestrator that reproduces a PyPSA-EUR network dataset
(e.g. ``data/pypsa_eur_fr225_400`` or ``data/pypsa_eur_eur400``) from the raw OSM CSV inputs.

The master pipeline chains the five domain-specific scripts in this folder:

  1. fetch_osm_names.py        — OSM name lookup (cached, optional, safe to skip)
  2. convert_pypsa_to_xiidm.py — CSV → XIIDM network + initial limits + metadata
  3. calibrate_thermal_limits.py — cap N-1 peak near 130% and keep ≥2% overload frac
  4. add_detailed_topology.py    — double-busbar + coupling breakers + actions.json
  5. generate_n1_overloads.py    — final N-1 overload report (JSON)

Each step is invoked as a subprocess so the existing CLIs stay the single
source of truth. Steps can be skipped selectively with ``--skip-step``.

Usage
-----
    # Default: rebuild data/pypsa_eur_fr225_400 end-to-end
    python scripts/pypsa_eur/build_pipeline.py

    # Custom voltages / output
    python scripts/pypsa_eur/build_pipeline.py --voltages 400 --output data/pypsa_eur_fr400

    # European 400 kV network (all countries, skip slow OSM fetch)
    python scripts/pypsa_eur/build_pipeline.py --country "" --voltages 400 --skip-osm

    # Skip expensive OSM name lookup (uses cached osm_names.json if present)
    python scripts/pypsa_eur/build_pipeline.py --skip-osm

    # Resume from a specific step (1..5)
    python scripts/pypsa_eur/build_pipeline.py --from-step 3

    # Only run selected steps
    python scripts/pypsa_eur/build_pipeline.py --steps 3,4,5
"""
from __future__ import annotations

import argparse
import logging
import os
import subprocess
import sys
import time
from pathlib import Path

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_DIR = SCRIPT_DIR.parent.parent


STEP_NAMES = {
    1: "fetch_osm_names",
    2: "convert_pypsa_to_xiidm",
    3: "calibrate_thermal_limits",
    4: "add_detailed_topology",
    5: "generate_n1_overloads",
}


def run_step(label: str, cmd: list[str]) -> None:
    """Run a subprocess, stream its output live, fail fast on non-zero exit."""
    log.info("")
    log.info("━" * 70)
    log.info("▶ %s", label)
    log.info("  %s", " ".join(cmd))
    log.info("━" * 70)
    t0 = time.time()
    result = subprocess.run(cmd, cwd=str(BASE_DIR))
    elapsed = time.time() - t0
    if result.returncode != 0:
        log.error("Step failed (exit %d) after %.1fs: %s", result.returncode, elapsed, label)
        sys.exit(result.returncode)
    log.info("✓ %s — %.1fs", label, elapsed)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="End-to-end orchestrator for PyPSA-EUR → Co-Study4Grid XIIDM.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "Steps:\n"
            "  1  fetch_osm_names        (optional; cached)\n"
            "  2  convert_pypsa_to_xiidm (OSM CSV → XIIDM + initial limits + metadata)\n"
            "  3  calibrate_thermal_limits (cap N-1 peak at 130%)\n"
            "  4  add_detailed_topology  (double-busbar + coupler actions)\n"
            "  5  generate_n1_overloads  (final overload report)\n"
        ),
    )
    parser.add_argument(
        "--voltages", type=str, default="225,400",
        help="Target voltage levels (comma-separated). Default: 225,400",
    )
    parser.add_argument(
        "--country", type=str, default="FR",
        help=(
            "Country filter passed to step 2 (default: FR). "
            "Pass '' or 'ALL' to include all countries (European network)."
        ),
    )
    parser.add_argument(
        "--output", type=str, default=None,
        help="Network output directory (default: data/pypsa_eur_{country}{voltages}).",
    )
    parser.add_argument(
        "--steps", type=str, default=None,
        help="Comma-separated step numbers to run (e.g. '3,4,5').",
    )
    parser.add_argument(
        "--from-step", type=int, default=None,
        help="Run from this step onward (e.g. --from-step 3 runs 3,4,5).",
    )
    parser.add_argument(
        "--skip-osm", action="store_true",
        help="Skip step 1 (fetch_osm_names). Uses existing cached osm_names.json.",
    )
    parser.add_argument(
        "--osm-cache", type=str, default=None,
        help="Path to an existing osm_names.json used as cache for step 1.",
    )
    parser.add_argument(
        "--n1-peak-pct", type=float, default=130.0,
        help="Cap N-1 peak loading at this percent in step 3 (default: 130).",
    )
    parser.add_argument(
        "--min-branches", type=int, default=4,
        help="Minimum branches per VL for double-busbar split in step 4 (default: 4).",
    )
    args = parser.parse_args()

    # ── Resolve step selection ───────────────────────────────────────────
    if args.steps:
        steps = [int(s) for s in args.steps.split(",")]
    elif args.from_step:
        steps = list(range(args.from_step, 6))
    else:
        steps = [1, 2, 3, 4, 5]

    if args.skip_osm and 1 in steps:
        steps = [s for s in steps if s != 1]

    for s in steps:
        if s not in STEP_NAMES:
            parser.error(f"Unknown step {s}. Valid: {list(STEP_NAMES.keys())}")

    # ── Resolve output directory ─────────────────────────────────────────
    voltages = args.voltages
    v_list = [v.strip() for v in voltages.split(",")]
    v_slug = "_".join(v_list)
    country = args.country if args.country and args.country.upper() != "ALL" else None
    country_slug = country.lower() if country else "eur"
    if args.output:
        out_dir = Path(args.output)
        if not out_dir.is_absolute():
            out_dir = BASE_DIR / out_dir
    else:
        out_dir = BASE_DIR / "data" / f"pypsa_eur_{country_slug}{v_slug}"

    # Path the subscripts expect (relative to repo root is OK).
    rel_out = os.path.relpath(out_dir, BASE_DIR)

    country_label = country if country else "ALL countries"
    log.info("━" * 70)
    log.info("PyPSA-EUR → Co-Study4Grid pipeline")
    log.info("  country:  %s", country_label)
    log.info("  voltages: %s", voltages)
    log.info("  output:   %s", rel_out)
    log.info("  steps:    %s", ", ".join(f"{s}.{STEP_NAMES[s]}" for s in steps))
    log.info("━" * 70)

    py = sys.executable

    t_global = time.time()

    # ── Step 1: OSM name fetch (optional, cached) ────────────────────────
    if 1 in steps:
        cmd = [
            py, str(SCRIPT_DIR / "fetch_osm_names.py"),
            "--voltages", voltages,
        ]
        if args.osm_cache:
            cmd += ["--cache-from", args.osm_cache]
        else:
            # Re-use the cache that ships with fr400 if present.
            default_cache = BASE_DIR / "data" / "pypsa_eur_fr400" / "osm_names.json"
            if default_cache.is_file():
                cmd += ["--cache-from", str(default_cache)]
        run_step("Step 1 — fetch_osm_names", cmd)

    # ── Step 2: OSM CSV → XIIDM ─────────────────────────────────────────
    if 2 in steps:
        cmd = [
            py, str(SCRIPT_DIR / "convert_pypsa_to_xiidm.py"),
            "--voltages", voltages,
            "--country", country if country else "",
            "--output-dir", str(out_dir),
            "--skip-n1",
        ]
        run_step("Step 2 — convert_pypsa_to_xiidm", cmd)

    # ── Step 3: thermal limit recalibration ─────────────────────────────
    if 3 in steps:
        cmd = [
            py, str(SCRIPT_DIR / "calibrate_thermal_limits.py"),
            "--network", str(out_dir),
            "--n1-peak-pct", str(args.n1_peak_pct),
        ]
        run_step("Step 3 — calibrate_thermal_limits", cmd)

    # ── Step 4: double-busbar detailed topology ─────────────────────────
    if 4 in steps:
        cmd = [
            py, str(SCRIPT_DIR / "add_detailed_topology.py"),
            "--network", str(out_dir),
            "--voltages", voltages,
            "--min-branches", str(args.min_branches),
        ]
        run_step("Step 4 — add_detailed_topology", cmd)

    # ── Step 5: final N-1 overload report ───────────────────────────────
    if 5 in steps:
        cmd = [
            py, str(SCRIPT_DIR / "generate_n1_overloads.py"),
            "--network", str(out_dir),
        ]
        run_step("Step 5 — generate_n1_overloads", cmd)

    total = time.time() - t_global
    log.info("")
    log.info("━" * 70)
    log.info("Pipeline complete in %.1fs   (output: %s)", total, rel_out)
    log.info("━" * 70)


if __name__ == "__main__":
    main()
