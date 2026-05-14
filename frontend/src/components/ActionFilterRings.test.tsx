// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import ActionFilterRings from './ActionFilterRings';
import { DEFAULT_ACTION_OVERVIEW_FILTERS } from '../utils/actionTypes';
import type { ActionOverviewFilters } from '../types';

const baseFilters: ActionOverviewFilters = DEFAULT_ACTION_OVERVIEW_FILTERS;

describe('ActionFilterRings', () => {
    // The severity ring defers the single-click toggle by one
    // double-click window so a double-click can "solo" instead —
    // fake timers let the tests drive both gestures deterministically.
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    const flushClickDelay = () => act(() => { vi.advanceTimersByTime(300); });

    it('renders the severity ring (4 colour-coded outcome toggles)', () => {
        render(<ActionFilterRings filters={baseFilters} onFiltersChange={vi.fn()} />);
        for (const cat of ['green', 'orange', 'red', 'grey']) {
            expect(screen.getByTestId(`sidebar-filter-category-${cat}`)).toBeInTheDocument();
        }
    });

    it('renders the action-type ring (7 uncoloured pictogram toggles)', () => {
        render(<ActionFilterRings filters={baseFilters} onFiltersChange={vi.fn()} />);
        for (const t of ['disco', 'reco', 'open', 'close', 'ls', 'rc', 'pst']) {
            expect(screen.getByTestId(`sidebar-filter-type-${t}`)).toBeInTheDocument();
        }
    });

    it('shows every severity toggle as pressed when all categories are enabled', () => {
        render(<ActionFilterRings filters={baseFilters} onFiltersChange={vi.fn()} />);
        for (const cat of ['green', 'orange', 'red', 'grey']) {
            expect(screen.getByTestId(`sidebar-filter-category-${cat}`)).toHaveAttribute('aria-pressed', 'true');
        }
    });

    it('single-click toggles a severity category off (after the double-click window)', () => {
        const onFiltersChange = vi.fn();
        render(<ActionFilterRings filters={baseFilters} onFiltersChange={onFiltersChange} />);
        fireEvent.click(screen.getByTestId('sidebar-filter-category-red'));
        // Deferred until the double-click window elapses.
        expect(onFiltersChange).not.toHaveBeenCalled();
        flushClickDelay();
        expect(onFiltersChange).toHaveBeenCalledWith({
            ...baseFilters,
            categories: { ...baseFilters.categories, red: false },
        });
    });

    it('single-click toggles a disabled severity category back on', () => {
        const onFiltersChange = vi.fn();
        const filters: ActionOverviewFilters = {
            ...baseFilters,
            categories: { ...baseFilters.categories, grey: false },
        };
        render(<ActionFilterRings filters={filters} onFiltersChange={onFiltersChange} />);
        const greyToggle = screen.getByTestId('sidebar-filter-category-grey');
        expect(greyToggle).toHaveAttribute('aria-pressed', 'false');
        fireEvent.click(greyToggle);
        flushClickDelay();
        expect(onFiltersChange).toHaveBeenCalledWith({
            ...filters,
            categories: { ...filters.categories, grey: true },
        });
    });

    it('double-click solos a severity category — enables only that outcome', () => {
        const onFiltersChange = vi.fn();
        render(<ActionFilterRings filters={baseFilters} onFiltersChange={onFiltersChange} />);
        const red = screen.getByTestId('sidebar-filter-category-red');
        fireEvent.click(red);
        fireEvent.click(red);
        expect(onFiltersChange).toHaveBeenCalledTimes(1);
        expect(onFiltersChange).toHaveBeenCalledWith({
            ...baseFilters,
            categories: { green: false, orange: false, red: true, grey: false },
        });
        // The deferred single-click must NOT also fire after the solo.
        flushClickDelay();
        expect(onFiltersChange).toHaveBeenCalledTimes(1);
    });

    it('double-click on an already-soloed severity category restores all outcomes', () => {
        const onFiltersChange = vi.fn();
        const filters: ActionOverviewFilters = {
            ...baseFilters,
            categories: { green: false, orange: false, red: true, grey: false },
        };
        render(<ActionFilterRings filters={filters} onFiltersChange={onFiltersChange} />);
        const red = screen.getByTestId('sidebar-filter-category-red');
        fireEvent.click(red);
        fireEvent.click(red);
        expect(onFiltersChange).toHaveBeenCalledWith({
            ...filters,
            categories: { green: true, orange: true, red: true, grey: true },
        });
    });

    it('selects a single action type when its toggle is clicked', () => {
        const onFiltersChange = vi.fn();
        render(<ActionFilterRings filters={baseFilters} onFiltersChange={onFiltersChange} />);
        fireEvent.click(screen.getByTestId('sidebar-filter-type-pst'));
        expect(onFiltersChange).toHaveBeenCalledWith({ ...baseFilters, actionType: 'pst' });
    });

    it('clears the action-type filter back to "all" when the active type is re-clicked', () => {
        const onFiltersChange = vi.fn();
        const filters: ActionOverviewFilters = { ...baseFilters, actionType: 'ls' };
        render(<ActionFilterRings filters={filters} onFiltersChange={onFiltersChange} />);
        const lsToggle = screen.getByTestId('sidebar-filter-type-ls');
        expect(lsToggle).toHaveAttribute('aria-pressed', 'true');
        fireEvent.click(lsToggle);
        expect(onFiltersChange).toHaveBeenCalledWith({ ...filters, actionType: 'all' });
    });

    it('exposes the underlying wording as a hover tooltip on every toggle', () => {
        render(<ActionFilterRings filters={baseFilters} onFiltersChange={vi.fn()} />);
        expect(screen.getByTestId('sidebar-filter-category-green'))
            .toHaveAttribute('title', expect.stringContaining('Solves overload'));
        expect(screen.getByTestId('sidebar-filter-type-disco'))
            .toHaveAttribute('title', 'Show only: Line disconnection');
    });

    it('emits no raw hex literals in inline styles', () => {
        const { container } = render(<ActionFilterRings filters={baseFilters} onFiltersChange={vi.fn()} />);
        const hexInStyle = /#[0-9a-fA-F]{3,8}\b/;
        const offenders: string[] = [];
        container.querySelectorAll<HTMLElement>('[style]').forEach(el => {
            const style = el.getAttribute('style') ?? '';
            if (hexInStyle.test(style)) offenders.push(style);
        });
        expect(offenders).toEqual([]);
    });
});
