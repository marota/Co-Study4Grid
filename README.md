# Co-Study4Grid

A full-stack web application for **power grid contingency analysis and N-1 planning**. Co-Study4Grid provides an interface to the [`expert_op4grid_recommender`](https://github.com/rte-france/expert_op4grid_recommender) library, allowing grid operators to:

- Simulate element disconnections (N-1 contingency analysis)
- Visualize network overflow graphs and network-area diagrams
- Receive prioritized remedial action recommendations

## Architecture

Co-Study4Grid is a monorepo with a **Python FastAPI backend** and a **React + TypeScript frontend**.

```
Co-Study4Grid/
├── expert_backend/           # FastAPI backend (Python)
│   ├── main.py               # API endpoints and app configuration
│   └── services/
│       ├── network_service.py        # Network loading and queries (pypowsybl)
│       └── recommender_service.py    # Analysis orchestration and diagram generation
├── frontend/                 # React + TypeScript + Vite frontend
│   └── src/
│       ├── App.tsx            # Root layout component
│       ├── api.ts             # HTTP client
│       └── components/        # UI components (ConfigurationPanel, ActionFeed, VisualizationPanel)
├── standalone_interface.html  # Self-contained single-file HTML version of the UI
└── Overflow_Graph/            # Generated PDF output directory (created at runtime)
```

## Prerequisites

- **Python 3.10+** with the following packages available in your environment:
  - [`pypowsybl`](https://pypowsybl.readthedocs.io/)
  - [`expert_op4grid_recommender`](https://github.com/rte-france/expert_op4grid_recommender)
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
```

The API server starts on `http://localhost:8000`.

### 3. Install and start the frontend

```bash
cd frontend
npm install
npm run dev
```

The Vite dev server starts with HMR enabled. Open the URL shown in terminal (typically `http://localhost:5173`).

### 4. Use the application

1. Enter the path to a network data directory (containing `.xiidm` files) and an action definition JSON file
2. Click **Load Configuration** to load the network
3. Select a disconnectable element (line or transformer) from the dropdown
4. Click **Run Analysis** to perform the N-1 contingency analysis
5. View the overflow graph PDF and prioritized remedial actions

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/config` | Set network path and action file path |
| `GET` | `/api/branches` | List disconnectable elements (lines + transformers) |
| `GET` | `/api/voltage-levels` | List voltage levels in the network |
| `GET` | `/api/element-voltage-levels` | Resolve equipment ID to its voltage level IDs |
| `POST` | `/api/run-analysis` | Run N-1 contingency analysis (streaming NDJSON) |
| `GET` | `/api/network-diagram` | Get full network SVG diagram |
| `POST` | `/api/n1-diagram` | Get post-contingency network SVG diagram |
| `POST` | `/api/focused-diagram` | Generate sub-diagram focused on a specific element |
| `GET` | `/api/pick-path` | Open native OS file/directory picker |
| `GET` | `/results/pdf/{filename}` | Serve generated PDF files |

## Tech Stack

### Backend
- **FastAPI** + **Uvicorn** - Web framework and ASGI server
- **pypowsybl** - Power system network loading, load flow, and diagram generation
- **expert_op4grid_recommender** - Domain-specific grid optimization recommendations
- **grid2op** / **pandapower** / **lightsim2grid** - Grid simulation backends

### Frontend
- **React 19** with **TypeScript 5.9**
- **Vite 7** - Build tool and dev server
- **axios** - HTTP client
- **react-select** - Searchable dropdown for branch selection
- **react-zoom-pan-pinch** - Pan/zoom for SVG visualizations
- **framer-motion** - Animations
- **lucide-react** - Icons

## Development

### Build for production

```bash
cd frontend
npm run build
```

### Lint

```bash
cd frontend
npm run lint
```

### Integration tests

Tests require a running backend with valid network data paths:

```bash
python test_backend.py          # Config, branches, and analysis tests
python test_api_stream.py       # Streaming response tests
python test_n1_api.py           # N-1 contingency diagram tests
python test_voltage_api.py      # Voltage levels API tests
python verify_n1_simulation.py  # N-1 simulation verification
```

## Standalone Interface

`standalone_interface.html` is a self-contained single-file version of the UI that can be opened directly in a browser. It includes embedded SVG rendering with:

- Dynamic text/node scaling for large grid diagrams
- ViewBox-based zoom to auto-center on selected elements
- Interactive pan/zoom (wheel + drag)

## Data Formats

- **Network files**: `.xiidm` format (loaded by pypowsybl)
- **Action definitions**: `.json` files mapping action IDs to descriptions
- **Network layouts**: `grid_layout.json` with node ID to `[x, y]` coordinate mappings
- **Generated outputs**: PDF overflow graphs in the `Overflow_Graph/` directory

## License

See [LICENSE](LICENSE) for details.
