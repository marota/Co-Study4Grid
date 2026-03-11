import { describe, it, expect } from 'vitest';
import { buildSessionResult } from './sessionUtils';
import type { SessionInput } from './sessionUtils';
import type { AnalysisResult, ActionDetail } from '../types';

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
    minLineReconnections: 2.0,
    minCloseCoupling: 3.0,
    minOpenCoupling: 2.0,
    minLineDisconnections: 3.0,
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
            min_line_reconnections: 2.0,
            min_close_coupling: 3.0,
            min_open_coupling: 2.0,
            min_line_disconnections: 3.0,
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
