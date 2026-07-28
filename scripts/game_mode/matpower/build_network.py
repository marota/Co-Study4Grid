# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Stage 1 of the France RTE Matpower game dataset: assemble one game grid per
MATPOWER case from a snapshot **already in detailed topology**.

This stage performs NO grid transformation. Every reconstruction step —
MATPOWER conversion, current limits, Q calibration, AC settling, Rosetta
re-identification, real RTE substation structure, node/breaker detailed
topology (libTOPO) — lives in the ``grid_snapshot_reconstruct`` repo, which
produces per case:

    <detailed>/<caseName>/network_detailed.xiidm    NODE_BREAKER, converged
    <detailed>/<caseName>/grid_layout.json          voltage level -> [x, y]
    <detailed>/<caseName>/rte_substation_map.json   bus -> real substation
    <detailed>/<caseName>/detailed_report.json      invariants + flow fidelity

Produce them with::

    python -m grid_snapshot_reconstruct.matpower_detailed all [--map <v7.json>]

This stage then only does what is specific to the GAME: opaque grid identity
(the real date stays private), the action space offered to players, and the
base-relative N-1 screen that feeds scenario building. Persists, RESUMABLY:

    data/rte_matpower/grids/<opaqueId>/network.xiidm
    data/rte_matpower/grids/<opaqueId>/grid_layout.json
    data/rte_matpower/grids/<opaqueId>/actions.json
    data/rte_matpower/grids/<opaqueId>/n1_contingencies.json
    data/rte_matpower/mapping_private.json     (opaqueId -> real date, private)

Run:  python scripts/game_mode/matpower/build_network.py [caseName|all]
"""
from __future__ import annotations

import datetime
import hashlib
import json
import os
import shutil
import sys
import time
from pathlib import Path

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from actions import build_action_space  # noqa: E402

RECON_DIR = Path(os.environ.get(
    "RECON_DIR", "/Users/antoine/Dev/Grid_snapshot_reconstruct"))
if str(RECON_DIR) not in sys.path:
    sys.path.insert(0, str(RECON_DIR))
from grid_snapshot_reconstruct import tht_dataset as T  # noqa: E402
import pypowsybl as pp  # noqa: E402

REPO = Path(__file__).resolve().parents[3]
DATA = REPO / "data" / "rte_matpower"
GRIDS = DATA / "grids"

#: Where ``grid_snapshot_reconstruct.matpower_detailed`` wrote its artifacts.
DETAILED_DIR = Path(os.environ.get(
    "MATPOWER_DETAILED_DIR", RECON_DIR / "data" / "matpower_detailed"))

#: Re-identified 2013 timestamps (kept here for the private mapping only).
INSTANTS = {
    "case6468rte": "2013-01-14T06:30",
    "case6470rte": "2013-01-18T00:30",
    "case6495rte": "2013-01-15T19:00",
    "case6515rte": "2013-01-18T19:00",
}
_PERIODS = [(6, "night"), (12, "morning"), (18, "afternoon"), (24, "evening")]

#: Artifacts copied as-is from the detailed snapshot into the grid folder.
_COPIED = {"network_detailed.xiidm": "network.xiidm",
           "grid_layout.json": "grid_layout.json",
           "rte_substation_map.json": "rte_substation_map.json"}


def opaque_id(case_name: str) -> str:
    return "grid_" + hashlib.sha1(case_name.encode()).hexdigest()[:8]


def period_title(iso: str) -> str:
    """month + weekday + hour-period, NO year (hidden-date convention)."""
    dt = datetime.datetime.fromisoformat(iso)
    hour_period = next(name for bound, name in _PERIODS if dt.hour < bound)
    return f"{dt.strftime('%B')} — {dt.strftime('%A')} {hour_period}"


def detailed_dir(case_name: str) -> Path:
    """Directory holding the detailed snapshot of ``case_name``, or exit with
    the command that produces it."""
    d = DETAILED_DIR / case_name
    if (d / "network_detailed.xiidm").exists():
        return d
    raise SystemExit(
        f"Instantané en topologie détaillée absent : {d}\n"
        f"Produisez-le côté grid_snapshot_reconstruct :\n"
        f"  python -m grid_snapshot_reconstruct.matpower_detailed "
        f"{case_name} --out {d}\n"
        f"(ou pointez MATPOWER_DETAILED_DIR sur le répertoire de sortie)")


def load_detailed(case_name: str):
    """The detailed snapshot as ``(network, report, source_dir)``."""
    d = detailed_dir(case_name)
    net = pp.network.load(str(d / "network_detailed.xiidm"))
    rp = d / "detailed_report.json"
    return net, (json.loads(rp.read_text()) if rp.exists() else {}), d


def build_case(case_name: str) -> str:
    gid = opaque_id(case_name)
    out = GRIDS / gid
    out.mkdir(parents=True, exist_ok=True)
    net_path = out / "network.xiidm"
    layout_path = out / "grid_layout.json"
    n1_path = out / "n1_contingencies.json"
    actions_path = out / "actions.json"
    if all(p.exists() for p in (net_path, layout_path, n1_path, actions_path)):
        print(f"[{case_name} -> {gid}] already built; skipping")
        return gid
    t0 = time.time()
    print(f"[{case_name} -> {gid}] assembling ...")

    src_dir = detailed_dir(case_name)
    for src_name, dst_name in _COPIED.items():
        src, dst = src_dir / src_name, out / dst_name
        if src.exists() and not dst.exists():
            shutil.copyfile(src, dst)
    rp = src_dir / "detailed_report.json"
    report = json.loads(rp.read_text()) if rp.exists() else {}
    det = report.get("detailed", {})
    print(f"  detailed snapshot: buses={det.get('buses')} "
          f"switches={det.get('switches')} "
          f"RTE-structured VLs={det.get('rte_structured_vls')} "
          f"converged={det.get('converged')} "
          f"flow-fidelity median={report.get('flow_bench', {}).get('median_MW')} MW")

    net = pp.network.load(str(net_path))
    if not actions_path.exists():
        actions_path.write_text(json.dumps(build_action_space(net)))
        print(f"  actions: {actions_path.name}")

    if not n1_path.exists():
        ts = time.time()
        settle = T.settle_state(net, "eps0.01")
        ant = T.antenna_analysis(net)
        res = T.screen_n1(net, settle.get("stage", "eps0.01"), antennas=ant,
                          chunk_size=250)
        n1_path.write_text(json.dumps(res))
        conts = res.get("contingencies", [])
        non_ant = [c for c in conts if not c.get("antenna")]
        print(f"  scan: {len(non_ant)} non-antenna constraining "
              f"(of {res.get('total_contingencies_tested')} tested) "
              f"in {time.time()-ts:.0f}s")

    _update_mapping(case_name, gid)
    print(f"[{case_name} -> {gid}] done in {time.time()-t0:.0f}s")
    return gid


def _update_mapping(case_name: str, gid: str):
    mp = DATA / "mapping_private.json"
    data = json.loads(mp.read_text()) if mp.exists() else {}
    iso = INSTANTS.get(case_name, "")
    data[gid] = {
        "case_label": case_name,
        "case_date": iso,
        "period_title": period_title(iso) if iso else case_name,
        "network_path": f"data/rte_matpower/grids/{gid}/network.xiidm",
    }
    mp.write_text(json.dumps(data, indent=2))


def main():
    which = sys.argv[1] if len(sys.argv) > 1 else "all"
    names = list(INSTANTS) if which == "all" else [which]
    for name in names:
        build_case(name)


if __name__ == "__main__":
    main()
