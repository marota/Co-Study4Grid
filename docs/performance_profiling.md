# Performance Profiling: Network Diagram & Visualization

This document details the performance bottlenecks identified in ExpertAssist when working with large electrical grids (e.g., the French grid with ~10k branches).

### Scenario Timings (Optimized v1)

Profiling was conducted using `config_large_grid.json` (French grid, ~10k branches).

| Scenario | Component | Before | After (v1) | Note |
|---|---|---|---|---|
| **1. Initial Load** | `pp.network.load` | ~2.4s | ~2.4s | I/O bound |
| | Base Diagram | ~7.2s | **3.5s** | Optimized flow extraction |
| **2. Contingency** | N-1 Analysis | ~19.8s | **17.2s** | Baseline simulation |
| | Flow Extraction | 0.8s | **0.06s** | **13x speedup** via vectorization |
| **3. Manual Action** | Simulation Body | 16.5s | **3.6s** | **4.5x speedup** |
| | `care_mask` loop | 12.17s | **0.01s** | **1,100x speedup** |

## Identified Bottlenecks & Fixes

### 1. Python-Side Overhead: Array Copying (FIXED)
The most significant bottleneck was a 12s overhead in the `care_mask` loop during manual action simulation.
- **Root Cause**: Accessing `obs.rho` inside a 10k-iteration Python loop triggered a full `.copy()` of the 10k-element NumPy array on every element access. Similarly, `obs.name_line` recreated a new NumPy array from strings every call.
- **Fix**: Cache these arrays as local variables before entering loops and use NumPy vectorized masking/indexing. This achieved a **1,100x speedup** for this specific component.

### 2. Row-by-Row Flow Extraction (FIXED)
Extracting P/Q flows from pypowsybl DataFrames using `.loc` in a loop took ~0.8s per diagram.
- **Fix**: Replaced loops with pandas vectorized `.to_dict()` and `pd.concat`. Reduced extraction time to **0.06s**.

### 3. Large SVG Payload (~13 MB)
The pypowsybl Network Area Diagram (NAD) for the full grid produces an SVG string of ~13.2 MB.
- **Impact**: High transmission latency and DOM thrashing in the frontend.
- **Status**: Still present. Requires server-side SVG pruning or tiling.

### 4. Simulation Environment Rebuild
Building the simulation environment takes ~1.7s per request.
- **Potential Optimization**: Reusing the `SimulationEnvironment` instance and caching converged observations (N and N-1) across requests.

## Profiling Tools

A standalone profiling script is available at `scripts/profile_diagram_perf.py`. It benchmarks:
1. Initial network loading and base diagram generation.
2. Contingency selection and N-1 diagram generation.
3. Manual action application and post-action diagram generation.

**Usage:**
```bash
# Run with project venv
./venv_expert_assist_py310/bin/python scripts/profile_diagram_perf.py config_large_grid.json
```
