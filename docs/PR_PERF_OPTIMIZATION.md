# PR: Performance Optimization for Large Grids (Vectorization & Caching)

## Summary
This PR implements critical backend performance optimizations for ExpertAssist, focusing on the observation and simulation pipeline. For large grids (e.g., France 10k+ branches), these changes provide a **4x speedup** in manual action simulation latency.

## Key Changes

### 1. Vectorized Simulation Pipeline (RecommenderService)
Replaced high-overhead Python loops with NumPy vectorized operations in several key areas:
- **`care_mask` & Overload Detection**: Achieved a **1,100x speedup** (12.17s -> 0.01s) by eliminating per-branch attribute lookups and rho-balancing loops.
- **Branch Flow Extraction (`_get_network_flows`)**: Optimized result extraction from `pypowsybl` networks, resulting in a **13x speedup**.
- **Flow Delta Computation (`_compute_deltas`)**: Vectorized the terminal-aware delta logic, providing a **47x speedup**.

### 2. Observation Caching
Implemented an internal cache for `get_obs()` results during the manual action simulation loop. This eliminates redundant data retrieval and property access overhead, improving the simulation body latency by another ~600ms.

### 3. SVG Boosting (Frontend)
Maintained and refined the "Phase 1" SVG boosting utility in `standalone_interface.html`. This ensures that labels, nodes, and flow arrows remain legible on large grids by dynamically scaling them based on the diagram's native resolution.

## Optimization Investigations (NAD Reduction)
As part of this work, we extensively investigated dynamic SVG reduction strategies:
- **Strategy 1 (Voltage Filtering)**: Evaluated but discarded due to insufficient payload reduction (~11%).
- **Strategy 3 (Viewport-Based Subsets)**: Implemented as a prototype achieving 50x payload reduction. However, it was ultimately **discarded and reverted** in this PR due to complexities in coordinate synchronization and the loss of global highlighting integrity (overloads/impacts).
Detailed findings on these investigations are documented in `docs/nad_optimization.md`.

## Performance Benchmarks
| Metric | Before | After | Improvement |
|--------|--------|-------|-------------|
| Core Mask Loop | 12.17s | 0.01s | **1,100x** |
| Flow Extraction | 0.82s | 0.06s | **13x** |
| Delta Computation | 0.47s | 0.01s | **47x** |
| **Total Simulation Latency** | **~16.5s** | **~4.0s** | **4x** |

## Verification
Verification was performed using `scripts/profile_diagram_perf.py`, which measures backend latency across N, N-1, and Manual Action scenarios on the full French grid.
