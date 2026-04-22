// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect } from 'vitest';
import {
    decidePopoverPlacement,
    computePopoverStyle,
    POPOVER_WIDTH,
    POPOVER_MAX_HEIGHT,
    POPOVER_PIN_OFFSET,
    POPOVER_VIEWPORT_MARGIN,
} from './popoverPlacement';

const VIEWPORT = { width: 1600, height: 900 };

describe('decidePopoverPlacement', () => {
    describe('vertical', () => {
        it('places BELOW when there is plenty of room below the pin', () => {
            // Pin near the top → spaceBelow >> POPOVER_MAX_HEIGHT
            const p = decidePopoverPlacement(800, 50, VIEWPORT);
            expect(p.placeAbove).toBe(false);
        });

        it('places ABOVE when the pin is at the bottom (no room below for the popover)', () => {
            const p = decidePopoverPlacement(800, VIEWPORT.height - 30, VIEWPORT);
            expect(p.placeAbove).toBe(true);
        });

        it('falls back to whichever side has more room when neither fits the full max-height', () => {
            // Tiny viewport so neither side can fit POPOVER_MAX_HEIGHT
            const tinyViewport = { width: 1600, height: 300 };
            // Pin closer to the bottom → spaceAbove > spaceBelow → above wins
            const lower = decidePopoverPlacement(800, 220, tinyViewport);
            expect(lower.placeAbove).toBe(true);
            // Pin closer to the top → spaceBelow > spaceAbove → below wins
            const upper = decidePopoverPlacement(800, 80, tinyViewport);
            expect(upper.placeAbove).toBe(false);
        });
    });

    describe('horizontal', () => {
        it('aligns START when the pin is in the LEFT third of the viewport', () => {
            const p = decidePopoverPlacement(300, 400, VIEWPORT);
            expect(p.horizontalAlign).toBe('start');
        });

        it('aligns CENTER when the pin is in the MIDDLE third of the viewport', () => {
            const p = decidePopoverPlacement(800, 400, VIEWPORT);
            expect(p.horizontalAlign).toBe('center');
        });

        it('aligns END when the pin is in the RIGHT third of the viewport', () => {
            const p = decidePopoverPlacement(1300, 400, VIEWPORT);
            expect(p.horizontalAlign).toBe('end');
        });
    });
});

describe('computePopoverStyle', () => {
    it('uses `top` when placing BELOW the pin', () => {
        const style = computePopoverStyle({
            screenX: 800,
            screenY: 100,
            placeAbove: false,
            horizontalAlign: 'center',
        }, VIEWPORT);
        expect(style.position).toBe('fixed');
        expect(style.top).toBe(100 + POPOVER_PIN_OFFSET);
        expect(style.bottom).toBeUndefined();
    });

    it('uses `bottom` (not `top`) when placing ABOVE the pin so the bottom edge anchors at the pin', () => {
        const style = computePopoverStyle({
            screenX: 800,
            screenY: 800,
            placeAbove: true,
            horizontalAlign: 'center',
        }, VIEWPORT);
        expect(style.bottom).toBe(VIEWPORT.height - 800 + POPOVER_PIN_OFFSET);
        expect(style.top).toBeUndefined();
    });

    it('horizontal alignment START offsets the popover to the right of the pin', () => {
        const style = computePopoverStyle({
            screenX: 200,
            screenY: 400,
            placeAbove: false,
            horizontalAlign: 'start',
        }, VIEWPORT);
        // start: left edge ≈ pin.x - POPOVER_PIN_OFFSET
        expect(style.left).toBe(200 - POPOVER_PIN_OFFSET);
    });

    it('horizontal alignment END puts the popover to the left of the pin', () => {
        const style = computePopoverStyle({
            screenX: 1400,
            screenY: 400,
            placeAbove: false,
            horizontalAlign: 'end',
        }, VIEWPORT);
        // end: left edge = pin.x - POPOVER_WIDTH + POPOVER_PIN_OFFSET
        expect(style.left).toBe(1400 - POPOVER_WIDTH + POPOVER_PIN_OFFSET);
    });

    it('horizontal alignment CENTER centres the popover on the pin', () => {
        const style = computePopoverStyle({
            screenX: 800,
            screenY: 400,
            placeAbove: false,
            horizontalAlign: 'center',
        }, VIEWPORT);
        expect(style.left).toBe(800 - POPOVER_WIDTH / 2);
    });

    it('clamps the popover to the LEFT viewport edge when the requested left would go negative', () => {
        const style = computePopoverStyle({
            screenX: 5,
            screenY: 400,
            placeAbove: false,
            horizontalAlign: 'center',
        }, VIEWPORT);
        expect(style.left).toBe(POPOVER_VIEWPORT_MARGIN);
    });

    it('clamps the popover to the RIGHT viewport edge when the requested left would overflow', () => {
        const style = computePopoverStyle({
            screenX: VIEWPORT.width - 5,
            screenY: 400,
            placeAbove: false,
            horizontalAlign: 'center',
        }, VIEWPORT);
        expect(style.left).toBe(VIEWPORT.width - POPOVER_WIDTH - POPOVER_VIEWPORT_MARGIN);
    });

    it('end-to-end: a pin in the BOTTOM-RIGHT corner produces an above + end placement that stays in viewport', () => {
        const placement = decidePopoverPlacement(VIEWPORT.width - 50, VIEWPORT.height - 50, VIEWPORT);
        expect(placement.placeAbove).toBe(true);
        expect(placement.horizontalAlign).toBe('end');
        const style = computePopoverStyle({
            screenX: VIEWPORT.width - 50,
            screenY: VIEWPORT.height - 50,
            ...placement,
        }, VIEWPORT);
        // Above placement → uses bottom (not top)
        expect(style.bottom).toBeDefined();
        // End placement clamps inside the right edge
        const left = style.left as number;
        expect(left).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
        expect(left + POPOVER_WIDTH).toBeLessThanOrEqual(VIEWPORT.width - POPOVER_VIEWPORT_MARGIN);
    });

    it('end-to-end: a pin in the TOP-LEFT corner produces a below + start placement that stays in viewport', () => {
        const placement = decidePopoverPlacement(40, 40, VIEWPORT);
        expect(placement.placeAbove).toBe(false);
        expect(placement.horizontalAlign).toBe('start');
        const style = computePopoverStyle({
            screenX: 40,
            screenY: 40,
            ...placement,
        }, VIEWPORT);
        expect(style.top).toBe(40 + POPOVER_PIN_OFFSET);
        const left = style.left as number;
        expect(left).toBeGreaterThanOrEqual(POPOVER_VIEWPORT_MARGIN);
        expect(left + POPOVER_WIDTH).toBeLessThanOrEqual(VIEWPORT.width - POPOVER_VIEWPORT_MARGIN);
    });

    it('exports placement constants for downstream consumers', () => {
        expect(POPOVER_WIDTH).toBe(340);
        expect(POPOVER_MAX_HEIGHT).toBe(480);
    });
});

describe('detached-window viewport handling', () => {
    // Regression: in a detached popup the main-window viewport is
    // irrelevant — the component must pass the popup's viewport so
    // the above/below decision reflects the pin's actual on-screen
    // position. These tests feed an explicit viewport to mimic the
    // popup-window dimensions.
    it('same pin Y is "BELOW" in a tall popup but "ABOVE" in a short popup', () => {
        const pinY = 600;
        const tall = decidePopoverPlacement(800, pinY, { width: 1600, height: 1400 });
        expect(tall.placeAbove).toBe(false);
        const short = decidePopoverPlacement(800, pinY, { width: 1600, height: 700 });
        expect(short.placeAbove).toBe(true);
    });

    it('computes `bottom` anchor using the explicit viewport height, not main-window height', () => {
        const popupViewport = { width: 1200, height: 600 };
        const style = computePopoverStyle({
            screenX: 800,
            screenY: 550,
            placeAbove: true,
            horizontalAlign: 'center',
        }, popupViewport);
        // `bottom` must use the popup height (600), not whatever
        // the default (main window) viewport is.
        expect(style.bottom).toBe(popupViewport.height - 550 + POPOVER_PIN_OFFSET);
    });

    it('horizontal clamp uses the explicit viewport width', () => {
        const popupViewport = { width: 900, height: 600 };
        const style = computePopoverStyle({
            screenX: popupViewport.width - 10,
            screenY: 300,
            placeAbove: false,
            horizontalAlign: 'center',
        }, popupViewport);
        expect(style.left).toBe(popupViewport.width - POPOVER_WIDTH - POPOVER_VIEWPORT_MARGIN);
    });
});
