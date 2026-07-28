#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Decode the Game Mode grid networks committed as text.

Every shipped scenario family commits its networks **compressed and
text-encoded** as network.xiidm.gz.b64 (gzip + base64) so they stay small and
push through git without Git-LFS (the raw XML would otherwise bloat the repo —
~8.8 MB per THT grid, ~20 MB per Matpower grid — and a binary .zip needs LFS,
whose object endpoint is blocked in some CI egress policies). This script
decodes every .gz.b64 back to network.xiidm.

Covers both families (the name is kept because the Dockerfile and the feature
docs call it):

* data/rte7000_tht/grids/  — France THT, reconstructed RTE7000 snapshots
* data/rte_matpower/grids/ — France EHV, the public MATPOWER RTE cases

The other direction is scripts/game_mode/pack_grids.py.

Run once after checkout / at image build:
    python scripts/game_mode/decode_tht_grids.py
"""
import base64
import gzip
import pathlib

REPO = pathlib.Path(__file__).resolve().parents[2]
#: Every family whose networks ship text-encoded.
ROOTS = (
    REPO / "data" / "rte7000_tht" / "grids",
    REPO / "data" / "rte_matpower" / "grids",
)


def decode_root(root: pathlib.Path) -> int:
    n = 0
    for enc in sorted(root.glob("*/network.xiidm.gz.b64")):
        out = enc.with_name(enc.name[: -len(".gz.b64")])  # network.xiidm
        out.write_bytes(gzip.decompress(base64.b64decode(enc.read_bytes())))
        n += 1
        print(f"decoded {root.parent.name}/{enc.parent.name}/{out.name}")
    return n


def main():
    total = sum(decode_root(r) for r in ROOTS if r.is_dir())
    if total == 0:
        print("no network.xiidm.gz.b64 under "
              + ", ".join(str(r) for r in ROOTS))


if __name__ == "__main__":
    main()
