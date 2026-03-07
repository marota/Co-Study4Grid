from fastapi import FastAPI, HTTPException, Body, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
import os
import subprocess
import sys
from expert_backend.services.network_service import network_service
from expert_backend.services.recommender_service import recommender_service

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Serve generated PDFs. 
# We mount the directory where PDFs are generated.
# Since the directory name is 'Overflow_Graph', we ensure it exists.
os.makedirs("Overflow_Graph", exist_ok=True)
app.mount("/results/pdf", StaticFiles(directory="Overflow_Graph"), name="pdfs")

class ConfigRequest(BaseModel):
    network_path: str
    action_file_path: str
    min_line_reconnections: float = 2.0
    min_close_coupling: float = 3.0
    min_open_coupling: float = 2.0
    min_line_disconnections: float = 3.0
    n_prioritized_actions: int = 10
    lines_monitoring_path: str | None = None
    monitoring_factor: float = 0.95
    pre_existing_overload_threshold: float = 0.02
    ignore_reconnections: bool = False
    pypowsybl_fast_mode: bool = True

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

class ManualActionRequest(BaseModel):
    action_id: str
    disconnected_element: str

last_network_path = None

@app.post("/api/config")
def update_config(config: ConfigRequest):
    global last_network_path
    try:
        # Load network first to verify path and get branches
        if config.network_path != last_network_path:
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
            
        return {
            "status": "success", 
            "message": "Configuration updated and network loaded",
            "total_lines_count": total_lines,
            "monitored_lines_count": monitored_lines
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
            request.action_id, request.disconnected_element
        )
        return result
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
