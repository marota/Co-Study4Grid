// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ActionOverviewDiagram from './ActionOverviewDiagram';
import type { ActionDetail, DiagramData, EdgeMeta, MetadataIndex, NodeMeta } from '../types';

// ------------------------------------------------------------
// Test fixtures
//
// A 4-node square with an extra isolated VL, mirrored from the
// svgUtils action-overview test fixture so the expected pin
// anchors and fit rectangles stay consistent between the two
// test suites.
// ------------------------------------------------------------
const makeMetaIndex = (): MetadataIndex => {
    const nodes: NodeMeta[] = [
        { equipmentId: 'VL_N1', svgId: 'svg-n1', x: 0, y: 0 },
        { equipmentId: 'VL_N2', svgId: 'svg-n2', x: 100, y: 0 },
        { equipmentId: 'VL_N3', svgId: 'svg-n3', x: 0, y: 100 },
        { equipmentId: 'VL_N4', svgId: 'svg-n4', x: 100, y: 100 },
        { equipmentId: 'VL_FAR', svgId: 'svg-far', x: 500, y: 500 },
    ];
    const edges: EdgeMeta[] = [
        { equipmentId: 'LINE_A', svgId: 'svg-line-a', node1: 'svg-n1', node2: 'svg-n2' },
        { equipmentId: 'LINE_B', svgId: 'svg-line-b', node1: 'svg-n2', node2: 'svg-n4' },
        { equipmentId: 'LINE_C', svgId: 'svg-line-c', node1: 'svg-n1', node2: 'svg-n3' },
        { equipmentId: 'LINE_D', svgId: 'svg-line-d', node1: 'svg-n3', node2: 'svg-n4' },
    ];
    return {
        nodesByEquipmentId: new Map(nodes.map(n => [n.equipmentId, n] as const)),
        nodesBySvgId: new Map(nodes.map(n => [n.svgId, n] as const)),
        edgesByEquipmentId: new Map(edges.map(e => [e.equipmentId, e] as const)),
        edgesByNode: new Map(),
    };
};

const makeAction = (overrides: Partial<ActionDetail> = {}): ActionDetail => ({
    description_unitaire: 'test action',
    rho_before: null,
    rho_after: null,
    max_rho: null,
    max_rho_line: '',
    is_rho_reduction: false,
    ...overrides,
});

// A minimal NAD-like SVG background — the test component
// parses this via innerHTML and queries for the injected pin
// layer. Includes a `.nad-vl-nodes circle[r="40"]` so the pin
// sizing logic (which reads the VL circle radius) has something
// realistic to latch on.
const makeN1Diagram = (): DiagramData => ({
    svg:
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-50 -50 700 700">' +
        '  <g class="nad-vl-nodes"><circle r="40"/></g>' +
        '</svg>',
    metadata: null,
    lines_overloaded: ['LINE_B'],
    lines_overloaded_rho: [1.03],
});

const makeActions = (): Record<string, ActionDetail> => ({
    'disco_LINE_A': makeAction({
        action_topology: {
            lines_ex_bus: { LINE_A: -1 },
            lines_or_bus: { LINE_A: -1 },
            gens_bus: {},
            loads_bus: {},
        },
        max_rho: 0.5, // green
        max_rho_line: 'LINE_D',
    }),
    'coupling_VL_FAR': makeAction({
        description_unitaire: "Ouverture du poste 'VL_FAR'",
        max_rho: 1.1, // red
        max_rho_line: 'LINE_B',
    }),
});

const defaultProps = () => ({
    n1Diagram: makeN1Diagram(),
    n1MetaIndex: makeMetaIndex(),
    actions: makeActions(),
    monitoringFactor: 0.95,
    onActionSelect: vi.fn(),
    contingency: 'LINE_C' as string | null,
    overloadedLines: ['LINE_B'] as readonly string[],
    inspectableItems: ['LINE_A', 'LINE_B', 'LINE_C', 'LINE_D', 'VL_N1', 'VL_FAR'],
    visible: true,
});

describe('ActionOverviewDiagram', () => {
    afterEach(() => {
        cleanup();
    });

    it('injects the N-1 SVG as background into its own container', () => {
        const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
        // The overview SVG (from innerHTML injection) should live
        // inside the nad-action-overview-container div.
        const host = container.querySelector('.nad-action-overview-container');
        expect(host).not.toBeNull();
        const svg = host!.querySelector('svg');
        expect(svg).not.toBeNull();
        // width/height are normalised to fill the container
        expect(svg!.getAttribute('width')).toBe('100%');
        expect(svg!.getAttribute('height')).toBe('100%');
        expect(svg!.getAttribute('preserveAspectRatio')).toBe('xMidYMid meet');
    });

    it('renders one pin per simulated action using the severity palette', () => {
        const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
        const pins = container.querySelectorAll('g.nad-action-overview-pin');
        expect(pins.length).toBe(2);
        const fills = Array.from(pins).map(p => p.querySelector('path')?.getAttribute('fill'));
        // disco_LINE_A: rho=0.5 → green; coupling_VL_FAR: rho=1.1 → red
        expect(fills).toEqual(expect.arrayContaining(['#28a745', '#dc3545']));
    });

    it('draws pins WITHOUT a stroke outline', () => {
        const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
        // path lives inside the inner .nad-action-overview-pin-body
        // wrapper so the rescaler can upscale it on unzoom.
        const paths = container.querySelectorAll('g.nad-action-overview-pin path');
        expect(paths.length).toBeGreaterThan(0);
        paths.forEach(p => {
            expect(p.getAttribute('stroke')).toBe('none');
            expect(p.hasAttribute('stroke-width')).toBe(false);
        });
    });

    it('each pin displays the rounded max loading as its label', () => {
        const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
        const texts = Array.from(container.querySelectorAll('g.nad-action-overview-pin text'))
            .map(t => t.textContent);
        // 0.5 → "50%", 1.1 → "110%"
        expect(texts).toEqual(expect.arrayContaining(['50%', '110%']));
    });

    it('pin anchors on the asset highlighted by the corresponding card', () => {
        const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
        const groups = Array.from(container.querySelectorAll('g.nad-action-overview-pin'));
        const byId = Object.fromEntries(groups.map(g => [
            g.getAttribute('data-action-id'),
            g.getAttribute('transform'),
        ]));
        // disco_LINE_A anchors on LINE_A midpoint (50, 0)
        expect(byId['disco_LINE_A']).toBe('translate(50 0)');
        // coupling_VL_FAR anchors on the VL node (500, 500)
        expect(byId['coupling_VL_FAR']).toBe('translate(500 500)');
    });

    it('clicking a pin invokes onActionSelect with its id', () => {
        const onActionSelect = vi.fn();
        const { container } = render(
            <ActionOverviewDiagram {...defaultProps()} onActionSelect={onActionSelect} />,
        );
        const pin = container.querySelector('g.nad-action-overview-pin[data-action-id="disco_LINE_A"]');
        expect(pin).not.toBeNull();
        fireEvent.click(pin!);
        expect(onActionSelect).toHaveBeenCalledWith('disco_LINE_A');
    });

    it('auto-zooms to the fit rectangle on mount', () => {
        const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
        // Fit rect unions:
        //   contingency LINE_C:  (0,0)..(0,100)
        //   overload   LINE_B:   (100,0)..(100,100)
        //   pins:                (50, 0), (500, 500)
        // Raw bbox = [0..500, 0..500] → 5% pad → [-25..525, -25..525]
        // So w=550, h=550, x=-25, y=-25.
        const svg = container.querySelector('.nad-action-overview-container svg');
        const vb = svg!.getAttribute('viewBox')!;
        const parts = vb.split(/\s+/).map(parseFloat);
        expect(parts[0]).toBeCloseTo(-25, 0);
        expect(parts[1]).toBeCloseTo(-25, 0);
        expect(parts[2]).toBeCloseTo(550, 0);
        expect(parts[3]).toBeCloseTo(550, 0);
    });

    it('renders severity legend (Solves overload / Low margin / Still overloaded / Divergent)', () => {
        const { getByText } = render(<ActionOverviewDiagram {...defaultProps()} />);
        expect(getByText('Solves overload')).toBeInTheDocument();
        expect(getByText('Low margin')).toBeInTheDocument();
        expect(getByText('Still overloaded')).toBeInTheDocument();
        expect(getByText('Divergent / islanded')).toBeInTheDocument();
    });

    it('shows the pin count in the header', () => {
        const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
        expect(container.textContent).toContain('2 pins on the N-1 network');
    });

    it('hides itself when visible=false', () => {
        const { container } = render(
            <ActionOverviewDiagram {...defaultProps()} visible={false} />,
        );
        const root = container.querySelector('[data-testid="action-overview-diagram"]') as HTMLElement;
        expect(root.style.display).toBe('none');
    });

    it('shows the "no analysis yet" empty state when there are no actions', () => {
        const { getByText } = render(
            <ActionOverviewDiagram {...defaultProps()} actions={{}} />,
        );
        expect(getByText(/Run.*Analyze.*Suggest/)).toBeInTheDocument();
    });

    it('shows the "no background" empty state when no N-1 diagram is loaded', () => {
        const { getByText } = render(
            <ActionOverviewDiagram {...defaultProps()} n1Diagram={null} />,
        );
        expect(getByText(/Load a contingency first/)).toBeInTheDocument();
    });

    describe('local zoom controls', () => {
        it('clicking "+" shrinks the viewBox around its centre', () => {
            const { container, getByTitle } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const svg = container.querySelector('.nad-action-overview-container svg')!;
            const before = svg.getAttribute('viewBox')!.split(/\s+/).map(parseFloat);
            fireEvent.click(getByTitle('Zoom In'));
            const after = svg.getAttribute('viewBox')!.split(/\s+/).map(parseFloat);
            // Width shrinks by 0.8×
            expect(after[2]).toBeCloseTo(before[2] * 0.8, 1);
            expect(after[3]).toBeCloseTo(before[3] * 0.8, 1);
        });

        it('clicking "-" grows the viewBox around its centre', () => {
            const { container, getByTitle } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const svg = container.querySelector('.nad-action-overview-container svg')!;
            const before = svg.getAttribute('viewBox')!.split(/\s+/).map(parseFloat);
            fireEvent.click(getByTitle('Zoom Out'));
            const after = svg.getAttribute('viewBox')!.split(/\s+/).map(parseFloat);
            expect(after[2]).toBeCloseTo(before[2] * 1.25, 1);
            expect(after[3]).toBeCloseTo(before[3] * 1.25, 1);
        });

        it('Fit button restores the auto-fit rectangle after panning', () => {
            const { container, getByTitle } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const svg = container.querySelector('.nad-action-overview-container svg')!;
            const fit = svg.getAttribute('viewBox')!;
            fireEvent.click(getByTitle('Zoom In'));
            expect(svg.getAttribute('viewBox')).not.toBe(fit);
            fireEvent.click(getByTitle(/Reset view/i));
            expect(svg.getAttribute('viewBox')).toBe(fit);
        });
    });

    describe('asset-focus inspect search', () => {
        beforeEach(() => {
            // `usePanZoom` debounces the React commit through setTimeout;
            // use fake timers so the tests can deterministically flush
            // any pending commits.
            vi.useFakeTimers();
        });
        afterEach(() => {
            vi.useRealTimers();
        });

        it('typing an exact equipment id zooms onto it', () => {
            const { container, getByTestId } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const svg = container.querySelector('.nad-action-overview-container svg')!;
            const fitVb = svg.getAttribute('viewBox')!;

            const input = getByTestId('overview-inspect-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'VL_FAR' } });

            const focused = svg.getAttribute('viewBox')!;
            expect(focused).not.toBe(fitVb);
            // VL_FAR is a single-point → expanded to 150x150 around (500, 500)
            const parts = focused.split(/\s+/).map(parseFloat);
            expect(parts[0]).toBeCloseTo(500 - 75 - 150 * 0.35, 0);
            expect(parts[1]).toBeCloseTo(500 - 75 - 150 * 0.35, 0);
        });

        it('does NOT re-focus on the same asset after the user zooms out (regression)', () => {
            // This is the "sticking" bug: after focusing on an asset,
            // unzooming used to re-run the effect and snap back onto
            // the asset. The fix is `lastFocusedRef` — here we assert
            // that a subsequent zoom-out is preserved.
            const { container, getByTitle, getByTestId } = render(
                <ActionOverviewDiagram {...defaultProps()} />,
            );
            const svg = container.querySelector('.nad-action-overview-container svg')!;
            const input = getByTestId('overview-inspect-input') as HTMLInputElement;

            // Focus on VL_FAR
            fireEvent.change(input, { target: { value: 'VL_FAR' } });
            const focusedVb = svg.getAttribute('viewBox')!;

            // Zoom out — this changes pz.viewBox and therefore the
            // memoised pz object identity, which previously caused
            // the inspect effect to re-fire and snap back onto VL_FAR.
            fireEvent.click(getByTitle('Zoom Out'));
            // Flush any pending rAF / setTimeout commits
            act(() => { vi.runAllTimers(); });

            const afterZoomOut = svg.getAttribute('viewBox')!;
            expect(afterZoomOut).not.toBe(focusedVb);

            // One more zoom-out: the view should continue to widen,
            // NOT snap back onto the asset.
            const afterPrevZoom = svg.getAttribute('viewBox')!;
            fireEvent.click(getByTitle('Zoom Out'));
            act(() => { vi.runAllTimers(); });
            const afterZoomOut2 = svg.getAttribute('viewBox')!;
            expect(afterZoomOut2).not.toBe(afterPrevZoom);
            expect(afterZoomOut2).not.toBe(focusedVb);
        });

        it('clearing the inspect query returns the view to the auto-fit rectangle', () => {
            const { container, getByTestId } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const svg = container.querySelector('.nad-action-overview-container svg')!;
            const fitVb = svg.getAttribute('viewBox')!;

            const input = getByTestId('overview-inspect-input') as HTMLInputElement;
            fireEvent.change(input, { target: { value: 'VL_FAR' } });
            expect(svg.getAttribute('viewBox')).not.toBe(fitVb);

            fireEvent.change(input, { target: { value: '' } });
            expect(svg.getAttribute('viewBox')).toBe(fitVb);
        });

        it('Fit button re-enables focusing on the same asset again', () => {
            // After a Fit reset, typing the same asset id should
            // focus again — the reset clears `lastFocusedRef` so the
            // consume-once guard no longer swallows the re-entry.
            const { container, getByTitle, getByTestId } = render(
                <ActionOverviewDiagram {...defaultProps()} />,
            );
            const svg = container.querySelector('.nad-action-overview-container svg')!;
            const input = getByTestId('overview-inspect-input') as HTMLInputElement;

            fireEvent.change(input, { target: { value: 'VL_FAR' } });
            const focusedVb1 = svg.getAttribute('viewBox')!;

            // Back to fit
            fireEvent.click(getByTitle(/Reset view/i));
            fireEvent.change(input, { target: { value: '' } });

            // Re-type the same asset id — should focus again, NOT
            // silently skip because the ref remembered it.
            fireEvent.change(input, { target: { value: 'VL_FAR' } });
            const focusedVb2 = svg.getAttribute('viewBox')!;
            expect(focusedVb2).toBe(focusedVb1);
        });
    });

    describe('pin sizing and screen-constant rescaling', () => {
        it('sizes pins from the VL circle radius (40 in the fixture)', () => {
            const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
            // The teardrop path uses the VL circle radius R=40
            // from makeN1Diagram(), so the arc command must
            // reference "A 40 40" in its `d` attribute.
            const path = container.querySelector('g.nad-action-overview-pin path');
            expect(path).not.toBeNull();
            expect(path!.getAttribute('d')).toContain('A 40 40');
        });

        it('wraps every pin glyph in a rescalable .nad-action-overview-pin-body', () => {
            const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const bodies = container.querySelectorAll('g.nad-action-overview-pin-body');
            expect(bodies.length).toBe(2);
            // Outer translate stays clean, body carries the scale.
            bodies.forEach(b => {
                expect(b.getAttribute('transform')).toMatch(/^scale\(/);
            });
        });

        it('rescales pins when the svg viewBox attribute changes', () => {
            // MutationObserver on the svg's viewBox attribute is
            // what keeps pins screen-constant during wheel/drag.
            // Directly mutating viewBox here simulates usePanZoom's
            // fast-path DOM writes and verifies the rescaler reacts.
            const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const svg = container.querySelector('.nad-action-overview-container svg') as unknown as SVGGraphicsElement;

            // Mock getScreenCTM to return a tiny ratio so the rescaler
            // upscales the body well above scale(1).
            svg.getScreenCTM = (() => ({ a: 0.1, b: 0, c: 0, d: 0.1, e: 0, f: 0 })) as unknown as SVGGraphicsElement['getScreenCTM'];

            // Mutate the viewBox — MutationObserver fires on the
            // next microtask, so flush with a manual wait.
            (svg as unknown as SVGSVGElement).setAttribute('viewBox', '0 0 99999 99999');

            return new Promise<void>(resolve => {
                // MutationObserver callbacks are scheduled as microtasks
                queueMicrotask(() => {
                    const body = container.querySelector('g.nad-action-overview-pin-body')!;
                    const match = body.getAttribute('transform')!.match(/^scale\(([0-9.]+)\)$/);
                    expect(match).not.toBeNull();
                    const scale = parseFloat(match![1]);
                    // pxPerSvgUnit=0.1, MIN_SCREEN_RADIUS_PX=22,
                    // baseR=40 → effectiveR=max(40, 220)=220 → scale=5.5
                    expect(scale).toBeCloseTo(220 / 40, 2);
                    resolve();
                });
            });
        });

        it('does not upscale pins when VL circles are already big enough on screen', () => {
            const { container } = render(<ActionOverviewDiagram {...defaultProps()} />);
            const svg = container.querySelector('.nad-action-overview-container svg') as unknown as SVGGraphicsElement;
            // pxPerSvgUnit=2 → VL circle with r=40 = 80 screen px,
            // well above the 22-px floor. No rescale needed.
            svg.getScreenCTM = (() => ({ a: 2, b: 0, c: 0, d: 2, e: 0, f: 0 })) as unknown as SVGGraphicsElement['getScreenCTM'];
            (svg as unknown as SVGSVGElement).setAttribute('viewBox', '0 0 100 100');

            return new Promise<void>(resolve => {
                queueMicrotask(() => {
                    const body = container.querySelector('g.nad-action-overview-pin-body')!;
                    expect(body.getAttribute('transform')).toBe('scale(1)');
                    resolve();
                });
            });
        });
    });
});
