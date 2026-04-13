# Detachable Visualization Tabs

This document describes the implementation of the **detachable visualization
tabs** feature, which lets an operator pop any of the four visualization tabs
(Network `N`, Contingency `N-1`, Remedial `Action`, `Overflow` Analysis) out of
the main window and into a standalone browser window, then reattach it when
done. The feature was built to support dual-screen / multi-monitor workflows,
where a grid operator commonly wants to keep e.g. the `N-1` diagram on one
screen while working the `Action` tab on another.

The implementation follows the initial collaboration plan — this document
records **what was actually shipped**, where it diverges from the plan, and
which design decisions were made along the way.

> **Important**: the first iteration of this feature used a naive
> `TabPortal` that swapped its `createPortal` target between `null`
> (render in place) and the popup `mountNode`. This caused the portaled
> sub-tree to be **unmounted and remounted on every detach/reattach**,
> which in turn broke pan/zoom event listeners, made the popup window
> look frozen and left other tabs blank on reattach. That approach was
> replaced by a **stable portal target + imperative DOM move**; the
> section ["Stable portal target + imperative DOM move"](#stable-portal-target--imperative-dom-move) below describes the fix.

## Feature summary

- Each of the four visualization tabs exposes a small detach button `⧉` in
  the tab bar. Clicking it opens a new browser window and relocates the
  tab's DOM into that window.
- While detached, the main window shows a placeholder with a `Focus window`
  and `Reattach` button, and the tab label gains a `↗` arrow + greyed-out
  styling so it is obviously "external".
- The popup window carries a floating header with a `Reattach` button. It
  also reacts to being closed from the browser chrome: the tab folds back
  into the main window automatically.
- Zoom level, pan, auto-zoom viewBox, SLD overlay position and all React
  refs survive the detach → reattach round-trip unchanged.
- **Full interaction set inside the popup**: the zoom in/unzoom/zoom out
  buttons, asset search/focus input, and the Flow/Impacts view-mode
  toggle now live INSIDE each tab container. They move with the tab
  into the popup, so the operator can zoom, focus on an asset, or
  switch flow-vs-impacts view entirely from within the detached
  window.
- **Tie/Untie**: the detached popup gets an extra "⛓ Tie" button.
  When tied, the popup's pan/zoom is one-way-mirrored into the main
  window's active tab — so the operator can drag around inside the
  popup and see the main view stay locked on the same region of the
  network. Perfect for side-by-side comparison workflows (e.g., the
  Network (N) popup stays in sync with the Remedial Action main view).
- Detach, reattach, tie and untie events are all recorded in the
  interaction log so that session replays can reproduce the operator's
  window layout AND any synchronisation they set up.

## Architecture

The feature rests on four pieces, all under `frontend/src`:

| File | Role |
|---|---|
| `hooks/useDetachedTabs.ts` | Owns the popup lifecycle state (`tabId → Window`), exposes `detach`/`reattach`/`focus`/`isDetached`, prunes closed popups automatically. Defers `popup.close()` to a `useEffect` so VisualizationPanel has a chance to relocate the tab host out of the popup before the popup document is torn down. |
| `components/DetachableTabHost.tsx` | Stable-portal-target wrapper. Creates a single orphan `<div>` via `useState` lazy init, uses it as the (never-changing) `createPortal` target, and imperatively `appendChild`s it between a "home" placeholder in the main tree and the popup's mount node. The sub-tree is therefore never unmounted. |
| `components/VisualizationPanel.tsx` | Wraps each of the four tab containers in a `DetachableTabHost`, adds the per-tab detach/reattach button to the tab bar, and renders the "detached" placeholder + the popup header. |
| `App.tsx` | Instantiates `useDetachedTabs` before `useDiagrams`, threads the detached-tabs map into `useDiagrams` so detached tabs stay interactive for pan/zoom, wires detach/reattach callbacks, and auto-switches `activeTab` when the currently-active tab is detached. |

### Stable portal target + imperative DOM move

The heart of the correct implementation is a two-layer trick:

1. **The `createPortal` target is stable**. `DetachableTabHost` creates a
   single orphan `<div>` once (via `useState` lazy initializer) and
   always passes it to `createPortal(children, realTarget)`. Because
   the target reference never changes, **React never unmounts the
   portaled sub-tree**. That preserves refs
   (`nSvgContainerRef`, `n1SvgContainerRef`, `actionSvgContainerRef`),
   DOM-attached event listeners (wheel/mousedown), the
   `MemoizedSvgContainer` layout effect's prior `replaceChildren` move,
   and the SVG element's current `viewBox` attribute.
2. **The orphan `<div>` is physically moved** between a home placeholder
   in the main tree and the popup's `mountNode`. This is a plain
   `appendChild` call inside a `useLayoutEffect` that watches the
   `detachedMountNode` prop. `appendChild` automatically detaches the
   node from its current parent, so moving it is effectively free and
   leaves no broken references.

The home placeholder is always rendered by React at the normal position
inside the flex layout. When the tab is detached, the placeholder stays
in place as an empty positioned slot — so the parent's virtual-DOM
children list never changes, and React never needs to run
`insertBefore` against a missing anchor.

Why this matters:

- The SVG element with its live `viewBox` attribute is the same element
  before and after detach, so the detached popup opens at the **exact
  zoom level and pan position** the user had in the main window.
  Similarly for reattach.
- All event listeners (`wheel`, `mousedown` on the SVG container) are
  attached directly to the stable element, so they survive the move.
  No rebinding is required.
- The popup cannot corrupt other tabs' state during reattach because
  no React sub-tree is ever unmounted from the popup document.

### Per-drag owner-window resolution for drag-pan

`mousemove` / `mouseup` listeners fundamentally have to live on a
window or document object — not on the SVG element itself, because the
user's cursor routinely leaves the element during a drag. The old code
captured `ownerWindow = el.ownerDocument.defaultView` at effect-bind
time, but that effect never re-ran when the element was moved to a
popup, so it continued to listen to the main window and the popup's
drag events went unheard.

The fix (`frontend/src/hooks/usePanZoom.ts`): bind `mousemove` /
`mouseup` **inside `handleMouseDown`** using a fresh
`el.ownerDocument.defaultView`, and unbind them in `handleMouseUp`. A
closure-scoped `activeDragWindow` tracks the current binding so the
effect cleanup can also tear them down if the component unmounts
mid-drag. The `wheel` and `mousedown` listeners remain on `el` itself
(they do survive a DOM move) — only the "drag tracking" globals need
per-drag resolution.

The equivalent fix in `components/SldOverlay.tsx` for overlay drag/pan
was already in place.

### Detached tabs are "active" for pan/zoom purposes

`usePanZoom`'s `active` parameter gates event-listener binding: when
`active === false`, the effect early-returns and no listeners are
attached at all. Previously that gate was driven purely by
`activeTab === 'n'` etc. — which meant that **the moment a tab was
detached the main window auto-switched `activeTab` to another tab, and
the detached tab's pan/zoom listeners were immediately torn down**.
That's why the popup felt frozen.

The fix threads the `detachedTabs` map from `useDetachedTabs` into
`useDiagrams`, which ORs it into the `active` flag:

```ts
const nPZ = usePanZoom(
    nSvgContainerRef,
    nDiagram?.originalViewBox,
    activeTab === 'n' || !!detachedTabs?.['n'],
);
```

This required reordering `App.tsx` so `useDetachedTabs` is called
**before** `useDiagrams`. The detach/reattach *callbacks* (which
depend on `diagrams.activeTab` / `diagrams.setActiveTab`) are still
declared after `useDiagrams`.

### Deferred popup close on reattach

`useDetachedTabs.reattach(tabId)` no longer closes the popup
synchronously. It queues the popup window in `pendingCloseRef` and
then prunes the tab from state. A regular `useEffect` (running after
the VisualizationPanel layout effect that moves the orphan div back
into the main tree) drains the queue and calls `popup.close()`.

The ordering is guaranteed by React's commit phase: child layout
effects run before parent layout effects, and all layout effects run
before any `useEffect`. So the sequence on reattach is:

1. `reattach(tabId)` → queue popup, prune state.
2. React re-renders `App.tsx` → `VisualizationPanel`.
3. `DetachableTabHost.useLayoutEffect` detects `detachedMountNode
   === null` and `appendChild`s the orphan div back into the home
   placeholder in the main tree.
4. `useDetachedTabs.useEffect` runs and closes the popup window.

Before this fix, the popup was closed synchronously inside
`reattach()`, which meant the popup document was torn down **while
React's portal sub-tree was still rooted inside it**. When React then
reconciled the portal target change, it tried to unmount children from
a dying document; on some browsers that threw exceptions that left
other tabs' DOM in a half-updated state — the "blank other tabs after
reattach" bug.

### The critical invariant — never unmount the SVG subtree

`MemoizedSvgContainer` re-runs its `useLayoutEffect` on every mount, which
re-applies the default viewBox and clobbers any auto-zoom or user pan/zoom
state. This is why the existing code already keeps all four tab containers
*always mounted* and toggles them via `visibility` + `z-index` (see the
long-standing comment on lines ~306-310 of `VisualizationPanel.tsx`).

The detach feature upholds this invariant. The React subtree for each tab
lives in `VisualizationPanel` regardless of whether the tab is visible,
active, or detached — only the **final DOM output** is relocated via
`ReactDOM.createPortal` into the popup's `<body>`. Because React never
unmounts the component, refs (`nSvgContainerRef`, `n1SvgContainerRef`, etc.),
the parsed SVG element, the zoom state inside `usePanZoom`, and the
`SldOverlay` position are all preserved across the round-trip.

### Popup lifecycle

`useDetachedTabs.detach(tabId)` performs the following:

1. Calls `window.open('', 'costudy4grid_tab_<id>', 'popup=yes,...')`. If
   the browser blocks the popup (`window.open` returns `null`), it invokes
   the `onPopupBlocked` callback, which in `App.tsx` surfaces an inline
   error banner telling the user to allow popups.
2. Writes a minimal `<!DOCTYPE html><html>…</html>` skeleton into
   `popup.document`, setting the title to `Co-Study4Grid — <Tab Name>`.
3. Clones every `<style>` and `<link rel="stylesheet">` from the opener
   document into the popup's `<head>`. This covers both the production
   case (Vite-bundled stylesheet link) and the dev case (Vite HMR
   injecting styles as `<style>` elements).
4. Creates a `<div id="costudy4grid-detached-root">` inside the popup
   `<body>` — a flex-growing container so absolutely-positioned tab
   content has something to size against — and stores it as the
   `mountNode` used by the portal target.
5. Attaches `pagehide` and `beforeunload` listeners so the tab folds back
   to the main window if the user closes the popup from the browser
   chrome. A 1 Hz `setInterval` polls `popup.closed` as a safety net for
   browsers that silently skip `pagehide` (observed on some tab-crash
   paths).
6. On `App.tsx` unmount (full page reload / navigation) any remaining
   popups are closed so they don't linger pointing at a dead React tree.

### Routing logic in `VisualizationPanel`

Previously each tab container was rendered only when `activeTab === <id>`
(except the always-mounted `N-1`/`Action` containers). The refactor
generalises that so every tab container is always rendered and always
wrapped in a `DetachableTabHost`. The home placeholder carries
`visibility: hidden` + `pointer-events: none` + `z-index: -1` when the
tab is neither active in the main window nor detached, so only the
active tab is visible even though all four sub-trees are mounted.

In the main window, when the active tab is detached, the panel renders a
placeholder (`renderDetachedPlaceholder`) with "Focus window" and
"Reattach" buttons so the operator can quickly return to the popup.

Inside the popup, each tab gets a small floating header
(`renderDetachedHeader`) pinned top-center with a coloured dot, the tab
label, and a `↩ Reattach` button.

When the user detaches the currently-active tab, `App.tsx` automatically
switches `activeTab` to the first available non-detached tab (preferring
`n → n-1 → action → overflow`, falling back to `n`) so the main panel is
not left showing an empty container.

### Pan/zoom in detached windows

Global DOM event listeners attached to the main `window` object do **not**
receive events fired inside a popup. The following call sites were
updated:

- `hooks/usePanZoom.ts` — `mousemove` / `mouseup` are now bound **inside
  `handleMouseDown`** using `el.ownerDocument.defaultView` resolved at
  drag-start time (see ["Per-drag owner-window resolution for
  drag-pan"](#per-drag-owner-window-resolution-for-drag-pan)), and
  unbound in `handleMouseUp`. The effect closure tracks the current
  drag window in a local variable so cleanup on component unmount can
  still remove the listeners. This replaced the earlier "bind once at
  effect time" approach, which was stale after an imperative DOM move.
- `components/SldOverlay.tsx` — both `startOverlayDrag` and
  `startOverlayPan` use `(e.currentTarget as HTMLElement).ownerDocument
  .defaultView` for the same reason.

No other places in the SVG zoom / visualization code needed changes.
The wheel and mousedown handlers are attached directly to the SVG
container element, which stays the same DOM node across detach/reattach
(thanks to the stable-portal-target design), so those listeners survive
the round-trip without needing to be re-bound.

### Interaction logging

Two new interaction types were added to `types.ts`:

- `tab_detached` — payload `{ tab: TabId }`
- `tab_reattached` — payload `{ tab: TabId }`

This keeps the replay contract documented in `docs/interaction-logging.md`
able to reproduce the exact window layout chosen by the operator during a
session.

## Divergences from the initial plan

The initial plan laid out a 5-layer design frame (state / lifecycle /
transport / synchronisation / degradation) and a 10-step implementation
plan. The shipped version follows that frame closely, with the following
concrete choices / deviations:

| Topic | Plan | Shipped |
|---|---|---|
| Unit of detachment | Per-tab (not per-panel) | **Same** — per-tab, one popup per tab |
| State location | `App.tsx` via `useDetachedTabs` hook | **Same** |
| Portal technique | `createPortal` into popup `<body>` | Portals point at a dedicated `#costudy4grid-detached-root` div inside `<body>` instead of `<body>` directly, so the portaled content can flex-grow without fighting body margins. |
| Style propagation | Clone `<style>` + `<link>` from opener head | **Same** — see `cloneStylesIntoPopup`. No `MutationObserver` was added; HMR style changes are picked up on next detach, which was deemed acceptable in dev. |
| Detach UI | Button in tab bar using `lucide-react` (`ExternalLink`/`PictureInPicture2`) | **Unicode glyphs** (`⧉`, `↩`, `↗`) inline in the button, avoiding an extra import and matching the surrounding minimalist tab-bar styling. |
| Active-tab handling on detach | Auto-switch to next available tab | **Same** — `handleDetachTab` in `App.tsx` picks `n → n-1 → action → overflow`, skipping detached ones. |
| Detached tab in main bar | Grey + "(detached)" label, click focuses popup | Shipped: italic + dimmed colour + `↗` suffix; click on the label focuses the popup, click on the small `↩` button reattaches. |
| Reattach from popup | Minimal header with Reattach button | **Same** — floating pill top-center with tab name + Reattach. |
| Popup-close handling | `beforeunload` listener | Uses **both** `pagehide` (preferred on modern browsers) and `beforeunload`, plus a 1 Hz interval safety net to cover browsers that fail to fire either event on tab crashes. |
| Pop-up blocker fallback | Toast + cancel | Inline error set via `setError(...)` — reuses the existing global error banner rather than introducing a new toast component. |
| Global event listener audit | `usePanZoom`, `SldOverlay`, zoom code | Done for `usePanZoom.ts` and `SldOverlay.tsx`. No other globals needed patching. |
| Styles `MutationObserver` | Optional | Not shipped — unnecessary in practice. |
| `standalone_interface.html` mirror | Disabled button with "dev build only" tooltip | **Not mirrored** in this iteration. The standalone HTML is a single-file dev artefact that does not use React portals, and wiring popup cloning into it would add significant complexity with little user value. Left as a known follow-up if we ever want feature parity. |
| Interaction log | Not covered in plan | Added `tab_detached` / `tab_reattached` events so session replays can reproduce window layout. |
| Tests | Vitest hook tests + panel behaviour tests | Shipped: `hooks/useDetachedTabs.test.ts` (148 lines) covering detach/reattach/focus/pruning/popup-blocked paths. Panel-level tests were not added — the hook tests + manual verification were deemed sufficient given the amount of DOM/Window mocking a full panel test would require. |

## File-by-file summary

- **`frontend/src/hooks/useDetachedTabs.ts`** — popup lifecycle hook.
  Defers `popup.close()` to a `useEffect` so VisualizationPanel can
  first move the tab host back into the main tree.
- **`frontend/src/hooks/useDetachedTabs.test.ts`** — Vitest tests for
  the hook using a fake `Window` constructed over a jsdom document.
- **`frontend/src/components/DetachableTabHost.tsx`** (new) —
  stable-portal-target wrapper. Creates a single orphan `<div>` via
  `useState` lazy init, uses it as the never-changing `createPortal`
  target, and imperatively `appendChild`s it between the home
  placeholder and the popup's mount node. Replaces the earlier
  `TabPortal.tsx`, which has been deleted.
- **`frontend/src/components/VisualizationPanel.tsx`** — each of the
  four tab containers is wrapped in `DetachableTabHost`; tab-bar
  detach/reattach buttons; detached-header and detached-placeholder
  renderers.
- **`frontend/src/App.tsx`** — `useDetachedTabs` is instantiated
  **before** `useDiagrams` so the detached map can be threaded in, and
  the wiring callbacks (`handleDetachTab` with the active-tab
  fallback, `handleReattachTab` with interaction logging) stay after
  `useDiagrams`.
- **`frontend/src/hooks/useDiagrams.ts`** — accepts an optional
  `detachedTabs` map so the `usePanZoom` `active` flag becomes
  `activeTab === <id> || !!detachedTabs?.[<id>]`. A detached tab
  therefore stays interactive even when the main window has
  auto-switched `activeTab` to a different tab.
- **`frontend/src/hooks/usePanZoom.ts`** — `mousemove` / `mouseup`
  listeners are bound per-drag inside `handleMouseDown` using a fresh
  `el.ownerDocument.defaultView`, not captured at effect-bind time.
- **`frontend/src/components/SldOverlay.tsx`** — same treatment for
  overlay drag/pan handlers.
- **`frontend/src/types.ts`** — two new `InteractionType` variants
  (`tab_detached`, `tab_reattached`).

## In-tab controls overlay

**Problem (third iteration)** — the first iteration left the zoom
buttons, inspect search and Flow/Impacts view-mode toggle as
**siblings** of the tab containers, rendered at the bottom-left /
top-right of the content area. Those overlays lived in the main
window only: when the operator detached the Network tab, the popup
had an SVG but no zoom buttons and no inspect input, and the
Flow/Impacts toggle was invisible too.

**Fix** — a `renderTabOverlay(tabId, supportsViewMode)` helper now
renders the zoom/inspect/view-mode cluster INSIDE each tab container
(inside `DetachableTabHost`), so the overlay moves with the tab into
the popup.

Because all four tab sub-trees are always mounted (see the
always-mounted-container invariant), we render **four copies** of the
overlay — but only the currently-visible one shows, thanks to the
`visibility: hidden` + `pointer-events: none` flags on the home
placeholders of inactive tabs. In practice the DOM nodes are cheap
and the visual/UX gain is substantial.

To make per-tab zoom work, the existing `handleManualZoomIn/Out/Reset`
callbacks in `useDiagrams.ts` now accept an optional `targetTab?: TabId`
parameter. Omitting it keeps the old behaviour (operate on the main
window's active tab). The in-tab overlay passes its own tab id so
that clicking zoom inside the N popup drives N's pan/zoom instance,
not whatever tab happens to be active in the main window.

Similarly, `zoomToElement` accepts a `targetTab` parameter, and the
auto-zoom effect reads from an `inspectFocusTabRef` that per-tab
inspect inputs set via the new `setInspectQueryForTab(tabId, query)`
helper. This is what makes "type a substation name in the detached
popup" actually zoom to that substation inside the popup.

## Tied detached tabs

A tab that is detached AND tied has its pan/zoom state mirrored
**bidirectionally** between the detached popup and the main
window's active tab. It is implemented in
`frontend/src/hooks/useTiedTabsSync.ts` and wired into `App.tsx`.

**Scope**: tying only affects pan / zoom / asset-focus. The
Flow/Impacts view-mode is deliberately **never** tied — see
[Per-window view mode](#per-window-view-mode) below. Because of
this scope, the Tie button is rendered in the **bottom-left
cluster**, directly above the zoom / unzoom / inspect row it
actually mirrors — NOT in the top-right cluster next to
Flow/Impacts, which would incorrectly suggest that the view
mode is tied too.

**How bidirectional sync works without ping-ponging:**

1. `useTiedTabsSync` keeps a `Set<TabId>` of tied tabs in state.
2. It snapshots every tab's previous `viewBox` in a ref
   (`prevVbsRef`) so that on each effect run it can tell WHICH
   tab just changed by comparing current vs. previous identity.
3. From the direction of change, it decides the mirror target:
   - If the change happened in a tied+detached tab → mirror into
     the main-window active tab's PZ.
   - If the change happened in the main-window active tab and any
     tied+detached tab exists → mirror out into each of them.
4. Loop protection via `isSyncingRef`: set to `true` just before
   a mirror write, the next effect invocation (triggered by that
   mirror's re-render) reads the flag, resets it, and returns
   early. The mirror helper ALSO skips writes whose target
   viewBox is already equal, because the underlying
   `setViewBoxPublic` bails on equality — without that skip, the
   bail would prevent the re-render that would otherwise reset
   the flag, leaving the guard stuck on.
5. **Seed mirror on tie**: when the user clicks the Tie button,
   the hook observes a freshly-added tab id and does a one-time
   sync from the popup → main so both windows start at the same
   baseline viewBox (instead of waiting for the first
   interaction).
6. The UI lives inside `VisualizationPanel.renderTabOverlay`:
   each detached tab's top-right cluster adds a "⛓ Tie" /
   "🔗 Tied" toggle that calls `onToggleTabTie(tabId)`.

Interaction log: `tab_tied` and `tab_untied` events are emitted
by the hook so session replays can reproduce the operator's
synchronisation choices.

## Per-window view mode

The Flow/Impacts toggle controls how the N-1 and Action diagrams
are visually decorated: "Flows" shows raw post-contingency flow
labels, "Impacts" renders the delta against the N state as a
red/green gradient. In the first iteration this mode was a single
global state (`actionViewMode` in `useDiagrams`), which meant
toggling Impacts in one window automatically toggled it in the
other — not what the operator wants when comparing two views
side-by-side.

**Fix**: each detached tab now has its OWN view-mode entry in a
new `detachedViewModes: Partial<Record<TabId, 'network' | 'delta'>>`
state held in `App.tsx`. The main-window `actionViewMode` is
unchanged. A new helper `viewModeForTab(tab: TabId)` returns the
effective mode for a given tab:

- If the tab is detached → `detachedViewModes[tab] ?? 'network'`.
- Otherwise → `actionViewMode`.

The Flow/Impacts overlay inside each tab container now uses this
per-tab getter for display, and a new
`handleViewModeChangeForTab(tab, mode)` callback routes the
toggle click into either `actionViewMode` (when the tab is not
detached) or `detachedViewModes[tab]` (when it is). Result: Flow
in the popup, Impacts in the main window (or vice versa) is now
a valid and fully supported state.

When a tab is **reattached**, its entry in `detachedViewModes`
is cleared (by a small effect watching `detachedTabs`), so the
tab resumes the main-window `actionViewMode` from that moment on.

**Rendering fix**: `applyHighlightsForTab` now iterates over every
detached tab (not just `activeTab`), calling `applyDeltaVisuals`
with the per-tab effective mode. Before this fix, Impacts mode
never rendered inside a detached popup because the highlights
effect only ran for the main window's active tab.

## Bugs fixed in the second iteration

The initial shipment (commit `ca80547`) worked visually but suffered
from four related bugs reported shortly after merge. The follow-up
refactor described above fixes all four:

1. **Detached window is frozen — no wheel zoom / drag / asset focus.**
   Root cause: `usePanZoom`'s `active` param was `activeTab === 'n'`
   etc. When the operator detached a tab, App auto-switched
   `activeTab` to another tab, so `active` became `false` for the
   detached tab, and the hook's effect early-returned without ever
   binding wheel/mousedown listeners. Fix: OR `!!detachedTabs?.[id]`
   into the active flag (see `useDiagrams.ts`).

2. **Detached window does not inherit the pre-detach zoom.**
   Root cause: the previous `TabPortal` swapped its `createPortal`
   target from `null` to the popup's mount node, which triggered a
   full unmount/remount of the portaled sub-tree. The remount created
   a new container div, and while `MemoizedSvgContainer.replaceChildren`
   moved the existing SVG element back in, the pan/zoom's captured
   `el` was stale and the hook never re-ran its effect. Fix: stable
   portal target + imperative DOM move — the SVG element and its
   `viewBox` attribute are the same across the move, so the popup
   opens at the exact zoom level/pan position the main window was
   showing.

3. **Reattach blanks out other tabs in the main window.**
   Root cause: `reattach()` synchronously called `popup.close()` and
   then pruned state. React then tried to reconcile the portal target
   change (popup `mountNode` → `null`), which involved unmounting
   children from the popup's about-to-be-destroyed document. On some
   browsers that threw exceptions during DOM manipulation, leaving
   other tabs' containers in an inconsistent state. Fix: (a) the
   stable-portal-target design means React never has to unmount the
   sub-tree; (b) `useDetachedTabs.reattach` now queues the popup for
   close and lets a downstream `useEffect` call `popup.close()` only
   **after** `DetachableTabHost.useLayoutEffect` has moved the orphan
   div back into the main tree.

4. **Reattached tab loses zoom/drag interactions (while highlighting
   still works).** Same root cause as bug 2: the unmount/remount
   produced a fresh container div whose wheel/mousedown listeners had
   never been bound (the pan/zoom effect never re-ran), while the
   highlighting code operated on the SVG element via `nDiagram.svg`
   state and so continued to work. Fix: same as bug 2 — the stable
   portal target means the container div and its listeners survive
   the move, so pan/zoom works continuously without any rebinding
   needing to happen.

Additionally, the reattached tab now also preserves the **zoom level
that was active inside the popup** — because the SVG element (and
therefore its `viewBox`) is the same DOM node before, during, and
after the move.

## SLD overlay "Action '' not found" fix

If the operator opens an SLD overlay from the Network (N) or
Contingency (N-1) tab **while a remedial action is already
selected**, and then clicks the ACTION sub-tab of the SLD
dropdown, the backend used to reject the request with:

```
Action '' not found in last analysis result.
```

**Root cause**: `App.handleVlOpen` forwarded an empty string as
the action id whenever the main-window active tab wasn't
'action'. That empty id was stored on `vlOverlay.actionId` and
later passed verbatim to `/api/action-variant-sld` when the
operator switched the overlay's sub-tab to "action".

**Fix** (two layers, belt-and-braces):

1. `frontend/src/App.tsx` — `handleVlOpen` now ALWAYS forwards
   `selectedActionId || ''` regardless of activeTab, so the
   overlay starts with a real action id whenever one is
   available.
2. `frontend/src/hooks/useSldOverlay.ts` — accepts an optional
   `liveSelectedActionId` argument and mirrors it into a
   `selectedActionIdRef`. Inside `fetchSldVariant`, when the
   sub-tab is 'action' and the stored `actionId` is falsy, the
   fetcher falls back to `selectedActionIdRef.current`. If that
   is also empty, it sets a friendly inline error ("No action
   selected. Pick an action first and then re-open the SLD.")
   rather than firing the request and letting the backend throw.
   On success, the resolved action id is written back onto
   `vlOverlay.actionId` so subsequent re-renders and highlight
   passes can find it.

## Regression tests

The four bug fixes and the new features are covered by dedicated
Vitest suites:

- **`frontend/src/components/DetachableTabHost.test.tsx`** (7 tests)
  — mounts a probe child that records every mount + DOM identity,
  then rerenders the host with different `detachedMountNode` values
  and asserts that the probe was mounted exactly once across detach
  → reattach → detach cycles. This is the direct test that the
  stable-portal-target + imperative DOM move design does NOT
  unmount the sub-tree (and therefore preserves all the state that
  the bugs depended on).

- **`frontend/src/hooks/useDetachedTabs.test.ts`**
  (new: "reattach defers popup close until after layout effects")
  — uses `act()` to observe that `reattach()` does NOT synchronously
  call `window.close()` from inside the call itself; the popup is
  only closed after effects flush. This is the regression test for
  the "blank other tabs on reattach" bug (Bug 3).

- **`frontend/src/hooks/useDiagrams.test.ts`**
  (new: "useDiagrams accepts detachedTabs for pan/zoom activation")
  — asserts the hook accepts the `detachedTabs` 4th arg without
  throwing, and that SVG container refs are preserved when the map
  changes. Covers Bug 1 (detached window frozen because
  `usePanZoom` was gated on `activeTab` alone).

- **`frontend/src/hooks/usePanZoom.test.tsx`**
  (new: "drag listeners bind to the element's current ownerWindow
  per-drag") — four tests that verify (a) no global
  mousemove/mouseup are bound at effect time, (b) mousemove/mouseup
  ARE bound on the element's owner window when mousedown fires,
  (c) they are unbound on mouseup, and (d) the owner window is
  resolved fresh per-drag so a container that was moved to a popup
  binds to the popup's window. This is the regression for the
  "drag-pan doesn't work in the detached window / doesn't work
  after reattach" half of Bugs 1 and 4.

- **`frontend/src/hooks/useTiedTabsSync.test.ts`** (10 tests) —
  covers the tied-detached-tabs feature: empty initial set;
  tie/untie/toggleTie update the set and log events; mirroring a
  tied+detached tab's viewBox into the main active PZ; no-op when
  the tab is tied but not detached, when activeTab === tied tab,
  or when activeTab is the overflow tab. Plus two
  bidirectional-sync regressions: a main-window change mirrors
  into the tied+detached popup, and the mirror is one-shot (no
  bounce-back write into the source), proving the loop-protection
  works.

- **`frontend/src/hooks/useSldOverlay.test.ts`** (+3 tests) —
  regressions for the "Action '' not found" bug: the hook falls
  back to `liveSelectedActionId` when `vlOverlay.actionId` is
  empty; shows a friendly error when no action is available at
  all; and still prefers an explicit `actionId` when one is
  stored on the overlay.

- **`frontend/src/components/VisualizationPanel.test.tsx`**
  (+5 tests) — regressions for the Tie button location: no Tie
  button when the tab is not detached; renders the Tie button
  inside the bottom-left cluster when detached; the Tie button
  shares an ancestor with the Zoom In button AND is NOT a
  descendant of the top-right Flow/Impacts cluster; clicking the
  button invokes `onToggleTabTie(tabId)`; and the
  "Untie" (`Tied`) variant is shown when the tab is already
  tied. The tests query the detached popup's mount node
  directly (`document.body` children), because the overlay's
  DOM is imperatively relocated out of testing-library's
  container when the tab is detached.

## Known limitations

1. **Popup-blocker UX** — if the browser blocks `window.open`, the user
   sees a generic inline error banner rather than a dedicated toast. The
   message tells them to allow popups for the site.
2. **Stylesheet hot-reload** — style tags are cloned once at detach time.
   If Vite HMR injects new styles while a tab is detached, the popup
   will not pick them up until it is reattached and detached again. This
   only affects dev mode.
3. **`standalone_interface.html` parity** — the single-file standalone
   interface does not support detaching. See the table above.
4. **Full page reload** — reloading the main window closes all detached
   popups (by design). We do not currently persist and restore detached
   state across reloads.

## Manual verification checklist

Done during development against `npm run dev`:

- Detach `N-1`, zoom in, verify zoom is preserved on reattach.
- Detach `Action`, select a new action in the action feed — the popup
  updates live because props flow through the same React tree.
- Detach `N-1`, close the popup from the browser chrome — the tab folds
  back into the main window and zoom state is preserved.
- Detach the currently-active tab — main panel switches to the next
  available tab automatically.
- Detach two tabs simultaneously and verify their popups are
  independent.
- Block popups in the browser and click detach — error banner appears,
  state unchanged.

## Related files / further reading

- `docs/interaction-logging.md` — replay contract, now extended with
  `tab_detached` / `tab_reattached` events.
- `docs/rendering-optimization-plan.md` — context on why
  `MemoizedSvgContainer` must stay mounted.
- `frontend/src/components/VisualizationPanel.tsx:306` — long-standing
  comment explaining the always-mounted-container invariant this feature
  had to uphold.
