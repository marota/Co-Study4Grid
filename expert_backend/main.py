# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

from fastapi import FastAPI, HTTPException, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os
import json as json_module
import shutil
import subprocess
import sys
from pathlib import Path
from expert_backend.services.network_service import network_service
from expert_backend.services.recommender_service import recommender_service

app = FastAPI()

# --- User config file management ---
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
_CONFIG_DEFAULT = _PROJECT_ROOT / "config.default.json"
_CONFIG_PATH_FILE = _PROJECT_ROOT / "config_path.txt"  # stores path to user-chosen config file


def _get_active_config_path() -> Path:
    """Return the active config file path (user-overridden or default)."""
    if _CONFIG_PATH_FILE.exists():
        stored = _CONFIG_PATH_FILE.read_text(encoding="utf-8").strip()
        if stored:
            return Path(stored)
    return _PROJECT_ROOT / "config.json"


def _set_active_config_path(new_path: str) -> None:
    """Persist a custom config file path to config_path.txt."""
    _CONFIG_PATH_FILE.write_text(new_path.strip(), encoding="utf-8")


def _ensure_user_config() -> None:
    """Create the active config file from defaults if it does not exist."""
    active = _get_active_config_path()
    if not active.exists() and _CONFIG_DEFAULT.exists():
        active.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(_CONFIG_DEFAULT, active)


def _load_user_config() -> dict:
    """Load user config from the active path, falling back to defaults."""
    _ensure_user_config()
    active = _get_active_config_path()
    try:
        with open(active, "r", encoding="utf-8") as f:
            return json_module.load(f)
    except (FileNotFoundError, json_module.JSONDecodeError):
        if _CONFIG_DEFAULT.exists():
            with open(_CONFIG_DEFAULT, "r", encoding="utf-8") as f:
                return json_module.load(f)
        return {}


def _save_user_config(data: dict) -> None:
    """Persist user config to the active config file path."""
    active = _get_active_config_path()
    active.parent.mkdir(parents=True, exist_ok=True)
    with open(active, "w", encoding="utf-8") as f:
        json_module.dump(data, f, indent=4, ensure_ascii=False)
        f.write("\n")


# Ensure config file exists on startup
_ensure_user_config()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
# app.add_middleware(GZipMiddleware, minimum_size=10000)

# Serve generated PDFs. 
# We mount the directory where PDFs are generated.
# Since the directory name is 'Overflow_Graph', we ensure it exists.
os.makedirs("Overflow_Graph", exist_ok=True)
app.mount("/results/pdf", StaticFiles(directory="Overflow_Graph"), name="pdfs")

@app.get("/api/user-config")
def get_user_config():
    """Return the persisted user configuration."""
    return _load_user_config()


@app.post("/api/user-config")
def save_user_config(config: dict = Body(...)):
    """Save user configuration to the active config file."""
    try:
        _save_user_config(config)
        return {"status": "success"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.get("/api/config-file-path")
def get_config_file_path():
    """Return the currently active config file path."""
    return {"config_file_path": str(_get_active_config_path())}


@app.post("/api/config-file-path")
def set_config_file_path(path: str = Body(..., embed=True)):
    """
    Change the active config file path.
    If the target file doesn't exist it is created from defaults.
    Returns the loaded config so the frontend can apply the new settings.
    """
    try:
        new_path = Path(path.strip())
        if not new_path.suffix:
            raise HTTPException(status_code=400, detail="Config path must point to a .json file")
        _set_active_config_path(str(new_path))
        _ensure_user_config()
        return {"status": "success", "config_file_path": str(new_path), "config": _load_user_config()}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


class ConfigRequest(BaseModel):
    network_path: str
    action_file_path: str
    min_line_reconnections: float = 2.0
    min_close_coupling: float = 3.0
    min_open_coupling: float = 2.0
    min_line_disconnections: float = 3.0
    min_pst: float = 1.0
    min_load_shedding: float = 0.0
    n_prioritized_actions: int = 10
    lines_monitoring_path: str | None = None
    monitoring_factor: float = 0.95
    pre_existing_overload_threshold: float = 0.02
    ignore_reconnections: bool = False
    pypowsybl_fast_mode: bool = True
    layout_path: str | None = None

class AnalysisRequest(BaseModel):
    disconnected_element: str

class AnalysisStep2Request(BaseModel):
    selected_overloads: list[str]
    all_overloads: list[str] = []
    monitor_deselected: bool = False

class FocusedDiagramRequest(BaseModel):
    element_id: str
    depth: int = 1
    disconnected_element: str = None

class ActionVariantRequest(BaseModel):
    action_id: str
    mode: str = "network"  # "network" or "delta"

class ComputeSuperpositionRequest(BaseModel):
    action1_id: str
    action2_id: str
    disconnected_element: str

class RestoreAnalysisContextRequest(BaseModel):
    lines_we_care_about: list[str] | None = None
    disconnected_element: str | None = None
    lines_overloaded: list[str] | None = None
    computed_pairs: dict | None = None

class ManualActionRequest(BaseModel):
    action_id: str
    disconnected_element: str
    action_content: dict | None = None  # Optional switches dict for actions not in the dictionary
    lines_overloaded: list[str] | None = None  # Optional overloaded line names from saved session

class SaveSessionRequest(BaseModel):
    session_name: str
    json_content: str
    pdf_path: str | None = None
    output_folder_path: str
    interaction_log: str | None = None

last_network_path = None

@app.post("/api/config")
def update_config(config: ConfigRequest):
    global last_network_path
    try:
        # Always reload network and reset recommender caches to ensure clean state.
        # Even if the path is the same, previous analyses may have modified the
        # in-memory network or left stale simulation environments.
        recommender_service.reset()
        network_service.load_network(config.network_path)
        last_network_path = config.network_path
        # Update recommender config
        recommender_service.update_config(config)
        
        # Get line counts
        from expert_op4grid_recommender import config as recommender_config
        total_lines = len(network_service.get_disconnectable_elements())
        if getattr(recommender_config, 'IGNORE_LINES_MONITORING', True):
            monitored_lines = len(network_service.get_monitored_elements())
        else:
            monitored_lines = getattr(recommender_config, 'MONITORED_LINES_COUNT', total_lines)

        # Compute action dictionary statistics using same logic as frontend
        import os as _os
        from expert_op4grid_recommender.action_evaluation.classifier import ActionClassifier
        
        action_dict = recommender_service._dict_action or {}
        action_file_name = _os.path.basename(config.action_file_path)
        
        n_reco = n_disco = n_pst = n_open_coupling = n_close_coupling = 0
        classifier = ActionClassifier()
        
        for k, v in action_dict.items():
            action_id = str(k).lower()
            action_desc = str(v.get("description_unitaire", v.get("description", ""))).lower()
            t = str(classifier.identify_action_type(v) or "unknown").lower()
            
            is_disco = 'disco' in t or 'open_line' in t or 'open_load' in t or 'ouverture' in action_desc
            is_reco = 'reco' in t or 'close_line' in t or 'close_load' in t or 'fermeture' in action_desc
            is_open_coupling = 'open_coupling' in t
            is_close_coupling = 'close_coupling' in t
            is_pst_action = ('pst' in action_id or 'pst' in action_desc or 'pst' in t) and not is_disco and not is_reco and not is_open_coupling and not is_close_coupling
            
            if is_disco: n_disco += 1
            if is_reco: n_reco += 1
            if is_open_coupling: n_open_coupling += 1
            if is_close_coupling: n_close_coupling += 1
            if is_pst_action: n_pst += 1

        return {
            "status": "success", 
            "message": "Configuration updated and network loaded",
            "total_lines_count": total_lines,
            "monitored_lines_count": monitored_lines,
            "action_dict_file_name": action_file_name,
            "action_dict_stats": {
                "reco": n_reco,
                "disco": n_disco,
                "pst": n_pst,
                "open_coupling": n_open_coupling,
                "close_coupling": n_close_coupling,
                "total": len(action_dict)
            }
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/branches")
def get_branches():
    try:
        branches = network_service.get_disconnectable_elements()
        return {"branches": branches}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/voltage-levels")
def get_voltage_levels():
    try:
        voltage_levels = network_service.get_voltage_levels()
        return {"voltage_levels": voltage_levels}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/nominal-voltages")
def get_nominal_voltages():
    """Return VL ID → nominal voltage (kV) mapping and sorted unique kV values."""
    try:
        mapping = network_service.get_nominal_voltages()
        unique_kv = sorted(set(mapping.values()))
        return {"mapping": mapping, "unique_kv": unique_kv}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/pick-path")
def pick_path(type: str = Query("file", enum=["file", "dir"])):
    """
    Opens a native OS file or directory picker and returns the selected path.
    Uses a subprocess to avoid tkinter/display issues in the main thread.
    """
    script = f"""
import tkinter as tk
from tkinter import filedialog
import sys

root = tk.Tk()
root.withdraw()
root.attributes('-topmost', True)
if "{type}" == "dir":
    path = filedialog.askdirectory()
else:
    path = filedialog.askopenfilename()
root.destroy()
if path:
    print(path)
"""
    try:
        # Run the script with the same python interpreter as the server
        result = subprocess.check_output([sys.executable, "-c", script], text=True).strip()
        return {"path": result if result else ""}
    except Exception as e:
        print(f"Error picking path: {e}")
        return {"path": "", "error": str(e)}

@app.post("/api/save-session")
def save_session(request: SaveSessionRequest):
    """
    Saves a session folder to the configured output directory.
    Creates <output_folder_path>/<session_name>/ and writes:
      - session.json  (the analysis snapshot)
      - <overflow>.pdf (copy of the overflow graph PDF, if pdf_path is provided)
    Returns the absolute path of the created session folder.
    """
    import shutil

    if not request.output_folder_path:
        raise HTTPException(status_code=400, detail="output_folder_path is required")

    session_dir = os.path.join(request.output_folder_path, request.session_name)
    try:
        os.makedirs(session_dir, exist_ok=True)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Cannot create session directory: {e}")

    # Write JSON snapshot
    json_file = os.path.join(session_dir, "session.json")
    with open(json_file, "w", encoding="utf-8") as f:
        f.write(request.json_content)

    # Copy overflow PDF if available
    pdf_copied = False
    if request.pdf_path:
        if os.path.isfile(request.pdf_path):
            pdf_dest = os.path.join(session_dir, os.path.basename(request.pdf_path))
            try:
                shutil.copy2(request.pdf_path, pdf_dest)
                pdf_copied = True
            except Exception as e:
                print(f"Warning: Failed to copy PDF from {request.pdf_path} to {pdf_dest}: {e}")
        else:
            print(f"Warning: PDF path provided but file not found: {request.pdf_path}")

    # Write interaction log if provided
    if request.interaction_log:
        log_file = os.path.join(session_dir, "interaction_log.json")
        with open(log_file, "w", encoding="utf-8") as f:
            f.write(request.interaction_log)

    return {
        "session_folder": session_dir,
        "pdf_copied": pdf_copied
    }

@app.get("/api/list-sessions")
def list_sessions(folder_path: str = Query(...)):
    """List available session folders inside the given output folder.
    Returns session names sorted most-recent first (by folder name timestamp)."""
    if not folder_path or not os.path.isdir(folder_path):
        raise HTTPException(status_code=400, detail=f"Invalid folder path: {folder_path}")

    sessions = []
    try:
        for entry in os.listdir(folder_path):
            entry_path = os.path.join(folder_path, entry)
            if os.path.isdir(entry_path) and (entry.startswith("costudy4grid_session") or entry.startswith("expertassist_session")):
                json_path = os.path.join(entry_path, "session.json")
                if os.path.isfile(json_path):
                    sessions.append(entry)
    except OSError as e:
        raise HTTPException(status_code=400, detail=f"Cannot read folder: {e}")

    sessions.sort(reverse=True)
    return {"sessions": sessions}

@app.post("/api/load-session")
def load_session(folder_path: str = Body(...), session_name: str = Body(...)):
    """Read and return the contents of a session.json file.
    Also restores the overflow PDF into Overflow_Graph/ if found in the session folder."""
    import json as json_module
    import shutil
    import glob

    session_dir = os.path.join(folder_path, session_name)
    json_path = os.path.join(session_dir, "session.json")

    if not os.path.isfile(json_path):
        raise HTTPException(status_code=404, detail=f"Session file not found: {json_path}")

    try:
        with open(json_path, "r", encoding="utf-8") as f:
            content = json_module.load(f)

        # Restore overflow PDF: if the original pdf_path is gone, copy from session folder
        overflow = content.get("overflow_graph")
        if overflow and overflow.get("pdf_url"):
            pdf_filename = os.path.basename(overflow["pdf_url"])
            target_path = os.path.join("Overflow_Graph", pdf_filename)
            if not os.path.isfile(target_path):
                # Look for PDF in session folder
                session_pdfs = glob.glob(os.path.join(session_dir, "*.pdf"))
                if session_pdfs:
                    os.makedirs("Overflow_Graph", exist_ok=True)
                    shutil.copy2(session_pdfs[0], target_path)

        return content
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read session: {e}")

@app.post("/api/restore-analysis-context")
def restore_analysis_context(request: RestoreAnalysisContextRequest):
    """Restore analysis context from a saved session so that subsequent
    simulate_manual_action calls use the same monitored lines."""
    try:
        recommender_service.restore_analysis_context(
            lines_we_care_about=request.lines_we_care_about,
            disconnected_element=request.disconnected_element,
            lines_overloaded=request.lines_overloaded,
            computed_pairs=request.computed_pairs,
        )
        return {
            "status": "success",
            "lines_we_care_about_count": len(request.lines_we_care_about) if request.lines_we_care_about else 0,
            "computed_pairs_count": len(request.computed_pairs) if request.computed_pairs else 0,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

from fastapi.responses import StreamingResponse
import json
@app.post("/api/run-analysis")
async def run_analysis(request: AnalysisRequest):
    def event_generator():
        try:
            for event in recommender_service.run_analysis(request.disconnected_element):
                if event.get("pdf_path"):
                    filename = os.path.basename(event["pdf_path"])
                    event["pdf_url"] = f"/results/pdf/{filename}"
                
                # Yield JSON line
                yield json.dumps(event) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.post("/api/run-analysis-step1")
async def run_analysis_step1(request: AnalysisRequest):
    try:
        result = recommender_service.run_analysis_step1(request.disconnected_element)
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/run-analysis-step2")
async def run_analysis_step2(request: AnalysisStep2Request):
    def event_generator():
        try:
            for event in recommender_service.run_analysis_step2(
                request.selected_overloads,
                all_overloads=request.all_overloads,
                monitor_deselected=request.monitor_deselected
            ):
                if event.get("pdf_path"):
                    filename = os.path.basename(event["pdf_path"])
                    event["pdf_url"] = f"/results/pdf/{filename}"
                
                # Yield JSON line
                yield json.dumps(event) + "\n"
        except Exception as e:
            yield json.dumps({"type": "error", "message": str(e)}) + "\n"

    return StreamingResponse(event_generator(), media_type="application/x-ndjson")

@app.get("/api/network-diagram")
def get_network_diagram():
    try:
        diagram = recommender_service.get_network_diagram()
        return diagram
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/n1-diagram")
def get_n1_diagram(request: AnalysisRequest):
    try:
        diagram = recommender_service.get_n1_diagram(request.disconnected_element)
        return diagram
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/action-variant-diagram")
def get_action_variant_diagram(request: ActionVariantRequest):
    """Generate a NAD for the network state after applying a remedial action.

    Requires a prior call to /api/run-analysis so the observation is available.
    """
    try:
        diagram = recommender_service.get_action_variant_diagram(
            request.action_id, mode=request.mode
        )
        return diagram
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/element-voltage-levels")
def get_element_voltage_levels(element_id: str = Query(...)):
    """Resolve an equipment ID to its voltage level IDs."""
    try:
        vls = network_service.get_element_voltage_levels(element_id)
        return {"voltage_level_ids": vls}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))
@app.post("/api/focused-diagram")
def get_focused_diagram(request: FocusedDiagramRequest):
    """Generate a NAD focused on a specific element's voltage levels.

    If disconnected_element is provided, generates the N-1 state.
    Uses voltage_level_ids + depth to produce a readable sub-diagram.
    """
    try:
        vl_ids = network_service.get_element_voltage_levels(request.element_id)
        if not vl_ids:
            raise HTTPException(status_code=404, detail=f"No voltage levels found for {request.element_id}")

        if request.disconnected_element:
            diagram = recommender_service.get_n1_diagram(
                request.disconnected_element,
                voltage_level_ids=vl_ids,
                depth=request.depth
            )
        else:
            diagram = recommender_service.get_network_diagram(
                voltage_level_ids=vl_ids,
                depth=request.depth
            )
        diagram["voltage_level_ids"] = vl_ids
        diagram["depth"] = request.depth
        return diagram
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

class ActionVariantFocusedRequest(BaseModel):
    action_id: str
    element_id: str
    depth: int = 1

@app.post("/api/action-variant-focused-diagram")
def get_action_variant_focused_diagram(request: ActionVariantFocusedRequest):
    """Generate a focused NAD for a specific VL in the post-action network state."""
    try:
        vl_ids = network_service.get_element_voltage_levels(request.element_id)
        if not vl_ids:
            raise HTTPException(status_code=404, detail=f"No voltage levels found for {request.element_id}")
        diagram = recommender_service.get_action_variant_diagram(
            request.action_id,
            voltage_level_ids=vl_ids,
            depth=request.depth,
        )
        diagram["voltage_level_ids"] = vl_ids
        return diagram
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

class ActionVariantSldRequest(BaseModel):
    action_id: str
    voltage_level_id: str

@app.post("/api/action-variant-sld")
def get_action_variant_sld(request: ActionVariantSldRequest):
    """Generate a Single Line Diagram (SLD) for a voltage level in the post-action network state."""
    try:
        diagram = recommender_service.get_action_variant_sld(
            request.action_id,
            request.voltage_level_id,
        )
        return diagram
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

class NSldRequest(BaseModel):
    voltage_level_id: str

@app.post("/api/n-sld")
def get_n_sld(request: NSldRequest):
    """Generate a Single Line Diagram (SLD) for a voltage level in the base network state."""
    try:
        diagram = recommender_service.get_n_sld(request.voltage_level_id)
        return diagram
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

class N1SldRequest(BaseModel):
    disconnected_element: str
    voltage_level_id: str

@app.post("/api/n1-sld")
def get_n1_sld(request: N1SldRequest):
    """Generate a Single Line Diagram (SLD) for a voltage level in the N-1 network state."""
    try:
        diagram = recommender_service.get_n1_sld(
            request.disconnected_element,
            request.voltage_level_id,
        )
        return diagram
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

@app.get("/api/actions")
def get_actions():
    """Return all available action IDs and descriptions from the loaded dictionary."""
    try:
        actions = recommender_service.get_all_action_ids()
        return {"actions": actions}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/simulate-manual-action")
def simulate_manual_action(request: ManualActionRequest):
    """Simulate a specific action from the loaded dictionary against a contingency."""
    try:
        result = recommender_service.simulate_manual_action(
            request.action_id, request.disconnected_element,
            action_content=request.action_content,
            lines_overloaded=request.lines_overloaded,
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

@app.post("/api/compute-superposition")
def compute_superposition(request: ComputeSuperpositionRequest):
    """Compute the combined effect of two actions using the superposition theorem."""
    try:
        result = recommender_service.compute_superposition(
            request.action1_id, request.action2_id, request.disconnected_element
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
