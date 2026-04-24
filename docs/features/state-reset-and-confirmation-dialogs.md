# State Reset & Confirmation Dialogs

## Overview

Co-Study4Grid manages complex analysis state across contingency selections, N-1 simulations, manual action simulations, and prioritized action results. To prevent stale data from interfering with new analyses, the application implements two complementary mechanisms:

1. **Confirmation dialogs** when switching contingency or reloading a study with existing analysis state
2. **Full state reset** when loading a new study or applying new settings

---

## Confirmation Dialogs

### When They Trigger

A confirmation dialog appears when the user attempts to:

- **Change contingency** (select a different branch in the datalist) while analysis results, manual simulations, or action selections exist
- **Reload study** (click "Load Study") while analysis state exists

### What They Warn About

The dialog informs the user that all previous analysis results will be cleared:

- Analysis results and pending results
- Manual simulation results
- Action selections (favorited, rejected)
- Action diagrams and N-1 diagrams
- Overload selections
- VL overlay (SLD popups)

### User Options

- **Confirm**: clears all analysis state and proceeds with the action
- **Cancel**: reverts to the previous state (for contingency change, the input reverts to the previous branch)

### Implementation Details

#### React Frontend (`App.tsx`)

The confirmation logic is implemented at the **N-1 fetch `useEffect` level**, not at the input `onChange` level. This is because:

- The contingency input is a `<input list="...">` (datalist) that fires `onChange` on every keystroke
- Intercepting keystrokes would interfere with typing partial branch names
- The useEffect only fires when `selectedBranch` matches a valid branch in the `branches` array

Key state:
- `confirmDialog`: `{ type: 'contingency' | 'loadStudy', pendingBranch?: string } | null`
- `committedBranchRef`: tracks the last confirmed branch (prevents re-prompting for the same branch)

Flow for contingency change:
1. User types/selects a new branch name
2. `selectedBranch` state updates freely (allows typing)
3. N-1 useEffect fires when the value matches a valid branch
4. If `selectedBranch !== committedBranchRef.current` AND `hasAnalysisState()` is true:
   - Dialog is shown
   - Input reverts to `committedBranchRef.current`
5. On confirm: `clearContingencyState()` is called, `committedBranchRef` is updated, branch is committed
6. On cancel: dialog closes, input stays at committed branch

#### Standalone Interface (`standalone_interface.html`)

Uses `window.confirm()` (native browser dialog) for consistency with the existing Load Study and Apply Settings confirmation patterns already present in the standalone version.

---

## Full State Reset

### When It Happens

A complete state reset occurs when:

1. **Load Study** is clicked (or confirmed via dialog)
2. **Apply Settings** is clicked in the Settings modal

### What Gets Reset

#### Frontend State

| Category | State Variables | Reset Value |
|----------|----------------|-------------|
| **Diagrams** | `nDiagram`, `n1Diagram`, `actionDiagram`, `originalViewBox` | `null` |
| **Analysis** | `result`, `pendingAnalysisResult`, `selectedActionId` | `null` |
| **Action tracking** | `selectedActionIds`, `manuallyAddedIds`, `rejectedActionIds` | `new Set()` |
| **Loading flags** | `analysisLoading`, `n1Loading`, `actionDiagramLoading` | `false` |
| **Analysis flow** | `selectedOverloads`, `monitorDeselected` | `new Set()` / `false` |
| **Visualization** | `activeTab`, `actionViewMode`, `vlOverlay` | `'n'` / `'network'` / `null` |
| **Branch** | `selectedBranch`, `committedBranchRef`, `inspectQuery` | `''` |
| **Messages** | `error`, `infoMessage`, `showMonitoringWarning` | `''` / `false` |
| **Refs** | `lastZoomState`, `actionSyncSourceRef` | Reset to defaults |

#### What is NOT reset (preserved across reloads)

- `networkPath` and `actionPath` (user inputs)
- All settings values (`minLineReconnections`, `minCloseCoupling`, etc.)
- `linesMonitoringPath`
- `monitoringFactor`, `preExistingOverloadThreshold`
- `ignoreReconnections`, `pypowsyblFastMode`

#### Backend State

The `/api/config` endpoint now **always reloads the network** and **resets the recommender service caches**, even if the network path hasn't changed. This prevents:

- Stale in-memory network modifications from previous N-1 simulations
- Cached simulation environments (`_simulation_env`) from a previous analysis
- Leftover `_base_network`, `_last_disconnected_element`, `_dict_action`, `_analysis_context`

The `RecommenderService.reset()` method clears:
- `_last_result`
- `_is_running`, `_generator`
- `_base_network`, `_simulation_env`
- `_last_disconnected_element`
- `_dict_action`, `_analysis_context`
- `_layout_cache` — the cached `grid_layout.json` DataFrame used as
  `fixed_positions` for NAD generation. Must be cleared so a new study
  loaded from a different grid does not reuse the previous grid's
  substation coordinates.
- `_overflow_layout_mode` — reset to `"hierarchical"` so a new
  study's Overflow Analysis tab always opens in the default layout.
- `_overflow_layout_cache` — cleared so file paths produced for
  the previous contingency cannot be served for the new one.
- `_last_step2_context` — the preserved enriched Step-2 context
  used by `/api/regenerate-overflow-graph`; stale context must
  not be reused after a study reload.

### Why Force Reload?

Previously, the backend cached the network path and skipped reloading if it hadn't changed (`if config.network_path != last_network_path`). This caused issues because:

1. N-1 simulations modify the in-memory network (disconnect elements, run load flow)
2. The `RecommenderService` caches simulation environments tied to specific contingencies
3. Action simulations may leave residual state in the recommender's internal caches

By always reloading and resetting, we guarantee a clean slate for every new study load.

---

## `hasAnalysisState()` — What Counts as "Analysis State"

The function returns `true` if ANY of these are non-null/non-empty:

- `result` — analysis results from `run-analysis`
- `pendingAnalysisResult` — results waiting to be displayed
- `selectedActionId` — an action is being viewed
- `actionDiagram` — an action variant diagram is loaded
- `manuallyAddedIds.size > 0` — manual simulations were added
- `selectedActionIds.size > 0` — actions were favorited
- `rejectedActionIds.size > 0` — actions were rejected

Note: the mere presence of an N-1 diagram does NOT count as analysis state. Simply selecting a contingency and viewing the N-1 diagram is considered a lightweight operation that doesn't warrant a confirmation dialog.

---

## Testing

Tests are in `frontend/src/App.test.tsx` and cover:

### Contingency Change Confirmation (5 tests)
1. No dialog when switching branch without analysis state
2. Dialog shown when switching branch after running analysis
3. State cleared and branch switched on confirm
4. Input reverts to old branch on cancel
5. No dialog triggered for partial/invalid branch text

### Load Study Confirmation (4 tests)
6. Loads directly when no analysis state exists
7. Dialog shown when clicking Load Study after analysis
8. Study reloads on confirm
9. State preserved on cancel

Run tests with:
```bash
cd frontend
npm run test
```
