"""
generate_n1_overloads.py
========================
Run N-1 contingency analysis on a pypowsybl XIIDM network using the native
``pypowsybl.security`` API and produce ``n1_overload_contingencies.json``.

The security-analysis engine runs all contingencies in a single call on the
Java/PowSyBl side with built-in multi-threading — orders of magnitude faster
than the naive Python loop of load-disconnect-loadflow.

The output is consumed by the Co-Study4Grid frontend and by
``test_n1_calibration.py`` for regression checks.

Usage:
    # Default: fr400 network
    python scripts/generate_n1_overloads.py

    # Specify a different network directory
    python scripts/generate_n1_overloads.py --network data/pypsa_eur_fr225_400

    # Custom overload threshold (default: 100%)
    python scripts/generate_n1_overloads.py --threshold 95

    # Use DC loadflow instead of AC
    python scripts/generate_n1_overloads.py --dc

    # Include transformer contingencies
    python scripts/generate_n1_overloads.py --include-transformers
"""

import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import numpy as np
import pandas as pd
import pypowsybl as pp

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
log = logging.getLogger(__name__)

# ─── Parse arguments ──────────────────────────────────────────────────────────
parser = argparse.ArgumentParser(
    description="Run N-1 contingency analysis and produce overload report"
)
parser.add_argument(
    "--network",
    type=str,
    default="data/pypsa_eur_fr400",
    help="Path to the network data directory containing network.xiidm "
         "(default: data/pypsa_eur_fr400)",
)
parser.add_argument(
    "--threshold",
    type=float,
    default=100.0,
    help="Overload threshold in %% (default: 100)",
)
parser.add_argument(
    "--dc",
    action="store_true",
    help="Use DC loadflow instead of AC (faster, less accurate)",
)
parser.add_argument(
    "--include-transformers",
    action="store_true",
    help="Also test 2-winding transformer contingencies",
)
parser.add_argument(
    "--chunk-size",
    type=int,
    default=0,
    help=(
        "Process contingencies in chunks of this size (0 = single batch). "
        "Use a non-zero value (e.g. 1000) on very large networks where the "
        "full N-1 result table would exceed the GraalVM 32GB heap."
    ),
)
parser.add_argument(
    "--output",
    type=str,
    default=None,
    help="Output file path "
         "(default: <network-dir>/n1_overload_contingencies.json)",
)
args = parser.parse_args()

# ─── Resolve paths ────────────────────────────────────────────────────────────
SCRIPT_DIR = Path(__file__).resolve().parent
BASE_DIR = SCRIPT_DIR.parent.parent

NETWORK_DIR = (
    Path(args.network)
    if os.path.isabs(args.network)
    else BASE_DIR / args.network
)
XIIDM_PATH = NETWORK_DIR / "network.xiidm"
LINE_NAMES_PATH = NETWORK_DIR / "line_id_names.json"
OUTPUT_PATH = (
    Path(args.output)
    if args.output
    else NETWORK_DIR / "n1_overload_contingencies.json"
)

THRESHOLD = args.threshold / 100.0  # fraction

assert XIIDM_PATH.is_file(), f"network.xiidm not found at {XIIDM_PATH}"


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _get_line_limits_from_xml(xiidm_path: Path) -> dict:
    """Parse permanentLimit values directly from XIIDM XML."""
    import xml.etree.ElementTree as ET

    tree = ET.parse(xiidm_path)
    root = tree.getroot()
    ns = ""
    if root.tag.startswith("{"):
        ns = root.tag.split("}")[0] + "}"

    limits = {}
    for line_el in root.iter(f"{ns}line"):
        el_id = line_el.get("id")
        if el_id:
            for cl_el in line_el.iter():
                tag = (
                    cl_el.tag.split("}")[-1] if "}" in cl_el.tag else cl_el.tag
                )
                if tag == "currentLimits" and "permanentLimit" in cl_el.attrib:
                    limits[el_id] = float(cl_el.get("permanentLimit"))
                    break
    return limits


def _get_line_limits(net, xiidm_path: Path) -> dict:
    """Build a dict of line_id -> permanentLimit (A) from the network."""
    # get_operational_limits returns a MultiIndex DataFrame; reset_index first
    # so "type" and "acceptable_duration" are plain columns, not index levels.
    try:
        op_lims = net.get_operational_limits().reset_index()
        perm = op_lims[
            (op_lims["type"] == "CURRENT") & (op_lims["acceptable_duration"] == -1)
        ]
        limits = dict(zip(perm["element_id"], perm["value"].astype(float)))
        if limits:
            return limits
    except Exception:
        pass

    # Last resort: parse XML
    return _get_line_limits_from_xml(xiidm_path)


def _load_name_mappings(net, line_names_path: Path):
    """Build dictionaries for line and VL human-readable names."""
    line_names = {}
    vl_names = {}

    # Line names from line_id_names.json (best source)
    if line_names_path.is_file():
        with open(line_names_path, encoding="utf-8") as f:
            line_names = json.load(f)

    # Supplement from the network's line DataFrame
    try:
        lines_df = net.get_lines()
        if "name" in lines_df.columns:
            for lid, row in lines_df.iterrows():
                name = row.get("name", "")
                if name and lid not in line_names:
                    line_names[lid] = name
    except Exception:
        pass

    # VL names from the network
    try:
        vls = net.get_voltage_levels()
        if "name" in vls.columns:
            for vl_id, row in vls.iterrows():
                name = row.get("name", "")
                if name:
                    vl_names[vl_id] = name
    except Exception:
        pass

    return line_names, vl_names


def _get_lf_params():
    """Return loadflow parameters (RTE if available, else default)."""
    try:
        from expert_op4grid_recommender.utils.make_env_utils import (
            create_olf_rte_parameter as _olf_params,
        )
        log.info("  Using RTE loadflow parameters")
        return _olf_params()
    except ImportError:
        log.info("  Using default pypowsybl loadflow parameters")
        return pp.loadflow.Parameters()


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    t0 = time.time()

    log.info(f"Network:   {NETWORK_DIR}")
    log.info(f"Threshold: {args.threshold}%")
    log.info(f"Loadflow:  {'DC' if args.dc else 'AC'}")

    # ── Load network ──────────────────────────────────────────────────────
    log.info("Loading network …")
    net = pp.network.load(str(XIIDM_PATH))

    lines_df = net.get_lines()
    contingency_ids = list(lines_df.index)

    if args.include_transformers:
        try:
            t2w = net.get_2_windings_transformers()
            contingency_ids.extend(list(t2w.index))
            log.info(f"  Including {len(t2w)} two-winding transformers")
        except Exception:
            pass

    log.info(f"  {len(contingency_ids)} contingency candidates")

    # ── Limits and names ──────────────────────────────────────────────────
    log.info("Loading operational limits …")
    limits = _get_line_limits(net, XIIDM_PATH)
    log.info(f"  {len(limits)} lines with limits")

    log.info("Loading name mappings …")
    line_names, vl_names = _load_name_mappings(net, LINE_NAMES_PATH)

    line_vls = {}
    for lid, row in lines_df.iterrows():
        vl1 = row.get("voltage_level1_id", "")
        vl2 = row.get("voltage_level2_id", "")
        line_vls[lid] = (vl1, vl2)

    all_line_ids = list(lines_df.index)
    lf_params = _get_lf_params()

    # ── Run analysis (optionally chunked to fit the GraalVM heap) ─────────
    chunk_size = args.chunk_size if args.chunk_size > 0 else len(contingency_ids)
    if chunk_size < len(contingency_ids):
        log.info(
            f"Chunking N-1 sweep into batches of {chunk_size} contingencies "
            f"× {len(all_line_ids)} monitored branches"
        )

    overloads_chunks: list[pd.DataFrame] = []
    total_non_converged = 0
    t_sa = 0.0

    for chunk_start in range(0, len(contingency_ids), chunk_size):
        chunk_ids = contingency_ids[chunk_start:chunk_start + chunk_size]
        n_chunks = (len(contingency_ids) + chunk_size - 1) // chunk_size
        chunk_idx = chunk_start // chunk_size + 1

        sa = pp.security.create_analysis()
        sa.add_single_element_contingencies(chunk_ids)
        sa.add_monitored_elements(branch_ids=all_line_ids)

        log.info(
            f"Running {'DC' if args.dc else 'AC'} security analysis "
            f"chunk {chunk_idx}/{n_chunks} ({len(chunk_ids)} contingencies) …"
        )
        t1 = time.time()
        if args.dc:
            result = sa.run_dc(net, parameters=lf_params)
        else:
            result = sa.run_ac(net, parameters=lf_params)
        t_chunk = time.time() - t1
        t_sa += t_chunk
        log.info(f"  chunk {chunk_idx} completed in {t_chunk:.1f}s")

        post_results = result.post_contingency_results
        total_non_converged += sum(
            1 for pr in post_results.values()
            if getattr(pr, "status", None) is not None and pr.status.name != "CONVERGED"
        )

        br = result.branch_results
        if "operator_strategy_id" in br.index.names:
            br = br.droplevel("operator_strategy_id")
        cont_level = br.index.get_level_values("contingency_id")
        br = br[cont_level != ""]

        i_max = br[["i1", "i2"]].abs().max(axis=1)
        branch_ids = br.index.get_level_values("branch_id")
        cont_ids_idx = br.index.get_level_values("contingency_id")
        limits_series = pd.Series(branch_ids, index=br.index).map(limits).astype(float)
        loading_pct = (i_max / limits_series.where(limits_series > 0)) * 100.0
        mask = (loading_pct > args.threshold) & (branch_ids != cont_ids_idx)

        overloads_chunks.append(pd.DataFrame({
            "contingency_id": cont_ids_idx[mask],
            "branch_id": branch_ids[mask],
            "current_a": i_max[mask].round(1).values,
            "limit_a": limits_series[mask].round(1).values,
            "loading_pct": loading_pct[mask].round(1).values,
        }))

        # Free per-chunk Java-side state before the next iteration so the heap
        # is reclaimed between batches.
        del result, br, i_max, branch_ids, cont_ids_idx, limits_series, loading_pct, mask

    log.info(f"  Security analysis completed in {t_sa:.1f}s")
    total_tested = len(contingency_ids) - total_non_converged

    # ── Extract results ───────────────────────────────────────────────────
    log.info("Processing results …")
    overloads_df = (
        pd.concat(overloads_chunks, ignore_index=True)
        if overloads_chunks
        else pd.DataFrame(
            columns=["contingency_id", "branch_id", "current_a", "limit_a", "loading_pct"]
        )
    )

    # Group into the per-contingency structure
    contingencies_with_overload = []
    for cont_id, group in overloads_df.groupby("contingency_id", sort=False):
        group = group.sort_values("loading_pct", ascending=False)
        overloaded = [
            {
                "line_id": row.branch_id,
                "line_name": line_names.get(row.branch_id, row.branch_id),
                "loading_pct": float(row.loading_pct),
                "current_a": float(row.current_a),
                "limit_a": float(row.limit_a),
            }
            for row in group.itertuples(index=False)
        ]

        vl1_id, vl2_id = line_vls.get(cont_id, ("", ""))
        contingencies_with_overload.append({
            "tripped_line": cont_id,
            "tripped_line_name": line_names.get(cont_id, cont_id),
            "tripped_vl1": vl1_id,
            "tripped_vl1_name": vl_names.get(vl1_id, vl1_id),
            "tripped_vl2": vl2_id,
            "tripped_vl2_name": vl_names.get(vl2_id, vl2_id),
            "max_loading_pct": overloaded[0]["loading_pct"],
            "most_loaded_line": overloaded[0]["line_id"],
            "most_loaded_line_name": overloaded[0]["line_name"],
            "n_overloaded_lines": len(overloaded),
            "overloaded_lines": overloaded,
        })

    # Sort by peak loading descending
    contingencies_with_overload.sort(
        key=lambda x: x["max_loading_pct"], reverse=True
    )

    peak = (
        contingencies_with_overload[0]["max_loading_pct"]
        if contingencies_with_overload
        else 0
    )

    # ── Write output ──────────────────────────────────────────────────────
    output = {
        "description": (
            f"N-1 contingencies that produce >{args.threshold}% line overloads "
            f"on the {NETWORK_DIR.name} network"
        ),
        "network": str(XIIDM_PATH.relative_to(BASE_DIR)),
        "total_contingencies_tested": total_tested,
        "total_non_converged": total_non_converged,
        "total_with_overload": len(contingencies_with_overload),
        "peak_loading_pct": peak,
        "threshold_pct": args.threshold,
        "loadflow_type": "DC" if args.dc else "AC",
        "contingencies": contingencies_with_overload,
    }

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    elapsed = time.time() - t0
    log.info(f"\nDone in {elapsed:.1f}s ({elapsed / 60:.1f} min)")
    log.info(f"  Security analysis: {t_sa:.1f}s")
    log.info(f"  Tested:            {total_tested} contingencies")
    log.info(f"  Non-converged:     {total_non_converged}")
    log.info(f"  Overloads:         {len(contingencies_with_overload)} (>{args.threshold}%)")
    log.info(f"  Peak loading:      {peak}%")
    log.info(f"  Written:           {OUTPUT_PATH}")


if __name__ == "__main__":
    main()
