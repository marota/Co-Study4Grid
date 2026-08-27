# Game Mode: France RTE Matpower — offline dataset pipeline

Offline pipeline that turns the public **MATPOWER RTE cases** (`case6468rte`,
`case6470rte`, `case6495rte`, `case6515rte` — real 2013 French EHV operating
points, ~6500 buses, © Josz/Fliscounakis/Maeght/Panciatici, CC-BY-4.0) into a
Game Mode scenario family alongside
[`game-mode-rte7000-tht.md`](game-mode-rte7000-tht.md).

> **Status: complete chain.** Offline tooling under
> `scripts/game_mode/matpower/`, the packaged scenario database
> (`data/rte_matpower/scenarios.json`), the generated frontend presets and the
> third Game Mode mode are all in place. The database grows as grading
> progresses — see [Grading](#grading).

## Why a node-breaker rebuild is needed

MATPOWER cases import as **BUS_BREAKER with zero switches**, so the expert
recommender has no topological levers (no coupler opening, no node splitting) —
only redispatch and load shedding. On these heavily loaded states that grades
almost everything *hard* and gives players nothing to manoeuvre.

`node_breaker.rebuild_node_breaker` rebuilds the same electrical network as
**NODE_BREAKER**: every voltage level gets busbar sections and every feeder a bay
(breaker + disconnectors), and multi-feeder VLs get a **closed coupler named
`*_COUPL.*`** — the name the recommender keys on — so opening it splits the node
into an `open_coupling` action.

Two invariants make the rebuild faithful; both were regressions found the hard way:

- **Each substation keeps its loaded electrical node count.** The import leaves
  **208 VLs holding more than one bus** (up to 9). Collapsing them onto a single
  busbar rewires the grid — ~610 MW of extra losses, 26° angle shifts, 3 GW flow
  errors, base peak 324 % vs 199 %. Each source bus therefore gets its own
  busbar, and couplers between genuinely distinct nodes are created **open**.
- **Out-of-service elements stay out.** ~700 of 1389 generators carry MATPOWER
  `STATUS = 0`; pypowsybl's bay helpers create every feeder connected, and the
  phantom generation alone stops the load flow converging.

Also copied, because each is individually required for convergence or fidelity:
shunt compensators, phase tap changers, generator reactive limits, the slack
terminal, and the solved (VM, VA) warm start (these cases are stiff and only
converge from their own operating point).

Result on `case6515rte`: **6515/6515 buses, base peak 199.2 % / 10 overloads —
identical to the bus-branch source**, converged, 1591 coupler breakers
(266 open / 1325 closed).

## Positioning on a France map

The cases are anonymised (integer buses, no names, no coordinates). `geo.py`
recovers a France layout by matching each case's 400 kV postes to a **named**
THT reference snapshot (the committed `grid_5384e039`, whose VL ids are real RTE
names) through the `grid_snapshot_reconstruct` Rosetta electrical-distance
percolation, then chaining matched substations to `grid_layout_rte.json`.

This yields a genuine **identity** mapping for **520 of 6515 buses → 125 real RTE
substations** (all at 380 kV — Rosetta only matches the 400 kV backbone),
persisted as `rte_substation_map.json`. Everything below 380 kV is placed at
plausible real 225 kV positions or propagated along the graph: **positional
only, no identity claimed**.

Where a bus *is* identified, `geo.reference_vl_structure()` supplies that
substation's **real RTE busbar count**, which the rebuild replicates — 430 VLs on
`case6515rte`, giving real 4-, 6- and 9-busbar substations instead of a uniform
double busbar.

### Checked against the RTE7000 THT reference

The named snapshot the cases were matched against (`grid_5384e039`) is the ground
truth for both the coordinate frame and the real substation structure, so the two
datasets are compared directly (`test_repair_layout.py` pins the results):

**Coordinate frame — identical.** Median translation between the frames is
0.26 km and the median pairwise-distance ratio is 0.9998, so both layouts are the
same raw Mercator metres with no offset, scale or rotation to reconcile. Extents:
THT 1 027 k × 1 056 k units, Matpower 955 k × 994 k — the Matpower set is slightly
smaller because it reaches 61 % of the THT 400 kV postes, not all of them.

**Voltage levels — the reason the map needed a threshold.** THT is EHV-only;
73 % of the Matpower voltage levels have no counterpart in it at all:

| kV | RTE7000 THT | Matpower |
|---|---|---|
| 380 | 302 | 456 |
| 225 | 1 081 | 1 236 |
| 150 / 90 / 63 / 45 | 0 | 67 / 1 100 / 3 048 / 64 |
| ≤ 24 (auxiliary) | 41 | 278 |
| **total** | **1 424** | **6 249** |

**Identity positions.** All 449 identities resolvable in the THT layout are
380 kV, every claimed poste really has a 380 kV level (0 voltage mismatches),
and as reconstructed each sits 1.9 km (median, max 5.9 km) from it — the
deliberate jitter that stops a substation's several voltage levels drawing on
top of each other. The repair keeps every **kept** identity unchanged to the
metre, `strict` matches included.

**Structure — the over-assignment, confirmed against ground truth.** A real THT
poste has at most 6 voltage levels at 400 kV (mean 1.5). The Matpower mapping
claims up to **52**:

| poste | Matpower 380 kV VLs | THT 380 kV VLs | region |
|---|---|---|---|
| SCHEE | 52 | 1 | Alsace / eastern border |
| MARSI | 34 | 1 | Béarn / Spain border |
| GRAV5 | 17 | 1 | Nord coast |
| E.HU7 | 16 | 1 | German border |
| CATG2 | 14 | 1 | Moselle |

No claimed name is bogus (only `MUHLB`, 3 loose claims, matches no THT poste;
`'CERN '` / `'CBRY '` carry a trailing space that used to break the lookup) —
the fault is multiplicity: the percolation uses a few hub names as sinks, 14
piled postes hold 226 of the 452 identities, and the piles sit exactly in the
regions the operator flagged. Pile members mutually vouch for each other, which
is why no per-node geometric rule can see them: *clean support* — support from
a neighbour whose own poste is not over-claimed — collapses at every pile
(SCHEE 1/52, MARSI 0/34, TRANS 0/12) while staying high everywhere else.

**Coverage holes are the other half.** 77 of the 201 THT 400 kV postes have no
identity at all, concentrated in the same regions: the whole Paris inner ring
(TERRI, SAUS5, PENC5, YVE.O, VLEJU, VLEVA, REMIS, N.SE2, BOCTO, CBRY — zero
identities), 21 postes of the Nord chain, the Loire nuclear corridor
(Chinon/Dampierre/Belleville/Saint-Laurent), and Cordemais + Blayais in the
west. Wherever a strict anchor exists the geometry is right; the artifacts live
where anchors are missing or piled. Filling these holes needs upstream
re-percolation — a layout pass cannot invent identities (a conservative 1-hop
derivation recovers ~2 per grid at leave-one-out precision 0.90, e.g. the
Cordemais hub).

**The 225 kV layer was stacked, not misplaced.** The propagated 225 kV
positions are individually plausible (median 2.5 km from a real THT 225 kV
site) but degenerate: ~750 nodes crowd ~277 real sites while most of the real
1 081-site web has no node at all — site coverage p50 was 14.4 km, *worse than
a uniform random scatter* (9.7 km). That is exactly "I don't recognize the
grid": the real regional webs (Brittany, Pays de la Loire, the south-east) sat
empty while Normandy held 3.3× its real node count.

### Layout repair (`repair_layout.py`)

Three stages, all against the THT ground truth (`tht_reference.py`):

1. **Identity vetting** (`identity_vetting.py`). Every claim is scored on the
   THT *poste graph*: a claim `v → P` is supported by an identified neighbour
   `u → Q` only when P and Q are electrical neighbours (or close) in THT.
   Loose claims are released when their poste is absent from THT, their
   neighbours contradict them, or their poste exceeds its plausibility cap
   `ceil(1.5·n380) + n_generator_units` (1.5 = the 456/302 node-split ratio;
   MATPOWER gives each generator unit its own leaf bus, so plant postes like
   Gravelines legitimately hold more). `strict` claims are **never** released.
   ~220 of 452 claims are released per grid; released ex-identities keep only
   a near-zero locality weight, so the graph re-places them.
2. **225 kV placement.** Voltage levels hanging by a 400/225 transformer off a
   kept identity are pinned at that poste's real THT 225 kV position (~82 per
   grid — a transformer lives inside one substation). The remaining free
   225 kV nodes are de-stacked by a capacity-limited minimum-cost assignment
   onto the real THT 225 kV sites (one node per site), iterated with the
   relaxation on a growing radius (35 → 60 → 90 km) so over-dense regions can
   export their surplus to the real-but-empty sites further out (~1 013 of
   1 155 assigned).
3. **Per-class anchored Laplacian relaxation**, solved exactly as one sparse
   SPD system per axis: kept identities + 225 kV pins fixed; released
   ex-identities at λ=0.05; snapped 225 kV nodes pulled to their site at λ=4;
   everything else keeps λ=1 toward the raw reconstruction.

Shipped results on `grid_6be3a179` (raw → v3; the v1 plain relaxation in
between is kept for context):

| metric | raw | v1 | v3 |
|---|---|---|---|
| branches > 100 km | 265 | 78 | **68** |
| branches > 200 km | 53 | 10 | **2** |
| neighbour-offset > 100 km | 51 | 4 | **2** |
| 225 kV site-coverage p50 | 14.4 km | 13.0 km | **4.4 km** |
| 225 kV sites covered ≤ 10 km | 40 % | 34 % | **88 %** |
| 225 kV node → nearest-site p50 | 2.5 km* | 7.0 km | 4.7 km |

\* the raw 2.5 km is an artifact of the stacking — many nodes on few correct
sites. The v1 relaxation traded it for backbone collapse (7.0 km, coverage
DOWN); v3 restores both directions at once. Neighbour-offset p90 lands at
~18 km against the THT reference's own 15.0 km — v1's 12.2 km was *smoother
than reality*, which is precisely the collapse the operator saw.

The 14–18 branches per case that still exceed 100 km between two kept postes
are reported (`--report-suspect-anchors`), not hidden: both ends are pinned to
a position upstream is confident about, so they are `grid_snapshot_reconstruct`
matching issues. So are the remaining artifacts: the Paris-ring hole, the
foreign border-equivalent appendices (the 150 kV Pyrenees/Belgium and 45 kV
Geneva/Jura components, and the German/Swiss cluster at the eastern edge —
France operates neither 150 kV nor 45 kV transmission), and the ~68 stale
bus entries in `rte_substation_map.json`. `rte_substation_map.json` is never
rewritten — only the drawing moves.

The repair is anchored on the layout it reads, so re-running it on its own
output would drift. Each grid carries a `layout_repair.json` provenance record
(algorithm, per-class λ, release reasons, derived anchors, pin/snap counts,
final statistics) and is skipped when its `grid_layout.json` still hashes to
it; `test_repair_layout.py` fails if that record goes stale and holds the
committed layouts to the table above.

The durable fix for what the repair only mitigates (identity piles, the
Paris-ring / Nord coverage holes, the stacked 225 kV placement, foreign
border equivalents) belongs upstream in `Grid_snapshot_reconstruct` — the
complete brief, interface contract and acceptance criteria live in
[`docs/data/matpower-upstream-handoff.md`](../data/matpower-upstream-handoff.md).

## Modules

| Module | Role |
|---|---|
| `current_limits.py` | APPARENT_POWER (MVA) → CURRENT (A) permanent limits; without them a matpower network reports zero loadings |
| `geo.py` | Rosetta identity match + France layout + real RTE busbar structure |
| `node_breaker.py` | The NODE_BREAKER rebuild, fidelity copies and BusView validation |
| `actions.py` | Curated action space — `open_coupler_*` in the Co-Study4Grid schema |
| `build_network.py` | Stage 1 per case, resumable, into an opaque `grid_<sha1[:8]>` folder |
| `grade.py` | Stage 2 — difficulty grading (easy / medium / hard), resumable |
| `build_scenarios.py` | Stage 3 — fold every `graded.jsonl` into `scenarios.json` |
| `gen_matpower_presets.py` | Stage 4 — emit the frontend presets from that database |
| `repair_layout.py` | Layout repair — identity vetting + 225 kV placement + per-class relaxation (see above); idempotent, run on the raw layouts after any rebuild |
| `tht_reference.py` | THT ground truth: poste inventory (substation nesting), poste graph, 225 kV site list, generator counts |
| `identity_vetting.py` | Claim scoring against the THT poste graph, plausibility caps, release policy, conservative 1-hop derivation |

```bash
python scripts/game_mode/matpower/build_network.py all           # ~225 s per case
python scripts/game_mode/matpower/grade.py all                   # ~14 s per contingency
python scripts/game_mode/matpower/repair_layout.py               # -> repaired grid_layout.json + layout_repair.json
python scripts/game_mode/matpower/build_scenarios.py             # -> data/rte_matpower/scenarios.json
python scripts/game_mode/matpower/gen_matpower_presets.py        # -> frontend/src/game/matpower*
python scripts/game_mode/gen_network_previews.py                 # -> public/game/preview-matpower.svg
python scripts/game_mode/pack_grids.py data/rte_matpower         # network.xiidm -> .gz.b64 for commit
```

Stages 3 and 4 are cheap and idempotent: re-run them any time grading advances.
Scenario ids are derived from `(gridId, contingency)`, so a rebuild keeps the
ids stable and does not orphan recorded sessions or retained solutions.

## Transport and packaging

The 4 networks are ~20 MB of XIIDM each — too large to commit raw, and a binary
`.zip` would need Git-LFS (whose object endpoint is blocked in some CI egress
policies). They ship as `network.xiidm.gz.b64` (gzip + base64, **8.7×**: 20.5 MB
→ 2.4 MB), exactly like the THT family. `pack_grids.py` encodes,
`decode_tht_grids.py` decodes both families (it is what the Dockerfile calls),
and the decoded `network.xiidm` is gitignored as the build artifact it is.

Dates are hidden exactly as in the THT family: opaque grid folders, and titles
carrying only month + weekday + hour-period. `mapping_private.json` and
`rte_substation_map.json` keep the real identity recoverable for analysis and are
never surfaced to players.

## Grading

Difficulty mirrors the THT rule at `monitoring_factor = 0.95`: **easy** if a
suggested unitary action resolves every contingency-attributable overload,
**medium** if a first-identified superposition pair does, **hard** otherwise.
Resolution is base-relative — pre-existing overloads the contingency does not
worsen are not counted.

> **The grader must reset the recommender before every contingency.**
> `run_analysis_step2` mutates network state, so grading in a plain loop
> silently poisons every subsequent contingency. `configure()` is therefore
> re-run per contingency (`grade_all(..., reset_each=True)`, the default).

That is measured, not defensive: on `grid_6be3a179` (`case6515rte`), grading the
same 12 contingencies both ways gives **9 divergent verdicts**. The first three
agree, then every remaining case collapses to `trivial` with zero overloads —
and the error is silent in the worst direction, since a real `hard` scenario
disappears from the database as "nothing to solve" rather than failing loudly.
Reloading the 20 MB network per contingency costs ~4× (2.4 s → 10.6 s on that
grid; ~14 s/contingency across the family). `--no-reset` exists for raw timing
only and is documented as producing wrong verdicts.

The four cases together yield **901 non-antenna constraining contingencies**
(165 / 270 / 265 / 201 for case6468 / 6515 / 6495 / 6470), out of ~7420 tested
each — about 3.5 h of grading, resumable via `graded.jsonl`.

An earlier note in this file predicted a hard-skewed distribution (~86 %
medium/hard). That measurement came from the poisoned loop; with the reset the
early distribution is far more balanced (~24 % easy / ~68 % medium / ~8 % hard
over the first 38 graded), which is what makes three playable tiers viable.

## The third Game Mode

`GameConfigScreen` carries one set of branches parameterised by graded family
(`GRADED` in that module) rather than one branch per family, so France THT and
France EHV share the level picker, case count, summary and preview. `data-testid`s
are derived from the family key (`game-mode-matpower`, `game-matpower-count`, …),
which keeps the THT ids — and the tests that assert them — unchanged.

The seeded sampler is shared too: `frontend/src/game/sampleScenarios.ts`, used by
both generated preset modules instead of being emitted twice.

The config-screen map is drawn at **225 kV and above** (`min_kv` in
`gen_network_previews.py`), which is exactly the two-layer backbone the France
THT map shows — 1 692 nodes / 2 600 lines against THT's 1 464 / 2 499, so the two
modes are visually comparable. These cases are full 6 500-bus models that also
carry the whole 63 / 90 / 150 kV sub-transmission layer: 4 400 of their 6 250
voltage levels and half their branches, drawn flat green by the map's
`< 350 kV` rule. Including it produced a hairball that said nothing about the
grid a player works on, and it is the least trustworthy part of the dataset
(propagated positions, no identity). Every other family here already contains
only its EHV levels, hence their threshold of 0.
