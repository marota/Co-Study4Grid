# Phase 2: State Management Optimization

## Status: Partially shipped

**Shipped under PR #75** — memoization pass on the wrapper functions,
`React.memo` on the three heaviest children, and the consolidated
reset helpers. Released as part of 0.5.0 (see
[`CHANGELOG.md`](../../CHANGELOG.md)).

**Superseded in part by PR #109** — the "Phase 2 hook extraction"
pushed two full cross-hook pipelines into their own hooks
(`useN1Fetch`, `useDiagramHighlights`), which subsumes some of the
wrapper-memoization discussion below because those wrappers no
longer exist in `App.tsx` at all.

**Still deferred** — the three orchestrator hooks called out in the
[App.tsx refactor-history table in `frontend/CLAUDE.md`](../../frontend/CLAUDE.md)
(`useSettingsOrchestration`, `useSaveLoadSession`,
`useStateReset`), which would absorb the remaining
`wrappedSaveResults` / `wrappedRestoreSession` / `resetAllState`
complexity. See the "Deferred" section in that file for the
tradeoff notes.

> The sections below are preserved as the original design record
> for Phase 1 (App.tsx ≈ 650 lines). Line numbers and the
> wrapper-function inventory reflect that snapshot and are out of
> date — `App.tsx` is now ≈ 1150 lines after PR #109. Start from
> `frontend/CLAUDE.md` for the current shape.

---

**Scope:** `frontend/src/App.tsx` + hooks in `frontend/src/hooks/`
**Risk:** Low — incremental changes, no new dependencies, each step independently shippable
**Estimated impact:** Eliminates unnecessary re-renders of the 3 heaviest components (VisualizationPanel: 1266 lines, ActionFeed: ~500 lines, OverloadPanel)

---

## Problem Statement

Phase 1 successfully extracted 5 custom hooks from App.tsx (~2100 → ~650 lines). However, the **cross-hook wiring layer** (lines 101–175) introduces performance and maintainability issues:

### Issue 1: Zero memoization on wrapper functions

9 wrapper functions bridge hooks together. **None are wrapped with `useCallback`**, so every App.tsx render creates new function references, defeating `React.memo` on children.

```
Line 102  wrappedActionSelect          — NO useCallback
Line 105  wrappedActionFavorite        — NO useCallback
Line 108  wrappedManualActionAdded     — NO useCallback
Line 128  wrappedRunAnalysis           — NO useCallback
Line 131  wrappedDisplayPrioritized    — NO useCallback
Line 134  wrappedAssetClick            — NO useCallback
Line 137  wrappedSaveResults           — NO useCallback  (12 lines, 18+ params)
Line 151  wrappedOpenReloadModal       — NO useCallback
Line 153  wrappedRestoreSession        — NO useCallback  (23 lines, 30+ params)
```

### Issue 2: Massive parameter objects for session save/restore

`wrappedSaveResults` passes 18+ fields to `SaveParams`. `wrappedRestoreSession` passes 30+ setters into `RestoreContext`. Both construct new object literals on every render.

### Issue 3: Duplicated reset logic

`clearContingencyState` (line 112), `handleApplySettings` (line 183), and `handleLoadConfig` (line 252) each perform overlapping sequences of 15–20 state resets. The reset lists are manually synchronized — adding a new piece of state means updating 3 places.

### Issue 4: No `React.memo` on child components

- `VisualizationPanel` receives 35+ props including 8 inline callback expressions (lines 587–620)
- `ActionFeed` receives 50+ props including 7 settings values passed individually
- `OverloadPanel` receives 13 props with inline arrow functions

Without `React.memo`, every App.tsx state change re-renders all children even when their props haven't changed. With `React.memo` but without memoized callbacks, the memo check fails because callback references change every render.

### Issue 5: Settings values drilled individually

ActionFeed receives 8 individual settings props (`minLineReconnections`, `minCloseCoupling`, `minOpenCoupling`, etc.) that are only used for display — they could be passed as a single memoized object.

---

## Proposed Changes

### Step 1: Memoize all wrapper functions with `useCallback`

**Files:** `App.tsx`
**Risk:** Very low — purely additive, no behavioral change

Wrap all 9 cross-hook bridging functions with `useCallback` and explicit dependency arrays:

```tsx
// Before (line 102):
const wrappedActionSelect = (actionId: string | null) =>
  diagrams.handleActionSelect(actionId, result, selectedBranch, voltageLevels.length, setResult, setError);

// After:
const wrappedActionSelect = useCallback(
  (actionId: string | null) =>
    diagrams.handleActionSelect(actionId, result, selectedBranch, voltageLevels.length, setResult, setError),
  [diagrams, result, selectedBranch, voltageLevels.length, setResult, setError]
);
```

For `wrappedSaveResults` and `wrappedRestoreSession`, memoize the parameter objects:

```tsx
const saveParams = useMemo(() => ({
  networkPath, actionPath, layoutPath, outputFolderPath,
  minLineReconnections, minCloseCoupling, minOpenCoupling,
  minLineDisconnections, minPst, minLoadShedding,
  minRenewableCurtailmentActions, nPrioritizedActions,
  linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold,
  ignoreReconnections, pypowsyblFastMode,
  selectedBranch, selectedOverloads, monitorDeselected,
  nOverloads: nDiagram?.lines_overloaded ?? [],
  n1Overloads: n1Diagram?.lines_overloaded ?? [],
  result, selectedActionIds, rejectedActionIds,
  manuallyAddedIds, suggestedByRecommenderIds,
  setError, setInfoMessage: analysis.setInfoMessage,
}), [
  networkPath, actionPath, layoutPath, outputFolderPath,
  minLineReconnections, minCloseCoupling, minOpenCoupling,
  minLineDisconnections, minPst, minLoadShedding,
  minRenewableCurtailmentActions, nPrioritizedActions,
  linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold,
  ignoreReconnections, pypowsyblFastMode,
  selectedBranch, selectedOverloads, monitorDeselected,
  nDiagram?.lines_overloaded, n1Diagram?.lines_overloaded,
  result, selectedActionIds, rejectedActionIds,
  manuallyAddedIds, suggestedByRecommenderIds,
  setError, analysis.setInfoMessage,
]);

const wrappedSaveResults = useCallback(
  () => session.handleSaveResults(saveParams),
  [session, saveParams]
);
```

**Validation:** `npx tsc --noEmit` + `npm run test` + manual verification that save/restore still works.

---

### Step 2: Extract a centralized reset function

**Files:** `App.tsx` (new helper), or a new `hooks/useResetState.ts`
**Risk:** Low — consolidates existing behavior

Currently, the same 15+ state resets are copy-pasted in 3 places:

| Reset target | `clearContingencyState` | `handleApplySettings` | `handleLoadConfig` |
|---|---|---|---|
| `setResult(null)` | ✓ | ✓ | ✓ |
| `setPendingAnalysisResult(null)` | ✓ | ✓ | ✓ |
| `setSelectedOverloads(new Set())` | ✓ | ✓ | ✓ |
| `setMonitorDeselected(false)` | ✓ | ✓ | ✓ |
| `clearActionState()` | ✓ | ✓ | ✓ |
| `setSelectedActionId(null)` | ✓ | ✓ | ✓ |
| `setActionDiagram(null)` | ✓ | ✓ | ✓ |
| `setActiveTab(...)` | ✓ (`'n'`) | ✓ (`'n'`) | ✓ (`'n'`) |
| `setVlOverlay(null)` | ✓ | ✓ | ✓ |
| `setError('')` | ✓ | ✓ | ✓ |
| `setInfoMessage('')` | ✓ | ✓ | ✓ |
| `setInspectQuery('')` | ✓ | ✓ | ✓ |
| `lastZoomState reset` | ✓ | ✓ | ✓ |
| `setNDiagram(null)` | | ✓ | ✓ |
| `setN1Diagram(null)` | | ✓ | ✓ |
| `setOriginalViewBox(null)` | | ✓ | ✓ |
| `setSelectedBranch('')` | | ✓ | ✓ |
| `setActionViewMode('network')` | | ✓ | ✓ |

Proposal: extract two levels of reset:

```tsx
// Resets analysis/action state but preserves the loaded network and diagrams
const resetContingencyState = useCallback(() => {
  analysis.setResult(null);
  analysis.setPendingAnalysisResult(null);
  analysis.setSelectedOverloads(new Set());
  analysis.setMonitorDeselected(false);
  actionsHook.clearActionState();
  diagrams.setSelectedActionId(null);
  diagrams.setActionDiagram(null);
  diagrams.setActiveTab('n');
  diagrams.setVlOverlay(null);
  setError('');
  analysis.setInfoMessage('');
  diagrams.setInspectQuery('');
  diagrams.lastZoomState.current = { query: '', branch: '' };
}, [setError, actionsHook, analysis, diagrams]);

// Full reset: contingency state + network/diagram state
const resetAllState = useCallback(() => {
  resetContingencyState();
  diagrams.setNDiagram(null);
  diagrams.setN1Diagram(null);
  diagrams.setOriginalViewBox(null);
  diagrams.setActionViewMode('network');
  diagrams.setN1Loading(false);
  diagrams.setActionDiagramLoading(false);
  diagrams.committedBranchRef.current = '';
  diagrams.actionSyncSourceRef.current = null;
  setSelectedBranch('');
  setShowMonitoringWarning(false);
}, [resetContingencyState, diagrams, setSelectedBranch, setShowMonitoringWarning]);
```

Then `handleApplySettings` and `handleLoadConfig` become:

```tsx
const handleApplySettings = useCallback(async () => {
  interactionLogger.record('settings_applied');
  try {
    resetAllState();
    // ... config loading logic (unchanged)
  } catch (err) { ... }
}, [resetAllState, ...]);
```

**Validation:** Behavior-identical — diff the before/after reset sequences to confirm.

---

### Step 3: Add `React.memo` to heavy child components

**Files:** `VisualizationPanel.tsx`, `ActionFeed.tsx`, `OverloadPanel.tsx`
**Risk:** Low — `React.memo` is a no-op when props actually change; it only skips renders when props are referentially equal
**Prerequisite:** Step 1 (memoized callbacks) must land first, otherwise memo checks will always fail

```tsx
// VisualizationPanel.tsx — wrap the export
export default React.memo(VisualizationPanel);

// ActionFeed.tsx
export default React.memo(ActionFeed);

// OverloadPanel.tsx
export default React.memo(OverloadPanel);
```

**Why not earlier?** Without Step 1, `React.memo` adds overhead (shallow comparison) without benefit (callbacks change every render). With Step 1 done, memo guards become effective.

---

### Step 4: Group settings props into a memoized object for ActionFeed

**Files:** `App.tsx`, `ActionFeed.tsx` (props interface)
**Risk:** Low — type-safe refactor, no behavioral change

Currently ActionFeed receives 8 individual settings values:

```tsx
// App.tsx lines 568-578
minLineReconnections={minLineReconnections}
minCloseCoupling={minCloseCoupling}
minOpenCoupling={minOpenCoupling}
minLineDisconnections={minLineDisconnections}
minPst={minPst}
minLoadShedding={minLoadShedding}
minRenewableCurtailmentActions={minRenewableCurtailmentActions}
nPrioritizedActions={nPrioritizedActions}
ignoreReconnections={ignoreReconnections}
```

Proposal: group into a single memoized object:

```tsx
// types.ts
export interface RecommenderDisplayConfig {
  minLineReconnections: number;
  minCloseCoupling: number;
  minOpenCoupling: number;
  minLineDisconnections: number;
  minPst: number;
  minLoadShedding: number;
  minRenewableCurtailmentActions: number;
  nPrioritizedActions: number;
  ignoreReconnections: boolean;
}

// App.tsx
const recommenderConfig = useMemo<RecommenderDisplayConfig>(() => ({
  minLineReconnections, minCloseCoupling, minOpenCoupling,
  minLineDisconnections, minPst, minLoadShedding,
  minRenewableCurtailmentActions, nPrioritizedActions, ignoreReconnections,
}), [
  minLineReconnections, minCloseCoupling, minOpenCoupling,
  minLineDisconnections, minPst, minLoadShedding,
  minRenewableCurtailmentActions, nPrioritizedActions, ignoreReconnections,
]);

// Pass as single prop
<ActionFeed recommenderConfig={recommenderConfig} ... />
```

**Benefit:** Reduces ActionFeed props from ~33 to ~25. The memoized object only changes when a setting actually changes, not on every render.

---

### Step 5: Eliminate inline callbacks in JSX

**Files:** `App.tsx`
**Risk:** Very low

Several inline arrow functions are created in JSX on every render:

```tsx
// Line 515 — contingency input onChange
onChange={e => { interactionLogger.record('contingency_selected', { element: e.target.value }); setSelectedBranch(e.target.value); }}

// Line 535 — dismiss monitoring warning
onDismissWarning={() => setShowMonitoringWarning(false)}

// Line 536 — open settings to configurations tab
onOpenSettings={() => { setIsSettingsOpen(true); setSettingsTab('configurations'); }}

// Line 587 — tab change
onTabChange={(tab: TabId) => { interactionLogger.record('diagram_tab_changed', { tab }); setActiveTab(tab); }}

// Line 601 — voltage range change
onVoltageRangeChange={(range) => { interactionLogger.record('voltage_range_changed', ...); setVoltageRange(range); }}

// Line 605 — inspect query change
onInspectQueryChange={(q) => { interactionLogger.record('inspect_query_changed', ...); setInspectQuery(q); }}

// Line 616 — VL open
onVlOpen={(vlName) => handleVlDoubleClick(activeTab === 'action' ? selectedActionId || '' : '', vlName)}
```

Extract each into a named `useCallback`:

```tsx
const handleTabChange = useCallback((tab: TabId) => {
  interactionLogger.record('diagram_tab_changed', { tab });
  diagrams.setActiveTab(tab);
}, [diagrams]);

const handleVoltageRangeChange = useCallback((range: [number, number]) => {
  interactionLogger.record('voltage_range_changed', { min: range[0], max: range[1] });
  diagrams.setVoltageRange(range);
}, [diagrams]);

const handleInspectQueryChange = useCallback((q: string) => {
  interactionLogger.record('inspect_query_changed', { query: q });
  diagrams.setInspectQuery(q);
}, [diagrams]);

const handleVlOpen = useCallback((vlName: string) => {
  diagrams.handleVlDoubleClick(
    activeTab === 'action' ? selectedActionId || '' : '', vlName
  );
}, [diagrams, activeTab, selectedActionId]);

const handleDismissWarning = useCallback(() => {
  setShowMonitoringWarning(false);
}, [setShowMonitoringWarning]);
```

---

## What This Proposal Does NOT Do (and why)

### No Context API / Zustand / Jotai migration

The original proposal suggested a `useGridState` selector hook. This doesn't address the actual problems:

- The hooks already own isolated state slices — there's no shared state store to "select" from.
- `getActionById(id)` is just `result?.actions[id]` — a trivial lookup that doesn't need a hook.
- `isActionSelected(id)` is just `manuallyAddedIds.has(id)` — already a O(1) Set lookup.
- The real issue is **callback identity stability**, not data access patterns.

A Context/store migration would require rewriting all 5 hooks, touching every component, and changing the data flow model — all for a benefit that memoization already provides. If the app grows significantly (10+ components needing the same state), Context becomes worthwhile; today it's premature.

### No component splitting beyond Phase 1

The current component boundaries (VisualizationPanel, ActionFeed, OverloadPanel, Header) are natural domain boundaries. Splitting them further would move complexity from props to component coordination without reducing it.

### No `useReducer` migration

The 50+ `useState` calls in `useSettings` could theoretically be a reducer, but each field is independently set via forms. A reducer would add dispatch boilerplate without simplifying the update logic.

---

## Implementation Order

| Step | Change | Files touched | Can ship independently |
|------|--------|---------------|----------------------|
| 1 | Memoize wrapper functions | `App.tsx` | Yes |
| 2 | Extract centralized reset | `App.tsx` | Yes |
| 3 | Add React.memo to children | 3 component files | Yes (after Step 1) |
| 4 | Group settings props | `App.tsx`, `ActionFeed.tsx`, `types.ts` | Yes |
| 5 | Extract inline callbacks | `App.tsx` | Yes |

Steps 1 and 2 are independent and can be done in parallel. Step 3 depends on Step 1. Steps 4 and 5 are independent of each other but pair well with Step 3.

---

## Validation Plan

1. **Type safety:** `npx tsc --noEmit` after each step
2. **Lint:** `npm run lint` after each step
3. **Unit tests:** `cd frontend && npm run test` — existing tests for Header, SettingsModal, ReloadSessionModal, ConfirmationDialog, sessionUtils, interactionLogger
4. **Manual testing:** Full workflow — load network → select contingency → run analysis → star/reject actions → save/reload session
5. **Performance verification (optional):** React DevTools Profiler before/after Step 3 to measure re-render reduction on VisualizationPanel during action selection
