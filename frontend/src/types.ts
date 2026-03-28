// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

export interface ConfigRequest {
    network_path: string;
    action_file_path: string;
    min_line_reconnections: number;
    min_close_coupling: number;
    min_open_coupling: number;
    min_line_disconnections: number;
    min_pst?: number;
    min_load_shedding?: number;
    n_prioritized_actions: number;
    lines_monitoring_path?: string;
    monitoring_factor: number;
    pre_existing_overload_threshold?: number;
    ignore_reconnections?: boolean;
    pypowsybl_fast_mode?: boolean;
    layout_path?: string;
}

export interface AnalysisRequest {
    disconnected_element: string;
}

export interface ActionTopology {
    lines_ex_bus: Record<string, number>;
    lines_or_bus: Record<string, number>;
    gens_bus: Record<string, number>;
    loads_bus: Record<string, number>;
    pst_tap?: Record<string, unknown>;
    substations?: Record<string, unknown>;
    switches?: Record<string, unknown>;
}

export interface LoadSheddingDetail {
    load_name: string;
    voltage_level_id: string | null;
    shedded_mw: number;
}

export interface ActionDetail {
    description_unitaire: string;
    rho_before: number[] | null;
    rho_after: number[] | null;
    max_rho: number | null;
    max_rho_line: string;
    is_rho_reduction: boolean;
    estimated_max_rho?: number | null;
    estimated_max_rho_line?: string;
    is_manual?: boolean;
    is_estimated?: boolean;
    is_islanded?: boolean;
    n_components?: number;
    disconnected_mw?: number;
    non_convergence?: string | null;
    action_topology?: ActionTopology;
    load_shedding_details?: LoadSheddingDetail[];
}

export interface CombinedAction {
    action1_id: string;
    action2_id: string;
    betas: number[];
    p_or_combined: number[];
    max_rho: number;
    max_rho_line: string;
    is_rho_reduction: boolean;
    description: string;
    rho_after: number[];
    rho_before: number[];
    is_islanded?: boolean;
    disconnected_mw?: number;
    estimated_max_rho?: number | null;
    estimated_max_rho_line?: string;
    error?: string;
}

export interface AnalysisResult {
    pdf_path: string | null;
    pdf_url: string | null;
    actions: Record<string, ActionDetail>;
    action_scores?: Record<string, { scores: Record<string, number>; mw_start?: Record<string, number | null> }>;
    lines_overloaded: string[];
    combined_actions?: Record<string, CombinedAction>;
    message: string;
    dc_fallback: boolean;
}

export interface BranchResponse {
    branches: string[];
}

export interface DiagramData {
    svg: string;
    metadata: unknown;
    lf_converged?: boolean;
    lf_status?: string;
    action_id?: string;
    flow_deltas?: Record<string, FlowDelta>;
    reactive_flow_deltas?: Record<string, FlowDelta>;
    asset_deltas?: Record<string, AssetDelta>;
    originalViewBox?: ViewBox | null;
    lines_overloaded?: string[];
}

export interface FlowDelta {
    delta: number;
    category: 'positive' | 'negative' | 'grey';
    flip_arrow?: boolean;
}

export interface AssetDelta {
    delta_p: number;
    delta_q: number;
    category: 'positive' | 'negative' | 'grey';
    category_p?: 'positive' | 'negative' | 'grey';
    category_q?: 'positive' | 'negative' | 'grey';
}

export interface ViewBox {
    x: number;
    y: number;
    w: number;
    h: number;
}

// Metadata index for O(1) lookups of SVG elements
export interface NodeMeta {
    equipmentId: string;
    svgId: string;
    x: number;
    y: number;
    legendSvgId?: string;
    legendEdgeSvgId?: string;
    [key: string]: unknown;
}

export interface EdgeInfoMeta {
    svgId: string;
    infoType?: string;
    direction?: string;
    externalLabel?: string;
}

export interface EdgeMeta {
    equipmentId: string;
    svgId: string;
    node1: string;
    node2: string;
    edgeInfo1?: EdgeInfoMeta;
    edgeInfo2?: EdgeInfoMeta;
    [key: string]: unknown;
}

export interface MetadataIndex {
    nodesByEquipmentId: Map<string, NodeMeta>;
    nodesBySvgId: Map<string, NodeMeta>;
    edgesByEquipmentId: Map<string, EdgeMeta>;
    edgesByNode: Map<string, EdgeMeta[]>;
}

export type TabId = 'n' | 'n-1' | 'action' | 'overflow';

export interface SettingsBackup {
    // Paths tab (new)
    networkPath?: string;
    actionPath?: string;
    outputFolderPath?: string;
    // Recommender tab
    minLineReconnections: number;
    minCloseCoupling: number;
    minOpenCoupling: number;
    minLineDisconnections: number;
    minLoadShedding: number;
    nPrioritizedActions: number;
    // Configurations tab
    linesMonitoringPath: string;
    monitoringFactor: number;
    preExistingOverloadThreshold: number;
    ignoreReconnections?: boolean;
    pypowsyblFastMode?: boolean;
    layoutPath?: string;
}

export interface AvailableAction {
    id: string;
    description: string;
    type?: string;
}

export type SldTab = 'n' | 'n-1' | 'action';

// SLD metadata feeder node: maps SVG element IDs to network equipment IDs.
// Comes from pypowsybl's GraphMetadata (feederNodes array).
export interface SldFeederNode {
    id: string;         // SVG element ID
    equipmentId: string;
    componentType?: string;
    direction?: string; // 'TOP' | 'BOTTOM'
}

export interface VlOverlay {
    vlName: string;
    actionId: string | null;
    svg: string | null;
    sldMetadata: string | null;  // raw JSON string from pypowsybl GraphMetadata
    loading: boolean;
    error: string | null;
    tab: SldTab;
    flow_deltas?: Record<string, FlowDelta>;
    reactive_flow_deltas?: Record<string, FlowDelta>;
    asset_deltas?: Record<string, AssetDelta>;
    changed_switches?: Record<string, { from_open: boolean; to_open: boolean }>;
}

// ===== Session Save =====

export interface SavedActionStatus {
    is_selected: boolean;       // user starred/favorited
    is_suggested: boolean;      // recommended by expert_op4grid (not manually added)
    is_rejected: boolean;       // user explicitly rejected
    is_manually_simulated: boolean; // user manually triggered simulation
}

export interface SavedActionEntry {
    description_unitaire: string;
    rho_before: number[] | null;
    rho_after: number[] | null;
    max_rho: number | null;
    max_rho_line: string;
    is_rho_reduction: boolean;
    is_estimated?: boolean;         // true for estimation-only combined pair entries
    estimated_max_rho?: number | null;
    estimated_max_rho_line?: string;
    is_islanded?: boolean;
    n_components?: number;
    disconnected_mw?: number;
    non_convergence?: string | null;
    action_topology?: ActionTopology;
    load_shedding_details?: LoadSheddingDetail[];
    status: SavedActionStatus;
}

export interface SavedCombinedAction {
    action1_id: string;
    action2_id: string;
    betas: number[];
    max_rho: number;
    max_rho_line: string;
    is_rho_reduction: boolean;
    description: string;
    estimated_max_rho?: number | null;
    estimated_max_rho_line?: string;
    is_islanded?: boolean;
    disconnected_mw?: number;
    simulated_max_rho?: number | null;
    simulated_max_rho_line?: string;
    is_simulated: boolean;
}

export interface SessionResult {
    saved_at: string;           // ISO 8601 timestamp
    configuration: {
        network_path: string;
        action_file_path: string;
        layout_path: string;
        min_line_reconnections: number;
        min_close_coupling: number;
        min_open_coupling: number;
        min_line_disconnections: number;
        min_pst: number;
        min_load_shedding: number;
        n_prioritized_actions: number;
        lines_monitoring_path: string;
        monitoring_factor: number;
        pre_existing_overload_threshold: number;
        ignore_reconnections: boolean;
        pypowsybl_fast_mode: boolean;
    };
    contingency: {
        disconnected_element: string;
        selected_overloads: string[];
        monitor_deselected: boolean;
    };
    overloads: {
        n_overloads: string[];
        n1_overloads: string[];
        resolved_overloads: string[];   // overloads that were resolved (selected for step2)
    };
    overflow_graph: {
        pdf_url: string | null;
        pdf_path: string | null;
    } | null;
    analysis: {
        message: string;
        dc_fallback: boolean;
        action_scores: Record<string, Record<string, unknown>> | undefined;
        actions: Record<string, SavedActionEntry>;
        combined_actions: Record<string, SavedCombinedAction>;
    } | null;
    interaction_log?: InteractionLogEntry[];
}

// ===== Interaction Logging =====

export type InteractionType =
    // Configuration & Study Loading
    | 'config_loaded'
    | 'settings_opened'
    | 'settings_tab_changed'
    | 'settings_applied'
    | 'settings_cancelled'
    | 'path_picked'
    // Contingency Selection
    | 'contingency_selected'
    | 'contingency_confirmed'
    // Two-Step Analysis
    | 'analysis_step1_started'
    | 'analysis_step1_completed'
    | 'overload_toggled'
    | 'analysis_step2_started'
    | 'analysis_step2_completed'
    | 'prioritized_actions_displayed'
    // Action Interactions
    | 'action_selected'
    | 'action_deselected'
    | 'action_favorited'
    | 'action_unfavorited'
    | 'action_rejected'
    | 'action_unrejected'
    | 'manual_action_simulated'
    // Combined Actions
    | 'combine_modal_opened'
    | 'combine_modal_closed'
    | 'combine_pair_toggled'
    | 'combine_pair_estimated'
    | 'combine_pair_simulated'
    // Visualization
    | 'diagram_tab_changed'
    | 'view_mode_changed'
    | 'voltage_range_changed'
    | 'asset_clicked'
    | 'zoom_in'
    | 'zoom_out'
    | 'zoom_reset'
    | 'inspect_query_changed'
    // SLD Overlay
    | 'sld_overlay_opened'
    | 'sld_overlay_tab_changed'
    | 'sld_overlay_closed'
    // Session Management
    | 'session_saved'
    | 'session_reload_modal_opened'
    | 'session_reloaded';

export interface InteractionLogEntry {
    seq: number;
    timestamp: string;
    type: InteractionType;
    details: Record<string, unknown>;
    correlation_id?: string;
    duration_ms?: number;
}
