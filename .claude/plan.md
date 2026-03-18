# Plan: Log User Interactions Per Session

## Goal

Track every meaningful user interaction during a session (configuration, contingency study, action decisions) as a timestamped event log, and save it as a dedicated `interaction_log.json` file alongside `session.json` when saving results.

---

## 1. Define the Interaction Log Data Model

### `frontend/src/types.ts` — New types

```typescript
export type InteractionType =
  | 'config_loaded'           // User clicked Load Study
  | 'settings_changed'        // User applied new settings (recommender/config/paths)
  | 'contingency_selected'    // User selected a branch in the dropdown
  | 'analysis_step1_started'  // Overload detection launched
  | 'analysis_step1_completed'// Overloads detected
  | 'overload_toggled'        // User toggled an overload in the selection list
  | 'analysis_step2_started'  // Resolution analysis launched
  | 'analysis_step2_completed'// Actions received
  | 'action_selected'         // User clicked an action card to view its diagram
  | 'action_favorited'        // User starred an action
  | 'action_unfavorited'      // User un-starred an action
  | 'action_rejected'         // User rejected an action
  | 'action_unrejected'       // User un-rejected an action
  | 'manual_action_simulated' // User simulated an action manually
  | 'combined_action_computed'// User computed a superposition pair
  | 'diagram_tab_changed'     // User switched visualization tab (n/n-1/action/overflow)
  | 'view_mode_changed'       // User switched network/delta view mode
  | 'sld_overlay_opened'      // User opened SLD overlay for a voltage level
  | 'sld_overlay_tab_changed' // User switched SLD tab (n/n-1/action)
  | 'sld_overlay_closed'      // User closed SLD overlay
  | 'session_saved'           // User saved the session
  | 'session_reloaded';       // User reloaded a previous session

export interface InteractionLogEntry {
  timestamp: string;          // ISO 8601
  type: InteractionType;
  details: Record<string, unknown>;  // Type-specific payload (action_id, branch name, etc.)
}
```

The `details` field is free-form per event type. Examples:
- `contingency_selected`: `{ element: "LINE_XYZ" }`
- `action_favorited`: `{ action_id: "disco_42" }`
- `analysis_step1_completed`: `{ overloads_found: 3, dc_fallback: false }`
- `diagram_tab_changed`: `{ from: "n-1", to: "action" }`

---

## 2. Frontend Interaction Logger Utility

### New file: `frontend/src/utils/interactionLogger.ts`

A simple, stateful module (not React state — avoids unnecessary re-renders):

```typescript
class InteractionLogger {
  private log: InteractionLogEntry[] = [];

  record(type: InteractionType, details: Record<string, unknown> = {}): void {
    this.log.push({ timestamp: new Date().toISOString(), type, details });
  }

  getLog(): InteractionLogEntry[] {
    return [...this.log];
  }

  clear(): void {
    this.log = [];
  }
}

export const interactionLogger = new InteractionLogger();
```

- **Singleton** instance exported for use across the app.
- `clear()` called when a new study is loaded or a new contingency selected (start of a new "session" scope).
- No React state needed — the log is only read at save time, so no re-renders triggered.

---

## 3. Instrument App.tsx Handlers

Add `interactionLogger.record(...)` calls at the beginning/end of each handler in `App.tsx`:

| Handler | Event Type | Key Details |
|---------|-----------|-------------|
| `handleLoadConfig` (success) | `config_loaded` | `{ network_path, action_path }` |
| `handleApplySettings` | `settings_changed` | `{ changed_fields: [...] }` |
| `setSelectedBranch` (when user picks) | `contingency_selected` | `{ element }` |
| `handleRunAnalysis` (step1 start) | `analysis_step1_started` | `{ element }` |
| `handleRunAnalysis` (step1 result) | `analysis_step1_completed` | `{ overloads_found, dc_fallback }` |
| `handleToggleOverload` | `overload_toggled` | `{ overload, selected: bool }` |
| `handleDisplayPrioritizedActions` (start) | `analysis_step2_started` | `{ selected_overloads }` |
| `handleDisplayPrioritizedActions` (result) | `analysis_step2_completed` | `{ n_actions, dc_fallback }` |
| `handleActionSelect` | `action_selected` | `{ action_id }` |
| `handleActionFavorite` (toggle) | `action_favorited` / `action_unfavorited` | `{ action_id }` |
| `handleActionReject` (toggle) | `action_rejected` / `action_unrejected` | `{ action_id }` |
| `handleManualActionAdded` | `manual_action_simulated` | `{ action_id }` |
| Combined action computed (callback from modal) | `combined_action_computed` | `{ action1_id, action2_id }` |
| `setActiveTab` | `diagram_tab_changed` | `{ tab }` |
| `handleViewModeChange` | `view_mode_changed` | `{ mode }` |
| `handleVlDoubleClick` | `sld_overlay_opened` | `{ vl_name, action_id }` |
| `handleOverlaySldTabChange` | `sld_overlay_tab_changed` | `{ tab }` |
| `handleOverlayClose` | `sld_overlay_closed` | `{}` |
| `handleSaveResults` | `session_saved` | `{ session_name }` |
| `handleRestoreSession` | `session_reloaded` | `{ session_name }` |

**Clearing the log**: Call `interactionLogger.clear()` at the start of `handleLoadConfig` (new study = new session scope). Optionally also when contingency changes, but keeping the full log from config load through save seems more useful.

---

## 4. Save Interaction Log with Session

### Modify `frontend/src/utils/sessionUtils.ts`

Add `interaction_log` field to `SessionInput`:

```typescript
export interface SessionInput {
  // ... existing fields ...
  interactionLog: InteractionLogEntry[];
}
```

### Modify `SessionResult` in `types.ts`

```typescript
export interface SessionResult {
  // ... existing fields ...
  interaction_log?: InteractionLogEntry[];
}
```

### Update `buildSessionResult()`

Include `input.interactionLog` in the returned object:

```typescript
return {
  saved_at: ...,
  configuration: ...,
  // ... existing fields ...
  interaction_log: input.interactionLog,
};
```

### Update `handleSaveResults` in `App.tsx`

Pass the current log when building the session:

```typescript
const session = buildSessionResult({
  // ... existing fields ...
  interactionLog: interactionLogger.getLog(),
});
```

---

## 5. Backend: Save Interaction Log as Separate File

### Modify `POST /api/save-session` in `expert_backend/main.py`

Add an optional `interaction_log` field to the `SaveSessionRequest`:

```python
class SaveSessionRequest(BaseModel):
    session_name: str
    json_content: str
    pdf_path: str | None = None
    output_folder_path: str
    interaction_log: str | None = None  # JSON string of interaction log entries
```

In the handler, write `interaction_log.json` alongside `session.json`:

```python
if req.interaction_log:
    log_path = os.path.join(session_folder, "interaction_log.json")
    with open(log_path, "w") as f:
        f.write(req.interaction_log)
```

### Update `frontend/src/api.ts`

Add `interaction_log` to the `saveSession` call:

```typescript
saveSession(params: {
  session_name: string;
  json_content: string;
  pdf_path?: string | null;
  output_folder_path: string;
  interaction_log?: string;  // NEW
})
```

### Update `handleSaveResults` in App.tsx

Pass the serialized interaction log:

```typescript
await api.saveSession({
  // ... existing params ...
  interaction_log: JSON.stringify(interactionLogger.getLog(), null, 2),
});
```

---

## 6. Output Structure

After saving, the session folder will contain:

```
<output_folder>/
  expertassist_session_LINE_XYZ_2026-03-18T10-30-00/
    session.json            <- existing: full state snapshot
    interaction_log.json    <- NEW: timestamped event log
    overflow_abc123.pdf     <- existing: overflow graph copy
```

### `interaction_log.json` example

```json
[
  { "timestamp": "2026-03-18T10:20:01.123Z", "type": "config_loaded", "details": { "network_path": "/data/network.xiidm" } },
  { "timestamp": "2026-03-18T10:20:15.456Z", "type": "contingency_selected", "details": { "element": "LINE_XYZ" } },
  { "timestamp": "2026-03-18T10:20:30.789Z", "type": "analysis_step1_started", "details": { "element": "LINE_XYZ" } },
  { "timestamp": "2026-03-18T10:20:45.012Z", "type": "analysis_step1_completed", "details": { "overloads_found": 3, "dc_fallback": false } },
  { "timestamp": "2026-03-18T10:21:00.345Z", "type": "overload_toggled", "details": { "overload": "LINE_C", "selected": false } },
  { "timestamp": "2026-03-18T10:21:05.678Z", "type": "analysis_step2_started", "details": { "selected_overloads": ["LINE_A", "LINE_B"] } },
  { "timestamp": "2026-03-18T10:21:30.901Z", "type": "analysis_step2_completed", "details": { "n_actions": 5, "dc_fallback": false } },
  { "timestamp": "2026-03-18T10:22:00.234Z", "type": "action_selected", "details": { "action_id": "disco_42" } },
  { "timestamp": "2026-03-18T10:22:10.567Z", "type": "action_favorited", "details": { "action_id": "disco_42" } },
  { "timestamp": "2026-03-18T10:22:20.890Z", "type": "diagram_tab_changed", "details": { "tab": "action" } },
  { "timestamp": "2026-03-18T10:23:00.123Z", "type": "action_rejected", "details": { "action_id": "reco_17" } },
  { "timestamp": "2026-03-18T10:25:00.456Z", "type": "session_saved", "details": { "session_name": "expertassist_session_LINE_XYZ_2026-03-18T10-25-00" } }
]
```

---

## 7. Update CLAUDE.md

Document the new interaction logging feature:
- New file: `frontend/src/utils/interactionLogger.ts`
- New types: `InteractionType`, `InteractionLogEntry`
- Updated session save output to include `interaction_log.json`
- Updated `SessionResult` and `SessionInput` types

---

## 8. Tests

### `frontend/src/utils/interactionLogger.test.ts` (unit tests)

- `record()` appends entries with correct timestamp and type
- `getLog()` returns a copy (not a reference)
- `clear()` empties the log
- Multiple records maintain order

### `frontend/src/utils/sessionUtils.test.ts` (extend existing)

- `buildSessionResult` includes `interaction_log` when provided
- `interaction_log` is empty array when no interactions recorded

---

## Files Modified

| File | Change |
|------|--------|
| `frontend/src/types.ts` | Add `InteractionType`, `InteractionLogEntry`; add `interaction_log?` to `SessionResult` |
| `frontend/src/utils/interactionLogger.ts` | **NEW** — singleton logger class |
| `frontend/src/utils/interactionLogger.test.ts` | **NEW** — unit tests for logger |
| `frontend/src/utils/sessionUtils.ts` | Add `interactionLog` to `SessionInput`; include in output |
| `frontend/src/utils/sessionUtils.test.ts` | Add test for interaction_log in session |
| `frontend/src/App.tsx` | Import logger; add `record()` calls in ~20 handlers |
| `frontend/src/api.ts` | Add `interaction_log` param to `saveSession` |
| `expert_backend/main.py` | Add `interaction_log` field to `SaveSessionRequest`; write file |
| `CLAUDE.md` | Document new feature |
| `docs/save-results.md` | Document `interaction_log.json` in session output |

---

## Implementation Order

1. Types (`types.ts`) — define the data model
2. Logger utility (`interactionLogger.ts`) — the core module
3. Logger tests (`interactionLogger.test.ts`)
4. Session utils update (`sessionUtils.ts`) — wire log into save
5. Session utils tests update
6. API client update (`api.ts`) — pass log to backend
7. Backend update (`main.py`) — accept and write log file
8. App.tsx instrumentation — add `record()` calls to all handlers
9. CLAUDE.md + docs update
10. Commit and push
