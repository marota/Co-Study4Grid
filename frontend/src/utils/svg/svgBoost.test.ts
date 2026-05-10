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

    it('boosts circle parents and edge-info groups by the same node factor on a moderately large grid', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20000 20000">'
            + '<g><circle cx="10" cy="10" r="5"/></g>'
            + '<g class="nad-edge-infos"><g transform="translate(50,50)"/></g></svg>';
        const vb = { x: 0, y: 0, w: 20000, h: 20000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).not.toBe(svg);
        // ratio = 20000/1250 = 16 > 3, so boost = sqrt(16/3) ≈ 2.309.
        // nodeBoost = clamp((boost − 1.5) × 10/3 + 1, 1, 250) = 3.696 → "3.70".
        // Both VL nodes and flow-info groups scale by the same factor so
        // pypowsybl's fixed-size primitives stay readable at typical
        // zoom levels on the Mercator-metres layout.
        expect(out).toMatch(/translate\(10,10\) scale\(3\.70\) translate\(-10,-10\)/);
        expect(out).toMatch(/translate\(50,50\) scale\(3\.70\)/);
    });

    it('falls back to native rendering (nodeBoost = 1) on a small viewBox just past the threshold', () => {
        // viewBox 5000 → ratio = 4, boost ≈ 1.155, (boost − 1.5) × 10/3 + 1
        // ≈ -0.15 → floored to 1.00 → native pypowsybl rendering. This is
        // the operator-feedback case: bare_env-style grids (small viewBox
        // but vlCount ≥ 500) used to over-amplify with the iteration-2
        // formula; the offset clamps them back to native size.
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 5000 5000">'
            + '<g><circle cx="0" cy="0" r="27.5"/></g></svg>';
        const vb = { x: 0, y: 0, w: 5000, h: 5000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).toMatch(/scale\(1\.00\)/);
    });

    it('falls back to native rendering on a bare_env-style 8 K-wide layout', () => {
        // viewBox 8000 → boost ≈ 1.461, (1.461 − 1.5) × 10/3 + 1 ≈ 0.87
        // → floored to 1.00. Pins the explicit operator-reported case
        // (1.7 % r/viewBox blob rendering would return if this regresses).
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8000 8000">'
            + '<g><circle cx="0" cy="0" r="27.5"/></g></svg>';
        const vb = { x: 0, y: 0, w: 8000, h: 8000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).toMatch(/scale\(1\.00\)/);
    });

    it('caps the node boost at the 250× ceiling on enormous grids', () => {
        // viewBox 100M → ratio = 80 000, boost ≈ 163.3, (boost − 1.5) × 10/3
        // + 1 ≈ 540, capped at 250 → "250.00".
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100000000 100000000">'
            + '<g><circle cx="0" cy="0" r="27.5"/></g></svg>';
        const vb = { x: 0, y: 0, w: 100_000_000, h: 100_000_000 };
        const out = boostSvgForLargeGrid(svg, vb, 1000);
        expect(out).toMatch(/scale\(250\.00\)/);
    });

    it('preserves the iteration-2 calibration on French (1.4 M) and European (4.4 M) grids', () => {
        // Regression guard: the offset/floor only kick in for small
        // viewBoxes. On the Mercator-metres PyPSA grids the formula
        // drifts by < 7 % from the previous calibration that the
        // operator confirmed as well-sized. If anyone bumps OFFSET
        // / FLOOR / GAIN without intent, these assertions catch it.
        const make = (span: number) =>
            `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${span} ${span}">`
            + '<g><circle cx="0" cy="0" r="27.5"/></g></svg>';

        // fr225_400-ish: boost = sqrt(1.4M/3750) ≈ 19.32, formula ≈ 60.4
        // (was 64.4 with plain boost × 10/3 — drift -6.2 %).
        const fr = boostSvgForLargeGrid(make(1_400_000), { x: 0, y: 0, w: 1_400_000, h: 1_400_000 }, 1000);
        expect(fr).toMatch(/scale\(60\.41\)/);

        // European-ish: boost ≈ 34.25, formula ≈ 110.2 (was 114.2 — drift -3.5 %).
        const eu = boostSvgForLargeGrid(make(4_400_000), { x: 0, y: 0, w: 4_400_000, h: 4_400_000 }, 1000);
        expect(eu).toMatch(/scale\(110\.18\)/);
    });

    it('does NOT touch branch polylines in boost mode (line-extend / kink-drop / indicator-projection are shrink-only)', () => {
        // viewBox 5000 falls below the OFFSET, so nodeBoost is floored
        // at 1 (native pypowsybl rendering). With FLOOR = 1 the
        // SHRINK_BAND_AID gate is never tripped — line-extension,
        // kink-drop, and indicator-projection passes (designed for the
        // old shrink regime, nodeBoost < 1) stay off, and the
        // pypowsybl-emitted geometry is preserved verbatim.
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
        // viewBox 5000 → nodeBoost floored at 1 → scale(1.00).
        expect(out).toMatch(/translate\(60,30\) scale\(1\.00\)/);
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
