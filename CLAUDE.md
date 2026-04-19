# CLAUDE.md - Co-Study4Grid

## Project Overview

Co-Study4Grid is a full-stack web application for **power grid contingency analysis and N-1 planning**. It provides an interface to the `expert_op4grid_recommender` library, allowing operators to simulate element disconnections, visualize network overflow graphs, and receive prioritized remedial action recommendations.

## Architecture

**Monorepo** with two main components plus a standalone HTML mirror:

```
Co-Study4Grid/
├── CLAUDE.md                  # This file — project overview + standalone parity audit
├── expert_backend/            # Python FastAPI backend
│   ├── CLAUDE.md              # Backend-scoped guide (singletons, mixins, lifecycle)
│   ├── main.py                # FastAPI app: endpoints, CORS, gzip helpers, NDJSON streaming
│   ├── requirements.txt
│   ├── services/
│   │   ├── network_service.py     # pypowsybl Network singleton + metadata queries
│   │   ├── recommender_service.py # Analysis orchestrator (composes the 3 mixins below)
│   │   ├── diagram_mixin.py       # NAD/SLD generation, layout cache, flow deltas
│   │   ├── analysis_mixin.py      # Two-step contingency analysis + action enrichment
│   │   ├── simulation_mixin.py    # Manual-action simulation + superposition
│   │   └── sanitize.py            # NumPy → native-Python recursive coercion
│   └── tests/                 # pytest suite — see tests/CLAUDE.md for the mock layer
├── frontend/                  # React 19 + TypeScript 5.9 + Vite 7 frontend
│   ├── CLAUDE.md              # Frontend-scoped guide (App.tsx hub, hooks, SVG levers)
│   ├── package.json, vite.config.ts, eslint.config.js, tsconfig*.json
│   └── src/
│       ├── App.tsx                # State orchestration hub (~1000 lines)
│       ├── api.ts                 # Axios HTTP client (base URL: 127.0.0.1:8000)
│       ├── types.ts               # All TypeScript interfaces (one file)
│       ├── hooks/                 # useSettings/useActions/useAnalysis/useDiagrams/
│       │                          # useSession/useDetachedTabs/useTiedTabsSync/usePanZoom/
│       │                          # useSldOverlay
│       ├── components/            # Header, ActionFeed, ActionCard, ActionOverviewDiagram,
│       │                          # VisualizationPanel, OverloadPanel, CombinedActionsModal,
│       │                          # ComputedPairsTable, ExplorePairsTab, SldOverlay,
│       │                          # DetachableTabHost, MemoizedSvgContainer, ErrorBoundary
│       │                          # + modals/ (SettingsModal, ReloadSessionModal,
│       │                          #            ConfirmationDialog)
│       └── utils/                 # svgUtils, overloadHighlights, sessionUtils,
│                                  # interactionLogger, popoverPlacement, mergeAnalysisResult
├── standalone_interface.html  # Self-contained single-file HTML mirror of the React UI
│                              # (~7300 lines, no React imports). Ships independently.
│                              # See "Standalone Interface Parity Audit" section below.
├── docs/                      # Design docs (perf, save-results, interaction-logging,
│                              # action-overview-diagram, state-reset-and-confirmation-dialogs,
│                              # detachable-viz-tabs, …)
├── data/                      # Sample grids: bare_env_small_grid_test, pypsa_eur_fr400
├── benchmarks/                # Perf scripts (bench_load_study, _bench_common)
├── Overflow_Graph/            # Generated PDFs (created at runtime)
├── overrides.txt              # Pinned versions for transitive Python deps
├── test_*.py / verify_*.py    # Root-level integration scripts (NOT part of pytest)
├── reproduce_error.py / repro_stuck.py / fix_zoom.py / inspect_metadata.py
│                              # Ad-hoc dev/debug utilities
└── .gitignore                 # Excludes __pycache__/, *.pyc, *.pyo
```

### Per-subtree CLAUDE.md files

| File | Scope |
|------|-------|
| `CLAUDE.md` (this file) | Project overview, API table, conventions, **standalone parity audit** |
| `expert_backend/CLAUDE.md` | Backend internals: singletons, mixin composition, state lifecycle, NDJSON streaming, gzip helpers, layout cache invariants, NAD prefetch |
| `expert_backend/tests/CLAUDE.md` | Test conventions, the `conftest.py` mock layer for `pypowsybl` / `expert_op4grid_recommender`, frontend Vitest patterns |
| `frontend/CLAUDE.md` | Frontend internals: hook split, data flow, state reset, SVG performance levers, detached/tied tabs, interaction logger contract |

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
- **framer-motion** - Animations
- **lucide-react** - Icons

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

Tests are integration tests that require a running backend with valid data paths:

```bash
# Start the backend first, then:
python test_backend.py         # Config, branches, and analysis tests
python test_api_stream.py      # Streaming response tests
python test_n1_api.py          # N-1 contingency diagram tests
python test_voltage_api.py     # Voltage levels API tests
python verify_n1_simulation.py # N-1 simulation verification
```

Frontend unit tests use Vitest:

```bash
cd frontend
npm run test         # Run Vitest test suite
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/config` | Set network path, action file path, and all recommender parameters |
| GET | `/api/branches` | List disconnectable elements (lines + 2-winding transformers) |
| GET | `/api/voltage-levels` | List voltage levels in the network |
| GET | `/api/nominal-voltages` | Map voltage level IDs to nominal voltages (kV) |
| GET | `/api/element-voltage-levels` | Resolve equipment ID to its voltage level IDs |
| POST | `/api/run-analysis` | Run full N-1 contingency analysis (streaming NDJSON) |
| POST | `/api/run-analysis-step1` | Two-step analysis Part 1: detect overloads |
| POST | `/api/run-analysis-step2` | Two-step analysis Part 2: resolve with actions (streaming NDJSON) |
| GET | `/api/network-diagram` | Get N-state network SVG diagram (NAD) |
| POST | `/api/n1-diagram` | Get post-contingency N-1 diagram with flow deltas |
| POST | `/api/action-variant-diagram` | Get network state after applying a remedial action |
| POST | `/api/focused-diagram` | Generate NAD sub-diagram focused on a specific element |
| POST | `/api/action-variant-focused-diagram` | Focused NAD for specific VL in post-action state |
| POST | `/api/n-sld` | Single Line Diagram for voltage level in N state |
| POST | `/api/n1-sld` | Single Line Diagram in N-1 state (with flow deltas) |
| POST | `/api/action-variant-sld` | SLD in post-action state |
| GET | `/api/actions` | Return all available action IDs and descriptions |
| POST | `/api/simulate-manual-action` | Simulate a specific action against a contingency |
| POST | `/api/compute-superposition` | Compute combined effect of two actions (superposition theorem) |
| POST | `/api/save-session` | Save session folder with JSON snapshot + PDF copy |
| GET | `/api/list-sessions` | List available session folders in a directory |
| POST | `/api/load-session` | Load session JSON and restore PDFs |
| POST | `/api/restore-analysis-context` | Restore analysis context from saved session |
| GET | `/api/pick-path` | Open native OS file/directory picker (tkinter subprocess) |
| GET | `/results/pdf/{filename}` | Serve generated PDF files from `Overflow_Graph/` |

## Key Patterns & Conventions

### Backend
- **Singleton services**: `network_service` and `recommender_service` are module-level singleton instances
- **Streaming responses**: Analysis uses `StreamingResponse` with NDJSON (`application/x-ndjson`), yielding `{"type": "pdf", ...}` then `{"type": "result", ...}` events
- **AC/DC fallback**: Analysis first tries AC load flow; falls back to DC if AC does not converge
- **Threaded analysis**: `run_analysis` runs the computation in a background thread and polls for PDF generation
- **JSON sanitization**: NumPy types are recursively converted to native Python types via `sanitize_for_json()`
- **Shared diagram helpers**: `RecommenderService` uses `_load_network()`, `_load_layout()`, `_default_nad_parameters()`, and `_generate_diagram()` to deduplicate diagram generation logic across endpoints
- **Focused diagrams**: The `/api/focused-diagram` endpoint resolves an element to its voltage levels and generates a sub-diagram with configurable depth, useful for inspecting specific parts of large grids
- **No formal Python linter config**: Code follows PEP 8 conventions manually

### Frontend
- **Strict TypeScript**: `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`
- **Functional components** with React hooks; no external state management library
- **Inline styles**: Components use inline `style` objects rather than CSS modules or utility classes
- **Component architecture (Phase 1 refactored)**:
  - `App.tsx` (~650 lines) is the **state orchestration hub** — it wires all hooks together and handles cross-hook logic (e.g., `handleApplySettings`). It should NOT contain large JSX blocks.
  - **Presentational components** live in `components/` and `components/modals/`. They receive data and callbacks via typed props; all business logic stays in `App.tsx`.
  - `useSettings.ts` exposes `SettingsState` (all settings values + setters), which is passed wholesale to `SettingsModal` to avoid 30+ prop-drilling.
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
- See `docs/save-results.md` for session save/load, `docs/interaction-logging.md` for the replay contract, and `docs/action-overview-diagram.md` for the Remedial Action overview (pin overlay on N-1 network)

### SVG Visualization
Both the React frontend and `standalone_interface.html` render pypowsybl
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
- **Pan/zoom**: React uses `react-zoom-pan-pinch` (smooth,
  inertia-aware); standalone uses inline viewBox math (basic, no
  inertia). See the parity audit below for the gap.

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
- CORS is configured to allow all origins (`allow_origins=["*"]`)
- **Frontend architecture (Phase 1 refactored)**: `App.tsx` is the state orchestration hub; it must NOT contain large inline JSX blocks. Extracted presentational components live in `components/` and `components/modals/`. When adding new UI sections, create a new component file and wire it in `App.tsx`.
- **`useSettings` hook**: Exposes a `SettingsState` object with all settings fields + setters. This is passed wholesale to `SettingsModal` to avoid excessive prop drilling. Adding a new setting means: (1) add to `useSettings.ts`, (2) add to `SettingsModal.tsx`, (3) mirror in `standalone_interface.html`.
- **`standalone_interface.html`**: A self-contained single-file version of the full UI. It does **not** import React components — it has its own inline JSX for all UI sections. When making UI changes, **always mirror them manually** in the standalone interface.
- There is no CI/CD pipeline, Dockerfile, or containerization configured
- Root `.gitignore` excludes `__pycache__/`, `*.pyc`, `*.pyo`; `frontend/.gitignore` handles frontend build artifacts
- Root-level Python scripts (`test_*.py`, `reproduce_error.py`, `repro_stuck.py`, `fix_zoom.py`, `inspect_metadata.py`) are ad-hoc development/debugging utilities, not part of the main application
- `overrides.txt` contains pinned versions for transitive Python dependencies that need to be forced to specific versions
- **Frontend unit tests** use Vitest + React Testing Library. Isolated component tests live as `*.test.tsx` files next to their component. Run with `cd frontend && npm run test`. No backend mocking is needed for component tests since they only use mocked props.
- The two-step analysis flow (step1: detect overloads, step2: resolve) is the primary user workflow; the single-step `/api/run-analysis` is a legacy alternative
- Session save/load is documented in `docs/save-results.md`

---

## Standalone Interface Parity Audit

`standalone_interface.html` is a self-contained single-file mirror of the
React UI (~7300 lines of inline HTML + JS + CSS; no React imports, no
build step). It must remain **functionally equivalent** to the canonical
React app in `frontend/` — the audit below enumerates the current gap as
of 2026-04-19. Use this section as the work list when updating the
standalone interface.

The React frontend is the **source of truth**. When the two diverge, the
standalone must be brought up, not the other way around.

### Frontend Feature Inventory

Grouped by domain. Each item lists the primary React source file(s)
(see `frontend/CLAUDE.md` for directory structure).

#### Header & Study Loading
- **Load Study button** — `components/Header.tsx`, wired in `App.tsx::handleLoadConfig`
- **Save Results button** — `components/Header.tsx`, `hooks/useSession.ts::handleSaveResults`
- **Reload Session button** — `components/Header.tsx`, `hooks/useSession.ts::handleOpenReloadModal`
- **Settings button** — `components/Header.tsx`, opens `SettingsModal`
- **Network path input** (banner) — synchronised with the Paths-tab field in settings
- **Logo** (⚡ Co-Study4Grid) — `components/Header.tsx`

#### Settings Modal (3 tabs)
- **Paths tab** — network, action dict, layout, output folder, config-file paths; native pickers — `components/modals/SettingsModal.tsx`
- **Recommender tab** — min line reconnections/disconnections, min close/open coupling, min PST, min load shedding, min renewable curtailment, N prioritized actions, ignore-reconnections checkbox
- **Configurations tab** — monitoring factor, lines monitoring file path + counts, pre-existing overload threshold, pypowsybl fast mode
- **Config-file path management** — load/save the user config JSON, `changeConfigFilePath` — `hooks/useSettings.ts`
- **Monitored / total lines count** displayed on Configurations tab
- **Action dict stats** (reco / disco / pst / open_coupling / close_coupling / total) — surfaced from the `/api/config` response

#### Contingency Selection
- **Branch datalist dropdown** with type-ahead filter — `App.tsx` + Header integration
- **Human-readable name resolution** (`nameMap: ID → display name`) — `App.tsx::displayName`
- **Confirmation dialog** on contingency change when analysis state exists — `components/modals/ConfirmationDialog.tsx`, `App.tsx`
- **Sticky summary** showing selected contingency + N-1 overloads with zoom buttons — `components/ActionFeed.tsx`

#### Two-Step Analysis Flow
- **Step 1**: detect N-1 overloads — `hooks/useAnalysis.ts`, `/api/run-analysis-step1`
- **Overload selection panel** — multi-select checkboxes on detected overloads — `components/OverloadPanel.tsx`
- **`monitor_deselected` toggle** — widen analysis scope to deselected overloads — `components/OverloadPanel.tsx`
- **Step 2 streaming run** — NDJSON with early `pdf` event then `result` event — `hooks/useAnalysis.ts`, `/api/run-analysis-step2`

#### Action Feed (sidebar)
- **Action cards** — one per action, colour-coded by bucket — `components/ActionCard.tsx`, `components/ActionFeed.tsx`
- **Search / filter dropdown** — by ID, description, type filters (disco/reco/pst/ls/rc/…) — `components/ActionSearchDropdown.tsx`
- **Three buckets**: Suggested (recommender output), Selected (starred), Rejected — `hooks/useActions.ts`
- **Star / un-star** — `handleActionFavorite` — `hooks/useActions.ts`
- **Reject / un-reject** — `handleActionReject` — `hooks/useActions.ts`
- **Badges**: max-rho-line, load shedding count, renewable curtailment count, PST tap range, DC fallback — `components/ActionCard.tsx`
- **Scroll-to-selected** — `App.tsx::scrollToActionRef`
- **Load shedding details popup** — list of (load, MW) — `components/ActionCard.tsx`
- **Curtailment details popup** — list of (generator, MW curtailed) — `components/ActionCard.tsx`
- **PST details popup** — PST name → tap position, range — `components/ActionCard.tsx`
- **Manual action add** — search dropdown + "Add Manual Action" button — `components/ActionFeed.tsx`

#### Action-Variant Diagrams
- **Fetch on action select** — `hooks/useDiagrams.ts`, `/api/action-variant-diagram`
- **Network / Delta mode toggle** — `components/VisualizationPanel.tsx`
- **Focused action-variant diagram** — per-VL sub-diagram in post-action state — `/api/action-variant-focused-diagram`
- **Action-variant SLD** — triggered by VL double-click on action tab — `/api/action-variant-sld`

#### Visualization Panel
- **SVG render** with `react-zoom-pan-pinch` — `components/VisualizationPanel.tsx`, `hooks/usePanZoom.ts`
- **Zoom controls** — manual zoom in/out/reset — per-tab `usePanZoom` instance
- **Tabs**: N / N-1 / Action / Overflow (PDF) — `components/VisualizationPanel.tsx`
- **Inspect query (zoom-to-element)** — `usePanZoom.ts::zoomToElement`, `App.tsx::inspectQuery`
- **Voltage range filter** — slider hiding elements outside the selected kV band — `hooks/useDiagrams.ts::voltageRange`
- **Dynamic SVG scaling for large grids** (≥ 500 VLs) — `utils/svgUtils.ts::boostSvgForLargeGrid`
- **Asset click zoom + highlight** — `App.tsx::handleAssetClick`
- **Contingency highlight** — `utils/svgUtils.ts::applyContingencyHighlight` (uses `vector-effect`)
- **Overload highlights** — `utils/overloadHighlights.ts::computeN1OverloadHighlights`
- **Delta highlights** — `utils/svgUtils.ts::applyDeltaVisuals`
- **Zoom-tier LOD** — per-tier CSS classes hide text-heavy elements at overview zoom — `App.css`

#### Combined Actions Modal
- **Pair selection** (checkbox, max 2) — `components/CombinedActionsModal.tsx`
- **Superposition computation** (estimate max rho without simulation) — `/api/compute-superposition`
- **`ComputedPairsTable`** component for pre-computed pairs — `components/ComputedPairsTable.tsx`
- **`ExplorePairsTab`** component for all scored actions — `components/ExplorePairsTab.tsx`
- **Simulate combined** — full simulation of the pair — `/api/simulate-manual-action`

#### Action Overview Diagram
- **N-1 NAD with pin overlay** — one pin per prioritized action — `components/ActionOverviewDiagram.tsx`
- **`ActionCardPopover` preview** — hover pin → floating action summary — `components/ActionCardPopover.tsx`
- **Pin double-click navigation** — scroll sidebar to the action without selecting
- **Independent pan/zoom** — dedicated `usePanZoom` instance for the overview map

#### SLD Overlay
- **VL double-click → SLD popup** — `hooks/useSldOverlay.ts`, `App.tsx::handleVlDoubleClick`
- **N / N-1 / Action tabs** on the SLD — `components/SldOverlay.tsx`
- **Switch change visualisation** — changed breakers/switches highlighted — `components/SldOverlay.tsx`
- **Delta flow mode** — P/Q flow changes with direction arrows
- **SLD pan/zoom** — wheel zoom + drag
- **Auto-center on load** — fit-to-viewport

#### Detached + Tied Tabs
- **Detach tab into popup window** — `hooks/useDetachedTabs.ts`, `components/DetachableTabHost.tsx`
- **Tied viewBox sync** — one-way mirror from detached to main — `hooks/useTiedTabsSync.ts`
- **Focus detached tab** from the main window — `useDetachedTabs.ts::focus`

#### Session Save / Load
- **Save snapshot** to folder (or browser download) — `hooks/useSession.ts::handleSaveResults`, `/api/save-session`
- **List-sessions modal** — `components/modals/ReloadSessionModal.tsx`, `/api/list-sessions`
- **Restore session** — configuration + contingency + analysis state — `/api/load-session`
- **`restore-analysis-context`** — rehydrate `selectedOverloads`, monitored lines, computed pairs — `/api/restore-analysis-context`

#### Interaction Logger
- **Typed event recording** — `utils/interactionLogger.ts`, `types.ts::InteractionType` union
- **Correlation IDs** for async start/completion pairs
- **Replay-ready details** — each event carries every input needed to replay the gesture
- **Saved alongside session** as `interaction_log.json`

#### Confirmation Dialogs (shared component)
- **Contingency change** — warns if analysis state exists
- **Load Study** — warns before resetting
- **Apply Settings** — warns before resetting
- All three use `components/modals/ConfirmationDialog.tsx`

#### Error Handling
- **`ErrorBoundary`** — catches render errors — `components/ErrorBoundary.tsx`
- **Error toasts** — `App.tsx::setError`
- **Info messages** — `App.tsx::setInfoMessage`
- **Monitoring warning** — yellow banner when lines are unmonitored — `components/OverloadPanel.tsx`

#### Performance Optimizations
- **`format=text` diagram fetch** — skip `JSON.parse` on ~25 MB SVG strings — `api.ts::getNetworkDiagram`
- **Parallel boot XHRs** — branches + VLs + nominal voltages + N diagram in a single `Promise.all` — `App.tsx`
- **`getIdMap` WeakMap cache** — avoid re-scanning `[id]` on every highlight pass — `utils/svgUtils.ts`
- **NAD prefetch consumption** — backend pre-computes base NAD during `/api/config`; frontend consumes it near-instantly
- **`MemoizedSvgContainer`** — `React.memo` wrapper — `components/MemoizedSvgContainer.tsx`
- **Zoom-tier LOD** — hide text-heavy elements at overview zoom

### Standalone HTML Mirror Status

Legend: ✅ mirrored · ⚠️ partial (gap noted) · ❌ missing

| Feature group | Item | Status | Gap / note |
|---|---|---|---|
| **Header** | Load Study, Save, Reload, Settings buttons | ✅ | — |
| **Header** | Network path input, logo | ✅ | — |
| **Settings** | Paths tab (all 5 fields + pickers) | ✅ | — |
| **Settings** | Recommender tab (all sliders + ignore-reconnections) | ✅ | — |
| **Settings** | Configurations tab (monitoring factor, lines file, threshold, fast mode) | ✅ | — |
| **Settings** | Config-file path management | ✅ | — |
| **Settings** | Action dict stats display | ✅ | — |
| **Settings** | `settings_tab_changed` interaction log | ✅ | Emitted on every Paths/Recommender/Configurations tab click |
| **Settings** | `path_picked` interaction log | ✅ | Emitted from the native file/dir picker |
| **Contingency** | Datalist dropdown | ⚠️ | Shows IDs only — no human-readable name resolution in the options |
| **Contingency** | Confirmation dialog on change | ✅ | Uses `window.confirm()` |
| **Contingency** | Sticky summary strip | ✅ | — |
| **Analysis** | Step 1 detect | ✅ | — |
| **Analysis** | Overload selection panel | ✅ | — |
| **Analysis** | `monitor_deselected` toggle | ✅ | — |
| **Analysis** | Step 2 streaming (pdf + result events) | ✅ | — |
| **ActionFeed** | Cards, search, 3 buckets | ✅ | — |
| **ActionFeed** | Star / reject / manual-add | ✅ | — |
| **ActionFeed** | Max-rho / LS / RC / PST badges | ✅ | — |
| **ActionFeed** | DC-fallback badge | ⚠️ | `non_convergence` tracked but not surfaced in the filter dropdown |
| **ActionFeed** | Scroll-to-selected | ✅ | — |
| **ActionFeed** | Load-shedding details popup | ❌ | Badge shows count only — no per-load breakdown popup |
| **ActionFeed** | Curtailment details popup | ❌ | Badge shows count only — no per-generator breakdown popup |
| **ActionFeed** | PST details popup | ❌ | Tap shown inline on the card — no separate popup with range & start |
| **ActionFeed** | Re-simulate (MW + tap) interaction log | ✅ | Now emits `action_mw_resimulated` / `pst_tap_resimulated` |
| **ActionVariant** | Fetch on select | ✅ | — |
| **ActionVariant** | Network / Delta mode toggle | ✅ | — |
| **ActionVariant** | N / N-1 / Action tabs | ✅ | — |
| **ActionVariant** | SLD on VL double-click | ✅ | — |
| **Visualization** | SVG render | ✅ | — |
| **Visualization** | Pan / zoom | ⚠️ | Inline viewBox math — not `react-zoom-pan-pinch`; no inertia / gesture smoothing |
| **Visualization** | Zoom in / out / reset buttons | ✅ | — |
| **Visualization** | N / N-1 / Action / Overflow tabs | ✅ | — |
| **Visualization** | Inspect-query zoom | ⚠️ | Basic viewBox math; not the polished `usePanZoom` behaviour |
| **Visualization** | `inspect_query_changed` interaction log | ✅ | — |
| **Visualization** | Voltage range filter | ✅ | — |
| **Visualization** | `boostSvgForLargeGrid` scaling | ✅ | — |
| **Visualization** | Asset click zoom | ✅ | — |
| **Visualization** | Contingency highlight | ⚠️ | Uses clone halo — not the `vector-effect` approach; heavier on re-render |
| **Visualization** | Overload / delta highlights | ✅ | — |
| **Visualization** | Zoom-tier LOD (hide labels at overview) | ❌ | SVG always fully rendered regardless of zoom tier |
| **Combined Actions** | Pair checkbox selection | ✅ | — |
| **Combined Actions** | Superposition compute | ✅ | — |
| **Combined Actions** | ComputedPairsTable | ⚠️ | Rendered inline, not as a discrete reusable component |
| **Combined Actions** | ExplorePairsTab | ⚠️ | Rendered inline, not as a discrete component |
| **Combined Actions** | Simulate combined | ✅ | — |
| **Action Overview** | N-1 NAD with pin overlay | ✅ | Minimal port — one pin per prioritized action at the midpoint of its `max_rho_line`; no multi-pin fan-out, no combined-action curves. All 9 `overview_*` events fire at the documented gesture points. |
| **Action Overview** | ActionCardPopover on pin hover | ⚠️ | Minimal popover (id / description / max ρ / "View action" button). Not the full ActionCard component — no favorite/reject buttons inside the popover. |
| **Action Overview** | Pin double-click nav | ✅ | 250 ms debounce so single-click opens popover, double-click calls `handleActionSelect` |
| **Action Overview** | Independent zoom controls | ⚠️ | `+ / − / Fit` buttons emit `overview_zoom_*` events; they don't manipulate viewBox separately from the main action-tab pan/zoom. Good enough for replay, less polished than React's dedicated instance. |
| **Action Overview** | Inspect search | ✅ | Text input emits `overview_inspect_changed { query, action: 'focus'\|'cleared' }` |
| **SLD** | VL double-click popup | ✅ | — |
| **SLD** | N / N-1 / Action tabs | ✅ | — |
| **SLD** | Switch change highlight | ✅ | — |
| **SLD** | Delta flow mode | ✅ | — |
| **SLD** | Pan / zoom | ✅ | — |
| **SLD** | Auto-center on load | ✅ | — |
| **Detached tabs** | Pop into separate window | ❌ | **Deliberately deferred.** Requires `window.open` + `postMessage` IPC + per-window pan/zoom state. ~300-500 lines of infrastructure in the single-file HTML with behavioural risks (popup blockers, IPC ordering) that are hard to validate without a real browser. None of the 4 missing events (`tab_detached`, `tab_reattached`, `tab_tied`, `tab_untied`) appear in the canonical 11-gesture replay sequence, so replay agents against session logs without detached-tab gestures still work unchanged. |
| **Detached tabs** | Tied viewBox sync | ❌ | Depends on detach support |
| **Detached tabs** | Focus-from-main | ❌ | Depends on detach support |
| **Session** | Save to folder | ✅ | — |
| **Session** | Browser download fallback | ✅ | — |
| **Session** | List-sessions modal | ✅ | — |
| **Session** | Restore configuration + contingency + analysis state | ✅ | — |
| **Session** | Restore interaction log | ✅ | — |
| **Interaction log** | Event-type coverage | ⚠️ | 4/55 spec types still missing — **all four** Detached + Tied Tabs events. Every other gesture (including all 9 Action Overview events) now logs on both sides. |
| **Interaction log** | `details` schema conformance | ✅ | All emitted standalone events are spec-conformant; historical `min_kv/max_kv`, `target_tab`, `from_tab/to_tab`, `missing tab/scope` drifts all resolved |
| **Interaction log** | `recordCompletion` pairs | ⚠️ | Only `analysis_step{1,2}_completed` emitted — shared gap against the spec (fix needed on both sides) |
| **Interaction log** | Replay-ready details | ✅ | — |
| **Interaction log** | Saved with session | ✅ | — |
| **Confirmation** | Contingency change | ✅ | `window.confirm()` + emits `contingency_confirmed { type: 'contingency', pending_branch }` |
| **Confirmation** | Load Study | ✅ | `window.confirm()` + emits `contingency_confirmed { type: 'loadStudy' }` |
| **Confirmation** | Apply Settings | ✅ | `window.confirm()` + emits `contingency_confirmed { type: 'applySettings' }` |
| **Errors** | ErrorBoundary | ❌ | No catastrophic-render guard — only error-state message display |
| **Errors** | Error / info / monitoring-warning messages | ✅ | — |
| **Perf** | `format=text` diagram fetch | ⚠️ | Behaviour assumed from rendering; not obviously wired to the `format=text` endpoint |
| **Perf** | Parallel boot XHRs | ✅ | `Promise.all([branches, VLs, nominal voltages])` |
| **Perf** | `getIdMap` WeakMap cache | ✅ | — |
| **Perf** | MemoizedSvgContainer | ❌ | No memoisation wrapper — inline SVG render |
| **Perf** | Zoom-tier LOD | ❌ | No tier-based element hiding |

### Parity Gap Priority

#### Top-priority gaps (biggest user impact — do first)
1. ~~**Action Overview Diagram + pin navigation**~~ — **DONE** (minimal port). Pins on the N-1 NAD, single-click popover, double-click navigation, zoom + inspect controls all wired, all 9 `overview_*` events fire. Follow-up polish: multi-pin fan-out on shared anchors, combined-action curves, full ActionCard in the popover.
2. **Detached + tied tabs** — deliberately deferred. No way to compare N vs Action or N-1 vs Action side-by-side. Requires `window.open` + `postMessage` IPC. See `docs/detachable-viz-tabs.md` and the "Detached tabs" row above for the deferral rationale.
3. **Pan/zoom migration to `react-zoom-pan-pinch`** — standalone uses raw viewBox math with no inertia or gesture smoothing. On large grids this is the single biggest UX regression versus the React app.
4. **Zoom-tier LOD** — large grids (500+ VLs) render ALL text at overview zoom and become unreadable; React hides text-heavy elements per tier. See `docs/rendering-optimization-plan.md`.
5. **Load-shedding / curtailment / PST details popups** — three separate popups in the React `ActionCard` that expose per-item breakdowns; currently replaced by a badge count only.
6. **Contingency highlight rendering** — standalone uses clone halos; React uses `vector-effect: non-scaling-stroke`. Functionally similar but React's approach is cheaper on repeated contingency changes.
7. **Name-resolution in datalist** — surfacing `nameMap[id]` in the dropdown options. Very low effort, high frequent-use payoff on grids with 1000+ branches.
8. **Confirmation dialog before Apply Settings** — parity with the existing Load-Study / contingency-change confirmations.
9. **Interaction log correlation IDs on all async flows** — the replay contract requires start/completion pairs; standalone currently emits only partial pairs.
10. **Extracting inline `ComputedPairsTable` and `ExplorePairsTab`** into discrete JS modules within the standalone file. Low functional impact but improves maintainability.

#### Deferrable gaps (cosmetic / marginal)
1. **ErrorBoundary** — catastrophic-render guard. Rare in practice.
2. **MemoizedSvgContainer** — `React.memo` equivalent; marginal perf.
3. **`format=text` diagram fetch wiring** — confirm the standalone uses the `format=text` variant for large SVGs (saves ~500 ms of `JSON.parse`).
4. **DC-fallback badge in the filter dropdown** — `non_convergence` is tracked but not filterable by users.
5. **SVG prefetch of alternate variants** — pre-fetch N-1 SLD while viewing the N action variant. On-demand load is acceptable.

#### Features in the standalone that are no longer in React
None identified. The standalone is strictly a subset of the React app — there is no obsolete code path to remove. If a feature is removed from `frontend/`, delete it from `standalone_interface.html` in the same commit.

### Machine-grounded findings

The feature table above is human-curated. Two static conformity
scripts produce the machine-authoritative tables below; regenerate
them via `python scripts/check_standalone_parity.py --emit-markdown`
and `python scripts/check_session_fidelity.py --json`. See
`scripts/PARITY_README.md` for the three-layer design
(static / session-fidelity / E2E) and how to wire the first two
into CI.

#### Layer 1 — Static parity (`scripts/check_standalone_parity.py`)

_Generated from the parity script on 2026-04-19._
`InteractionType` union: **55** types. Frontend emits **51**,
standalone emits **47** (was 38 — the 9-event Action Overview
feature ported in this commit).

##### Event types emitted by the frontend but NOT by the standalone (4)

Down from 13 and 19 across the last two audits. Every remaining
miss is one of the four **Detached + Tied Tabs** events. Porting
them requires `window.open` + `postMessage` IPC infrastructure that
doesn't exist in the single-file HTML and introduces behavioural
risk (popup blockers, IPC ordering races) that's hard to validate
without a real browser runtime — see the "Detached tabs" row in
the mirror-status table above for the deferral rationale.

| Event type | Feature | React source |
|---|---|---|
| `tab_detached` / `tab_reattached` | Pop tab into separate window | `App.tsx:211,225` |
| `tab_tied` / `tab_untied` | Mirror detached viewBox | `hooks/useTiedTabsSync.ts:97,107` |

Nothing in the standalone emits an event the union does not know
about (0 orphan types).

##### Details-key drift between frontend and standalone (1)

Down from 11. The remaining diff is spec-conformant on both sides
(the frontend's extra key is optional per the contract):

| Event | Frontend | Standalone | Note |
|---|---|---|---|
| `inspect_query_changed` | `{query, target_tab}` | `{query}` | `target_tab` is optional per spec — only populated when the inspect field is triggered from a detached-tab overlay (which the standalone doesn't support). Not a bug. |

##### Spec conformance (FE-vs-spec, SA-vs-spec)

- Frontend drifts: **0** (was 4 earlier in this branch; all resolved).
- Standalone drifts: **0** (was 14 earlier in this branch; all resolved by this commit's SA-drift fixes — `asset_clicked`, `diagram_tab_changed`, `sld_overlay_tab_changed`, `view_mode_changed`, `voltage_range_changed`, `zoom_in/out/reset`, `config_loaded`, `prioritized_actions_displayed`, and the harmless extras on `manual_action_simulated`, `session_saved`, `sld_overlay_opened`, `session_reload_modal_opened`).

##### Historical fixes on the React side (6 events resolved)

All six spec drifts that existed earlier in this branch are now
fixed, each with a regression test. The Python parity script +
Vitest `specConformance.test.ts` guard against re-introduction:

| Event | Fix | Regression test |
|---|---|---|
| `action_deselected` | `{action_id}` → `{previous_action_id}` | `hooks/useDiagrams.test.ts` |
| `analysis_step2_started` | added `element` + `all_overloads` | `hooks/useAnalysis.test.ts` |
| `overload_toggled` | added `selected` (post-toggle state) | `hooks/useAnalysis.test.ts` |
| `prioritized_actions_displayed` | `actions_count` → `n_actions` | `hooks/useAnalysis.test.ts` |
| `analysis_step2_completed` | `actions_count` → `n_actions` | `hooks/useAnalysis.test.ts` |
| `view_mode_changed` (hook path) | Removed hook-internal emission (App.tsx owns full-spec) | `hooks/useDiagrams.test.ts` |

The fifth one was surfaced by the Vitest spec-conformance test, not
the Python script — the script's set-based union across call sites
was masking it behind `App.tsx`'s full-shape emission. The
spec-conformance test walks all call sites individually and catches
per-site drift.

##### Historical fixes on the standalone side (14 events resolved)

All fourteen SA spec drifts that existed earlier in this branch are
now fixed:

| Event | Fix |
|---|---|
| `asset_clicked` | `target_tab` → `tab` |
| `diagram_tab_changed` | `{from_tab, to_tab}` → `{tab}` (destination) |
| `sld_overlay_tab_changed` | `{from_tab, to_tab}` → `{tab, vl_name}` |
| `view_mode_changed` | Added `tab: 'action'` + `scope: 'main'` |
| `voltage_range_changed` | `{min_kv, max_kv}` → `{min, max}` |
| `zoom_in` / `zoom_out` / `zoom_reset` | Added `tab: activeTab` |
| `config_loaded` | Added `output_folder_path` (was missing) |
| `prioritized_actions_displayed` | Added `n_actions` (was `{}`) |
| `manual_action_simulated` | Dropped empty `description: ''` extra |
| `session_saved` | Dropped `session_name` extra |
| `sld_overlay_opened` | Dropped `initial_tab` extra |
| `session_reload_modal_opened` | Dropped `{available_sessions, output_folder}` extras |

##### Standalone drifts from the replay-contract spec (14 events)

| Event | Spec required | Standalone emits | Missing | Standalone source |
|---|---|---|---|---|
| `asset_clicked` | `{action_id, asset_name, tab}` | `{action_id, asset_name, target_tab}` | `tab` | `standalone:3034,3056` |
| `config_loaded` | `{...17 settings + output_folder_path}` | 16 fields — missing `output_folder_path` | `output_folder_path` | `standalone:2054` |
| `diagram_tab_changed` | `{tab}` | `{from_tab, to_tab}` | `tab` | `standalone:6675` |
| `manual_action_simulated` | `{action_id}` | `{action_id, description}` | — (extra `description`, harmless) | `standalone:3823` |
| `prioritized_actions_displayed` | `{n_actions}` | `{}` | `n_actions` | `standalone:2834` |
| `session_reload_modal_opened` | `{}` | `{available_sessions, output_folder}` | — (extras, harmless) | `standalone:2477` |
| `session_saved` | `{output_folder}` | `{output_folder, session_name}` | — (extra `session_name`, harmless) | `standalone:2433` |
| `sld_overlay_opened` | `{action_id, vl_name}` | `{action_id, initial_tab, vl_name}` | — (extra `initial_tab`, harmless) | `standalone:3076` |
| `sld_overlay_tab_changed` | `{tab, vl_name}` | `{from_tab, to_tab}` | `tab, vl_name` | `standalone:5148` |
| `view_mode_changed` | `{mode, tab, scope}` | `{mode}` | `scope, tab` | `standalone:6762,6773` |
| `voltage_range_changed` | `{max, min}` | `{max_kv, min_kv}` | `max, min` | `standalone:5070,5083` |
| `zoom_in` | `{tab}` | `{}` | `tab` | `standalone:2148` |
| `zoom_out` | `{tab}` | `{}` | `tab` | `standalone:2163` |
| `zoom_reset` | `{tab}` | `{}` | `tab` | `standalone:2178` |

##### API paths referenced by the frontend but not by the standalone (0)

All API paths the React frontend exercises are now referenced in
the standalone. `/api/simulate-and-variant-diagram` was wired in
this commit as the primary path for the "simulate-then-fetch-
diagram" fallback: the standalone now consumes the NDJSON stream
(`metrics` event, then `diagram` event) and falls back to the
sequential `/api/simulate-manual-action` + `/api/action-variant-diagram`
pair if the stream fails — matching the React app's behaviour and
the per-event sidebar-first UX on slow NAD regenerations.

##### `recordCompletion` coverage

Both codebases emit the same two `*_completed` events:
`analysis_step1_completed` and `analysis_step2_completed`. The
replay spec lists more async wait-points that would benefit from
completion events (`action_selected`, `manual_action_simulated`,
`action_mw_resimulated`, `pst_tap_resimulated`,
`combine_pair_simulated`, `settings_applied`, `session_reloaded`,
`tab_detached` / `tab_reattached`) — this is a shared gap against
the spec, not a parity gap between the two codebases.

#### Layer 2 — Session-reload fidelity (`scripts/check_session_fidelity.py`)

_Generated from the fidelity script on 2026-04-19._ 30 curated
fields checked; 25/30 round-trip on React, 28/30 on standalone.

##### Fields the React frontend RESTORES but never SAVES

**0 fields — resolved** in this branch. The table below is the
historical record:

| Field | Fix | Regression test |
|---|---|---|
| `lines_overloaded_after` | Added to `SavedActionEntry` object literal in `sessionUtils.ts` | `utils/sessionUtils.test.ts::persists lines_overloaded_after so it survives save → reload (regression)` |

##### Fields absent from the standalone entirely (2 — warn)

| Field | Note |
|---|---|
| `n_overloads_rho`, `n1_overloads_rho` | The sticky-header rho arrays (PR #88). The React app intentionally saves-only (live state re-derives from a fresh N-1 diagram on reload). The standalone doesn't save them either — fine for live UX, but replay agents and offline inspection tools lose the percentages. |

#### Layer 3a — Gesture-sequence static proxy (`scripts/check_gesture_sequence.py`)

_Generated from the gesture-sequence script on 2026-04-19._
Canonical 11-step gesture sequence: **22/22** gesture-side parity
checks pass. For each gesture the script resolves the handler body
in both codebases and verifies the expected ordered list of
`interactionLogger.record(...)` + `recordCompletion(...)` calls is
present. Complements Layers 1 + 2 with sequence-awareness.

Limitations worth being aware of when a `22/22` pass lands:

- The walker sees **all** event-emission code paths in a handler,
  not just the one taken at runtime. `handleActionSelect` has both
  `action_selected` and `action_deselected` call sites (early-return
  on toggle), and Layer 3a reports both — a real Playwright run
  would fire only one per click.
- The walker cannot catch async ordering races (e.g. two XHRs that
  complete in non-deterministic order and emit events out-of-spec).
- Layer 3a does not check `details`-key shapes — that's Layer 1's
  job. Likewise it doesn't touch `session.json` shape — that's
  Layer 2. A passing 3a therefore does NOT mean parity overall.

#### Layer 3b — Behavioural E2E (`scripts/parity_e2e/e2e_parity.spec.ts`)

Real Playwright spec driving both UIs through the canonical gesture
sequence with a mocked backend (all `/api/*` calls fulfilled via
`page.route()`, so pypowsybl / expert_op4grid_recommender are NOT
required). The spec captures:

- Ordered list of `interactionLogger` events per run.
- `details` keys per event.
- `session.json` field paths.

And asserts three-way equality: React events == standalone events,
React keys == standalone keys, React session shape == standalone
session shape.

Runs in ~90 s including browser launch. Designed for **nightly
CI** or **on-label PR** runs, not per-commit (see the cost
discussion in `scripts/PARITY_README.md`). Not executed in the
sandbox this audit was generated from because Playwright's browser
download is blocked — the spec itself is committed and ready to
run in any standard CI environment with one-off setup:

```bash
cd scripts/parity_e2e
npm install
npx playwright install chromium
cd ../../frontend && npm run build
cd ../scripts/parity_e2e
npx playwright test
```

### Running the conformity checks

```bash
# Layer 1 — static parity (events, API paths, settings, spec diff)
python scripts/check_standalone_parity.py                # human text
python scripts/check_standalone_parity.py --emit-markdown  # regenerate tables above
python scripts/check_standalone_parity.py --json         # CI-friendly

# Layer 2 — session-reload fidelity (save-vs-restore symmetry)
python scripts/check_session_fidelity.py                 # human text
python scripts/check_session_fidelity.py --json          # CI-friendly

# Layer 3a — gesture-sequence static proxy
python scripts/check_gesture_sequence.py                 # human text
python scripts/check_gesture_sequence.py --json          # CI-friendly

# Layer 3b — behavioural E2E (needs a Playwright browser; see
# scripts/PARITY_README.md for the one-off setup)
cd scripts/parity_e2e && npx playwright test
```

All four exit non-zero on any FAIL finding.

### CI wiring

`.github/workflows/parity.yml` runs the checks automatically:

- **Layers 1 + 2 + 3a** — every push to `main` + every PR. Pure
  Python, no backend, no browser. Finishes in <30 s.
- **Layer 3b** — nightly (cron `30 2 * * *`) + whenever a PR
  carries the `e2e` label. Builds the React app, installs
  Chromium, runs the full Playwright spec. ~6 min on a fresh
  runner, ~2 min with cache.

The workflow also appends Layer 1's `--emit-markdown` output to
the GitHub Actions step summary on every run, so per-PR comments
show exactly which events drifted from the spec without waiting
for reviewer triage. A Markdown step-summary example:

```
| Event | Spec required | Frontend emits | Missing |
|---|---|---|---|
| action_deselected | {previous_action_id} | {action_id} | previous_action_id |
```

The matching Vitest **spec-conformance** test
(`frontend/src/utils/specConformance.test.ts`) runs as part of the
regular frontend suite — `npm run test`. It walks every
`interactionLogger.record` call site in the React source and
verifies the `details` keys per event match the replay contract.
This is the pre-PR gate; the Layer-1 parity script is the PR-gate
fallback that also checks the standalone HTML.

### How to use this audit

When updating `standalone_interface.html`:

1. Run `scripts/check_standalone_parity.py` first. Every FAIL line is
   a specific, actionable item with file:line anchors on both sides.
2. For each "event type missing in standalone" finding: open the
   React source file listed, understand the gesture, and add an
   equivalent `interactionLogger.record('<type>', { ... })` at the
   matching spot in the standalone.
3. For each "details-key drift" finding: check which side the spec
   (`docs/interaction-logging.md`) sides with, then fix that side.
4. When a new endpoint is added to the backend (`expert_backend/main.py`)
   and surfaced in `frontend/src/api.ts`, mirror it in the standalone's
   inline API wrapper **in the same PR** — the script's API-path
   check will catch any miss.
5. When adding a new setting field: add it to the `SettingsState`
   interface AND to the standalone's `useState` set with a
   convention-compatible name (the script normalises camelCase ↔
   snake_case automatically).
6. Run the standalone locally by opening it in a browser with the
   FastAPI backend running. Confirm the gesture, diagram, and
   interaction-log output match the React app side by side. The
   script catches shape drift but not behavioural drift — a future
   Layer-3 Playwright spec is the next step (see the conformity-script
   design in the session transcript).

Last audited: 2026-04-19 (branch `claude/fix-grid-layout-reset-8TYEV`).
Numbers above regenerated by
`scripts/check_standalone_parity.py` on the same branch.
