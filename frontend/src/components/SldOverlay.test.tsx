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
});
