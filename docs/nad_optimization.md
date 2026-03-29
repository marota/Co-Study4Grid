# NAD Optimization: Strategies and Findings

This document summarizes the investigation into Network Area Diagram (NAD) optimization for large grids (France 10k+ branches).

## Objectives
- Reduce SVG payload size (currently ~13.2 MB for full grid).
- Improve DOM performance and rendering responsiveness.
- Maintain visual consistency and highlight integrity.

## Strategy 1: Voltage-Bound Filtering (Discarded)
**Approach**: Automatically filter out lower voltage levels (e.g., < 63kV or < 90kV) from the diagram generation.
**Findings**:
- **Payload Reduction**: Only ~11% reduction on the French grid dataset.
- **Complexity**: High risk of missing critical "weak" components that might be relevant for overload analysis despite lower nominal voltage.
- **Verdict**: Not implemented. The minor payload savings did not justify the potential loss of visibility.

## Strategy 3: Viewport-Based NAD Reduction (Discarded)
**Approach**: Dynamically generate SVG subsets on-the-fly based on the current frontend `viewBox` (zoom-based synchronization).
**Benefits**:
- **Massive Payload Reduction**: From 13.2 MB down to **~240 KB** (50x improvement).
- **Backend Latency**: Generation time reduced from ~400ms to ~40ms.
**Issues / Trade-offs**:
- **Highlight Inconsistency**: Highlights (overloads, impacts) are lost when elements are culled from the subset unless complex tracking is implemented across both global and partial views.
- **Zoom/Pan Lag**: Coordinate synchronization between the pan-zoom library and the backend layout caused visual shifts and "pop-in" effects.
- **Coordination Complexity**: Managing multiple SVG states (N, N-1, Action) across both global and viewport scopes introduced significant frontend state debt.
**Verdict**: Reverted. While the performance gains were impressive, the degradation of the "highlight" feature and the complexity of zoom state management outweighed the raw payload savings.

## Recommendation for Future Optimization
- **Strategy 5b (Tiled Canvas/WebGL)**: Moving to a client-side JSON-based rendering system (Canvas or WebGL) would achieve 98% payload reduction without losing highlighting or zoom integrity. 
- **Back-end Vectorization**: The backend simulation optimizations (Fix #1 to #4) are retained as they provide a 4x total speedup for manual action simulations independent of the diagram strategy.
