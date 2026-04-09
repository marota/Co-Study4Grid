# Architecture Proposal: Spatial Level-of-Detail (LoD) Rendering — Revised

This document is a **revised version** of the original Spatial LoD proposal. It
incorporates a critique of the original design against the actual codebase, then
presents a corrected architecture that works with — not against — the existing
pan/zoom, highlighting, and diagram pipelines.

---

## Critique of the Original Proposal

The original proposal contained several factual errors about the codebase and
overlooked critical interactions with existing systems.

### 1. Wrong Zoom Library Assumed

**Original claim**: Use `useTransformContext` from `react-zoom-pan-pinch` to
track scale/position.

**Reality**: The application does **not** use `react-zoom-pan-pinch` for NAD
pan/zoom. It uses a **custom `usePanZoom` hook**
(`frontend/src/hooks/usePanZoom.ts`) that manipulates the SVG `viewBox`
attribute directly via DOM refs, bypassing React's render cycle entirely. The
hook works in SVG coordinate space (viewBox x/y/w/h), not CSS transform space
(scale, positionX, positionY).

**Impact**: The entire frontend viewport-tracking strategy (Sections 2A–2C)
was designed for a library the app doesn't use. The BBox calculation math, the
coordinate mapping, and the debounce integration point are all wrong.

### 2. Dual-SVG DOM Swap Doubles the Problem

**Original claim**: Render both Macro and Micro SVGs simultaneously, then hide
the old one after the new one paints.

**Reality**: The stated goal is to reduce DOM node count from 100,000+. Holding
two full SVG trees in the DOM simultaneously **doubles** peak DOM node count
during every transition. On the very grids where performance matters most, this
creates the worst possible spike exactly when the user is interacting.

### 3. The 5–10x Buffer Is Self-Defeating

**Original claim**: Expand the visible BBox by 5–10x in all directions to
pre-fetch surrounding area.

**Reality**: A 5x buffer means fetching **25x** the visible area (5x width ×
5x height). If the user is zoomed to see ~4% of the grid, a 5x buffer fetches
100% — the entire grid — defeating the purpose entirely. Even a 3x buffer
fetches 9x the viewport, which for large grids regenerates most of the SVG
the feature was supposed to avoid.

### 4. SVG Post-Processing Pipeline Ignored

The proposal makes no mention of the extensive post-processing applied to every
SVG after it arrives from the backend:

| Post-processing step | File | Impact of SVG swap |
|---|---|---|
| `boostSvgForLargeGrid()` — scales fonts, nodes, edge-info for grids ≥500 VLs | `svgUtils.ts:33–129` | Must re-run on every micro SVG |
| `buildMetadataIndex()` — O(1) lookup maps for equipment IDs | `svgUtils.ts:149–174` | Must rebuild on every swap |
| `getIdMap()` — WeakMap cache of all `[id]` elements | `svgUtils.ts:13–27` | Cache invalidated on every swap |
| `applyOverloadedHighlights()` — clone-based halos for overloaded lines | `svgUtils.ts:199–255` | Must re-apply; metadata may reference elements not in micro SVG |
| `applyActionTargetHighlights()` — highlight action target VLs | `svgUtils.ts:431–500` | Same issue |
| `applyDeltaVisuals()` — color branches by flow delta, replace text labels | `svgUtils.ts:567–686` | Requires `flow_deltas` dict keyed to SVG element IDs that change between macro/micro |
| `applyContingencyHighlights()` — mark disconnected element | `svgUtils.ts:505–556` | Same issue |

Every zoom-triggered micro-fetch would require re-running this entire pipeline,
which on a 500+ VL grid takes measurable time (the code has a 5-second timeout
guard at `svgUtils.ts:103`).

### 5. Three Variant States, Not One

The proposal shows a single `disconnected_element` field on the BBox request.
But the app maintains **three** diagram variant states:

- **N state** (base network) — `get_network_diagram()`
- **N-1 state** (post-contingency) — `get_n1_diagram()`, includes load-flow recomputation
- **Action variant** (post-remedial-action) — `get_action_variant_diagram()`, requires cached analysis context

Each has its own flow deltas, overload lists, and load-flow convergence status.
The proposed endpoint handles none of this. The N-1 and action-variant states
require variant switching, load-flow execution, and delta computation on the
backend — this is **not** "milliseconds" as claimed; the N-1 diagram path runs
a full AC load-flow with DC fallback (`recommender_service.py:1333–1340`).

### 6. `depth=0` Produces Disconnected Islands

**Original claim**: Pass `depth=0` to pypowsybl to prune the rest of the grid.

**Reality**: `depth=0` renders **only** the selected voltage levels with no
connecting edges. The result is a set of disconnected circles with no
topological context — unusable for grid operators who need to see power flow
paths between substations. This is the opposite of what a zoomed-in view should
show.

### 7. `grid_layout.json` Is Optional

The `_load_layout()` method (`recommender_service.py:1214–1228`) returns `None`
when no layout file is configured. The proposal's spatial filtering depends
entirely on this file existing, with no fallback. Many network datasets ship
without a pre-computed layout.

### 8. SLD Overlay and Tab Synchronization Broken

- **SLD overlays** are rendered on top of the NAD. Swapping the underlying NAD
  invalidates the overlay's coordinate frame.
- **Tab synchronization** (`useDiagrams.ts`) preserves viewBox state across
  N / N-1 / Action tabs. A macro/micro SVG swap mid-interaction would
  desynchronize tabs, since each tab would need independent macro/micro state.

### 9. No Micro-SVG Caching

If the user pans back to a previously visited region, the proposal re-fetches
from the backend. There is no client-side cache for micro tiles, leading to
redundant backend work and latency on revisits.

### 10. Time Estimates Are Unrealistic

The proposal estimates 4.5 days total. Given the issues above — wrong zoom
library, three variant states, full post-processing pipeline, SLD overlay
integration, tab synchronization, caching — a realistic estimate for a
correct implementation would be 3–5x higher.

---

## Revised Proposal: Progressive Detail via ViewBox-Aware Simplification

### Design Principles

1. **Work with the existing `usePanZoom` hook**, not against it. The viewBox
   is already the source of truth for what's visible.
2. **Avoid dual-SVG DOM trees**. Only one SVG is in the DOM at a time per tab.
3. **Preserve the post-processing pipeline**. Highlights, deltas, and metadata
   must work identically regardless of detail level.
4. **Respect the three variant states**. The solution must work for N, N-1,
   and action-variant diagrams without special-casing.
5. **Degrade gracefully** when `grid_layout.json` is absent.

### Architecture Overview

The revised approach has **two complementary layers**:

**Layer A — Client-Side CSS Visibility (instant, no backend calls)**:
Dynamically hide/show SVG element classes based on the current viewBox zoom
ratio. This is zero-latency and handles the most common case: making the
full-grid overview usable by hiding text and minor elements.

**Layer B — Backend Focused Sub-Diagram (on explicit user action)**:
Leverage the **existing** `/api/focused-diagram` endpoint (already implemented
at `main.py:534–565`) to let users explicitly request a detailed sub-diagram
for a region of interest, rather than auto-fetching on every zoom change.

---

### Layer A: Client-Side CSS Visibility Tiers

#### Concept

Add CSS rules that show/hide element classes based on a `data-zoom-tier`
attribute on the SVG container. The `usePanZoom` hook already knows the current
viewBox — we compute the zoom ratio from it and set the tier.

#### Zoom Tiers

| Tier | Condition | Visible Elements |
|---|---|---|
| `overview` | `viewBox.w / originalViewBox.w > 0.5` | Nodes, edges, legend. **Hide**: edge-info text, bus labels, foreignObject labels |
| `region` | `0.15 < ratio ≤ 0.5` | Above + edge-info text, bus voltage labels |
| `detail` | `ratio ≤ 0.15` | Everything (full detail) |

#### Frontend Changes

**`usePanZoom.ts`** — After each `applyViewBox()`, compute the tier:

```typescript
const computeZoomTier = (currentVb: ViewBox, originalVb: ViewBox): string => {
    const ratio = currentVb.w / originalVb.w;
    if (ratio > 0.5) return 'overview';
    if (ratio > 0.15) return 'region';
    return 'detail';
};
```

Set it on the container element:
```typescript
container.setAttribute('data-zoom-tier', tier);
```

This is a single DOM attribute write — no React re-render, no SVG manipulation.

**CSS rules** (added to `App.css` or `index.css`):

```css
/* Overview: hide text-heavy elements for performance */
[data-zoom-tier="overview"] .nad-edge-infos,
[data-zoom-tier="overview"] .nad-label-nodes foreignObject,
[data-zoom-tier="overview"] .nad-text-edges { 
    display: none; 
}

/* Region: show edge info but keep minor labels hidden */
[data-zoom-tier="region"] .nad-label-nodes foreignObject { 
    display: none; 
}
```

#### Why This Works

- **No backend calls**: Pure CSS visibility toggle, executes in the browser's
  style recalculation pass (sub-millisecond).
- **No SVG re-parsing**: The DOM tree stays identical; elements are hidden via
  `display: none`, which removes them from the render tree (reducing paint cost)
  without removing them from the DOM (preserving metadata/ID maps/highlights).
- **Preserves all post-processing**: Highlights, deltas, and metadata indices
  remain valid because the DOM hasn't changed.
- **Works for all three variant states**: The CSS applies to whichever SVG is
  currently displayed.
- **Degrades gracefully**: If `grid_layout.json` is missing, this still works
  because it doesn't depend on spatial data.

#### Performance Impact Estimate

For a 100,000-node SVG, hiding `.nad-edge-infos` and `foreignObject` labels at
overview zoom removes roughly 40–60% of rendered elements from the paint tree.
The browser skips layout and paint for `display: none` subtrees entirely. This
should bring frame times during pan/zoom from janky (>50ms) to smooth (<16ms)
on typical hardware.

---

### Layer B: Explicit Focused Sub-Diagram (Already Exists)

#### Concept

The backend already has `/api/focused-diagram` (`main.py:534–565`) and
`/api/action-variant-focused-diagram` (`main.py:572–591`). These endpoints:

1. Resolve an element ID to its voltage level IDs
2. Generate a sub-diagram with configurable `depth`
3. Return full SVG + metadata + flow deltas

This is exactly the "micro layout" the original proposal wanted, but it's
**already implemented** and works for both N and N-1 states.

#### What's Missing (Small Additions)

1. **A "Focus on Region" UI affordance**: Add a button or right-click context
   menu item that lets the user select a region/element and request a focused
   sub-diagram. This opens in a new tab or replaces the current view with a
   back button.

2. **A BBox-to-VL-list resolver** (backend): For cases where the user wants to
   focus on a visible region rather than a specific element, add a utility that
   maps viewBox coordinates to VL IDs using `grid_layout.json` (when
   available). This is the one piece from the original proposal worth keeping:

```python
# In recommender_service.py
def get_vl_ids_in_bbox(self, x_min, x_max, y_min, y_max):
    """Return VL IDs whose layout positions fall within the given bbox."""
    df = self._load_layout()
    if df is None:
        return None  # Caller falls back to element-based focus
    visible = df[
        (df['x'] >= x_min) & (df['x'] <= x_max) &
        (df['y'] >= y_min) & (df['y'] <= y_max)
    ]
    return visible.index.tolist() if len(visible) > 0 else None
```

3. **Micro-diagram caching** (frontend): Cache the last N focused sub-diagrams
   in a `Map<string, DiagramData>` keyed by a hash of (variant + VL IDs).
   When the user navigates back, serve from cache instead of re-fetching.

#### Frontend Integration

The focused sub-diagram opens as a **separate diagram tab** (e.g., "Focused")
rather than replacing the main NAD in-place. This:

- Preserves the full-grid view for context switching
- Avoids invalidating highlights/deltas on the main diagram
- Works with the existing tab synchronization system
- Lets the user toggle between overview and detail without latency

---

### Execution Roadmap

| Phase | Task | Effort | Risk |
|---|---|---|---|
| **1** | Implement CSS zoom tiers in `usePanZoom.ts` + CSS rules | 0.5 days | Low — pure additive, no existing code changes |
| **2** | Test on large grid datasets (500+ VLs) to tune tier thresholds | 0.5 days | Low |
| **3** | Add BBox-to-VL resolver in `recommender_service.py` | 0.5 days | Low — isolated utility method |
| **4** | Add "Focus Region" UI button in `VisualizationPanel.tsx` | 1 day | Medium — new UI element + state |
| **5** | Add client-side micro-diagram cache in `useDiagrams.ts` | 0.5 days | Low |
| **Total** | | **3 days** | |

### What This Does NOT Do (And Why)

- **No automatic micro-fetch on zoom**: Auto-fetching creates a cascade of
  backend calls during exploration. Grid operators pan and zoom rapidly;
  debouncing helps but doesn't eliminate the chattiness. Explicit focus is
  more predictable and doesn't surprise the user with diagram swaps mid-pan.

- **No dual-SVG DOM trees**: Only one SVG per tab, always. The CSS tier system
  achieves visual simplification without doubling memory.

- **No macro SVG generation via lxml stripping**: The CSS `display: none`
  approach is strictly better — it's instant, reversible, and doesn't discard
  metadata needed by the highlighting pipeline.

---

### Summary

| Concern | Original Proposal | Revised Proposal |
|---|---|---|
| Zoom library | `react-zoom-pan-pinch` (wrong) | `usePanZoom` viewBox hook (correct) |
| Coordinate space | CSS transforms | SVG viewBox coordinates |
| Overview simplification | Backend-generated macro SVG via lxml | Client-side CSS `display: none` tiers |
| Detail on zoom | Auto-fetch micro SVG on every zoom change | Explicit user-triggered focused diagram |
| DOM node count during transition | 2× (both SVGs in DOM) | 1× always |
| Post-processing pipeline | Not addressed | Fully preserved |
| Variant states (N, N-1, action) | Single `disconnected_element` field | Uses existing multi-variant endpoints |
| Focused diagram endpoint | New `POST /api/diagram-bbox` | Existing `/api/focused-diagram` + BBox resolver |
| Layout file dependency | Hard requirement, no fallback | Optional; CSS tiers work without it |
| Buffer strategy | 5–10× (fetches entire grid) | N/A (no auto-fetch) |
| Effort | 4.5 days (underestimate) | 3 days |
