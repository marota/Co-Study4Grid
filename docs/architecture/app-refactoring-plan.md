# App.tsx Refactoring Plan: Extract Custom Hooks

> **Status: SHIPPED (historical plan).**
> Both refactor waves have landed and this document is preserved as
> the commit-trail log, not a live plan. App.tsx is now ~1150 lines
> (down from 2100) and is the state-orchestration hub described in
> `frontend/CLAUDE.md`. For the current architecture, start with
> [`frontend/CLAUDE.md`](../../frontend/CLAUDE.md); for the latest
> extraction round (Phase 2 hook extraction — `useN1Fetch`,
> `useDiagramHighlights`, `AppSidebar`, `SidebarSummary`,
> `StatusToasts`) see the App.tsx refactor-history table at the
> bottom of that file and the 0.6.5 entry in
> [`CHANGELOG.md`](../../CHANGELOG.md).
>
> Completed waves:
> 1. **Phase 1 (PR #74, committed)** — extract the five pre-written
>    hooks listed below, plus presentational components.
> 2. **Phase 2 hook extraction (PR #109, commit `5869ad1`)** —
>    split the N-1 fetch pipeline into `useN1Fetch`, the per-tab
>    SVG highlight pipeline into `useDiagramHighlights`, and the
>    sidebar layout into `AppSidebar` / `SidebarSummary` /
>    `StatusToasts`. Reduced `App.tsx` from 1575 to ~1150 lines.
>
> Deferred (explicitly scoped out of PR #109 — see the refactor
> history table in `frontend/CLAUDE.md`): orchestrator hooks
> (`useSettingsOrchestration`, `useSaveLoadSession`,
> `useStateReset`), `AppContext`-provider conversion, and the
> NDJSON parser extraction for `handleSimulateUnsimulatedAction`.

## Goal (as of Phase 1)
Refactor the 2100-line `App.tsx` into a lean orchestrator by wiring
up 5 pre-written custom hooks that extract state and logic.

## Initial State (as of Phase 1 start)
- 5 hook files exist in `frontend/src/hooks/` (untracked):
  - `useSettings.ts` (253 lines) - paths, recommender params, settings modal
  - `useActions.ts` (121 lines) - action selection/rejection/favorite state
  - `useAnalysis.ts` (219 lines) - result, overloads, run-analysis flow
  - `useDiagrams.ts` (660 lines) - diagrams, pan/zoom, SLD, voltage filter, zoom-to-element
  - `useSession.ts` (338 lines) - save/restore session
- `usePanZoom.ts` (288 lines) - already committed and used by both App.tsx and useDiagrams
- Type imports in all 5 hooks have been fixed (`React.Dispatch` -> `Dispatch`, etc.)
- `useSettings` has been partially integrated into App.tsx (Step 2 done)
- App.tsx then compiled clean at ~1959 lines.

## Hook Interfaces Summary

### useSettings() -> SettingsState
**Provides:** networkPath, actionPath, layoutPath, outputFolderPath + setters; all recommender params + setters; monitoring settings; actionDict info; settings modal state; `pickSettingsPath`, `handleOpenSettings`, `handleCloseSettings`, `buildConfigRequest`, `applyConfigResponse`, `createCurrentBackup`

### useActions() -> ActionsState
**Provides:** selectedActionIds, manuallyAddedIds, rejectedActionIds, suggestedByRecommenderIds + setters; `handleActionFavorite(actionId, setResult)`, `handleActionReject(actionId)`, `handleManualActionAdded(actionId, detail, linesOverloaded, setResult, onSelectAction)`, `clearActionState()`

### useAnalysis() -> AnalysisState
**Provides:** result/setResult, pendingAnalysisResult, analysisLoading, infoMessage, error + setters; selectedOverloads, monitorDeselected; prevResultRef; `handleRunAnalysis(selectedBranch, clearContingencyState, setSuggestedByRecommenderIds)`, `handleDisplayPrioritizedActions(selectedActionIds)`, `handleToggleOverload(overload)`

**Note:** `handleRunAnalysis` does NOT call `setActiveTab('overflow')` on PDF event (the original App.tsx does). App.tsx must add an effect to handle this.

### useDiagrams(branches, voltageLevels) -> DiagramsState
**Provides:** activeTab, diagrams (n/n1/action), selectedActionId, actionViewMode, viewBox, inspectQuery, SVG container refs, pan/zoom instances, metadata indices, voltage filter state, vlOverlay, branch refs (committedBranchRef, restoringSessionRef, lastZoomState, actionSyncSourceRef); `fetchBaseDiagram`, `handleActionSelect(actionId, result, selectedBranch, vlLength, setResult, setError)`, zoom handlers, SLD handlers, `handleAssetClick(actionId, assetName, tab, selectedActionId, handleActionSelectFn)`, `zoomToElement`, inspectableItems, selectedBranchForSld ref

### useSession() -> SessionState
**Provides:** showReloadModal, sessionList, sessionListLoading, sessionRestoring; `handleSaveResults(SaveParams)`, `handleOpenReloadModal(outputFolderPath, setError)`, `handleRestoreSession(sessionName, RestoreContext)`

## Decomposed Steps

### Step 1: Add hook imports (DONE)
Added import lines for all 5 hooks at top of App.tsx.

### Step 2: Integrate useSettings (DONE)
- Instantiated `useSettings()` and destructured all properties
- Removed old useState declarations for settings
- Removed old `handleOpenSettings`, `handleCloseSettings`, `pickSettingsPath`
- Removed localStorage load/persist effects
- Updated `handleApplySettings` and `handleLoadConfig` to use `buildConfigRequest()` and `applyConfigResponse()`

### Step 3: Integrate useActions
**Remove from App.tsx:**
- `useState` for: selectedActionIds, manuallyAddedIds, rejectedActionIds, suggestedByRecommenderIds
- `handleActionFavorite`, `handleActionReject` callbacks

**Add:**
- `const actionsHook = useActions();` and destructure
- Wrapper for `handleManualActionAdded` that passes `setResult` and `wrappedActionSelect`
- Wrapper for `handleActionFavorite` that passes `setResult`

### Step 4: Integrate useAnalysis
**Remove from App.tsx:**
- `useState` for: result, pendingAnalysisResult, analysisLoading, infoMessage, error, selectedOverloads, monitorDeselected
- `prevResultRef`
- `infoMessage` auto-clear effect
- `handleRunAnalysis`, `handleDisplayPrioritizedActions`, `handleToggleOverload` callbacks

**Add:**
- `const analysis = useAnalysis();` and destructure
- Wrapper for `handleRunAnalysis` that passes `selectedBranch`, `clearContingencyState`, `setSuggestedByRecommenderIds`
- Wrapper for `handleDisplayPrioritizedActions` that passes `selectedActionIds`
- Effect: when `result?.pdf_url` changes during `analysisLoading`, call `setActiveTab('overflow')`

**Update:**
- `clearContingencyState` to call analysis setters + `actionsHook.clearActionState()`
- `hasAnalysisState` to reference hook state
- Remove `error`/`setError` local state (now from analysis hook)

### Step 5: Integrate useDiagrams
**Remove from App.tsx:**
- `useState` for: activeTab, nDiagram, n1Diagram, n1Loading, selectedActionId, actionDiagram, actionDiagramLoading, actionViewMode, originalViewBox, inspectQuery, nominalVoltageMap, uniqueVoltages, voltageRange, vlOverlay
- `useRef` for: nSvgContainerRef, n1SvgContainerRef, actionSvgContainerRef, committedBranchRef, restoringSessionRef, lastZoomState, actionSyncSourceRef, activeTabRef, prevTabRef
- `usePanZoom` calls (nPZ, n1PZ, actionPZ)
- `useMemo` for metadata indices (nMetaIndex, n1MetaIndex, actionMetaIndex)
- `useMemo` for inspectableItems
- `fetchBaseDiagram`, `handleActionSelect`, `handleViewModeChange`, `handleManualZoomIn/Out`, `handleManualReset`
- `handleVlDoubleClick`, `handleOverlaySldTabChange`, `handleOverlayClose`, `handleAssetClick`
- `fetchSldVariant`, `zoomToElement`
- Tab synchronization `useLayoutEffect`
- Action sync `useEffect`
- id-map cache invalidation effects
- Voltage range filter logic + effects

**Add:**
- `const diagrams = useDiagrams(branches, voltageLevels);` and destructure
- Effect: sync `diagrams.selectedBranchForSld.current = selectedBranch`
- Wrapper for `handleActionSelect` that passes `result, selectedBranch, voltageLevels.length, setResult, setError`
- Wrapper for `handleAssetClick` that passes `diagrams.selectedActionId, wrappedActionSelect`

**Keep in App.tsx (NOT in useDiagrams):**
- N-1 diagram fetch effect (uses selectedBranch, branches, hasAnalysisState, clearContingencyState)
- Highlights effect (applyHighlightsForTab + its useEffect)
- Auto-zoom effect (inspectQuery/selectedBranch -> zoomToElement)
- Overloads sync effect (n1Diagram -> setSelectedOverloads)

### Step 6: Integrate useSession
**Remove from App.tsx:**
- `useState` for: showReloadModal, sessionList, sessionListLoading, sessionRestoring
- `handleSaveResults`, `handleOpenReloadModal`, `handleRestoreSession` callbacks

**Add:**
- `const session = useSession();`
- Wrapper for `handleSaveResults` that builds `SaveParams` from settings/analysis/actions/diagrams state
- Wrapper for `handleOpenReloadModal` that passes `outputFolderPath, setError`
- Wrapper for `handleRestoreSession` that builds `RestoreContext` from all hooks

### Step 7: Clean up imports
**Remove unused imports from App.tsx:**
- `usePanZoom` (now used inside useDiagrams)
- `buildMetadataIndex`, `getIdMap`, `invalidateIdMapCache` (now in useDiagrams)
- `buildSessionResult` (now in useSession)
- Unused type imports: `DiagramData`, `ViewBox`, `MetadataIndex`, `SettingsBackup`, `VlOverlay`, `SldTab`, `FlowDelta`, `AssetDelta`, `SessionResult`, `CombinedAction`

**Keep:**
- `applyOverloadedHighlights`, `applyDeltaVisuals`, `applyActionTargetHighlights`, `applyContingencyHighlight` (used in highlights effect)
- `processSvgAsync` (used in N-1 fetch effect)
- `api` (used in handleLoadConfig, handleApplySettings, N-1 fetch)
- Type imports: `ActionDetail`, `TabId` (used in highlights effect)

### Step 8: Verify & commit
- Run `npx tsc --noEmit` to verify compilation
- Run `npm run lint` to check ESLint
- Fix any issues
- Commit and push

## Cross-Hook Wiring (App.tsx orchestration)

These wrapper callbacks in App.tsx connect the hooks together:

```typescript
// Wrap diagrams.handleActionSelect with current state
const wrappedActionSelect = (actionId: string | null) =>
  diagrams.handleActionSelect(actionId, result, selectedBranch, voltageLevels.length, setResult, setError);

// Wrap actionsHook.handleActionFavorite with setResult
const wrappedActionFavorite = (actionId: string) =>
  actionsHook.handleActionFavorite(actionId, setResult);

// Wrap actionsHook.handleManualActionAdded with setResult + action select
const wrappedManualActionAdded = (actionId: string, detail: ActionDetail, linesOverloaded: string[]) =>
  actionsHook.handleManualActionAdded(actionId, detail, linesOverloaded, setResult, wrappedActionSelect);

// Wrap analysis.handleRunAnalysis with current branch + clearContingencyState
const wrappedRunAnalysis = () =>
  analysis.handleRunAnalysis(selectedBranch, clearContingencyState, setSuggestedByRecommenderIds);

// Wrap analysis.handleDisplayPrioritizedActions with selectedActionIds
const wrappedDisplayPrioritized = () =>
  analysis.handleDisplayPrioritizedActions(selectedActionIds);

// Wrap diagrams.handleAssetClick with current selectedActionId + action select
const wrappedAssetClick = (actionId: string, assetName: string, tab: 'action' | 'n' | 'n-1' = 'action') =>
  diagrams.handleAssetClick(actionId, assetName, tab, diagrams.selectedActionId, wrappedActionSelect);
```

## App-Level Effects (remain in App.tsx)

1. **N-1 fetch effect** - watches `selectedBranch`, handles confirmation dialog, calls `api.getN1Diagram`
2. **Overloads sync** - watches `n1Diagram?.lines_overloaded` -> `setSelectedOverloads`
3. **PDF tab switch** - watches `result?.pdf_url` + `analysisLoading` -> `setActiveTab('overflow')`
4. **Highlights effect** - `applyHighlightsForTab` for n-1/action tabs
5. **Auto-zoom effect** - watches `inspectQuery`/`selectedBranch` -> `zoomToElement`
6. **SLD branch sync** - watches `selectedBranch` -> `diagrams.selectedBranchForSld.current`

## App-Level State (remains in App.tsx)

- `branches`, `setBranches` - string[]
- `voltageLevels`, `setVoltageLevels` - string[]
- `selectedBranch`, `setSelectedBranch` - string
- `configLoading`, `setConfigLoading` - boolean
- `confirmDialog`, `setConfirmDialog` - confirmation dialog state

## JSX Changes

The JSX stays structurally identical. Variable references change:
- `networkPath` -> still `networkPath` (destructured from settings)
- `handleActionSelect` -> `wrappedActionSelect`
- `handleActionFavorite` -> `wrappedActionFavorite`
- `handleManualActionAdded` -> `wrappedManualActionAdded`
- `handleRunAnalysis` -> `wrappedRunAnalysis`
- `handleDisplayPrioritizedActions` -> `wrappedDisplayPrioritized`
- `handleAssetClick` -> `wrappedAssetClick`
- `handleSaveResults` -> `wrappedSaveResults`
- `handleOpenReloadModal` -> `wrappedOpenReloadModal`
- `handleRestoreSession` -> `wrappedRestoreSession`
- `sessionRestoring` -> `session.sessionRestoring`
- `showReloadModal` -> `session.showReloadModal`
- etc.
