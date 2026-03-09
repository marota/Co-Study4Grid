export interface ConfigRequest {
    network_path: string;
    action_file_path: string;
    min_line_reconnections: number;
    min_close_coupling: number;
    min_open_coupling: number;
    min_line_disconnections: number;
    n_prioritized_actions: number;
    lines_monitoring_path?: string;
    monitoring_factor: number;
    pre_existing_overload_threshold?: number;
    ignore_reconnections?: boolean;
    pypowsybl_fast_mode?: boolean;
}

export interface AnalysisRequest {
    disconnected_element: string;
}

export interface ActionTopology {
    lines_ex_bus: Record<string, number>;
    lines_or_bus: Record<string, number>;
    gens_bus: Record<string, number>;
    loads_bus: Record<string, number>;
}

export interface ActionDetail {
    description_unitaire: string;
    rho_before: number[] | null;
    rho_after: number[] | null;
    max_rho: number | null;
    max_rho_line: string;
    is_rho_reduction: boolean;
    is_manual?: boolean;
    non_convergence?: string | null;
    action_topology?: ActionTopology;
}

export interface AnalysisResult {
    pdf_path: string | null;
    pdf_url: string | null;
    actions: Record<string, ActionDetail>;
    action_scores?: Record<string, Record<string, unknown>>;
    lines_overloaded: string[];
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
    minLineReconnections: number;
    minCloseCoupling: number;
    minOpenCoupling: number;
    minLineDisconnections: number;
    nPrioritizedActions: number;
    linesMonitoringPath: string;
    monitoringFactor: number;
    preExistingOverloadThreshold: number;
    ignoreReconnections?: boolean;
    pypowsyblFastMode?: boolean;
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
}
