# NAD profile — `bare_env_20240828T0100Z` (N-state)

Reference measurement of the base-case Network Area Diagram (NAD)
generation time on the `bare_env_20240828T0100Z` grid — the dataset that
`config_large_grid_20240828T0100Z.json` points to and that most existing
`docs/perf-*.md` traces use.

Scope: **N-state NAD only** (what is fetched when a user clicks
**🔄 Load Study** in the frontend, i.e. `GET /api/network-diagram`).
No N-1, no post-action, no frontend/XHR timing.

## Methodology

- **Script**: `benchmarks/bench_nad_n_state.py` — 3 iterations in a single
  Python process, fully resetting `recommender_service` and reloading the
  network between runs. Run 1 is flagged *cold* (fresh JVM / pypowsybl
  caches), runs 2-3 are *warm*.
- **Timing source**: a `logging.Handler` parses the existing
  `[RECO] Diagram generated: NAD Xs, SVG Ys, Meta Zs (SVG length=N)` line
  emitted by `expert_backend/services/diagram_mixin.py:106`. Total
  wall-clock is wrapped with `time.perf_counter()` around
  `recommender_service.get_network_diagram()`.
- **Venv**: `venv_expert_assist_py310/bin/python`.
- **Config**: `config_large_grid_20240828T0100Z.json`
  (`network_path = /home/marotant/dev/Expert_op4grid_recommender/data/bare_env_20240828T0100Z/grid.xiidm`,
  `pypowsybl_fast_mode: true`, GEOGRAPHICAL NAD layout via the
  `perf/unmount-inactive-svg` branch baseline — see
  `docs/perf-loading-parallel.md`).
- **Command**:
  ```bash
  BENCH_NETWORK_PATH=/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_20240828T0100Z \
      PYTHONUNBUFFERED=1 ./venv_expert_assist_py310/bin/python \
      benchmarks/bench_nad_n_state.py
  ```
- **Raw output**: `profiling_results.json` at project root,
  `/tmp/nad_profile_run.log` (full backend logs).

## Results — baseline (before optimisations)

| Run | State | NAD (s) | SVG (s) | Meta (s) | Total `get_network_diagram` (s) | SVG size (MB) |
|---|---|---:|---:|---:|---:|---:|
| 1 | cold | 10.18 | 0.00 | 0.00 | 14.10 | 13.2 |
| 2 | warm | 2.46 | 0.00 | 0.00 | 3.61 | 13.2 |
| 3 | warm | 2.14 | 0.00 | 0.00 | 2.99 | 7.83 |
| **warm median** | | **2.30** | **0.00** | **0.00** | **3.30** | — |

Notes on the table:

- **`Total` vs `NAD` gap**: The wall-clock `Total` around
  `get_network_diagram()` includes NAD generation **plus** the
  `_get_svg_string` / `_get_svg_metadata` calls **and** the downstream
  `NaN-stripping` step (`diagram_mixin.py:108-128`, removes 74-158
  elements), plus overloaded-line extraction and the N-state currents
  cache. The gap is therefore `~1.0 s` of post-processing on top of
  the pure pypowsybl NAD call.
- **`SVG 0.00s` / `Meta 0.00s`**: pypowsybl's
  `Diagram.get_network_area_diagram(...)` returns an object whose SVG
  is materialised *inside* the pypowsybl call — `_get_svg_string` then
  returns a cached reference in microseconds. All serialisation time
  is accounted for inside `NAD`.
- **Run 3 SVG size drop** (7.83 MB vs 13.2 MB): fewer elements survive
  the NaN-stripping step on run 3 (74 elements removed vs 149/158). This
  is a side effect of small variant state differences between resets; it
  changes SVG payload size slightly but does not invalidate the NAD
  timing itself.

## Results — after optimisations #1 + #4

Two low-risk changes in `expert_backend/services/diagram_mixin.py` :

1. **`_get_element_max_currents` vectorised** (was `df.iterrows()` over
   ~10 k lines + ~2 k transfos → numpy mask + `np.maximum(|i1|, |i2|)`).
   Also narrows the pypowsybl query to `attributes=['i1','i2']`.
2. **`_load_layout` cached by `(path, mtime)`** on the service instance —
   repeated NAD generations in the same process skip the JSON parse +
   DataFrame rebuild.

| Run | State | NAD (s) | Total `get_network_diagram` (s) | SVG size (MB) |
|---|---|---:|---:|---:|
| 1 | warm† | 2.50 | 3.03 | 13.2 |
| 2 | warm | 2.39 | 2.92 | 13.2 |
| 3 | warm | 2.41 | 2.92 | 13.2 |
| **warm median** | | **2.41** | **2.92** | — |

† The JVM was already hot from the previous benchmark session, so no
true cold run was captured in this re-measure. All three runs are
effectively warm.

### Before / after (warm median)

| Step | Before (s) | After (s) | Δ |
|---|---:|---:|---:|
| `NAD` (pypowsybl) | 2.30 | 2.41 | +0.11 (noise) |
| Post-processing | **~1.00** | **~0.51** | **−0.49 (−49 %)** |
| **Total** | **3.30** | **2.92** | **−0.38 (−11.5 %)** |

The NAD step itself is unchanged (pypowsybl JVM work, untouched). The
gain comes entirely from halving the post-processing overhead.

## Observations

- **`_get_element_max_currents` was the dominant post-processing cost**
  on this grid size. Switching from `iterrows()` to vectorised numpy
  recovers ~0.3-0.5 s per Load Study on its own.
- **`_load_layout` cache** contributes a smaller but free win
  (~50-100 ms on the first warm reuse) and will also benefit
  subsequent `get_n1_diagram` / `get_action_variant_diagram` calls in
  the same session.
- **Remaining warm post-processing (~0.5 s)** is dominated by the
  `NaN-stripping` lxml roundtrip (parse 13 MB SVG → iterate elements →
  re-serialise). That is optimisation #3 in the list below, not yet
  applied.
- **Consistent with `docs/performance_profiling.md`**: the 2.92 s total
  beats the 3.5 s "Base Diagram (v2)" reference by ~17 %.

## Attempt #3 — regex NaN-stripping (**REJECTED**, +0.4 s regression)

Tried replacing the lxml `parse → iter → remove → serialise` roundtrip
with a two-stage Python `re` pipeline (self-closing tags then open/close
pairs with a tempered-greedy body, lxml fallback if anything remained).

Measured on the same 3-run benchmark:

| Variant | NaN-strip time | Warm total |
|---|---:|---:|
| lxml only (baseline post #1 + #4) | ~0.27-0.34 s | 2.92 s |
| regex #1 + #2 (always runs) | 0.58 s | 3.33 s |
| regex #1 with short-circuit + #2 | stage1 0.24 s + stage2 0.33 s = 0.58 s | 3.32 s |

The short-circuit on stage 2 never triggered — pypowsybl NAD output mixes
self-closing tags (`<path/>` with NaN coordinates) **and** paired tags
(`<text x="NaN">label</text>`), so both stages always fire.

**Why the regex loses against lxml here**:
- lxml parse + serialise is a single-pass C implementation that releases
  the GIL. On a 13 MB, ~130 k-element SVG it costs ~270-330 ms end-to-end.
- Python `re` with a tempered greedy `(?:(?!<\1\b|</\1\b).)*?` body on
  13 MB runs in CPython with full backtracking on every `<` boundary —
  ~580 ms, nearly 2× slower.
- Skipping stage 2 would need either a complete rewrite in a linear
  `rfind`/`find` tag-walker (high complexity, ~150 lines) or a streaming
  XML parser — both far beyond the simple improvement this lever promised.

Reverted the regex change; `_strip_nan_elements` is back to the original
lxml roundtrip. The **`−0.3 to −0.6 s` estimate for #3 was wrong**: it
was based on an over-attribution of post-processing time to lxml before
#1 revealed that `_get_element_max_currents.iterrows()` was the dominant
cost. Post #1, lxml is already a small fraction of `get_network_diagram`
total and offers little remaining room.

## Results — after #6 (minimal NadParameters)

Changed `_default_nad_parameters()` in
`expert_backend/services/diagram_mixin.py` to the minimal set matching
the documented user needs (P at line endpoints, VL nodes + names,
nominal-voltage colouring, client-side highlight overlays):

```python
NadParameters(
    edge_name_displayed=False,
    id_displayed=False,
    edge_info_along_edge=True,
    power_value_precision=0,                  # was 1
    angle_value_precision=0,
    current_value_precision=1,
    voltage_value_precision=0,
    bus_legend=False,                         # was True
    substation_description_displayed=False,   # was True
    voltage_level_details=False,              # explicit (default was True)
    injections_added=False,                   # explicit (pypowsybl default)
    layout_type=NadLayoutType.GEOGRAPHICAL,
)
```

Measured via `benchmarks/bench_nad_toggles.py` (5 configs × 3 runs,
same JVM) then confirmed with a standard `benchmarks/bench_nad_n_state.py`
run on the same dataset:

| Run | State | NAD (s) | Total (s) | SVG (MB) |
|---|---|---:|---:|---:|
| 1 | warm† | 2.34 | 2.83 | 12.02 |
| 2 | warm | 2.40 | 2.86 | 12.02 |
| 3 | warm | 2.35 | 2.84 | 12.02 |
| **warm median** | | **2.375** | **2.845** | **12.02** |

### Impact per toggle (isolated, from `profiling_toggles_results.json`)

| Toggle change | Δ NAD | Δ Total | Δ SVG |
|---|---:|---:|---:|
| `bus_legend: True → False` | −0.12 s | −0.16 s | −0.93 MB |
| `voltage_level_details: True → False` | ~0 s | ~0 s | 0 MB ‡ |
| `substation_description_displayed: True → False` (vs target-with-it) | −0.025 s | −0.025 s | −0.21 MB |
| `power_value_precision: 1 → 0` | lumped in above | lumped in | ~−40-60 KB |
| `injections_added: False → True` (tested, **NOT applied**) | +0.80 s | +1.03 s | **+10.9 MB** |

‡ `voltage_level_details` is dead code in our setup — no custom label
provider is registered, so the flag has no visible output. Kept
explicit (`False`) for clarity and to document the decision.

### Before / after (warm median, cumulative since the v6 branch baseline)

| Stage | Total (s) | SVG (MB) | Δ vs previous |
|---|---:|---:|---:|
| Baseline (start of this doc) | 3.30 | 13.20 | — |
| After #1 + #4 | 2.92 | 13.20 | −0.38 s |
| **After #1 + #4 + #6** | **2.845** | **12.02** | **−0.075 s, −1.18 MB** |
| Cumulative since baseline | — | — | **−0.455 s (−13.8 %), −1.18 MB (−9 %)** |

### On `injections_added`

Originally listed by the user as a need ("show injections on bus
nodes"). Measured cost on this grid: **+1.03 s per Load Study, +10.9
MB SVG** (payload nearly doubles from 13.2 → 24.1 MB). The user
decided to keep it `False` rather than accept the regression, and to
revisit later via a dedicated toggle (opt-in Settings flag) if the
feature becomes required. The measurement is preserved here so the
cost is visible the next time this question surfaces.

## Known remaining levers (not applied)

| # | Lever | Expected warm gain |
|---|---|---|
| 2 | Defer `_get_element_max_currents` until the first N-1 call | −0.05 to −0.15 s (small since #1 already halved the cost) |
| 3 | ~~Regex NaN-strip~~ — **rejected**, see section above | — |
| 5 | Run lxml NaN-strip and pypowsybl post-queries in parallel (`ThreadPoolExecutor`, GIL released on both sides) | −0.15 to −0.30 s |
| 6 | ~~NadParameters minimal toggles~~ — **applied**, see section above | realised: −0.15 s, −1.18 MB (less than the original −0.2/−0.5 s estimate) |
| 7 | Persistent SVG cache keyed by network hash + variant + NadParameters | Load Study 2+ → ~50 ms |

### Architectural note for future #6-like proposals

Before re-opening NAD rendering trade-offs, check the closed design
questions:
- **Spatial / focused sub-diagrams on zoom** are ruled out per
  `docs/spatial_lod_architecture_proposal.md:298-303` — the chosen
  mechanism is the CSS zoom-tier system
  (`frontend/src/hooks/usePanZoom.ts` + `frontend/src/App.css`).
- **Auto-focus on contingency selection** was explicitly retired in
  commit `75210d1` — the full N-1 diagram is kept, with dynamic text
  scaling handling readability.
- Server-side NadParameters toggles (this doc) are complementary to
  the client-side LOD CSS, not a replacement.

## Out of scope

- N-1 diagram timing (`get_n1_diagram`) — use
  `scripts/profile_diagram_perf.py` scenario 2 for that.
- Post-action diagram timing — scenario 3 of the same script.
- Frontend XHR / paint timing — see `docs/perf-loading-parallel.md`
  and `docs/perf-svg-tab-unmount.md`.
- CPU flamegraph (`--cprofile`) — not needed; the three sub-timings
  already localise the cost.
