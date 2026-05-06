// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import axios from 'axios';
import type { ConfigRequest, BranchResponse, DiagramData, DiagramPatch, FlowDelta, AssetDelta, AvailableAction, SessionResult } from './types';

const API_BASE_URL = 'http://127.0.0.1:8000';

export interface UserConfig {
    network_path: string;
    action_file_path: string;
    layout_path: string;
    output_folder_path: string;
    lines_monitoring_path: string;
    min_line_reconnections: number;
    min_close_coupling: number;
    min_open_coupling: number;
    min_line_disconnections: number;
    min_pst: number;
    min_load_shedding: number;
    min_renewable_curtailment_actions: number;
    n_prioritized_actions: number;
    monitoring_factor: number;
    pre_existing_overload_threshold: number;
    ignore_reconnections: boolean;
    pypowsybl_fast_mode: boolean;
}

export const api = {
    getUserConfig: async (): Promise<UserConfig> => {
        const response = await axios.get<UserConfig>(`${API_BASE_URL}/api/user-config`);
        return response.data;
    },
    saveUserConfig: async (config: UserConfig): Promise<void> => {
        await axios.post(`${API_BASE_URL}/api/user-config`, config);
    },
    getConfigFilePath: async (): Promise<string> => {
        const response = await axios.get<{ config_file_path: string }>(`${API_BASE_URL}/api/config-file-path`);
        return response.data.config_file_path;
    },
    setConfigFilePath: async (path: string): Promise<{ config_file_path: string; config: UserConfig }> => {
        const response = await axios.post<{ status: string; config_file_path: string; config: UserConfig }>(
            `${API_BASE_URL}/api/config-file-path`, { path }
        );
        return response.data;
    },
    updateConfig: async (config: ConfigRequest) => {
        const response = await axios.post(`${API_BASE_URL}/api/config`, config);
        return response.data;
    },
    getBranches: async () => {
        const response = await axios.get<BranchResponse>(`${API_BASE_URL}/api/branches`);
        return response.data;
    },
    getVoltageLevels: async (): Promise<{ voltage_levels: string[]; name_map?: Record<string, string> }> => {
        const response = await axios.get<{ voltage_levels: string[]; name_map?: Record<string, string> }>(`${API_BASE_URL}/api/voltage-levels`);
        return response.data;
    },
    getNominalVoltages: async (): Promise<{ mapping: Record<string, number>; unique_kv: number[] }> => {
        const response = await axios.get<{ mapping: Record<string, number>; unique_kv: number[] }>(
            `${API_BASE_URL}/api/nominal-voltages`
        );
        return response.data;
    },
    /**
     * Return ``{vl_id: substation_id}`` for every voltage level.
     * Used to anchor action-overview pins on the overflow graph
     * (which uses substation names as node identifiers).
     */
    getVoltageLevelSubstations: async (): Promise<{ mapping: Record<string, string> }> => {
        const response = await axios.get<{ mapping: Record<string, string> }>(
            `${API_BASE_URL}/api/voltage-level-substations`
        );
        return response.data;
    },
    // NOTE: the FastAPI backend always serialises the SVG as a raw
    // XML string, so these axios methods narrow `DiagramData.svg` to
    // `string` at the boundary. The wider `string | SVGSVGElement`
    // union on `DiagramData` only surfaces once the N-1 / Action tab
    // is repopulated by the svgPatch DOM-recycling path.
    getNetworkDiagram: async (): Promise<DiagramData & { svg: string }> => {
        // Fetch in `format=text` mode: the server returns a small JSON
        // header on the first line, then the raw SVG body verbatim. This
        // avoids `JSON.parse` having to escape-scan and copy the ~25 MB
        // SVG string, saving ~500 ms of main-thread parse time on large
        // grids. See docs/performance/history/loading-parallel.md (#4). We use `fetch`
        // instead of axios so the browser's native gzip decoder runs
        // without axios trying to JSON-parse the body.
        const res = await fetch(`${API_BASE_URL}/api/network-diagram?format=text`);
        if (!res.ok) {
            const detail = await res.text().catch(() => '');
            const err = new Error(`HTTP ${res.status}: ${detail || res.statusText}`) as Error & { response?: unknown };
            err.response = { status: res.status, data: { detail } };
            throw err;
        }
        const body = await res.text();
        const nl = body.indexOf('\n');
        if (nl < 0) {
            throw new Error('Invalid /api/network-diagram response: missing header/body separator');
        }
        const header = JSON.parse(body.slice(0, nl)) as Omit<DiagramData, 'svg'>;
        const svg = body.slice(nl + 1);
        return { ...header, svg } as DiagramData & { svg: string };
    },
    getContingencyDiagram: async (disconnectedElements: string[]): Promise<DiagramData & { svg: string }> => {
        const response = await axios.post<DiagramData & { svg: string }>(
            `${API_BASE_URL}/api/contingency-diagram`,
            { disconnected_elements: disconnectedElements }
        );
        return response.data;
    },
    getActionVariantDiagram: async (actionId: string): Promise<DiagramData & { svg: string }> => {
        const response = await axios.post<DiagramData & { svg: string }>(
            `${API_BASE_URL}/api/action-variant-diagram`,
            { action_id: actionId }
        );
        return response.data;
    },
    /**
     * SVG-less patch payload for the contingency state. Use to patch a
     * clone of the N-state SVG DOM instead of fetching a fresh ~20 MB
     * NAD. Fall back to ``getContingencyDiagram`` on any error or when
     * the base N SVG is not yet loaded. See
     * ``docs/performance/history/svg-dom-recycling.md``.
     */
    getContingencyDiagramPatch: async (disconnectedElements: string[]): Promise<DiagramPatch> => {
        const response = await axios.post<DiagramPatch>(
            `${API_BASE_URL}/api/contingency-diagram-patch`,
            { disconnected_elements: disconnectedElements }
        );
        return response.data;
    },
    /**
     * SVG-less patch payload for a post-action state. Returns
     * `{patchable: false, reason}` for topology-changing actions (switch
     * toggles, line reconnections, VL-internal topology changes); the
     * caller must then fall back to `getActionVariantDiagram`.
     */
    getActionVariantDiagramPatch: async (actionId: string): Promise<DiagramPatch> => {
        const response = await axios.post<DiagramPatch>(
            `${API_BASE_URL}/api/action-variant-diagram-patch`,
            { action_id: actionId }
        );
        return response.data;
    },
    getAvailableActions: async (): Promise<AvailableAction[]> => {
        const response = await axios.get<{ actions: AvailableAction[] }>(
            `${API_BASE_URL}/api/actions`
        );
        return response.data.actions;
    },
    simulateManualAction: async (actionId: string, disconnectedElements: string[], actionContent?: Record<string, unknown> | null, linesOverloaded?: string[] | null, targetMw?: number | null, targetTap?: number | null): Promise<{
        action_id: string;
        description_unitaire: string;
        rho_before: number[] | null;
        rho_after: number[] | null;
        max_rho: number | null;
        max_rho_line: string;
        is_rho_reduction: boolean;
        is_islanded?: boolean;
        n_components?: number;
        disconnected_mw?: number;
        non_convergence: string | null;
        lines_overloaded: string[];
        lines_overloaded_after?: string[];
        action_topology?: import('./types').ActionTopology;
        load_shedding_details?: import('./types').LoadSheddingDetail[];
        curtailment_details?: import('./types').CurtailmentDetail[];
        pst_details?: import('./types').PstDetail[];
    }> => {

        const response = await axios.post(
            `${API_BASE_URL}/api/simulate-manual-action`,
            { action_id: actionId, disconnected_elements: disconnectedElements, action_content: actionContent ?? null, lines_overloaded: linesOverloaded ?? null, target_mw: targetMw ?? null, target_tap: targetTap ?? null }
        );
        return response.data;
    },
    computeSuperposition: async (action1_id: string, action2_id: string, disconnectedElements: string[]): Promise<import('./types').CombinedAction> => {
        const response = await axios.post(
            `${API_BASE_URL}/api/compute-superposition`,
            { action1_id, action2_id, disconnected_elements: disconnectedElements }
        );
        return response.data;
    },
    regenerateOverflowGraph: async (mode: 'hierarchical' | 'geo'): Promise<{
        pdf_url: string | null;
        pdf_path: string | null;
        mode: string;
        cached: boolean;
    }> => {
        const response = await axios.post<{
            pdf_url: string | null;
            pdf_path: string | null;
            mode: string;
            cached: boolean;
        }>(`${API_BASE_URL}/api/regenerate-overflow-graph`, { mode });
        return response.data;
    },
    pickPath: async (type: 'file' | 'dir'): Promise<string | null> => {
        const response = await axios.get<{ path: string | null; error?: string }>(
            `${API_BASE_URL}/api/pick-path?type=${type}`
        );
        // Backend returns {"path": "", "error": "..."} when the native dialog
        // cannot be launched (e.g. no display, tkinter missing). Surface it
        // so the caller can show the user why nothing happened.
        if (response.data.error) {
            throw new Error(response.data.error);
        }
        return response.data.path;
    },
    saveSession: async (params: {
        session_name: string;
        json_content: string;
        pdf_path: string | null;
        output_folder_path: string;
        interaction_log?: string;
    }): Promise<{ session_folder: string; pdf_copied: boolean }> => {
        const response = await axios.post<{ session_folder: string; pdf_copied: boolean }>(
            `${API_BASE_URL}/api/save-session`,
            params
        );
        return response.data;
    },
    getNSld: async (voltageLevelId: string): Promise<{ svg: string; sld_metadata: string | null; voltage_level_id: string }> => {
        const response = await axios.post<{ svg: string; sld_metadata: string | null; voltage_level_id: string }>(
            `${API_BASE_URL}/api/n-sld`,
            { voltage_level_id: voltageLevelId }
        );
        return response.data;
    },
    getContingencySld: async (disconnectedElements: string[], voltageLevelId: string): Promise<{ svg: string; sld_metadata: string | null; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta> }> => {
        const response = await axios.post<{ svg: string; sld_metadata: string | null; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta> }>(
            `${API_BASE_URL}/api/contingency-sld`,
            { disconnected_elements: disconnectedElements, voltage_level_id: voltageLevelId }
        );
        return response.data;
    },
    getActionVariantSld: async (actionId: string, voltageLevelId: string): Promise<{ svg: string; sld_metadata: string | null; action_id: string; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta>; changed_switches?: Record<string, { from_open: boolean; to_open: boolean }> }> => {
        const response = await axios.post<{ svg: string; sld_metadata: string | null; action_id: string; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta>; changed_switches?: Record<string, { from_open: boolean; to_open: boolean }> }>(
            `${API_BASE_URL}/api/action-variant-sld`,
            { action_id: actionId, voltage_level_id: voltageLevelId }
        );
        return response.data;
    },
    listSessions: async (folderPath: string): Promise<{ sessions: string[] }> => {
        const response = await axios.get<{ sessions: string[] }>(
            `${API_BASE_URL}/api/list-sessions`,
            { params: { folder_path: folderPath } }
        );
        return response.data;
    },
    loadSession: async (folderPath: string, sessionName: string): Promise<SessionResult> => {
        const response = await axios.post<SessionResult>(
            `${API_BASE_URL}/api/load-session`,
            { folder_path: folderPath, session_name: sessionName }
        );
        return response.data;
    },
    /**
     * Re-pushes the monitored-line set and computed-pair cache captured in a saved
     * session back into the backend so that any subsequent simulate-action call uses
     * the SAME `lines_we_care_about` policy as the original study — instead of the
     * backend's default (all lines, or the lines-monitoring file on disk). Called
     * from `useSession::handleRestoreSession` right after the base-study XHRs
     * complete, before the user can kick off a new simulation.
     *
     * Parity with `standalone_interface.html:3857`.
     */
    restoreAnalysisContext: async (params: {
        lines_we_care_about?: string[] | null;
        disconnected_elements?: string[] | null;
        lines_overloaded?: string[] | null;
        computed_pairs?: Record<string, unknown> | null;
    }): Promise<{ status: string; lines_we_care_about_count: number; computed_pairs_count: number }> => {
        const response = await axios.post(`${API_BASE_URL}/api/restore-analysis-context`, params);
        return response.data;
    },
    runAnalysisStep1: async (disconnectedElements: string[]): Promise<{ lines_overloaded: string[]; message: string; can_proceed: boolean }> => {
        const response = await axios.post(`${API_BASE_URL}/api/run-analysis-step1`, { disconnected_elements: disconnectedElements });
        return response.data;
    },
    runAnalysisStep2Stream: async (params: {
        selected_overloads: string[];
        all_overloads: string[];
        monitor_deselected: boolean;
    }): Promise<Response> => {
        const response = await fetch(`${API_BASE_URL}/api/run-analysis-step2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(params),
        });
        if (!response.ok) {
            throw new Error(`Analysis Resolution failed: ${response.statusText}`);
        }
        return response;
    },
    /**
     * Combined manual-action simulation + post-action NAD generation, returned as an
     * NDJSON stream of two events:
     *   { type: "metrics", ... }   — simulate_manual_action result (rho_before/after, ...)
     *   { type: "diagram", ... }   — get_action_variant_diagram result (svg, metadata, ...)
     *
     * Replaces the previous "simulateManualAction then getActionVariantDiagram" fallback
     * pattern (one round-trip + earlier sidebar update instead of two sequential
     * request/response cycles). Caller reads the stream with the same
     * TextDecoder + split('\n') loop used for `runAnalysisStep2Stream`.
     */
    simulateAndVariantDiagramStream: async (params: {
        action_id: string;
        disconnected_elements: string[];
        action_content?: Record<string, unknown> | null;
        lines_overloaded?: string[] | null;
        target_mw?: number | null;
        target_tap?: number | null;
        mode?: 'network' | 'delta';
    }): Promise<Response> => {
        const response = await fetch(`${API_BASE_URL}/api/simulate-and-variant-diagram`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                action_id: params.action_id,
                disconnected_elements: params.disconnected_elements,
                action_content: params.action_content ?? null,
                lines_overloaded: params.lines_overloaded ?? null,
                target_mw: params.target_mw ?? null,
                target_tap: params.target_tap ?? null,
                mode: params.mode ?? 'network',
            }),
        });
        if (!response.ok) {
            throw new Error(`Simulate-and-variant-diagram failed: ${response.statusText}`);
        }
        return response;
    },
};
