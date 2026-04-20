# SVG Tab Rendering — `visibility:hidden` → `display:none` (Step 1)

## Context

On the PyPSA-EUR France 400 kV grid (~28 MB SVG, ~200 k DOM nodes per diagram),
three user scenarios were profiled end-to-end with Chrome DevTools:

1. **Load study** — initial network + base-case NAD rendered.
2. **N-1 contingency** — user picks a branch, post-contingency NAD returned and
   rendered on top of the base-case one.
3. **Manual action simulation** — user picks a remedial action; the action
   variant NAD is fetched and rendered on top of N and N-1.

Three bottlenecks emerged from the traces:

| Rank | Bottleneck | Evidence (pre-fix, v1 traces) |
|---|---|---|
| 1 | Server-side pypowsybl load flow + NAD generation | `/api/config` 14.8 s; `/api/n1-diagram` 7.6 s; `/api/action-variant-diagram` 6.6 s |
| 2 | Enormous uncompressed SVG payloads (~28 MB JSON-wrapped) | `content-length: 28 430 383`, `content-encoding: none` |
| 3 | **Three giant SVGs all kept in the Blink layout tree** | `Layout totalObjects = 610 326` after N-1, `610 025` after action (vs 203 605 for N alone) |

This document covers **bottleneck #3**, which is the cheapest to fix on the
frontend and the one with the most visible per-interaction impact.

## Root cause

`VisualizationPanel.tsx` (and its mirror in `standalone_interface.html`) keeps
the N, N-1 and Action SVG containers **always mounted** so pan/zoom state,
refs, and the `DetachableTabHost` portal target survive tab switches and
detach/reattach round-trips. Inactive, non-detached tabs were hidden with:

```tsx
visibility: !detachedTabs[id] && activeTab === id ? 'visible' : 'hidden'
```

`visibility: hidden` elements remain **in the layout tree**. Blink's `Layout`,
`PrePaint`, `Layerize`, `UpdateLayoutTree` and `Commit` passes therefore walked
the union of all three SVGs on every cycle — precisely what the traces showed:

| Scenario | `Layout totalObjects` in v1 | Expected if inactive SVGs were skipped |
|---|---|---|
| After load study | 203 605 (only N loaded) | 203 605 (matches) |
| After N-1 selection | **610 326** (N + N-1) | 203 605 |
| After action simulation | **610 025** (N + N-1 + action) | 203 605 |

Every single `Layout` on a large grid walked 3× the DOM nodes it actually
needed to.

## Fix

Swap the three SVG-tab home slots in `VisualizationPanel.tsx` and in
`standalone_interface.html` to use `display: 'block' | 'none'` instead of
`visibility: 'visible' | 'hidden'`:

```tsx
<DetachableTabHost
    detachedMountNode={detachedTabs['n-1']?.mountNode ?? null}
    homeStyle={{
        width: '100%', height: '100%',
        position: 'absolute', top: 0, left: 0,
        zIndex: !detachedTabs['n-1'] && activeTab === 'n-1' ? 10 : -1,
        display: !detachedTabs['n-1'] && activeTab === 'n-1' ? 'block' : 'none',
        pointerEvents: !detachedTabs['n-1'] && activeTab === 'n-1' ? 'auto' : 'none',
    }}
>
```

### Why this is safe (not a regression in disguise)

- `display:none` does **not** cause React to unmount the subtree. The
  `MemoizedSvgContainer`, its `useLayoutEffect`, the `DetachableTabHost` portal
  target and the `usePanZoom` refs all stay mounted — so viewBox state, the
  one-time `replaceChildren(svg)` DOM injection and the auto-zoom survive tab
  switches exactly as before. The existing comment at
  `VisualizationPanel.tsx:971-975` about StrictMode double-invokes still
  applies and was not modified.
- When a tab is **detached**, `DetachableTabHost` physically moves its
  `realTarget` (the `<div>` that contains the SVG) out of the home slot into a
  popup window. The home slot is then an empty `<div>`; setting
  `display:none` on it is a no-op for the UX (the real content is in the
  popup).
- `usePanZoom` is already gated by `activeTab === id || !!detachedTabs[id]`
  (see `useDiagrams.ts:207-221`), so no inactive, non-detached tab tries to
  read geometry from its own (now `display:none`) container.
- The auto-zoom path uses double `requestAnimationFrame` after a tab switch
  (see `App.tsx:922-928`) before calling `getScreenCTM()`, so the newly-visible
  container has had a chance to re-enter the layout tree before geometry is
  read.
- The Overflow tab (PDF `<iframe>`) was **intentionally left on
  `visibility: hidden`** — the accumulation bottleneck is specific to the
  three SVG tabs.

### Files changed

| File | Change |
|---|---|
| `frontend/src/components/VisualizationPanel.tsx` | `visibility` → `display` on the three SVG `DetachableTabHost` home slots (N, N-1, action) |
| `standalone_interface.html` | Same change on the three inline SVG tab wrappers |

No other file was touched. No props or component APIs changed. All 884
existing Vitest tests pass, lint is clean, `tsc -b` is clean.

## Measurements

Traces were captured on the same PyPSA-EUR France 400 kV scenario, same
contingency (`ARGIAL71CANTE`-style branch), same manual action, on the same
machine, just before and just after the change.

### Trace 1 — Load study

Both N-1 and Action SVGs are still empty at this point, so the change is a
no-op here — this is the expected behaviour.

| Metric | v1 (before) | v2 (after) |
|---|---|---|
| `Layout totalObjects` | 203 605 | 203 569 |
| Biggest `Layout` duration | 303.9 ms | 288.5 ms |
| `Paint` total | 1 636 ms | 1 670 ms |
| Long tasks total | 6 782 ms | 7 138 ms |

Essentially within noise.

### Trace 2 — N-1 contingency selection

| Metric | v1 (before) | v2 (after) | Δ |
|---|---|---|---|
| **`Layout totalObjects`** | **610 326** | **203 590** | **-66 %** |
| Biggest `Layout` duration | 697.6 ms | 248.4 ms | **-64 %** |
| `UpdateLayoutTree` total | 1 906 ms | 884 ms | **-54 %** |
| `UpdateLayoutTree` max | 895.7 ms | 313.3 ms | -65 % |
| `PrePaint` total | 4 453 ms | 799 ms | **-82 %** |
| `Paint` total | 5 321 ms | 4 176 ms | -22 % |
| `Layerize` total | 4 972 ms | 3 562 ms | -28 % |
| `Commit` total | 456 ms | 1 818 ms | **+1.4 s** (one-time tab-activation cost) |
| **Long tasks (>=50 ms) total** | **15 984 ms** | **11 591 ms** | **-4.4 s (-27 %)** |
| Trace event count | 145 491 | 103 177 | -29 % |

Note the single 1.56 s `Commit` event in v2: when the N-1 tab's `display`
flips from `none` to `block` for the first time, the compositor has to
promote the now-visible layer. With `visibility:hidden`, that work was paid
continuously across many smaller commits. Net main-thread rendering work
(Paint + UpdLT + Commit + Layerize + PrePaint) still drops from **17.1 s →
11.2 s** (**-34 %**).

### Trace 3 — Manual action simulation

| Metric | v1 (before) | v2 (after) | Δ |
|---|---|---|---|
| **`Layout totalObjects`** | **610 327** | **203 601** | **-66 %** |
| Biggest `Layout` duration | 446.1 ms | 233.4 ms | -48 % |
| `UpdateLayoutTree` total | 2 049 ms | 722 ms | -65 % |
| `UpdateLayoutTree` max | 936 ms | 308 ms | -67 % |
| **`Commit` total** | **2 754 ms** | **612 ms** | **-78 %** |
| **`Commit` max (single event)** | **2 260 ms** | **72 ms** | **-97 %** |
| `PrePaint` total | 3 326 ms | 843 ms | -75 % |
| `Paint` total | 12 814 ms | 7 917 ms | -38 % |
| `Layerize` total | 4 201 ms | 4 653 ms | +11 % (minor) |
| **Long tasks (>=50 ms) total** | **24 938 ms** | **16 010 ms** | **-8.9 s (-36 %)** |
| Number of long tasks | 113 | 70 | -38 % |
| Trace event count | 258 702 | 224 732 | -13 % |

The worst single main-thread stall across all three scenarios — the 2.26 s
`Commit` — disappears. Net main-thread rendering work drops from **25.1 s →
14.7 s** (**-41 %**).

## Summary

| Scenario | Long-task total (v1) | Long-task total (v2) | Saved |
|---|---|---|---|
| Load study | 6 782 ms | 7 138 ms | +356 ms (noise) |
| N-1 contingency | 15 984 ms | 11 591 ms | **-4.4 s** |
| Manual action | 24 938 ms | 16 010 ms | **-8.9 s** |

The gain scales with the number of SVGs that had accumulated in the DOM
before the change — which is the expected shape for a layout-tree-sizing
fix. No user-visible functional change; no test regressions; no API change.

## What is left unsolved

Even after this fix, the active tab still carries one full 200 k-node SVG.
That is now the floor for:

- `Paint` (still ~4 s on N-1 and ~8 s on action)
- `Layerize` (still ~3.5-4.5 s)

Two follow-ups attack that floor:

- **Step 2 — per-endpoint gzip** on the three large SVG endpoints
  (`/api/network-diagram`, `/api/n1-diagram`, `/api/action-variant-diagram`)
  to shrink the 28 MB transfer ~10×. The previous global
  `GZipMiddleware` attempt (commits `8c15de7` → `26bc49d`) broke
  `StreamingResponse` on `/api/run-analysis(-step2)` because the middleware
  buffered NDJSON chunks, delaying the overflow-graph PDF event. Applying
  gzip per-endpoint sidesteps that.
- **Step 4 — server-side SVG slimming** (round coordinates, drop unused
  `<title>`/`<desc>`, fold repeated inline styles). Reduces the node count
  itself, which in turn reduces Paint/Layerize/Commit for every path
  including load-study.
