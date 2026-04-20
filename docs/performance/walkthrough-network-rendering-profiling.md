# Performance Profiling: Large Grid Interaction

I have profiled the performance of ExpertAssist using the provided `config_large_grid.json` (114MB grid file) and the contingency `ARGIAL71CANTE`. The results identify two major bottlenecks: extreme backend processing latency and a massive SVG payload that overwhelms the frontend.

## 📊 Profiling Summary (Refined)

| Category | Component / Step | Time (s) | Size (MB) |
| :--- | :--- | :---: | :---: |
| **Initial Load** | Backend API (`getNetworkDiagram`) | 6.22s | **14.1 MB** |
| | Frontend SVG Scaling (`processSvg`) | 0.58s | - |
| | Metadata Indexing (`buildMetadataIndex`) | 0.07s | **10.5 MB** |
| | **DOM Rendering** (`innerHTML_render_n`) | **0.21s** | - |
| **Contingency Select** | Backend Analysis (`run_analysis_step1`) | 18.38s | - |
| | **DOM Rendering** (`innerHTML_render_n-1`) | **0.83s** | - |
| **Grand Total** | **Click to N-1 Visualization** | **~26s** | **~24.6 MB Total** |

## 🔍 Key Findings (Refined)

### 1. The "Big Bang" Rendering
While backend processing is 70% of the total wait time, the **826ms DOM rendering time** for the N-1 state is a critical frontend bottleneck. This is the period where the browser main thread is "locked" while it parses 14MB of SVG markup and calculates the initial layout. During this sub-second window, the UI is completely frozen.

### 2. SVG Scaling Overhead
The `boostSvgForLargeGrid` utility adds about **580ms** to the load time. This function uses `DOMParser` to rebuild the SVG tree in memory, which is expensive for such large files.

### 3. Potential Scaling Bug (NaN Errors)
The console logs revealed **30+ SVG attribute errors** (e.g., `Expected number, "NaN,NaN"`). This suggests that the custom scaling logic in `svgUtils.ts` is encountering unexpected coordinate formats in the large grid SVG, resulting in `NaN` values. This not only causes rendering glitches but can also trigger expensive error-handling paths in the browser.

### 4. Payload Interaction
The interaction lag (zooming/panning) is directly proportional to the **tens of thousands of DOM nodes** created during the 826ms rendering window. Future optimizations should focus on reducing this node count.

## 🚀 Recommendations (Updated)

1.  **Fix NaN Scaling Logic**: Investigate `svgUtils.ts` to ensure coordinate parsing handles all SVG attribute formats (e.g., scientific notation) to prevent `NaN` values.
2.  **Move Scaling to Backend**: Perform the SVG boosting/scaling on the backend or in a Web Worker to keep the main thread free for UI responsiveness.
3.  **Virtualization / Element Pruning**: The most impactful change would be to prune invisible or low-voltage elements from the SVG before it reaches the browser.

### 3. Frontend Optimizations are Active but Overwhelmed
The `usePanZoom` hook and `App.css` already implement advanced optimizations:
- `contain: layout style paint` to isolate the SVG subtree.
- `pointer-events: none` on all SVG children during interaction to skip hit-testing.
- `vector-effect: non-scaling-stroke` to avoid recomputing line widths.
- `requestAnimationFrame` throttling for zoom/pan updates.

Despite these, the absolute volume of SVG data exceeds typical browser performance limits for smooth 60fps interaction.

## 🚀 Recommendations

1.  **SVG Decimation/Pruning**: The backend should filter elements based on voltage levels or "interest zones" before generating the SVG for large grids.
2.  **Streaming / Level-of-Detail (LoD)**: Implementing a tiled or LoD approach for the network diagram would prevent loading the entire grid into the DOM at once.
3.  **Tighter Metadata**: Reducing the 10MB metadata payload by stripping non-essential fields for the visualization would improve frontend responsiveness.
4.  **Asynchronous Analysis**: Providing incremental feedback while `run_analysis_step1` is running (e.g., "Simulating...") would improve the perceived speed.

---
*Profiling performed on 2026-03-30 using `cProfile` and custom timing hooks.*
