# Co-Study4Grid

**Co-Study4Grid** is a full-stack web application for **power grid contingency analysis and N-1 planning**. It provides an interactive interface on top of the [`expert_op4grid_recommender`](https://github.com/marota/Expert_op4grid_recommender) library, letting grid operators simulate element disconnections, visualize network overflows, and explore prioritized remedial actions — topology changes, PST tap adjustments, renewable curtailment, and load shedding — individually or combined.

> Formerly known as **ExpertAssist**. Rebranded to Co-Study4Grid in release 0.4 (PR #65).

![License: MPL 2.0](https://img.shields.io/badge/license-MPL--2.0-blue)
![Release](https://img.shields.io/badge/release-0.7.0-green)

---

## Key Features

### Contingency analysis & remediation
- **Two-step N-1 workflow**: detect overloads first (`run-analysis-step1`), let the operator pick which ones to resolve, then stream suggestions (`run-analysis-step2`). The legacy one-shot `run-analysis` endpoint is still exposed for backward compatibility.
- **AC/DC fallback**: analysis runs on the AC load flow and transparently falls back to DC when AC fails to converge.
- **Prioritized action feed** with search, filter, star / reject, and per-action metadata — severity, MW deltas, rho after action, impacted overloaded lines.
- **Manual action simulation** from the score table, including a *"Make a first guess"* shortcut when no suggestion is loaded.
- **Combined actions** (PR #62 family): evaluate pairs of actions via a fast **superposition (beta-coefficient) estimation** or a full exact simulation, through the *Computed Pairs* / *Explore Pairs* modal. See [`docs/features/combined-actions.md`](docs/features/combined-actions.md).
- **Full remedial action catalog**:
  - Topological switches and bus reconfiguration
  - **Phase Shifting Transformer (PST)** tap adjustment with tap-start / target columns, re-simulation, and superposition fallback (PR #78)
  - **Renewable curtailment** and **load shedding** via the `set_load_p` / `set_gen_p` power-reduction format, with configurable MW reduction (PR #72, #73). See [`docs/features/curtailment-loadshedding-pst-actions.md`](docs/features/curtailment-loadshedding-pst-actions.md).

### Visualization
- **Four synchronized tabs** — *Network N*, *Contingency N-1*, *Remedial Action*, *Overflow Analysis* — rendered as pypowsybl Network-Area Diagrams (NAD) with flow-delta overlays.
- **Interactive overflow analysis** (PRs #116, #122–#127): the legacy static PDF is replaced by a same-origin HTML viewer with a layer-toggle sidebar (Constrained path, Red-loop, Overloads, Hubs, Reconnectable, Production / Consumption nodes, flow polarities), a hierarchical ↔ geographic layout switch backed by a per-study cache, and a double-click → SLD drill-down on any node. See [`docs/features/interactive-overflow-analysis.md`](docs/features/interactive-overflow-analysis.md).
- **Action pin overview** (PR #105 + #116): the post-contingency NAD doubles as a Google-Maps-style overview where every remedial action becomes a coloured pin anchored on the grid asset it targets. Pins reflect triage decisions (gold star = selected, red cross = rejected, dashed-curve = simulated combined pair, dimmed-dashed `?` = scored-but-unsimulated). The same pin overlay is mirrored on top of the interactive overflow viewer, kept in lock-step via `postMessage` so a single-click anywhere previews the action card and a double-click drills into the SLD or kicks off a manual simulation. See [`docs/features/action-overview-diagram.md`](docs/features/action-overview-diagram.md).
- **Single-Line Diagrams (SLD)** for voltage levels in N, N-1, and post-action states, with persistent highlight of impacted switches and coupling breakers (PR #63).
- **Focused sub-diagrams**: auto-generate a NAD centered on a specific element with configurable depth — useful for inspecting parts of 10k-branch grids.
- **Robust highlighting**: contingencies, overloads and impacted assets are drawn as clone-based halos that survive pan, zoom, SLD overlay, and action-target dimming.
- **Auto-zoom** on contingency, newly overloaded line, or action target; pinned sticky feed summary and overload-click to jump to the N-1 tab (PR #88).
- **Zoom-tier level-of-detail** (PR #76): labels, nodes and flow arrows are dynamically boosted proportional to `sqrt(diagramSize / referenceSize)`, so large grids remain legible at any zoom.
- **Voltage-level names toggle** (PR #118): a `🏷 VL` chip flips visibility of the pypowsybl VL labels with a native `<title>` tooltip fallback so cluttered grids stay readable.

### Efficient interactions
Co-Study4Grid is built around the operator's ability to triage hundreds of remedial actions quickly. The UI is wired so a single click, a chip, or a keystroke replaces a multi-step menu walk.

- **Synchronized filter chips** (PRs #105 / #109 / #116 / #129): one `ActionOverviewFilters` state — severity categories (Solves / Low margin / Still overloaded / Divergent-or-islanded), max-loading threshold slider, `Show unsimulated` toggle, and action-type chips (DISCO / RECO / LS / RC / OPEN / CLOSE / PST) — drives the Action Feed sidebar, the Action Overview pin layer, **and** the overflow-graph pin overlay simultaneously. Hide a card in any view, it disappears from the others.
- **Click-to-inspect with auto-zoom + impacted-asset halos**: clicking an `ActionCard` in the sidebar feed (or a pin via its popover) selects the action, fetches its post-action NAD, **auto-zooms onto the action target and the lines it affects**, and paints clone-based halos on every impacted asset (action target, contingency, newly overloaded / relieved lines, action-induced topology changes). The same auto-fit logic runs on contingency selection and on overload-row clicks in the sidebar — no manual pan/zoom needed to check whether a candidate action lands where the operator expects.
- **Pin-driven workflow**: single-click a pin → `ActionCardPopover` opens anchored on the pin (no tab switch); double-click → drills into the SLD overlay for that voltage level; double-click an unsimulated pin → kicks off a manual simulation through `simulate_manual_action`. Same gesture grammar on the Action Overview NAD, the overflow viewer, and the Action Feed cards.
- **Simulate any action on demand** — from three surfaces: (1) the **action-score table** in the *Manual Selection* dropdown (every scored-but-not-yet-simulated action becomes a one-click `Simulate` row, with a *"Make a first guess"* shortcut when no analysis is loaded yet); (2) the **un-simulated pin layer** on both the Action Overview NAD and the overflow viewer (dimmed dashed pins, double-click triggers the same code path); (3) any **manual action ID** typed into the dropdown's free-text field. Reconnection (`reco_*`) and load-shedding / curtailment / PST actions are auto-built on the fly when missing from the dictionary, so the operator can compose mixed disconnect + reconnect studies without editing the action JSON.
- **Combined-action explorer** (PRs #62, #114): the *Computed Pairs* / *Explore Pairs* modal proposes pairs sorted by predicted `target_max_rho`, runs fast superposition first, and offers a one-click full simulation when the operator wants ground truth — load shedding and curtailment can mix freely with topology actions.
- **Inspect search field** (PR #116) on every viz tab: type any branch / VL / load / generator ID and the view auto-focuses + halos the asset, with focused sub-diagrams a click away.
- **Detachable tabs** (PR #86): pop any visualization tab into a second browser window for dual-monitor studies, with per-window pan/zoom, tie/untie, and automatic reattach. The detached window inherits the same filter and pin state.
- **Tiered notice system + diagram legend** (PR #122): the sidebar `Notices` pill ranks issues by severity (info / warning / critical) and the new `DiagramLegend` sits inside the Visualization panel so colour codes are always one glance away — no scrolling through docs to recall what a halo means.
- **Progressive-disclosure ActionCard** (PR #121): severity icons drive a glanceable card summary; topology / load-shed / curtailment details collapse by default and expand on demand, so a feed of 50 actions still fits one screen.
- **Replay-ready interaction log**: every click, chip toggle, simulation, save, and reload is recorded with correlation IDs in `interaction_log.json`, suitable for both deterministic browser-automation replay and UI benchmarking. Full schema in [Sessions & replay](#sessions--replay) below.

### Sessions & replay
- **Save Results** / **Reload Session**: export the complete analysis state (config, contingency, actions with status tags, combined pairs, overflow PDF, loading ratios) to a timestamped session folder. See [`docs/features/save-results.md`](docs/features/save-results.md).
- **Replay-ready interaction log**: every UI interaction is written to `interaction_log.json` as a self-contained, timestamped event with correlation IDs for async completions — suitable for deterministic browser-automation replay. See [`docs/features/interaction-logging.md`](docs/features/interaction-logging.md).
- **Persistent user config**: paths, recommender parameters and UI preferences persist across sessions through a user-writable config file outside the repo (PR #59).
- **Confirmation dialogs** before destructive state resets (switching network, applying settings on an active study) so operators never lose work by accident.

### Frontend engineering
- **React 19 + TypeScript 5.9 + Vite 7**, strict mode (`noUnusedLocals`, `noUnusedParameters`).
- **Phase 1 refactor** (PR #74): `App.tsx` reduced from ~2100 lines to a pure state-orchestration hub; UI split into focused presentational components under `components/` and `components/modals/`.
- **Phase 2 hook extraction** (PR #109): `useN1Fetch` (svgPatch fast-path + `/api/n1-diagram` fallback) and `useDiagramHighlights` (per-tab SVG highlight pipeline) extracted out of `App.tsx`; sidebar moved into dedicated `AppSidebar` / `SidebarSummary` / `StatusToasts` components.
- **SVG DOM recycling** (PR #108): `utils/svgPatch.ts` clones the mounted N-state SVG and patches only per-branch deltas on N-1 / action tab switches — **~80 % faster** tab switching on the ~12 MB French NAD (full benches in [`CHANGELOG.md`](CHANGELOG.md) 0.6.5).
- **Code-quality gate** (PR #104): CI enforces zero `print()` / bare except / `any` / `@ts-ignore`, module-size ceilings, and publishes a full Markdown metrics report to each run's workflow summary.
- **React ErrorBoundary** wrapping the app root (PR #82) to contain crashes.
- **Vitest + React Testing Library** unit tests co-located as `*.test.tsx` — ~1000 specs.
- **Auto-generated single-file UI** (`frontend/dist-standalone/standalone.html` via `npm run build:standalone`, PR #101) mirroring every feature of the React app, for zero-install demos. The legacy hand-maintained `standalone_interface.html` has been decommissioned.

---

## Performance Highlights

Measured on the full French grid (`bare_env_20240828T0100Z`, ~10k
branches, ~12 MB NAD SVG) with `scripts/profile_diagram_perf.py` and
the backend micro-benches under `benchmarks/`. Full write-ups in
[`docs/performance/history/`](docs/performance/history/) and
[`CHANGELOG.md`](CHANGELOG.md).

### 0.7.0 — interactive overflow viewer + European-wide grid

* **Interactive overflow analysis tab** (PRs #116, #122–#127): the
  static overflow PDF is replaced by a same-origin HTML viewer with a
  layer-toggle sidebar (Constrained path / Red-loop / Overloads /
  Hubs / Reconnectable / Production / Consumption / flow polarities),
  hierarchical ↔ geographic layout switch, action-pin overlay synced
  with the Action Overview, and double-click → SLD drilldown.
* **PyPSA-EUR European-wide grid** (PRs #112, #117): full pipeline
  for generating XIIDM grids from PyPSA-EUR data with calibrated
  thermal limits and a fr225_400 dataset.
* **Design-token migration** (PR #120): centralised
  `src/styles/tokens.{css,ts}` palette enforced by the code-quality
  gate (zero hex literals outside the token files).

### 0.6.5 — SVG DOM recycling (PR #108)

| Endpoint | Cold | Warm (median of 3) | Payload |
|---|---|---|---|
| `/api/n1-diagram` (full)      | 3.01 s | 2.39 s | 27.1 MB |
| `/api/n1-diagram-patch` (new) | 0.49 s | 0.50 s |  5.5 MB |
| **Δ** | **−83.8 %** | **−79.1 %** | 20.3 % of full |

Mirrored on `/api/action-variant-diagram-patch` with dashed-class
toggling for `disco_*` / `reco_*` and VL-subtree splicing for
coupling / node-merging / node-splitting actions.

### 0.5.0 — vectorisation + observation caching

| Metric                              | Before   | After   | Speed-up   |
|-------------------------------------|----------|---------|------------|
| `care_mask` / overload detection    | 12.17 s  | 0.01 s  | **~1,100×** |
| Branch flow extraction              | 0.82 s   | 0.06 s  | **~13×**    |
| Flow delta computation              | 0.47 s   | 0.01 s  | **~47×**    |
| `get_obs()` call overhead           | 0.65 s   | 0.01 s  | **~65×**    |
| **Total manual-action simulation**  | ~16.5 s  | ~4.0 s  | **~4×**     |
| Base diagram rendering              | ~7.2 s   | ~3.5 s  | **~2×**     |
| N-1 contingency analysis            | ~19.8 s  | ~12.9 s | ~1.5×       |

**How it was achieved**:
- Vectorized the `care_mask` loop, flow extraction and delta computation with NumPy.
- Observation caching in the manual-action loop (eliminates redundant `get_obs()` refetches).
- Pre-built `SimulationEnvironment` and `dict_action` reused across steps.
- `lxml`-based NaN stripping + gzip compression for large SVG payloads (PR #70).
- `display:none` on inactive SVG tabs cuts live DOM from ~600 k to ~200 k nodes (PRs #99, #102).
- Frontend: throttled datalist rendering, zoom guard, level-of-detail tiers, and stable portal target for detached tabs to avoid unmount/remount cascades.

---

## Architecture

Co-Study4Grid is a monorepo with a **Python FastAPI backend** and a **React + TypeScript frontend**.

```
Co-Study4Grid/
├── expert_backend/              # FastAPI backend (Python)
│   ├── main.py                  # API endpoints and app configuration
│   └── services/
│       ├── network_service.py       # Network loading and queries (pypowsybl)
│       ├── recommender_service.py   # Analysis orchestration, PDF/SVG generation
│       ├── diagram_mixin.py  +  diagram/    # NAD/SLD orchestrator + 7 helpers
│       ├── analysis_mixin.py +  analysis/   # Two-step analysis + 5 helpers
│       │                                    # (incl. overflow_geo_transform — 0.7.0)
│       ├── simulation_mixin.py + simulation_helpers.py  # Manual + combined actions
│       ├── overflow_overlay.py      # Interactive overflow viewer overlay (0.7.0)
│       └── sanitize.py              # NumPy → native-Python JSON coercion
├── frontend/                    # React + TypeScript + Vite frontend
│   ├── dist-standalone/             # Auto-generated single-file UI bundle
│   │                                # (npm run build:standalone)
│   └── src/
│       ├── App.tsx                  # State orchestration hub (~1400 lines)
│       ├── api.ts                   # Axios HTTP client
│       ├── types.ts                 # Shared TypeScript interfaces
│       ├── styles/                  # Design-token palette: tokens.{css,ts}
│       │                            # (single source of truth, gate-enforced)
│       ├── hooks/                   # useSettings / useAnalysis / useDiagrams /
│       │                            # useN1Fetch / useDiagramHighlights /
│       │                            # useOverflowIframe / …
│       ├── utils/                   # svgUtils (barrel) + svg/* submodules,
│       │                            # svgPatch, actionTypes, sessionUtils,
│       │                            # interactionLogger, mergeAnalysisResult, …
│       └── components/              # Header, ActionFeed, VisualizationPanel,
│                                    # OverloadPanel, CombinedActionsModal,
│                                    # AppSidebar, SidebarSummary, StatusToasts,
│                                    # NoticesPanel, DiagramLegend,
│                                    # ActionTypeFilterChips, modals/, …
├── standalone_interface_legacy.html # DECOMMISSIONED frozen snapshot (do not edit)
├── docs/                        # features/, performance/, architecture/,
│                                # proposals/, data/  — see docs/README.md
├── benchmarks/                  # Offline micro-benches (warm / cold timings)
├── scripts/                     # Parity + quality gates + PyPSA-EUR pipeline
└── Overflow_Graph/              # Generated PDF output directory (created at runtime)
```

See [`CLAUDE.md`](CLAUDE.md) for a deep dive into the architecture and conventions.

---

## Prerequisites

- **Python 3.10+** with:
  - [`pypowsybl`](https://pypowsybl.readthedocs.io/)
  - [`expert_op4grid_recommender`](https://github.com/marota/Expert_op4grid_recommender)
  - [`grid2op`](https://grid2op.readthedocs.io/), [`pandapower`](https://pandapower.readthedocs.io/), [`lightsim2grid`](https://lightsim2grid.readthedocs.io/)
- **Node.js 18+** and npm

## Getting Started

### 1. Install backend dependencies

```bash
pip install -r expert_backend/requirements.txt
pip install -r overrides.txt
```

> `pypowsybl` and `expert_op4grid_recommender` must already be installed in your Python environment.

### 2. Start the backend

```bash
python -m expert_backend.main
# or
uvicorn expert_backend.main:app --host 0.0.0.0 --port 8000
```

The API server starts on `http://localhost:8000`.

### 3. Install and start the frontend

```bash
cd frontend
npm install
npm run dev
```

Open the Vite dev-server URL shown in the terminal (typically `http://localhost:5173`).

### 4. Use the application

1. Open **Settings → Paths** and set the network directory (containing `.xiidm` files), the action definition JSON, and optionally an output folder for saved sessions.
2. Click **Load Study** to load the network.
3. Pick a disconnectable element (line or transformer) from the searchable dropdown — the N-1 diagram is fetched with overloads highlighted automatically.
4. Click **Analyze & Suggest** (two-step flow): select which overloads to resolve, then watch the action feed stream in.
5. Inspect prioritized actions, simulate manual ones, or open the **Combine** modal to explore action pairs.
6. Detach any visualization tab (`⧉`) onto a second screen for dual-monitor studies.
7. Hit **Save Results** to export the full session; **Reload Session** restores it exactly, without re-simulating anything.

---

## API Reference

### Configuration & session
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/user-config` | Read persisted user configuration |
| `POST` | `/api/user-config` | Persist user configuration (paths, recommender params) |
| `GET`  | `/api/config-file-path` | Get the current user config file path |
| `POST` | `/api/config-file-path` | Set a custom user config file path |
| `POST` | `/api/config` | Load network + set all recommender parameters |
| `GET`  | `/api/pick-path` | Open the native OS file / directory picker |
| `POST` | `/api/save-session` | Save a session folder (JSON snapshot + PDF + interaction log) |
| `GET`  | `/api/list-sessions` | List saved session folders |
| `POST` | `/api/load-session` | Load a session JSON and restore PDFs |
| `POST` | `/api/restore-analysis-context` | Restore the backend analysis context from a saved session |

### Network introspection
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/branches` | List disconnectable elements (lines + 2-winding transformers) |
| `GET`  | `/api/voltage-levels` | List voltage levels in the network |
| `GET`  | `/api/nominal-voltages` | Map voltage level IDs to nominal voltages (kV) |
| `GET`  | `/api/element-voltage-levels` | Resolve an equipment ID to its voltage level IDs |
| `GET`  | `/api/voltage-level-substations` | Map voltage level IDs to their parent substation IDs |
| `GET`  | `/api/actions` | Return all available action IDs and descriptions |

### Analysis
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/run-analysis` | Legacy one-shot N-1 analysis (streaming NDJSON) |
| `POST` | `/api/run-analysis-step1` | Two-step flow — step 1: detect overloads |
| `POST` | `/api/run-analysis-step2` | Two-step flow — step 2: resolve with actions (streaming NDJSON) |
| `POST` | `/api/simulate-manual-action` | Simulate a specific action against a contingency |
| `POST` | `/api/compute-superposition` | Compute the combined effect of two actions (superposition) |

### Diagrams
| Method | Path | Description |
|--------|------|-------------|
| `GET`  | `/api/network-diagram` | Get the N-state network SVG (NAD) |
| `POST` | `/api/n1-diagram` | Get the post-contingency N-1 diagram with flow deltas |
| `POST` | `/api/n1-diagram-patch` | Per-branch delta (SVG-less) for DOM-recycling fast path (PR #108) |
| `POST` | `/api/action-variant-diagram` | Diagram after applying a remedial action |
| `POST` | `/api/action-variant-diagram-patch` | Per-branch delta + VL-subtree splice for action DOM recycling |
| `POST` | `/api/focused-diagram` | Sub-diagram focused on an element with configurable depth |
| `POST` | `/api/action-variant-focused-diagram` | Focused NAD for a specific VL in post-action state |
| `POST` | `/api/n-sld` | Single Line Diagram for a voltage level in N state |
| `POST` | `/api/n1-sld` | SLD in N-1 state with flow deltas |
| `POST` | `/api/action-variant-sld` | SLD in post-action state |
| `POST` | `/api/simulate-and-variant-diagram` | NDJSON stream: `{type:"metrics"}` then `{type:"diagram"}` so sidebar updates ahead of the SVG |
| `POST` | `/api/regenerate-overflow-graph` | Toggle the overflow graph between hierarchical and geo layout (per-study cache, 0.7.0) |
| `GET`  | `/results/pdf/{filename}` | Serve overflow viewer files (interactive HTML by default, PDF on legacy installs) |

---

## Tech Stack

### Backend
- **FastAPI** + **Uvicorn** — web framework and ASGI server
- **pypowsybl** — network loading, load flow, and diagram generation
- **expert_op4grid_recommender** — domain-specific grid optimization
- **grid2op**, **pandapower**, **lightsim2grid** — simulation backends
- **NumPy**, **pandas**, **lxml** — vectorized pipeline and SVG post-processing

### Frontend
- **React 19** with **TypeScript 5.9**
- **Vite 7** — build tool and dev server
- **axios** — HTTP client
- **react-select** — searchable dropdown for branch selection
- **react-zoom-pan-pinch** — pan/zoom for SVG visualizations
- **vite-plugin-singlefile** — auto-generated single-file standalone bundle
- **Vitest** + **React Testing Library** — unit tests (~1000 specs)

---

## Development

### Build & lint

```bash
cd frontend
npm run build      # TypeScript compilation + Vite production build
npm run lint       # ESLint v9+ flat config
npm run preview    # Preview production build
```

### Tests

Backend unit tests (pytest, runs without `pypowsybl` /
`expert_op4grid_recommender` thanks to the `conftest.py` mock
layer — see [`expert_backend/tests/CLAUDE.md`](expert_backend/tests/CLAUDE.md)):

```bash
pytest                                   # Full backend suite
pytest expert_backend/tests/test_mw_start.py   # Single file
pytest -k "TestSuperposition"            # Pattern
```

Frontend unit tests (Vitest + React Testing Library):

```bash
cd frontend && npm run test
```

Code-quality gate (CI-enforced, PR #104):

```bash
python scripts/check_code_quality.py                 # Exit non-zero on regression
python scripts/code_quality_report.py --summary      # Local Markdown report
```

Ad-hoc integration / profiling scripts (require a running backend
and real data paths):

```bash
python expert_backend/test_backend.py                # Config + branches + analysis
python scripts/profile_diagram_perf.py               # NAD rendering profiler
python scripts/pypsa_eur/test_pipeline.py            # PyPSA-EUR end-to-end smoke test
pytest scripts/pypsa_eur                             # PyPSA-EUR pipeline unit tests
```

---

## Standalone Interface

The single-file standalone UI is **auto-generated** from the React
source tree (PR #101). Build it with:

```bash
cd frontend && npm run build:standalone
```

The output is `frontend/dist-standalone/standalone.html` — a ~1 MB
self-contained HTML with React + CSS inlined via
`vite-plugin-singlefile`. Open it directly in a browser (pointed at
a running backend). It mirrors every feature of the React app —
detachable tabs, SLD highlights, combined actions, PST / curtailment
/ load-shedding cards, interaction logging, zoom-tier level of
detail, SVG DOM recycling — with no build step for consumers.

The legacy hand-maintained `standalone_interface.html` has been
decommissioned and renamed to `standalone_interface_legacy.html`
(committed as a frozen snapshot, do NOT edit). UI changes land only
in `frontend/src/` — the auto-generated bundle inherits them on the
next `npm run build:standalone`.

Parity between the React source and the bundle is guarded by four
layers of automated checks (`scripts/check_standalone_parity.py`,
`scripts/check_session_fidelity.py`,
`scripts/check_gesture_sequence.py`, `scripts/check_invariants.py`)
— see [`frontend/PARITY_AUDIT.md`](frontend/PARITY_AUDIT.md).

---

## Data Formats

- **Network files**: `.xiidm` (loaded by pypowsybl)
- **Action definitions**: `.json` mapping action IDs to descriptions, supporting topology, PST, `set_load_p`, and `set_gen_p` formats
- **Network layouts**: `grid_layout.json` with node-ID → `[x, y]` coordinates
- **Generated outputs**: PDF overflow graphs in `Overflow_Graph/`
- **Session folder**: `costudy4grid_session_<contingency>_<timestamp>/` containing `session.json`, `interaction_log.json`, and an overflow PDF copy

---

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for the list of changes per release. The current release is **0.7.0**.

---

## License

Copyright 2025–2026 RTE France
RTE: <http://www.rte-france.com>

This Source Code is subject to the terms of the Mozilla Public License (MPL) v2, also available [here](https://www.mozilla.org/en-US/MPL/2.0/).
