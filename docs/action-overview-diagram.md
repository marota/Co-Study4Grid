# Action Overview Diagram

## Overview

The Remedial Action tab now hosts an **action-overview diagram** when no action card is selected. It renders the post-contingency (N-1) Network Area Diagram as a dimmed background and overlays **Google-Maps-style pins** — one per prioritised remedial action — anchored on the grid asset each action targets. The operator can see all suggested actions at a glance, single-click a pin to preview the full action card, or double-click to drill down into the action-variant network diagram.

When any action card IS selected (either via the sidebar feed or by double-clicking a pin), the overview folds away and the existing action-variant diagram + highlights take over. The operator can return to the overview by clicking the deselect chip in the tab label ("Remedial Action: **\<action-id\> ✕**").

```
┌──────────────────────────────────────────────────────────┐
│  Tab bar                                                 │
│  [Network (N)]  [Contingency (N-1)]  [Remedial action: overview]  [Overflow] │
├──────────────────────────────────────────────────────────┤
│                                                          │
│   Background: N-1 NAD (dimmed)                           │
│                                                          │
│         ┌──────┐                                         │
│         │ 73%  │   ← green pin (solves overload)         │
│         └──┬───┘                                         │
│            │ points at line mid-point                     │
│         ┌──────┐                                         │
│         │ 99%  │   ← red pin (still overloaded)          │
│         └──┬───┘                                         │
│            │                                             │
│   Zoom: +  Fit  -                                        │
│   🔍 Focus asset...                                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

---

## Visual stack

The SVG layers are ordered as follows (back to front):

| Layer | Content | Opacity | Purpose |
|---|---|---|---|
| 1. `.nad-overview-highlight-layer` | Clone of contingency + overloaded edges | 1.0 | Matches N-1 tab halos (yellow contingency, orange overloads) |
| 2. Original NAD content | All voltage-level nodes, edges, labels | 1.0 | The actual network diagram |
| 3. `.nad-overview-dim-rect` | White `<rect>` covering the entire viewBox | 0.65 | Dims the network + highlight halos so pins pop |
| 4. `.nad-action-overview-pins` | Google-Maps teardrop pins | 1.0 | One pin per action, severity-coloured, labelled with max loading % |

Highlights are placed **behind** the NAD content (same background-layer pattern as the N-1 tab) so the halo peeks out around the line strokes. The dim rect sits on top of both, and pins ride above everything.

### Why a `<rect>` instead of `<g opacity>`?

Earlier iterations wrapped the NAD children in a `<g opacity="0.35">`. On large grids (11k+ elements) this caused Chrome's Layerize compositor step to create individual layers for every child element — a ~25-31 second penalty. The `<rect>` overlay achieves the same dim effect at zero compositing cost because the browser only needs to paint one extra element.

---

## Pin anatomy

Each pin is an SVG `<g>` with the following structure:

```
<g class="nad-action-overview-pin" transform="translate(x y)" data-action-id="...">
  <g class="nad-action-overview-pin-body" transform="scale(k)">
    <title>action id — description — max loading XX.X%</title>
    <path d="M ... A ... L 0 0 Z"  fill="#28a745"  stroke="none" />   ← teardrop
    <circle cx="0" cy="..." r="..."  fill="#fff" fill-opacity="0.92" /> ← inner disc
    <text fill="#1f2937" font-weight="800">73%</text>                   ← label
  </g>
</g>
```

### Severity palette

Mirrors the `ActionCard` sidebar palette exactly:

| Severity | Fill colour | Condition |
|---|---|---|
| green | `#28a745` | `max_rho ≤ monitoringFactor - 0.05` |
| orange | `#f0ad4e` | `monitoringFactor - 0.05 < max_rho ≤ monitoringFactor` |
| red | `#dc3545` | `max_rho > monitoringFactor` |
| grey | `#9ca3af` | Load-flow divergent or islanding detected |

The label text always uses dark slate `#1f2937` for contrast on both the white inner disc and the coloured teardrop.

### Pin sizing

Base radius is read from the first VL circle in the SVG (`svg.querySelector('.nad-vl-nodes circle[r]').r`), so pins match voltage-level glyphs at normal zoom. A **screen-constant floor** (`PIN_MIN_SCREEN_RADIUS_PX = 22px`) is enforced: as the operator zooms out, `rescaleActionOverviewPins` upscales the `.nad-action-overview-pin-body` `scale()` transform so pins stay at least 22 screen pixels tall. An additional floor of 1/50th of the viewBox extent prevents pins from shrinking below a minimum proportion of the diagram.

The rescaler is driven by a `MutationObserver` on the SVG's `viewBox` attribute, rAF-throttled to avoid forced layouts during rapid wheel-zoom bursts (the source of the "Page ne répondant pas" lag on large grids).

### Pin anchor resolution

For each action, the anchor position is resolved in this order:

1. **Line / PST target** → mid-point of the edge's two node endpoints (via `getActionTargetLines`)
2. **Voltage-level target** → node (x, y) coordinate (via `getActionTargetVoltageLevels`)
3. **Fallback: `max_rho_line`** → mid-point of the line that carries the highest loading after the action

Actions whose asset cannot be located in the metadata are silently skipped.

---

## Interactions

### Auto-zoom on open

When the overview becomes visible, it computes a **fit rectangle** that encloses:
- the contingency edge endpoints,
- all overloaded-line edge endpoints,
- every pin position,

padded by 5% on each side. This rectangle is set as the initial `viewBox` via `usePanZoom` so the operator always opens on a meaningful frame.

The fit rectangle is recomputed when `(n1MetaIndex, contingency, overloadedLines, pins)` changes, and re-asserted when the overview re-appears after a round-trip through the action drill-down view (tracked via `wasVisibleRef`).

### Pan, zoom, and inspect

The overview mounts its own `usePanZoom` instance (independent from the N-1 and action tabs):
- **Wheel zoom** + **drag pan**: handled by the hook's event listeners, active only when `visible && svgReady`.
- **Zoom +/−/Fit buttons**: rendered in the bottom-left control cluster. Fit restores the auto-fit rectangle and clears the `lastFocusedRef` so a subsequent asset focus works on the same id.
- **Inspect search field**: local to the overview. Typing / selecting an equipment id pans and zooms onto it via `computeEquipmentFitRect`. The focus is "consume-once" (mirrors `useDiagrams`'s `lastZoomState` pattern) so wheel-zoom after an asset focus does NOT snap back.

### Single-click on a pin → card popover

A single click (deferred by 250ms to distinguish from double-click) opens a floating **ActionCardPopover** anchored near the pin. The popover renders the **same `ActionCard` component** the sidebar feed uses (see [Card sharing](#card-sharing) below).

Popover placement is computed by `utils/popoverPlacement.ts`:
- **Vertical**: below the pin if there's room, above if not (uses CSS `bottom` for above-placement so the bottom edge anchors at the pin regardless of popover height).
- **Horizontal**: left-aligned if pin is in the left viewport third, right-aligned if in the right third, centred otherwise. Always clamped to viewport edges.

Dismissed on: Escape, outside click, the ✕ button, card body click, or when `visible` flips false.

### Double-click on a pin → drill-down

A double-click (detected via the browser's click + dblclick sequence; the 250ms single-click timer is cancelled) calls `onActionSelect(actionId)`. This:

1. Closes any open popover.
2. Triggers the existing action-select flow in `useDiagrams` → fetches the action-variant NAD → folds the overview away.
3. Scrolls the sidebar feed to centre the matching card via `ActionFeed`'s `scrollIntoView({ block: 'center' })` effect.

### Returning to the overview

When the action-variant diagram is showing, the tab label reads **"Remedial Action: \<chip\>"** where `<chip>` is a pink clickable badge around the action id with a ✕ circle. Clicking the chip calls `onActionSelect(null)` and the overview re-opens with its last fit rectangle.

---

## Card sharing

Both the sidebar feed and the pin-click popover render the **same `ActionCard` component** from `components/ActionCard.tsx`. The popover-specific chrome (floating frame, close button, shadow, no-op stubs for re-simulate/edit controls) is encapsulated in `components/ActionCardPopover.tsx`, so adding or renaming a field on `ActionCard` only requires updating two call-sites (the feed render + the popover wrapper), never parallel implementations.

---

## Files

| File | Responsibility |
|---|---|
| `components/ActionOverviewDiagram.tsx` | Main component: SVG injection, dim rect, highlights, pins, pan/zoom, popover state |
| `components/ActionCardPopover.tsx` | Shared floating ActionCard wrapper (chrome + no-op stubs) |
| `utils/svgUtils.ts` | Helpers: `buildActionOverviewPins`, `applyActionOverviewPins`, `applyActionOverviewHighlights`, `rescaleActionOverviewPins`, `computeActionOverviewFitRect`, `computeEquipmentFitRect` |
| `utils/popoverPlacement.ts` | Pure helpers: `decidePopoverPlacement`, `computePopoverStyle` |
| `components/VisualizationPanel.tsx` | Mounts overview in the action tab's `DetachableTabHost`; renders the deselect chip in the tab label |
| `App.tsx` | Wires `n1MetaIndex`, `onActionSelect`, `onActionFavorite`, `onActionReject`, `selectedActionIds`, `rejectedActionIds`, `monitoringFactor` through to `VisualizationPanel` |
| `components/ActionFeed.tsx` | `scrollIntoView` effect on `selectedActionId` change |
| `App.css` | `.nad-overview-dimmed`, `.nad-action-overview-pin`, `.nad-action-overview-container` styles |

---

## Test coverage

| Test file | Cases | Covers |
|---|---|---|
| `utils/svgUtils.test.ts` | `buildActionOverviewPins` (8), `applyActionOverviewPins` (12), `applyActionOverviewHighlights` (8), `rescaleActionOverviewPins` (6), `computeActionOverviewFitRect` (5), `computeEquipmentFitRect` (4) | Pin resolution, severity, label, palette, idempotence, click semantics, mousedown stopPropagation, no-outline, dark label text, highlight cloning + ordering, pin rescale + rAF throttle, fit-rect geometry |
| `components/ActionOverviewDiagram.test.tsx` | 40 | SVG injection, dim rect, pins + palette, no-outline, anchor positions, double-click → onActionSelect, auto-fit, legend, pin count, visibility toggle, empty states, zoom +/−/Fit, inspect asset-focus + sticking regression, popover open/close/Escape/card-body-activate/placement, highlights ordering + refresh, pin rescale + rAF throttle |
| `components/ActionCardPopover.test.tsx` | 8 | Shared ActionCard rendering, extraDataAttributes forwarding, custom testId, close ✕, stopPropagation, card-body activation, no-op stubs |
| `utils/popoverPlacement.test.ts` | 16 | Vertical + horizontal placement rules, top/bottom/left anchoring, viewport clamping, end-to-end corner cases |
| `components/VisualizationPanel.test.tsx` | 4 | Deselect chip render, click calls onActionSelect(null), Enter/Space keyboard, no chip when no action selected |
| `components/ActionFeed.test.tsx` | 3 | scrollIntoView called on selection, not called when null, re-scrolls on change |

---

## Performance notes

| Concern | Mitigation |
|---|---|
| SVG injection on large grids (>10k elements) | Pre-parsed via `DOMParser` in a `useMemo`, injected with `replaceChildren()` — zero double-parse |
| Dim layer compositing (Chrome Layerize) | Single `<rect>` overlay instead of `<g opacity>` wrapper — avoids per-child layer creation (~25s savings on 11k-element NADs) |
| Highlight CTM reads | Batched: `cachedLayerCTM` is computed once per `applyActionOverviewHighlights` call, not per-clone |
| Pin rescale during wheel-zoom | `MutationObserver` + `requestAnimationFrame` throttle — at most one `getScreenCTM`-equivalent per frame. The rescaler now reads `viewBox` + `clientWidth` directly (pure math) instead of calling `getScreenCTM()` to avoid forced layouts entirely |
| ID-map lookups | `getIdMap` uses a `WeakMap` cache keyed on the container element, invalidated only when the SVG content changes |
