# Interactive Overflow Analysis

The **Overflow Analysis** tab embeds the upstream alphaDeesp HTML viewer
in an iframe and augments it with Co-Study4Grid–specific behaviour:
semantic layer toggles, action pins synchronised with the Action
Overview NAD, drill-down to the SLD on double-click, edge / line
re-routing in geo mode, and a per-pin filter widget that mirrors the
Action Overview filters.

This document is the contract for that feature. It collects every
moving part — upstream tags, geo-transform behaviour, overlay
wire-format, click semantics, filter sync — so the next person
debugging or extending the tab does not have to reverse-engineer it
from the code.

---

## 1. Architecture overview

```
┌─────────────────── Co-Study4Grid React frontend ─────────────────────┐
│ VisualizationPanel: toolbar gets a 📌 Pins toggle. Disabled until    │
│ Step 2 has streamed actions; default OFF. When ON, builds            │
│ OverflowPin[] from result.actions + n1MetaIndex + vlToSubstation     │
│ + overviewFilters and posts them to the iframe.                      │
└─────────────────────┬─────────────────────────────────────────────┬──┘
                      │ window.postMessage                          │
        cs4g:pins ▼   │   ▲ cs4g:pin-clicked                       │
        cs4g:filters ▼│   ▲ cs4g:pin-double-clicked                 │
                      │   ▲ cs4g:overflow-filter-changed            │
                      │   ▲ cs4g:overflow-layer-toggled             │
                      │   ▲ cs4g:overflow-node-double-clicked       │
                      │   ▲ cs4g:overlay-ready                      │
┌─────────────────────▼──────────────────────────────────────────────┐
│ Backend dynamic GET /results/pdf/{filename}: replaces the static    │
│ mount, reads the upstream HTML produced by the recommender, and     │
│ splices a <style>+<script> block before </body> via                  │
│ ``expert_backend.services.overflow_overlay.inject_overlay``.         │
└─────────────────────┬──────────────────────────────────────────────┘
                      │ HTML + injected overlay JS
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│ Upstream alphaDeesp ``interactive_html.py`` viewer:                 │
│  • ``data-attr-*`` flags on nodes / edges (sourced from explicit    │
│    attributes set by the recommender) drive the LAYER toggles.      │
│  • Layers grouped into 3 sections (Structural Paths / Individual    │
│    entities properties / Flow redispatch values), with a            │
│    Select-all / Unselect-all row, and a *dim*-instead-of-hide       │
│    toggle behaviour (`opacity 0.12`).                               │
│ Co-Study4Grid overlay JS (the inlined block):                       │
│  • Renders action pins on top of the SVG inside ``g.graph``.        │
│  • Adds an "Action pins filters" section to the sidebar.            │
│  • Forwards click / double-click / layer-toggle events back to      │
│    the parent.                                                      │
└─────────────────────────────────────────────────────────────────────┘
```

Phase split:
- **Phase A (upstream)** — `expert_op4grid_recommender` /
  `alphaDeesp` get the source-of-truth tagging.
- **Phase B (Co-Study4Grid backend)** — overflow HTML serving, the
  overlay injector, the geo transform.
- **Phase C (Co-Study4Grid frontend)** — toolbar toggle, pin
  payload, popover, message routing, filter sync.

---

## 2. Source-of-truth attribute tagging (upstream)

The recommender sets these explicit boolean flags on the overflow
graph it produces. The interactive viewer simply scans them — no
heuristic re-derivation from colours / shapes.

### 2.1 Node attributes

| Attribute              | Set by                                  | Drives                       |
|------------------------|------------------------------------------|------------------------------|
| `is_hub=True`          | `set_hubs_shape(...)` (auto)            | `Hubs` layer                 |
| `in_red_loop=True`     | `tag_red_loops(lines, nodes)`            | `Red-loop paths` layer       |
| `on_constrained_path=True` | `tag_constrained_path(lines, nodes)` | `Constrained path` layer     |
| `prod_or_load="prod"` + `value`  | `build_nodes` (auto)              | `Production nodes` layer (≥ 1 MW floor) |
| `prod_or_load="load"` + `value`  | `build_nodes` (auto)              | `Consumption nodes` layer (≥ 1 MW floor) |

Hubs are auto-tagged with `in_red_loop` AND `on_constrained_path`
so they always show up under those layers regardless of how the
recommender's lists are built.

`prod_or_load` is written on **every** node by upstream `build_nodes`
(see `alphaDeesp/core/graphs/power_flow_graph.py` and the
simulator-specific `build_nodes_v2` helpers in
`alphaDeesp/core/{grid2op,powsybl,pypownet}/*Simulation.py`). The
sign of `prod_minus_load` decides the kind:

* `prod_minus_load > 0` → `prod_or_load="prod"`, fillcolor `coral`
* `prod_minus_load < 0` → `prod_or_load="load"`, fillcolor `lightblue`
* `prod_minus_load == 0` → `prod_or_load="load"`, fillcolor `#ffffed`
  (the white "passive substation" placeholder — every node carries
  this even when it has neither prod nor load)

The viewer therefore filters on `abs(value) >= _PROD_LOAD_VALUE_FLOOR_MW`
(1 MW by default) when populating the Production / Consumption layers
so the placeholder zero-balance nodes don't flood the Consumption
toggle. Bumping the floor is an
`alphaDeesp/core/interactive_html.py` knob.

### 2.2 Edge attributes

| Attribute              | Set by                                  | Drives                       |
|------------------------|------------------------------------------|------------------------------|
| `is_overload=True`     | `highlight_significant_line_loading`    | `Overloads` layer            |
| `is_monitored=True`    | `highlight_significant_line_loading`    | `Low margin lines` layer     |
| `in_red_loop=True`     | `tag_red_loops(lines, nodes)`            | `Red-loop paths` layer       |
| `on_constrained_path=True` | `tag_constrained_path(lines, nodes)` | `Constrained path` layer     |

`is_overload` is a strict subset of `is_monitored` — every overload
is also a low-margin line; the inverse is not true.

### 2.3 Recommender wiring

`make_overflow_graph_visualization` (in
`expert_op4grid_recommender.graph_analysis.visualization`) accepts
the four lists (constrained-path lines/nodes, red-loop lines/nodes)
and the overloads list, then calls `tag_constrained_path`,
`tag_red_loops`, and `highlight_significant_line_loading` on the
graph before serialising.

---

## 3. Layer-toggle UI (upstream `interactive_html.py`)

The viewer's sidebar groups layers into three labelled sections:

| Section                          | Layers                                                                                                       |
|----------------------------------|--------------------------------------------------------------------------------------------------------------|
| **Structural Paths**             | Constrained path, Red-loop paths                                                                             |
| **Individual entities properties** | Reconnectable, Non-reconnectable, Swapped flow, Overloads, Low margin lines, Hubs, Production nodes, Consumption nodes |
| **Flow redispatch values**       | Positive, Negative, Null                                                                                     |

Production / Consumption nodes carry no edges — they are pure
node-only filters driven by `prod_or_load` + `value`. The sidebar
swatch is a small filled circle in the matching node fillcolor
(coral for prod, lightblue for load) so the visual mapping
between the swatch and the actual nodes on the canvas is direct.

### Section ordering

`_LAYER_SECTIONS` (Python dict in `interactive_html.py`) maps each
canonical layer key to its section. `_SECTION_ORDER` is the
top-to-bottom render order. Layers without a section assignment are
dropped entirely (e.g. the historical `color:black`, `color:gray`,
`color:darkred` buckets — replaced by the explicit `is_overload` /
`is_monitored` flags).

Each layer in the JSON model carries a `section` field; the JS
template emits one `<h3 class="layer-section-header">` whenever the
section name changes between consecutive layers.

### Dim-instead-of-hide

Toggling a layer off applies a `.layer-off` class to its claimed
nodes AND edges. The CSS rule is:

```css
.graph .layer-off { opacity: 0.12; }
```

(*not* `display: none` — pointer-events stay live, and the operator
can still see the topology).

### Membership-based dim model

Each node/edge knows the set of layers that claim it. The JS
recomputes `.layer-off` membership-wise: an element is visible iff
**at least one of its claiming layers is currently checked**. When
the operator unticks every layer, elements with no membership are
dimmed too (so a single-layer focus shows ONLY that layer).

### Endpoint-node inclusion

For colour layers, style layers, and the edge-only semantic layers
(Overloads, Low margin lines), the layer's `nodes` list is augmented
with the bbox-endpoint nodes of every claimed edge. Toggling
"Overloads" alone keeps the substations the overload connects
visible — no floating edges in dimmed space.

### Select-all / Unselect-all

A "Select all · Unselect all" link row sits above the layer
checkboxes; both flip every layer at once and dispatch the same
`change` event the individual checkboxes do.

### Edge-id alignment regression guard

`_align_edge_ids_with_svg()` walks the SVG `<title>` strings and
re-keys the JSON edge model so SVG `id="edgeN"` and JSON edge index
agree on `(src, dst)` endpoints. Without it, graphviz's two output
streams (SVG vs JSON) drift in independent orderings and the
`data-source` / `data-target` attributes on `<g class="edge">`
collide with their `<title>` content. This was a critical bug that
made the layer membership for some edges flat-out wrong.

---

## 4. Geo-mode SVG transform

The geo toggle calls `transform_html()` in
`expert_backend/services/analysis/overflow_geo_transform.py` to
re-place every node at its geographic coordinate (from
`grid_layout.json`) and redraw edges as straight lines.

### Edge rewriting

For each edge group in the SVG:
- Compute the new straight segment from source-node centre to
  target-node centre (with a small `node_gap` pull-back so the
  arrowhead tip lands on the node outline).
- For a regular edge (`<path>` + `<polygon>` arrowhead):
  - Rewrite the path's `d` to a single `M src L tgt`.
  - Rewrite the arrowhead polygon's `points` via
    `_arrowhead_points` (proportional to the edge stroke width).
  - Zero its `stroke-width` (graphviz inherits a heavy stroke onto
    the polygon that turns the triangle into a chunky blob).
- For a **tapered** edge (`data-attr-style="tapered"` =
  swapped-flow line):
  - Detected upfront — graphviz emits TWO polygons (long ~21-vertex
    body + 4-vertex arrowhead) and **no** path.
  - `_rewrite_tapered_edge` rewrites the body polygon to a 4-vertex
    tapered strip via `_tapered_strip_points` (wide at source,
    narrow at target — same visual cue as the hierarchical layout).
  - The second polygon stays the arrowhead.
  - Without this special case the body polygon was overwritten with
    a 3-vertex triangle and the swapped-flow line had no visible
    body.

---

## 5. Overlay injection

`expert_backend/services/overflow_overlay.py:inject_overlay(html)`
splices a single `<style>` + `<script>` block (with deterministic
`id` attributes) before the closing `</body>` tag. Idempotent — a
re-injection on the same file replaces the previous block.

The `<script>` body is built from a Python f-string that interleaves:
1. The full content of the **shared module**
   `frontend/src/utils/svg/pinGlyph.js` (read at request time, with
   ESM `export` keywords stripped via regex). Both this script
   AND the React Action Overview pin renderer (`actionPinRender.ts`)
   call into the same `createPinGlyph` factory — visual contract,
   colour palette, status symbols all in one place.
2. The Co-Study4Grid–specific overlay code (filters panel, pin
   layer, click handlers).

A regression test (`test_injected_script_parses_as_valid_js`) asserts
the resulting script parses cleanly. A duplicate `const SVG_NS`
between `pinGlyph.js` and the overlay IIFE silently disabled every
listener once — guarded since.

---

## 6. Action-pin overlay

### 6.1 Pin payload (parent → iframe)

```ts
interface OverflowPin {
    actionId: string;
    /** Primary anchor: substation id (overflow node `data-name`). */
    substation: string;
    /** Fallback node anchors when the graph is keyed by VL ids. */
    nodeCandidates?: string[];
    /** Edge anchors — pin lands at the midpoint of the matching edge. */
    lineNames?: string[];
    label: string;            // e.g. "92%", "DIV", "ISL"
    severity: 'green' | 'orange' | 'red' | 'grey';
    isSelected: boolean;
    isRejected: boolean;
}
```

Posted as `{ type: 'cs4g:pins', visible, pins: OverflowPin[] }`.

### 6.2 Anchor priority (mirrors `actionPinData.resolveActionAnchor`)

`buildOverflowPinPayload` in
`frontend/src/utils/svg/overflowPinPayload.ts` resolves each action
to an anchor in this priority order:

1. **Load-shedding / curtailment** → VL node directly (early
   return; never carries `lineNames`).
2. **Primary line targets** (`getActionTargetLines`) → emits
   `lineNames=[…]`; overlay anchors at edge midpoint.
3. **Voltage-level targets** (`getActionTargetVoltageLevels`) → VL
   node anchor.
4. **`max_rho_line` fallback** — only used when neither (2) nor (3)
   produced anything; emitted as the single `lineNames` entry.

This mimics `resolveActionAnchor` for the Action Overview NAD.
Coupler / node-merging / generic VL actions therefore land on their
substation node, NOT on their incidental `max_rho_line`.

### 6.3 Pin rendering — shared glyph factory

`frontend/src/utils/svg/pinGlyph.js` is plain ES JavaScript with
two consumers:

- **React/TS bundle**: imported by `actionPinRender.ts` for the
  Action Overview NAD pin layer.
- **Iframe overlay**: read as text by the Python backend, ESM
  `export` keywords stripped, body inlined into the overlay
  `<script>` block.

The factory returns an `<g class="cs4g-pin">` element with:
- Teardrop bubble (half-circle on top, tip at the anchor (0, 0))
  drawn by a single `<path>` whose fill follows the severity
  palette (`SEVERITY_FILL` / `_DIMMED` / `_HIGHLIGHTED`).
- White chrome circle behind the loading-rate label.
- Status symbol above the bubble: gold star when selected, red cross
  when rejected.
- Same colour palette as the React `pinColors*` design tokens (a
  `pinGlyph.test.ts` assertion enforces parity).

### 6.4 Anchoring math (overlay-side)

`overflow_overlay.py` provides three helpers:

- `projectToLayer(node, layer, lx, ly)` — composes
  `layer.getCTM().inverse() × node.getCTM()` to map a point from a
  node's local coordinate space into the pin layer's space. The pin
  layer is appended INSIDE `<g class="graph">` so it inherits
  graphviz's translate / scale; without the CTM math, `getBBox()`
  returned coordinates that don't include the node's own
  `translate(...)` and every pin landed at (0, 0) of `g.graph`.
- `nodeCentre(names, layer)` — walks the candidate list against
  `[data-name="<name>"]`; when a match exists, returns the node's
  *top-edge* centre (so the pin tip touches the node and the body
  floats above the label).
- `edgeCentre(lineNames, layer)` — looks up
  `[data-attr-name="<line>"]`, reads `data-source` / `data-target`,
  finds those two nodes and returns the midpoint of their
  projected centres. Tried BEFORE `nodeCentre` when the pin
  payload carries `lineNames`.

### 6.5 Pin radius

`basePinRadius(layer)` samples the first `.node` group's bbox and
multiplies by 0.55, then scales the result through the layer CTM so
the radius is in the same coordinate space as the centres. Cached
per render pass (`cachedR`) — every node in a graphviz dot output
shares the same shape size class.

### 6.6 Click semantics

The pin's `<g>` listens for both `click` and `dblclick`:

- **Single click** — debounced via 250 ms `setTimeout`. If the
  timer fires (no double click follows) the overlay posts
  `cs4g:pin-clicked` with the pin's
  `getBoundingClientRect()` (in iframe-screen pixels).
- **Double click** — clears the pending single-click timer and
  posts `cs4g:pin-double-clicked` with `{ actionId, substation }`.

The debounce is a structural requirement: without it the first click
fires `onActionSelect` (which switches the active main tab), and the
follow-up `dblclick` can no longer drill into the SLD.

### 6.7 Parent-side handlers

| Message | Parent handler | Effect |
|---|---|---|
| `cs4g:pin-clicked` | `onOverflowPinPreview(actionId)` + opens `ActionCardPopover` anchored on the pin | Feed scrolls to the matching card AND a floating popover (the SAME `ActionCardPopover` the Action Overview uses) opens around the pin. NO tab switch. |
| `cs4g:pin-double-clicked` | `handleOverflowPinDoubleClick(actionId, substation)` | Closes the popover, opens the SLD overlay with `forceTab='action'` for that substation. |

The popover translates iframe-screen coordinates to parent-screen
coordinates via `iframe.getBoundingClientRect()` and uses the same
`decidePopoverPlacement` / `computePopoverStyle` helpers as the
Action Overview pin.

### 6.8 SLD overlay action sub-tab

`SldOverlay`'s tab filter previously gated the action sub-tab on
`actionDiagram` (the *main-window* NAD action variant). When opened
via overflow-pin double-click, that's null. The filter is now:

```ts
if (tabMode === 'action') return !!actionDiagram || !!vlOverlay.actionId;
```

— so the action sub-tab is offered whenever the SLD overlay is
scoped to an action, regardless of whether the main NAD is on the
action variant.

### 6.9 Pins toggle UI

The toolbar exposes a single `📌 Pins` button (matching the `🏷 VL`
toggle visual) with `aria-pressed`, brand-soft fill when active,
`disabled` until step-2 actions exist.

State + posting:
- `App.tsx` owns `overflowPinsEnabled: boolean` (default `false`),
  `overflowPinsAvailable: !!result.actions`, `overflowPins:
  OverflowPin[]` (memoised; rebuilt when actions / metaIndex /
  vlToSubstation / monitoringFactor / selectedIds / rejectedIds /
  overviewFilters change), `overflowUnsimulatedPins: OverflowPin[]`
  (memoised; gated on `overviewFilters?.showUnsimulated`), and
  `allOverflowPins = [...overflowPins, ...overflowUnsimulatedPins]`
  which is the actual payload posted to the iframe.
- `VisualizationPanel` posts `cs4g:pins` on every relevant change
  (after the `cs4g:overlay-ready` handshake).

### 6.10 Un-simulated pin layer

Mirrors the Action Overview's "Show unsimulated" behaviour: when
the operator ticks **Show unsimulated** (parent OR iframe sidebar),
every action that has a recommender score but no simulation result
yet is rendered as a dashed grey "?" pin so it can be discovered and
double-clicked into a manual simulation.

#### Payload builder

`buildOverflowUnsimulatedPinPayload` in `overflowPinPayload.ts` mirrors
the simulated-pin builder but:

- Walks `actionsScoreInfo` (the score table) instead of
  `result.actions`.
- Skips any action already present in the simulated set
  (`simulatedIds`).
- Sets `unsimulated: true` on the resulting `OverflowPin`.
- Resolves the same anchor priority (load-shed / curtail → VL,
  primary lines → edge midpoint, VL targets → VL node,
  `max_rho_line` last resort).
- Populates the `title` field with `buildUnsimulatedPinTitle(id,
  scoreInfo)` — the SAME helper consumed by the Action Overview pin
  layer (exported from `actionPinData.ts` for cross-module reuse).
  Multi-line content: `"<id> — not yet simulated (double-click to
  run)\nType: …\nScore: … — rank N of M (max …)\nMW start: …\n…"`.

#### Wire-format addition

The `OverflowPin` interface gains two optional fields:

```ts
interface OverflowPin {
    /* …existing fields… */
    /** True for score-only pins from buildOverflowUnsimulatedPinPayload. */
    unsimulated?: boolean;
    /** Multi-line tooltip; falls back to actionId in the overlay. */
    title?: string;
}
```

#### Overlay rendering (`overflow_overlay.py`)

When `pin.unsimulated === true` the overlay:

- Calls `createPinGlyph({ ..., dimmed: true })` from the shared
  factory so the body fill follows the dimmed severity palette.
- Sets `data-unsimulated="true"` on the pin `<g>` (CSS hook + test
  selector).
- Applies a dashed stroke (`stroke-dasharray="3,3"`) AND
  `opacity: 0.5` to the bubble — visual parity with Action Overview.
- Reads `pin.title` (with fallback to `pin.actionId`) and emits a
  `<title>` child on the pin so the browser's native hover tooltip
  shows the multi-line score / rank / MW-start string.

#### Distinct double-click route

A double-click on an unsimulated pin posts
`cs4g:overflow-unsimulated-pin-double-clicked` (NOT the regular
`cs4g:pin-double-clicked`). The parent's `VisualizationPanel`
message router calls `onSimulateUnsimulatedAction(actionId)` —
the same `handleSimulateUnsimulatedAction` already used by the
Action Overview unsimulated-pin path. The popover is closed first
to mirror the simulated-pin double-click cleanup.

Single click is unchanged: `cs4g:pin-clicked` still triggers the
feed-focus + popover behaviour, which works for unsimulated pins
because `ActionCardPopover` accepts a "score-only" descriptor.

---

## 7. Action-pin filter sync

### 7.1 Filter contract

The same `ActionOverviewFilters` object drives:
- the Action Feed's card visibility,
- the Action Overview NAD's pin filtering,
- the overflow graph's pin filtering.

```ts
interface ActionOverviewFilters {
    categories: { green: boolean; orange: boolean; red: boolean; grey: boolean };
    threshold: number;          // 0–3 (max-loading rate)
    showUnsimulated: boolean;
    actionType: 'all' | 'disco' | 'reco' | 'ls' | 'rc' | 'open' | 'close' | 'pst';
}
```

The default is `DEFAULT_ACTION_OVERVIEW_FILTERS` in
`frontend/src/utils/actionTypes.ts`.

### 7.2 Filter application (parent → pins)

`buildOverflowPinPayload` accepts an optional `overviewFilters`
parameter. When passed, each action is dropped if either:
- `actionPassesOverviewFilter(details, monitoringFactor, categories,
  threshold)` returns false, OR
- `matchesActionTypeFilter(actionType, actionId, description, null)`
  returns false.

`App.tsx` always passes `overviewFilters` to the builder, so the
overflow pin set is filtered identically to the Action Overview pin
set.

The `showUnsimulated` field is the **gate** for the un-simulated
pin layer (§6.10): when `true`, `App.tsx` invokes
`buildOverflowUnsimulatedPinPayload` and concatenates its result with
the simulated payload before posting; when `false`, only the
simulated pins are posted. Toggling the field from EITHER side
(parent overview chip or iframe sidebar checkbox) drives the same
re-broadcast through `cs4g:filters` / `cs4g:overflow-filter-changed`,
keeping the two surfaces in lockstep.

### 7.3 Iframe sidebar filter panel

The overlay injects an **Action pins filters** section appended at
the BOTTOM of the upstream sidebar (separated from the layer
toggles by a top border). The section is hidden by default and
becomes visible only when the parent posts `visible: true`
together with the pin payload.

The panel mirrors every Action Overview filter chip:
- `Solves overload` / `Low margin` / `Still overloaded` /
  `Divergent / islanded` category chips with colour swatches.
- `All` / `None` bulk-select pills.
- `Max loading %` numeric input (0–300, stored × 100 internally).
- `Show unsimulated` checkbox.
- `ALL DISCO RECO LS RC OPEN CLOSE PST` action-type chip row
  (single-select).
- A `📌 N` pin counter in the section header showing the number of
  pins currently *rendered* (post-anchor-resolution count, mirroring
  `overview-pin-counter`).

### 7.4 Bidirectional sync

| Direction | Wire format | Purpose |
|---|---|---|
| Parent → iframe | `{ type: 'cs4g:filters', filters: ActionOverviewFilters }` | Re-emit on every change to `overviewFilters` so the iframe panel reflects external changes (e.g. operator changed a chip on the Action Overview). |
| Iframe → parent | `{ type: 'cs4g:overflow-filter-changed', filters: ActionOverviewFilters }` | Operator changed a chip in the iframe sidebar; parent calls `onOverviewFiltersChange(msg.filters)` so the Action Feed and the Action Overview NAD pins follow suit. |

Both ends are eventually consistent — the parent is the single
source of truth; the iframe just renders chips and posts changes.

---

## 8. Forwarded interaction events

The overlay forwards these gestures from inside the iframe to the
parent React app, where they're recorded by `interactionLogger`
(replay-ready event log):

| Wire-format type                   | Interaction event                | Payload fields              |
|------------------------------------|----------------------------------|-----------------------------|
| `cs4g:overlay-ready`               | (handshake — not logged)         | —                           |
| `cs4g:pin-clicked`                 | `overflow_pin_clicked`           | `actionId`                  |
| `cs4g:pin-double-clicked`          | `overflow_pin_double_clicked`    | `actionId`, `substation`    |
| `cs4g:overflow-unsimulated-pin-double-clicked` | `overview_unsimulated_pin_simulated` | `action_id` |
| `cs4g:overflow-layer-toggled`      | `overflow_layer_toggled`         | `key`, `label`, `visible`   |
| `cs4g:overflow-select-all-layers`  | `overflow_select_all_layers`     | `visible`                   |
| `cs4g:overflow-node-double-clicked`| `overflow_node_double_clicked`   | `name`                      |
| `cs4g:overflow-filter-changed`     | `overview_filter_changed`        | `kind: 'overflow_iframe'`   |
| (parent toolbar)                   | `overflow_pins_toggled`          | `enabled`                   |
| (parent toolbar)                   | `overflow_layout_mode_toggled`   | `to`                        |

Parent-only emitter:
- `overflow_pin_double_clicked` is logged only when
  `result.actions[actionId]` exists — stale double-clicks are
  silently dropped.

The `specConformance.test.ts` and
`scripts/check_standalone_parity.py` `_SPEC_DETAILS` table both
enforce these field sets.

---

## 9. File map

| File | Role |
|---|---|
| `expert_op4grid_recommender/graph_analysis/visualization.py` | Calls the four taggers on the graph before serialising. |
| `alphaDeesp/core/graphs/overflow_graph.py` | `set_hubs_shape`, `tag_red_loops`, `tag_constrained_path`, `highlight_significant_line_loading`. |
| `alphaDeesp/core/interactive_html.py` | Layer-index builder, section grouping, JS template, CTM-safe SVG-edge-id alignment. |
| `expert_backend/main.py` | Dynamic `GET /results/pdf/{filename}` route + path-traversal guard. |
| `expert_backend/services/overflow_overlay.py` | `inject_overlay` + the entire overlay JS payload (filters panel, pin layer, click handlers, message router). |
| `expert_backend/services/analysis/overflow_geo_transform.py` | Hierarchical → geo SVG rewrite, including tapered-edge body preservation. |
| `frontend/src/utils/svg/pinGlyph.js` | **SHARED** plain-JS pin-glyph factory, consumed by both `actionPinRender.ts` and the iframe overlay. |
| `frontend/src/utils/svg/pinGlyph.d.ts` | TypeScript declarations for the shared module. |
| `frontend/src/utils/svg/actionPinRender.ts` | Action Overview NAD pin renderer; calls the shared `createPinGlyph`. |
| `frontend/src/utils/svg/overflowPinPayload.ts` | `buildOverflowPinPayload` + `buildOverflowUnsimulatedPinPayload` — anchor priority, filter application, and unsimulated-pin payload (with multi-line `title`). |
| `frontend/src/utils/svg/actionPinData.ts` | Exports the shared `buildUnsimulatedPinTitle(id, scoreInfo)` helper consumed by both the Action Overview and the overflow unsimulated payload builder. |
| `frontend/src/components/VisualizationPanel.tsx` | Toolbar `📌 Pins` toggle, iframe ref + message router, popover state, filter rebroadcast. |
| `frontend/src/components/SldOverlay.tsx` | Sub-tab visibility logic (`actionDiagram` OR `vlOverlay.actionId`). |
| `frontend/src/hooks/useSldOverlay.ts` | `handleVlDoubleClick(actionId, vlName, forceTab?)` — forceTab path used by the pin double-click. |
| `frontend/src/App.tsx` | Wires `overflowPinsEnabled`, `overflowPins`, `handlePinPreview`, `handleOverflowPinDoubleClick`, `overviewFilters` flow. |

---

## 10. Tests

### Backend (`expert_backend/tests/`)

- `test_overflow_overlay.py` — overlay injection idempotency, pin
  click/dblclick listener presence, single-click debounce sentinel,
  shared-glyph inlining, no duplicate `const SVG_NS`, pin layer
  parented inside `g.graph`, action pins filter section appended
  at the END of the sidebar, pin counter API present, **unsimulated
  pins get dashed stroke + dim opacity**, **unsimulated dblclick
  routes through `cs4g:overflow-unsimulated-pin-double-clicked`**,
  **`pin.title` is consumed when present (fallback to actionId
  otherwise)**.
- `test_overflow_geo_transform.py` — geo-mode rewrites including
  the tapered-edge body / arrowhead split.
- `test_overflow_html_dim_logic.py` — section grouping, member-
  ship-based dim model, edge-id alignment guard, `is_overload ⊂
  is_monitored` semantics.

### Frontend (`frontend/src`)

- `utils/svg/pinGlyph.test.ts` — palette parity vs design tokens,
  star / cross paths, glyph variants.
- `utils/svg/overflowPinPayload.test.ts` — anchor resolution,
  load-shed / curtail early-return, line-name vs VL fallback,
  `nodeCandidates` carry-through, plus **`buildOverflowUnsimulatedPinPayload`
  coverage**: simulated-id skip, null `metaIndex` short-circuit,
  empty score table, dedupe by `actionId`, anchor-priority parity
  with the simulated builder, multi-line `title` populated from
  `buildUnsimulatedPinTitle`, fallback to `actionId` when no score
  info is present.
- `components/VisualizationPanel.test.tsx` — toolbar toggle gating,
  message-router behaviour, popover state.
- `hooks/useSldOverlay.test.ts` — `forceTab` override.
- `utils/specConformance.test.ts` — every wire-format event has its
  required fields documented.
- `scripts/check_standalone_parity.py` — auto-generated standalone
  inherits the same gestures.

---

## 11. Reset / lifecycle invariants

- **Apply Settings / Load Study** clears `result`, which clears
  `overflowPinsAvailable`; an effect auto-disables
  `overflowPinsEnabled` when availability goes false.
- **URL change on the iframe** (regenerate-overflow-graph or fresh
  Step-2 PDF event) resets `overlayReady` (re-armed by the
  iframe's `cs4g:overlay-ready` handshake) AND drops any open
  popover.
- **Overflow layout cache** — backend
  `_overflow_layout_cache` and `_overflow_layout_mode` are cleared
  on `reset()` and on each fresh `run_analysis_step2`.
- **Filter state survives** the iframe re-load (it's owned by the
  React parent); the parent re-broadcasts `cs4g:filters` after
  every `overlay-ready`.

---

## 12. Verification

After any change in this feature:

```bash
# Backend
pytest expert_backend/tests/test_overflow_overlay.py
pytest expert_backend/tests/test_overflow_geo_transform.py
pytest expert_backend/tests/test_overflow_html_dim_logic.py

# Frontend
cd frontend
npm run test
npm run build:standalone

# Parity gates
python scripts/check_standalone_parity.py
python scripts/check_invariants.py
python scripts/check_session_fidelity.py
python scripts/check_gesture_sequence.py

# Sanity-check the injected JS still parses (no duplicate `const`,
# no f-string brace mishap).
python -c "from expert_backend.services.overflow_overlay import inject_overlay; print(len(inject_overlay('<html><body></body></html>')))"
```

Manual smoke (small grid):
1. Load `data/bare_env_small_grid_test`, pick contingency
   `P.SAOL31RONCI`, run analysis to completion.
2. Open Overflow Analysis tab — verify three layer sections plus a
   Select-all / Unselect-all row above them, dim-instead-of-hide
   behaviour.
3. Toggle `📌 Pins` → action pins appear:
   - line actions at edge midpoints, VL actions on substations,
   - severity colours match the Action Overview palette,
   - `📌 N` counter in the new "Action pins filters" section reflects
     the count.
4. Click a pin once → feed scrolls to the card AND a popover opens
   around the pin (no tab switch).
5. Double-click the same pin → popover closes, SLD overlay opens
   with the action sub-tab selected and showing the post-action
   variant for that substation.
6. Toggle a category chip in the iframe sidebar → Action Overview
   pins and Action Feed cards filter in lock-step.
7. Tick **Show unsimulated** (parent overview OR iframe sidebar) →
   dashed grey "?" pins appear on top of the simulated set; hovering
   one reveals the multi-line tooltip (`<id> — not yet simulated …`,
   `Type:`, `Score: … rank …`, `MW start: …`); double-clicking kicks
   off the manual simulation flow (`overview_unsimulated_pin_simulated`
   appears in the interaction log).
8. Untick **Show unsimulated** → the dashed pins disappear immediately
   on both surfaces.
9. Switch to Geo layout → swapped-flow lines keep their tapered
   body AND arrowhead.
