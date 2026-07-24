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

```bash
python scripts/game_mode/matpower/build_network.py all           # ~225 s per case
python scripts/game_mode/matpower/grade.py all                   # ~14 s per contingency
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
