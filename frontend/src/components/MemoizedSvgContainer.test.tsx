// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import MemoizedSvgContainer from './MemoizedSvgContainer';

describe('MemoizedSvgContainer', () => {
    it('renders a container div with correct id and class', () => {
        const containerRef = createRef<HTMLDivElement>();
        const { container } = render(
            <MemoizedSvgContainer svg="" containerRef={containerRef} display="block" tabId="n" />
        );
        const el = container.querySelector('#n-svg-container');
        expect(el).toBeInTheDocument();
        expect(el).toHaveClass('svg-container');
    });

    it('sets display style based on prop', () => {
        const containerRef = createRef<HTMLDivElement>();
        const { container } = render(
            <MemoizedSvgContainer svg="" containerRef={containerRef} display="none" tabId="n-1" />
        );
        const el = container.querySelector('#n-1-svg-container') as HTMLElement;
        expect(el.style.display).toBe('none');
    });

    it('injects string SVG into container via innerHTML', () => {
        const containerRef = createRef<HTMLDivElement>();
        const svgString = '<svg><circle r="10"/></svg>';
        render(
            <MemoizedSvgContainer svg={svgString} containerRef={containerRef} display="block" tabId="n" />
        );
        expect(containerRef.current?.innerHTML).toContain('<circle');
    });

    it('injects SVGSVGElement into container via replaceChildren', () => {
        const containerRef = createRef<HTMLDivElement>();
        const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        circle.setAttribute('r', '20');
        svgEl.appendChild(circle);

        render(
            <MemoizedSvgContainer svg={svgEl} containerRef={containerRef} display="block" tabId="action" />
        );
        expect(containerRef.current?.querySelector('circle')).toBeTruthy();
    });

    it('uses correct id for different tabId values', () => {
        const containerRef = createRef<HTMLDivElement>();
        const { container } = render(
            <MemoizedSvgContainer svg="" containerRef={containerRef} display="block" tabId="action" />
        );
        expect(container.querySelector('#action-svg-container')).toBeInTheDocument();
    });

    it('logs performance timing to console', () => {
        const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* noop */ });
        const containerRef = createRef<HTMLDivElement>();
        render(
            <MemoizedSvgContainer svg="<svg></svg>" containerRef={containerRef} display="block" tabId="n" />
        );
        expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('[SVG] DOM injection for n'));
        consoleSpy.mockRestore();
    });
});
