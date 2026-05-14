# CLAUDE.md - Co-Study4Grid

## Project Overview

Co-Study4Grid is a full-stack web application for **power grid contingency analysis and N-1 planning**. It provides an interface to the `expert_op4grid_recommender` library, allowing operators to simulate element disconnections, visualize network overflow graphs, and receive prioritized remedial action recommendations.

## Architecture

**Monorepo** with two main components plus a standalone HTML mirror:

```
Co-Study4Grid/
├── CLAUDE.md                  # This file — project overview + standalone parity audit
├── README.md                  # User-facing project description + quick start
├── CHANGELOG.md               # Per-release changelog (current: 0.7.0)
├── CONTRIBUTING.md            # Contributor setup, code-quality gate
├── pyproject.toml             # Python project metadata + ruff config (E9/F ruleset)
├── pytest.ini                 # Pytest config (testpaths = expert_backend/tests)
├── expert_backend/            # Python FastAPI backend
│   ├── CLAUDE.md              # Backend-scoped guide (singletons, mixins, lifecycle)
│   ├── main.py                # FastAPI app: endpoints, CORS, gzip helpers, NDJSON streaming
│   ├── requirements.txt
│   ├── test_backend.py        # Ad-hoc integration script (not part of pytest)
│   ├── services/
│   │   ├── network_service.py     # pypowsybl Network singleton + metadata queries
│   │   ├── recommender_service.py # Analysis orchestrator (composes the 3 mixins below)
│   │   ├── diagram_mixin.py       # NAD/SLD orchestrator — delegates to services/diagram/
│   │   ├── analysis_mixin.py      # Two-step analysis orchestrator — delegates to services/analysis/
│   │   ├── simulation_mixin.py    # Manual-action + superposition orchestrator
│   │   ├── simulation_helpers.py  # Stateless helpers extracted from simulation_mixin (PR #104)
│   │   ├── overflow_overlay.py    # Pin / filter overlay injector for the interactive
│   │   │                          # HTML overflow viewer (PR #116, 0.7.0)
│   │   ├── sanitize.py            # NumPy → native-Python recursive coercion
│   │   ├── analysis/              # PR #104 decomposition — action_enrichment,
│   │   │                          # mw_start_scoring, analysis_runner, pdf_watcher,
│   │   │                          # overflow_geo_transform (PR #116 — geo-layout SVG
│   │   │                          # transform for /api/regenerate-overflow-graph)
│   │   └── diagram/               # PR #104 decomposition — layout_cache, nad_params,
│   │                              # nad_render, sld_render, overloads, flows, deltas
│   └── tests/                 # pytest suite — see tests/CLAUDE.md for the mock layer
├── frontend/                  # React 19 + TypeScript 5.9 + Vite 7 frontend
│   ├── CLAUDE.md              # Frontend-scoped guide (App.tsx hub, hooks, SVG levers)
│   ├── package.json, vite.config.ts, vite.config.standalone.ts,
│   │                          # eslint.config.js, tsconfig*.json
│   └── src/
│       ├── App.tsx                # State orchestration hub (~1400 lines)
│       ├── api.ts                 # Axios HTTP client (base URL: 127.0.0.1:8000)
│       ├── types.ts               # All TypeScript interfaces (one file)
│       ├── styles/                # Design-token palette (PR #120, 0.7.0):
│       │                          # tokens.css (CSS custom properties) +
│       │                          # tokens.ts (typed colors / space / text /
│       │                          # radius / pinColors* constants). Single
│       │                          # source of truth for the entire UI; the
│       │                          # code-quality gate enforces zero hex
│       │                          # literals outside these two files.
│       ├── hooks/                 # useSettings / useActions / useAnalysis / useDiagrams /
│       │                          # useSession / useDetachedTabs / useTiedTabsSync /
│       │                          # usePanZoom / useSldOverlay / useN1Fetch (svgPatch fast-
│       │                          # path + full fallback) / useDiagramHighlights (per-tab
│       │                          # highlight pipeline + Flow/Impacts view-mode state) /
│       │                          # useOverflowIframe (PR #116 — iframe lifecycle, layer
│       │                          # toggles, postMessage bridge, pin overlay payload)
│       ├── components/            # Header, ActionFeed, ActionCard, ActionCardPopover,
│       │                          # ActionSearchDropdown, ActionTypeFilterChips,
│       │                          # ActionOverviewDiagram, AppSidebar, SidebarSummary,
│       │                          # StatusToasts, VisualizationPanel, OverloadPanel,
│       │                          # CombinedActionsModal, ComputedPairsTable,
│       │                          # ExplorePairsTab, SldOverlay, DetachableTabHost,
│       │                          # MemoizedSvgContainer, ErrorBoundary, NoticesPanel
│       │                          # (PR #122 tier system), DiagramLegend (PR #122),
│       │                          # InspectSearchField + DetachedPlaceholder (PR #116
│       │                          # — extracted from VisualizationPanel)
│       │                          # + modals/ (SettingsModal, ReloadSessionModal,
│       │                          #            ConfirmationDialog)
│       └── utils/                 # svgUtils (barrel re-exporting utils/svg/*),
│                                  # svgPatch (DOM-recycling patch applier),
│                                  # overloadHighlights, sessionUtils, interactionLogger,
│                                  # popoverPlacement, mergeAnalysisResult, actionTypes
│                                  # (classifyActionType + DEFAULT_ACTION_OVERVIEW_FILTERS),
│                                  # fileRegistry (structure regression guard)
│           └── svg/               # PR #104 decomposition — idMap, metadataIndex,
│                                  # svgBoost, fitRect, deltaVisuals, actionPinData,
│                                  # actionPinRender, highlights, vlTitles (PR #118 —
│                                  # VL-name title-tooltip injector), overflowPinPayload
│                                  # + overflowOverlayRender + pinGlyph (PR #116 —
│                                  # iframe-overlay pin pipeline)
├── standalone_interface_legacy.html  # DECOMMISSIONED 2026-04-20 — hand-maintained
│                              # single-file mirror frozen at its last version and
│                              # tracked here for reference only. Replaced by the
│                              # auto-generated `frontend/dist-standalone/standalone.html`
│                              # (`npm run build:standalone`). New UI changes land ONLY
│                              # in `frontend/src/` — do NOT edit this file further.
├── docs/                      # Design docs — organized into features/, performance/
│                              # (+ history/), architecture/, proposals/, data/.
│                              # See `docs/README.md` for the index.
├── data/                      # Sample grids: bare_env_small_grid_test, pypsa_eur_fr400
├── benchmarks/                # Perf scripts (bench_load_study, _bench_common)
├── Overflow_Graph/            # Generated PDFs (created at runtime)
├── overrides.txt              # Pinned versions for transitive Python deps
├── requirements_py310.txt     # Python 3.10-pinned requirements superset
├── scripts/                   # Integration / parity / build helpers —
│                              # `check_standalone_parity.py`,
│                              # `check_session_fidelity.py`,
│                              # `check_gesture_sequence.py`,
│                              # `check_invariants.py`, `check_code_quality.py`,
│                              # `code_quality_report.py`, `profile_diagram_perf.py`,
│                              # `test_code_quality_report.py`,
│                              # `test_estimation_vs_simulation_small_grid.py`,
│                              # and `pypsa_eur/` (full PyPSA-EUR → XIIDM pipeline
│                              # with its own pytest coverage)
├── .editorconfig              # Cross-editor indent / EOL defaults
├── .env.example               # Template for backend env vars (CORS, …)
└── .gitignore                 # Excludes __pycache__/, *.pyc, *.pyo, node_modules/
```

### Per-subtree docs

| File | Scope |
|------|-------|
| `CLAUDE.md` (this file) | Project overview, API table, conventions, parity-audit pointer |
| `frontend/PARITY_AUDIT.md` | Full standalone-parity audit: feature inventory, mirror-status table, Layer 1–4 conformity findings, gap-priority list, deltas. Split out of this file 2026-04-20. |
| `expert_backend/CLAUDE.md` | Backend internals: singletons, mixin composition, state lifecycle, NDJSON streaming, gzip helpers, layout cache invariants, NAD prefetch |
| `expert_backend/tests/CLAUDE.md` | Test conventions, the `conftest.py` mock layer for `pypowsybl` / `expert_op4grid_recommender`, frontend Vitest patterns |
| `frontend/CLAUDE.md` | Frontend internals: hook split, data flow, state reset, SVG performance levers, detached/tied tabs, interaction logger contract |
| `docs/README.md` | Index of design/feature/perf/architecture/proposal docs. Start here for any `docs/**` lookup. |
| `docs/features/save-results.md` | Save / reload session contract (JSON schema, reload flow, regression-guard matrix) |
| `docs/features/interaction-logging.md` | Replay-ready event log contract |

## Tech Stack

### Backend
- **Python** with **FastAPI** + **Uvicorn**
- **pypowsybl** - Power system network loading, load flow, and diagram generation
- **expert_op4grid_recommender** - Domain-specific grid optimization recommendations
- **grid2op** / **pandapower** / **lightsim2grid** - Grid simulation backends

### Frontend
- **React 19** with **TypeScript 5.9**
- **Vite 7** - Build tool and dev server
- **axios** - HTTP client
- **react-select** - Searchable dropdown for branch selection
- **react-zoom-pan-pinch** - Pan/zoom for visualizations
- **vite-plugin-singlefile** - Auto-generated single-file standalone bundle
- **Vitest** + **React Testing Library** - Unit / integration tests

## Development Workflow

### Running the Backend

```bash
# From the project root:
python -m expert_backend.main
# Or:
uvicorn expert_backend.main:app --host 0.0.0.0 --port 8000
```

The backend serves on `http://localhost:8000`. It expects `pypowsybl` and `expert_op4grid_recommender` to be available in the Python environment.

### Running the Frontend

```bash
cd frontend
npm install
npm run dev      # Start Vite dev server with HMR
```

The frontend dev server proxies API calls to `http://localhost:8000` (hardcoded in `frontend/src/api.ts`).

### Build & Lint

```bash
cd frontend
npm run build    # TypeScript compilation (tsc -b) + Vite production build
npm run lint     # ESLint
npm run preview  # Preview production build
```

### Running Tests

Backend unit tests use `pytest` and run against the in-repo mock layer
(no live pypowsybl required):

```bash
pytest                                   # Full backend suite
pytest expert_backend/tests/test_foo.py  # Single file
```

Ad-hoc integration scripts live in `scripts/` (and `scripts/pypsa_eur/`
for the PyPSA-EUR → XIIDM pipeline). The pipeline scripts carry their
own pytest coverage (`scripts/pypsa_eur/test_*.py`) alongside the
backend suite; the rest require a running backend with real data:

```bash
pytest scripts/pypsa_eur                           # Pipeline unit tests
python scripts/pypsa_eur/test_pipeline.py          # End-to-end smoke test
python scripts/pypsa_eur/test_n1_calibration.py    # N-1 flow calibration check
python scripts/pypsa_eur/test_grid_layout.py       # Layout loading sanity check
python scripts/profile_diagram_perf.py             # NAD rendering profiler
```

Frontend unit tests use Vitest:

```bash
cd frontend
npm run test         # Run Vitest test suite
```

### Code-Quality Checks (continuous reporting)

```bash
# Generate a full JSON + Markdown report (backend + frontend metrics)
python scripts/code_quality_report.py --output reports/code-quality.json \
                                      --markdown reports/code-quality.md

# Gate a pull request: non-zero exit on threshold violation
python scripts/check_code_quality.py
```

Both scripts run in CI (`.github/workflows/code-quality.yml` and
`.circleci/config.yml`). The gate guards the reductions documented in
[`docs/architecture/code-quality-analysis.md`](docs/architecture/code-quality-analysis.md)
(no new `print()` / bare except, module-size ceilings, no `any` /
`@ts-ignore` in frontend source).

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET  | `/api/user-config` | Read persisted user configuration (paths, recommender params) |
| POST | `/api/user-config` | Persist user configuration |
| GET  | `/api/config-file-path` | Get the current user-config file path |
| POST | `/api/config-file-path` | Set a custom user-config file path |
| POST | `/api/config` | Set network path, action file path, and all recommender parameters (incl. `model` and `compute_overflow_graph`) |
| GET  | `/api/models` | List registered recommendation models with their `params_spec()` and capability flags |
| POST | `/api/recommender-model` | Lightweight swap of the active recommender model (no network reload) — fired by the model dropdowns in Settings and above Analyze & Suggest |
| GET  | `/api/branches` | List disconnectable elements (lines + 2-winding transformers) |
| GET  | `/api/voltage-levels` | List voltage levels in the network |
| GET  | `/api/nominal-voltages` | Map voltage level IDs to nominal voltages (kV) |
| GET  | `/api/element-voltage-levels` | Resolve equipment ID to its voltage level IDs |
| GET  | `/api/voltage-level-substations` | Map voltage level IDs to their parent substation IDs (used by the SLD overlay and overflow pin pipeline) |
| POST | `/api/run-analysis` | Run full N-1 contingency analysis (streaming NDJSON, legacy) |
| POST | `/api/run-analysis-step1` | Two-step analysis Part 1: detect overloads |
| POST | `/api/run-analysis-step2` | Two-step analysis Part 2: resolve with actions (streaming NDJSON) |
| GET  | `/api/network-diagram` | Get N-state network SVG diagram (NAD) |
| POST | `/api/n1-diagram` | Get post-contingency N-1 diagram with flow deltas |
| POST | `/api/n1-diagram-patch` | SVG-less per-branch delta for DOM-recycling fast path (PR #108) |
| POST | `/api/action-variant-diagram` | Get network state after applying a remedial action |
| POST | `/api/action-variant-diagram-patch` | Per-branch delta + VL-subtree splice for action DOM recycling |
| POST | `/api/focused-diagram` | Generate NAD sub-diagram focused on a specific element |
| POST | `/api/action-variant-focused-diagram` | Focused NAD for specific VL in post-action state |
| POST | `/api/n-sld` | Single Line Diagram for voltage level in N state |
| POST | `/api/n1-sld` | Single Line Diagram in N-1 state (with flow deltas) |
| POST | `/api/action-variant-sld` | SLD in post-action state |
| GET  | `/api/actions` | Return all available action IDs and descriptions |
| POST | `/api/regenerate-overflow-graph` | Regenerate (or serve from cache) the overflow graph in hierarchical / geo layout — drives the toggle on the Overflow Analysis tab |
| POST | `/api/simulate-manual-action` | Simulate a specific action against a contingency |
| POST | `/api/simulate-and-variant-diagram` | NDJSON stream: `{type:"metrics"}` then `{type:"diagram"}` so sidebar updates ahead of the SVG |
| POST | `/api/compute-superposition` | Compute combined effect of two actions (superposition theorem) |
| POST | `/api/save-session` | Save session folder with JSON snapshot + PDF copy |
| GET  | `/api/list-sessions` | List available session folders in a directory |
| POST | `/api/load-session` | Load session JSON and restore PDFs |
| POST | `/api/restore-analysis-context` | Restore analysis context from saved session |
| GET  | `/api/pick-path` | Open native OS file/directory picker (tkinter subprocess) |
| GET  | `/results/pdf/{filename}` | Serve generated overflow-graph files from `Overflow_Graph/` — HTML (interactive viewer, current default via `config.VISUALIZATION_FORMAT="html"`) or PDF (legacy sessions). URL path kept for backward compatibility. |

## Key Patterns & Conventions

### Backend
- **Singleton services**: `network_service` and `recommender_service` are module-level singleton instances
- **Streaming responses**: Analysis uses `StreamingResponse` with NDJSON (`application/x-ndjson`), yielding `{"type": "pdf", ...}` then `{"type": "result", ...}` events
- **AC/DC fallback**: Analysis first tries AC load flow; falls back to DC if AC does not converge
- **Threaded analysis**: `run_analysis` runs the computation in a background thread and polls for PDF generation
- **JSON sanitization**: NumPy types are recursively converted to native Python types via `sanitize_for_json()`
- **Mixin → helper-package decomposition (PR #104 / #106)**: `DiagramMixin`, `AnalysisMixin` and `SimulationMixin` are thin orchestrators. Pure numerics live in `services/diagram/`, `services/analysis/` and `services/simulation_helpers.py` respectively — dependency-injected so existing `@patch` tests keep working.
- **SVG DOM recycling (PR #108)**: patch endpoints (`/api/n1-diagram-patch`, `/api/action-variant-diagram-patch`) return per-branch deltas + optional VL-subtree splices so the frontend can clone the already-mounted N-state SVG instead of re-downloading the full NAD (~80 % faster tab switches on large grids).
- **Interactive overflow viewer (PR #116, 0.7.0)**: `services/overflow_overlay.py` injects a Co-Study4Grid pin / filter overlay (`<style>` + `<script>` block) into the upstream `expert_op4grid_recommender` HTML viewer before serving it from `/results/pdf/{filename}`. `services/analysis/overflow_geo_transform.py` is a pure lxml transform that rewrites the hierarchical-layout SVG to geographic coordinates for the `/api/regenerate-overflow-graph` toggle; the geo cache is per-study and cleared on `reset()`.
- **Shared diagram helpers**: `RecommenderService` uses `_load_network()`, `_load_layout()`, `_default_nad_parameters()`, and `_generate_diagram()` to deduplicate diagram generation logic across endpoints
- **Focused diagrams**: The `/api/focused-diagram` endpoint resolves an element to its voltage levels and generates a sub-diagram with configurable depth, useful for inspecting specific parts of large grids
- **Ruff-gated**: `pyproject.toml` configures a narrow `E9` + `F` ruleset (real bugs only); stylistic rules deliberately off

### Frontend
- **Strict TypeScript**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- **Functional components** with React hooks; no external state management library
- **Inline styles**: Components use inline `style` objects rather than CSS modules or utility classes
- **Design tokens (PR #120, 0.7.0)**: every colour / spacing / typography / radius value lives in `frontend/src/styles/tokens.{css,ts}`. Inline `style` objects import the typed `colors` / `space` / `text` / `radius` constants from `tokens.ts`; stylesheet rules use `var(--…)` from `tokens.css`. Raw SVG attribute setters (`element.setAttribute('fill', …)`) import the hex-valued `pinColors` / `pinChrome` constants because browsers don't reliably resolve `var(--…)` inside SVG presentation attributes. **The code-quality gate enforces zero hex literals outside the two token files.**
- **Component architecture (Phase 2 hook extraction, PR #109)**:
  - `App.tsx` (~1400 lines) is the **state orchestration hub** — it wires all hooks together and handles cross-hook logic (e.g., `handleApplySettings`). It should NOT contain large JSX blocks.
  - **Presentational components** live in `components/` and `components/modals/`. They receive data and callbacks via typed props; all business logic stays in `App.tsx` or in hooks.
  - `hooks/useN1Fetch.ts` owns the N-1 diagram fetch pipeline (svgPatch fast-path + `/api/n1-diagram` fallback + contingency-change confirm routing).
  - `hooks/useDiagramHighlights.ts` owns the per-tab SVG highlight pipeline (overload halos, contingency highlight, action targets, delta visuals) + per-tab Flow/Impacts view-mode state.
  - `hooks/useOverflowIframe.ts` (PR #116, 0.7.0) owns the interactive overflow viewer — iframe lifecycle, layer-toggle state, hierarchical ↔ geo layout switch, postMessage bridge to the host, and the action-pin overlay payload computation.
  - `useSettings.ts` exposes `SettingsState` (all settings values + setters), which is passed wholesale to `SettingsModal` to avoid 30+ prop-drilling.
- **SVG DOM recycling (PR #108)**: `utils/svgPatch.ts` clones the already-mounted N-state `SVGSVGElement` and patches only per-branch deltas on N-1 / action tab switches, saving a 12–28 MB SVG re-download and re-parse.
- **Props-based data flow**: State lifted to `App.tsx`, passed down via props
- **ESLint**: Flat config (v9+) with `typescript-eslint`, `react-hooks`, and `react-refresh` plugins
- **Unit tests** use Vitest + React Testing Library. Isolated component tests (no backend mocking needed) live alongside their components as `*.test.tsx` files.

### Data Flow
1. User sets network path + action file path -> `POST /api/config` loads the network
2. Frontend fetches disconnectable branches -> `GET /api/branches`
3. User selects a contingency branch -> N-1 diagram fetched with overload highlighting
4. User runs analysis (two-step flow):
   - Step 1: `POST /api/run-analysis-step1` detects overloads in N-1 state
   - User selects which overloads to resolve
   - Step 2: `POST /api/run-analysis-step2` streams PDF event + action results
5. Frontend displays overflow PDF and action cards in ActionFeed panel
6. User can star/reject actions, manually simulate others, compute combined pairs
7. Action selection triggers `POST /api/action-variant-diagram` -> post-action diagram
8. Session save captures full snapshot to `session.json` + overflow PDF copy

### Session Save/Load
- **Save**: `buildSessionResult()` in `sessionUtils.ts` serializes all state (config, contingency, actions with status tags, combined pairs) -> `POST /api/save-session` writes to disk
- **Load**: `POST /api/load-session` reads `session.json` -> frontend restores all state without re-simulating actions
- **Output folder**: `<output_folder>/costudy4grid_session_<contingency>_<timestamp>/` contains `session.json` + overflow PDF
- **Interaction logging**: Every user interaction is logged as a timestamped, replay-ready event via `interactionLogger`. Saved as `interaction_log.json` alongside `session.json`.
- See `docs/features/save-results.md` for session save/load, `docs/features/interaction-logging.md` for the replay contract, and `docs/features/action-overview-diagram.md` for the Remedial Action overview (pin overlay on N-1 network)

### SVG Visualization
Both the React frontend and the auto-generated
`frontend/dist-standalone/standalone.html` render pypowsybl
NAD/SLD payloads:
- **Dynamic text scaling** (`utils/svgUtils.ts:boostSvgForLargeGrid` /
  standalone `boostSvgForLargeGrid`): font sizes for node labels, edge
  info, and legends scale proportionally to diagram size via
  `sqrt(diagramSize / referenceSize)`, so text is readable when zoomed
  in and naturally invisible at full zoom-out. Engaged for grids
  ≥ 500 voltage levels.
- **Bus / transformer scaling**: circle radii for bus nodes and
  transformer windings are boosted proportionally.
- **Edge-info scaling**: flow values and arrow glyphs are scaled via
  transform groups so they remain proportional to the line on which
  they sit.
- **ViewBox zoom**: auto-centers on selected contingency targets with
  adjustable padding.
- **Pan/zoom**: `react-zoom-pan-pinch` in both the React dev build
  and the auto-generated standalone (they share the same source
  tree).

## Dependencies

### Backend (`expert_backend/requirements.txt` + `overrides.txt`)
- `fastapi`, `uvicorn`, `python-multipart`
- `pypowsybl`, `expert_op4grid_recommender` (expected in venv)
- `pandas>=2.2.2`, `numpy>=2.0.0`, `grid2op>=1.12.2`, `pandapower>=2.14.0`
- `lightsim2grid>=0.12.0`, `matplotlib>=3.10.6`, `scipy>=1.16.0`
- `lxml>=6.0.0`, `contourpy>=1.2.0`, `tqdm>=4.65.0`

### Frontend (`frontend/package.json`)
- See `dependencies` and `devDependencies` in `frontend/package.json`

## File Conventions

- Network data files: `.xiidm` format (loaded by pypowsybl)
- Action definitions: `.json` files with action IDs mapping to descriptions
- Generated outputs: PDF files in `Overflow_Graph/` directory
- Network layouts: `grid_layout.json` (node ID -> [x, y] coordinates)

## Notes for AI Assistants

- The backend API base URL is hardcoded to `http://localhost:8000` in `frontend/src/api.ts`
- CORS is wide-open by default (`allow_origins=["*"]`) but configurable via the `CORS_ALLOWED_ORIGINS` env var (PR #104, see `.env.example`)
- **Frontend architecture (Phase 2 hook extraction, PR #109)**: `App.tsx` is the state orchestration hub; it must NOT contain large inline JSX blocks. Extracted presentational components live in `components/` and `components/modals/`; cross-cutting state pipelines live in `hooks/` (notably `useN1Fetch` and `useDiagramHighlights`). When adding new UI sections, create a new component file (or hook for stateful pipelines) and wire it in `App.tsx`.
- **`useSettings` hook**: Exposes a `SettingsState` object with all settings fields + setters. This is passed wholesale to `SettingsModal` to avoid excessive prop drilling. Adding a new setting means: (1) add to `useSettings.ts`, (2) add to `SettingsModal.tsx`. No manual standalone mirror is required — the legacy hand-maintained file has been decommissioned and the auto-generated bundle inherits from the React source automatically.
- **Standalone bundle (auto-generated)**: `npm run build:standalone` in `frontend/` produces `frontend/dist-standalone/standalone.html` — a single-file HTML with React + CSS inlined via `vite-plugin-singlefile`. This is the canonical distribution artifact replacing the former `standalone_interface.html`. The legacy file remains on disk as `standalone_interface_legacy.html` (tracked as a frozen snapshot — do NOT edit).
- **CI pipelines**: GitHub Actions (`.github/workflows/code-quality.yml`, `parity.yml`) and CircleCI (`.circleci/config.yml`) both run the code-quality gate, ruff, and the parity scripts. No Dockerfile / containerization.
- Root `.gitignore` excludes `__pycache__/`, `*.pyc`, `*.pyo`; `frontend/.gitignore` handles frontend build artifacts
- Integration helpers and parity scripts live under `scripts/`. They are NOT part of the pytest suite — invoke them directly. The PyPSA-EUR pipeline scripts under `scripts/pypsa_eur/` DO carry pytest coverage (`test_build_pipeline.py`, `test_calibrate_thermal_limits.py`, `test_generate_n1_overloads.py`, `test_regenerate_grid_layout.py`).
- `overrides.txt` contains pinned versions for transitive Python dependencies that need to be forced to specific versions
- **Frontend unit tests** use Vitest + React Testing Library. Isolated component tests live as `*.test.tsx` files next to their component. Run with `cd frontend && npm run test`. No backend mocking is needed for component tests since they only use mocked props.
- The two-step analysis flow (step1: detect overloads, step2: resolve) is the primary user workflow; the single-step `/api/run-analysis` is a legacy alternative
- Session save/load is documented in `docs/features/save-results.md`
- **`grid_layout.json` coordinate scale (2026-05-08)**: the on-disk layout MUST be in raw Mercator metres (span ≈ 1.4–1.6 M for the French grid). pypowsybl emits VL outer circles at a *fixed* `r = 27.5` user-space units, so any layout squashed below ~500 000 units forces overlap on dense regions (Paris/Lyon). `scripts/pypsa_eur/regenerate_grid_layout.py` defaults to raw metres; the legacy `--target-width 8000` flag is preserved but warns. Full rationale + operator-vs-PyPSA comparison in [`docs/data/grid-layout-coordinate-scale.md`](docs/data/grid-layout-coordinate-scale.md).

---

## Standalone Interface Parity Audit

The detailed audit — feature inventory, mirror-status table, Layer
1–4 conformity findings, regression-guard matrix, gap-priority list
and delta-vs-previous commits — lives in
[`frontend/PARITY_AUDIT.md`](frontend/PARITY_AUDIT.md). That
document is the working record of the parity project and is
updated as fixes land.

Quick status summary (2026-05-05):

- Canonical distribution is now the auto-generated
  `frontend/dist-standalone/standalone.html`
  (`npm run build:standalone`). The hand-maintained
  `standalone_interface.html` has been decommissioned and
  renamed to `standalone_interface_legacy.html` — committed as
  a frozen snapshot of its last version (commit `5d2b9d1` content),
  do NOT edit further. Regenerate UI from `frontend/src/` via
  `npm run build:standalone` instead. The standalone versioned
  snapshot was bumped to v0.7 on `adae7ac` to include references
  to the new `/api/*-diagram-patch` endpoints.
- Four parity layers run against the React source + the
  standalone of choice:
  - **Layer 1 — static parity** (`scripts/check_standalone_parity.py`)
  - **Layer 2 — session-reload fidelity** (`scripts/check_session_fidelity.py`)
  - **Layer 3a — gesture-sequence static proxy** (`scripts/check_gesture_sequence.py`)
  - **Layer 3b — behavioural E2E** (`scripts/parity_e2e/e2e_parity.spec.ts`)
  - **Layer 4 — user-observable invariants** (`scripts/check_invariants.py`)
- All parity scripts accept `COSTUDY4GRID_STANDALONE_PATH` to
  re-target any artifact; they default to the auto-gen bundle
  and fall back to the legacy file when the auto-gen is not
  built.

See [`frontend/PARITY_AUDIT.md`](frontend/PARITY_AUDIT.md) for
the full gap list, the session-fidelity regression record, the
honest-gap report of what each layer catches and misses, and the
2026-04-20 delta that documents the `/api/restore-analysis-context`
one-way API drift (now resolved) and the auto-generated-standalone
viability confirmation.
