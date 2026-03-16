# Save Results — Session Export

## Overview

The **💾 Save Results** button exports the full state of a Co-Study4Grid analysis session. It saves:

- **`session.json`** — all inputs, outputs, and user decisions for the session
- **`<overflow>.pdf`** — a copy of the overflow graph PDF (when an analysis has been run)

Both files are written to a **session folder** named `expertassist_session_<contingency>_<timestamp>/` inside the configured **Output Folder Path**. If no output folder is configured, the JSON is downloaded directly to the browser (PDF cannot be saved in that case).

---

## Setup: Configure the Output Folder

Open **⚙ Settings → Paths** and set the **Output Folder Path**:

```
Settings → ⚙ gear icon → Paths tab → Output Folder Path
```

This is the only path that is settings-only (not shown in the banner). Use the 📂 picker button or type the path directly.

> **Without an output folder:** The Save Results button falls back to a browser JSON download only.

---

## Banner Changes

The banner now shows **only the Network Path** field. The action dictionary path and output folder are configured exclusively from **Settings → Paths** tab:

| Location | Fields |
|---|---|
| Banner | Network Path (input + picker), Load Study, Save Results, ⚙ Settings |
| Settings → **Paths** | Network Path *(synced with banner)*, Action Dictionary File Path, Output Folder Path |
| Settings → **Recommender** | Algorithm parameters |
| Settings → **Configurations** | Monitoring, threshold, fast mode |

---

## How to Use

1. Open **Settings → Paths** and configure Action Dictionary File Path and Output Folder Path.
2. Load a study (click **🔄 Load Study**).
3. Select a contingency in the **🎯 Select Contingency** box.
4. Optionally run analysis, select/reject actions, and simulate manual actions.
5. Click **💾 Save Results** in the header.

The button is **disabled** until at least a contingency is selected.

### Output with Output Folder configured

A session folder is created:

```
<output_folder_path>/
  expertassist_session_LINE_XYZ_2026-03-11T14-23-05/
    session.json
    overflow_abc123.pdf   ← copy of the overflow graph
```

A confirmation message is shown in the info bar: `Session saved to: <folder_path>`.

### Output without Output Folder (browser download fallback)

The browser downloads:

```
expertassist_session_LINE_XYZ_2026-03-11T14-23-05.json
```

---

## JSON Structure

```json
{
  "saved_at": "2026-03-11T14:23:05.123Z",

  "configuration": {
    "network_path": "/data/bare_env_...",
    "action_file_path": "/data/actions.json",
    "min_line_reconnections": 2.0,
    "min_close_coupling": 3.0,
    "min_open_coupling": 2.0,
    "min_line_disconnections": 3.0,
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
    }
  }
}
```

---

## Field Reference

### `configuration`

All settings active when the analysis was run. Matches the fields sent to `POST /api/config`.

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
| `actions` | Map of action ID → enriched action data (see below) |

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
| `non_convergence` | Error message when the AC load flow did not converge; `null` otherwise |
| `action_topology` | Bus assignments changed by the action (`lines_ex_bus`, `lines_or_bus`, etc.) |

### Action `status` tags

| Tag | Meaning |
|---|---|
| `is_suggested` | The recommender (`expert_op4grid`) ever returned this action for the current contingency. Accumulated across multiple analysis re-runs. |
| `is_selected` | The user starred / favorited this action (click ⭐ in the action card). |
| `is_rejected` | The user explicitly rejected this action (click ✗ in the action card). |
| `is_manually_simulated` | The user added this action via the manual search / simulation flow. |

> **Important:** `is_suggested` and `is_manually_simulated` are independent. If the user manually simulated an action *before* running the recommender, and the recommender later returned the same action, both flags will be `true`.

---

## Implementation Details

### Backend (`expert_backend/main.py`)

`POST /api/save-session` accepts:

| Field | Type | Description |
|---|---|---|
| `session_name` | `str` | Folder name to create inside `output_folder_path` |
| `json_content` | `str` | Serialised `session.json` content |
| `pdf_path` | `str \| null` | Absolute backend path to the overflow PDF to copy |
| `output_folder_path` | `str` | Absolute path to the parent output directory |

It creates `<output_folder_path>/<session_name>/`, writes `session.json`, and copies the PDF (if the file exists at `pdf_path`). Returns `{ "session_folder": "<absolute_path>" }`.

### Frontend (`App.tsx`, `utils/sessionUtils.ts`)

`handleSaveResults` (async) calls `buildSessionResult` to build the JSON, then:

1. **If `outputFolderPath` is set:** calls `api.saveSession(...)` → backend saves both files → shows info message with the folder path.
2. **If `outputFolderPath` is empty:** falls back to browser download of the JSON blob only.

`buildSessionResult(input: SessionInput)` is a pure function in `utils/sessionUtils.ts`. It keeps the JSON-building logic isolated from React state and directly testable.

#### `outputFolderPath` state

- Initialized from `localStorage.getItem('outputFolderPath')`.
- Backed up in `settingsBackup` so Cancel reverts it.
- Cleared on Load Study and Apply Settings.

#### `suggestedByRecommenderIds` state

A dedicated `Set<string>` accumulates every action ID ever returned by the recommender streaming endpoint for the current contingency:

```typescript
setSuggestedByRecommenderIds(prev => new Set([...prev, ...Object.keys(actionsWithFlags)]));
```

- **Why a separate set?** Using `!manuallyAddedIds.has(id)` (the old approach) would incorrectly mark an action as "not suggested" if the user happened to manually simulate it before the recommender returned it.
- **Cleared on:** contingency change, Load Study, Apply Settings — the same events that reset all other analysis state.

### Settings panel — Paths tab

The "Paths" tab (new, first tab) contains:

| Field | Notes |
|---|---|
| **Network File Path** | Same state as the banner input — changes here are reflected there |
| **Action Dictionary File Path** | Removed from banner; settings-only |
| **Output Folder Path** | New field; empty = browser download fallback |

All three are backed up on settings open and restored on Cancel.

---

## Testing

Tests live in two files:

### `frontend/src/utils/sessionUtils.test.ts` (pure unit tests)

Covers all fields and status tags without React rendering:

- Configuration, contingency, and overloads fields are serialised correctly
- `overflow_graph` is `null` when no PDF was generated
- `analysis` is `null` when `result` is null
- All four status tags (`is_selected`, `is_suggested`, `is_rejected`, `is_manually_simulated`) are independently computed
- **Edge case:** action that was manually simulated AND then returned by the recommender → both `is_manually_simulated: true` and `is_suggested: true`
- **Edge case:** action only manually added, never suggested → `is_suggested: false`
- **Edge case:** `suggestedByRecommenderIds` accumulates across re-runs

### `frontend/src/App.test.tsx` (UI integration tests)

Covers button behaviour inside the rendered App:

- Button present in header after study load
- Button disabled when no branch selected
- Button enabled after selecting a valid branch
- Click triggers a browser download with the correct filename pattern
- Downloaded JSON contains `configuration`, `contingency`, `overloads`, and `analysis` keys
- `analysis` is `null` when no analysis run has been completed

Run tests with:

```bash
cd frontend
npm run test
```
