# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Evidence-based vetting of the Rosetta identity claims, against THT ground truth.

The failure mode this module exists for is **mutually-supporting wrong
clusters**: the Rosetta percolation uses a few hub names as sinks, so e.g. 52
voltage levels claim the poste SCHEE (which carries ONE 380 kV level in the THT
reference) and all 52 vouch for each other — a purely geometric rule cannot see
the problem because the pile is self-consistent. The cure is to score every
claim against the THT **poste graph**: a claim `v -> P` is supported by an
identified neighbour `u -> Q` only when P and Q really are electrical
neighbours (or geographically close) in THT, and that support only counts as
*clean* when Q itself is not over-claimed.

Verdicts (audited on grid_6be3a179): raw support looks healthy even at the
piles (SCHEE 20/52 members with support), but clean support collapses them
(SCHEE 1/52, MARSI 0/34, TRANS 0/12) while staying high off-pile.

All distances are in the layout's internal units converted by
``KM_PER_UNIT`` — consistent within the datasets but ~1.3–1.5× smaller than
real kilometres (landmark calibration), so thresholds here deliberately err
toward keeping a claim.
"""
from __future__ import annotations

import collections
import math
from dataclasses import dataclass

from tht_reference import ThtReference

#: A supporting neighbour's poste must be a G_THT edge of the claimed poste, or
#: within this distance of it (internal km).
SUPPORT_KM = 120.0
#: A neighbour's poste further than this contradicts the claim (internal km).
CONTRADICT_KM = 150.0
#: MATPOWER's node-breaker rebuild splits THT voltage levels ~1.5× (456 380 kV
#: VLs vs THT's 302), and models each generator unit as its own 380 kV leaf
#: bus. A poste may therefore legitimately carry up to this many identities:
CAP_SPLIT_RATIO = 1.5
#: Derivation: an unclaimed candidate poste must be a G_THT neighbour of (or
#: within this distance of) each supporting kept poste (internal km).
DERIVE_KM = 80.0

KM_PER_UNIT = 0.695 / 1000.0


def poste_cap(tht: ThtReference, poste: str) -> int:
    """Max identities one poste can plausibly hold."""
    info = tht.info(poste)
    if info is None:
        return 0
    return math.ceil(CAP_SPLIT_RATIO * info.count_at(380)) + info.n_gens


@dataclass
class ClaimScore:
    poste: str
    confidence: str
    support: int = 0
    clean_support: int = 0
    contradiction: int = 0

    @property
    def score(self) -> int:
        return self.support - self.contradiction


def _neighbour_postes(vl: str, adjacency: dict, claims: dict) -> list[str]:
    """Postes claimed by vl's neighbours, EXCLUDING vl's own claim (a pile
    member vouching via a same-poste sibling is no evidence at all)."""
    own = claims[vl].poste
    return [claims[u].poste for u in adjacency.get(vl, ())
            if u in claims and claims[u].poste != own]


def score_claims(identities: dict[str, str], confidences: dict[str, str],
                 mp_adjacency: dict[str, set], tht: ThtReference) -> dict[str, ClaimScore]:
    """Score every identity claim against THT poste-level ground truth.

    ``identities``: {vl: poste (stripped)}; ``confidences``: {vl: strict|loose};
    ``mp_adjacency``: matpower VL adjacency (lines + transformers).
    """
    claims = {vl: ClaimScore(poste=p, confidence=confidences.get(vl, "loose"))
              for vl, p in identities.items()}
    claim_counts = collections.Counter(p for p in identities.values())

    def supports(p: str, q: str) -> bool:
        if tht.are_adjacent(p, q):
            return True
        d = tht.geodist(p, q)
        return d is not None and d * KM_PER_UNIT <= SUPPORT_KM

    def contradicts(p: str, q: str) -> bool:
        d = tht.geodist(p, q)
        return d is not None and d * KM_PER_UNIT > CONTRADICT_KM and not tht.are_adjacent(p, q)

    for vl, cs in claims.items():
        for q in _neighbour_postes(vl, mp_adjacency, claims):
            if supports(cs.poste, q):
                cs.support += 1
                # Clean support: the supporter's own poste is not over-claimed.
                if claim_counts[q] <= poste_cap(tht, q):
                    cs.clean_support += 1
            elif contradicts(cs.poste, q):
                cs.contradiction += 1
    return claims


def vet_identities(identities: dict[str, str], confidences: dict[str, str],
                   mp_adjacency: dict[str, set], tht: ThtReference,
                   ) -> tuple[set[str], set[str], dict]:
    """Split claims into ``(kept, released)`` plus a per-release reason map.

    Policy (never releases a ``strict`` claim):
      1. loose claims to a poste absent from THT are released;
      2. loose claims with more contradictions than support are released;
      3. at each over-claimed poste (claims > cap), loose members are kept
         only up to the cap after the strict ones, ranked by clean support
         then support — and a kept loose member needs support >= 1.
    """
    claims = score_claims(identities, confidences, mp_adjacency, tht)
    released: dict[str, str] = {}

    for vl, cs in claims.items():
        if cs.confidence == "strict":
            continue
        if not tht.has_poste(cs.poste):
            released[vl] = "poste-not-in-tht"
        elif cs.score < 0:
            released[vl] = "contradicted-by-neighbours"

    by_poste: dict[str, list] = collections.defaultdict(list)
    for vl, cs in claims.items():
        if vl not in released:
            by_poste[cs.poste].append((vl, cs))
    for poste, members in by_poste.items():
        cap = poste_cap(tht, poste)
        if len(members) <= cap:
            continue
        strict = [m for m in members if m[1].confidence == "strict"]
        loose = [m for m in members if m[1].confidence != "strict"]
        loose.sort(key=lambda m: (-m[1].clean_support, -m[1].support, m[0]))
        slots = max(0, cap - len(strict))
        for i, (vl, cs) in enumerate(loose):
            if i >= slots:
                released[vl] = "over-poste-cap"
            elif cs.support < 1:
                released[vl] = "no-supporting-neighbour"

    kept = set(identities) - set(released)
    return kept, set(released), released


def derive_identities(vls_380: set[str], identities: dict[str, str], kept: set[str],
                      mp_adjacency: dict[str, set], tht: ThtReference,
                      ) -> dict[str, dict]:
    """Conservative 1-hop derivation of layout anchors for UNCLAIMED postes.

    For an unidentified 380 kV voltage level whose kept-identity neighbours
    claim >= 2 distinct postes, an unclaimed THT poste (with a 380 kV level)
    that is a G_THT neighbour of — or within ``DERIVE_KM`` of — at least two of
    those postes is a candidate; accepted only when a unique candidate wins by
    a margin >= 1, and each poste is derived at most once (best margin first).
    Leave-one-out precision measured at 0.90; expected yield is small (~2 per
    grid). These are POSITIONAL anchors only, no identity record is written.
    """
    claimed_postes = {p for p in identities.values()}
    unclaimed = {p for p, info in tht.postes.items()
                 if info.count_at(380) >= 1 and p not in claimed_postes}

    def near(p: str, q: str) -> bool:
        if tht.are_adjacent(p, q):
            return True
        d = tht.geodist(p, q)
        return d is not None and d * KM_PER_UNIT <= DERIVE_KM

    proposals = []
    for v in sorted(vls_380 - set(identities)):
        support_postes = {identities[u] for u in mp_adjacency.get(v, ())
                          if u in kept and u in identities}
        if len(support_postes) < 2:
            continue
        scores = {c: sum(1 for q in support_postes if near(c, q)) for c in unclaimed}
        ranked = sorted(((s, c) for c, s in scores.items() if s >= 2), reverse=True)
        if not ranked:
            continue
        best_s, best_c = ranked[0]
        second_s = ranked[1][0] if len(ranked) > 1 else 0
        if best_s - second_s >= 1:
            proposals.append((best_s - second_s, best_s, v, best_c,
                              sorted(q for q in support_postes if near(best_c, q))))

    derived: dict[str, dict] = {}
    used_postes: set[str] = set()
    for margin, s, v, poste, evidence in sorted(proposals, reverse=True):
        if poste in used_postes:
            continue
        used_postes.add(poste)
        derived[v] = {"poste": poste, "evidence": evidence, "margin": margin}
    return derived
