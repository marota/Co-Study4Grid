# Tests — Co-Study4Grid

## Overview

Co-Study4Grid has two test suites: **backend** (Python/pytest) and **frontend** (TypeScript/Vitest). Both run without the heavy domain packages (`pypowsybl`, `expert_op4grid_recommender`, `grid2op`) — a mock layer in `conftest.py` stubs them out.

## Running Tests

### Backend (pytest)

```bash
# From project root:
pytest                          # Run all backend tests
pytest expert_backend/tests/test_mw_start.py  # Single file
pytest -k "TestMwStart"         # By class/pattern
pytest -x                       # Stop on first failure
```

Configuration in `pytest.ini`:
- `testpaths = expert_backend/tests`
- `python_files = test_*.py`

### Frontend (Vitest)

```bash
cd frontend
npm run test                    # Run all frontend tests (Vitest)
npx vitest run                  # Non-interactive mode
npx vitest run src/components/ActionFeed.test.tsx  # Single file
```

Configuration in `frontend/vite.config.ts` (Vitest plugin).

## Backend Test Structure

### conftest.py — Shared Setup

- Installs mock modules for `pypowsybl`, `expert_op4grid_recommender`, and submodules into `sys.modules` (only when the real package is unavailable)
- Provides fixtures: `mock_network` (pypowsybl network with lines/transformers/VLs), `mock_network_service`, `recommender_service_instance`
- `reset_config` (autouse) — snapshots and restores `expert_op4grid_recommender.config` after each test

### Test Files by Domain

#### API & Service Layer
| File | Description |
|------|-------------|
| `test_api_endpoints.py` | FastAPI endpoint testing with TestClient and mocked services |
| `test_recommender_service.py` | RecommenderService config updates and action enrichment |
| `test_network_service.py` | NetworkService initialization, loading, and element lookup |

#### Analysis & Simulation
| File | Description |
|------|-------------|
| `test_recommender_simulation.py` | Real data simulation with small test grid |
| `test_split_analysis.py` | Two-step analysis workflow (step1 overload detect, step2 resolve) |
| `test_combined_actions_integration.py` | Combined action workflow integration |
| `test_combined_actions_scenario.py` | Real-world combined action scenarios |
| `test_stream_pdf_integration.py` | Streaming NDJSON + PDF event integration |

#### Load Shedding & Curtailment
| File | Description |
|------|-------------|
| `test_power_reduction_format.py` | New `loads_p`/`gens_p` power reduction format + legacy `bus=-1` compat |
| `test_renewable_curtailment.py` | Curtailment detail computation and config updates |
| `test_manual_action_enrichment.py` | Manual action enrichment (topology, description, details) |
| `test_dynamic_actions.py` | On-the-fly action creation for `load_shedding_*`, `curtail_*`, `pst_*` |
| `test_mw_start.py` | MW Start computation for scoring (line disco, PST, load shedding, open coupling) |

#### Core Computation
| File | Description |
|------|-------------|
| `test_compute_deltas.py` | Power flow delta calculation with terminal-aware conventions |
| `test_sanitize.py` | JSON serialization of NumPy types |
| `test_overload_filtering.py` | Overload detection and line selection |
| `test_recommender_filtering.py` | Combined action filtering logic |

#### Monitoring & Network Analysis
| File | Description |
|------|-------------|
| `test_monitoring_consistency.py` | Monitoring parameter prioritization |
| `test_vectorized_monitoring.py` | Vectorized monitoring with masking and operational limits |
| `test_environment_detection.py` | Non-reconnectable element detection with analysis_date |

#### Superposition
| File | Description |
|------|-------------|
| `test_superposition_accuracy.py` | Superposition vs simulation discrepancy detection |
| `test_superposition_filtering_regression.py` | Max rho filtering for heavily loaded lines |
| `test_superposition_service.py` | On-demand superposition computation |
| `test_superposition_monitoring_consistency.py` | Monitoring alignment between estimation and simulation (11 tests) |
| `test_pst_combined_actions.py` | PST tap + combined action simulation, topology preservation, fast_mode protection |

#### Performance & Regression
| File | Description |
|------|-------------|
| `test_performance_budgets.py` | Benchmarks for large observations (2000+ lines) |
| `test_recommender_regressions.py` | MW calculation and curtailment robustness |
| `test_recommender_non_convergence.py` | Power flow convergence failure handling |
| `test_ui_regressions.py` | Critical UI string and class presence |

#### Infrastructure
| File | Description |
|------|-------------|
| `test_cache_synchronization.py` | Observation caching for N/N-1 calls |
| `test_islanding_mw_recommender.py` | Disconnected MW calculation on islanding |
| `test_early_pdf_reporting.py` | PDF event delivery before result event |
| `test_direct_file_loading.py` | Direct file loading configuration |
| `test_config_persistence.py` | Configuration file persistence |
| `test_sld_highlight.py` | SLD highlight and switch change computation |

## Frontend Test Structure

### Test Files by Domain

#### App Integration
| File | Description |
|------|-------------|
| `App.contingency.test.tsx` | Contingency analysis workflow (step1 -> step2) |
| `App.session.test.tsx` | Session save/load and interaction |
| `App.settings.test.tsx` | Settings panel and configuration |
| `App.import.test.tsx` | Module import sanity check |

#### Components
| File | Description |
|------|-------------|
| `ActionFeed.test.tsx` | Action card rendering, filtering, load shedding/curtailment details, MW Start, badges |
| `CombinedActionsModal.test.tsx` | Combined action pair computation modal |
| `OverloadPanel.test.tsx` | Two-step overload analysis panel |
| `VisualizationPanel.test.tsx` | SVG diagram rendering and pan/zoom |

#### Hooks
| File | Description |
|------|-------------|
| `useActions.test.ts` | Action state management and manual action handling |
| `useAnalysis.test.ts` | Analysis streaming (step1/step2) |
| `useDiagrams.test.ts` | Diagram fetching and variant management |
| `usePanZoom.test.tsx` | Pan/zoom viewBox optimization |
| `useSession.test.ts` | Session persistence and restoration |
| `useSettings.test.ts` | Settings state and interaction logging |

#### Utilities
| File | Description |
|------|-------------|
| `svgUtils.test.ts` | SVG processing, target detection, highlights, metadata indexing |
| `sessionUtils.test.ts` | Session snapshot building and serialization |
| `interactionLogger.test.ts` | Interaction event logger |
| `standaloneInterface.test.ts` | Standalone HTML interface serialization |
| `mergeAnalysisResult.test.ts` | Analysis result field merging |
| `fileRegistry.test.ts` | Project structure regression (removed workers) |
| `cssRegression.test.ts` | Critical CSS property guards |

## Common Testing Patterns

### Backend
- **Heavy mocking**: `unittest.mock.MagicMock`, `@patch` decorators
- **Fixtures**: `@pytest.fixture` for service instances, environments, mock observations
- **MockAction class**: Simulates grid2op action objects with `loads_bus`, `gens_bus`, `loads_p`, `gens_p` attributes
- **Observation mocks**: NumPy arrays for `rho`, `load_p`, `gen_p`, `p_or` with `name_line`/`name_load`/`name_gen` lists
- **Pattern**: Create service -> inject mock context -> call method -> assert fields

### Frontend
- **Component testing**: React Testing Library (`render`, `screen`, `fireEvent`, `waitFor`)
- **Mock modules**: `vi.mock('../api')`, `vi.mock('../utils/svgUtils')`
- **Props-based**: Construct `defaultProps` -> override specific fields -> render -> assert DOM
- **Async assertions**: `await screen.findByText()` for dynamic content
- **Pattern**: Build props with test data -> `render(<Component {...props} />)` -> query DOM

## Key Data Structures in Tests

```typescript
// ActionTopology (frontend)
{ lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {},
  loads_p?: { LOAD_1: 0.0 }, gens_p?: { WIND_1: 0.0 } }

// LoadSheddingDetail
{ load_name: 'LOAD_1', voltage_level_id: 'VL_ALPHA', shedded_mw: 42.5 }

// CurtailmentDetail
{ gen_name: 'WIND_1', voltage_level_id: 'VL_WIND', curtailed_mw: 80.0 }
```

```python
# Backend action content — new power reduction format
{"set_load_p": {"LOAD_1": 0.0}}
{"set_gen_p": {"WIND_1": 0.0}}

# Backend action content — legacy bus disconnection format
{"set_bus": {"loads_id": {"LOAD_1": -1}}}
{"set_bus": {"generators_id": {"WIND_1": -1}}}

# Action topology (new format)
{"loads_p": {"LOAD_1": 0.0}, "gens_p": {"WIND_1": 0.0}}

# Action topology (legacy format)
{"loads_bus": {"LOAD_1": -1}, "gens_bus": {"WIND_1": -1}}
```

## Notes

- Backend tests run without `pypowsybl` or `expert_op4grid_recommender` installed — `conftest.py` stubs them
- Some integration tests (e.g., `test_recommender_simulation.py`, `test_stream_pdf_integration.py`) use real test data from the `expert_op4grid_recommender` package when available
- Frontend tests require `npm install` in the `frontend/` directory
- Root-level `test_*.py` files (`test_backend.py`, `test_api_stream.py`, etc.) are ad-hoc integration scripts that require a running backend — they are not part of the pytest suite
