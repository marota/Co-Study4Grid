// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePanZoom } from './usePanZoom';
import type { ViewBox } from '../types';

/**
 * Tests for usePanZoom hook — focused on the useLayoutEffect optimizations:
 * - applyViewBox runs before paint when tab becomes active
 * - viewBox is applied to SVG DOM element directly
 * - setViewBox updates both ref and React state
 */

function createMockSvgContainer(viewBox?: string) {
    const container = document.createElement('div');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    if (viewBox) svg.setAttribute('viewBox', viewBox);
    container.appendChild(svg);
    return { container, svg };
}

describe('usePanZoom', () => {
    const initialVB: ViewBox = { x: 0, y: 0, w: 1000, h: 800 };

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('returns null viewBox when initialViewBox is null', () => {
        const ref = { current: document.createElement('div') };
        const { result } = renderHook(() => usePanZoom(ref, null, true));
        expect(result.current.viewBox).toBeNull();
    });

    it('syncs viewBox from initialViewBox on mount', () => {
        const { container, svg } = createMockSvgContainer('0 0 500 500');
        const ref = { current: container };

        const { result } = renderHook(() => usePanZoom(ref, initialVB, true));

        expect(result.current.viewBox).toEqual(initialVB);
        expect(svg.getAttribute('viewBox')).toBe('0 0 1000 800');
    });

    it('applies viewBox to SVG DOM when becoming active (useLayoutEffect)', () => {
        const { container, svg } = createMockSvgContainer('0 0 500 500');
        const ref = { current: container };

        // Start inactive
        const { result, rerender } = renderHook(
            ({ active }) => usePanZoom(ref, initialVB, active),
            { initialProps: { active: false } }
        );

        // Initial viewBox is set even when inactive (via initialViewBox effect)
        expect(result.current.viewBox).toEqual(initialVB);

        // Now become active — useLayoutEffect should apply viewBox before paint
        rerender({ active: true });
        expect(svg.getAttribute('viewBox')).toBe('0 0 1000 800');
    });

    it('setViewBox updates both DOM and React state', () => {
        const { container, svg } = createMockSvgContainer('0 0 500 500');
        const ref = { current: container };

        const { result } = renderHook(() => usePanZoom(ref, initialVB, true));

        const newVB: ViewBox = { x: 100, y: 200, w: 500, h: 400 };
        act(() => {
            result.current.setViewBox(newVB);
        });

        expect(result.current.viewBox).toEqual(newVB);
        expect(svg.getAttribute('viewBox')).toBe('100 200 500 400');
    });

    it('preserves viewBox across active/inactive transitions', () => {
        const { container, svg } = createMockSvgContainer('0 0 500 500');
        const ref = { current: container };

        const { result, rerender } = renderHook(
            ({ active }) => usePanZoom(ref, initialVB, active),
            { initialProps: { active: true } }
        );

        // Set a custom viewBox
        const customVB: ViewBox = { x: 50, y: 50, w: 300, h: 200 };
        act(() => {
            result.current.setViewBox(customVB);
        });
        expect(svg.getAttribute('viewBox')).toBe('50 50 300 200');

        // Deactivate
        rerender({ active: false });

        // Reactivate — should restore the custom viewBox
        rerender({ active: true });
        expect(svg.getAttribute('viewBox')).toBe('50 50 300 200');
    });

    it('updates viewBox when initialViewBox changes (new diagram loaded)', () => {
        const { container, svg } = createMockSvgContainer('0 0 500 500');
        const ref = { current: container };

        const { result, rerender } = renderHook(
            ({ ivb }) => usePanZoom(ref, ivb, true),
            { initialProps: { ivb: initialVB as ViewBox | null } }
        );

        expect(result.current.viewBox).toEqual(initialVB);

        const newIVB: ViewBox = { x: 0, y: 0, w: 2000, h: 1600 };
        rerender({ ivb: newIVB });

        expect(result.current.viewBox).toEqual(newIVB);
        expect(svg.getAttribute('viewBox')).toBe('0 0 2000 1600');
    });

    it('does not crash when svgRef is null', () => {
        const ref = { current: null };
        const { result } = renderHook(() => usePanZoom(ref, initialVB, true));
        expect(result.current.viewBox).toEqual(initialVB);
    });


    describe('svg-interacting class toggle', () => {
        it('does not have svg-interacting class initially', () => {
            const { container } = createMockSvgContainer('0 0 1000 800');
            const ref = { current: container };

            renderHook(() => usePanZoom(ref, initialVB, true));

            expect(container.classList.contains('svg-interacting')).toBe(false);
        });
    });

    describe('CTM cache invalidation', () => {
        it('setViewBox applies viewBox to DOM (which invalidates cached CTM)', () => {
            const { container, svg } = createMockSvgContainer('0 0 1000 800');
            const ref = { current: container };

            const { result } = renderHook(() => usePanZoom(ref, initialVB, true));

            // Simulate zoom by setting a smaller viewBox
            const zoomedVB: ViewBox = { x: 200, y: 200, w: 400, h: 300 };
            act(() => {
                result.current.setViewBox(zoomedVB);
            });

            // viewBox should update in DOM
            expect(svg.getAttribute('viewBox')).toBe('200 200 400 300');

            // Set another viewBox — each call invalidates cached CTM
            const zoomedVB2: ViewBox = { x: 300, y: 300, w: 200, h: 150 };
            act(() => {
                result.current.setViewBox(zoomedVB2);
            });

            expect(svg.getAttribute('viewBox')).toBe('300 300 200 150');
            expect(result.current.viewBox).toEqual(zoomedVB2);
        });
    });

    describe('regression: multiple rapid active/inactive transitions', () => {
        it('does not corrupt viewBox after rapid tab switching', () => {
            const { container, svg } = createMockSvgContainer('0 0 500 500');
            const ref = { current: container };

            const { result, rerender } = renderHook(
                ({ active }) => usePanZoom(ref, initialVB, active),
                { initialProps: { active: true } }
            );

            // Set a custom zoom
            const zoomedVB: ViewBox = { x: 100, y: 100, w: 200, h: 200 };
            act(() => {
                result.current.setViewBox(zoomedVB);
            });

            // Rapid tab switch simulation
            rerender({ active: false });
            rerender({ active: true });
            rerender({ active: false });
            rerender({ active: true });

            // ViewBox should be preserved through all transitions
            expect(svg.getAttribute('viewBox')).toBe('100 100 200 200');
            expect(result.current.viewBox).toEqual(zoomedVB);
        });
    });
});
