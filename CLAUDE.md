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
├── standalone_interface_legacy.html  # DECOMMISSIONED 2026-04-20 — hand-maintained
│                              # single-file mirror kept on disk for reference only.
│                              # Untracked via .gitignore. Replaced by the auto-generated
│                              # `frontend/dist-standalone/standalone.html`
│                              # (`npm run build:standalone`). New UI changes land ONLY
│                              # in `frontend/src/` — no manual mirroring required.
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

### Per-subtree docs

| File | Scope |
|------|-------|
| `CLAUDE.md` (this file) | Project overview, API table, conventions, parity-audit pointer |
| `frontend/PARITY_AUDIT.md` | Full standalone-parity audit: feature inventory, mirror-status table, Layer 1–4 conformity findings, gap-priority list, deltas. Split out of this file 2026-04-20. |
| `expert_backend/CLAUDE.md` | Backend internals: singletons, mixin composition, state lifecycle, NDJSON streaming, gzip helpers, layout cache invariants, NAD prefetch |
| `expert_backend/tests/CLAUDE.md` | Test conventions, the `conftest.py` mock layer for `pypowsybl` / `expert_op4grid_recommender`, frontend Vitest patterns |
| `frontend/CLAUDE.md` | Frontend internals: hook split, data flow, state reset, SVG performance levers, detached/tied tabs, interaction logger contract |
| `docs/save-results.md` | Save / reload session contract (JSON schema, reload flow, regression-guard matrix) |
| `docs/interaction-logging.md` | Replay-ready event log contract |

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
- **`useSettings` hook**: Exposes a `SettingsState` object with all settings fields + setters. This is passed wholesale to `SettingsModal` to avoid excessive prop drilling. Adding a new setting means: (1) add to `useSettings.ts`, (2) add to `SettingsModal.tsx`. No manual standalone mirror is required — the legacy hand-maintained file has been decommissioned and the auto-generated bundle inherits from the React source automatically.
- **Standalone bundle (auto-generated)**: `npm run build:standalone` in `frontend/` produces `frontend/dist-standalone/standalone.html` — a single-file HTML with React + CSS inlined via `vite-plugin-singlefile`. This is the canonical distribution artifact replacing the former `standalone_interface.html`. The legacy file remains on disk as `standalone_interface_legacy.html` (untracked) for reference.
- There is no CI/CD pipeline, Dockerfile, or containerization configured
- Root `.gitignore` excludes `__pycache__/`, `*.pyc`, `*.pyo`; `frontend/.gitignore` handles frontend build artifacts
- Root-level Python scripts (`test_*.py`, `reproduce_error.py`, `repro_stuck.py`, `fix_zoom.py`, `inspect_metadata.py`) are ad-hoc development/debugging utilities, not part of the main application
- `overrides.txt` contains pinned versions for transitive Python dependencies that need to be forced to specific versions
- **Frontend unit tests** use Vitest + React Testing Library. Isolated component tests live as `*.test.tsx` files next to their component. Run with `cd frontend && npm run test`. No backend mocking is needed for component tests since they only use mocked props.
- The two-step analysis flow (step1: detect overloads, step2: resolve) is the primary user workflow; the single-step `/api/run-analysis` is a legacy alternative
- Session save/load is documented in `docs/save-results.md`

---

## Standalone Interface Parity Audit

The detailed audit — feature inventory, mirror-status table, Layer
1–4 conformity findings, regression-guard matrix, gap-priority list
and delta-vs-previous commits — lives in
[`frontend/PARITY_AUDIT.md`](frontend/PARITY_AUDIT.md). That
document is the working record of the parity project and is
updated as fixes land.

Quick status summary (2026-04-20):

- Canonical distribution is now the auto-generated
  `frontend/dist-standalone/standalone.html`
  (`npm run build:standalone`). The hand-maintained
  `standalone_interface.html` has been decommissioned and
  renamed to `standalone_interface_legacy.html` — untracked via
  `.gitignore`, kept on disk for reference only.
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
