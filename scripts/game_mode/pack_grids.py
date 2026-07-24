#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Pack Game Mode grid networks for commit: network.xiidm -> .gz.b64.

The inverse of scripts/game_mode/decode_tht_grids.py. Run it after (re)building
a family's grids, before committing them: the raw XIIDM is far too large to
commit (~20 MB per Matpower grid) and a binary .zip would need Git-LFS, whose
object endpoint is blocked in some CI egress policies. gzip + base64 keeps the
payload text, diff-safe for git's packing, and dependency-free to decode.

    python scripts/game_mode/pack_grids.py                   # every family
    python scripts/game_mode/pack_grids.py data/rte_matpower  # one family
"""
from __future__ import annotations

import argparse
import base64
import gzip
from pathlib import Path

from decode_tht_grids import ROOTS  # noqa: E402  (same directory)


def pack_root(root: Path, force: bool = False) -> int:
    n = 0
    for src in sorted(root.glob("*/network.xiidm")):
        out = src.with_name(src.name + ".gz.b64")
        if out.exists() and not force and out.stat().st_mtime >= src.stat().st_mtime:
            print(f"à jour  {root.parent.name}/{src.parent.name}")
            continue
        blob = base64.b64encode(gzip.compress(src.read_bytes(), 9))
        out.write_bytes(blob)
        n += 1
        print(f"packé   {root.parent.name}/{src.parent.name}: "
              f"{src.stat().st_size / 1e6:.1f} Mo -> {len(blob) / 1e6:.1f} Mo "
              f"({src.stat().st_size / max(1, len(blob)):.1f}x)")
    return n


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("family", nargs="*", type=Path,
                    help="racine(s) de famille (défaut: toutes)")
    ap.add_argument("--force", action="store_true",
                    help="re-packer même si le .gz.b64 est plus récent")
    args = ap.parse_args()
    roots = [f / "grids" if (f / "grids").is_dir() else f
             for f in args.family] or list(ROOTS)
    total = sum(pack_root(r, args.force) for r in roots if r.is_dir())
    print(f"{total} réseau(x) packé(s)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
