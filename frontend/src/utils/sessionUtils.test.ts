// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect } from 'vitest';
import { buildSessionResult } from './sessionUtils';
import type { SessionInput } from './sessionUtils';
import type { AnalysisResult, ActionDetail, CombinedAction } from '../types';

// ===== Helpers =====

const makeAction = (desc: string, overrides: Partial<ActionDetail> = {}): ActionDetail => ({
    description_unitaire: desc,
    rho_before: [1.05, 1.1],
    rho_after: [0.9, 0.95],
    max_rho: 0.95,
    max_rho_line: 'LINE_X',
    is_rho_reduction: true,
    ...overrides,
});

const makeResult = (overrides: Partial<AnalysisResult> = {}): AnalysisResult => ({
    pdf_path: '/tmp/overflow.pdf',
    pdf_url: '/results/pdf/overflow.pdf',
    actions: {},
    lines_overloaded: ['LINE_B'],
    message: 'Analysis done',
    dc_fallback: false,
    ...overrides,
});

const baseInput: SessionInput = {
    networkPath: '/data/network',
    actionPath: '/data/actions.json',
    layoutPath: '',
    minLineReconnections: 2.0,
    minCloseCoupling: 3.0,
    minOpenCoupling: 2.0,
    minLineDisconnections: 3.0,
    minPst: 1.0,
    minLoadShedding: 0.0,
    minRenewableCurtailmentActions: 0.0,
    nPrioritizedActions: 10,
    linesMonitoringPath: '/data/monitoring.csv',
    monitoringFactor: 0.95,
    preExistingOverloadThreshold: 0.02,
    ignoreReconnections: false,
    pypowsyblFastMode: true,
    selectedBranch: 'LINE_A',
    selectedOverloads: new Set(['LINE_B']),
    monitorDeselected: false,
    nOverloads: [],
    n1Overloads: ['LINE_B'],
    result: null,
    selectedActionIds: new Set(),
    rejectedActionIds: new Set(),
    manuallyAddedIds: new Set(),
    suggestedByRecommenderIds: new Set(),
    interactionLog: [],
};

// ===== Tests =====

describe('buildSessionResult — structure', () => {
    it('includes a saved_at ISO timestamp', () => {
        const out = buildSessionResult(baseInput);
        expect(out.saved_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it('serialises all configuration fields', () => {
        const out = buildSessionResult(baseInput);
        expect(out.configuration).toEqual({
            network_path: '/data/network',
            action_file_path: '/data/actions.json',
            layout_path: '',
            min_line_reconnections: 2.0,
            min_close_coupling: 3.0,
            min_open_coupling: 2.0,
            min_line_disconnections: 3.0,
            min_pst: 1.0,
            min_load_shedding: 0.0,
            min_renewable_curtailment_actions: 0.0,
            n_prioritized_actions: 10,
            lines_monitoring_path: '/data/monitoring.csv',
            monitoring_factor: 0.95,
            pre_existing_overload_threshold: 0.02,
            ignore_reconnections: false,
            pypowsybl_fast_mode: true,
        });
    });

    it('serialises contingency with selected_overloads array', () => {
        const out = buildSessionResult({
            ...baseInput,
            selectedBranch: 'LINE_A',
            selectedOverloads: new Set(['LINE_B', 'LINE_C']),
            monitorDeselected: true,
        });
        expect(out.contingency.disconnected_element).toBe('LINE_A');
        expect(out.contingency.selected_overloads).toEqual(expect.arrayContaining(['LINE_B', 'LINE_C']));
        expect(out.contingency.selected_overloads).toHaveLength(2);
        expect(out.contingency.monitor_deselected).toBe(true);
    });

    it('serialises overload lists from diagrams and result', () => {
        const out = buildSessionResult({
            ...baseInput,
            nOverloads: ['LINE_PRE'],
            n1Overloads: ['LINE_B', 'LINE_C'],
            result: makeResult({ lines_overloaded: ['LINE_B'] }),
        });
        expect(out.overloads.n_overloads).toEqual(['LINE_PRE']);
        expect(out.overloads.n1_overloads).toEqual(['LINE_B', 'LINE_C']);
        expect(out.overloads.resolved_overloads).toEqual(['LINE_B']);
    });

    it('sets resolved_overloads to empty when result is null', () => {
        const out = buildSessionResult({ ...baseInput, result: null });
        expect(out.overloads.resolved_overloads).toEqual([]);
    });

    it('persists lines_overloaded_rho when length matches the element list', () => {
        // PR #88 added per-element loading ratios that feed the sticky
        // sidebar header. They must survive save/reload so the sticky
        // percentages render after a session restore without requiring
        // a fresh analysis run.
        const out = buildSessionResult({
            ...baseInput,
            nOverloads: ['LINE_PRE'],
            nOverloadsRho: [1.04],
            n1Overloads: ['LINE_B', 'LINE_C'],
            n1OverloadsRho: [1.23, 1.07],
        });
        expect(out.overloads.n_overloads_rho).toEqual([1.04]);
        expect(out.overloads.n1_overloads_rho).toEqual([1.23, 1.07]);
    });

    it('omits rho arrays when the length does not match the element list', () => {
        // Guard against older payloads / partial backends: if the rho
        // array is shorter than the name array, prefer omitting the
        // field entirely over writing misaligned percentages.
        const out = buildSessionResult({
            ...baseInput,
            n1Overloads: ['LINE_B', 'LINE_C'],
            n1OverloadsRho: [1.23],
        });
        expect(out.overloads.n1_overloads_rho).toBeUndefined();
    });

    it('omits rho arrays when not provided at all (legacy session flow)', () => {
        const out = buildSessionResult({
            ...baseInput,
            n1Overloads: ['LINE_B'],
        });
        expect(out.overloads.n_overloads_rho).toBeUndefined();
        expect(out.overloads.n1_overloads_rho).toBeUndefined();
    });

    it('populates overflow_graph when result has pdf_url', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ pdf_url: '/results/pdf/x.pdf', pdf_path: '/tmp/x.pdf' }),
        });
        expect(out.overflow_graph).toEqual({ pdf_url: '/results/pdf/x.pdf', pdf_path: '/tmp/x.pdf' });
    });

    it('sets overflow_graph to null when result has no pdf_url', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ pdf_url: null, pdf_path: null }),
        });
        expect(out.overflow_graph).toBeNull();
    });

    it('sets analysis to null when result is null', () => {
        const out = buildSessionResult({ ...baseInput, result: null });
        expect(out.analysis).toBeNull();
    });

    it('preserves action detail fields in analysis', () => {
        const action = makeAction('Switch bus 1', {
            rho_before: [1.1], rho_after: [0.88],
            max_rho: 0.88, max_rho_line: 'LINE_B',
            is_rho_reduction: true,
            non_convergence: null,
            action_topology: { lines_ex_bus: { LINE_X: 1 }, lines_or_bus: {}, gens_bus: {}, loads_bus: {} },
        });
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: action } }),
        });
        const saved = out.analysis!.actions.act1;
        expect(saved.description_unitaire).toBe('Switch bus 1');
        expect(saved.rho_before).toEqual([1.1]);
        expect(saved.rho_after).toEqual([0.88]);
        expect(saved.max_rho).toBe(0.88);
        expect(saved.max_rho_line).toBe('LINE_B');
        expect(saved.is_rho_reduction).toBe(true);
        expect(saved.non_convergence).toBeNull();
        expect(saved.action_topology).toEqual({ lines_ex_bus: { LINE_X: 1 }, lines_or_bus: {}, gens_bus: {}, loads_bus: {} });
    });

    it('includes action_scores in analysis', () => {
        const scores = { act1: { score: 0.8, rank: 1 } };
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('X') }, action_scores: scores }),
        });
        expect(out.analysis!.action_scores).toEqual(scores);
    });

    it('includes dc_fallback and message in analysis', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ message: 'DC fallback used', dc_fallback: true }),
        });
        expect(out.analysis!.message).toBe('DC fallback used');
        expect(out.analysis!.dc_fallback).toBe(true);
    });
});

describe('buildSessionResult — action status tags', () => {
    it('is_selected is true when action is in selectedActionIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            selectedActionIds: new Set(['act1']),
        });
        expect(out.analysis!.actions.act1.status.is_selected).toBe(true);
    });

    it('is_selected is false when action is NOT in selectedActionIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            selectedActionIds: new Set(),
        });
        expect(out.analysis!.actions.act1.status.is_selected).toBe(false);
    });

    it('is_suggested is true when action is in suggestedByRecommenderIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            suggestedByRecommenderIds: new Set(['act1']),
        });
        expect(out.analysis!.actions.act1.status.is_suggested).toBe(true);
    });

    it('is_suggested is false when action is NOT in suggestedByRecommenderIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            suggestedByRecommenderIds: new Set(),
        });
        expect(out.analysis!.actions.act1.status.is_suggested).toBe(false);
    });

    it('is_rejected is true when action is in rejectedActionIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            rejectedActionIds: new Set(['act1']),
        });
        expect(out.analysis!.actions.act1.status.is_rejected).toBe(true);
    });

    it('is_rejected is false when action is NOT in rejectedActionIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            rejectedActionIds: new Set(),
        });
        expect(out.analysis!.actions.act1.status.is_rejected).toBe(false);
    });

    it('is_manually_simulated is true when action is in manuallyAddedIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            manuallyAddedIds: new Set(['act1']),
        });
        expect(out.analysis!.actions.act1.status.is_manually_simulated).toBe(true);
    });

    it('is_manually_simulated is false when action is NOT in manuallyAddedIds', () => {
        const out = buildSessionResult({
            ...baseInput,
            result: makeResult({ actions: { act1: makeAction('A') } }),
            manuallyAddedIds: new Set(),
        });
        expect(out.analysis!.actions.act1.status.is_manually_simulated).toBe(false);
    });

    it('all status flags are independently tracked per action', () => {
        const result = makeResult({
            actions: {
                suggested: makeAction('Pure suggestion'),
                selected: makeAction('Starred'),
                rejected: makeAction('Rejected'),
                manual: makeAction('Manual'),
            },
        });
        const out = buildSessionResult({
            ...baseInput,
            result,
            suggestedByRecommenderIds: new Set(['suggested', 'selected']),
            selectedActionIds: new Set(['selected']),
            rejectedActionIds: new Set(['rejected']),
            manuallyAddedIds: new Set(['manual']),
        });
        expect(out.analysis!.actions.suggested.status).toEqual({
            is_selected: false, is_suggested: true, is_rejected: false, is_manually_simulated: false,
        });
        expect(out.analysis!.actions.selected.status).toEqual({
            is_selected: true, is_suggested: true, is_rejected: false, is_manually_simulated: false,
        });
        expect(out.analysis!.actions.rejected.status).toEqual({
            is_selected: false, is_suggested: false, is_rejected: true, is_manually_simulated: false,
        });
        expect(out.analysis!.actions.manual.status).toEqual({
            is_selected: false, is_suggested: false, is_rejected: false, is_manually_simulated: true,
        });
    });
});

describe('buildSessionResult — is_suggested edge case', () => {
    /**
     * Critical case: the user manually simulates an action BEFORE running the
     * recommender analysis.  When the recommender later returns that same action
     * as a suggestion, both is_manually_simulated AND is_suggested should be true.
     *
     * Old (broken) logic: is_suggested = !manuallyAddedIds.has(id)
     *   → would mark the action as NOT suggested because it was manually added.
     *
     * New (correct) logic: is_suggested = suggestedByRecommenderIds.has(id)
     *   → is derived from whether the recommender ever returned the action,
     *     independent of the manual simulation history.
     */
    it('action manually added then also returned by recommender is both is_manually_simulated AND is_suggested', () => {
        const result = makeResult({ actions: { act1: makeAction('Overlap action') } });
        const out = buildSessionResult({
            ...baseInput,
            result,
            manuallyAddedIds: new Set(['act1']),          // user ran it manually
            suggestedByRecommenderIds: new Set(['act1']), // recommender also returned it
        });
        const status = out.analysis!.actions.act1.status;
        expect(status.is_manually_simulated).toBe(true);
        expect(status.is_suggested).toBe(true);
    });

    it('action only manually added (recommender never returned it) is NOT is_suggested', () => {
        const result = makeResult({ actions: { act1: makeAction('Manual only') } });
        const out = buildSessionResult({
            ...baseInput,
            result,
            manuallyAddedIds: new Set(['act1']),
            suggestedByRecommenderIds: new Set(),  // recommender never returned act1
        });
        const status = out.analysis!.actions.act1.status;
        expect(status.is_manually_simulated).toBe(true);
        expect(status.is_suggested).toBe(false);
    });

    it('action returned by recommender then also manually re-simulated keeps is_suggested true', () => {
        // User selects the action via manual search after already seeing it as a suggestion
        const result = makeResult({ actions: { act1: makeAction('Re-simulated suggestion') } });
        const out = buildSessionResult({
            ...baseInput,
            result,
            manuallyAddedIds: new Set(['act1']),
            suggestedByRecommenderIds: new Set(['act1']),
            selectedActionIds: new Set(['act1']),
        });
        const status = out.analysis!.actions.act1.status;
        expect(status.is_suggested).toBe(true);
        expect(status.is_manually_simulated).toBe(true);
        expect(status.is_selected).toBe(true);
    });

    it('multiple re-analysis runs: action suggested in first run stays is_suggested after second run', () => {
        // Simulates suggestedByRecommenderIds accumulating across two analysis runs.
        // act1 was in run1, act2 was in run2; both should be is_suggested.
        const result = makeResult({
            actions: {
                act1: makeAction('Run1 suggestion'),
                act2: makeAction('Run2 suggestion'),
            },
        });
        const out = buildSessionResult({
            ...baseInput,
            result,
            suggestedByRecommenderIds: new Set(['act1', 'act2']), // accumulated across both runs
        });
        expect(out.analysis!.actions.act1.status.is_suggested).toBe(true);
        expect(out.analysis!.actions.act2.status.is_suggested).toBe(true);
    });
});

describe('buildSessionResult — combined_actions', () => {
    const makeCombinedAction = (overrides: Partial<CombinedAction> = {}): CombinedAction => ({
        action1_id: 'act1',
        action2_id: 'act2',
        betas: [0.5, 0.3],
        p_or_combined: [100, 200],
        max_rho: 0.85,
        max_rho_line: 'LINE_C',
        is_rho_reduction: true,
        description: 'Combined act1 + act2',
        rho_after: [0.8, 0.85],
        rho_before: [1.1, 1.05],
        estimated_max_rho: 0.82,
        estimated_max_rho_line: 'LINE_C',
        ...overrides,
    });

    it('serialises combined_actions from analysis result', () => {
        const result = makeResult({
            actions: { act1: makeAction('A'), act2: makeAction('B') },
            combined_actions: { 'act1+act2': makeCombinedAction() },
        });
        const out = buildSessionResult({ ...baseInput, result });
        expect(out.analysis!.combined_actions).toBeDefined();
        expect(out.analysis!.combined_actions['act1+act2']).toBeDefined();
        const saved = out.analysis!.combined_actions['act1+act2'];
        expect(saved.action1_id).toBe('act1');
        expect(saved.action2_id).toBe('act2');
        expect(saved.betas).toEqual([0.5, 0.3]);
        expect(saved.estimated_max_rho).toBe(0.82);
        expect(saved.is_simulated).toBe(false);
    });

    it('marks combined_action as simulated when result.actions contains it', () => {
        const result = makeResult({
            actions: {
                act1: makeAction('A'),
                act2: makeAction('B'),
                'act1+act2': makeAction('Combined', { is_estimated: false, rho_after: [0.78, 0.80], max_rho: 0.80, max_rho_line: 'LINE_D' }),
            },
            combined_actions: { 'act1+act2': makeCombinedAction() },
        });
        const out = buildSessionResult({ ...baseInput, result });
        const saved = out.analysis!.combined_actions['act1+act2'];
        expect(saved.is_simulated).toBe(true);
        expect(saved.simulated_max_rho).toBe(0.80);
        expect(saved.simulated_max_rho_line).toBe('LINE_D');
    });

    it('detects simulated pair via canonical key when combined_actions key is non-canonical', () => {
        // Library returns combined_actions with key 'reco_X+node_merging_Y' (non-canonical)
        // Simulation stores result under canonical key 'node_merging_Y+reco_X' in result.actions
        const result = makeResult({
            actions: {
                reco_X: makeAction('A'),
                node_merging_Y: makeAction('B'),
                // Simulation result stored under canonical (sorted) key
                'node_merging_Y+reco_X': makeAction('Combined sim', {
                    is_estimated: false, rho_after: [0.75], max_rho: 0.75, max_rho_line: 'LINE_SIM',
                }),
            },
            combined_actions: {
                // Library key is non-canonical (r > n alphabetically)
                'reco_X+node_merging_Y': makeCombinedAction({
                    action1_id: 'reco_X', action2_id: 'node_merging_Y',
                    betas: [0.70, 0.81],
                }),
            },
        });
        const out = buildSessionResult({ ...baseInput, result });
        const saved = out.analysis!.combined_actions['reco_X+node_merging_Y'];
        expect(saved.is_simulated).toBe(true);
        expect(saved.simulated_max_rho).toBe(0.75);
        expect(saved.simulated_max_rho_line).toBe('LINE_SIM');
        // Betas should always be preserved from the estimation
        expect(saved.betas).toEqual([0.70, 0.81]);
    });

    it('preserves betas even when simulation data comes from canonical key lookup', () => {
        const result = makeResult({
            actions: {
                act_B: makeAction('B'),
                act_A: makeAction('A'),
                'act_A+act_B': makeAction('Combined', {
                    is_estimated: false, rho_after: [0.80], max_rho: 0.80, max_rho_line: 'LINE_D',
                }),
            },
            combined_actions: {
                'act_B+act_A': makeCombinedAction({
                    action1_id: 'act_B', action2_id: 'act_A',
                    betas: [0.88, 0.91],
                }),
            },
        });
        const out = buildSessionResult({ ...baseInput, result });
        const saved = out.analysis!.combined_actions['act_B+act_A'];
        expect(saved.betas).toEqual([0.88, 0.91]);
        expect(saved.is_simulated).toBe(true);
    });

    it('does not mark as simulated when canonical key has estimation-only data', () => {
        const result = makeResult({
            actions: {
                act_A: makeAction('A'),
                act_B: makeAction('B'),
                'act_A+act_B': makeAction('Est only', { is_estimated: true, rho_after: null }),
            },
            combined_actions: {
                'act_B+act_A': makeCombinedAction({ action1_id: 'act_B', action2_id: 'act_A' }),
            },
        });
        const out = buildSessionResult({ ...baseInput, result });
        const saved = out.analysis!.combined_actions['act_B+act_A'];
        expect(saved.is_simulated).toBe(false);
        expect(saved.simulated_max_rho).toBeNull();
    });

    it('combined_actions is empty object when result has no combined_actions', () => {
        const result = makeResult({ actions: { act1: makeAction('A') } });
        const out = buildSessionResult({ ...baseInput, result });
        expect(out.analysis!.combined_actions).toEqual({});
    });

    it('combined_actions is not present when analysis is null', () => {
        const out = buildSessionResult({ ...baseInput, result: null });
        expect(out.analysis).toBeNull();
    });
});

describe('buildSessionResult — interaction_log', () => {
    it('includes interaction_log when provided', () => {
        const log = [
            { seq: 0, timestamp: '2026-03-18T10:00:00.000Z', type: 'config_loaded' as const, details: { network_path: '/data/net.xiidm' }, correlation_id: 'abc' },
            { seq: 1, timestamp: '2026-03-18T10:01:00.000Z', type: 'contingency_selected' as const, details: { element: 'LINE_A' }, correlation_id: 'def' },
        ];
        const out = buildSessionResult({ ...baseInput, interactionLog: log });
        expect(out.interaction_log).toEqual(log);
        expect(out.interaction_log).toHaveLength(2);
    });

    it('interaction_log is empty array when no interactions recorded', () => {
        const out = buildSessionResult({ ...baseInput, interactionLog: [] });
        expect(out.interaction_log).toEqual([]);
    });

    it('interaction_log is independent of analysis result', () => {
        const log = [
            { seq: 0, timestamp: '2026-03-18T10:00:00.000Z', type: 'zoom_in' as const, details: {}, correlation_id: 'x' },
        ];
        const out = buildSessionResult({ ...baseInput, result: null, interactionLog: log });
        expect(out.analysis).toBeNull();
        expect(out.interaction_log).toHaveLength(1);
    });
});
