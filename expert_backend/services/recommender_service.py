import expert_op4grid_recommender
from expert_op4grid_recommender import config
from expert_op4grid_recommender.main import Backend, run_analysis
from expert_op4grid_recommender.data_loader import load_actions
from expert_op4grid_recommender.utils.make_env_utils import create_olf_rte_parameter
import os
import glob
from pathlib import Path
import numpy as np

def sanitize_for_json(obj):
    if isinstance(obj, (np.integer, int)):
        return int(obj)
    elif isinstance(obj, (np.floating, float)):
        return float(obj)
    elif isinstance(obj, np.ndarray):
        return sanitize_for_json(obj.tolist())
    elif isinstance(obj, dict):
        return {str(k): sanitize_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [sanitize_for_json(i) for i in obj]
    elif isinstance(obj, (str, bool, type(None))):
        return obj
    else:
        # Fallback for unknown objects
        try:
            # Try to get dict representation
            if hasattr(obj, "to_dict"):
                return sanitize_for_json(obj.to_dict())
            return sanitize_for_json(vars(obj))
        except TypeError:
            return str(obj)

class RecommenderService:
    def __init__(self):
        self._last_result = None
        self._is_running = False
        self._generator = None
        self._base_network = None
        self._simulation_env = None
        self._last_disconnected_element = None
        self._dict_action = None

    def update_config(self, settings):
        # Update the global config of the package
        path_obj = Path(settings.network_path)
        config.ENV_NAME = path_obj.name
        config.ENV_FOLDER = path_obj.parent
        config.ENV_PATH = path_obj
        
        config.ACTION_FILE_PATH = Path(settings.action_file_path)
        
        # Apply the new settings parameters
        config.MIN_LINE_RECONNECTIONS = settings.min_line_reconnections
        config.MIN_CLOSE_COUPLING = settings.min_close_coupling
        config.MIN_OPEN_COUPLING = settings.min_open_coupling
        config.MIN_LINE_DISCONNECTIONS = settings.min_line_disconnections
        config.N_PRIORITIZED_ACTIONS = settings.n_prioritized_actions
        if hasattr(settings, 'monitoring_factor'):
            config.MONITORING_FACTOR_THERMAL_LIMITS = settings.monitoring_factor
        if hasattr(settings, 'pre_existing_overload_threshold') and settings.pre_existing_overload_threshold is not None:
            config.PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD = settings.pre_existing_overload_threshold
        if hasattr(settings, 'ignore_reconnections') and settings.ignore_reconnections is not None:
            config.IGNORE_RECONNECTIONS = settings.ignore_reconnections
        if hasattr(settings, 'pypowsybl_fast_mode') and settings.pypowsybl_fast_mode is not None:
            config.PYPOWSYBL_FAST_MODE = settings.pypowsybl_fast_mode

        # Force the requested global flags
        config.MAX_RHO_BOTH_EXTREMITIES = True
        
        # Handle lines monitoring optionally
        if hasattr(settings, 'lines_monitoring_path') and settings.lines_monitoring_path:
            if os.path.exists(settings.lines_monitoring_path):
                config.IGNORE_LINES_MONITORING = False
                config.LINES_MONITORING_FILE = Path(settings.lines_monitoring_path)
            else:
                config.IGNORE_LINES_MONITORING = True
                config.LINES_MONITORING_FILE = None
                config.MONITORED_LINES_COUNT = 0
                print(f"Ignoring lines monitoring (file path {settings.lines_monitoring_path} does not exist).")
        else:
            # No monitoring file specified by UI → monitor all lines.
            # The library's setup_environment_configs_pypowsybl will set
            # lines_we_care_about = all lines when IGNORE_LINES_MONITORING is True.
            config.IGNORE_LINES_MONITORING = True
            config.LINES_MONITORING_FILE = None
            config.MONITORED_LINES_COUNT = 0

        if not getattr(config, 'IGNORE_LINES_MONITORING', True):
            try:
                from expert_op4grid_recommender.data_loader import load_interesting_lines
                lines = list(load_interesting_lines(file_name=config.LINES_MONITORING_FILE))
                config.MONITORED_LINES_COUNT = len(lines)
                print(f"Loaded lines monitoring file: {config.LINES_MONITORING_FILE} ({config.MONITORED_LINES_COUNT} lines)")
            except Exception as e:
                print(f"Failed to count lines in {config.LINES_MONITORING_FILE}: {e}")
                config.MONITORED_LINES_COUNT = -1
        
        # Load and cache the action dictionary immediately if path changed or not loaded
        new_action_path = Path(settings.action_file_path)
        if getattr(self, '_last_action_path', None) != new_action_path or self._dict_action is None:
            self._dict_action = load_actions(config.ACTION_FILE_PATH)
            self._last_action_path = new_action_path

            # Auto-generate disco actions if none exist
            has_disco = any(k.startswith("disco_") for k in self._dict_action)
            if not has_disco:
                from expert_backend.services.network_service import network_service
                branches = network_service.get_disconnectable_elements()
                for branch in branches:
                    action_id = f"disco_{branch}"
                    self._dict_action[action_id] = {
                        "description": f"Disconnection of line/transformer '{branch}'",
                        "description_unitaire": f"Ouverture de la ligne '{branch}'",
                        "content": {
                            "set_bus": {
                                "lines_or_id": {branch: -1},
                                "lines_ex_id": {branch: -1},
                                "loads_id": {},
                                "generators_id": {},
                            }
                        },
                    }
                print(f"[RecommenderService] Auto-generated {len(branches)} disco_ actions")
                
                # Save the updated dictionary back to file so the core analysis engine can load it
                import json
                with open(config.ACTION_FILE_PATH, 'w') as f:
                    json.dump(self._dict_action, f, indent=2)
        else:
            print("Action dictionary already loaded, skipping reload.")

        # Inject missing config parameter and redirect output
        config.DO_VISUALIZATION = True
        # Don't check all actions
        config.CHECK_ACTION_SIMULATION = False

        # Set visualization output to local 'Overflow_Graph' directory in backend/
        # uvicorn runs from root, so 'Overflow_Graph' in CWD
        config.SAVE_FOLDER_VISUALIZATION = Path(os.getcwd()) / "Overflow_Graph"
        if not config.SAVE_FOLDER_VISUALIZATION.exists():
            config.SAVE_FOLDER_VISUALIZATION.mkdir(parents=True, exist_ok=True)

    def run_analysis(self, disconnected_element: str):
        import io
        import time
        import threading
        from contextlib import redirect_stdout

        analysis_start_time = time.time()
        shared_state = {
            "analysis_message": "Analysis completed successfully using AC Load Flow.",
            "dc_fallback_used": False,
            "result": None,
            "output": "",
            "error": None,
            "done": False,
            "latest_pdf": None
        }
        
        save_folder = config.SAVE_FOLDER_VISUALIZATION

        def find_latest_pdf():
            pdfs = glob.glob(os.path.join(save_folder, "*.pdf"))
            if not pdfs: return None
            # Only consider PDFs modified after we started
            # Use a tiny offset (1s) to be safe against filesystem drift
            recent_pdfs = [p for p in pdfs if os.path.getmtime(p) >= (analysis_start_time - 1.0)]
            if not recent_pdfs: return None
            return max(recent_pdfs, key=os.path.getmtime)

        def _worker():
            try:
                # Attempt 1: AC
                config.USE_DC_LOAD_FLOW = False
                f_stdout = io.StringIO()
                with redirect_stdout(f_stdout):
                    res = run_analysis(
                        analysis_date=None,
                        current_timestep=0,
                        current_lines_defaut=[disconnected_element],
                        backend=Backend.PYPOWSYBL
                    )
                shared_state["result"] = res
                shared_state["output"] = f_stdout.getvalue()
            except RuntimeError as e:
                # Catch convergence error and try DC
                if "Initial contingency simulation failed" in str(e):
                    try:
                        config.USE_DC_LOAD_FLOW = True
                        shared_state["dc_fallback_used"] = True
                        shared_state["analysis_message"] = "Warning: AC Load Flow did not converge. Fallback to DC Load Flow was used."
                        f_stdout = io.StringIO()
                        with redirect_stdout(f_stdout):
                            res = run_analysis(
                                analysis_date=None,
                                current_timestep=0,
                                current_lines_defaut=[disconnected_element],
                                backend=Backend.PYPOWSYBL
                            )
                        shared_state["result"] = res
                        shared_state["output"] = f_stdout.getvalue()
                    except Exception as inner_e:
                        shared_state["error"] = RuntimeError(f"Analysis failed globally (AC and DC): {inner_e}")
                else:
                    shared_state["error"] = e
            except Exception as e:
                shared_state["error"] = e
            finally:
                shared_state["done"] = True

        thread = threading.Thread(target=_worker)
        thread.start()

        pdf_sent = False
        while not shared_state["done"]:
            # Check for PDF
            if not pdf_sent:
                latest = find_latest_pdf()
                if latest:
                    shared_state["latest_pdf"] = latest
                    yield {"type": "pdf", "pdf_path": str(latest)}
                    pdf_sent = True
            
            if shared_state["error"]:
                raise shared_state["error"]
            
            time.sleep(0.5)

        # Final check for error
        if shared_state["error"]:
            raise shared_state["error"]

        # Final check for PDF if not sent during loop
        if not pdf_sent:
            latest = find_latest_pdf()
            if latest:
                shared_state["latest_pdf"] = latest
                yield {"type": "pdf", "pdf_path": str(latest)}
                pdf_sent = True

        result = shared_state["result"]
        output = shared_state["output"]
        analysis_message = shared_state["analysis_message"]
        dc_fallback_used = shared_state["dc_fallback_used"]

        # Store the full result for later action variant diagram generation
        self._last_result = result
        self._last_disconnected_element = disconnected_element

        if result is None:
            if "No topological solution without load shedding" in output:
                analysis_message = "No topological solution found without load shedding. The grid might be too constrained."
            elif "Overload breaks the grid apart" in output:
                analysis_message = "Grid instability detected: Overload breaks the grid apart."
            else:
                analysis_message = "Analysis finished but no recommendations were found."
            enriched_actions = {}
            lines_overloaded = []
            action_scores = {}
        else:
            lines_overloaded = result.get("lines_overloaded_names", [])
            prioritized = result.get("prioritized_actions", {})
            action_scores = sanitize_for_json(result.get("action_scores", {}))

            monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)

            enriched_actions = {}
            for action_id, action_data in prioritized.items():
                rho_before_raw = action_data.get("rho_before")
                rho_after_raw = action_data.get("rho_after")
                max_rho_raw = action_data.get("max_rho")
                
                rho_before = [r * monitoring_factor for r in rho_before_raw] if rho_before_raw else None
                rho_after = [r * monitoring_factor for r in rho_after_raw] if rho_after_raw else None
                max_rho = (max_rho_raw * monitoring_factor) if max_rho_raw is not None else None

                enriched_actions[action_id] = {
                    "description_unitaire": action_data.get("description_unitaire") or "No description available",
                    "rho_before": sanitize_for_json(rho_before),
                    "rho_after": sanitize_for_json(rho_after),
                    "max_rho": sanitize_for_json(max_rho),
                    "max_rho_line": action_data.get("max_rho_line", ""),
                    "is_rho_reduction": bool(action_data.get("is_rho_reduction", False)),
                }

                # Extract topology from the underlying action object
                action_obj = action_data.get("action")
                if action_obj is not None:
                    topo = {}
                    for field in ("lines_ex_bus", "lines_or_bus", "gens_bus", "loads_bus"):
                        val = getattr(action_obj, field, None)
                        if val is None and isinstance(action_obj, dict):
                            val = action_obj.get(field)
                        topo[field] = sanitize_for_json(val) if val else {}
                    enriched_actions[action_id]["action_topology"] = topo

        from expert_backend.services.network_service import network_service
        total_branches = len(network_service.get_disconnectable_elements())
        monitored_branches = len(network_service.get_monitored_elements())
        excluded_branches = total_branches - monitored_branches
        
        info_msg = f"Note: {monitored_branches} out of {total_branches} lines monitored ({excluded_branches} without permanent limits)."
        
        if analysis_message:
            analysis_message += " " + info_msg
        else:
            analysis_message = info_msg

        yield {
            "type": "result",
            "pdf_path": str(shared_state["latest_pdf"]) if shared_state["latest_pdf"] else None,
            "actions": enriched_actions,
            "action_scores": action_scores,
            "lines_overloaded": sanitize_for_json(lines_overloaded),
            "message": analysis_message,
            "dc_fallback": dc_fallback_used
        }

    def _run_ac_with_fallback(self, network, params):
        import pypowsybl.loadflow as lf
        
        is_fast_mode = getattr(config, 'PYPOWSYBL_FAST_MODE', False)
        if is_fast_mode:
            fast_params = lf.Parameters.from_json(params.to_json())
            fast_params.transformer_voltage_control_on = False
            fast_params.shunt_compensator_voltage_control_on = False
            try:
                results = lf.run_ac(network, parameters=fast_params)
                if results and results[0].status == lf.ComponentStatus.CONVERGED:
                    return results
            except Exception as e:
                print(f"Warning: Fast mode AC load flow failed ({e}). Retrying in slow mode...")
                
        return lf.run_ac(network, parameters=params)

    def _get_base_network(self):
        """Load and return the base pypowsybl network from config path, caching it."""
        if self._base_network is not None:
            return self._base_network

        import pypowsybl as pp

        network_file = config.ENV_PATH / "grid.xiidm"
        if not network_file.exists():
            xiidm_files = list(config.ENV_PATH.glob("*.xiidm"))
            if xiidm_files:
                network_file = xiidm_files[0]
            else:
                raise FileNotFoundError(f"No .xiidm file found in {config.ENV_PATH}")
        
        self._base_network = pp.network.load(str(network_file))
        return self._base_network

    def _get_n_variant(self):
        """Return the variant ID for the N state, creating and simulating it if necessary."""
        n = self._get_base_network()
        variant_id = "N_state_cached"
        if variant_id not in n.get_variant_ids():
            original_variant = n.get_working_variant_id()
            n.clone_variant(original_variant, variant_id)
            n.set_working_variant(variant_id)
            params = create_olf_rte_parameter()
            self._run_ac_with_fallback(n, params)
            n.set_working_variant(original_variant)
        return variant_id

    def _get_n1_variant(self, contingency: str):
        """Return the variant ID for the N-1 state, creating and simulating it if necessary."""
        n = self._get_base_network()
        safe_cont = contingency.replace(" ", "_").replace("-", "_") if contingency else "none"
        variant_id = f"N_1_state_{safe_cont}"
        
        if variant_id not in n.get_variant_ids():
            original_variant = n.get_working_variant_id()
            n.clone_variant(original_variant, variant_id)
            n.set_working_variant(variant_id)
            if contingency:
                try:
                    n.disconnect(contingency)
                except Exception as e:
                    print(f"Failed to disconnect {contingency} for N-1 variant: {e}")
            params = create_olf_rte_parameter()
            self._run_ac_with_fallback(n, params)
            n.set_working_variant(original_variant)
        return variant_id

    def _get_simulation_env(self):
        """Return a SimulationEnvironment instance, caching it."""
        if self._simulation_env is not None:
            return self._simulation_env

        from expert_op4grid_recommender.pypowsybl_backend.simulation_env import SimulationEnvironment
        
        n = self._get_base_network()
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        
        # Initialize SimulationEnvironment with the pre-loaded network
        self._simulation_env = SimulationEnvironment(
            network=n,
            threshold_thermal_limit=monitoring_factor
        )
        return self._simulation_env

    def _get_monitoring_parameters(self, obs):
        """Get monitoring parameters (lines_we_care_about, branches_with_limits)."""
        # 1. Identify branches with permanent limits
        try:
            n_grid = obs._network_manager.network
            limits = n_grid.get_operational_limits()
            if not limits.empty:
                perm_limits = limits[(limits['type'] == 'CURRENT') & (limits['acceptable_duration'] == -1)]
                branches_with_limits = set(perm_limits['element_id'].unique())
            else:
                branches_with_limits = set()
        except Exception as e:
            print(f"Warning: Failed to identify branches with limits: {e}")
            branches_with_limits = set(obs.name_line)

        # 2. Get lines we care about from config
        if not getattr(config, 'IGNORE_LINES_MONITORING', True) and getattr(config, 'LINES_MONITORING_FILE', None):
            try:
                from expert_op4grid_recommender.environment import load_interesting_lines
                lines_we_care_about = list(load_interesting_lines(file_name=config.LINES_MONITORING_FILE))
            except Exception as e:
                print(f"Failed to load lines_we_care_about: {e}")
                lines_we_care_about = list(obs.name_line)
        else:
            lines_we_care_about = list(obs.name_line)

        return lines_we_care_about, branches_with_limits

    def _load_layout(self):
        """Load layout DataFrame from grid_layout.json if available."""
        import pandas as pd
        import json

        layout_file = config.ENV_PATH / "grid_layout.json"
        if layout_file.exists():
            try:
                with open(layout_file, 'r') as f:
                    layout_data = json.load(f)
                records = [{'id': k, 'x': v[0], 'y': v[1]} for k, v in layout_data.items()]
                return pd.DataFrame(records).set_index('id')
            except Exception as e:
                print(f"Warning: Could not load layout: {e}")
        return None

    def _default_nad_parameters(self):
        """Return default NadParameters for diagram generation."""
        from pypowsybl.network import NadParameters
        return NadParameters(
            edge_name_displayed=False,
            id_displayed=False,
            edge_info_along_edge=True,
            power_value_precision=1,
            angle_value_precision=0,
            current_value_precision=1,
            voltage_value_precision=0,
            bus_legend=True,
            substation_description_displayed=True
        )

    def _generate_diagram(self, network, voltage_level_ids=None, depth=0):
        """Generate NAD and return svg + metadata dict.

        Args:
            network: pypowsybl network object
            voltage_level_ids: list of VL IDs to center on (None = full grid)
            depth: number of hops from center VLs to include
        """
        from pypowsybl_jupyter.util import _get_svg_string, _get_svg_metadata

        df_layout = self._load_layout()
        npars = self._default_nad_parameters()

        kwargs = dict(nad_parameters=npars)
        if df_layout is not None:
            kwargs['fixed_positions'] = df_layout
        if voltage_level_ids is not None:
            kwargs['voltage_level_ids'] = voltage_level_ids
            kwargs['depth'] = depth

        diagram = network.get_network_area_diagram(**kwargs)

        return {
            "svg": _get_svg_string(diagram),
            "metadata": _get_svg_metadata(diagram),
        }

    def get_network_diagram(self, voltage_level_ids=None, depth=0):
        import pypowsybl as pp
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n_variant_id = self._get_n_variant()
        n.set_working_variant(n_variant_id)

        diagram = self._generate_diagram(n, voltage_level_ids=voltage_level_ids, depth=depth)
        diagram["lines_overloaded"] = self._get_overloaded_lines(n, lines_we_care_about=self._get_lines_we_care_about())
        # Cache N-state element currents for N-1 comparison
        self._n_state_currents = self._get_element_max_currents(n)
        
        n.set_working_variant(original_variant) # Restore original variant
        return diagram

    def get_n1_diagram(self, disconnected_element: str, voltage_level_ids=None, depth=0):
        import pypowsybl as pp

        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)

        # Check convergence — partial AC results are still better than DC
        # (DC only computes angles/power, not voltage magnitudes).
        # We need to re-run AC to get the results object for status
        params = create_olf_rte_parameter()
        results = self._run_ac_with_fallback(n, params)
        converged = any(r.status.name == 'CONVERGED' for r in results)
        lf_status = results[0].status.name if results else "UNKNOWN"
        if not converged:
            print(f"Warning: AC load flow did not converge for N-1 ({disconnected_element}): {lf_status}")

        diagram = self._generate_diagram(n, voltage_level_ids=voltage_level_ids, depth=depth)
        diagram["lf_converged"] = converged
        diagram["lf_status"] = lf_status

        # Include flow deltas vs base (N) state
        try:
            # IMPORTANT: Extract N-1 flows while N-1 variant is STILL ACTIVE on 'n'
            n1_flows = self._get_network_flows(n)
            n1_assets = self._get_asset_flows(n)

            n_base = self._get_base_network()
            original_variant_base = n_base.get_working_variant_id()
            n_variant_id_base = self._get_n_variant()
            n_base.set_working_variant(n_variant_id_base)

            base_flows = self._get_network_flows(n_base)
            base_assets = self._get_asset_flows(n_base)

            deltas = self._compute_deltas(n1_flows, base_flows, voltage_level_ids=voltage_level_ids)
            diagram["flow_deltas"] = deltas["flow_deltas"]
            diagram["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            diagram["asset_deltas"] = self._compute_asset_deltas(n1_assets, base_assets)
            
            n_base.set_working_variant(original_variant_base) # Restore original variant for base network
        except Exception as e:
            print(f"Warning: Failed to compute N-1 flow deltas: {e}")
            diagram["flow_deltas"] = {}
            diagram["reactive_flow_deltas"] = {}
            diagram["asset_deltas"] = {}

        # Exclude pre-existing overloads (already overloaded in N) unless worsened
        n_state_currents = getattr(self, '_n_state_currents', None)
        diagram["lines_overloaded"] = self._get_overloaded_lines(
            n, n_state_currents=n_state_currents, lines_we_care_about=self._get_lines_we_care_about()
        )
        
        n.set_working_variant(original_variant) # Restore original variant
        return diagram

    def get_action_variant_diagram(self, action_id, voltage_level_ids=None, depth=0, mode="network"):
        """Generate a NAD showing the network state after applying a remedial action.

        Uses the variant ID and network manager stored in the observation from
        the last analysis run to switch to the post-action network state
        directly, avoiding the need to replay disconnections on a fresh network.

        Args:
            action_id: ID of the action to visualize
            voltage_level_ids: list of VL IDs to center on (None = full grid)
            depth: number of hops from center VLs to include
            mode: "network" for bare NAD, "delta" to include flow deltas vs N-1
        """
        import pypowsybl as pp
        
        if not self._last_result or not self._last_result.get("prioritized_actions"):
            raise ValueError("No analysis result available. Run analysis first.")

        actions = self._last_result["prioritized_actions"]
        if action_id not in actions:
            raise ValueError(f"Action '{action_id}' not found in last analysis result.")

        obs = actions[action_id]["observation"]

        # Extract the variant ID and network manager from the observation
        variant_id = obs._variant_id
        nm = obs._network_manager

        # Switch to the action's variant which already contains the
        # post-action network state with load flow results
        nm.set_working_variant(variant_id)

        # Use the underlying pypowsybl network directly
        network = nm.network

        diagram = self._generate_diagram(network, voltage_level_ids=voltage_level_ids, depth=depth)
        diagram["action_id"] = action_id

        # Always include flow deltas so mode switching is instant on the frontend
        try:
            # Get Action flows
            action_flows = self._get_network_flows(network)
            action_assets = self._get_asset_flows(network)

            # Get N-1 flows (re-simulate contingency on a fresh network)
            n1_flows = self._get_n1_flows(self._last_disconnected_element)
            
            n1_network = self._get_base_network() # Need a network object to get assets
            original_variant_n1 = n1_network.get_working_variant_id()
            n1_variant_id_n1 = self._get_n1_variant(self._last_disconnected_element)
            n1_network.set_working_variant(n1_variant_id_n1)
            n1_assets = self._get_asset_flows(n1_network)
            n1_network.set_working_variant(original_variant_n1)

            deltas = self._compute_deltas(action_flows, n1_flows, voltage_level_ids=voltage_level_ids)
            diagram["flow_deltas"] = deltas["flow_deltas"]
            diagram["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            diagram["asset_deltas"] = self._compute_asset_deltas(action_assets, n1_assets)
        except Exception as e:
            print(f"Warning: Failed to compute flow deltas: {e}")
            diagram["flow_deltas"] = {}
            diagram["reactive_flow_deltas"] = {}
            diagram["asset_deltas"] = {}

        return diagram

    def get_action_variant_sld(self, action_id: str, voltage_level_id: str) -> dict:
        """Generate a Single Line Diagram (SLD) for a specific VL in the post-action state.

        Args:
            action_id: ID of the action to visualize
            voltage_level_id: ID of the voltage level to diagram
        """
        if not self._last_result or not self._last_result.get("prioritized_actions"):
            raise ValueError("No analysis result available. Run analysis first.")

        actions = self._last_result["prioritized_actions"]
        if action_id not in actions:
            raise ValueError(f"Action '{action_id}' not found in last analysis result.")

        # Get original action variant and the base N-1 variant 
        obs = actions[action_id]["observation"]
        action_variant_id = obs._variant_id
        nm = obs._network_manager
        
        # Switch to action variant to generate SLD and get flows
        nm.set_working_variant(action_variant_id)
        network = nm.network
        sld = network.get_single_line_diagram(voltage_level_id)
        svg, sld_metadata = self._extract_sld_svg_and_metadata(sld)
        
        result = {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "action_id": action_id,
            "voltage_level_id": voltage_level_id,
        }
        
        try:
            # We already have action flows from the network
            action_flows = self._get_network_flows(network)
            action_assets = self._get_asset_flows(network)
            
            # Switch back to N-1 variant to get reference flows for the deltas
            n1_flows = self._get_n1_flows(self._last_disconnected_element)
            
            n1_network = self._get_base_network()
            original_variant_n1 = n1_network.get_working_variant_id()
            n1_variant_id_n1 = self._get_n1_variant(self._last_disconnected_element)
            n1_network.set_working_variant(n1_variant_id_n1)
            n1_assets = self._get_asset_flows(n1_network)
            n1_network.set_working_variant(original_variant_n1)

            deltas = self._compute_deltas(action_flows, n1_flows, voltage_level_ids=[voltage_level_id])
            result["flow_deltas"] = deltas["flow_deltas"]
            result["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            result["asset_deltas"] = self._compute_asset_deltas(action_assets, n1_assets)
        except Exception as e:
            print(f"Warning: Failed to compute SLD flow deltas for manual action: {e}")
            result["flow_deltas"] = {}
            result["reactive_flow_deltas"] = {}
            result["asset_deltas"] = {}
            
        return result

    def get_n_sld(self, voltage_level_id: str) -> dict:
        """Generate a Single Line Diagram (SLD) in the base N state."""
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n_variant_id = self._get_n_variant()
        n.set_working_variant(n_variant_id)

        sld = n.get_single_line_diagram(voltage_level_id)
        svg, sld_metadata = self._extract_sld_svg_and_metadata(sld)

        n.set_working_variant(original_variant) # Restore original variant
        return {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "voltage_level_id": voltage_level_id,
        }

    def get_n1_sld(self, disconnected_element: str, voltage_level_id: str) -> dict:
        """Generate a Single Line Diagram (SLD) in the N-1 state."""
        n = self._get_base_network()
        original_variant = n.get_working_variant_id()
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)

        sld = n.get_single_line_diagram(voltage_level_id)
        svg, sld_metadata = self._extract_sld_svg_and_metadata(sld)

        result = {
            "svg": svg,
            "sld_metadata": sld_metadata,
            "voltage_level_id": voltage_level_id,
            "disconnected_element": disconnected_element
        }
        
        try:
            # IMPORTANT: Extract N-1 flows while N-1 variant is STILL ACTIVE on 'n'
            n1_flows = self._get_network_flows(n)
            n1_assets = self._get_asset_flows(n)

            n_base = self._get_base_network()
            original_variant_base = n_base.get_working_variant_id()
            n_variant_id_base = self._get_n_variant()
            n_base.set_working_variant(n_variant_id_base)

            base_flows = self._get_network_flows(n_base)
            base_assets = self._get_asset_flows(n_base)

            deltas = self._compute_deltas(n1_flows, base_flows, voltage_level_ids=[voltage_level_id])
            result["flow_deltas"] = deltas["flow_deltas"]
            result["reactive_flow_deltas"] = deltas["reactive_flow_deltas"]
            result["asset_deltas"] = self._compute_asset_deltas(n1_assets, base_assets)
            
            n_base.set_working_variant(original_variant_base) # Restore original variant for base network
        except Exception as e:
            print(f"Warning: Failed to compute SLD flow deltas for N-1: {e}")
            result["flow_deltas"] = {}
            result["reactive_flow_deltas"] = {}
            result["asset_deltas"] = {}

        n.set_working_variant(original_variant) # Restore original variant
        return result

    @staticmethod
    def _extract_sld_svg_and_metadata(sld) -> tuple:
        """Extract SVG string and metadata JSON from a pypowsybl SLD diagram object.

        Returns (svg_str, metadata_str_or_None).
        The metadata JSON contains 'feederNodes' with {id, equipmentId} entries
        that map SVG element IDs back to network equipment IDs.
        """
        try:
            from pypowsybl_jupyter.util import _get_svg_string, _get_svg_metadata
            svg = _get_svg_string(sld)
            metadata = _get_svg_metadata(sld)
        except Exception:
            try:
                svg = sld._repr_svg_()
            except Exception:
                svg = str(sld)
            metadata = getattr(sld, '_metadata', None)
        return svg, metadata

    def _get_lines_we_care_about(self):
        """Return the set of monitored line IDs, or None if all lines are monitored."""
        if not getattr(config, 'IGNORE_LINES_MONITORING', True) and getattr(config, 'LINES_MONITORING_FILE', None):
            try:
                from expert_op4grid_recommender.data_loader import load_interesting_lines
                return set(load_interesting_lines(file_name=config.LINES_MONITORING_FILE))
            except Exception as e:
                print(f"Warning: Failed to load lines_we_care_about: {e}")
        return None

    def _get_overloaded_lines(self, network, n_state_currents=None, lines_we_care_about=None):
        """Get overloaded lines and transformers.

        Args:
            network: pypowsybl network after load flow.
            n_state_currents: If provided, dict {element_id: max_i_N} from the
                N-state.  Pre-existing overloads (elements also overloaded in N)
                are excluded unless their current increased by more than the
                worsening threshold.
            lines_we_care_about: If provided, set of element IDs to monitor.
                Only these elements are checked for overloads.
        """
        import numpy as np
        limits = network.get_operational_limits()
        if limits.empty:
            limit_dict = {}
        else:
            limits = limits.reset_index()
            current_limits = limits[(limits['type'] == 'CURRENT') & (limits['acceptable_duration'] == -1)]
            limit_dict = dict(zip(current_limits['element_id'], current_limits['value']))
        
        overloaded = []
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        worsening_threshold = getattr(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02)
        default_limit = 9999.0  # Same default as the recommender

        # Check both lines and 2-winding transformers
        for df in [network.get_lines()[['i1', 'i2']], network.get_2_windings_transformers()[['i1', 'i2']]]:
            for element_id, row in df.iterrows():
                # Skip elements not in the monitored set
                if lines_we_care_about is not None and element_id not in lines_we_care_about:
                    continue
                
                limit = limit_dict.get(element_id)
                if limit is None:
                    # No permanent limit found for this branch, skip monitoring
                    continue
                    
                i1 = row['i1']
                i2 = row['i2']
                if not np.isnan(i1) and not np.isnan(i2):
                    max_i = max(abs(i1), abs(i2))
                    if max_i > limit * monitoring_factor:
                        # If N-state currents provided, filter pre-existing overloads
                        if n_state_currents is not None and element_id in n_state_currents:
                            n_max_i = n_state_currents[element_id]
                            if n_max_i > limit * monitoring_factor:
                                # Was already overloaded in N — only keep if worsened
                                if max_i <= n_max_i * (1 + worsening_threshold):
                                    continue
                        overloaded.append(element_id)
        return sanitize_for_json(overloaded)

    def _get_element_max_currents(self, network):
        """Return {element_id: max(|i1|, |i2|)} for all lines and transformers."""
        import numpy as np
        currents = {}
        for df in [network.get_lines()[['i1', 'i2']], network.get_2_windings_transformers()[['i1', 'i2']]]:
            for element_id, row in df.iterrows():
                i1, i2 = row['i1'], row['i2']
                if not np.isnan(i1) and not np.isnan(i2):
                    currents[element_id] = max(abs(i1), abs(i2))
        return currents

    def _get_n1_flows(self, contingency: str) -> dict:
        """Retrieve the branch flows of the network in the N-1 state using a cached variant."""
        n = self._get_base_network()
        var_id = self._get_n1_variant(contingency)
        original_variant = n.get_working_variant_id()
        
        n.set_working_variant(var_id)
        flows = self._get_network_flows(n)
        n.set_working_variant(original_variant)
        return flows

    def _get_network_flows(self, network):
        """Extract p1/p2 and q1/q2 flows for lines and transformers from a simulated network.

        Also extracts voltage_level1_id and voltage_level2_id so the frontend
        can determine which terminal corresponds to the SLD voltage level.
        """
        import numpy as np

        lines = network.get_lines()[['p1', 'p2', 'q1', 'q2', 'voltage_level1_id', 'voltage_level2_id']]
        trafos = network.get_2_windings_transformers()[['p1', 'p2', 'q1', 'q2', 'voltage_level1_id', 'voltage_level2_id']]

        p1 = {}
        p2 = {}
        q1 = {}
        q2 = {}
        vl1 = {}
        vl2 = {}
        for lid in lines.index:
            p1[lid] = lines.loc[lid, 'p1'] if not np.isnan(lines.loc[lid, 'p1']) else 0.0
            p2[lid] = lines.loc[lid, 'p2'] if not np.isnan(lines.loc[lid, 'p2']) else 0.0
            q1[lid] = lines.loc[lid, 'q1'] if not np.isnan(lines.loc[lid, 'q1']) else 0.0
            q2[lid] = lines.loc[lid, 'q2'] if not np.isnan(lines.loc[lid, 'q2']) else 0.0
            vl1[lid] = lines.loc[lid, 'voltage_level1_id']
            vl2[lid] = lines.loc[lid, 'voltage_level2_id']
        for tid in trafos.index:
            p1[tid] = trafos.loc[tid, 'p1'] if not np.isnan(trafos.loc[tid, 'p1']) else 0.0
            p2[tid] = trafos.loc[tid, 'p2'] if not np.isnan(trafos.loc[tid, 'p2']) else 0.0
            q1[tid] = trafos.loc[tid, 'q1'] if not np.isnan(trafos.loc[tid, 'q1']) else 0.0
            q2[tid] = trafos.loc[tid, 'q2'] if not np.isnan(trafos.loc[tid, 'q2']) else 0.0
            vl1[tid] = trafos.loc[tid, 'voltage_level1_id']
            vl2[tid] = trafos.loc[tid, 'voltage_level2_id']

        return {"p1": p1, "p2": p2, "q1": q1, "q2": q2, "vl1": vl1, "vl2": vl2}

    def _get_asset_flows(self, network):
        """Extract p/q flows for loads and generators from a simulated network."""
        import numpy as np

        loads = network.get_loads()[['p', 'q']]
        gens = network.get_generators()[['p', 'q']]

        flows = {}
        for lid in loads.index:
            pv = loads.loc[lid, 'p'] if not np.isnan(loads.loc[lid, 'p']) else 0.0
            qv = loads.loc[lid, 'q'] if not np.isnan(loads.loc[lid, 'q']) else 0.0
            flows[lid] = {"p": pv, "q": qv}
        for gid in gens.index:
            pv = gens.loc[gid, 'p'] if not np.isnan(gens.loc[gid, 'p']) else 0.0
            qv = gens.loc[gid, 'q'] if not np.isnan(gens.loc[gid, 'q']) else 0.0
            flows[gid] = {"p": pv, "q": qv}

        return flows

    @staticmethod
    def _terminal_aware_delta(after_val, before_val):
        """Compute a direction-aware delta at a single observed terminal.

        pypowsybl sign convention: positive = power *enters* at that terminal.

        Algorithm:
          1. Take absolute values of both states at the observed terminal.
          2. Reference direction = sign (direction) of the state with the
             strongest absolute value.
          3. Transform each value to match the reference direction:
             +abs(val) if same direction as reference, -abs(val) if opposite.
          4. delta = transformed_after - transformed_before.
          5. flip_arrow = True when the reference is the before state AND
             the two states have different signs (direction reversed).

        The delta sign is consistent with the category colour:
          positive (orange) = flow increased
          negative (blue)   = flow decreased

        Returns (delta: float, flip_arrow: bool).
        """
        abs_after = abs(after_val)
        abs_before = abs(before_val)

        # Reference: the state with the strongest absolute value
        if abs_after >= abs_before:
            ref_positive = (after_val >= 0)
            ref_is_before = False
        else:
            ref_positive = (before_val >= 0)
            ref_is_before = True

        # Transform: +abs if same direction as reference, -abs if opposite
        def _signed(val):
            if val == 0:
                return 0.0
            same_dir = (val > 0) == ref_positive
            return abs(val) if same_dir else -abs(val)

        delta = _signed(after_val) - _signed(before_val)

        # flip_arrow when the Action SVG visual arrow (which points based on after_val's sign)
        # is geometrically opposite to the Reference state visual arrow (which points based on ref_positive).
        # Since pypowsybl draws IN/OUT based purely on positive/negative value:
        after_positive = (after_val >= 0)
        flip_arrow = bool(after_positive != ref_positive)

        return delta, flip_arrow

    @staticmethod
    def _select_terminal_for_branch(lid, avl1, avl2, bvl1, bvl2, vl_set):
        """Select which terminal (1 or 2) to observe for a given branch.

        Picks the terminal whose voltage level is in the requested set.
        Falls back to terminal 1 when both or neither match.
        """
        if not vl_set:
            return 1
        v1 = avl1.get(lid) or bvl1.get(lid)
        v2 = avl2.get(lid) or bvl2.get(lid)
        if v1 in vl_set and v2 not in vl_set:
            return 1
        if v2 in vl_set and v1 not in vl_set:
            return 2
        return 1

    @staticmethod
    def _apply_threshold(deltas):
        """Categorise raw deltas using a 5 % threshold of the max absolute delta.

        Returns {id: {delta, category}}.
        """
        if deltas:
            max_abs = max(abs(d) for d in deltas.values())
        else:
            max_abs = 0.0
        threshold = max_abs * 0.05

        result = {}
        for lid, delta in deltas.items():
            if abs(delta) < threshold:
                cat = "grey"
            elif delta > 0:
                cat = "positive"
            else:
                cat = "negative"
            result[lid] = {"delta": round(float(delta), 1), "category": cat}
        return result

    def _compute_deltas(self, after_flows, before_flows, voltage_level_ids=None):
        """Compute per-line active AND reactive flow deltas between two flow sets.

        Terminal-aware computation: for each branch, selects the terminal
        whose voltage level matches one of *voltage_level_ids* (the VLs
        displayed in the diagram).  P and Q deltas are computed
        **independently** using ``_terminal_aware_delta`` on the selected
        terminal's values.

        Algorithm per branch per variable:
          1. Pick the terminal at the observed voltage level.
          2. Get the value at that terminal in both states; take abs.
          3. Reference direction = direction of the state with the
             strongest absolute value.
          4. Transform each value to match the reference direction.
          5. delta = transformed_after - transformed_before.

        Category is based solely on the active-power (P) delta:
          positive (orange) = flow increased
          negative (blue)   = flow decreased
          grey = insignificant (< 5 % of max |deltaP|)

        Returns a dict with keys:
            flow_deltas:          {line_id: {delta, category, flip_arrow}}
            reactive_flow_deltas: {line_id: {delta, category, flip_arrow}}
        """
        ap1, ap2 = after_flows["p1"], after_flows["p2"]
        bp1, bp2 = before_flows["p1"], before_flows["p2"]
        aq1, aq2 = after_flows["q1"], after_flows["q2"]
        bq1, bq2 = before_flows["q1"], before_flows["q2"]

        # VL info for terminal selection (topology doesn't change between states)
        avl1 = after_flows.get("vl1", {})
        avl2 = after_flows.get("vl2", {})
        bvl1 = before_flows.get("vl1", {})
        bvl2 = before_flows.get("vl2", {})
        vl_set = set(voltage_level_ids) if voltage_level_ids else set()

        all_ids = set(ap1.keys()) | set(bp1.keys())

        p_delta_map = {}
        p_flip_map = {}
        q_delta_map = {}
        q_flip_map = {}

        for lid in all_ids:
            # Select which terminal to observe for this branch
            terminal = self._select_terminal_for_branch(
                lid, avl1, avl2, bvl1, bvl2, vl_set
            )

            if terminal == 1:
                a_p = ap1.get(lid, 0.0)
                b_p = bp1.get(lid, 0.0)
                a_q = aq1.get(lid, 0.0)
                b_q = bq1.get(lid, 0.0)
            else:
                a_p = ap2.get(lid, 0.0)
                b_p = bp2.get(lid, 0.0)
                a_q = aq2.get(lid, 0.0)
                b_q = bq2.get(lid, 0.0)

            # P: terminal-aware delta with its own reference direction
            pd, pf = self._terminal_aware_delta(a_p, b_p)
            p_delta_map[lid] = pd
            p_flip_map[lid] = pf

            # Q: terminal-aware delta with its OWN independent reference direction
            qd, qf = self._terminal_aware_delta(a_q, b_q)
            q_delta_map[lid] = qd
            q_flip_map[lid] = qf

        # Category threshold based on P deltas
        if p_delta_map:
            max_abs = max(abs(d) for d in p_delta_map.values())
        else:
            max_abs = 0.0
        threshold = max_abs * 0.05

        flow_deltas = {}
        reactive_flow_deltas = {}
        for lid in all_ids:
            d = p_delta_map[lid]
            if max_abs == 0.0 or abs(d) < threshold:
                cat = "grey"
            elif d > 0:
                cat = "positive"
            else:
                cat = "negative"
            flow_deltas[lid] = {
                "delta": round(float(p_delta_map[lid]), 1),
                "category": cat,
                "flip_arrow": p_flip_map[lid],
            }
            reactive_flow_deltas[lid] = {
                "delta": round(float(q_delta_map[lid]), 1),
                "category": cat,
                "flip_arrow": q_flip_map[lid],
            }

        return {
            "flow_deltas": flow_deltas,
            "reactive_flow_deltas": reactive_flow_deltas,
        }

    def _compute_asset_deltas(self, after_asset_flows, before_asset_flows):
        """Compute delta P and Q for loads and generators.

        Returns {asset_id: {delta_p, delta_q, category}}.
        Category is based on active power delta only.
        """
        all_ids = set(after_asset_flows.keys()) | set(before_asset_flows.keys())
        raw_p = {}
        raw_q = {}
        for aid in all_ids:
            a = after_asset_flows.get(aid, {"p": 0.0, "q": 0.0})
            b = before_asset_flows.get(aid, {"p": 0.0, "q": 0.0})
            raw_p[aid] = a["p"] - b["p"]
            raw_q[aid] = a["q"] - b["q"]

        # Threshold based on active power deltas
        if raw_p:
            max_abs = max(abs(d) for d in raw_p.values())
        else:
            max_abs = 0.0
        threshold = max_abs * 0.05

        result = {}
        for aid in all_ids:
            dp = raw_p[aid]
            dq = raw_q[aid]
            if max_abs == 0.0 or abs(dp) < threshold:
                cat = "grey"
            elif dp > 0:
                cat = "positive"
            else:
                cat = "negative"
            result[aid] = {
                "delta_p": round(float(dp), 1),
                "delta_q": round(float(dq), 1),
                "category": cat,
            }
        return result

    def get_all_action_ids(self):
        """Return a list of {id, description, type} for every action in the loaded dictionary."""
        if not self._dict_action:
            raise ValueError("No action dictionary loaded. Load a config first.")
        
        from expert_op4grid_recommender.action_evaluation.classifier import ActionClassifier
        classifier = ActionClassifier()
        
        result = []
        for action_id, action_desc in self._dict_action.items():
            result.append({
                "id": action_id,
                "description": action_desc.get("description_unitaire",
                                               action_desc.get("description", "")),
                "type": classifier.identify_action_type(action_desc)
            })
        return result

    def simulate_manual_action(self, action_id: str, disconnected_element: str):
        """Simulate a single action from the loaded dictionary and return its impact.

        Reuses the network variants from the last analysis when possible.
        Starting from the converged N-1 state for faster and more consistent results.
        """
        if not self._dict_action:
            raise ValueError("No action dictionary loaded. Load a config first.")
        if action_id not in self._dict_action:
            raise ValueError(f"Action '{action_id}' not found in the loaded action dictionary.")

        action_desc = self._dict_action[action_id]

        # Use cached environment
        env = self._get_simulation_env()
        nm = env.network_manager
        n = nm.network
        
        # Get base observation (N state)
        original_variant = n.get_working_variant_id()
        n_variant_id = self._get_n_variant()
        n.set_working_variant(n_variant_id)
        obs = env.get_obs()
        
        # Get N-1 observation (contingency state)
        n1_variant_id = self._get_n1_variant(disconnected_element)
        n.set_working_variant(n1_variant_id)
        obs_simu_defaut = env.get_obs()
        
        # Get monitoring parameters and filtering logic
        lines_we_care_about, branches_with_limits = self._get_monitoring_parameters(obs_simu_defaut)
        monitoring_factor = getattr(config, 'MONITORING_FACTOR_THERMAL_LIMITS', 0.95)
        worsening_threshold = getattr(config, 'PRE_EXISTING_OVERLOAD_WORSENING_THRESHOLD', 0.02)
        
        lines_overloaded_ids = []
        for i, l in enumerate(obs_simu_defaut.name_line):
            if l not in lines_we_care_about:
                continue
            if l not in branches_with_limits:
                continue
            if obs_simu_defaut.rho[i] < monitoring_factor:
                continue
            # Exclude pre-existing N overloads unless worsened
            if obs.rho[i] >= monitoring_factor:
                if obs_simu_defaut.rho[i] <= obs.rho[i] * (1 + worsening_threshold):
                    continue
            lines_overloaded_ids.append(i)
        lines_overloaded_names = [obs_simu_defaut.name_line[i] for i in lines_overloaded_ids]

        # Build the action object
        try:
            action = env.action_space(action_desc["content"])
        except Exception as e:
            raise ValueError(f"Could not create action from description: {e}")

        # Simulate action starting from the N-1 converged state
        actual_fast_mode = getattr(config, 'PYPOWSYBL_FAST_MODE', False)
        obs_simu_action, _, _, info_action = obs_simu_defaut.simulate(
            action,
            time_step=0,
            keep_variant=True,
            fast_mode=actual_fast_mode
        )

        n.set_working_variant(original_variant) # Restore variant

        # Post-process results
        description_unitaire = action_desc.get(
            "description_unitaire", action_desc.get("description", "No description")
        )
        
        rho_before = (obs_simu_defaut.rho[lines_overloaded_ids] * monitoring_factor).tolist() if lines_overloaded_ids else []
        rho_after = None
        max_rho = 0.0
        max_rho_line = "N/A"
        is_rho_reduction = False

        if not info_action["exception"]:
            rho_after = (obs_simu_action.rho[lines_overloaded_ids] * monitoring_factor).tolist()
            if rho_before:
                is_rho_reduction = bool(np.all(np.array(rho_after) + 0.01 < np.array(rho_before)))
            
            # Re-fetch care_mask for max_rho computation
            care_mask = np.isin(obs_simu_action.name_line, lines_we_care_about)
            for i in range(len(obs_simu_action.name_line)):
                l = obs_simu_action.name_line[i]
                if care_mask[i]:
                    if l not in branches_with_limits:
                        care_mask[i] = False
                    elif obs.rho[i] >= monitoring_factor:
                        if obs_simu_action.rho[i] <= obs.rho[i] * (1 + worsening_threshold):
                            care_mask[i] = False
            
            if np.any(care_mask):
                rhos_of_interest = obs_simu_action.rho[care_mask] * monitoring_factor
                max_rho = float(np.max(rhos_of_interest))
                valid_line_names = np.array(obs_simu_action.name_line)[care_mask]
                max_rho_line = valid_line_names[np.argmax(rhos_of_interest)]

        # Store the observation so get_action_variant_diagram can generate the NAD
        if not info_action["exception"] and obs_simu_action is not None:
            if self._last_result is None:
                self._last_result = {"prioritized_actions": {}}
            if "prioritized_actions" not in self._last_result:
                self._last_result["prioritized_actions"] = {}
            
            # Fetch topo
            topo = {}
            for field in ("lines_ex_bus", "lines_or_bus", "gens_bus", "loads_bus"):
                val = getattr(action, field, None)
                topo[field] = sanitize_for_json(val) if val else {}

            self._last_result["prioritized_actions"][action_id] = {
                "observation": obs_simu_action,
                "description_unitaire": description_unitaire,
                "action": action,
                "action_topology": topo,
                "rho_before": rho_before,
                "rho_after": rho_after,
                "max_rho": max_rho,
                "max_rho_line": max_rho_line,
                "is_rho_reduction": is_rho_reduction
            }

        return {
            "action_id": action_id,
            "description_unitaire": description_unitaire,
            "rho_before": sanitize_for_json(rho_before),
            "rho_after": sanitize_for_json(rho_after),
            "max_rho": sanitize_for_json(max_rho),
            "max_rho_line": max_rho_line,
            "is_rho_reduction": is_rho_reduction,
            "lines_overloaded": sanitize_for_json(lines_overloaded_names),
        }

recommender_service = RecommenderService()
