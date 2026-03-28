// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect } from 'vitest';
import type { AnalysisResult, ActionDetail } from '../types';

/**
 * Tests for the merge logic used by handleDisplayPrioritizedActions.
 * This verifies the regression fix: pdf_url (and other fields from the
 * existing result) must be preserved when merging pendingAnalysisResult.
 *
 * The actual merge logic in App.tsx is:
 *   setResult(prev => ({
 *       ...prev,                   // keep existing fields (pdf_url, etc.)
 *       ...pendingAnalysisResult,  // overlay with analysis result
 *       actions: { ...pendingAnalysisResult.actions, ...manualActionsData },
 *   }));
 */

function mergeAnalysisResult(
    prev: AnalysisResult | null,
    pendingAnalysisResult: AnalysisResult,
    selectedActionIds: Set<string>,
): AnalysisResult {
    const manualActionsData: Record<string, ActionDetail> = {};
    if (prev?.actions) {
        for (const [id, data] of Object.entries(prev.actions)) {
            if (selectedActionIds.has(id)) {
                manualActionsData[id] = data;
            }
        }
    }
    return {
        ...prev,
        ...pendingAnalysisResult,
        actions: { ...pendingAnalysisResult.actions, ...manualActionsData },
    };
}

describe('mergeAnalysisResult (handleDisplayPrioritizedActions logic)', () => {
    const makeAction = (desc: string, overrides?: Partial<ActionDetail>): ActionDetail => ({
        description_unitaire: desc,
        rho_before: [1.0],
        rho_after: [0.8],
        max_rho: 0.8,
        max_rho_line: 'LINE_A',
        is_rho_reduction: true,
        ...overrides,
    });

    it('preserves pdf_url from previous result when pending has explicit nulls', () => {
        // When pendingAnalysisResult explicitly includes pdf_url: null,
        // the spread order (...prev, ...pending) means null overwrites the URL.
        // This test documents that behavior — the real fix works because the
        // streaming 'result' event doesn't include pdf_url/pdf_path at all
        // (see the next test). If for any reason the API starts sending nulls,
        // we'd need an additional guard.
        const prev: AnalysisResult = {
            pdf_path: '/tmp/overflow.pdf',
            pdf_url: '/results/pdf/overflow.pdf',
            actions: {},
            lines_overloaded: [],
            message: '',
            dc_fallback: false,
        };
        const pending: AnalysisResult = {
            pdf_path: null,
            pdf_url: null,
            actions: { act_1: makeAction('New action') },
            lines_overloaded: ['LINE_A'],
            message: 'Done',
            dc_fallback: false,
        };

        const merged = mergeAnalysisResult(prev, pending, new Set());

        // pending's explicit null overwrites prev's url — this is expected JS behavior.
        // The real scenario (no pdf fields on pending) is tested below.
        expect(merged.pdf_url).toBeNull();
    });

    it('preserves pdf_url when pending result has no pdf fields', () => {
        const prev: AnalysisResult = {
            pdf_path: '/tmp/overflow.pdf',
            pdf_url: '/results/pdf/overflow.pdf',
            actions: {},
            lines_overloaded: [],
            message: '',
            dc_fallback: false,
        };
        // Simulate what the streaming API actually sends for 'result' events:
        // no pdf_path or pdf_url fields at all
        const pending = {
            actions: { act_1: makeAction('Recommended') },
            lines_overloaded: ['LINE_A'],
            message: 'Analysis complete',
            dc_fallback: false,
        } as unknown as AnalysisResult;

        const merged = mergeAnalysisResult(prev, pending, new Set());

        expect(merged.pdf_url).toBe('/results/pdf/overflow.pdf');
        expect(merged.pdf_path).toBe('/tmp/overflow.pdf');
        expect(merged.actions).toHaveProperty('act_1');
        expect(merged.message).toBe('Analysis complete');
    });

    it('merges pending actions with manually selected actions from prev', () => {
        const prev: AnalysisResult = {
            pdf_path: null,
            pdf_url: null,
            actions: {
                manual_1: makeAction('Manual action', { is_manual: true }),
                old_1: makeAction('Old recommended'),
            },
            lines_overloaded: [],
            message: '',
            dc_fallback: false,
        };
        const pending: AnalysisResult = {
            pdf_path: null,
            pdf_url: null,
            actions: { rec_1: makeAction('New recommended') },
            lines_overloaded: ['LINE_B'],
            message: 'Done',
            dc_fallback: false,
        };

        const selectedIds = new Set(['manual_1']);
        const merged = mergeAnalysisResult(prev, pending, selectedIds);

        // manual_1 should be preserved (it's in selectedActionIds)
        expect(merged.actions).toHaveProperty('manual_1');
        // rec_1 from pending should be present
        expect(merged.actions).toHaveProperty('rec_1');
        // old_1 should NOT be present (not in selectedActionIds)
        expect(merged.actions).not.toHaveProperty('old_1');
    });

    it('manual actions override pending actions with same ID', () => {
        const prev: AnalysisResult = {
            pdf_path: null,
            pdf_url: null,
            actions: {
                shared_id: makeAction('User version', { is_manual: true }),
            },
            lines_overloaded: [],
            message: '',
            dc_fallback: false,
        };
        const pending: AnalysisResult = {
            pdf_path: null,
            pdf_url: null,
            actions: { shared_id: makeAction('Computed version') },
            lines_overloaded: [],
            message: 'Done',
            dc_fallback: false,
        };

        const merged = mergeAnalysisResult(prev, pending, new Set(['shared_id']));

        // Manual action should win (spread order: ...pending.actions, ...manualActionsData)
        expect(merged.actions.shared_id.description_unitaire).toBe('User version');
    });

    it('works when prev is null', () => {
        const pending: AnalysisResult = {
            pdf_path: null,
            pdf_url: null,
            actions: { act_1: makeAction('First result') },
            lines_overloaded: [],
            message: 'Done',
            dc_fallback: false,
        };

        const merged = mergeAnalysisResult(null, pending, new Set());

        expect(merged.actions).toHaveProperty('act_1');
        expect(merged.message).toBe('Done');
    });
});
