import type { AnalysisResult, SessionResult, SavedActionEntry } from '../types';

/**
 * All pieces of App state required to build a SavedSessionResult JSON snapshot.
 * Kept as a plain-data interface so the logic is easily unit-testable without
 * mounting the full React component tree.
 */
export interface SessionInput {
    // Configuration / paths
    networkPath: string;
    actionPath: string;
    layoutPath: string;
    minLineReconnections: number;
    minCloseCoupling: number;
    minOpenCoupling: number;
    minLineDisconnections: number;
    nPrioritizedActions: number;
    linesMonitoringPath: string;
    monitoringFactor: number;
    preExistingOverloadThreshold: number;
    ignoreReconnections: boolean;
    pypowsyblFastMode: boolean;

    // Contingency
    selectedBranch: string;
    selectedOverloads: Set<string>;
    monitorDeselected: boolean;

    // Overload lists from diagrams
    nOverloads: string[];
    n1Overloads: string[];

    // Analysis result (already merged from pendingAnalysisResult → result)
    result: AnalysisResult | null;

    // Action status tracking
    selectedActionIds: Set<string>;          // actions user starred / favorited
    rejectedActionIds: Set<string>;          // actions user explicitly rejected
    manuallyAddedIds: Set<string>;           // actions user simulated manually
    suggestedByRecommenderIds: Set<string>;  // actions ever returned by the recommender
}

/**
 * Builds a serialisable SessionResult snapshot from the current App state.
 *
 * Key design decision for `is_suggested`:
 *   An action is considered "suggested" if the recommender ever returned it,
 *   regardless of whether the user had already manually simulated it before.
 *   `suggestedByRecommenderIds` accumulates all IDs from every streaming
 *   result event for the current contingency and is separate from
 *   `manuallyAddedIds`, which tracks user-initiated simulations.
 */
export function buildSessionResult(input: SessionInput): SessionResult {
    const {
        networkPath, actionPath, layoutPath,
        minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections,
        nPrioritizedActions, linesMonitoringPath, monitoringFactor,
        preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode,
        selectedBranch, selectedOverloads, monitorDeselected,
        nOverloads, n1Overloads,
        result,
        selectedActionIds, rejectedActionIds, manuallyAddedIds, suggestedByRecommenderIds,
    } = input;

    const analysis: SessionResult['analysis'] = result
        ? {
            message: result.message,
            dc_fallback: result.dc_fallback,
            action_scores: result.action_scores,
            actions: Object.fromEntries(
                Object.entries(result.actions).map(([id, detail]): [string, SavedActionEntry] => [
                    id,
                    {
                        description_unitaire: detail.description_unitaire,
                        rho_before: detail.rho_before,
                        rho_after: detail.rho_after,
                        max_rho: detail.max_rho,
                        max_rho_line: detail.max_rho_line,
                        is_rho_reduction: detail.is_rho_reduction,
                        non_convergence: detail.non_convergence,
                        action_topology: detail.action_topology,
                        status: {
                            is_selected: selectedActionIds.has(id),
                            // An action is "suggested" if the recommender ever returned it —
                            // even if the user had also manually simulated it beforehand.
                            is_suggested: suggestedByRecommenderIds.has(id),
                            is_rejected: rejectedActionIds.has(id),
                            is_manually_simulated: manuallyAddedIds.has(id),
                        },
                    },
                ])
            ),
        }
        : null;

    return {
        saved_at: new Date().toISOString(),
        configuration: {
            network_path: networkPath,
            action_file_path: actionPath,
            layout_path: layoutPath,
            min_line_reconnections: minLineReconnections,
            min_close_coupling: minCloseCoupling,
            min_open_coupling: minOpenCoupling,
            min_line_disconnections: minLineDisconnections,
            n_prioritized_actions: nPrioritizedActions,
            lines_monitoring_path: linesMonitoringPath,
            monitoring_factor: monitoringFactor,
            pre_existing_overload_threshold: preExistingOverloadThreshold,
            ignore_reconnections: ignoreReconnections,
            pypowsybl_fast_mode: pypowsyblFastMode,
        },
        contingency: {
            disconnected_element: selectedBranch,
            selected_overloads: Array.from(selectedOverloads),
            monitor_deselected: monitorDeselected,
        },
        overloads: {
            n_overloads: nOverloads,
            n1_overloads: n1Overloads,
            resolved_overloads: result?.lines_overloaded ?? [],
        },
        overflow_graph: result?.pdf_url
            ? { pdf_url: result.pdf_url, pdf_path: result.pdf_path ?? null }
            : null,
        analysis,
    };
}
