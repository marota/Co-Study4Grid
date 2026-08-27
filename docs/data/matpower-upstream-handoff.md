# Handoff: revise the Matpower VL mappings & layout at the source (`Grid_snapshot_reconstruct`)

**Audience.** A working session in the `Grid_snapshot_reconstruct` repository —
the pipeline that produces the detailed Matpower snapshots this repo consumes
(`matpower_detailed`: MATPOWER conversion, Rosetta re-identification against
the named THT snapshot, node/breaker rebuild, layout, `rte_substation_map.json`).

**Why.** An operator review of the France EHV (Matpower) game grids found the
drawn map wrong in specific, diagnosable ways: weird 400 kV around Paris, the
Nord, the eastern and Spain borders, and a 225 kV network "not recognizable as
the real grid". A three-way audit against the RTE7000 THT reference traced
every complaint to defects in the **identity mapping and propagated layout**
that this (downstream) repo can only mitigate, not fix. The downstream stopgap
(`scripts/game_mode/matpower/repair_layout.py`, "v3") ships a much better
drawing, but the durable fix is upstream, at the source of
`rte_substation_map.json` and `grid_layout.json`. This document is the
complete, self-contained brief for that work.

**Status of the numbers.** Every figure below was independently reproduced by
an adversarial verification pass (separate XML parsing, separate stats code)
on `grid_6be3a179` (= `case6515rte`); the other three cases behave
identically within noise. Ground truth = the committed THT snapshot
`data/rte7000_tht/grids/grid_5384e039/` (1 147 postes, 1 424 VLs: 302×380 kV
over 201 postes, 1 081×225 kV over 1 063 postes, real names, real positions).
All "km" are internal layout units × 0.695 e-3 — see F7 before reusing any
threshold as real geography.

---

## Findings, in priority order

### F1 — Identity over-assignment: the percolation uses hub names as sinks

`rte_substation_map.json` claims are heavily piled onto a few postes, far past
physical plausibility:

| poste | claims | real THT 380 kV VLs | region |
|---|---|---|---|
| SCHEE | 52 | 1 | Alsace / eastern border |
| MARSI | 34 | 1 | Béarn / Spain border |
| GRAV5 | 17 | 1 | Nord coast |
| E.HU7 | 16 | 1 | German border |
| CATG2 | 14 | 1 | Moselle |
| B.CAR / TRANS | 12 / 12 | 3 / 1 | Provence |
| BOISS / NEOUL | 11 / 11 | 1 / 3 | — |

14 piled postes hold **226 of the 452 usable claims**; 31 postes over-claim by
≥ 3. A real THT poste carries at most 6 VLs at 400 kV (mean 1.5). The
legitimate part of multiplicity is bounded: the node-breaker rebuild splits
VLs ~1.5× (456 matpower vs 302 THT 380 kV VLs) and MATPOWER models each
generator unit as its own 380 kV leaf bus — so a defensible cap is
`ceil(1.5 · n380_THT) + n_generator_units_THT` (Gravelines: 11 of GRAV5's 17
claims are strict generator-unit leaves; harmless).

**Why the piles are hard to see from inside:** pile members mutually vouch for
each other. Raw neighbour-support looks healthy (SCHEE: 20/52 members have a
supporting identified neighbour), but **clean support** — support from a
neighbour whose own poste is *not* over-claimed — collapses: SCHEE 1/52,
MARSI 0/34, TRANS 0/12, BIANC 0/8, while staying high off-pile. Any percolation
confidence measure that lets matched neighbours reinforce each other will
self-certify a wrong cluster; the fix needs an *external* plausibility prior
(per-poste capacity from the THT snapshot) inside the matcher itself.

Geometric consequences (raw layouts): 400-km "400 kV lines" between two
"identified" postes (SCHEE–TRANS 396 km, B.CAR–MARSI 466 km, MARL6–VLARO
401 km, GRAV5–CATG2 ~246 km ×2), 265 branches > 100 km per grid, and 33 of the
73 "western" 380 kV VLs being the MARSI pile. These *are* the operator's Nord
/ eastern / Spain-border complaints.

**Upstream action.** Re-run the Rosetta match with a per-poste capacity cap
(formula above) and/or a mutual-support-aware confidence (down-weight support
coming from claims of over-claimed postes). The ~220 claims per grid the
downstream vetting releases (lists in each committed
`data/rte_matpower/grids/<grid>/layout_repair.json → released_identities`,
with per-claim reasons) are the candidates to re-percolate — ideally against
the unclaimed postes of F2, using electrical distances (poste-level adjacency
alone recovers almost nothing: the released blobs contain too few kept
anchors — a conservative 1-hop derivation yields only ~2 identities per grid
at leave-one-out precision 0.90).

### F2 — Coverage holes: 77 of 201 THT 400 kV postes have no identity at all

Concentrated exactly where the operator sees artifacts:

- **Paris inner ring — zero identities**: TERRI, SAUS5, PENC5, YVE.O, VLEJU,
  VLEVA, REMIS, N.SE2, BOCTO, CBRY. Only the outer ring is claimed (MEZE5 ×6,
  MORBR ×5, RENAR ×4, P.GAS ×3, N.SE1 ×3, CERGY ×2, CIROL ×2, CHESN ×2). The
  matpower Paris band draws 4×380 kV VLs where THT has 10.
- **Nord chain — 21 unclaimed** (WARAN, WEPPE, BOUCH, GAVRE, MAZUR, CHOO2,
  REVI5, VIGY, CATG1, PEUP5, TOLLE, MENUE, TAUTE, …): everything between the
  GRAV5 / E.HU7 / CATG2 piles.
- **Loire nuclear corridor — unclaimed**: CHIN2, CHINX (Chinon), D.BUR, D.BUX
  (Dampierre), BVIL7, BVILX (Belleville), SSAL7, G.AVO; also BUGEY, CREYS,
  SSV.O in the east.
- **West**: 8/18 unclaimed incl. both Cordemais entries (COR.P, CORD5) and
  Blayais (BLAYA) — the west's two biggest hubs.

Also: 4 of the 456 matpower 380 kV VLs carry no identity. The interesting one
is the pair `VL-1179`/`VL-1200` (case6515 bus numbering): `VL-1200` is a
degree-11 hub whose identified neighbours are AVOI5, CALA5, LOUIS, MARTY —
CALA5/LOUIS/MARTY are genuinely THT-adjacent to **COR.P**, so it is almost
certainly Cordemais (the downstream repair anchors it there, positionally
only).

**Upstream action.** These 77 postes are where the released F1 claims most
plausibly belong. A re-percolation seeded from the *vetted* kept set (233 per
grid; the complement of `released_identities`) with electrical distances
should recover a good fraction — the Paris ring and the Nord chain would fix
the two worst visual artifacts outright.

### F3 — Mapping hygiene bugs (quick wins)

1. **Trailing whitespace in poste names**: claims `'CERN '` (×3) and
   `'CBRY '` (×2) fail every exact-name join against the THT snapshot; both
   are real postes after `.strip()`. Emit stripped names.
2. **`MUHLB` does not exist** in the THT reference (3 loose claims, part of
   the eastern-edge foreign cluster) — a phantom name.
3. **68 stale entries** in `rte_substation_map.json` (520 entries, 452 usable)
   are keyed to bus numbers absent from the shipped network. Harmless
   downstream but noise for any consumer; filter at export.
4. Suspect **strict** matches worth re-examining (likely name-collision
   matches; strict is trusted downstream and never released): BOISS (11
   strict claims vs a plausibility cap of 2, and members re-derive to other
   postes under leave-one-out), HAVR5, LONNY, TAVEL, CANTE.

### F4 — The 225 kV layer: individually plausible positions, degenerate collectively

Rosetta identifies 380 kV only; every 225 kV position is propagated. The
result is **stacked**: individually each node is near a real site (median
2.5 km to the nearest THT 225 kV site) but ~750 nodes crowd ~277 sites while
most of the real 1 081-site web has no node — site coverage p50 was 14.4 km,
*worse than a uniform random scatter over France (9.7 km)*. Normandy held
3.3× its real node count while Pays de la Loire / the south-east sat
half-empty. That is precisely "I don't recognize the 225 kV grid, e.g. on the
west side". Inventory is fine: 1 236 matpower vs 1 081 THT 225 kV VLs — a
1.14 split ratio, nothing missing or extra.

**Upstream action** (the downstream de-stacking is a heuristic that a proper
placement would obsolete):

- **Same-substation constraint**: a 400/225 transformer lives inside one
  substation. Every 225 kV bus 2WT-connected to an identified 380 kV bus can
  inherit that poste's identity/position with near-certainty (~102 unambiguous
  VLs per case; 0 conflicting claims observed).
- **Capacity-limited placement**: when propagating the rest, allocate at most
  1–3 nodes per real 225 kV site (1 048 of 1 063 THT postes carry exactly one
  225 kV VL) instead of letting many nodes collapse onto one plausible site.
- Better yet: extend the percolation itself to the 225 kV graph seeded by the
  transformer-implied identities — the true 225 kV topology is in the case,
  and the THT 225 kV graph is in the reference.

### F5 — Foreign border-equivalent networks drawn inside France

The cases embed neighbouring-network equivalents at voltages France does not
operate for transmission, currently placed inside the hull:

- **150 kV** (67 VLs, 11 components, all on borders): 18 nodes Basque border
  near ARGIA, 15 central Pyrenees, 8+2 Alps/Italy, 8+1 at the German border
  attached to E.HU7, 3 near Lille/Belgium.
- **45 kV** (64 VLs): almost entirely Geneva/Jura/Alps next to VLARO, GEN.P,
  CERN (plus 2+2 components near Lille).
- **Eastern-edge appendix**: ~53 EHV nodes stacked in a 28-km band at the map's
  eastern edge (44 unclaimed, 6 SIERE, 3 MUHLB), 128 internal links vs only 31
  external (to SCHEE ×11, MAMBE, LOGEL, VINCE) — a self-connected German/Swiss
  border equivalent. It pre-exists the downstream repair (only 13/107 of those
  nodes moved > 20 km through it) and draws the "orange wall" on the eastern
  border.

**Upstream action.** Tag foreign/equivalent buses in the export (even just a
boolean) and position them *outside* the France hull, beyond their attachment
poste. Downstream cannot distinguish them robustly today.

### F6 — What "identified" quality looks like (keep this property)

Strict identities are excellent and are the reason the rest of the map reads
well: median 2.4 km, p90 5.0 km, max 11 km from their claimed poste; the two
layouts share one coordinate frame (median translation 0.26 km, pairwise
distance ratio 0.9998 — same raw Mercator metres, no offset/scale/rotation);
all 449 resolvable identities are 380 kV and every claimed poste really has a
380 kV level. Whatever changes, preserve: frame identity with the THT layout,
strict-match precision, and the per-VL jitter that keeps a substation's VLs
from coinciding.

### F7 — Calibration caveat on every "km" in this file

Fitting the THT layout against 6 unambiguous nuclear-plant postes gives
0.93–1.05 e-3 km/unit versus the 0.695 e-3 conversion both repos use — real
distances are ~1.3–1.5× larger than the reported figures — and the THT layout
fits neither Mercator nor Lambert-93 affinely (20–110 km residuals on landmark
postes). The two datasets are mutually consistent, so all *relative* work is
sound, but do not reuse thresholds (45 km offset ceiling, 120/150 km
support/contradiction radii) as absolute geography without recalibrating.

---

## What the downstream stopgap does today (and what it cannot)

`scripts/game_mode/matpower/repair_layout.py` (v3, with `tht_reference.py` +
`identity_vetting.py`) runs at *game-dataset build time* on the raw layouts:

1. vets claims against the THT poste graph (releases ~220/452 per grid:
   over-cap 159, contradicted 23, no-support 15, ghost-poste 3, geometric 20;
   strict never released; kept identities stay byte-identical),
2. pins ~82 transformer-implied 225 kV VLs at their poste's real THT site and
   de-stacks the remaining ~1 013 onto distinct real sites (minimum-cost
   assignment iterated with the relaxation on a 35→60→90 km radius),
3. re-places everything else by a per-class anchored Laplacian relaxation.

Shipped improvement (per grid): branches > 200 km 53 → 2, neighbour-offsets
> 100 km 51 → 2, 225 kV site coverage 40 % → 88 % (p50 14.4 → 4.4 km).

What it structurally **cannot** do — the reasons to fix upstream:

- it releases wrong identities but cannot say where those VLs belong: the
  released pile members only diffuse 30–60 km from the pile, so the Paris ring
  and the Nord chain stay under-drawn;
- ~14–18 branches per grid still join two *kept* postes at > 100 km (list:
  `python scripts/game_mode/matpower/repair_layout.py --dry-run
  --report-suspect-anchors <grid>`; e.g. MORBR–HAVR5 237 km, CANTE–CLERA
  168 km, VIELM–BOISS 152 km) — at least one endpoint identity is wrong and
  only the matcher can decide which;
- the 225 kV de-stacking is proximity+topology heuristics, not identity — a
  225-level percolation would beat it;
- foreign equivalents stay inside the hull (F5).

## Interface contract for a regenerated dataset

Downstream consumes, per case: `network_detailed.xiidm`, `grid_layout.json`
(raw Mercator metres, same frame as the THT layout, > 500 k units span, no
coincident VL positions), `rte_substation_map.json`
(`{bus: {substation, confidence: strict|loose}}`, stripped names, only buses
present in the network; new confidence grades are welcome — downstream treats
anything ≠ `strict` as releasable). The downstream repair is **idempotent and
self-skipping** (provenance hash in `layout_repair.json`) and re-runs cleanly
on any regenerated layout: `python scripts/game_mode/matpower/build_network.py`
then `repair_layout.py` then `gen_network_previews.py`. As upstream absorbs
F1/F2/F4, the repair's release counts and snap distances shrink toward no-ops
— those counts (printed per run and stored in provenance) are the integration
metric.

## Acceptance criteria for an upstream fix

Computable with the committed tools (`repair_layout.py` stats +
`tht_reference.py`), against `grid_5384e039`:

| metric (per grid, raw output — before any downstream repair) | today (raw) | target |
|---|---|---|
| identity claims released by the downstream vetting | ~220 / 452 | < 50 |
| THT 400 kV postes with ≥ 1 identity | 122 / 201 | > 170, Paris ring > 0 |
| max claims on one poste vs its cap `ceil(1.5·n380)+n_gens` | 52 vs 2 | ≤ cap everywhere |
| branches > 200 km | 53 | < 5 |
| 225 kV site-coverage p50 / ≤ 10 km share | 14.4 km / 40 % | ≤ 5 km / ≥ 85 % |
| 225 kV node-to-site p50 (de-stacked, not re-stacked) | 2.5 km (stacked) | ≤ 5 km with coverage above |
| kept-identity distance to claimed poste (max) | 5.9 km | ≤ 10 km |

## Reproduction map

Everything is recomputable from this repo alone (the audit's scratch files
were session-local; all conclusions and lists that matter are either in this
file, in the committed `layout_repair.json` provenance records, or one command
away):

```bash
# Raw layouts (pre-repair input): git show d568a7b:data/rte_matpower/grids/<grid>/grid_layout.json
python scripts/game_mode/matpower/repair_layout.py --dry-run          # before/after stats, all grids
python scripts/game_mode/matpower/repair_layout.py --dry-run --report-suspect-anchors <grid>
python - <<'PY'                                                        # over-claim table & scores
import sys; sys.path.insert(0, 'scripts/game_mode/matpower')
import json, collections, repair_layout as R, identity_vetting as IV
from tht_reference import load_tht_reference
g = R.GRIDS / 'grid_6be3a179'; tht = load_tht_reference()
layout = json.loads((g/'grid_layout.json').read_text())
smap = json.loads((g/'rte_substation_map.json').read_text())
pairs, kv = R.parse_topology(R.load_network_xml(g))
claims = IV.score_claims(R.identity_postes(smap, layout), R.identity_ids(smap, layout),
                         R.build_adjacency(pairs), tht)
counts = collections.Counter(c.poste for c in claims.values())
for p, n in counts.most_common(10):
    print(p, n, 'cap', IV.poste_cap(tht, p))
PY
pytest scripts/game_mode/matpower/          # the regression bars in test_repair_layout.py
```

Related docs: [`features/game-mode-matpower.md`](../features/game-mode-matpower.md)
(pipeline + audit summary + repair spec),
[`grid-layout-coordinate-scale.md`](grid-layout-coordinate-scale.md)
(coordinate-frame invariants).
