# CLAUDE.md - Co-Study4Grid

## Project Overview

Co-Study4Grid is a full-stack web application for **power grid contingency analysis and N-1 planning**. It provides an interface to the `expert_op4grid_recommender` library, allowing operators to simulate element disconnections, visualize network overflow graphs, and receive prioritized remedial action recommendations.

## Architecture

**Monorepo** with two main components:

```
Co-Study4Grid/
├── .gitignore               # Excludes __pycache__/, *.pyc, *.pyo
├── CLAUDE.md                # Project documentation for AI assistants
├── expert_backend/          # Python FastAPI backend
│   ├── __init__.py
│   ├── main.py              # FastAPI app, API endpoints, CORS config
│   ├── requirements.txt     # Core Python deps (fastapi, uvicorn)
│   └── services/
│       ├── __init__.py
│       ├── network_service.py       # pypowsybl network loading & queries
│       └── recommender_service.py   # Analysis orchestration, PDF/SVG generation
├── frontend/                # React + TypeScript + Vite frontend
│   ├── index.html           # HTML entry point
│   ├── package.json         # Dependencies and scripts
│   ├── vite.config.ts       # Vite configuration
│   ├── eslint.config.js     # ESLint v9+ flat config
│   ├── tsconfig.json        # Root TypeScript config
│   ├── tsconfig.app.json    # App TypeScript config (strict mode)
│   ├── tsconfig.node.json   # Node/config TypeScript config
│   └── src/
│       ├── main.tsx          # React entry point (StrictMode)
│       ├── App.tsx           # Root component: state orchestration + hook wiring only (~650 lines)
│       ├── App.css           # App-specific styles
│       ├── index.css         # Global styles
│       ├── api.ts            # Axios HTTP client (base URL: localhost:8000)
│       ├── types.ts          # TypeScript interfaces
│       ├── hooks/
│       │   └── useSettings.ts        # Settings state hook (SettingsState interface + all setters)
│       ├── utils/
│       │   ├── sessionUtils.ts       # Session snapshot building (buildSessionResult)
│       │   ├── sessionUtils.test.ts  # Unit tests for session serialization
│       │   ├── interactionLogger.ts  # Singleton interaction event logger (replay-ready)
│       │   ├── interactionLogger.test.ts # Unit tests for interaction logger
│       │   └── popoverPlacement.ts   # Pure helpers for pin-popover positioning
│       └── components/
│           ├── Header.tsx              # Top bar: logo, network path input, Load/Save/Reload/Settings buttons
│           ├── Header.test.tsx         # Unit tests for Header
│           ├── ActionFeed.tsx              # Prioritized action results display with search/filter + auto-scroll on selection
│           ├── ActionOverviewDiagram.tsx  # N-1 NAD with pin overlay (overview of all actions)
│           ├── ActionCardPopover.tsx      # Shared floating ActionCard wrapper (pin click preview)
│           ├── VisualizationPanel.tsx     # SVG diagram rendering (NAD + SLD overlay)
│           ├── OverloadPanel.tsx          # Two-step analysis: detect → select → resolve
│           ├── CombinedActionsModal.tsx   # Superposition pair computation modal
│           └── modals/
│               ├── SettingsModal.tsx           # 3-tab settings dialog (paths, recommender, config)
│               ├── SettingsModal.test.tsx      # Unit tests for SettingsModal
│               ├── ReloadSessionModal.tsx      # Session reload list dialog
│               ├── ReloadSessionModal.test.tsx # Unit tests for ReloadSessionModal
│               ├── ConfirmationDialog.tsx      # Shared confirmation dialog (contingency/reload)
│               └── ConfirmationDialog.test.tsx # Unit tests for ConfirmationDialog
├── Overflow_Graph/          # Generated PDFs (created at runtime)
├── overrides.txt            # Additional Python dependency version pins
├── standalone_interface.html # Self-contained HTML version of the UI with SVG visualization
├── test_*.py / verify_*.py  # Root-level integration test scripts
├── reproduce_error.py       # Ad-hoc error reproduction script
├── repro_stuck.py           # Ad-hoc stuck analysis reproduction
├── fix_zoom.py              # Zoom/scaling fix utility
└── inspect_metadata.py      # SVG metadata inspection utility
```

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

### SVG Visualization (standalone_interface.html)
The standalone interface includes advanced SVG rendering for pypowsybl network-area diagrams:
- **Dynamic text scaling**: Font sizes for node labels, edge info, and legends scale proportionally to diagram size using `sqrt(diagramSize / referenceSize)`, so text is readable when zoomed in and naturally invisible at full zoom-out
- **Bus node scaling**: Circle radii for bus nodes and transformer windings are boosted proportionally
- **Edge info scaling**: Flow values and arrows along lines are scaled via transform groups
- **ViewBox zoom**: Auto-centers on selected contingency targets with adjustable padding
- **Interactive pan/zoom**: Wheel + drag for manual exploration via `react-zoom-pan-pinch`

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
