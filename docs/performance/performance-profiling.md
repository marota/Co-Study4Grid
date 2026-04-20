# Performance Profiling: Network Diagram & Visualization

This document details the performance bottlenecks identified in ExpertAssist when working with large electrical grids (e.g., the French grid with ~10k branches).

### Scenario Timings (Optimized v2)

Profiling was conducted using `config_large_grid.json` (French grid, ~10k branches).

| Scenario | Component | Before | After (v2) | Note |
|---|---|---|---|---|
| **1. Initial Load** | `pp.network.load` | ~2.4s | ~2.4s | I/O bound |
| | Base Diagram | ~7.2s | **3.5s** | Optimized flow extraction |
| **2. Contingency** | N-1 Analysis | ~19.8s | **12.9s** | Baseline simulation |
| | Flow Extraction | 0.8s | **0.06s** | **13x speedup** via vectorization |
| | Delta Calculation | 0.47s | **0.01s** | **47x speedup** via vectorization |
| **3. Manual Action** | Simulation Body | 16.5s | **4.0s** | **4x speedup** |
| | `care_mask` loop | 12.17s | **0.01s** | **1,100x speedup** |
| | `get_obs()` calls | 0.65s | **0.01s** | **65x speedup** via caching |

## Identified Bottlenecks & Fixes

### 1. Python-Side Overhead: Array Copying (FIXED)
The most significant bottleneck was a 12s overhead in the `care_mask` loop during manual action simulation.
- **Fix**: Cache these arrays as local variables before entering loops and use NumPy vectorized masking/indexing. Achieved **1,100x speedup**.

### 2. Row-by-Row Flow Extraction & Deltas (FIXED)
Extracting flows and computing deltas using loops over 10k branches was extremely slow.
- **Fix**: Replaced loops with pandas/numpy vectorized operations. Flow extraction is now **13x faster**, and delta computation is **47x faster**.

### 3. Redundant Observation Refreshes (FIXED)
Refetching N and N-1 observations for every manual action check added ~0.65s of overhead.
- **Fix**: Cached converged observations for a given network variant.

### 4. Large SVG Payload (~13 MB)
The pypowsybl Network Area Diagram (NAD) for the full grid produces an SVG string of ~13.2 MB.
- **Status**: Still present. This is the remaining bottleneck for frontend responsiveness.

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
