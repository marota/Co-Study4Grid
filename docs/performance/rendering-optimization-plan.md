# Rendering Optimizations for Large Grid NAD Visualization

## Overview

Co-Study4Grid renders pypowsybl Network Area Diagrams (NAD) for power grids with 11,000+ lines and 500+ voltage levels. At this scale, naive rendering causes multi-second tab switches, invisible line colors at zoom-out, and zoom lag/crashes. This document traces the critical rendering features, their rationale, and regression risks.

## Critical CSS Properties

### 1. `vector-effect: non-scaling-stroke` — Line Visibility & Zoom Performance

**Files:** `frontend/src/App.css`, `standalone_interface.html` (CSS section)

```css
.svg-container svg path,
.svg-container svg line,
.svg-container svg polyline,
.svg-container svg rect {
    vector-effect: non-scaling-stroke;
}
```

**What it does:** Keeps stroke widths at a constant screen-pixel size regardless of SVG viewBox zoom level.

**Why it's critical:**
- **Without it at full zoom-out:** Lines become sub-pixel width on large grids — native pypowsybl colors are invisible (the diagram appears as scattered dots)
- **Without it when zoomed in:** Strokes scale to hundreds of screen pixels, causing extremely expensive anti-aliased rendering → zoom lag and browser crashes
- **With it:** Strokes stay at ~1-2px screen width at any zoom level. Native pypowsybl line colors are always visible. Rendering cost is constant regardless of zoom.

**Regression history:** Removed in commit `6d03b24` ("Fix thick lines"), causing lines to lose visible colors and zoom to lag/crash. Restored in `df20d54`.

> **DO NOT REMOVE this CSS rule.** It is the single most impactful rendering property for large grids. pypowsybl SVGs include native colors on paths — this rule ensures they remain visible. If lines appear "too thick" at some zoom level, address it by adjusting individual stroke-width values, not by removing non-scaling-stroke.

### 2. `contain: layout style paint` — CSS Containment

**Files:** `frontend/src/App.css`, `standalone_interface.html`

```css
.svg-container {
    contain: layout style paint;
}
```

**What it does:** Tells the browser that layout/paint within `.svg-container` is independent of the rest of the page.

**Why it's critical:** During viewBox changes (zoom/pan) and tab switches, the browser would otherwise propagate style/layout recalculations to ancestor elements. Containment limits the scope of recalculation to the SVG subtree.

### 3. `text-hidden` Class — Text Culling on Large Grids

**Files:** `frontend/src/App.css`, `standalone_interface.html`

```css
.svg-container.text-hidden foreignObject,
.svg-container.text-hidden .nad-edge-infos,
.svg-container.text-hidden .nad-text-edges {
    display: none !important;
}
```

**What it does:** Hides thousands of text labels (foreignObject, edge info) when zoomed out on large grids. Text is too small to read at full zoom-out, and rendering it is expensive.

**When it activates:** Controlled by `usePanZoom` hook — text is hidden when the viewBox covers ≥55% of the original diagram size, shown when zoomed in to ≤45% (hysteresis prevents flicker near the boundary).

## Pan/Zoom Architecture (`usePanZoom`)

**Files:** `frontend/src/hooks/usePanZoom.ts`, `standalone_interface.html` (usePanZoom function)

### Design Principles

1. **Direct DOM manipulation during interaction** — viewBox changes go directly to the SVG element via `setAttribute`, bypassing React's render cycle entirely. React state is only updated when interaction ends (debounced).

2. **Cached SVG element reference** — `svgElRef.current` is set once when the diagram loads (`useLayoutEffect([initialViewBox])`), avoiding repeated `querySelector('svg')` calls during the hot path (wheel/drag events).

3. **Debounced React state sync** — `commitViewBox()` fires 150ms after the last wheel event, preventing React re-renders during rapid zoom.

4. **rAF-throttled drag** — Mouse move events are batched to at most one DOM update per display frame via `requestAnimationFrame`.

### Critical `useLayoutEffect` Hooks

```
┌─ useLayoutEffect([initialViewBox])
│  Cache svgElRef, apply text-hidden on large grids.
│  MUST have [initialViewBox] deps — without deps it runs every render,
│  blocking paint on every tab switch.
│
├─ useLayoutEffect([active])
│  When tab becomes active, apply current viewBox to SVG DOM BEFORE paint.
│  Prevents one frame of stale/default viewBox on tab switch.
│
└─ useLayoutEffect([activeTab]) — in App.tsx / standalone
   Tab synchronization: copies viewBox from previous tab to new tab
   before the browser paints, so the new tab shows the same zoom region.
```

> **Regression risk:** Changing any of these to `useEffect` will cause visible flicker on tab switch (one frame of wrong zoom state). Removing the `[initialViewBox]` dependency will cause all three `usePanZoom` instances to run `querySelector` on every React render, blocking paint for ~100-300ms on large grids.

## Tab-Switch Optimization

### Problem
On a France-scale grid (11,225 lines, ~500+ voltage levels), switching between N / N-1 / Action tabs was taking 1-3 seconds. The tab wouldn't appear until all decorations (highlights, voltage filter, delta visuals) finished running.

### Solution: Deferred Decorations

Highlights and voltage filters are deferred to the next animation frame on tab switch:

```
User clicks tab → React render → useLayoutEffect (viewBox sync)
→ Browser paints tab (SVG visible immediately)
→ requestAnimationFrame → apply highlights + voltage filter
```

**Implementation:**
- The highlight effect detects tab switches via `prevActiveTabRef`
- On tab switch: decorations are deferred via `requestAnimationFrame`
- On data change (same tab): decorations apply synchronously

**Stale tracking:** Inactive tabs are marked as "stale" in a `Set`. When switching to a stale tab, decorations re-apply in the deferred rAF callback.

### SVG Container Strategy

All three diagram containers (N, N-1, Action) stay mounted in the DOM with `visibility: hidden` / `z-index: -1` when inactive. This avoids destroying and recreating the SVG on every tab switch, preserving zoom state and avoiding expensive initial parse/render.

```jsx
<div style={{
    zIndex: activeTab === 'n' ? 10 : -1,
    visibility: activeTab === 'n' ? 'visible' : 'hidden',
}}>
```

## Highlight & Decoration Optimizations

### ID Map Cache (`getIdMap`)

**Files:** `frontend/src/utils/svgUtils.ts`, `standalone_interface.html`

Instead of `container.querySelector(`[id="${svgId}"]`)` (O(n) per call), a `Map<string, Element>` is built once per SVG and cached. Subsequent lookups are O(1). The cache is invalidated when the diagram changes.

### CTM Cache for Highlight Positioning

`getScreenCTM()` is cached per highlight pass instead of computed inside loops. The background layer's CTM is constant for all highlights in a single call, so caching it avoids redundant layout-forcing calls.

### Delta Visuals Guard

The `data-deltas-applied` attribute on the container tracks whether delta CSS classes have been applied. On cleanup, the expensive `querySelectorAll` scans only run when deltas were previously applied, skipping 4 full-tree scans when switching between Flows/Impacts mode and no deltas exist.

### Voltage Filter Early-Return

```javascript
if (minKv <= uniqueVoltages[0] && maxKv >= uniqueVoltages[uniqueVoltages.length - 1]) return;
```

When the voltage range slider covers all voltages (the default state), the filter skips iterating all nodes/edges — avoiding ~33,000 `style.display` writes on large grids.

## SVG Boost for Large Grids (`boostSvgForLargeGrid`)

**Files:** `frontend/src/utils/svgUtils.ts`, `standalone_interface.html`

For grids with ≥500 voltage levels and viewBox ratio > 3× the reference size (1250), text sizes, bus node radii, and edge info elements are scaled up proportionally so they're readable when zoomed in. The function:

1. Parses the SVG string with DOMParser
2. Scales font sizes, circle radii, and transform groups
3. Adds `data-large-grid` attribute (used by text-hidden CSS)
4. Serializes back to string

**Boost cache:** Results are cached in an LRU map (max 6 entries: N + N-1 + Action × 2 view modes) keyed by `length:vlCount:first200chars` to avoid redundant DOM parse/serialize on the same SVG.

## Regression Test Coverage

**File:** `frontend/src/utils/cssRegression.test.ts`

Automated tests verify that critical CSS rules are present in both `App.css` and `standalone_interface.html`:

| Test Category | What It Verifies |
|---|---|
| `non-scaling-stroke` | CSS rule present for path/line/polyline/rect |
| CSS containment | `contain: layout style paint` on `.svg-container` |
| `text-hidden` | `display: none` for foreignObject when class active |
| Highlight styles | `.nad-overloaded` (orange), `.nad-action-target` (yellow) |
| Delta visualization | Positive (orange) and negative (blue) delta styles |
| `usePanZoom` guards | `useLayoutEffect` deps correct, tab sync uses `useLayoutEffect` |
| Voltage filter | Early-return when range covers all voltages |
| Deferred highlights | `requestAnimationFrame` used on tab switch |
| Boost cache | `_boostCache` and `BOOST_CACHE_MAX` present |

**File:** `frontend/src/hooks/usePanZoom.test.tsx`

Tests verify:
- ViewBox sync on mount, activation, and diagram changes
- ViewBox preservation across active/inactive transitions
- Text visibility toggle on large grids (hidden at zoom-out, visible at zoom-in)
- No corruption after rapid tab switching

## Summary: Do's and Don'ts

| Do | Don't |
|---|---|
| Use `vector-effect: non-scaling-stroke` on SVG elements | Remove it to fix "thick lines" — adjust stroke-width instead |
| Use `useLayoutEffect` for viewBox sync | Change to `useEffect` — causes visible flicker |
| Defer decorations via `requestAnimationFrame` on tab switch | Apply highlights synchronously on tab switch |
| Cache `getScreenCTM()` and ID maps | Call `querySelector` or `getScreenCTM()` in loops |
| Keep all SVG containers mounted (visibility toggle) | Conditionally render/destroy SVG containers on tab switch |
| Short-circuit voltage filter when range covers all | Iterate all elements even when no filtering needed |
| Run `cssRegression.test.ts` after CSS changes | Skip tests after modifying App.css or standalone CSS |
