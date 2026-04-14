# Interaction Logging & Session Replay

## Overview

Co-Study4Grid logs every user interaction during a session as a timestamped, **replay-ready** event log. The log contains enough data for an automated agent (e.g. browser automation) to deterministically reproduce the exact same session — same clicks, same selections, same analysis runs — without human input.

The log is saved as a dedicated `interaction_log.json` file alongside `session.json` when saving results.

---

## Design Principles

1. **Self-contained events**: Each event carries all input parameters needed to replay the action, not just a label. An agent reading the log should never need to infer missing data.
2. **Deterministic ordering**: Events are strictly ordered by timestamp. Async completions are logged as separate events with a `correlation_id` linking them to their trigger.
3. **Wait-for-completion semantics**: Events that trigger async work (API calls, streaming) log both a `*_started` and `*_completed` event. A replay agent must wait for the completion event's conditions (API response received) before proceeding to the next action.
4. **UI-level actions**: Log what the user did (clicked, selected, toggled), not internal React state changes. Each event maps to a specific UI gesture that a browser automation agent can reproduce.
5. **Sequence numbering**: Each event gets a monotonically increasing `seq` number for unambiguous ordering, even if timestamps collide.

---

## Event Format

Each entry in `interaction_log.json` follows this structure:

```typescript
interface InteractionLogEntry {
  seq: number;                     // Monotonic sequence number (0-based)
  timestamp: string;               // ISO 8601
  type: InteractionType;           // Event type (see below)
  details: Record<string, unknown>;// Type-specific replay payload
  correlation_id?: string;         // Links async start/complete pairs
  duration_ms?: number;            // For *_completed events: wall-clock duration
}
```

### Event Types

```typescript
type InteractionType =
  // === Configuration & Study Loading ===
  | 'config_loaded'                // User clicked "Load Study" → config sent to backend
  | 'settings_opened'              // User opened settings modal
  | 'settings_tab_changed'         // User switched tab within settings modal
  | 'settings_applied'             // User clicked Apply in settings (all params captured)
  | 'settings_cancelled'           // User cancelled/closed settings without applying
  | 'path_picked'                  // User used native file/dir picker
  // === Contingency Selection ===
  | 'contingency_selected'         // User selected a branch from dropdown
  | 'contingency_confirmed'        // User confirmed branch change (after dialog)
  // === Two-Step Analysis ===
  | 'analysis_step1_started'       // Step 1 launched (detect overloads)
  | 'analysis_step1_completed'     // Step 1 finished (overloads detected)
  | 'overload_toggled'             // User toggled an overload checkbox
  | 'analysis_step2_started'       // Step 2 launched (resolve overloads)
  | 'analysis_step2_completed'     // Step 2 finished (actions received)
  | 'prioritized_actions_displayed'// User clicked "Display Prioritized Actions"
  // === Action Interactions ===
  | 'action_selected'              // User clicked an action card
  | 'action_deselected'            // User clicked away / deselected action
  | 'action_favorited'             // User starred an action
  | 'action_unfavorited'           // User un-starred an action
  | 'action_rejected'              // User rejected an action
  | 'action_unrejected'            // User un-rejected an action
  | 'manual_action_simulated'      // User simulated action via manual search
  | 'action_mw_resimulated'        // User edited Target MW on a load-shedding / curtailment card and clicked Re-simulate
  | 'pst_tap_resimulated'          // User edited Target Tap on a PST action card and clicked Re-simulate
  // === Combined Actions ===
  | 'combine_modal_opened'         // User opened Combine Actions modal
  | 'combine_modal_closed'         // User closed Combine Actions modal
  | 'combine_pair_toggled'         // User toggled an action in pair selection
  | 'combine_pair_estimated'       // Superposition estimation computed
  | 'combine_pair_simulated'       // Full simulation of combined pair
  // === Visualization ===
  | 'diagram_tab_changed'          // User switched tab (n / n-1 / action / overflow)
  | 'tab_detached'                 // User detached a viz tab into its own browser window
  | 'tab_reattached'               // User reattached a detached viz tab back into the main window
  | 'tab_tied'                     // User tied a detached tab's viewBox to the main window
  | 'tab_untied'                   // User untied a previously-tied detached tab
  | 'view_mode_changed'            // User switched Flows/Impacts mode
  | 'voltage_range_changed'        // User adjusted voltage filter slider
  | 'asset_clicked'                // User clicked a line/asset badge to zoom
  | 'zoom_in'                      // User clicked zoom-in button
  | 'zoom_out'                     // User clicked zoom-out button
  | 'zoom_reset'                   // User clicked zoom reset button
  | 'inspect_query_changed'        // User typed in search/inspect box
  // === SLD Overlay ===
  | 'sld_overlay_opened'           // User double-clicked VL to open SLD
  | 'sld_overlay_tab_changed'      // User switched SLD tab (n / n-1 / action)
  | 'sld_overlay_closed'           // User closed SLD overlay
  // === Session Management ===
  | 'session_saved'                // User saved session
  | 'session_reload_modal_opened'  // User opened reload modal
  | 'session_reloaded';            // User selected a session to reload
```

---

## Replay Contract: Required Details Per Event Type

Each event's `details` field contains **all parameters needed to replay** the user action.

### Configuration & Study Loading

| Event | Details | Replay Action |
|-------|---------|---------------|
| `config_loaded` | `{ network_path, action_file_path, layout_path, output_folder_path, min_line_reconnections, min_close_coupling, min_open_coupling, min_line_disconnections, min_pst, min_load_shedding, min_renewable_curtailment_actions, n_prioritized_actions, lines_monitoring_path, monitoring_factor, pre_existing_overload_threshold, ignore_reconnections, pypowsybl_fast_mode }` | Click "Load Study" with these config values |
| `settings_opened` | `{ tab: 'paths'\|'recommender'\|'configurations' }` | Click gear icon |
| `settings_tab_changed` | `{ from_tab: 'paths'\|'recommender'\|'configurations', to_tab: 'paths'\|'recommender'\|'configurations' }` — only emitted when `from_tab !== to_tab` | Click tab in settings modal |
| `settings_applied` | Same payload as `config_loaded` (full settings snapshot). Treated as a wait-point: the replay agent must wait for the network reload to finish before proceeding. | Fill all fields → click Apply |
| `settings_cancelled` | `{}` | Click Cancel / close settings |
| `path_picked` | `{ type: 'file'\|'dir', path: string }` — the setter (network/action/layout/output/monitoring) is implicit from the preceding UI sequence (the settings modal field focused before the picker opened). | Click file picker → select path |

> **Note on new recommender thresholds**: `min_load_shedding` and `min_renewable_curtailment_actions` were introduced alongside the new `loads_p` / `gens_p` power-reduction action format. They MUST be present in both `config_loaded` and `settings_applied` details so a replay agent can set the thresholds before loading the study. Older logs that predate these fields will be replayed with the backend defaults (`0.0`).

### Contingency Selection

| Event | Details | Replay Action |
|-------|---------|---------------|
| `contingency_selected` | `{ element: string }` | Select value in branch dropdown |
| `contingency_confirmed` | `{ type: 'contingency'\|'loadStudy'\|'applySettings'\|'changeNetwork', pending_branch?: string }` — `type` identifies which confirmation dialog the user clicked OK on (contingency-change / reload-study / apply-settings / change-network-path). `pending_branch` is only populated for `type: 'contingency'`. | Click OK in confirmation dialog |

### Two-Step Analysis

| Event | Details | Replay Action |
|-------|---------|---------------|
| `analysis_step1_started` | `{ element: string }` | Click "Detect Overloads" |
| `analysis_step1_completed` | `{ element, overloads_found: string[], n_overloads: string[], can_proceed: bool, dc_fallback: bool, message: string }` | *(wait point — agent waits for API response)* |
| `overload_toggled` | `{ overload: string, selected: bool }` | Click checkbox for overload |
| `analysis_step2_started` | `{ element, selected_overloads: string[], all_overloads: string[], monitor_deselected: bool }` | Click "Resolve Selected Overloads" |
| `analysis_step2_completed` | `{ n_actions: number, action_ids: string[], dc_fallback: bool, message: string, pdf_url: string\|null }` | *(wait point)* |
| `prioritized_actions_displayed` | `{ n_actions: number }` | Click "Display Prioritized Actions" button |

### Action Interactions

| Event | Details | Replay Action |
|-------|---------|---------------|
| `action_selected` | `{ action_id: string }` | Click action card |
| `action_deselected` | `{ previous_action_id: string }` | Click elsewhere / select null |
| `action_favorited` | `{ action_id: string }` | Click star icon |
| `action_unfavorited` | `{ action_id: string }` | Click star icon (toggle off) |
| `action_rejected` | `{ action_id: string }` | Click reject icon |
| `action_unrejected` | `{ action_id: string }` | Click reject icon (toggle off) |
| `manual_action_simulated` | `{ action_id: string }` | Search action → click Simulate |
| `action_mw_resimulated` | `{ action_id: string, target_mw: number }` — the raw user-entered MW value (backend may clamp). Wait-point: the action card updates with new `rho_after`, `load_shedding_details` / `curtailment_details`. The action stays in its current bucket (suggested vs. manual). | Edit Target MW input on a load-shedding or curtailment card → click Re-simulate |
| `pst_tap_resimulated` | `{ action_id: string, target_tap: number }` — the raw user-entered tap integer. Backend clamps to `[low_tap, high_tap]`. Wait-point: same as MW re-simulation but the `pst_details.tap_position` is updated instead. | Edit Target Tap input on a PST card → click Re-simulate |

### Combined Actions

| Event | Details | Replay Action |
|-------|---------|---------------|
| `combine_modal_opened` | `{}` | Click "Combine Actions" button |
| `combine_modal_closed` | `{}` | Close modal |
| `combine_pair_toggled` | `{ action_id: string, selected: bool }` | Toggle checkbox in pair selection |
| `combine_pair_estimated` | `{ action1_id, action2_id, estimated_max_rho: number, estimated_max_rho_line: string }` | *(auto after pair selected — wait point)* |
| `combine_pair_simulated` | `{ combined_id: string, action1_id, action2_id, simulated_max_rho: number\|null }` | Click "Simulate" on pair row |

### Visualization

| Event | Details | Replay Action |
|-------|---------|---------------|
| `diagram_tab_changed` | `{ tab: TabId }` — the destination tab the user clicked. | Click tab button |
| `tab_detached` | `{ tab: TabId }` — the tab moved into a secondary browser window. Wait-point: the popup must be open and the portal target mounted before the next event can be replayed. Replay agents that cannot script a real popup should skip this event and keep the content in the main window. | Click the "Detach" button on a tab header |
| `tab_reattached` | `{ tab: TabId }` | Click the "Reattach" badge in the popup (or "Reattach" in the main window placeholder) |
| `tab_tied` | `{ tab: TabId }` — starts mirroring the detached tab's viewBox one-way into the main window's active tab. | Click "Tie" on a detached tab header |
| `tab_untied` | `{ tab: TabId }` — stops mirroring. Also fired automatically when a tied tab is reattached. | Click "Untie" on a detached tab header |
| `view_mode_changed` | `{ mode: 'network'\|'delta', tab: TabId, scope: 'main'\|'detached' }` — Flow/Impacts is now per-tab AND per-window: toggling in a detached popup only affects that popup's tab. | Click Flows/Impacts toggle |
| `voltage_range_changed` | `{ min: number, max: number }` (kV) | Drag voltage slider |
| `asset_clicked` | `{ action_id: string, asset_name: string, tab: 'n'\|'n-1'\|'action' }` — `tab` is the destination tab for the zoom. When the click comes from the sticky contingency / overloads sidebar (`handleZoomOnActiveTab`), `tab` is set to the **currently active** diagram tab and `action_id` is the empty string — meaning "zoom this asset in place without switching tabs". | Click a rho-line badge or a sticky contingency / overload link |
| `zoom_in` | `{ tab: TabId }` | Click + button |
| `zoom_out` | `{ tab: TabId }` | Click - button |
| `zoom_reset` | `{ tab: TabId }` | Click reset button |
| `inspect_query_changed` | `{ query: string, target_tab?: TabId }` — `target_tab` is only present when the inspect field was triggered from a detached-tab overlay (per-tab inspect routing). Absent = main-window active tab. | Type in search box |

### SLD Overlay

| Event | Details | Replay Action |
|-------|---------|---------------|
| `sld_overlay_opened` | `{ vl_name: string, action_id: string\|null }` — the currently-selected action ID (may be empty) is always carried through, even when the active tab is N / N-1, so the SLD's internal sub-tab buttons can switch to the action view without a backend lookup error. | Double-click VL node |
| `sld_overlay_tab_changed` | `{ tab: SldTab, vl_name: string }` — the destination SLD sub-tab. | Click tab in SLD overlay |
| `sld_overlay_closed` | `{}` | Click close on SLD overlay |

### Session Management

| Event | Details | Replay Action |
|-------|---------|---------------|
| `session_saved` | `{ output_folder: string }` | Click "Save Results" |
| `session_reload_modal_opened` | `{}` — the list of available sessions is fetched async and is not part of the event payload. | Click "Reload Session" |
| `session_reloaded` | `{ session_name: string }` | Click session in list |

---

## Replay Agent Contract

### Event Processing Loop

```
for each event in interaction_log (ordered by seq):
  1. Wait for app to be idle (no pending API calls, no loading spinners)
  2. Execute the UI action described by event.type + event.details
  3. If event has a correlation_id and is a *_started event:
     - Execute the action
     - Wait for the matching *_completed event's conditions to be met
     - (The completed event is informational — the agent doesn't "replay" it,
        it waits for the app to produce that state naturally)
  4. Proceed to next event
```

### Wait Points (Async Operations)

These events trigger async API calls. The replay agent must wait for the operation to complete before proceeding:

| Trigger Event | Wait Condition |
|---------------|----------------|
| `config_loaded` | Network loaded, branches list populated |
| `analysis_step1_started` | Loading spinner gone, overload list populated |
| `analysis_step2_started` | Streaming complete, action cards visible, `lines_overloaded_rho` populated on the N-1 payload for the sidebar sticky header |
| `action_selected` | Action diagram loaded (or simulation fallback complete) |
| `manual_action_simulated` | Action card appears in feed |
| `action_mw_resimulated` | Action card updates with new `rho_after` and refreshed `load_shedding_details` / `curtailment_details`; the card stays in its current bucket |
| `pst_tap_resimulated` | Action card updates with new `rho_after` and refreshed `pst_details.tap_position`; the card stays in its current bucket |
| `combine_pair_estimated` | Estimation values appear in modal |
| `combine_pair_simulated` | Simulation values appear in modal |
| `session_reloaded` | Full session state restored (see "Session reload fidelity" below) |
| `settings_applied` | Network reloaded, branches refreshed |
| `tab_detached` | Popup opened, React portal target mounted — or the event is skipped if the runner can't open real popups |
| `tab_reattached` | Popup closed, content re-rendered in the main window |

### Handling `*_completed` Events

Completed events are **informational checkpoints**, not actions to replay. They serve two purposes:

1. **Verification**: The agent can compare actual app state against the logged `details` to detect divergence (e.g., different number of overloads found → data changed)
2. **Timing**: The `duration_ms` field gives realistic timing for the original session

### Correlation IDs

Async start/complete pairs share a `correlation_id` (UUID). This allows the agent to:
- Match starts with completions
- Handle nested async operations (e.g., analysis running while diagrams load)
- Detect interrupted operations (start without matching complete = user cancelled/errored)

---

## Session reload fidelity

The `session_reloaded` wait-point above is only meaningful if the saved session actually contains everything the UI needs. Because several features have been added to `session.json` incrementally, this section documents exactly what is persisted and restored so replay agents and downstream tools know which fields are trustworthy on reload.

### Configuration

Every field listed in `config_loaded` / `settings_applied` is persisted under `session.configuration` and restored by `useSession.handleRestoreSession`. This includes `min_load_shedding` and `min_renewable_curtailment_actions` — required for the new `loads_p` / `gens_p` power-reduction format. Older session dumps that predate these fields fall back to `0.0` on reload.

On restore, `committedNetworkPathRef` is set to the restored `network_path`. This is important: it's what gates the "Change Network?" confirmation dialog when the user subsequently edits the Header network input. Without this update the dialog would either misfire (empty ref) or fire against a stale previous value.

### Overloads & sticky header ratios

`session.overloads` now contains:

- `n_overloads: string[]`, `n1_overloads: string[]`, `resolved_overloads: string[]` — as before.
- `n_overloads_rho?: number[]`, `n1_overloads_rho?: number[]` — the per-element loading ratios (`max|i|/permanent_limit`) that feed the sticky sidebar summary (PR #88). Persisted only when their length matches the element-name array; otherwise omitted to avoid misaligned percentages. Older session dumps that predate the sticky header simply don't have these arrays.

After reload, the sidebar sticky header renders percentages for these overloaded lines without requiring a fresh analysis run. The live `n1Diagram.lines_overloaded_rho` that fills the in-memory state comes from the re-fetched N-1 diagram (after `setSelectedBranch` fires), so the persisted arrays are primarily useful for inspection of standalone `session.json` dumps and for replay agents that don't actually re-run the backend.

### Action enrichment fields

Saved `SavedActionEntry` objects carry the enrichment fields added by PRs #73, #78 and #83:

- `lines_overloaded_after: string[]` — post-action overload list, used by SLD / NAD highlight clones on the Remedial Action tab.
- `load_shedding_details: LoadSheddingDetail[]` — per-load MW values for the load-shedding editor card.
- `curtailment_details: CurtailmentDetail[]` — per-generator MW values for the curtailment editor card.
- `pst_details: PstDetail[]` — `{ pst_name, tap_position, low_tap, high_tap }` for the PST editor card.

All four are now **restored** into the live `ActionDetail` objects by `handleRestoreSession`. Previously they were dropped on reload, which caused:

- The PST / load-shedding / curtailment editor cards to render empty until the user re-ran analysis.
- The Remedial Action tab to lose its post-action overload halos (`.nad-overloaded` clones) because `lines_overloaded_after` was gone.

If a replay agent depends on any of those post-load side effects, the reload path is now sufficient — no re-analysis required.

### Action status flags

`SavedActionStatus` (`is_selected`, `is_suggested`, `is_rejected`, `is_manually_simulated`) is persisted and restored as before. No changes to this contract.

### What is NOT persisted

- **Per-card edit state** (`cardEditMw`, `cardEditTap`): these are the raw, uncommitted values in the action card inputs. Only the committed, re-simulated result survives — persisted as `pst_details.tap_position` / `load_shedding_details[].shedded_mw` / `curtailment_details[].curtailed_mw`. A replay agent that wants to reproduce edit keystrokes must consume the `action_mw_resimulated` / `pst_tap_resimulated` events from `interaction_log.json` instead.
- **Detached / tied tab state** (PR #84/#85): `detachedTabs` and the tied-tab registry are deliberately ephemeral. Detaching a tab does not change any analysis result, so reload intentionally starts with all tabs attached to the main window. A replay that needs to reproduce detach / reattach / tie / untie must stream the matching events from `interaction_log.json`.

---

## Output Structure

After saving, the session folder contains:

```
<output_folder>/
  costudy4grid_session_LINE_XYZ_2026-03-18T10-30-00/
    session.json            ← full state snapshot
    interaction_log.json    ← replay-ready event log
    overflow_abc123.pdf     ← overflow graph copy
```

### Example `interaction_log.json`

```json
[
  {
    "seq": 0,
    "timestamp": "2026-03-18T10:20:01.123Z",
    "type": "config_loaded",
    "correlation_id": "a1b2c3d4",
    "details": {
      "network_path": "/data/network.xiidm",
      "action_file_path": "/data/actions.json",
      "layout_path": "/data/grid_layout.json",
      "min_line_reconnections": 2.0,
      "min_close_coupling": 3.0,
      "min_open_coupling": 2.0,
      "min_line_disconnections": 3.0,
      "min_pst": 1.0,
      "n_prioritized_actions": 10,
      "lines_monitoring_path": "",
      "monitoring_factor": 0.95,
      "pre_existing_overload_threshold": 0.02,
      "ignore_reconnections": false,
      "pypowsybl_fast_mode": true
    }
  },
  {
    "seq": 1,
    "timestamp": "2026-03-18T10:20:15.456Z",
    "type": "contingency_selected",
    "correlation_id": "e5f6a7b8",
    "details": { "element": "LINE_XYZ" }
  },
  {
    "seq": 2,
    "timestamp": "2026-03-18T10:20:30.789Z",
    "type": "analysis_step1_started",
    "correlation_id": "c9d0e1f2",
    "details": { "element": "LINE_XYZ" }
  },
  {
    "seq": 3,
    "timestamp": "2026-03-18T10:20:45.012Z",
    "type": "analysis_step1_completed",
    "correlation_id": "c9d0e1f2",
    "details": {
      "element": "LINE_XYZ",
      "overloads_found": ["LINE_A", "LINE_B", "LINE_C"],
      "can_proceed": true,
      "dc_fallback": false,
      "message": "3 overloaded lines detected"
    },
    "duration_ms": 14223
  },
  {
    "seq": 4,
    "timestamp": "2026-03-18T10:21:00.345Z",
    "type": "overload_toggled",
    "correlation_id": "d3e4f5a6",
    "details": { "overload": "LINE_C", "selected": false }
  },
  {
    "seq": 5,
    "timestamp": "2026-03-18T10:21:05.678Z",
    "type": "analysis_step2_started",
    "correlation_id": "b7c8d9e0",
    "details": {
      "element": "LINE_XYZ",
      "selected_overloads": ["LINE_A", "LINE_B"],
      "all_overloads": ["LINE_A", "LINE_B", "LINE_C"],
      "monitor_deselected": false
    }
  },
  {
    "seq": 6,
    "timestamp": "2026-03-18T10:21:30.901Z",
    "type": "analysis_step2_completed",
    "correlation_id": "b7c8d9e0",
    "details": {
      "n_actions": 5,
      "action_ids": ["disco_42", "reco_17", "topo_03", "pst_01", "disco_88"],
      "dc_fallback": false,
      "message": "Found 5 prioritized actions",
      "pdf_url": "/results/pdf/overflow_abc123.pdf"
    },
    "duration_ms": 25123
  },
  {
    "seq": 7,
    "timestamp": "2026-03-18T10:21:35.000Z",
    "type": "prioritized_actions_displayed",
    "correlation_id": "f1a2b3c4",
    "details": { "n_actions": 5 }
  },
  {
    "seq": 8,
    "timestamp": "2026-03-18T10:22:00.234Z",
    "type": "action_selected",
    "correlation_id": "a5b6c7d8",
    "details": { "action_id": "disco_42" }
  },
  {
    "seq": 9,
    "timestamp": "2026-03-18T10:22:10.567Z",
    "type": "action_favorited",
    "correlation_id": "e9f0a1b2",
    "details": { "action_id": "disco_42" }
  },
  {
    "seq": 10,
    "timestamp": "2026-03-18T10:22:20.890Z",
    "type": "diagram_tab_changed",
    "correlation_id": "c3d4e5f6",
    "details": { "from_tab": "n-1", "to_tab": "action" }
  },
  {
    "seq": 11,
    "timestamp": "2026-03-18T10:23:00.123Z",
    "type": "action_rejected",
    "correlation_id": "a7b8c9d0",
    "details": { "action_id": "reco_17" }
  },
  {
    "seq": 12,
    "timestamp": "2026-03-18T10:25:00.456Z",
    "type": "session_saved",
    "correlation_id": "e1f2a3b4",
    "details": {
      "session_name": "costudy4grid_session_LINE_XYZ_2026-03-18T10-25-00",
      "output_folder": "/data/output"
    }
  }
]
```

---

## Implementation

### Frontend Architecture

The logger is a **singleton class** (not React state) to avoid unnecessary re-renders. It lives in `frontend/src/utils/interactionLogger.ts`:

```typescript
class InteractionLogger {
  private log: InteractionLogEntry[] = [];
  private seq = 0;

  record(type, details, correlationId?): string  // returns correlation_id
  recordCompletion(type, correlationId, details, startTimestamp): void
  getLog(): InteractionLogEntry[]                 // returns copy
  clear(): void                                   // resets log + seq
}

export const interactionLogger = new InteractionLogger();
```

- `record()` returns a `correlation_id` so callers can pass it to `recordCompletion()` for async pairs.
- `clear()` is called when a new study is loaded (new session scope).
- Uses `crypto.randomUUID()` for correlation IDs (no external dependency).

### Instrumented Handlers

User-facing handlers across `App.tsx`, `CombinedActionsModal.tsx`, `ActionFeed.tsx`, `SettingsModal.tsx` and the hook modules (`useActions.ts`, `useAnalysis.ts`, `useDiagrams.ts`, `useSession.ts`, `useSettings.ts`, `useSldOverlay.ts`, `useTiedTabsSync.ts`) call `interactionLogger.record()`. The rule of thumb is: **log where the user gesture is handled, not inside downstream reducers**. Re-simulation events are a good example — they used to be logged from the `useActions` hook but now live in `ActionFeed.handleResimulate` / `handleResimulateTap` because that's the only place where the user-edited `target_mw` / `target_tap` values are in scope. Async handlers use the start/complete pattern:

```typescript
const handleRunAnalysis = useCallback(async () => {
  const corrId = interactionLogger.record('analysis_step1_started', {
    element: selectedBranch,
  });
  const startTs = new Date().toISOString();
  try {
    const step1 = await api.runAnalysisStep1(selectedBranch);
    interactionLogger.recordCompletion('analysis_step1_completed', corrId, {
      element: selectedBranch,
      overloads_found: step1.lines_overloaded,
      // ...
    }, startTs);
  } catch (e) { /* ... */ }
}, [selectedBranch]);
```

### Save Flow

1. `handleSaveResults` passes `interactionLogger.getLog()` to `buildSessionResult()`
2. The log is serialized as a separate `interaction_log` field in the API call
3. Backend writes `interaction_log.json` alongside `session.json` in the session folder
4. The log is kept as a **separate file** (not embedded in `session.json`) to keep backward compatibility

### API Change

`POST /api/save-session` accepts an optional `interaction_log` string field:

```python
class SaveSessionRequest(BaseModel):
    session_name: str
    json_content: str
    pdf_path: str | None = None
    output_folder_path: str
    interaction_log: str | None = None
```

---

## Testing

### Unit Tests (`interactionLogger.test.ts`)

- `record()` appends entries with correct timestamp, type, and incrementing seq
- `record()` returns a correlation_id
- `recordCompletion()` links to the same correlation_id and includes duration_ms
- `getLog()` returns a copy (not a reference)
- `clear()` empties the log and resets seq counter
- Multiple records maintain insertion order

### Session Tests (`sessionUtils.test.ts`)

- `buildSessionResult` includes `interaction_log` when provided
- `interaction_log` is empty array when no interactions recorded
