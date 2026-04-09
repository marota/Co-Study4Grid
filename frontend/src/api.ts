// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import axios from 'axios';
import type { ConfigRequest, BranchResponse, DiagramData, FlowDelta, AssetDelta, AvailableAction, SessionResult } from './types';

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
        return response.data.branches;
    },
    getVoltageLevels: async (): Promise<string[]> => {
        const response = await axios.get<{ voltage_levels: string[] }>(`${API_BASE_URL}/api/voltage-levels`);
        return response.data.voltage_levels;
    },
    getNominalVoltages: async (): Promise<{ mapping: Record<string, number>; unique_kv: number[] }> => {
        const response = await axios.get<{ mapping: Record<string, number>; unique_kv: number[] }>(
            `${API_BASE_URL}/api/nominal-voltages`
        );
        return response.data;
    },
    getNetworkDiagram: async (): Promise<DiagramData> => {
        const response = await axios.get<DiagramData>(`${API_BASE_URL}/api/network-diagram`);
        return response.data;
    },
    getN1Diagram: async (disconnectedElement: string): Promise<DiagramData> => {
        const response = await axios.post<DiagramData>(
            `${API_BASE_URL}/api/n1-diagram`,
            { disconnected_element: disconnectedElement }
        );
        return response.data;
    },
    getActionVariantDiagram: async (actionId: string): Promise<DiagramData> => {
        const response = await axios.post<DiagramData>(
            `${API_BASE_URL}/api/action-variant-diagram`,
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
    simulateManualAction: async (actionId: string, disconnectedElement: string, actionContent?: Record<string, unknown> | null, linesOverloaded?: string[] | null, targetMw?: number | null, targetTap?: number | null): Promise<{
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
        action_topology?: import('./types').ActionTopology;
        load_shedding_details?: import('./types').LoadSheddingDetail[];
        curtailment_details?: import('./types').CurtailmentDetail[];
        pst_details?: import('./types').PstDetail[];
    }> => {

        const response = await axios.post(
            `${API_BASE_URL}/api/simulate-manual-action`,
            { action_id: actionId, disconnected_element: disconnectedElement, action_content: actionContent ?? null, lines_overloaded: linesOverloaded ?? null, target_mw: targetMw ?? null, target_tap: targetTap ?? null }
        );
        return response.data;
    },
    computeSuperposition: async (action1_id: string, action2_id: string, disconnectedElement: string): Promise<import('./types').CombinedAction> => {
        const response = await axios.post(
            `${API_BASE_URL}/api/compute-superposition`,
            { action1_id, action2_id, disconnected_element: disconnectedElement }
        );
        return response.data;
    },
    pickPath: async (type: 'file' | 'dir'): Promise<string | null> => {
        const response = await axios.get<{ path: string | null }>(
            `${API_BASE_URL}/api/pick-path?type=${type}`
        );
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
    getN1Sld: async (disconnectedElement: string, voltageLevelId: string): Promise<{ svg: string; sld_metadata: string | null; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta> }> => {
        const response = await axios.post<{ svg: string; sld_metadata: string | null; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta> }>(
            `${API_BASE_URL}/api/n1-sld`,
            { disconnected_element: disconnectedElement, voltage_level_id: voltageLevelId }
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
    runAnalysisStep1: async (disconnected_element: string): Promise<{ lines_overloaded: string[]; message: string; can_proceed: boolean }> => {
        const response = await axios.post(`${API_BASE_URL}/api/run-analysis-step1`, { disconnected_element });
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
};
