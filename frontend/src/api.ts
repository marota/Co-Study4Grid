import axios from 'axios';
import type { ConfigRequest, AnalysisResult, BranchResponse, DiagramData, FlowDelta, AssetDelta } from './types';

const API_BASE_URL = 'http://localhost:8000';

export const api = {
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
    runAnalysis: async (disconnected_element: string): Promise<AnalysisResult> => {
        // The backend returns NDJSON (one JSON object per line).
        // Use fetch + ReadableStream to parse events incrementally.
        const response = await fetch(`${API_BASE_URL}/api/run-analysis`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ disconnected_element }),
        });
        if (!response.ok) {
            throw new Error(`Analysis failed: ${response.statusText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: Partial<AnalysisResult> = {};

        for (; ;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop()!;
            for (const line of lines) {
                if (!line.trim()) continue;
                const event = JSON.parse(line);
                if (event.type === 'pdf') {
                    result.pdf_url = event.pdf_url;
                    result.pdf_path = event.pdf_path;
                } else if (event.type === 'result') {
                    result = { ...result, ...event };
                } else if (event.type === 'error') {
                    throw new Error(event.message);
                }
            }
        }

        return result as AnalysisResult;
    },
    getActionVariantDiagram: async (actionId: string): Promise<DiagramData> => {
        const response = await axios.post<DiagramData>(
            `${API_BASE_URL}/api/action-variant-diagram`,
            { action_id: actionId }
        );
        return response.data;
    },
    getAvailableActions: async (): Promise<{ id: string; description: string }[]> => {
        const response = await axios.get<{ actions: { id: string; description: string }[] }>(
            `${API_BASE_URL}/api/actions`
        );
        return response.data.actions;
    },
    simulateManualAction: async (actionId: string, disconnectedElement: string): Promise<{
        action_id: string;
        description_unitaire: string;
        rho_before: number[] | null;
        rho_after: number[] | null;
        max_rho: number | null;
        max_rho_line: string;
        is_rho_reduction: boolean;
        non_convergence: string | null;
        lines_overloaded: string[];
    }> => {
        const response = await axios.post(
            `${API_BASE_URL}/api/simulate-manual-action`,
            { action_id: actionId, disconnected_element: disconnectedElement }
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
    getActionVariantSld: async (actionId: string, voltageLevelId: string): Promise<{ svg: string; sld_metadata: string | null; action_id: string; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta> }> => {
        const response = await axios.post<{ svg: string; sld_metadata: string | null; action_id: string; voltage_level_id: string; flow_deltas?: Record<string, FlowDelta>; reactive_flow_deltas?: Record<string, FlowDelta>; asset_deltas?: Record<string, AssetDelta> }>(
            `${API_BASE_URL}/api/action-variant-sld`,
            { action_id: actionId, voltage_level_id: voltageLevelId }
        );
        return response.data;
    },
    runAnalysisStep1: async (disconnected_element: string): Promise<{ lines_overloaded: string[]; message: string; can_proceed: boolean }> => {
        const response = await axios.post(`${API_BASE_URL}/api/run-analysis-step1`, { disconnected_element });
        return response.data;
    },
    runAnalysisStep2: async (selected_overloads: string[]): Promise<AnalysisResult> => {
        const response = await fetch(`${API_BASE_URL}/api/run-analysis-step2`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selected_overloads }),
        });
        if (!response.ok) {
            throw new Error(`Analysis failed: ${response.statusText}`);
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let result: Partial<AnalysisResult> = {};

        for (; ;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop()!;
            for (const line of lines) {
                if (!line.trim()) continue;
                const event = JSON.parse(line);
                if (event.type === 'pdf') {
                    result.pdf_url = event.pdf_url;
                    result.pdf_path = event.pdf_path;
                } else if (event.type === 'result') {
                    result = { ...result, ...event };
                } else if (event.type === 'error') {
                    throw new Error(event.message);
                }
            }
        }

        return result as AnalysisResult;
    },
};
