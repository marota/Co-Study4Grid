# Changelog

All notable changes to **Co-Study4Grid** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project (informally) follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

- _Work in progress — new entries land here before the next tagged release._

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

[Unreleased]: https://github.com/marota/Co-Study4Grid/compare/0.6.0...HEAD
[0.6.0]: https://github.com/marota/Co-Study4Grid/releases/tag/0.6.0
[0.5.0]: https://github.com/marota/Co-Study4Grid/releases/tag/0.5.0
