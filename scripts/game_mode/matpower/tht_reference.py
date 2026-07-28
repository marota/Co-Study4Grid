# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Ground truth from the France THT (RTE7000) reference snapshot.

The Matpower cases were positioned by matching against the named THT snapshot
``grid_5384e039``, so that snapshot is the authority for three things the
layout repair needs:

* the **poste inventory** — which postes exist, which voltage levels each
  carries (per the XIIDM ``<substation>`` nesting, NOT the VL-id prefix: 157 of
  the 1 424 THT voltage levels are extra 400 kV nodes named ``1<poste>P7`` /
  ``2<poste>P7`` whose prefix is not their substation), their coordinates, and
  how many generator units each hosts (MATPOWER models each unit as its own
  380 kV leaf bus, so plant postes legitimately carry more identities);
* the **poste adjacency graph** — which postes are electrically neighbours,
  the evidence base for vetting identity claims;
* the **225 kV site list** — the real positions of the French 225 kV network,
  the targets for the transformer-implied pins and the capacity-limited snap.

Poste names are ``.strip()``-ed everywhere: ``rte_substation_map.json``
carries claims like ``'CERN '`` / ``'CBRY '`` whose trailing space otherwise
fails every THT lookup.
"""
from __future__ import annotations

import collections
import re
from dataclasses import dataclass, field
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
THT_GRID_DIR = REPO / "data" / "rte7000_tht" / "grids" / "grid_5384e039"

_SUB_OR_VL_RE = re.compile(r"<(/?)(?:\w+:)?(substation|voltageLevel|generator)\b([^>]*)>")
_ID_RE = re.compile(r'\bid="([^"]+)"')
_NOMV_RE = re.compile(r'\bnominalV="([^"]+)"')


@dataclass
class PosteInfo:
    """One THT poste: its voltage levels (id, kV, x, y), and counters."""
    vls: list = field(default_factory=list)
    n_gens: int = 0

    def vls_at(self, kv: int) -> list:
        return [v for v in self.vls if v[1] == kv]

    def count_at(self, kv: int) -> int:
        return len(self.vls_at(kv))

    def centroid_at(self, kv: int):
        pts = [(x, y) for _, k, x, y in self.vls if k == kv and x is not None]
        if not pts:
            return None
        return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


@dataclass
class ThtReference:
    postes: dict            # {poste: PosteInfo}
    poste_of_vl: dict       # {vl id: poste}
    adjacency: dict         # {poste: set(neighbour postes)} — G_THT
    sites_225: list         # [(x, y, poste, vl_id)] — every positioned 225 kV VL

    def has_poste(self, name: str) -> bool:
        return name.strip() in self.postes

    def info(self, name: str) -> PosteInfo | None:
        return self.postes.get(name.strip())

    def geodist(self, p: str, q: str, kv: int = 380):
        """Distance between two postes' kv-centroids (falls back to any VL)."""
        import math
        a, b = self.info(p), self.info(q)
        if a is None or b is None:
            return None
        ca = a.centroid_at(kv) or a.centroid_at(225)
        cb = b.centroid_at(kv) or b.centroid_at(225)
        if ca is None or cb is None:
            return None
        return math.hypot(ca[0] - cb[0], ca[1] - cb[1])

    def are_adjacent(self, p: str, q: str) -> bool:
        return q.strip() in self.adjacency.get(p.strip(), ())


def load_tht_reference(grid_dir: Path = THT_GRID_DIR) -> ThtReference:
    """Parse the THT snapshot into the ground-truth tables above."""
    import json

    # Local import so the matpower scripts stay usable standalone.
    import repair_layout as R

    xml = R.load_network_xml(grid_dir)
    layout = json.loads((grid_dir / "grid_layout.json").read_text(encoding="utf-8"))

    postes: dict[str, PosteInfo] = {}
    poste_of_vl: dict[str, str] = {}
    current = None
    for m in _SUB_OR_VL_RE.finditer(xml):
        closing, tag, attrs = m.group(1), m.group(2), m.group(3)
        if tag == "substation":
            current = None if closing else _ID_RE.search(attrs).group(1).strip()
            if current:
                postes.setdefault(current, PosteInfo())
        elif closing or current is None:
            continue
        elif tag == "voltageLevel":
            vid = _ID_RE.search(attrs)
            nv = _NOMV_RE.search(attrs)
            if vid and nv:
                vl_id = vid.group(1)
                kv = round(float(nv.group(1)))
                coords = layout.get(vl_id)
                x, y = (coords[0], coords[1]) if coords else (None, None)
                postes[current].vls.append((vl_id, kv, x, y))
                poste_of_vl[vl_id] = current
        elif tag == "generator":
            postes[current].n_gens += 1

    pairs, _ = R.parse_topology(xml)
    adjacency: dict[str, set] = collections.defaultdict(set)
    for a, b in pairs:
        pa, pb = poste_of_vl.get(a), poste_of_vl.get(b)
        if pa and pb and pa != pb:
            adjacency[pa].add(pb)
            adjacency[pb].add(pa)

    sites_225 = [
        (x, y, poste, vl_id)
        for poste, info in postes.items()
        for vl_id, kv, x, y in info.vls
        if kv == 225 and x is not None
    ]
    return ThtReference(postes=postes, poste_of_vl=poste_of_vl,
                        adjacency=dict(adjacency), sites_225=sites_225)
