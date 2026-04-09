// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import type { AnalysisResult, SessionResult, SavedActionEntry, SavedCombinedAction, InteractionLogEntry } from '../types';

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
    minPst: number;
    minLoadShedding: number;
    minRenewableCurtailmentActions: number;
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

    // Interaction log
    interactionLog: InteractionLogEntry[];
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
        minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, minPst, minLoadShedding, minRenewableCurtailmentActions,
        nPrioritizedActions, linesMonitoringPath, monitoringFactor,
        preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode,
        selectedBranch, selectedOverloads, monitorDeselected,
        nOverloads, n1Overloads,
        result,
        selectedActionIds, rejectedActionIds, manuallyAddedIds, suggestedByRecommenderIds,
        interactionLog,
    } = input;

    // Build combined_actions from the analysis result
    const savedCombinedActions: Record<string, SavedCombinedAction> = {};
    if (result?.combined_actions) {
        for (const [id, ca] of Object.entries(result.combined_actions)) {
            // Check if there's a simulated version in result.actions
            // Look up by both original key and canonical (sorted) key to handle ordering mismatches
            const canonicalId = id.includes('+') ? id.split('+').map(p => p.trim()).sort().join('+') : id;
            const simData = result.actions[id] || result.actions[canonicalId];
            const isSimulated = !!simData && !simData.is_estimated && simData.rho_after != null && simData.rho_after.length > 0;

            savedCombinedActions[id] = {
                action1_id: ca.action1_id,
                action2_id: ca.action2_id,
                betas: ca.betas,
                max_rho: ca.max_rho,
                max_rho_line: ca.max_rho_line,
                is_rho_reduction: ca.is_rho_reduction,
                description: ca.description,
                estimated_max_rho: ca.estimated_max_rho ?? ca.max_rho,
                estimated_max_rho_line: ca.estimated_max_rho_line ?? ca.max_rho_line,
                is_islanded: ca.is_islanded,
                disconnected_mw: ca.disconnected_mw,
                simulated_max_rho: isSimulated ? simData.max_rho : null,
                simulated_max_rho_line: isSimulated ? simData.max_rho_line : undefined,
                is_simulated: isSimulated,
            };
        }
    }

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
                        is_estimated: detail.is_estimated,
                        non_convergence: detail.non_convergence,
                        action_topology: detail.action_topology,
                        estimated_max_rho: detail.estimated_max_rho,
                        estimated_max_rho_line: detail.estimated_max_rho_line,
                        is_islanded: detail.is_islanded,
                        n_components: detail.n_components,
                        disconnected_mw: detail.disconnected_mw,
                        load_shedding_details: detail.load_shedding_details,
                        curtailment_details: detail.curtailment_details,
                        pst_details: detail.pst_details,
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
            combined_actions: savedCombinedActions,
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
            min_pst: minPst,
            min_load_shedding: minLoadShedding,
            min_renewable_curtailment_actions: minRenewableCurtailmentActions,
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
        interaction_log: interactionLog,
    };
}
