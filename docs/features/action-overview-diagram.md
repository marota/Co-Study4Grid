# Action Overview Diagram

## Overview

The Remedial Action tab now hosts an **action-overview diagram** when no action card is selected. It renders the post-contingency (N-1) Network Area Diagram as a dimmed background and overlays **Google-Maps-style pins** — one per prioritised remedial action — anchored on the grid asset each action targets. The operator can see all suggested actions at a glance, single-click a pin to preview the full action card, or double-click to drill down into the action-variant network diagram.

Pins visually reflect the operator's triage decisions: **selected** (starred) actions are highlighted with a gold star above the pin, while **rejected** actions are dimmed with a red cross. **Simulated combined actions** (two unitary actions applied together) appear as a dedicated pin at the midpoint of a curved dashed connection linking the two constituent pins.

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
│      ★  │ 73%  │   ← green pin, selected (gold star)    │
│         └──┬───┘                                         │
│            │ points at line mid-point                     │
│         ┌──────┐                                         │
│      ✕  │ 99%  │   ← red pin, rejected (cross, dimmed)  │
│         └──┬───┘                                         │
│            │                                             │
│        ╭───────────╮                                     │
│     pin A ╌╌╌ + ╌╌╌ pin B   ← combined pin on curve     │
│        ╰───────────╯                                     │
│                                                          │
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
| 4. `.nad-action-overview-pins` | Teardrop pins + combined-action curves | 1.0 | Unitary pins, status symbols, combined curves + midpoint pins |

Highlights are placed **behind** the NAD content (same background-layer pattern as the N-1 tab) so the halo peeks out around the line strokes. The dim rect sits on top of both, and pins ride above everything. Combined-action curves also sit in the pin layer (above the dim rect) so they render vivid.

### Why a `<rect>` instead of `<g opacity>` or CSS opacity?

Earlier iterations tried two approaches that both failed on large grids (11k+ elements, ~43k SVG children):

1. **SVG transparency group** (`<g opacity="0.35">`): Forces Chrome to rasterise every child into an intermediate buffer before compositing — ~31s Layerize penalty.
2. **CSS per-child opacity** (`.nad-overview-dimmed > * { opacity: 0.35 }`): Each child element with `opacity < 1` creates its own stacking context — ~25s Layerize penalty.

The single white `<rect>` overlay (`opacity: 0.65`) achieves the same dim effect at zero compositing cost because the browser only needs to paint one extra element with no stacking contexts.

---

## Pin anatomy

### Unitary action pin

Each unitary pin is an SVG `<g>` with the following structure:

```
<g class="nad-action-overview-pin" transform="translate(x y)" data-action-id="..."
   opacity="0.55">                                       ← only if rejected
  <g class="nad-action-overview-pin-body" transform="scale(k)">
    <title>action id — description — max loading XX.X%</title>
    <path d="M ... A ... L 0 0 Z"  fill="..."  stroke="..." />  ← teardrop
    <circle cx="0" cy="..." r="..."  fill="#fff" fill-opacity="0.92" />  ← inner disc
    <text fill="#1f2937" font-weight="800">73%</text>            ← label
    <path d="M ... Z"  fill="#eab308" />                         ← star (selected only)
    <path d="M ... Z"  fill="#ef4444" />                         ← cross (rejected only)
  </g>
</g>
```

### Combined action pin

Simulated combined actions (pair key containing `+` in the `actions` dict) are rendered as a curved connection between the two constituent unitary pins, with a dedicated pin at the curve midpoint:

```
<!-- Dashed curve from pin A to pin B -->
<path class="nad-combined-action-curve" d="M ... Q ... ..."
      stroke="#28a745" stroke-width="5" stroke-dasharray="..." />

<!-- Midpoint pin -->
<g class="nad-action-overview-pin nad-combined-action-pin" transform="translate(mx my)"
   data-action-id="actionA+actionB">
  <g class="nad-action-overview-pin-body" transform="scale(k)">
    <title>actionA + actionB — description — max loading XX.X%</title>
    <path d="..."  fill="#28a745" />           ← teardrop (severity colour)
    <circle ... fill="#fff" />                  ← inner disc
    <text>45%</text>                            ← label
    <circle fill="#28a745" stroke="white" />    ← "+" badge circle
    <text fill="white">+</text>                 ← "+" badge text
  </g>
</g>
```

The curve stroke width is read from the first edge path in the SVG (`.nad-edge-paths path`) so it matches the underlying network edges exactly. No dynamic rescaling is applied — curves live in SVG-space and scale naturally with the viewBox.

### Severity palette

Mirrors the `ActionCard` sidebar palette exactly:

| Severity | Fill colour | Highlighted (selected) | Dimmed (rejected) | Condition |
|---|---|---|---|---|
| green | `#28a745` | `#1e9e3a` | `#a3c9ab` | `max_rho ≤ monitoringFactor - 0.05` |
| orange | `#f0ad4e` | `#e89e20` | `#dcd0b8` | `monitoringFactor - 0.05 < max_rho ≤ monitoringFactor` |
| red | `#dc3545` | `#c82333` | `#d4a5ab` | `max_rho > monitoringFactor` |
| grey | `#9ca3af` | `#7b8a96` | `#c8cdd2` | Load-flow divergent or islanding detected |

The label text always uses dark slate `#1f2937` for contrast on both the white inner disc and the coloured teardrop.

### Selection / rejection status symbols

| Status | Visual treatment |
|---|---|
| **Selected** (starred) | Highlighted fill + gold border (`#eab308`) on teardrop + gold 5-pointed star above the bubble |
| **Rejected** | Dimmed fill + red cross (`#ef4444`) above the bubble + whole pin group at `opacity: 0.55` |
| **Neutral** | Standard severity fill, no symbol, full opacity |

Both symbols are rendered as `<path>` elements inside the `.nad-action-overview-pin-body` group, so they scale with the pin on zoom.

### Pin sizing

Base radius is read from the first VL circle in the SVG (`svg.querySelector('.nad-vl-nodes circle[r]').r`), so pins match voltage-level glyphs at normal zoom. A **screen-constant floor** (`PIN_MIN_SCREEN_RADIUS_PX = 22px`) is enforced: as the operator zooms out, `rescaleActionOverviewPins` upscales the `.nad-action-overview-pin-body` `scale()` transform so pins stay at least 22 screen pixels tall. An additional floor of 1/50th of the viewBox extent prevents pins from shrinking below a minimum proportion of the diagram.

The rescaler is driven by a `MutationObserver` on the SVG's `viewBox` attribute, rAF-throttled to avoid forced layouts during rapid wheel-zoom bursts (the source of the "Page ne répondant pas" lag on large grids).

### Pin anchor resolution

For each action, the anchor position is resolved in this order:

1. **Load shedding / curtailment** → `voltage_level_id` from the first entry of `load_shedding_details` or `curtailment_details` (direct VL node lookup)
2. **Line / PST target** → mid-point of the edge's two node endpoints (via `getActionTargetLines`)
3. **Voltage-level target** → node (x, y) coordinate (via `getActionTargetVoltageLevels`)
4. **Fallback: `max_rho_line`** → mid-point of the line that carries the highest loading after the action

Actions whose asset cannot be located in the metadata are silently skipped.

### Overlapping pin fan-out

When multiple actions resolve to the same anchor position (e.g. two actions targeting the same line), pins are fanned out in a circle around the shared centre so each remains individually clickable. The offset radius is `1.2 × 30` SVG units — enough to expose each pin's clickable area without scattering them too far from the original anchor.

### Combined action detection

Simulated combined actions are identified by scanning the `actions` dict for keys containing `+` (e.g. `"disco_X+reco_Y"`). The key is split on `+` to locate the two constituent unitary pins. Only **simulated** pairs produce combined pins — estimation-only pairs from the superposition theorem (which live in `combined_actions` but not in `actions`) are not rendered on the overview.

The combined pin position is the midpoint of a quadratic Bezier curve whose control point is offset perpendicular to the line between the two constituent pins (30% of inter-pin distance).

---

## Interactions

### Auto-zoom on open

When the overview becomes visible, it computes a **fit rectangle** that encloses:
- the contingency edge endpoints,
- all overloaded-line edge endpoints,
- every unitary pin position,
- every combined pin position,

padded by 5% on each side. This rectangle is set as the initial `viewBox` via `usePanZoom` so the operator always opens on a meaningful frame.

The fit rectangle is recomputed when `(n1MetaIndex, contingency, overloadedLines, pins, combinedPins)` changes, and re-asserted when the overview re-appears after a round-trip through the action drill-down view (tracked via `wasVisibleRef`).

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

All text in the `ActionCard` uses a uniform **12px** font size for the title, description, and footer ("Loading after:", "Max loading:") so the card stays compact in both the sidebar feed and the popover.

---

## Files

| File | Responsibility |
|---|---|
| `components/ActionOverviewDiagram.tsx` | Main component: SVG injection, dim rect, highlights, pins, combined pins, pan/zoom, popover state |
| `components/ActionCard.tsx` | Shared action card rendered in sidebar feed and pin-click popover (uniform 12px text) |
| `components/ActionCardPopover.tsx` | Shared floating ActionCard wrapper (chrome + no-op stubs) |
| `utils/svgUtils.ts` | Helpers: `buildActionOverviewPins`, `buildCombinedActionPins`, `applyActionOverviewPins`, `applyActionOverviewHighlights`, `rescaleActionOverviewPins`, `computeActionOverviewFitRect`, `computeEquipmentFitRect` |
| `utils/popoverPlacement.ts` | Pure helpers: `decidePopoverPlacement`, `computePopoverStyle` |
| `components/VisualizationPanel.tsx` | Mounts overview in the action tab's `DetachableTabHost`; renders the deselect chip in the tab label |
| `App.tsx` | Wires `n1MetaIndex`, `onActionSelect`, `onActionFavorite`, `onActionReject`, `selectedActionIds`, `rejectedActionIds`, `monitoringFactor` through to `VisualizationPanel` |
| `components/ActionFeed.tsx` | `scrollIntoView` effect on `selectedActionId` change |
| `App.css` | `.nad-overview-dimmed`, `.nad-action-overview-pin`, `.nad-action-overview-container` styles |

---

## Test coverage

| Test file | Cases | Covers |
|---|---|---|
| `utils/svgUtils.test.ts` | `buildActionOverviewPins` (8 + 6), `buildCombinedActionPins` (7), `applyActionOverviewPins` (12 + 14), `applyActionOverviewHighlights` (10), `rescaleActionOverviewPins` (6 + 1), `computeActionOverviewFitRect` (5), `computeEquipmentFitRect` (4) | Pin resolution, severity, label, palette, idempotence, click semantics, mousedown stopPropagation, no-outline, dark label text, **combined pair exclusion from unitary pins**, **load shedding / curtailment VL anchoring**, **overlapping pin fan-out**, **combined pin building (Bezier midpoint, severity, label, p1/p2, skip on missing constituent)**, **selected pin highlighting (gold star, highlighted fill, gold stroke)**, **rejected pin dimming (red cross, dimmed fill, 0.55 opacity)**, **neutral pin unmodified**, **combined pin rendering (curved path, edge stroke-width, "+" badge, severity fill)**, **curve not rescaled on zoom**, highlight cloning + background-layer ordering, pin rescale + rAF throttle + viewBox-fraction floor, fit-rect geometry |
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
| Dim layer compositing (Chrome Layerize) | Single `<rect>` overlay instead of `<g opacity>` wrapper or CSS per-child `opacity` — both alternatives force Chrome to create individual composite layers for every child element (~25-31s Layerize penalty on 11k-element NADs). The `<rect>` approach has zero stacking-context cost. |
| Highlight CTM reads | Batched: `cachedLayerCTM` is computed once per `applyActionOverviewHighlights` call, not per-clone |
| Pin rescale during wheel-zoom | `MutationObserver` + `requestAnimationFrame` throttle — at most one `getScreenCTM`-equivalent per frame. The rescaler now reads `viewBox` + `clientWidth` directly (pure math) instead of calling `getScreenCTM()` to avoid forced layouts entirely |
| Combined curve stroke width | Read once from the SVG edge paths at pin-apply time; no dynamic rescaling during zoom (curves scale naturally with the viewBox like all other SVG content) |
| ID-map lookups | `getIdMap` uses a `WeakMap` cache keyed on the container element, invalidated only when the SVG content changes |
