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

    it('boosts circle parents and edge-info groups by the same node factor (gain ≈ 3.33)', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 20000">'
            + '<g><circle cx="10" cy="10" r="5"/></g>'
            + '<g class="nad-edge-infos"><g transform="translate(50,50)"/></g></svg>';
        const vb = { x: 0, y: 0, w: 20000, h: 20000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).not.toBe(svg);
        // ratio = 20000/1250 = 16 > 3, so boost = sqrt(16/3) ≈ 2.309.
        // nodeBoost = clamp(boost × 10/3, 0.5, 250) = 7.698 → "7.70".
        // Both VL nodes and flow-info groups scale by the same factor so
        // pypowsybl's fixed-size primitives become visible at typical
        // zoom levels on the Mercator-metres layout.
        expect(out).toMatch(/translate\(10,10\) scale\(7\.70\) translate\(-10,-10\)/);
        expect(out).toMatch(/translate\(50,50\) scale\(7\.70\)/);
    });

    it('clamps the node boost on a grid that just crossed the boost threshold', () => {
        // viewBox 5000 → ratio = 4, boost ≈ 1.155, gained = 3.849.
        // nodeBoost = clamp(3.849, 0.5, 250) = 3.849 → "3.85".
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000">'
            + '<g><circle cx="0" cy="0" r="27.5"/></g></svg>';
        const vb = { x: 0, y: 0, w: 5000, h: 5000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).toMatch(/scale\(3\.85\)/);
    });

    it('caps the node boost at the 250× ceiling on enormous grids', () => {
        // viewBox 100M → ratio = 80 000, boost ≈ 163.3, gained ≈ 544.
        // nodeBoost = clamp(544, 0.5, 250) = 250 → "250.00".
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100000000 100000000">'
            + '<g><circle cx="0" cy="0" r="27.5"/></g></svg>';
        const vb = { x: 0, y: 0, w: 100_000_000, h: 100_000_000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).toMatch(/scale\(250\.00\)/);
    });

    it('does NOT touch branch polylines in boost mode (line-extend / kink-drop / indicator-projection are shrink-only)', () => {
        // boost = 1.155, gained = 3.849 → nodeBoost = 3.849 ≥ 1, so the
        // SHRINK_BAND_AID gate turns off the line-extension, kink-drop,
        // and indicator-projection passes. The pypowsybl-emitted
        // endpoints already sit inside the boosted circle (which
        // renders larger than r=27.5), so leaving them alone lets the
        // fill cover the inner segment naturally — exactly the
        // operator-style rendering.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000">'
            + '<g class="nad-vl-nodes">'
            + '  <g transform="translate(0,0)" id="0">'
            + '    <circle r="27.5" class="nad-busnode"/>'
            + '  </g>'
            + '</g>'
            + '<g class="nad-branch-edges">'
            + '  <g id="b1">'
            + '    <polyline class="nad-edge-path" points="27.50,0.00 60.00,30.00 200.00,100.00"/>'
            + '  </g>'
            + '</g>'
            + '<g class="nad-edge-infos">'
            + '  <g id="info1" transform="translate(60,30)"><text>42</text></g>'
            + '</g></svg>';
        const vb = { x: 0, y: 0, w: 5000, h: 5000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        // Polyline points unchanged — all three vertices survive verbatim.
        expect(out).toMatch(/points="27\.50,0\.00 60\.00,30\.00 200\.00,100\.00"/);
        // Flow-indicator translate also unchanged (still 60,30) — but the
        // group now carries the gained boost scale appended by section 3.
        expect(out).toMatch(/translate\(60,30\) scale\(3\.85\)/);
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
