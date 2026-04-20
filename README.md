# Co-Study4Grid

**Co-Study4Grid** is a full-stack web application for **power grid contingency analysis and N-1 planning**. It provides an interactive interface on top of the [`expert_op4grid_recommender`](https://github.com/marota/Expert_op4grid_recommender) library, letting grid operators simulate element disconnections, visualize network overflows, and explore prioritized remedial actions — topology changes, PST tap adjustments, renewable curtailment, and load shedding — individually or combined.

> Formerly known as **ExpertAssist**. Rebranded to Co-Study4Grid in release 0.4 (PR #65).

![License: MPL 2.0](https://img.shields.io/badge/license-MPL--2.0-blue)
![Release](https://img.shields.io/badge/release-0.5.0-green)

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
- **Detachable tabs** (PR #86): pop any visualization tab out into a second browser window for dual-monitor workflows, with per-window pan/zoom, tie/untie, and automatic reattach. See [`docs/features/detachable-viz-tabs.md`](docs/features/detachable-viz-tabs.md).
- **Single-Line Diagrams (SLD)** for voltage levels in N, N-1, and post-action states, with persistent highlight of impacted switches and coupling breakers (PR #63).
- **Focused sub-diagrams**: auto-generate a NAD centered on a specific element with configurable depth — useful for inspecting parts of 10k-branch grids.
- **Robust highlighting**: contingencies, overloads and impacted assets are drawn as clone-based halos that survive pan, zoom, SLD overlay, and action-target dimming.
- **Auto-zoom** on contingency, newly overloaded line, or action target; pinned sticky feed summary and overload-click to jump to the N-1 tab (PR #88).
- **Zoom-tier level-of-detail** (PR #76): labels, nodes and flow arrows are dynamically boosted proportional to `sqrt(diagramSize / referenceSize)`, so large grids remain legible at any zoom.

### Sessions & replay
- **Save Results** / **Reload Session**: export the complete analysis state (config, contingency, actions with status tags, combined pairs, overflow PDF, loading ratios) to a timestamped session folder. See [`docs/features/save-results.md`](docs/features/save-results.md).
- **Replay-ready interaction log**: every UI interaction is written to `interaction_log.json` as a self-contained, timestamped event with correlation IDs for async completions — suitable for deterministic browser-automation replay. See [`docs/features/interaction-logging.md`](docs/features/interaction-logging.md).
- **Persistent user config**: paths, recommender parameters and UI preferences persist across sessions through a user-writable config file outside the repo (PR #59).
- **Confirmation dialogs** before destructive state resets (switching network, applying settings on an active study) so operators never lose work by accident.

### Frontend engineering
- **React 19 + TypeScript 5.9 + Vite 7**, strict mode (`noUnusedLocals`, `noUnusedParameters`).
- **Phase 1 refactor** (PR #74): `App.tsx` reduced from ~2100 → ~650 lines, now a pure state-orchestration hub; UI split into focused presentational components under `components/` and `components/modals/`.
- **Phase 2 state-management optimization** (PR #75): memoized wrappers, centralized state resets, `React.memo` on heavy children — eliminates unnecessary re-renders of the three heaviest components.
- **React ErrorBoundary** wrapping the app root (PR #82) to contain crashes.
- **Vitest + React Testing Library** unit tests co-located as `*.test.tsx`.
- **Standalone single-file UI** (`standalone_interface.html`) mirroring every feature of the React app, for zero-install demos.

---

## Performance Highlights (release 0.5.0)

Measured on the full French grid (~10k branches) with `scripts/profile_diagram_perf.py`. Full write-up in [`docs/performance/history/pr-perf-optimization-summary.md`](docs/performance/history/pr-perf-optimization-summary.md) and [`docs/performance/performance-profiling.md`](docs/performance/performance-profiling.md).

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
│       └── recommender_service.py   # Analysis orchestration, PDF/SVG generation
├── frontend/                    # React + TypeScript + Vite frontend
│   └── src/
│       ├── App.tsx                  # State orchestration hub (~650 lines)
│       ├── api.ts                   # Axios HTTP client
│       ├── types.ts                 # Shared TypeScript interfaces
│       ├── hooks/                   # Custom hooks (useSettings, useAnalysis, ...)
│       ├── utils/                   # sessionUtils, interactionLogger, svgUtils
│       └── components/              # Header, ActionFeed, VisualizationPanel,
│                                    # OverloadPanel, CombinedActionsModal, modals/
├── standalone_interface.html    # Self-contained single-file HTML version of the UI
├── docs/                        # Architecture, performance, and feature docs
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
| `POST` | `/api/action-variant-diagram` | Diagram after applying a remedial action |
| `POST` | `/api/focused-diagram` | Sub-diagram focused on an element with configurable depth |
| `POST` | `/api/action-variant-focused-diagram` | Focused NAD for a specific VL in post-action state |
| `POST` | `/api/n-sld` | Single Line Diagram for a voltage level in N state |
| `POST` | `/api/n1-sld` | SLD in N-1 state with flow deltas |
| `POST` | `/api/action-variant-sld` | SLD in post-action state |
| `GET`  | `/results/pdf/{filename}` | Serve generated overflow PDFs from `Overflow_Graph/` |

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
- **framer-motion** — animations
- **lucide-react** — icons
- **Vitest** + **React Testing Library** — unit tests

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

Frontend unit tests (Vitest):

```bash
cd frontend && npm run test
```

Backend integration tests (require a running backend with valid data paths):

```bash
python test_backend.py          # Config, branches, and analysis tests
python test_api_stream.py       # Streaming response tests
python test_n1_api.py           # N-1 contingency diagram tests
python test_voltage_api.py      # Voltage levels API tests
python verify_n1_simulation.py  # N-1 simulation verification
```

---

## Standalone Interface

`standalone_interface.html` is a self-contained single-file version of the UI that can be opened directly in a browser (pointed at a running backend). It mirrors every feature of the React app — including detachable tabs, SLD highlights, combined actions, PST / curtailment / load-shedding cards, interaction logging, and zoom-tier level of detail — with no build step.

When making UI changes, always mirror them in both the React app and the standalone interface.

---

## Data Formats

- **Network files**: `.xiidm` (loaded by pypowsybl)
- **Action definitions**: `.json` mapping action IDs to descriptions, supporting topology, PST, `set_load_p`, and `set_gen_p` formats
- **Network layouts**: `grid_layout.json` with node-ID → `[x, y]` coordinates
- **Generated outputs**: PDF overflow graphs in `Overflow_Graph/`
- **Session folder**: `costudy4grid_session_<contingency>_<timestamp>/` containing `session.json`, `interaction_log.json`, and an overflow PDF copy

---

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for the list of changes per release. The current release is **0.5.0**.

---

## License

Copyright 2025–2026 RTE France
RTE: <http://www.rte-france.com>

This Source Code is subject to the terms of the Mozilla Public License (MPL) v2, also available [here](https://www.mozilla.org/en-US/MPL/2.0/).
