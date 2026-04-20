# Save & Reload Sessions

## Overview

Co-Study4Grid supports **saving** and **reloading** full analysis sessions:

- **Save Results** exports the complete state (configuration, contingency, actions, combined pairs, overflow graph) to a session folder
- **Reload Session** restores a previously saved session, bringing the UI back to the state when it was saved

### What is saved

- **`session.json`** — all inputs, outputs, user decisions, combined action pairs, per-action enrichment details (`load_shedding_details` / `curtailment_details` / `pst_details` / `lines_overloaded_after`) and, when available, the per-element sidebar sticky-header loading ratios (`n_overloads_rho` / `n1_overloads_rho`)
- **`interaction_log.json`** — timestamped log of every user interaction, suitable for automated session replay (see [docs/features/interaction-logging.md](interaction-logging.md))
- **`<overflow>.pdf`** — a copy of the overflow graph PDF (when an analysis has been run)

All files are written to a **session folder** named `costudy4grid_session_<contingency>_<timestamp>/` inside the configured **Output Folder Path**.

---

## Setup: Configure the Output Folder

Open **Settings → Paths** and set the **Output Folder Path**:

```
Settings → gear icon → Paths tab → Output Folder Path
```

> **Without an output folder:** Save falls back to browser JSON download. Reload is not available.

---

## Banner

| Button | Description |
|---|---|
| **Load Study** | Load/reload the network and configuration |
| **Save Results** | Save the current session (disabled until a contingency is selected) |
| **Reload Session** | Restore a previously saved session from the output folder |
| **Settings** | Open settings modal |

---

## How to Save

1. Open **Settings → Paths** and configure Action Dictionary File Path and Output Folder Path.
2. Load a study (click **Load Study**).
3. Select a contingency in the **Select Contingency** box.
4. Optionally run analysis, select/reject actions, simulate manual/combined actions.
5. Click **Save Results** in the header.

### Output

```
<output_folder_path>/
  costudy4grid_session_LINE_XYZ_2026-03-11T14-23-05/
    session.json
    interaction_log.json   <- replay-ready event log
    overflow_abc123.pdf    <- copy of the overflow graph
```

---

## How to Reload

1. Ensure the **Output Folder Path** is configured in Settings → Paths.
2. Click **Reload Session** in the banner.
3. A modal lists all saved sessions (most recent first).
4. Click on a session name to restore it.

### What happens on reload

1. **Configuration** is restored (all paths and algorithm parameters, including `min_load_shedding` and `min_renewable_curtailment_actions`)
2. **`committedNetworkPathRef`** is set to the restored `network_path` — this gates the "Change Network?" confirmation dialog the next time the user edits the Header network input. Without this the dialog would either misfire (empty ref) or fire against a stale previous value.
3. **Network** is loaded on the backend with the saved configuration
4. **Monitored-line set + computed-pair cache** — `useSession` calls `POST /api/restore-analysis-context` with the saved `lines_we_care_about` and `computed_pairs` so any subsequent simulate-action uses the SAME monitored-line policy as the original study instead of the backend default. Wrapped in try/catch so an offline backend does not abort the reload.
5. **N-1 diagram fetch** — `restoringSessionRef.current = true` is set before `setSelectedBranch(disconnected_element)` so the N-1 effect in `App.tsx` bypasses its `hasAnalysisState()` short-circuit (the restored actions would otherwise cause the effect to skip the fetch, leaving the N-1 tab blank and the N-1 Overloads panel empty). `clearContingencyState()` is also skipped on restore so the just-restored actions / overloads / result survive. Active-tab switching is suppressed so the user lands on whichever tab the VisualizationPanel default resolves to given the restored state.
6. **Overflow graph PDF** is restored (backend copies the PDF from the session folder back to `Overflow_Graph/` if missing, so the iframe URL resolves)
7. **Action cards** are displayed with their saved data — rho values, status tags, **and all enrichment fields** (`load_shedding_details`, `curtailment_details`, `pst_details`, `lines_overloaded_after`) so the PST / load-shedding / curtailment editor cards render their inputs populated and the Remedial Action tab draws its post-action overload halos
8. **Combined pairs** are restored in the Combine Actions modal. Estimation-only combined entries (`"act_a+act_b"` with `is_estimated: true` and no manual simulation) are filtered out of the top-level `actions` map but survive under `combined_actions`.
9. **Action status flags** (`is_selected`, `is_suggested`, `is_rejected`, `is_manually_simulated`) are partitioned back into the four `Set<string>` state variables used by the Selected / Rejected / Manual buckets.
10. **No action card is active** initially — no re-simulation until the user clicks one
11. When the user **clicks an action card**, the action is simulated on-demand to generate its diagram

> **Key design decision:** Actions are not re-simulated on reload. The saved rho values, status tags, enrichment details and combined pairs are displayed immediately. Simulation only happens when the user actively selects an action card to view its diagram.

### What is NOT persisted

Some pieces of in-memory state are deliberately ephemeral and will reset on reload:

- **Per-card edit state** (`cardEditMw`, `cardEditTap`): the raw, uncommitted values in the action card inputs. Only the committed, re-simulated result survives — persisted as `pst_details.tap_position` / `load_shedding_details[].shedded_mw` / `curtailment_details[].curtailed_mw`. A replay agent that wants to reproduce exact keystrokes must consume the `action_mw_resimulated` / `pst_tap_resimulated` events from `interaction_log.json` instead.
- **Detached / tied visualization tab state** (PRs #84/#85): `detachedTabs` and the tied-tab registry are not in `session.json`. Detaching a tab does not change any analysis result, so reload intentionally starts with all tabs attached to the main window. A replay that needs to reproduce detach / reattach / tie / untie must stream the matching events from `interaction_log.json`.
- **Live diagram rho ratios** are not threaded back from `session.overloads.n1_overloads_rho` into the `n1Diagram` object — they come from the re-fetched N-1 payload after `setSelectedBranch` fires. The persisted rho arrays are primarily useful for inspection of standalone `session.json` dumps and for replay agents that don't re-run the backend.

---

## JSON Structure

```json
{
  "saved_at": "2026-03-11T14:23:05.123Z",

  "configuration": {
    "network_path": "/data/bare_env_...",
    "action_file_path": "/data/actions.json",
    "layout_path": "/data/grid_layout.json",
    "min_line_reconnections": 2.0,
    "min_close_coupling": 3.0,
    "min_open_coupling": 2.0,
    "min_line_disconnections": 3.0,
    "min_pst": 1.0,
    "min_load_shedding": 2.5,
    "min_renewable_curtailment_actions": 1.25,
    "n_prioritized_actions": 10,
    "lines_monitoring_path": "/data/monitoring.csv",
    "monitoring_factor": 0.95,
    "pre_existing_overload_threshold": 0.02,
    "ignore_reconnections": false,
    "pypowsybl_fast_mode": true
  },

  "contingency": {
    "disconnected_element": "LINE_XYZ",
    "selected_overloads": ["LINE_A", "LINE_B"],
    "monitor_deselected": false
  },

  "overloads": {
    "n_overloads":        ["LINE_PRE"],
    "n1_overloads":       ["LINE_A", "LINE_B", "LINE_C"],
    "resolved_overloads": ["LINE_A", "LINE_B"],
    "n_overloads_rho":    [1.04],
    "n1_overloads_rho":   [1.23, 1.17, 1.07]
  },

  "overflow_graph": {
    "pdf_url":  "/results/pdf/overflow_abc123.pdf",
    "pdf_path": "/home/.../Overflow_Graph/overflow_abc123.pdf"
  },

  "analysis": {
    "message":      "Found 5 prioritized actions",
    "dc_fallback":  false,
    "action_scores": { ... },
    "lines_we_care_about": ["LINE_A", "LINE_B", "LINE_C"],
    "computed_pairs": { "act1+act2": { "max_rho": 0.87, "max_rho_line": "LINE_C" } },
    "actions": {
      "action_id": {
        "description_unitaire": "Open switch SW_42",
        "rho_before":  [1.12, 1.05, 0.95],
        "rho_after":   [0.88, 0.92, 0.91],
        "max_rho":     0.92,
        "max_rho_line": "LINE_B",
        "is_rho_reduction": true,
        "estimated_max_rho": 0.90,
        "estimated_max_rho_line": "LINE_B",
        "is_islanded": false,
        "non_convergence":  null,
        "action_topology": {
          "lines_ex_bus": {},
          "lines_or_bus": {},
          "gens_bus":     {},
          "loads_bus":    {},
          "loads_p":      {},
          "gens_p":       {}
        },
        "lines_overloaded_after": ["LINE_C"],
        "load_shedding_details": [
          { "load_name": "LOAD_1", "voltage_level_id": "VL_1", "shedded_mw": 4.2 }
        ],
        "curtailment_details": [
          { "gen_name": "WIND_1", "voltage_level_id": "VL_2", "curtailed_mw": 7.5 }
        ],
        "pst_details": [
          { "pst_name": "PST_A", "tap_position": 5, "low_tap": -16, "high_tap": 16 }
        ],
        "status": {
          "is_selected":          true,
          "is_suggested":         true,
          "is_rejected":          false,
          "is_manually_simulated": false
        }
      }
    },
    "combined_actions": {
      "act1+act2": {
        "action1_id": "act1",
        "action2_id": "act2",
        "betas": [0.5, 0.3],
        "max_rho": 0.85,
        "max_rho_line": "LINE_C",
        "is_rho_reduction": true,
        "description": "Combined act1 + act2",
        "estimated_max_rho": 0.82,
        "estimated_max_rho_line": "LINE_C",
        "is_islanded": false,
        "simulated_max_rho": 0.83,
        "simulated_max_rho_line": "LINE_C",
        "is_simulated": true
      }
    }
  }
}
```

---

## Field Reference

### `configuration`

All settings active when the analysis was run. Matches the fields sent to `POST /api/config`.

| Field | Description |
|---|---|
| `layout_path` | Path to the grid layout file (node positions) |
| `min_pst` | Minimum PST actions threshold |
| `min_load_shedding` | Minimum load-shedding actions threshold (PR #73/#78 — new `loads_p` format) |
| `min_renewable_curtailment_actions` | Minimum renewable-curtailment actions threshold (PR #73/#78 — new `gens_p` format) |

*(Other fields match the Recommender and Configurations settings tabs.)*

> **Legacy sessions:** `min_load_shedding` and `min_renewable_curtailment_actions` were added alongside the new `loads_p` / `gens_p` power-reduction action format. Older session dumps that predate these fields are restored with the default value `0.0`, matching the backend default.

### `contingency`

| Field | Description |
|---|---|
| `disconnected_element` | The branch/line that was disconnected for N-1 simulation |
| `selected_overloads` | Overloads the user chose to resolve (used as `selected_overloads` in step 2) |
| `monitor_deselected` | Whether deselected overloads were still monitored in rho calculations |

### `overloads`

| Field | Source |
|---|---|
| `n_overloads` | Overloaded lines detected in the **N** (base) state |
| `n1_overloads` | Overloaded lines detected in the **N-1** (post-contingency) state |
| `resolved_overloads` | Lines the recommender was asked to resolve (`result.lines_overloaded`) |
| `n_overloads_rho` | *(optional)* Per-element loading ratio (`max\|i\|/permanent_limit`) parallel to `n_overloads`. Feeds the sidebar sticky-header percentages (PR #88). |
| `n1_overloads_rho` | *(optional)* Per-element loading ratio parallel to `n1_overloads`. |

> **Length guard:** `buildSessionResult` only persists an `*_rho` array when its length matches the corresponding name array. A shorter or missing array means the N / N-1 diagram payload predates the rho feature — the field is omitted from the JSON rather than saved misaligned. Older session dumps without these fields reload correctly; the sticky header renders its percentages from the freshly re-fetched N-1 diagram instead.

### `overflow_graph`

URL and file path to the overflow graph PDF generated by `expert_op4grid_recommender`. `null` if analysis was not run.

### `analysis`

| Field | Description |
|---|---|
| `message` | Human-readable summary from the recommender |
| `dc_fallback` | `true` if AC load flow did not converge and DC was used |
| `action_scores` | Raw scoring metrics returned by the recommender (varies by version) |
| `actions` | Map of action ID -> enriched action data (see below) |
| `combined_actions` | Map of combined pair ID -> computed pair data (see below) |
| `lines_we_care_about` | *(optional)* Monitored-line set captured at analysis time. Re-pushed to the backend on reload via `POST /api/restore-analysis-context` so subsequent simulate-action calls use the same set instead of the backend default (see "What happens on reload" step 4). Older session dumps without the field reload unchanged and silently skip the context push. |
| `computed_pairs` | *(optional)* Superposition-computed pair cache keyed by `"actionA+actionB"`. Re-pushed alongside `lines_we_care_about` so the Combine modal does not re-score every pair from scratch after reload. |

`null` when no analysis has been run.

### Action fields

Each action entry mirrors the `ActionDetail` type plus a `status` object:

| Field | Description |
|---|---|
| `description_unitaire` | Human-readable description of the topology change |
| `rho_before` | Current-ratio array before the action (one value per monitored line) |
| `rho_after` | Current-ratio array after the action |
| `max_rho` | Maximum rho across all monitored lines after the action |
| `max_rho_line` | Equipment ID of the most-loaded line after the action |
| `is_rho_reduction` | `true` if the action improves (reduces) the worst-case loading |
| `estimated_max_rho` | Estimated max rho from superposition (for combined actions) |
| `estimated_max_rho_line` | Line with estimated max rho |
| `is_islanded` | `true` if the action causes network islanding |
| `n_components` | Number of connected components after action |
| `disconnected_mw` | MW disconnected by islanding |
| `non_convergence` | Error message when the AC load flow did not converge; `null` otherwise |
| `action_topology` | Bus assignments changed by the action (`lines_ex_bus`, `lines_or_bus`, `loads_p`, `gens_p`, etc.) |
| `lines_overloaded_after` | Overloaded lines remaining **after** the action is applied — drives the post-action overload halos on the Remedial Action NAD / SLD tab (PR #83). |
| `load_shedding_details` | Per-load MW values for the load-shedding editor card. Array of `{ load_name, voltage_level_id, shedded_mw }` (PR #73). |
| `curtailment_details` | Per-generator MW values for the renewable-curtailment editor card. Array of `{ gen_name, voltage_level_id, curtailed_mw }` (PR #73). |
| `pst_details` | PST editor state: array of `{ pst_name, tap_position, low_tap, high_tap }`. `low_tap` / `high_tap` may be `null` if the network manager did not expose bounds (PR #78). |

> **Why the enrichment fields matter on reload:** the PST / load-shedding / curtailment editor cards read directly from `pst_details` / `load_shedding_details` / `curtailment_details` to populate their inputs, and the Remedial Action tab uses `lines_overloaded_after` to clone the post-action overload halos. Before PR #83, these four fields were written to `session.json` but silently dropped on reload, which left the editor cards empty and wiped the overload halos until the user re-ran analysis. They are now restored in full by `handleRestoreSession`.

### Action `status` tags

| Tag | Meaning |
|---|---|
| `is_suggested` | The recommender ever returned this action for the current contingency |
| `is_selected` | The user starred / favorited this action |
| `is_rejected` | The user explicitly rejected this action |
| `is_manually_simulated` | The user added this action via the manual search / simulation flow |

### `combined_actions` (Computed Pairs)

Each combined action entry represents a pair of actions estimated by linear superposition:

| Field | Description |
|---|---|
| `action1_id` | First action in the pair |
| `action2_id` | Second action in the pair |
| `betas` | Superposition coefficients |
| `max_rho` | Max loading from estimation |
| `max_rho_line` | Line with max loading from estimation |
| `is_rho_reduction` | Whether the pair reduces worst-case loading |
| `description` | Human-readable description |
| `estimated_max_rho` | Estimated max rho from superposition |
| `estimated_max_rho_line` | Line with estimated max rho |
| `is_islanded` | Whether estimation detected islanding |
| `disconnected_mw` | MW disconnected by islanding |
| `simulated_max_rho` | Max rho from full simulation (`null` if not simulated) |
| `simulated_max_rho_line` | Line with simulated max rho |
| `is_simulated` | `true` if the user ran a full simulation for this pair |

---

## API Endpoints

### Save

`POST /api/save-session` — Save session files to disk

| Field | Type | Description |
|---|---|---|
| `session_name` | `str` | Folder name to create |
| `json_content` | `str` | Serialised `session.json` content |
| `pdf_path` | `str \| null` | Absolute path to the overflow PDF to copy |
| `output_folder_path` | `str` | Parent output directory |
| `interaction_log` | `str \| null` | Serialised `interaction_log.json` content (see [docs/features/interaction-logging.md](interaction-logging.md)). When non-null, the backend writes it to `<session_folder>/interaction_log.json`. |

Returns `{ "session_folder": "<path>", "pdf_copied": bool }`.

### List

`GET /api/list-sessions?folder_path=<path>` — List saved sessions

Returns `{ "sessions": ["session_name_1", "session_name_2", ...] }` sorted most-recent first.

### Load

`POST /api/load-session` — Read a session file

| Field | Type | Description |
|---|---|---|
| `folder_path` | `str` | Parent output directory |
| `session_name` | `str` | Session folder name |

Returns the parsed `session.json` content. Also restores the overflow PDF to `Overflow_Graph/` if it was removed since saving.

### Restore Analysis Context

`POST /api/restore-analysis-context` — Re-push the session's monitored-line set and computed-pair cache into the backend service's `_analysis_context` so any subsequent `simulate-manual-action` / `compute-superposition` call on the reloaded session uses the same policy as the original study. Called from `useSession::handleRestoreSession` right after the base-diagram `Promise.all` (step 4 of the reload flow).

| Field | Type | Description |
|---|---|---|
| `lines_we_care_about` | `list[str] \| null` | Monitored-line set saved in `session.analysis.lines_we_care_about` |
| `disconnected_element` | `str \| null` | Saved contingency — helps the backend disambiguate between N-1 variants |
| `lines_overloaded` | `list[str] \| null` | Saved `session.overloads.resolved_overloads` — the N-1 overloads the recommender targeted |
| `computed_pairs` | `dict \| null` | Superposition-computed pair cache from `session.analysis.computed_pairs` |

Returns `{ "status": "success", "lines_we_care_about_count": int, "computed_pairs_count": int }`. Wrapped in try/catch on the frontend so a 4xx response does not abort the reload — the user loses the per-study monitored set but the rest of the session state is preserved.

---

## Implementation Details

### Frontend (`hooks/useSession.ts`, `utils/sessionUtils.ts`)

**Save flow:**
1. `handleSaveResults` in `hooks/useSession.ts` calls `buildSessionResult(input: SessionInput)` to build the JSON
2. The `SessionInput` it passes includes `nOverloadsRho` / `n1OverloadsRho` from `nDiagram.lines_overloaded_rho` / `n1Diagram.lines_overloaded_rho` (when present)
3. `buildSessionResult` writes them into `session.overloads.n_overloads_rho` / `n1_overloads_rho` only if the arrays match the corresponding name arrays in length (length guard, see "Overloads" section above)
4. If `outputFolderPath` is set: calls `api.saveSession(...)` with the JSON **and** the current `interactionLogger.getLog()` serialised as `interaction_log` → backend writes both `session.json` and `interaction_log.json`
5. If empty: falls back to browser download (no `interaction_log.json` is written in that case)

**Reload flow:**
1. `handleOpenReloadModal` calls `api.listSessions(outputFolderPath)` and displays the modal
2. User clicks a session → `handleRestoreSession(sessionName, restoreContext)`:
   - Calls `api.loadSession(...)` to fetch the session JSON
   - Restores every configuration field — including `min_load_shedding` and `min_renewable_curtailment_actions`, falling back to `0.0` when absent — via the setters in `restoreContext`
   - Calls `api.updateConfig(...)` to load the network, forwarding every threshold
   - **Updates `committedNetworkPathRef.current`** to the restored `network_path`
   - Fetches branches, voltage levels, nominal voltages **and the base diagram** in parallel
   - **Calls `api.restoreAnalysisContext(...)`** to re-push `lines_we_care_about` + `computed_pairs` into the backend service (wrapped in try/catch — failures log a warning but let the reload complete)
   - Rebuilds each `ActionDetail` from its `SavedActionEntry`, **including** `lines_overloaded_after`, `load_shedding_details`, `curtailment_details` and `pst_details`. Estimation-only combined entries (`id.includes('+') && is_estimated && !is_manually_simulated`) are filtered out of the top-level actions map but kept under `combined_actions`.
   - Partitions action status flags into `selectedActionIds` / `rejectedActionIds` / `manuallyAddedIds` / `suggestedByRecommenderIds`
   - **Sets `restoringSessionRef.current = true` BEFORE `setSelectedBranch(...)`** so the N-1 fetch effect in `App.tsx` can tell "session restore" from "user changed contingency", bypass its `hasAnalysisState()` short-circuit, skip `clearContingencyState()` (which would wipe the just-restored state), and avoid forcing an active-tab switch. The ref is reset to `false` the moment the effect consumes it.
   - No action card is active — diagrams are fetched on-demand when clicked
3. `handleActionSelect` falls back to `simulateManualAction` if `getActionVariantDiagram` fails (action not in backend memory after restore)

> **Session reload regression guard (2026-04-20):** three visible symptoms were fixed in one pass by the ref-ordering + short-circuit-relaxation above: (a) empty N-1 diagram despite a selected contingency, (b) empty N / N-1 Overloads panel, (c) Overflow-Analysis tab unavailable because `result.pdf_url` was wiped alongside the rest of the analysis state. The test `useSession.test.ts::sets restoringSessionRef BEFORE setSelectedBranch` locks the ref ordering in place.

**`SessionInput` / `RestoreContext` signatures:**

- `SessionInput` (in `utils/sessionUtils.ts`) is the plain-data interface consumed by `buildSessionResult`. It carries every configuration field, the action-status sets, the interaction log, and the optional `nOverloadsRho` / `n1OverloadsRho` arrays.
- `RestoreContext` (in `hooks/useSession.ts`) is the companion interface for `handleRestoreSession`. It includes `committedNetworkPathRef` so the restore path can update it in place — a missed setter would silently break the "Change Network?" confirmation dialog after a reload.

### Standalone Interface (auto-generated)

The single-file HTML distribution is now produced by
`npm run build:standalone` → `frontend/dist-standalone/standalone.html`.
It compiles from the same `frontend/src/` source tree, so save/reload
logic is inherited automatically (no manual mirroring). The former
hand-maintained `standalone_interface.html` was decommissioned
2026-04-20 (renamed to `standalone_interface_legacy.html`, untracked
via `.gitignore`, kept on disk for reference).

---

## Testing

### `frontend/src/utils/sessionUtils.test.ts` (pure unit tests on `buildSessionResult`)

- Configuration fields including `layout_path`, `min_pst`, `min_load_shedding`, `min_renewable_curtailment_actions`
- All four status tags independently computed
- **Combined actions:** serialised with estimation and simulation data
- **Combined actions:** `is_simulated` flag based on presence in `result.actions`
- **Combined actions:** empty object when no combined actions exist
- Edge cases for `is_suggested` / `is_manually_simulated` overlap
- **Sticky-header rho persistence:**
  - `n_overloads_rho` / `n1_overloads_rho` are persisted when the rho arrays match the corresponding name array length
  - Both fields are **omitted** when lengths mismatch (guard against misaligned legacy data)
  - Both fields are **omitted** when not provided at all (legacy save flow)

### `frontend/src/hooks/useSession.test.ts` (`handleRestoreSession` tests)

A `makeCtx()` / `makeSession()` fixture pair makes each test self-contained:

- Full configuration restore — every setter is called with the saved value, including the new `min_load_shedding` / `min_renewable_curtailment_actions` thresholds
- Legacy sessions (neither new threshold present) fall back to `0.0` on reload
- **`committedNetworkPathRef.current` is set** to the restored `network_path` — regression guard for the "Change Network?" dialog misfire
- `api.updateConfig` is called once with the full configuration payload
- A `session_reloaded` interaction event is recorded with the session name
- Empty `outputFolderPath` short-circuits the call: no API requests, no setters, ref untouched
- Backend errors surface via `ctx.setError`; the ref is left empty on failure
- **Enrichment field round-trip:** a `captureRestoredResult()` helper replays the functional `setResult` updater against a `null` previous state and asserts `load_shedding_details`, `curtailment_details`, `pst_details` and `lines_overloaded_after` all land on the restored `ActionDetail`
- Action status flags partition correctly into the four `Set<string>` state updates
- Legacy action entries that omit enrichment fields don't crash — values come through as `undefined`
- Estimation-only combined entries are filtered out of top-level `actions` but survive under `combined_actions`
- **`/api/restore-analysis-context` is called** with `lines_we_care_about`, the selected contingency and `computed_pairs` on restore — regression guard for the silent monitored-line-set drift that used to happen after reload
- The context push is **skipped** for legacy sessions that predate `lines_we_care_about`
- Backend-offline failures on `restoreAnalysisContext` are swallowed so the reload still completes
- **`restoringSessionRef.current` flips to `true` BEFORE `setSelectedBranch` is called** — regression guard for the N-1-diagram-not-fetched / overloads-not-populated / stale-Overflow-PDF trio that regressed when the App-level N-1 effect short-circuited on restored analysis state

### `frontend/src/components/ActionFeed.test.tsx` (re-simulation logging)

- `action_mw_resimulated` is recorded with `target_mw === parseFloat(userInput)` on load-shedding / curtailment re-simulate
- `manual_action_simulated` is NOT emitted on LS re-simulate (regression guard for the mistyped event that used to live in `useActions`)
- `pst_tap_resimulated` is recorded with `target_tap === parseInt(userInput, 10)` on PST re-simulate
- `target_mw` is normalised via `parseFloat` even when the user types trailing zeros (`5.400` → `5.4`)

### `frontend/src/components/modals/SettingsModal.test.tsx` (tab-change logging)

- `settings_tab_changed` is logged with `{ from_tab, to_tab }` on every real transition
- `from_tab` tracks the currently-active tab, not the initial one
- Clicking the already-active tab does NOT emit a `settings_tab_changed` event (no-op skip)
- `setSettingsTab` is still called unconditionally on no-op clicks — pins the "setter always, logger only on transition" split behaviour

Run tests with:

```bash
cd frontend
npm run test
```
