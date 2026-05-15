// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import SidebarSummary from './SidebarSummary';
import { DEFAULT_ACTION_OVERVIEW_FILTERS } from '../utils/actionTypes';
import type { ActionOverviewFilters } from '../types';

describe('SidebarSummary', () => {
    const baseProps = {
        selectedContingency: [] as string[],
        n1LinesOverloaded: undefined as string[] | undefined,
        n1LinesOverloadedRho: undefined as number[] | undefined,
        selectedOverloads: undefined as Set<string> | null | undefined,
        displayName: (id: string) => id,
        onContingencyZoom: vi.fn(),
        onOverloadClick: vi.fn(),
    };

    it('renders nothing when there is no contingency, no overloads and no filters', () => {
        const { container } = render(<SidebarSummary {...baseProps} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the contingency row with a zoom-to button', () => {
        const onContingencyZoom = vi.fn();
        render(
            <SidebarSummary
                {...baseProps}
                selectedContingency={['LINE_A']}
                onContingencyZoom={onContingencyZoom}
            />,
        );
        const strip = screen.getByTestId('sticky-feed-summary');
        expect(strip).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'LINE_A' }));
        expect(onContingencyZoom).toHaveBeenCalledWith('LINE_A');
    });

    it('uses the ⚡ lightning pictogram for the Contingency label (replaces the old 🎯)', () => {
        // Visual contract: the Contingency-as-fault metaphor is
        // pinned on the ⚡ glyph across the sidebar (status line +
        // picker card title). The legacy 🎯 must not regress here.
        render(
            <SidebarSummary
                {...baseProps}
                selectedContingency={['LINE_A']}
            />,
        );
        const strip = screen.getByTestId('sticky-feed-summary');
        expect(strip.textContent).toContain('⚡ Contingency');
        expect(strip.textContent).not.toContain('🎯');
    });

    it('renders the overloads row with per-line jump buttons', () => {
        const onOverloadClick = vi.fn();
        render(
            <SidebarSummary
                {...baseProps}
                n1LinesOverloaded={['LINE_X']}
                n1LinesOverloadedRho={[1.05]}
                onOverloadClick={onOverloadClick}
            />,
        );
        expect(screen.getByText(/Overloads:/i)).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: 'LINE_X' }));
        expect(onOverloadClick).toHaveBeenCalledWith('', 'LINE_X', 'contingency');
    });

    it('renders the ActionFilterRings when hasActions + filters + onChange are all wired', () => {
        render(
            <SidebarSummary
                {...baseProps}
                selectedContingency={['LINE_A']}
                overviewFilters={DEFAULT_ACTION_OVERVIEW_FILTERS as ActionOverviewFilters}
                onOverviewFiltersChange={vi.fn()}
                hasActions
            />,
        );
        expect(screen.getByTestId('sidebar-action-filters')).toBeInTheDocument();
    });

    it('hides the filter rings while the feed has no action to filter (hasActions=false)', () => {
        render(
            <SidebarSummary
                {...baseProps}
                selectedContingency={['LINE_A']}
                overviewFilters={DEFAULT_ACTION_OVERVIEW_FILTERS as ActionOverviewFilters}
                onOverviewFiltersChange={vi.fn()}
                hasActions={false}
            />,
        );
        expect(screen.queryByTestId('sidebar-action-filters')).not.toBeInTheDocument();
    });

    it('hides the filter rings when no overviewFilters object is supplied', () => {
        render(
            <SidebarSummary
                {...baseProps}
                selectedContingency={['LINE_A']}
                hasActions
            />,
        );
        expect(screen.queryByTestId('sidebar-action-filters')).not.toBeInTheDocument();
    });

    it('renders the strip for the filter rings alone, below the overloads row', () => {
        render(
            <SidebarSummary
                {...baseProps}
                n1LinesOverloaded={['LINE_X']}
                n1LinesOverloadedRho={[1.05]}
                overviewFilters={DEFAULT_ACTION_OVERVIEW_FILTERS as ActionOverviewFilters}
                onOverviewFiltersChange={vi.fn()}
                hasActions
            />,
        );
        const overloads = screen.getByText(/Overloads:/i);
        const filters = screen.getByTestId('sidebar-action-filters');
        // Filter rings come AFTER the overloads row in document order.
        expect(overloads.compareDocumentPosition(filters) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    it('renders the strip even when ONLY the filter rings are present', () => {
        render(
            <SidebarSummary
                {...baseProps}
                overviewFilters={DEFAULT_ACTION_OVERVIEW_FILTERS as ActionOverviewFilters}
                onOverviewFiltersChange={vi.fn()}
                hasActions
            />,
        );
        expect(screen.getByTestId('sticky-feed-summary')).toBeInTheDocument();
        expect(screen.getByTestId('sidebar-action-filters')).toBeInTheDocument();
    });
});
