// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import ActionSearchDropdown from './ActionSearchDropdown';
import type { ActionDetail } from '../types';

describe('ActionSearchDropdown', () => {
    const defaultProps = {
        dropdownRef: createRef<HTMLDivElement>(),
        searchInputRef: createRef<HTMLInputElement>(),
        searchQuery: '',
        onSearchQueryChange: vi.fn(),
        typeFilters: { disco: true, reco: true, open: true, close: true, pst: true, ls: true, rc: true },
        onTypeFilterChange: vi.fn(),
        error: null as string | null,
        loadingActions: false,
        scoredActionsList: [] as { type: string; actionId: string; score: number; mwStart: number | null }[],
        filteredActions: [] as { id: string; description: string; type?: string }[],
        actionScores: undefined as Record<string, Record<string, unknown>> | undefined,
        actions: {} as Record<string, ActionDetail>,
        cardEditMw: {} as Record<string, string>,
        onCardEditMwChange: vi.fn(),
        cardEditTap: {} as Record<string, string>,
        onCardEditTapChange: vi.fn(),
        simulating: null as string | null,
        resimulating: null as string | null,
        onAddAction: vi.fn(),
        onResimulate: vi.fn(),
        onResimulateTap: vi.fn(),
        onShowTooltip: vi.fn(),
        onHideTooltip: vi.fn(),
    };

    it('renders search input with placeholder', () => {
        render(<ActionSearchDropdown {...defaultProps} />);
        expect(screen.getByPlaceholderText('Search action by ID or description...')).toBeInTheDocument();
    });

    it('renders all type filter checkboxes', () => {
        render(<ActionSearchDropdown {...defaultProps} />);
        expect(screen.getByText('Disconnections')).toBeInTheDocument();
        expect(screen.getByText('Reconnections')).toBeInTheDocument();
        expect(screen.getByText('Load Shedding')).toBeInTheDocument();
        expect(screen.getByText('Renewable Curtailment')).toBeInTheDocument();
        expect(screen.getByText('PST')).toBeInTheDocument();
        expect(screen.getByText('Open coupling')).toBeInTheDocument();
        expect(screen.getByText('Close coupling')).toBeInTheDocument();
    });

    it('calls onTypeFilterChange when a filter checkbox is toggled', () => {
        const onTypeFilterChange = vi.fn();
        render(<ActionSearchDropdown {...defaultProps} onTypeFilterChange={onTypeFilterChange} />);
        fireEvent.click(screen.getByText('PST'));
        expect(onTypeFilterChange).toHaveBeenCalledWith('pst');
    });

    it('calls onSearchQueryChange when input changes', () => {
        const onSearchQueryChange = vi.fn();
        render(<ActionSearchDropdown {...defaultProps} onSearchQueryChange={onSearchQueryChange} />);
        fireEvent.change(screen.getByPlaceholderText('Search action by ID or description...'), { target: { value: 'test' } });
        expect(onSearchQueryChange).toHaveBeenCalledWith('test');
    });

    it('displays error message when error is set', () => {
        render(<ActionSearchDropdown {...defaultProps} error="Something went wrong" />);
        expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });

    it('shows loading message when loadingActions is true', () => {
        render(<ActionSearchDropdown {...defaultProps} loadingActions={true} />);
        expect(screen.getByText('Loading actions...')).toBeInTheDocument();
    });

    it('shows "All actions already added" when no actions available and no query', () => {
        render(<ActionSearchDropdown {...defaultProps} />);
        expect(screen.getByText('All actions already added')).toBeInTheDocument();
    });

    it('renders filtered actions list', () => {
        const filteredActions = [
            { id: 'reco_1', description: 'Close line L1' },
            { id: 'reco_2', description: 'Close line L2' },
        ];
        render(<ActionSearchDropdown {...defaultProps} searchQuery="reco" filteredActions={filteredActions} />);
        expect(screen.getByText('reco_1')).toBeInTheDocument();
        expect(screen.getByText('reco_2')).toBeInTheDocument();
    });

    it('calls onAddAction when an action item is clicked', () => {
        const onAddAction = vi.fn();
        const filteredActions = [{ id: 'reco_1', description: 'Close line L1' }];
        render(<ActionSearchDropdown {...defaultProps} searchQuery="reco" filteredActions={filteredActions} onAddAction={onAddAction} />);
        fireEvent.click(screen.getByText('reco_1'));
        expect(onAddAction).toHaveBeenCalledWith('reco_1');
    });

    it('shows manual ID option when searchQuery does not match any filtered action', () => {
        render(<ActionSearchDropdown {...defaultProps} searchQuery="my_custom_action" />);
        expect(screen.getByTestId('manual-id-option-my_custom_action')).toBeInTheDocument();
        expect(screen.getByText('my_custom_action')).toBeInTheDocument();
    });

    it('calls onAddAction with manual ID when manual option is clicked', () => {
        const onAddAction = vi.fn();
        render(<ActionSearchDropdown {...defaultProps} searchQuery="manual_42" onAddAction={onAddAction} />);
        fireEvent.click(screen.getByTestId('manual-id-option-manual_42'));
        expect(onAddAction).toHaveBeenCalledWith('manual_42');
    });

    it('renders scored actions table when scored actions exist and no search query', () => {
        const scoredActionsList = [
            { type: 'line_reconnection', actionId: 'act_1', score: 10, mwStart: null },
        ];
        const actionScores = {
            line_reconnection: { scores: { act_1: 10 }, params: {} },
        };
        render(<ActionSearchDropdown {...defaultProps} scoredActionsList={scoredActionsList} actionScores={actionScores} />);
        expect(screen.getByText('Scored Actions')).toBeInTheDocument();
        expect(screen.getByText('act_1')).toBeInTheDocument();
        expect(screen.getByText('10.00')).toBeInTheDocument();
    });

    it('shows simulating state on action items', () => {
        const filteredActions = [{ id: 'act_sim', description: 'Test Action' }];
        render(<ActionSearchDropdown {...defaultProps} searchQuery="act" filteredActions={filteredActions} simulating="act_sim" />);
        expect(screen.getByText('Simulating...')).toBeInTheDocument();
    });
});
