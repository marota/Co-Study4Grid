// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect } from 'vitest';
import { computeN1OverloadHighlights } from './overloadHighlights';

describe('computeN1OverloadHighlights', () => {
    // Regression: N-1 overload halos must appear on the N-1 tab as
    // soon as the contingency diagram comes back from the backend —
    // before any "Analyze & Suggest" run. The previous implementation
    // sourced the highlight list strictly from `result.lines_overloaded`
    // (only populated post-analysis), so the orange halos never showed
    // up on the freshly-loaded N-1 view. The fix adds a fallback to
    // `n1Diagram.lines_overloaded`, which is the early source.

    it('falls back to the N-1 diagram overloads when no analysis result is available yet', () => {
        const result = computeN1OverloadHighlights(
            null,                              // no analysis result yet
            ['LINE_OL_A', 'LINE_OL_B'],        // straight from the N-1 fetch
            new Set(),                         // user has not narrowed the selection
        );
        expect(result).toEqual(['LINE_OL_A', 'LINE_OL_B']);
    });

    it('also falls back when the analysis-result overloads array is empty', () => {
        const result = computeN1OverloadHighlights(
            [],                                // analysis ran but found nothing
            ['LINE_OL_A'],                     // n1Diagram still has overloads
            new Set(),
        );
        expect(result).toEqual(['LINE_OL_A']);
    });

    it('uses the analysis-result overloads when populated (they override the n1Diagram fallback)', () => {
        const result = computeN1OverloadHighlights(
            ['LINE_AFTER_ANALYSIS'],
            ['LINE_OL_A', 'LINE_OL_B'],
            new Set(),
        );
        expect(result).toEqual(['LINE_AFTER_ANALYSIS']);
    });

    it('filters the source list down to user-selected overloads when the selection set is non-empty', () => {
        const result = computeN1OverloadHighlights(
            null,
            ['LINE_OL_A', 'LINE_OL_B', 'LINE_OL_C'],
            new Set(['LINE_OL_B']),
        );
        expect(result).toEqual(['LINE_OL_B']);
    });

    it('treats an empty selection set as "no explicit selection yet" (highlight everything)', () => {
        const result = computeN1OverloadHighlights(
            null,
            ['LINE_OL_A', 'LINE_OL_B'],
            new Set(),
        );
        expect(result).toEqual(['LINE_OL_A', 'LINE_OL_B']);
    });

    it('returns an empty list when both sources are empty', () => {
        expect(computeN1OverloadHighlights(null, null, new Set())).toEqual([]);
        expect(computeN1OverloadHighlights([], [], new Set())).toEqual([]);
        expect(computeN1OverloadHighlights(undefined, undefined, new Set())).toEqual([]);
    });

    it('returns an empty list when the user selection has no intersection with the source overloads', () => {
        const result = computeN1OverloadHighlights(
            null,
            ['LINE_OL_A'],
            new Set(['LINE_NOT_IN_LIST']),
        );
        expect(result).toEqual([]);
    });

    it('respects user selection even after analysis result populates', () => {
        const result = computeN1OverloadHighlights(
            ['LINE_OL_A', 'LINE_OL_B'],
            ['LINE_OL_A', 'LINE_OL_B', 'LINE_OL_C'],
            new Set(['LINE_OL_A']),
        );
        expect(result).toEqual(['LINE_OL_A']);
    });
});
