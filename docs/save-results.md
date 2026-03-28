# Save & Reload Sessions

## Overview

Co-Study4Grid supports **saving** and **reloading** full analysis sessions:

- **Save Results** exports the complete state (configuration, contingency, actions, combined pairs, overflow graph) to a session folder
- **Reload Session** restores a previously saved session, bringing the UI back to the state when it was saved

### What is saved

- **`session.json`** — all inputs, outputs, user decisions, and combined action pairs
- **`interaction_log.json`** — timestamped log of every user interaction, suitable for automated session replay (see [docs/interaction-logging.md](interaction-logging.md))
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

1. **Configuration** is restored (all paths and algorithm parameters)
2. **Network** is loaded on the backend with the saved configuration
3. **N and N-1 diagrams** are fetched for the saved contingency
4. **Overflow graph PDF** is restored (copied back from session folder if needed)
5. **Action cards** are displayed with their saved data (max_rho, status tags, etc.)
6. **Combined pairs** are restored in the Combine Actions modal
7. **No action card is active** initially — no re-simulation until the user clicks one
8. When the user **clicks an action card**, the action is simulated on-demand to generate its diagram

> **Key design decision:** Actions are not re-simulated on reload. The saved rho values, status tags, and combined pairs are displayed immediately. Simulation only happens when the user actively selects an action card to view its diagram.

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
    "resolved_overloads": ["LINE_A", "LINE_B"]
  },

  "overflow_graph": {
    "pdf_url":  "/results/pdf/overflow_abc123.pdf",
    "pdf_path": "/home/.../Overflow_Graph/overflow_abc123.pdf"
  },

  "analysis": {
    "message":      "Found 5 prioritized actions",
    "dc_fallback":  false,
    "action_scores": { ... },
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
          "loads_bus":    {}
        },
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

*(Other fields match the Recommender and Configurations settings tabs.)*

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
| `action_topology` | Bus assignments changed by the action (`lines_ex_bus`, `lines_or_bus`, etc.) |

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

---

## Implementation Details

### Frontend (`App.tsx`, `utils/sessionUtils.ts`)

**Save flow:**
1. `handleSaveResults` calls `buildSessionResult(input: SessionInput)` to build the JSON
2. If `outputFolderPath` is set: calls `api.saveSession(...)` -> backend saves files
3. If empty: falls back to browser download

**Reload flow:**
1. `handleOpenReloadModal` calls `api.listSessions(outputFolderPath)` and displays the modal
2. User clicks a session -> `handleRestoreSession(sessionName)`:
   - Calls `api.loadSession(...)` to fetch the session JSON
   - Restores all configuration state and calls `api.updateConfig(...)` to load the network
   - Fetches branches, voltage levels, and nominal voltages
   - Restores analysis result with all actions, status tags, and combined pairs
   - Sets `selectedBranch` which triggers N-1 diagram fetch
   - No action card is active — diagrams are fetched on-demand when clicked
3. `handleActionSelect` falls back to `simulateManualAction` if `getActionVariantDiagram` fails (action not in backend memory after restore)

### Standalone Interface (`standalone_interface.html`)

Both save and reload are implemented inline with the same logic as the React app.

---

## Testing

### `frontend/src/utils/sessionUtils.test.ts` (pure unit tests)

- Configuration fields including `layout_path` and `min_pst`
- All four status tags independently computed
- **Combined actions:** serialised with estimation and simulation data
- **Combined actions:** `is_simulated` flag based on presence in `result.actions`
- **Combined actions:** empty object when no combined actions exist
- Edge cases for `is_suggested` / `is_manually_simulated` overlap

### `frontend/src/App.test.tsx` (UI integration tests)

- Save Results and Reload Session buttons present in header
- Button states (disabled/enabled) based on contingency selection

Run tests with:

```bash
cd frontend
npm run test
```
