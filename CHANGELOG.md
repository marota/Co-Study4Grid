# Changelog

All notable changes to **Co-Study4Grid** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project (informally) follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **Settings modal now updates every path/parameter when a new config
  file is loaded.** Switching the config-file path (typing then
  clicking Apply, or clicking Apply right after typing without
  blurring the input) used to silently send the *previous* config to
  `/api/config`. The auto-save effect then persisted those stale
  values back into the freshly-loaded config file, undoing the
  operator's selection — the modal looked unchanged on reopen.

  Root cause: `applySettingsImmediate` and `handleLoadConfig` called
  `await changeConfigFilePath(...)` followed by
  `buildConfigRequest()`. The first call queues React state updates
  via `applyLoadedConfig`, but those don't flush until the next
  render — so `buildConfigRequest`, a `useCallback` over the
  pre-update closures, replayed the previous render's values.

  Fix: `changeConfigFilePath` now returns the resolved `UserConfig`,
  and a new `configRequestFromUserConfig` helper derives the request
  shape directly from it. Both call sites in `App.tsx` use the
  fresh value when a config switch just happened. Regression test
  in `frontend/src/App.configUpload.test.tsx`.



- **PyPSA-EUR grid layouts now use raw Mercator metres**
  (`scripts/pypsa_eur/regenerate_grid_layout.py`). The default output
  was rescaling every coordinate to a 8 000-unit target width, which
  forced the median nearest-neighbour distance down to ≈ 0.95 ×
  pypowsybl's fixed VL-circle radius (`r = 27.5` user-units). On
  dense regions like Paris, every voltage-level circle therefore
  overlapped its neighbours by definition, regardless of any
  client-side shrinking.

  Side-by-side comparison with the operator reference layout (RTE
  study format, `*.json` checked into ops studies) showed the
  operator file uses raw projected metres with a span of
  ~1.6 M units — neighbours land ~65 × `r` apart, which is the
  geometry pypowsybl assumes when sizing its glyphs. The PyPSA-EUR
  bundles regenerated under the new default land at ~166 × `r`
  (sparser since they only carry transmission-level VLs), well
  inside the operator-clean reading range.

  - Default behaviour: write raw Mercator metres, span ≈ 1.4 M for
    the French grid.
  - Pass `--target-width N` to reproduce the legacy rescaled output;
    a warning fires for any value below 500 000 since that is the
    boundary below which VL circles start touching.
  - `data/pypsa_eur_fr225_400/grid_layout.json` and
    `data/pypsa_eur_fr400/grid_layout.json` regenerated. Old files
    saved as `.bak.8000width` siblings if you need to revert.
  - `scripts/pypsa_eur/test_regenerate_grid_layout.py` updated to
    assert the new Mercator-metres span.

- _Other work in progress — new entries land here before the next
  tagged release._

---

## [0.7.0] — 2026-05-05

Major feature release headlined by the **interactive overflow
analysis tab**, the **PyPSA-EUR European-wide grid pipeline**, and a
full **design-token migration** of the frontend. Sixteen merged PRs
since 0.6.5 plus the inline polish landed on the
``claude/interactive-overflow-analysis`` branch.

### Highlights

- **Interactive overflow analysis tab** (PRs #116, #122–#127). The
  static overflow PDF is replaced by a same-origin HTML viewer
  produced by upstream ``alphaDeesp/core/interactive_html.py``. The
  viewer carries:
  - Layer-toggle sidebar grouped into three sections — *Structural
    Paths* (Constrained path, Red-loop), *Individual entities
    properties* (Overloads, Low-margin lines, Hubs, Reconnectable,
    Non-reconnectable, Swapped flow, **Production nodes**,
    **Consumption nodes**) and *Flow redispatch values* (Positive /
    Negative / Null).
  - Hierarchical ↔ geographic layout toggle backed by a per-study
    cache.
  - Pin overlay synced with the Action Overview filters; single-click
    pins open the same `ActionCardPopover`, double-click drills into
    the SLD overlay.
  - Double-click on a graph node opens the substation SLD overlay
    via the existing `cs4g:overflow-node-double-clicked`
    postMessage.
  - Auto-installer for the graphviz `dot` binary on package install
    (PR #126), so a fresh checkout works without a manual
    ``apt install``.
- **PyPSA-EUR European-wide grid** (PRs #112, #117). Full pipeline
  in ``scripts/pypsa_eur/`` for generating XIIDM grids from PyPSA-EUR
  data, with calibrated thermal limits, an fr225_400 dataset, and
  pytest coverage (``test_build_pipeline.py``,
  ``test_calibrate_thermal_limits.py``,
  ``test_generate_n1_overloads.py``,
  ``test_regenerate_grid_layout.py``).
- **Design-token migration** (PR #120, three phases). New
  ``frontend/src/styles/tokens.{css,ts}`` is the single source of
  truth for colour, spacing, typography and radius. Code-quality
  gate now enforces ``FRONTEND_HEX_LITERAL_MAX = 0`` outside the
  token files.
- **Tiered warning system + diagram legend** (PR #122). Structured
  notice tiers (info / warning / critical) and an in-place legend on
  the Visualization panel; satisfies UI-critique recommendations
  #4–5.
- **Progressive-disclosure ActionCard** (PR #121). Severity icons
  drive a glanceable summary; details collapse / expand on demand.
- **Voltage-level names toggle** (PR #118). New ``🏷 VL`` chip flips
  visibility of pypowsybl's VL labels with `!important` CSS rules,
  with a native `<title>` tooltip fallback so the names stay
  reachable.

### Added

- **Interactive HTML overflow viewer** (PR #116):
  ``services/overflow_overlay.py`` injects the Co-Study4Grid pin /
  popover overlay into the upstream HTML; the React panel hosts the
  iframe via ``hooks/useOverflowIframe.ts`` (extracted from
  ``VisualizationPanel.tsx`` in this release).
- **Production / Consumption node filters** (this branch +
  ExpertOp4Grid 0.3.2.post1). Two new layers ``node:prod`` /
  ``node:load`` driven by the upstream ``prod_or_load`` + ``value``
  attributes ``build_nodes`` writes on every node, with a 1 MW
  absolute-value floor so passive substations (which carry
  ``prod_or_load="load"`` + ``value="0.0"`` by convention) don't
  flood the Consumption layer. Coral / lightblue circle swatches
  match the upstream node fillcolors.
- **Layer interaction logs** (PR #125). Six new event types
  surfaced by the overflow tab — ``overflow_layer_toggled``,
  ``overflow_select_all_layers``, ``overflow_node_double_clicked``,
  ``overflow_pin_clicked``, ``overflow_pin_double_clicked``,
  ``overflow_pins_toggled``, ``overflow_layout_mode_toggled`` — all
  emitted in the canonical replay log.
- **Voltage-level names toggle** (PR #118): per-tab `showVoltageLevelNames`
  state with a native `<title>` tooltip injected by
  ``utils/svg/vlTitles.ts`` so the operator can still read the VL name
  by hovering when labels are off.
- **Tiered notice system + diagram legend** (PR #122): the sidebar
  Notices pill ranks issues by severity; the new ``DiagramLegend``
  component sits inside the visualization panel and is reused by the
  overflow tab.
- **Progressive-disclosure ActionCard** (PR #121): redesigned card
  with severity icon, glanceable summary, on-demand expand for
  topology / load-shed / curtailment details.
- **PyPSA-EUR pipeline** (PR #117): one-command pipeline driving
  ``build_pypsa_eur`` → ``calibrate_thermal_limits`` →
  ``generate_n1_overloads`` → ``regenerate_grid_layout`` for any
  European country / voltage subset.
- **Reconnect actions on the fly** (PR #110): backend auto-creates
  ``reco_*`` actions for every disconnectable line so the operator
  can compose mixed disconnect + reconnect studies without editing
  the action JSON.

### Changed

- **Frontend design tokens** (PRs #120 phases A/B/C). Components,
  modals, hooks and SVG presentation attributes now consume the
  centralised palette. Token files are exempt from the hex-literal
  ceiling; everything else is gated.
- **VisualizationPanel decomposition** (this branch). 1654 → 1342
  lines after extracting ``InspectSearchField``,
  ``DetachedPlaceholder``, and the new ``useOverflowIframe`` hook —
  satisfies the ``FRONTEND_COMPONENT_MAX = 1500`` ceiling.
- **NoticesPanel popover** (PR #123): renders via React portal and
  wraps long unbreakable strings, fixing the sidebar overflow clip.
- **ExpertOp4Grid pin** bumped to ``0.3.2.post1`` (carries the
  Production / Consumption node layers).

### Fixed

- **Halo stacking on the Remedial Action tab** (PR #111). Flow
  delta freshness + halo z-order regressions surfaced after the
  PR #109 hook extraction.
- **f-string cleanup** (PR #113). Removed unnecessary f-string
  prefixes from static strings caught by ruff F541.
- **Target max rho on user-selected overloads** (PR #114). Estimation
  pair filter now matches the simulation contract.
- **Build extras** (PR #127). Restored ``[quality]`` extra under
  ``optional-dependencies`` after the migration to PEP 621.

### CI / tests

- **Parity layers build the standalone first** (this branch). All
  four parity layers (1 + 2 + 3a + 4) now run ``npm run
  build:standalone`` before the audit so they target the freshly
  generated bundle instead of the frozen
  ``standalone_interface_legacy.html``.
- **Gesture-sequence parser recognises ``reactExports.useCallback``**
  (this branch). The vite/rollup-bundled wrapper form is now matched
  the same as the bare ``useCallback`` source form, lifting gesture
  parity to 30/30.
- **Backend tests split** (this branch). The backend job is now two
  lanes: a fast lane (~720 tests, ~15 s, no graphviz) and a
  ``test-backend-graphviz`` lane gated behind both fast jobs.
  ``awalsh128/cache-apt-pkgs-action`` caches the graphviz install,
  saving ~8 minutes of ``apt-get update`` on every run.
- **Test fixture path generalisation** (this branch). The
  ``test_overflow_html_dim_logic.py`` fixture now derives its
  reference HTML path from ``Path(__file__).resolve().parents[2]``
  so the test runs on any checkout, with a ``pytest.skip`` guard
  for fresh checkouts where the graph hasn't been generated yet.

### Documentation

- **docs/features/interactive-overflow-analysis.md**: full
  architecture, attribute-tagging contract, layer-toggle UI, and
  the Production / Consumption filter machinery.
- **docs/features/interaction-logging.md** (PR #125): six new
  overflow-tab event types with replay-contract details.
- **Development-cycle retrospective** (PR #119, three commits):
  consolidated ExpertAssist-era retrospective covering PRs #1–#65,
  reconciliation of 0.5.0 features, and six mermaid diagrams of
  the four-phase development cycle.
- **CLAUDE.md / READMEs refresh** (PR #115).

---

## [0.6.5] — 2026-04-22

Follow-up release to **0.6.0** consolidating the SVG-DOM-recycling
perf work on the N-1 / Action tabs, the Action Overview filtering &
unsimulated-pin layer, the continuous code-quality gate with five
decomposition passes, and the second round of App.tsx hook
extractions (N-1 fetch + highlight pipeline).

### Highlights

- **SVG DOM recycling** (`/api/n1-diagram-patch`,
  `/api/action-variant-diagram-patch`): ~80 % faster N-1 / action
  tab switches on large grids by cloning the already-mounted
  N-state `SVGSVGElement` and patching only the per-branch delta
  instead of re-fetching & re-parsing the full 12–28 MB NAD SVG.
  See `docs/performance/history/svg-dom-recycling.md`.
- **Action Overview filters & unsimulated pins**: severity
  category toggles (green / orange / red / grey), threshold
  slider, action-type chip filter, and a new dimmed/dashed pin
  layer for scored-but-not-yet-simulated actions — double-click
  to simulate. Filter state is shared between the overview and
  the sidebar feed so both views stay in lock-step.
- **Code-quality gate + decomposition sweep**: new continuous
  reporter (`scripts/code_quality_report.py`) and CI gate
  (`scripts/check_code_quality.py`) driving five behaviour-preserving
  decomposition passes — `simulate_manual_action` (599 → 146 LoC),
  `compute_superposition` (285 → 108), `svgUtils.ts` (1807 → 60 +
  8 focused modules), `analysis_mixin.py` (1116 → 509 + 4 modules),
  `diagram_mixin.py` (974 → 469 + 7 modules).

### Added

- **Patch endpoints for diagram recycling** (PR #108):
  `/api/n1-diagram-patch` and `/api/action-variant-diagram-patch`
  return SVG-less per-branch deltas (+ VL-subtree splices for
  topology-changing actions). Frontend `utils/svgPatch.ts` clones
  the N SVG in-place, patches dashed contingency lines, absolute
  flow labels, and concentric rings for coupling / node-merging /
  node-splitting actions. Graceful fallback to the full NAD for
  every unsupported edge case.
- **Action Overview filters** (PR #105, #107): new
  `ActionOverviewFilters` type with category toggles, threshold
  cap, unsimulated visibility flag and action-type chip. New
  `actionPassesOverviewFilter()` predicate + `classifyActionType()` /
  `matchesActionTypeFilter()` module so the overview, the feed and
  the Explore Pairs table share identical filtering logic.
- **Unsimulated action pins** (PR #105): dimmed/dashed pin layer on
  the Action Overview diagram for scored-but-not-yet-simulated
  actions, with hover tooltips showing score + ranking and
  double-click to trigger `simulate_manual_action`.
- **Shared `ActionTypeFilterChips` component** (PR #109): single
  reusable chip row driving the Manual Selection dropdown, the
  Explore Pairs tab, the Action Overview and the Action Feed.
- **Protected constituent pins**: when a combined action passes the
  filter, its constituent unitary pins remain visible (dimmed)
  even if they individually fail the filter — preserving context.
- **Dynamic `reco_` reconnection actions**: `simulate_manual_action`
  now auto-builds reconnection topology (both ends to bus 1) for
  `reco_*` action IDs that aren't in the loaded action dictionary,
  matching the existing `curtail_ / load_shedding_ / pst_` dynamic
  creation path.
- **Continuous code-quality tooling** (PR #104):
  `scripts/code_quality_report.py` (AST scan → JSON + Markdown
  metrics), `scripts/check_code_quality.py` (CI gate on LoC
  ceilings, 0 `print()` / `@ts-ignore` / `any`),
  `.github/workflows/code-quality.yml` + CircleCI job publishing
  the Markdown report to `$GITHUB_STEP_SUMMARY`.
- **Layer-4 invariants** now point at the extracted svgUtils
  modules (`pin_severity_uses_monitoringFactor`,
  `combined_pairs_filter_estimated`,
  `pin_resolver_is_topology_first`).
- **`CONTRIBUTING.md`**, **`.editorconfig`**, **`.env.example`**,
  **`pyproject.toml [tool.ruff]`** (narrow E9 / F ruleset) and
  `quality` extras group.
- **66 + 61 + 68 + 39 new unit tests** across
  `test_simulation_helpers.py`, `utils/svg/*.test.ts`,
  `test_analysis_helpers.py`, `test_diagram_helpers.py`;
  22 + 12 specs for the new svgPatch helpers and 8 new endpoint
  tests for the patch routes.

### Changed

- **App.tsx hook extraction, Phase 2** (PR #109): new
  `hooks/useN1Fetch.ts` (svgPatch fast-path + `/api/n1-diagram`
  fallback + contingency-change confirm routing) and
  `hooks/useDiagramHighlights.ts` (per-tab Flow/Impacts view-mode
  state + `applyHighlightsForTab` DOM-mutation pass). Sidebar
  extracted into `components/AppSidebar.tsx`,
  `components/SidebarSummary.tsx`, `components/StatusToasts.tsx`.
  `App.tsx`: 1575 → ~1150 lines.
- **Backend decomposition** (PR #104, #106):
  - `expert_backend/services/simulation_helpers.py` — 14
    stateless helpers extracted from `simulate_manual_action` +
    `compute_superposition`.
  - `expert_backend/services/analysis/` — `action_enrichment.py`,
    `mw_start_scoring.py`, `analysis_runner.py`, `pdf_watcher.py`.
  - `expert_backend/services/diagram/` — `layout_cache.py`,
    `nad_params.py`, `nad_render.py`, `sld_render.py`,
    `overloads.py`, `flows.py`, `deltas.py`.
  - Public API / method signatures unchanged; `@patch`
    compatibility preserved via dependency injection.
- **Frontend decomposition** (PR #104): `svgUtils.ts` 1807-line
  omnibus split into 8 focused modules under `frontend/src/utils/svg/`
  (`idMap.ts`, `metadataIndex.ts`, `svgBoost.ts`, `fitRect.ts`,
  `deltaVisuals.ts`, `actionPinData.ts`, `highlights.ts`,
  `actionPinRender.ts`) + a 60-line barrel that re-exports
  everything so no caller changed. `App.tsx` (1370 LoC) remains
  the largest non-exempt file by design.
- **Docs reorganised** (PR #103) into
  `docs/{features,performance/{,history/},architecture,proposals,data}/`
  with per-folder README indexes. Three overlapping rendering-LoD
  proposals consolidated into
  `docs/proposals/rendering-lod-strategies.md`. Obsolete
  `test_ui_regressions.py` references cleaned up across the
  backend tests, benchmarks and scripts.
- **CORS origins** now configurable via `CORS_ALLOWED_ORIGINS` env
  var (PR #104); unused `GZipMiddleware` import removed; legacy
  `print()` / `traceback.print_exc()` calls in `main.py` replaced
  with structured logging (`logger.warning` / `logger.exception`);
  one bare `except: pass` now logs the suppressed exception.
- **Frontend deps**: unused `framer-motion` and `lucide-react`
  removed from `package.json`.
- **Action-type filter unification** across Manual Selection,
  Explore Pairs, Action Feed and Action Overview (PR #109 +
  follow-up commits `025f4a0` / `e107057` / `1e53db3`): each
  surface owns its own local chip state, but all consume the
  shared `DEFAULT_ACTION_OVERVIEW_FILTERS` constant and the
  shared `classifyActionType` / `matchesActionTypeFilter`
  helpers.

### Performance

- **Patch-based N-1 diagram switching** (PR #108, benched on
  `bare_env_20240828T0100Z`, ~10 k branches, ~12 MB SVG,
  contingency `ARGIAL71CANTE`, warm median of 3):

  | Endpoint | Cold | Warm | Payload |
  |---|---|---|---|
  | `/api/n1-diagram` (full)      | 3.01 s | 2.39 s | 27.1 MB |
  | `/api/n1-diagram-patch` (new) | 0.49 s | 0.50 s |  5.5 MB |
  | **Δ** | **−83.8 %** | **−79.1 %** | 20.3 % of full |

- **Action tab switching** mirrored on
  `/api/action-variant-diagram-patch` with the same recycled-DOM
  pattern, dashed-class toggling for `disco_*` / `reco_*`, and
  VL-subtree splicing for coupling / node-merging / node-splitting.
- **Quick wins from the decomposition sweep**:
  `network_service.py::get_load_voltage_levels_bulk` was returning
  `{}` without populating the dict (now mirrors
  `get_generator_types_bulk`); 9 f-string placeholders
  auto-fixed via `ruff --fix`.

### Fixed

- **Dynamic reconnection action simulation**: reconnection actions
  generated by `expert_op4grid_recommender` but not in the loaded
  action dictionary (e.g. `reco_CAZARL72MARSI` from the Explore
  Pairs tab) no longer raise `ValueError: Action … not found in
  the loaded action dictionary or recent analysis`. The fix mirrors
  the dynamic-creation path already in place for load-shedding,
  curtailment and PST actions.
- **Line halo on combined `disco + coupling` actions** (PR #108,
  commit `b84732a`): split-on-`+` + per-part coupling check so the
  disco line in `disco_X+coupling_Y` gets its pink halo on both the
  diagram and the action card badge.
- **Blank flash + stale-response guard on svgPatch** (PR #108,
  commit `c48a0da`): the previous cloned DOM stays mounted during
  the patch-fetch window, and late patch responses arriving after
  a newer click are discarded.
- **Node-merging classifier** — "Ouverture … dans le poste" is now
  correctly classified as DISCO, not OPEN coupling (PR #105,
  commit `f356c2e`).
- **Popover viewport detection & combined-action pin protection**
  (PR #105, commit `d277597`): improved popover placement when
  near viewport edges; combined-action pins now protect their
  constituent pins from being hidden by the severity / threshold
  filters.
- **Standalone parity**: versioned snapshot bumped to v0.7 with
  patch-endpoint references (PR #107, commit `adae7ac`);
  `scripts/check_standalone_parity.py` now resolves the standalone
  path intelligently with fallback to versioned snapshots.
- **`ActionFeed` unused-prop lint error**: `onOverviewFiltersChange`
  is no longer destructured when it isn't consumed, removing the
  `@typescript-eslint/no-unused-vars` error.
- **Hidden ordering bug in `get_action_variant_sld`** (PR #104):
  `changed_switches` now captured before flow extraction so mock
  networks with missing flows still return the switch diff; switch
  diff + delta math split into independent `try/except` blocks.
- **Halo layering on N-1 / Remedial Action NADs** (commit `f7a3834`):
  contingency clone is now appended FIRST (bottom), overload halos
  SECOND, action-target halo LAST (top) on the shared
  `#nad-background-layer`. Reverses the post-`action-variant-diagram-patch`
  regression where the yellow contingency halo painted over the
  pink action halo. Code-level guard in
  `frontend/src/utils/svgUtils.test.ts::Halo layering order` +
  hook-level guard in `frontend/src/hooks/useDiagramHighlights.test.ts`.
- **Action Overview filter banner compaction** (commit `f7a3834`):
  filters laid out on a single horizontal row
  (`flex-wrap: nowrap`); the max-loading slider is replaced with a
  compact integer-percent number input (0–300 %, step 1) so the
  whole banner fits on one line.
- **No-relevant-action warning in Manual Selection** (commit `f7a3834`):
  when "Analyze & Suggest" produced action scores but the chosen
  type filter yields zero scored actions, the dropdown now surfaces
  a yellow `Warning: no relevant action detected with regards to
  overflow analysis` banner above the fallback full-action list
  instead of silently misleading the operator.
- **"Make a first guess" gating after analysis** (commit `f7a3834`):
  the pre-analysis shortcut is hidden once "Analyze & Suggest" is
  running, has produced action scores, or any action sits in the
  feed. The button only re-appears after a state reset
  (contingency change, study reload).
- **SLD Impacts persistence on pan / zoom** (commit `f7a3834`,
  follow-up `ec17587`): the SLD delta painter is now a
  `useLayoutEffect` running every render, self-gated via signature
  + DOM-presence probe. Catches the
  `dangerouslySetInnerHTML`-reconciliation wipe that used to strand
  the overlay on Flows rendering until a tab switch, AND eliminates
  the impact/flow blink during continuous drags by running between
  React's commit and the browser paint instead of after.
- **SLD action-variant flow snapshot ordering** (commits `f679646`
  + `e5c89fb`): `get_action_variant_sld` now captures
  `action_flows` / `action_assets` BEFORE switching the shared base
  network to the N-1 variant, then delegates to `_snapshot_n1_state`
  for the N-1 reference — byte-for-byte the same cadence the
  (already-correct) NAD sibling endpoint uses. The previous
  ordering read both snapshots from the N-1 variant after the
  variant flip, producing all-zero deltas with no colouring on
  every cell of the Remedial Action SLD Impacts view (operator-
  reported on `node_merging_PYMONP3` / contingency
  `P.SAOL31RONCI`). Diagnostic logging added so a future stale-flow
  regression in upstream `expert_op4grid_recommender` shows up as
  `max|Δp1|=0.00` in the backend log line.
- **Spurious f-string prefixes** (commit `46b12a4`): two assertion
  messages tagged `f""` without `{…}` placeholders tripped
  `ruff F541` on CI; cascaded into the
  "Publish report to workflow summary" step which expected
  `reports/code-quality.md` to exist.

### Documentation

- New: `docs/performance/history/svg-dom-recycling.md` — full
  retrospective with benchmarks, fallback matrix and 6 Do's/Don'ts.
- Updated: `docs/performance/rendering-optimization-plan.md` with a
  new "SVG DOM Recycling" section.
- New consolidated proposal:
  `docs/proposals/rendering-lod-strategies.md`.
- New indexes: `docs/README.md`, `docs/performance/history/README.md`.
- Refreshed: `CLAUDE.md` (root, frontend, expert_backend),
  `README.md`, `CONTRIBUTING.md`, `benchmarks/README.md`,
  `scripts/PARITY_README.md`, `frontend/PARITY_AUDIT.md`, the CI
  workflow (`parity.yml`, new `code-quality.yml`) and the CircleCI
  config.
- Updated: `docs/architecture/code-quality-analysis.md` with five
  new delta sections covering each decomposition pass and the new
  continuous-reporting tooling.
- Updated: `docs/features/action-overview-diagram.md` with the new
  filter UI and unsimulated-pin layer.

### Removed

- Obsolete rendering-LoD docs (`nad_optimization.md`,
  `spatial_lod_architecture_proposal.md`,
  `network_rendering_profiling_recommendations.md`) merged into
  the consolidated `docs/proposals/rendering-lod-strategies.md`.
- `framer-motion` and `lucide-react` from `frontend/package.json`
  (unused).

---

## [0.6.0] — 2026-04-20

Follow-up release to **0.5.0** consolidating the standalone-parity
effort, the Action Overview diagram, perf work on the inactive-tab
SVG tree, and the docs reorganisation.

### Highlights

- **Auto-generated single-file standalone** (`npm run build:standalone`)
  replaces the hand-maintained `standalone_interface.html`. The React
  source in `frontend/src/` is now the single source of truth; no
  manual mirroring required when adding a component, setting, API
  call, or gesture.
- **Layer-4 user-observable invariants** — runtime Vitest twin
  (`userObservableInvariants.test.ts`) paired with the existing
  `scripts/check_invariants.py` static check, guarding the six
  classes of regression that had previously shipped past layers 1–3.
- **Action Overview diagram** — map-pin overlay on the N-1 NAD
  showing every prioritised action with severity colouring, with
  pan/zoom-aware pin rescaling.

### Added

- **Auto-generated standalone bundle** (PR #101): React + CSS
  inlined into `frontend/dist-standalone/standalone.html` via
  `vite-plugin-singlefile`. Canonical distribution artifact. See
  `frontend/CLAUDE.md § Standalone bundle`.
- **Layer-4 parity guard** (commit `45c143e`): `scripts/check_invariants.py`
  for the standalone and a runtime Vitest twin
  (`frontend/src/utils/userObservableInvariants.test.ts`) for the
  React side.
- **Layer-3 Playwright E2E suite** (`scripts/parity_e2e/e2e_parity.spec.ts`)
  and a gesture-sequence static proxy (`scripts/check_gesture_sequence.py`).
- **Action Overview diagram** (commits `106f87a`, `4157a3e`,
  `967766a`, `3c7863b`, `d3c3b59`, `5030b6c`, `56643a8`): pin overlay
  on N-1 NAD; severity threshold parameterised by
  `monitoringFactor`; topology-first pin anchoring; combined-pair
  dashed curves; Overview backdrop dim; auto-switch to Action tab on
  "Display Prioritized". See `docs/features/action-overview-diagram.md`.
- **Detached + tied visualization tabs** brought to full Layer-1
  parity (commit `00f078f`): save-only rho arrays, tied viewBox
  sync, detach-in-Overview-mode support.
- **`/api/simulate-and-variant-diagram` streaming endpoint** — NDJSON
  `{type:"metrics"}` then `{type:"diagram"}` so the sidebar updates
  ahead of the SVG.
- **`frontend/PARITY_AUDIT.md`** — working record of the parity
  effort (feature inventory, mirror-status table, Layer 1–4
  conformity, gap list, regression-guard matrix), split out of the
  root `CLAUDE.md`.

### Changed

- **Docs reorganised** into `docs/{features,performance/{,history},
  architecture,proposals,data}/` with per-folder README indexes.
  Three overlapping rendering-LoD proposals
  (`nad_optimization.md`, `network_rendering_profiling_recommendations.md`,
  `spatial_lod_architecture_proposal.md`) merged into
  `docs/proposals/rendering-lod-strategies.md`. All in-repo
  references updated across `CLAUDE.md`s, `README.md`, benchmarks,
  scripts, tests and source comments.
- **Parity audit split** out of the root `CLAUDE.md` into
  `frontend/PARITY_AUDIT.md`.
- **`expert_backend/CLAUDE.md` / `frontend/CLAUDE.md`** refreshed
  with the post-decommission wording (single source of truth in
  `frontend/src/`).

### Performance

- **`display:none` on inactive SVG tabs** (PRs #99, #102): the
  off-screen N / N-1 / Action SVGs drop from the browser paint tree,
  cutting live DOM nodes from ~600 k to ~200 k on the French grid.
  See `docs/performance/history/svg-tab-unmount.md`.

### Fixed

- **SLD highlight** for LS / curtailment / PST targets on the
  Action tab (commit `5d2b9d1`), including a text-search fallback
  when the metadata index misses an equipment ID (commit `065e99c`).
- **Overload halo suppression** on "Solved — low margin" actions in
  both NAD and SLD (commit `894ec8c`).
- **Session reload** now refreshes the N-1 diagram and preserves
  action-bucket / combined-pair state without re-simulation
  (commit `d729725`), with `/api/restore-analysis-context` wired in
  (commit `5c9d92c`).
- **Manual re-simulate** refreshes the SLD overlay; modal content
  word-wraps correctly (commit `657af8a`).
- **Pin severity** uses `monitoringFactor − 0.05` instead of a
  hardcoded 0.9 / 1.0 cutoff, fixing the MF = 0.85 misclassification
  (commit `56643a8`).
- **Pin anchor** uses the topology target (action's disconnected
  line) rather than `max_rho_line` (commit `5030b6c`).
- **Pin coverage / Overview perf / popup pins / popover content**
  (commits `967766a`, `dbc05f8`, `d3c3b59`, `3c7863b`, `4157a3e`).
- **Rendering fidelity** for Overview, detached tabs, overflow tab,
  and action auto-zoom (commit `4157a3e`).
- **Obsolete `test_ui_regressions.py`** removed — it guarded strings
  in the now-decommissioned `standalone_interface.html`.
- **ESLint errors** in `userObservableInvariants.test.ts`
  (`@typescript-eslint/no-explicit-any`, `no-unused-vars`).

### Documentation

- New consolidated doc: `docs/proposals/rendering-lod-strategies.md`.
- New index files: `docs/README.md`,
  `docs/performance/history/README.md`.
- `docs/features/action-overview-diagram.md` added for the Action
  Overview diagram feature.
- `CLAUDE.md` (root, frontend, expert_backend) reflect the
  auto-generated standalone workflow and the new docs tree.

### Removed

- **`expert_backend/tests/test_ui_regressions.py`** — its assertions
  targeted strings in the decommissioned
  `standalone_interface.html`; equivalent coverage now lives in the
  four parity scripts (`scripts/check_*.py`) and in the Vitest
  suite.

---

## [0.5.0] — 2026-04-14

First tagged release under the **Co-Study4Grid** name. This release consolidates the
performance, workflow and UI work from PRs #57 → #91 and ships a stable, production-ready
contingency-analysis assistant for large grids.

### Highlights

- **4× faster manual-action simulation** and **~1,100× faster overload detection** on
  the full French grid (~10k branches), thanks to NumPy vectorization and observation
  caching. See `docs/performance/history/pr-perf-optimization-summary.md` and `docs/performance/performance-profiling.md`.
- **Two-step N-1 workflow** (detect → select → resolve) replaces the legacy one-shot
  analysis as the primary user path.
- **Full remedial-action catalog**: topology, PST tap adjustment, renewable curtailment,
  load shedding — individually, manually, or as superposition pairs.
- **Detachable visualization tabs** for dual-monitor workflows.
- **Replay-ready interaction logging** and **session save/reload** that exactly restore
  a study without re-simulating.

### Added

- **Rebrand**: ExpertAssist → Co-Study4Grid (PR #65), MPL-2.0 license banners on all
  code files (PR #67), `AUTHORS.txt`.
- **PST (Phase-Shifting Transformer) actions** (PR #78): tap start / target columns,
  re-simulation from the score table, target-tap sync, superposition fallback for PST
  pairs, robust key lookup for tap parameters.
- **Renewable curtailment** actions integrated end-to-end (PR #72) with the
  `set_gen_p` power-reduction format.
- **Load shedding** actions (PR #61) with configurable MW reduction (PR #73), the new
  `set_load_p` format, SLD highlighting, and score-table re-simulation.
- **Combined actions**: *Computed Pairs* and *Explore Pairs* modal, superposition
  estimation, full-simulation fallback, and UI restrictions on LS/RC combinations
  (PR #72). Pair estimations refresh on re-simulation.
- **Detachable visualization tabs** (PR #84, #86, #87, #90): pop Network N / N-1 /
  Action / Overflow tabs into a second browser window, with tie/untie, per-window
  pan/zoom preservation, bidirectional controls, and stable-portal DOM move to avoid
  unmount/remount cascades. See `docs/features/detachable-viz-tabs.md`.
- **SLD impacted-asset highlights** (PR #63): clone-behind halos for switches and
  coupling breakers, robust across pan/zoom and N-1/action state changes.
- **MW Start column** in action score tables (PR #62), with `get_virtual_line_flow`
  for open-coupling and load-shedding rows.
- **Focused sub-diagrams** (`/api/focused-diagram`, `/api/action-variant-focused-diagram`)
  with configurable depth for inspecting specific VL neighborhoods on large grids.
- **Zoom-tier level-of-detail** (PR #76): dynamic proportional boosting of labels, nodes
  and flow arrows based on `sqrt(diagramSize / referenceSize)` — mirrored in the
  standalone interface.
- **Contingency / overload auto-zoom and sticky feed** (PR #88): pinned compact summary,
  overload-click jumps to N-1 tab, VIEWING ribbon on action cards, max-rho-line zoom
  fallback when the newly overloaded line isn't a branch.
- **Save Results / Reload Session** (PR #62 family): timestamped session folders with
  `session.json`, `interaction_log.json`, and a copy of the overflow PDF. Restores
  actions, combined pairs, per-action enrichments, and sidebar loading ratios with no
  re-simulation. Documented in `docs/features/save-results.md`.
- **Replay-ready interaction logging** (PR #64): self-contained timestamped events with
  correlation IDs for async completions, suitable for deterministic browser-automation
  replay. See `docs/features/interaction-logging.md`.
- **Persistent user configuration** (PR #59) stored outside the repository, with a
  configurable config-file path.
- **Confirmation dialogs** (PR #83) before destructive state resets (switching network
  while a study is loaded; applying settings on an active study).
- **React ErrorBoundary** wrapping the app root (PR #82).
- **"Make a first guess" shortcut** in the empty Selected Actions section (PR #87),
  preserving manual actions through Analyze & Suggest.
- **Monitoring Factor Thermal Limits** parameter in Settings (PR #59).
- **User-facing documentation** under `docs/` covering performance, save/reload,
  interaction logging, combined actions, detachable tabs, curtailment/load-shedding/PST,
  and code-quality analysis.

### Changed

- **App.tsx refactor — Phase 1** (PR #74): reduced from ~2100 → ~650 lines; `App.tsx`
  is now a state-orchestration hub only. UI extracted into presentational components
  under `components/` and `components/modals/`; `useSettings` hook exposes a single
  `SettingsState` object passed wholesale to `SettingsModal` to avoid prop drilling.
- **State management — Phase 2** (PR #75): memoized cross-hook wrappers with
  `useCallback`, centralized state-reset logic, and `React.memo` on the three heaviest
  components (`VisualizationPanel`, `ActionFeed`, `OverloadPanel`).
- **Oversized components split** (PR #81): large frontend components decomposed into
  focused subcomponents with dedicated test suites.
- **Two-step analysis flow** is now the primary user path; legacy `/api/run-analysis`
  kept for compatibility.
- **Backend diagram helpers** (`_load_network`, `_load_layout`, `_default_nad_parameters`,
  `_generate_diagram`) deduplicate diagram-generation logic across endpoints.
- **CORS / network hosts**: API base URL aligned to `127.0.0.1:8000` in tests.
- **CLAUDE.md / standalone interface** kept in lock-step with the React app on every
  UI change.

### Performance

- **Vectorized `care_mask` & overload detection** (PR #66): 12.17 s → 0.01 s
  (**~1,100×** speed-up).
- **Vectorized branch flow extraction**: 0.82 s → 0.06 s (**~13×**).
- **Vectorized flow delta computation**: 0.47 s → 0.01 s (**~47×**).
- **Observation caching** in manual-action loop: 0.65 s → 0.01 s (**~65×**).
- **Total manual-action simulation latency**: ~16.5 s → ~4.0 s (**~4×**).
- **Base diagram rendering**: ~7.2 s → ~3.5 s.
- **Backend NaN stripping via `lxml`** and **gzip compression** for large SVG payloads
  (PR #70).
- **Pre-built `SimulationEnvironment` and `dict_action`** passed into
  `run-analysis-step1` to avoid rebuilding on every step (PR #70).
- **Frontend throttling**: datalist rendering throttled, zoom guard on exact matches,
  NaN fix in SVG boost (PR #70).
- **Overflow-graph display timing** fixed and covered by regression tests (PR #70).
- **Performance-budget test suite** (PR #66, #68) covering vectorized logic, cache
  invalidation and a small-grid simulation budget, with warm-up to absorb cold-start
  noise.
- **Eliminated contingency-search freeze** and restored automatic zoom on N-1
  diagrams (PR #77).

### Fixed

- **Second-contingency crash**, auto-zoom loss on contingency switch, and overload
  persistence across successive studies (PR #80).
- **`min_renewable_curtailment_actions`** missing from saved config (PR #80).
- **Auto-zoom double injection** on contingency switch — `MemoizedSvgContainer` kept
  always mounted (PR #81).
- **N-1 variant clone** now made from the clean N state, not the working variant (PR #81).
- **Action target asset dimming** in the standalone interface: force full opacity on
  originals (PR #71).
- **Contingency highlight z-ordering**: sibling insertion with solid yellow halo,
  surviving pan/zoom and SLD overlay (PR #71).
- **Overload highlight thresholds** and loading display values (PR #71).
- **Monitoring-factor scaling** restored for suggested actions (PR #71).
- **Superposition monitoring** aligned with `simulate_manual_action`, with
  overloaded lines force-included in the `eligible_mask` (PR #79).
- **PST re-simulation** preserves `_dict_action` structure; additive superposition
  fallback for PST no-op; proper element identification in `compute_superposition`
  (PR #78, #79).
- **Combined-action estimation filtering**: heavily loaded N-state lines are no longer
  incorrectly filtered out (PR #72).
- **`gen_p` / observation-sequence / legacy keys / islanding reporting** regressions in
  the backend after manual-action enrichment refactor (PR #72, #73).
- **Re-simulate double-click bug** on action cards (PR #73).
- **SLD rendering regressions**: blank screen, missing N-1 highlight,
  `ReferenceError` crash in the overlay (PR #76).
- **Grid layout functionality** restored with regression tests (PR #69).
- **Settings pickers**, action-table sync, blank diagram after pair simulation, and
  action-bucket preservation on re-simulation (PR #82 family).

### Documentation

- New docs: `PR_PERF_OPTIMIZATION.md`, `performance_profiling.md`, `nad_optimization.md`,
  `phase2-state-management-optimization.md`, `app-refactoring-plan.md`,
  `spatial_lod_architecture_proposal.md`, `network_rendering_profiling_recommendations.md`,
  `walkthrough_network_rendering_profiling.md`, `rendering-optimization-plan.md`,
  `detachable-viz-tabs.md`, `save-results.md`, `interaction-logging.md`,
  `combined-actions.md`, `curtailment-loadshedding-pst-actions.md`,
  `state-reset-and-confirmation-dialogs.md`, `frontend-ui-improvements.md`,
  `description_actions_topology.md`, `code-quality-analysis.md`.
- `CLAUDE.md` updated to reflect the Phase 1 / Phase 2 architecture, two-step flow,
  session save/load, SLD highlights, and combined actions.

---

## Earlier Development (pre-0.5.0)

Prior to the Co-Study4Grid rebrand (PR #65), the project was developed as **ExpertAssist**
with an iterative series of merged PRs (#57–#65) that built up:

- The initial FastAPI backend and React + TypeScript frontend scaffolding.
- Network loading, branch listing, N-1 contingency diagrams and the first
  single-step analysis flow.
- Progressive alignment between the React app and the `standalone_interface.html`
  single-file UI.
- Early interaction-logging, config-persistence and network-diagram fixes that paved
  the way for the 0.5.0 consolidation.

These are not enumerated here — the git history (`git log`) and GitHub PR list remain
the authoritative reference for pre-0.5.0 work.

---

[Unreleased]: https://github.com/marota/Co-Study4Grid/compare/0.7.0...HEAD
[0.7.0]: https://github.com/marota/Co-Study4Grid/releases/tag/0.7.0
[0.6.5]: https://github.com/marota/Co-Study4Grid/releases/tag/0.6.5
[0.6.0]: https://github.com/marota/Co-Study4Grid/releases/tag/0.6.0
[0.5.0]: https://github.com/marota/Co-Study4Grid/releases/tag/0.5.0
