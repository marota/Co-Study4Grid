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

**Identity positions — every anchored one is where its poste is.** All 449
identities resolvable in the THT layout are 380 kV, every claimed poste really has
a 380 kV level (0 voltage mismatches), and as reconstructed each sits 1.9 km
(median, max 5.9 km) from it — the deliberate jitter that stops a substation's
several voltage levels drawing on top of each other. After the repair the
**anchored** ones are unchanged to the metre (p50 1.92, max 5.86 km), `strict`
matches included. The 55 released ones move a median of 50 km (max 241 km) away
from the poste they name — that is the price of the repair, and it is why only
`loose`, topology-contradicted matches are eligible.

**Structure — the over-assignment, confirmed against ground truth.** A real THT
poste has at most 6 voltage levels at 400 kV (mean 1.5). The Matpower mapping
claims up to **52**:

| poste | Matpower 380 kV VLs | THT 380 kV VLs |
|---|---|---|
| SCHEE | 52 | 1 |
| MARSI | 34 | 1 |
| GRAV5 | 17 | 1 |
| E.HU7 | 16 | 1 |
| CATG2 | 14 | 1 |

No claimed name is bogus — all 122 are genuine THT 400 kV postes — so the fault is
purely multiplicity: 31 postes over-claim by 3 or more and hold 296 of the 452
identities. Reassuringly, the release rule below never consults this table and
still lands on the same places: **37 of the 55 released identities (67 %) sit at
one of those 31 over-assigned postes.** The other 259 excess identities stay
anchored — their position agrees with their own neighbourhood, so the drawing is
consistent even where the name is over-claimed, and there is nothing to gain by
moving them.

### Layout repair (`repair_layout.py`)

The propagated positions — everything that is not an identified 380 kV poste —
shipped with a tail of geographically impossible placements, which is what drew
lines across the whole map. Measured against the France THT snapshot, whose map
reads as neat, by how far each VL sits from the median of its own electrical
neighbours:

| | p50 | p90 | p99 | max |
|---|---|---|---|---|
| France THT (reference) | 5.4 km | 15.0 km | 30.0 km | 45.1 km |
| Matpower, as reconstructed | 2.8 km | 22.3 km | 91.5 km | 285.4 km |
| Matpower, after repair | 2.5 km | **12.2 km** | 37.8 km | 150.5 km |

`repair_layout.py` re-places the free voltage levels by an **anchored Laplacian
relaxation** — minimise total squared branch length plus a locality term that
keeps each VL near where the reconstruction put it, with the identified postes
held fixed — solved exactly as one sparse system. On `grid_6be3a179` that takes
branches longer than 100 km from **265 to 78** and those over 200 km from **53
to 10**, while the median VL moves only 3.8 km, so the geography survives.

Some anchors are themselves the problem: `SCHEE` claims **52** 380 kV voltage
levels on that case (`MARSI` 34, `GRAV5` 17), where real French 400 kV postes
have 4, 6 or 9 nodes — the Rosetta percolation uses a few hub names as a sink,
and pinning dozens of unrelated buses on one point is what draws 400 km "400 kV
lines" between two supposedly identified postes. An identity is therefore
released when it is `loose` **and** contradicted by its own electrical
neighbourhood by more than 45 km (the THT maximum), re-checked each round
because moving one poste changes what its neighbours imply. That releases 55 of
452 on `grid_6be3a179`; every `strict` match keeps its position, and
`rte_substation_map.json` is not rewritten — only the drawing moves.

The 18–23 branches per case that still exceed 100 km between two anchored postes
are left alone and reported (`--report-suspect-anchors`): both ends are pinned to
a position upstream is confident about, so they are a `grid_snapshot_reconstruct`
matching issue to fix there, not something a layout pass should paper over.

The repair is anchored on the layout it reads, so re-running it on its own output
would drift. Each grid therefore carries a `layout_repair.json` provenance record
and is skipped when its `grid_layout.json` still hashes to it;
`test_repair_layout.py` fails if that record goes stale and holds the committed
layouts to the table above.

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
| `repair_layout.py` | Layout repair — anchored relaxation of the propagated positions (see above); idempotent, run after any rebuild |

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
