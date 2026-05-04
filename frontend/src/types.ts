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
    min_renewable_curtailment_actions?: number;
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
    loads_p?: Record<string, number>;
    gens_p?: Record<string, number>;
}

export interface LoadSheddingDetail {
    load_name: string;
    voltage_level_id: string | null;
    shedded_mw: number;
}
export interface CurtailmentDetail {
    gen_name: string;
    voltage_level_id: string | null;
    curtailed_mw: number;
}
export interface PstDetail {
    pst_name: string;
    tap_position: number;
    low_tap: number | null;
    high_tap: number | null;
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
    lines_overloaded_after?: string[];
    load_shedding_details?: LoadSheddingDetail[];
    curtailment_details?: CurtailmentDetail[];
    pst_details?: PstDetail[];
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
    // Max over the user-selected overloaded lines only — surfaces the
    // pair's predicted effect on the contingency alongside the global
    // `max_rho`, which may land on an off-target line because of
    // linearisation error on lines far from either action.
    target_max_rho?: number | null;
    target_max_rho_line?: string;
    error?: string;
}

export interface AnalysisResult {
    pdf_path: string | null;
    pdf_url: string | null;
    actions: Record<string, ActionDetail>;
    action_scores?: Record<string, { scores: Record<string, number>; mw_start?: Record<string, number | null>; tap_start?: Record<string, { pst_name: string; tap: number; low_tap: number | null; high_tap: number | null } | null> }>;
    lines_overloaded: string[];
    combined_actions?: Record<string, CombinedAction>;
    message: string;
    dc_fallback: boolean;
    // Monitored-line set the analysis ran against. Round-tripped through
    // session.json so a reloaded session can re-push it to the backend
    // via `/api/restore-analysis-context` and preserve the original
    // per-study monitored-line policy for subsequent simulations.
    lines_we_care_about?: string[];
    // Superposition-computed pair cache (key = `"actionA+actionB"`).
    // Persisted + re-pushed on reload for the same reason as
    // `lines_we_care_about`.
    computed_pairs?: Record<string, unknown>;
}

export interface BranchResponse {
    branches: string[];
    /** Optional mapping from element ID to human-readable display name. */
    name_map?: Record<string, string>;
}

/**
 * Mapping from element/VL ID to a human-readable display name.
 * Used throughout the UI to show real substation/circuit names.
 */
export type NameMap = Record<string, string>;

export interface DiagramData {
    /**
     * SVG payload. Usually a raw XML string from pypowsybl; when the
     * N-1 or Action tab is populated via the svgPatch DOM-recycling
     * path (see docs/performance/history/svg-dom-recycling.md) it is a
     * pre-parsed SVGSVGElement that MemoizedSvgContainer moves into
     * the target container via `replaceChildren` — no additional
     * parse. Consumers that need the raw XML (e.g.
     * ActionOverviewDiagram) must branch and clone the element when
     * given an SVGSVGElement.
     */
    svg: string | SVGSVGElement;
    metadata: unknown;
    lf_converged?: boolean;
    lf_status?: string;
    action_id?: string;
    flow_deltas?: Record<string, FlowDelta>;
    reactive_flow_deltas?: Record<string, FlowDelta>;
    asset_deltas?: Record<string, AssetDelta>;
    originalViewBox?: ViewBox | null;
    lines_overloaded?: string[];
    /**
     * Parallel to `lines_overloaded`: the per-element loading ratio
     * (max|i|/permanent_limit, so a value > 1.0 means the branch is
     * above its limit). Displayed in the Overloads feed as "(XX.X%)"
     * alongside the line name. Missing for older session dumps.
     */
    lines_overloaded_rho?: number[];
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

/**
 * Payload returned by `/api/n1-diagram-patch` and
 * `/api/action-variant-diagram-patch`. Carries only the incremental
 * information needed to transform a clone of the N-state SVG DOM into
 * the target state (N-1 or post-action) — NO SVG body. See
 * `docs/performance/history/svg-dom-recycling.md`.
 */
export interface DiagramPatch {
    patchable: boolean;
    reason?: string;
    contingency_id?: string;
    action_id?: string;
    lf_converged: boolean;
    lf_status: string;
    non_convergence?: string | null;
    /** Equipment IDs of edges that should render dashed (disconnected). */
    disconnected_edges?: string[];
    /** Absolute flow values to overwrite the base-state edge-info labels. */
    absolute_flows?: {
        p1: Record<string, number>;
        p2: Record<string, number>;
        q1: Record<string, number>;
        q2: Record<string, number>;
        vl1: Record<string, string>;
        vl2: Record<string, string>;
    };
    lines_overloaded?: string[];
    lines_overloaded_rho?: number[];
    flow_deltas?: Record<string, FlowDelta>;
    reactive_flow_deltas?: Record<string, FlowDelta>;
    asset_deltas?: Record<string, AssetDelta>;
    /**
     * Per-voltage-level node subtrees to splice into the cloned base
     * diagram. Populated only for actions that change bus count at
     * one or more VLs (node merging / splitting / coupling).
     *
     * For each affected VL:
     *  - `node_svg` — `<g id="nad-vl-{subSvgId}">...</g>` fragment
     *    rendered by pypowsybl against the same `fixed_positions` as
     *    the main NAD, so the splice lands geometrically identical
     *    to a native full NAD.
     *  - `node_sub_svg_id` — the svgId pypowsybl assigned to this VL
     *    in the focused sub-diagram (typically `nad-vl-0`). Differs
     *    from the main diagram's svgId (positional, e.g. `nad-vl-42`);
     *    the client must REWRITE the spliced element's `id` attribute
     *    to the main svgId from `baseMetaIndex.nodesByEquipmentId`
     *    so the halo / delta lookups keep working.
     *  - `edge_fragments` — one `<g id="nad-l-{subSvgId}">` (or
     *    `nad-t-*`) subtree per branch terminating at this VL, so
     *    the branch's piercing geometry (which internal bus it
     *    connects to) matches the new bus count. Each entry also
     *    carries `sub_svg_id` for the same client-side rewrite.
     *
     * Omitted for actions with no VL topology change. See
     * docs/performance/history/svg-dom-recycling.md.
     */
    vl_subtrees?: Record<string, {
        node_svg: string;
        node_sub_svg_id: string;
        edge_fragments?: Record<string, { svg: string; sub_svg_id: string }>;
    }>;
    meta?: {
        base_state?: 'N' | 'N-1';
        elapsed_ms?: number;
    };
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
    minRenewableCurtailmentActions: number;
    nPrioritizedActions: number;
    // Configurations tab
    linesMonitoringPath: string;
    monitoringFactor: number;
    preExistingOverloadThreshold: number;
    ignoreReconnections?: boolean;
    pypowsyblFastMode?: boolean;
    layoutPath?: string;
}

export interface RecommenderDisplayConfig {
    minLineReconnections: number;
    minCloseCoupling: number;
    minOpenCoupling: number;
    minLineDisconnections: number;
    minPst: number;
    minLoadShedding: number;
    minRenewableCurtailmentActions: number;
    nPrioritizedActions: number;
    ignoreReconnections: boolean;
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
    lines_overloaded_after?: string[];
    load_shedding_details?: LoadSheddingDetail[];
    curtailment_details?: CurtailmentDetail[];
    pst_details?: PstDetail[];
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
        min_renewable_curtailment_actions?: number;
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
        // Per-element loading ratio (max|i|/permanent_limit) parallel
        // to the n/n-1 overload arrays above. Introduced alongside the
        // sticky feed-summary header (PR #88): the header displays
        // "NAME (XX.X%)" for every overloaded line, and the ratios
        // come from the backend N-1 diagram payload. Persisted here
        // so the sticky header still renders percentages after a
        // session reload without re-running analysis. Optional for
        // backward compatibility with older session dumps.
        n_overloads_rho?: number[];
        n1_overloads_rho?: number[];
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
        // Set of monitored line IDs the analysis was run against.
        // Persisted so we can re-push it to the backend via
        // `/api/restore-analysis-context` on session reload —
        // otherwise simulate-action calls post-reload fall back to
        // the backend default (all lines / lines-monitoring file)
        // instead of the captured per-study set. Optional for
        // backwards compatibility with older session dumps.
        lines_we_care_about?: string[] | null;
        // Superposition-computed pair cache keyed by
        // `"actionA_id+actionB_id"`. Persisted alongside
        // `lines_we_care_about` and re-pushed to the backend on
        // reload so the Combine modal does not re-score everything
        // from scratch.
        computed_pairs?: Record<string, unknown> | null;
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
    // Re-simulation of an already-present action with edited parameters.
    // Unlike `manual_action_simulated`, these gestures keep the action
    // in its current bucket (suggested / manual) and only update the
    // rho_after / load-shedding / curtailment / PST details in place.
    // Two distinct types so a replay agent knows which input field to
    // edit before clicking Re-simulate.
    | 'action_mw_resimulated'
    | 'pst_tap_resimulated'
    // Combined Actions
    | 'combine_modal_opened'
    | 'combine_modal_closed'
    | 'combine_pair_toggled'
    | 'combine_pair_estimated'
    | 'combine_pair_simulated'
    // Visualization
    | 'diagram_tab_changed'
    | 'tab_detached'
    | 'tab_reattached'
    | 'tab_tied'
    | 'tab_untied'
    | 'view_mode_changed'
    | 'overflow_layout_mode_toggled'
    | 'overflow_pins_toggled'
    | 'overflow_pin_clicked'
    | 'overflow_pin_double_clicked'
    | 'overflow_layer_toggled'
    | 'overflow_select_all_layers'
    | 'overflow_node_double_clicked'
    | 'voltage_range_changed'
    | 'asset_clicked'
    | 'zoom_in'
    | 'zoom_out'
    | 'zoom_reset'
    | 'inspect_query_changed'
    | 'vl_names_toggled'
    // SLD Overlay
    | 'sld_overlay_opened'
    | 'sld_overlay_tab_changed'
    | 'sld_overlay_closed'
    // Action Overview Diagram
    | 'overview_shown'
    | 'overview_hidden'
    | 'overview_pin_clicked'
    | 'overview_pin_double_clicked'
    | 'overview_popover_closed'
    | 'overview_zoom_in'
    | 'overview_zoom_out'
    | 'overview_zoom_fit'
    | 'overview_inspect_changed'
    | 'overview_filter_changed'
    | 'overview_unsimulated_toggled'
    | 'overview_unsimulated_pin_simulated'
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

// ===== Action Overview Filters =====

export type ActionSeverityCategory = 'green' | 'orange' | 'red' | 'grey';

/**
 * Action-type chip filter value. 'all' means no restriction, the
 * other tokens map 1:1 to the action-type buckets surfaced by
 * `classifyActionType` (see `utils/actionTypes.ts`).
 */
export type ActionTypeFilterToken = 'all' | 'disco' | 'reco' | 'ls' | 'rc' | 'open' | 'close' | 'pst';

export interface ActionOverviewFilters {
    categories: Record<ActionSeverityCategory, boolean>;
    /**
     * Only display actions whose max_rho (loading rate) is strictly below
     * this threshold. Expressed as a ratio (1.5 == 150%). Applied to both
     * the overview pins and the sidebar action feed cards. Actions whose
     * max_rho is null (divergent / islanded) are always shown when the
     * "grey" category is enabled and ignore the threshold.
     */
    threshold: number;
    /** When true, un-simulated scored actions are drawn as dimmed pins. */
    showUnsimulated: boolean;
    /**
     * Single-select action-type filter (DISCO / RECO / LS / RC / OPEN
     * / CLOSE / PST). 'all' disables the filter. Applied to both the
     * overview pins and the sidebar action feed cards so the two views
     * stay in sync regardless of which chip row the operator uses.
     */
    actionType: ActionTypeFilterToken;
}

/**
 * Enriched info for an un-simulated scored action — derived from
 * `action_scores` in App.tsx and forwarded to the overview so the
 * dimmed pin tooltip can show the same score-table data the Manual
 * Selection dropdown exposes.
 */
export interface UnsimulatedActionScoreInfo {
    /** Action-score bucket (e.g. "line_disconnection", "pst_tap_change"). */
    type: string;
    score: number;
    /** Starting MW for load-shedding / renewable-curtailment actions. */
    mwStart?: number | null;
    /** Starting tap for PST actions. */
    tapStart?: {
        pst_name: string;
        tap: number;
        low_tap: number | null;
        high_tap: number | null;
    } | null;
    /** 1-based rank inside the action's type bucket (1 = highest score). */
    rankInType: number;
    /** Number of actions in the type bucket — used to print "rank X of Y". */
    countInType: number;
    /** Highest score in the type bucket. */
    maxScoreInType: number;
}
