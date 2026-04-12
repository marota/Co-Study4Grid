// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SldOverlay from './SldOverlay';
import type { VlOverlay, SldTab, DiagramData, AnalysisResult } from '../types';

vi.mock('../utils/svgUtils', () => ({
    isCouplingAction: vi.fn(() => false),
}));

describe('SldOverlay', () => {
    const baseVlOverlay: VlOverlay = {
        vlName: 'VL_400',
        actionId: null,
        svg: '<svg><rect width="100" height="100"/></svg>',
        sldMetadata: null,
        loading: false,
        error: null,
        tab: 'n' as SldTab,
    };

    const defaultProps = {
        vlOverlay: baseVlOverlay,
        actionViewMode: 'network' as const,
        onOverlayClose: vi.fn(),
        onOverlaySldTabChange: vi.fn(),
        n1Diagram: null as DiagramData | null,
        actionDiagram: null as DiagramData | null,
        selectedBranch: '',
        result: null as AnalysisResult | null,
    };

    it('renders the voltage level name in the header', () => {
        render(<SldOverlay {...defaultProps} />);
        expect(screen.getByText('VL_400')).toBeInTheDocument();
    });

    it('renders the close button', () => {
        render(<SldOverlay {...defaultProps} />);
        expect(screen.getByTitle('Close')).toBeInTheDocument();
    });

    it('calls onOverlayClose when close button is clicked', () => {
        const onOverlayClose = vi.fn();
        render(<SldOverlay {...defaultProps} onOverlayClose={onOverlayClose} />);
        fireEvent.click(screen.getByTitle('Close'));
        expect(onOverlayClose).toHaveBeenCalled();
    });

    it('renders N tab button', () => {
        render(<SldOverlay {...defaultProps} />);
        expect(screen.getByText('N')).toBeInTheDocument();
    });

    it('calls onOverlaySldTabChange when a tab button is clicked', () => {
        const onOverlaySldTabChange = vi.fn();
        render(<SldOverlay {...defaultProps} onOverlaySldTabChange={onOverlaySldTabChange} />);
        fireEvent.click(screen.getByText('N'));
        expect(onOverlaySldTabChange).toHaveBeenCalledWith('n');
    });

    it('shows N-1 tab when n1Diagram exists', () => {
        const n1Diagram: DiagramData = { svg: '<svg/>', metadata: null };
        render(<SldOverlay {...defaultProps} n1Diagram={n1Diagram} />);
        expect(screen.getByText('N-1')).toBeInTheDocument();
    });

    it('does not show N-1 tab when n1Diagram is null', () => {
        render(<SldOverlay {...defaultProps} n1Diagram={null} />);
        expect(screen.queryByText('N-1')).not.toBeInTheDocument();
    });

    it('shows ACTION tab when actionDiagram exists', () => {
        const actionDiagram: DiagramData = { svg: '<svg/>', metadata: null };
        render(<SldOverlay {...defaultProps} actionDiagram={actionDiagram} />);
        expect(screen.getByText('ACTION')).toBeInTheDocument();
    });

    it('does not show ACTION tab when actionDiagram is null', () => {
        render(<SldOverlay {...defaultProps} actionDiagram={null} />);
        expect(screen.queryByText('ACTION')).not.toBeInTheDocument();
    });

    it('shows loading message when vlOverlay.loading is true', () => {
        const loadingOverlay = { ...baseVlOverlay, svg: null, loading: true };
        render(<SldOverlay {...defaultProps} vlOverlay={loadingOverlay} />);
        expect(screen.getByText(/Generating diagram/)).toBeInTheDocument();
    });

    it('shows error message when vlOverlay.error is set', () => {
        const errorOverlay = { ...baseVlOverlay, svg: null, error: 'Failed to load' };
        render(<SldOverlay {...defaultProps} vlOverlay={errorOverlay} />);
        expect(screen.getByText('Failed to load')).toBeInTheDocument();
    });

    it('renders SVG content when svg is available', () => {
        render(<SldOverlay {...defaultProps} />);
        // SVG is rendered via dangerouslySetInnerHTML; check that the container renders
        expect(screen.getByText('VL_400')).toBeInTheDocument();
    });

    it('shows mode indicator as "Flows" in network mode', () => {
        render(<SldOverlay {...defaultProps} actionViewMode="network" />);
        expect(screen.getByText('Flows')).toBeInTheDocument();
    });

    it('shows mode indicator as "Impacts" in delta mode', () => {
        render(<SldOverlay {...defaultProps} actionViewMode="delta" />);
        expect(screen.getByText('Impacts')).toBeInTheDocument();
    });

    describe('post-action overload highlight (Bug 2)', () => {
        // Minimal SVG + metadata so the cell-lookup machinery inside the
        // SldOverlay highlight effect can resolve an equipment id to a
        // DOM element and clone it with the `sld-highlight-overloaded`
        // class.
        // IDs must be unique — duplicate ids break both querySelector and
        // the elMap built inside SldOverlay's highlight effect. We only
        // need one id'd element per equipment; the highlight clone will
        // be inserted as a sibling and the original element gets tagged
        // with an `-original` class.
        const buildHighlightOverlay = (tab: SldTab): VlOverlay => ({
            vlName: 'VL_400',
            actionId: 'action_1',
            svg:
                '<svg xmlns="http://www.w3.org/2000/svg">'
                + '<g><rect id="cell_resolved" width="10" height="10"/></g>'
                + '<g><rect id="cell_new" width="10" height="10"/></g>'
                + '<g><rect id="cell_n1" width="10" height="10"/></g>'
                + '</svg>',
            sldMetadata: JSON.stringify({
                nodes: [
                    { id: 'cell_resolved', equipmentId: 'LINE_RESOLVED' },
                    { id: 'cell_new', equipmentId: 'LINE_NEW' },
                    { id: 'cell_n1', equipmentId: 'LINE_N1' },
                ],
            }),
            loading: false,
            error: null,
            tab,
        });

        const baseActionDetail = {
            description_unitaire: 'test action',
            rho_before: null,
            rho_after: null,
            max_rho: 0.5,
            max_rho_line: 'LINE_NEW',
            is_rho_reduction: true,
        };

        // When the SLD overlay is showing the ACTION tab, an overload that
        // existed in the N-1 state but was RESOLVED by the action must not
        // be highlighted — only the overloads that persist or newly appear
        // (lines_overloaded_after) should be highlighted.
        it('highlights post-action overloads on the ACTION tab, not stale N-1 overloads', () => {
            const vlOverlay = buildHighlightOverlay('action');
            const result = {
                actions: {
                    action_1: {
                        ...baseActionDetail,
                        lines_overloaded_after: ['LINE_NEW'],
                    },
                },
                lines_overloaded: ['LINE_RESOLVED'],
                pdf_path: null,
                pdf_url: null,
                message: '',
                dc_fallback: false,
            } as unknown as AnalysisResult;

            const { container } = render(
                <SldOverlay {...defaultProps} vlOverlay={vlOverlay} result={result} selectedBranch="L_FAULTY" />,
            );

            const highlights = container.querySelectorAll('.sld-highlight-overloaded');
            // Exactly one highlight clone, for the post-action overload,
            // NOT for the pre-action N-1 overload.
            expect(highlights.length).toBe(1);
            // The ORIGINAL element also gets tagged with an `-original`
            // class so it can be cleaned up on the next render pass.
            const tagged = container.querySelectorAll('.sld-highlight-overloaded-original');
            expect(tagged.length).toBe(1);
            // Confirm it is LINE_NEW that was highlighted, not LINE_RESOLVED.
            expect(container.querySelector('#cell_new.sld-highlight-overloaded-original')).toBeTruthy();
            expect(container.querySelector('#cell_resolved.sld-highlight-overloaded-original')).toBeNull();
        });

        // Regression guard: on the N-1 tab the overload list still comes
        // from result.lines_overloaded (N-1 state), independent of any
        // action's lines_overloaded_after.
        it('still highlights N-1 overloads on the N-1 tab', () => {
            const vlOverlay = buildHighlightOverlay('n-1');
            const result = {
                actions: {},
                lines_overloaded: ['LINE_N1'],
                pdf_path: null,
                pdf_url: null,
                message: '',
                dc_fallback: false,
            } as unknown as AnalysisResult;

            const { container } = render(
                <SldOverlay {...defaultProps} vlOverlay={vlOverlay} result={result} selectedBranch="L_FAULTY" />,
            );

            expect(container.querySelector('#cell_n1.sld-highlight-overloaded-original')).toBeTruthy();
        });

        // When the action solves ALL overloads (lines_overloaded_after is
        // empty) no `sld-highlight-overloaded` clones are added at all.
        it('adds no overload clones when the action solves every overload', () => {
            const vlOverlay = buildHighlightOverlay('action');
            const result = {
                actions: {
                    action_1: {
                        ...baseActionDetail,
                        lines_overloaded_after: [],
                    },
                },
                lines_overloaded: ['LINE_RESOLVED'],
                pdf_path: null,
                pdf_url: null,
                message: '',
                dc_fallback: false,
            } as unknown as AnalysisResult;

            const { container } = render(
                <SldOverlay {...defaultProps} vlOverlay={vlOverlay} result={result} selectedBranch="L_FAULTY" />,
            );
            expect(container.querySelectorAll('.sld-highlight-overloaded').length).toBe(0);
        });
    });
});
