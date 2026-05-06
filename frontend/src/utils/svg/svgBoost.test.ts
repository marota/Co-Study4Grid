// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import { boostSvgForLargeGrid, processSvg } from './svgBoost';

describe('boostSvgForLargeGrid', () => {
    const stableSvg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000"><circle cx="10" cy="10" r="5"/></svg>';

    it('returns the input unchanged when viewBox is null', () => {
        expect(boostSvgForLargeGrid(stableSvg, null, 1000)).toBe(stableSvg);
    });

    it('returns the input unchanged for small grids (<500 VLs)', () => {
        const vb = { x: 0, y: 0, w: 20000, h: 20000 };
        expect(boostSvgForLargeGrid(stableSvg, vb, 100)).toBe(stableSvg);
    });

    it('returns the input unchanged when diagram size ratio is under threshold', () => {
        // ratio = 1000/1250 ≈ 0.8, below BOOST_THRESHOLD=3.
        const vb = { x: 0, y: 0, w: 1000, h: 1000 };
        expect(boostSvgForLargeGrid(stableSvg, vb, 1000)).toBe(stableSvg);
    });

    it('applies a milder scale to circle parents than to edge-info groups', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 20000">'
            + '<g><circle cx="10" cy="10" r="5"/></g>'
            + '<g class="nad-edge-infos"><g transform="translate(50,50)"/></g></svg>';
        const vb = { x: 0, y: 0, w: 20000, h: 20000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).not.toBe(svg);
        // ratio = 16 > 3, so boost = sqrt(16/3) ≈ 2.31. Node circles get the
        // damped factor sqrt(boost) ≈ 1.52 to avoid pushing neighbouring
        // nodes into each other on dense grids; edge-info groups (flow
        // arrows + values) keep the full boost so flow text stays readable.
        expect(out).toMatch(/translate\(10,10\) scale\(1\.52\)/);
        expect(out).toMatch(/translate\(50,50\) scale\(2\.31\)/);
    });
});

describe('processSvg', () => {
    it('parses a well-formed viewBox', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 300 400"/>';
        const { viewBox } = processSvg(svg, 100);
        expect(viewBox).toEqual({ x: 10, y: 20, w: 300, h: 400 });
    });

    it('returns a null viewBox when the attribute is missing', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"/>';
        const { viewBox, svg: out } = processSvg(svg, 100);
        expect(viewBox).toBeNull();
        expect(out).toBe(svg);
    });

    it('accepts a comma-separated viewBox', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0,0,100,100"/>';
        const { viewBox } = processSvg(svg, 100);
        expect(viewBox).toEqual({ x: 0, y: 0, w: 100, h: 100 });
    });
});
