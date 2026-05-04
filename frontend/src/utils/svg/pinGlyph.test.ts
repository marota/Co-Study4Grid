// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
    createPinGlyph,
    pinStarPath,
    pinCrossPath,
    resolvePinFill,
    SEVERITY_FILL,
    SEVERITY_FILL_DIMMED,
    SEVERITY_FILL_HIGHLIGHTED,
} from './pinGlyph';
import { pinColors, pinColorsDimmed, pinColorsHighlighted } from '../../styles/tokens';

describe('pinGlyph palette parity with design tokens', () => {
    // The palette in pinGlyph.js is duplicated by necessity (the
    // file is read raw by the backend). This regression test fails
    // loudly if either side drifts from the design-token source.
    it('SEVERITY_FILL mirrors pinColors', () => {
        expect(SEVERITY_FILL).toEqual({ ...pinColors });
    });
    it('SEVERITY_FILL_DIMMED mirrors pinColorsDimmed', () => {
        expect(SEVERITY_FILL_DIMMED).toEqual({ ...pinColorsDimmed });
    });
    it('SEVERITY_FILL_HIGHLIGHTED mirrors pinColorsHighlighted', () => {
        expect(SEVERITY_FILL_HIGHLIGHTED).toEqual({ ...pinColorsHighlighted });
    });
});

describe('resolvePinFill', () => {
    it('returns highlighted hex when isSelected', () => {
        expect(resolvePinFill('orange', true, false, false))
            .toBe(SEVERITY_FILL_HIGHLIGHTED.orange);
    });
    it('returns dimmed hex when isRejected', () => {
        expect(resolvePinFill('red', false, true, false))
            .toBe(SEVERITY_FILL_DIMMED.red);
    });
    it('returns dimmed hex when only dimmed flag is set', () => {
        expect(resolvePinFill('green', false, false, true))
            .toBe(SEVERITY_FILL_DIMMED.green);
    });
    it('returns base hex by default', () => {
        expect(resolvePinFill('grey', false, false, false))
            .toBe(SEVERITY_FILL.grey);
    });
    it('falls back to grey when severity is unknown', () => {
        expect(resolvePinFill('unknown' as unknown as 'grey', false, false, false))
            .toBe(SEVERITY_FILL.grey);
    });
});

describe('pinStarPath / pinCrossPath', () => {
    it('star path closes its sub-path', () => {
        const d = pinStarPath(0, 0, 10);
        expect(d.startsWith('M')).toBe(true);
        expect(d.endsWith('Z')).toBe(true);
    });
    it('cross path closes its sub-path', () => {
        const d = pinCrossPath(0, 0, 10);
        expect(d.startsWith('M')).toBe(true);
        expect(d.endsWith('Z')).toBe(true);
    });
});

describe('createPinGlyph', () => {
    const SVG_NS = 'http://www.w3.org/2000/svg';

    const makeSvg = () => {
        const svg = document.createElementNS(SVG_NS, 'svg');
        document.body.appendChild(svg);
        return svg;
    };

    it('builds an SVG <g> with the expected chrome layers', () => {
        const svg = makeSvg();
        const g = createPinGlyph(document, {
            severity: 'orange',
            label: '92%',
            r: 20,
            actionId: 'A1',
        });
        svg.appendChild(g);
        // Body group + path + chrome circle + label text.
        expect(g.getAttribute('data-action-id')).toBe('A1');
        expect(g.getAttribute('data-severity')).toBe('orange');
        expect(g.querySelector('path')).toBeTruthy();
        expect(g.querySelector('circle')).toBeTruthy();
        const text = g.querySelector('text');
        expect(text?.textContent).toBe('92%');
    });

    it('adds a star symbol when isSelected', () => {
        const svg = makeSvg();
        const g = createPinGlyph(document, {
            severity: 'green', label: '50%', r: 20, isSelected: true,
        });
        svg.appendChild(g);
        // Star is a separate <path> on top of the body path. Two
        // paths in total: bubble + star.
        expect(g.querySelectorAll('path').length).toBe(2);
        expect(g.getAttribute('data-selected')).toBe('true');
    });

    it('adds a cross symbol and dim opacity when isRejected', () => {
        const svg = makeSvg();
        const g = createPinGlyph(document, {
            severity: 'red', label: '88%', r: 20, isRejected: true,
        });
        svg.appendChild(g);
        expect(g.querySelectorAll('path').length).toBe(2);
        expect(g.getAttribute('data-rejected')).toBe('true');
        expect(g.getAttribute('opacity')).toBe('0.55');
    });

    it('uses the dimmed palette when only `dimmed` is set', () => {
        const svg = makeSvg();
        const g = createPinGlyph(document, {
            severity: 'green', label: '12%', r: 20, dimmed: true,
        });
        svg.appendChild(g);
        const bodyPath = g.querySelector('path');
        expect(bodyPath?.getAttribute('fill')).toBe(SEVERITY_FILL_DIMMED.green);
        expect(g.getAttribute('opacity')).toBe('0.4');
    });
});
