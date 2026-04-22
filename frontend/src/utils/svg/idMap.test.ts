// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { getIdMap, invalidateIdMapCache } from './idMap';

const makeContainer = (innerHtml: string): HTMLElement => {
    const div = document.createElement('div');
    div.innerHTML = innerHtml;
    return div;
};

describe('getIdMap', () => {
    it('collects every id-bearing descendant', () => {
        const c = makeContainer(`
            <svg><g id="a"><circle id="b"/></g><text id="c"/></svg>
        `);
        const map = getIdMap(c);
        expect(map.size).toBe(3);
        expect(map.get('a')?.tagName).toBe('g');
        expect(map.get('b')?.tagName).toBe('circle');
        expect(map.get('c')?.tagName).toBe('text');
    });

    it('returns the same Map instance on repeated calls (cache hit)', () => {
        const c = makeContainer('<svg><g id="x"/></svg>');
        const a = getIdMap(c);
        const b = getIdMap(c);
        expect(a).toBe(b);
    });

    it('rebuilds the map when the inner <svg> element identity changes', () => {
        const c = makeContainer('<svg><g id="x"/></svg>');
        const a = getIdMap(c);
        // Swap the svg for a fresh one — simulates a new diagram being injected.
        c.innerHTML = '<svg><g id="y"/></svg>';
        const b = getIdMap(c);
        expect(a).not.toBe(b);
        expect(b.has('y')).toBe(true);
        expect(b.has('x')).toBe(false);
    });

    it('invalidateIdMapCache drops the cached entry', () => {
        const c = makeContainer('<svg><g id="x"/></svg>');
        const a = getIdMap(c);
        invalidateIdMapCache(c);
        const b = getIdMap(c);
        expect(a).not.toBe(b);
        expect(b.has('x')).toBe(true);
    });

    it('handles containers with no SVG gracefully', () => {
        const c = makeContainer('<div id="x"/>');
        const map = getIdMap(c);
        expect(map.has('x')).toBe(true);
    });
});
