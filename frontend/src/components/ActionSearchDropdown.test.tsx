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
        actionTypeFilter: 'all' as const,
        onActionTypeFilterChange: vi.fn(),
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

    it('renders all action type filter chips', () => {
        render(<ActionSearchDropdown {...defaultProps} />);
        expect(screen.getByTestId('search-dropdown-filter-all')).toBeInTheDocument();
        expect(screen.getByTestId('search-dropdown-filter-disco')).toBeInTheDocument();
        expect(screen.getByTestId('search-dropdown-filter-reco')).toBeInTheDocument();
        expect(screen.getByTestId('search-dropdown-filter-ls')).toBeInTheDocument();
        expect(screen.getByTestId('search-dropdown-filter-rc')).toBeInTheDocument();
        expect(screen.getByTestId('search-dropdown-filter-pst')).toBeInTheDocument();
        expect(screen.getByTestId('search-dropdown-filter-open')).toBeInTheDocument();
        expect(screen.getByTestId('search-dropdown-filter-close')).toBeInTheDocument();
    });

    it('calls onActionTypeFilterChange when a filter chip is clicked', () => {
        const onActionTypeFilterChange = vi.fn();
        render(<ActionSearchDropdown {...defaultProps} onActionTypeFilterChange={onActionTypeFilterChange} />);
        fireEvent.click(screen.getByTestId('search-dropdown-filter-pst'));
        expect(onActionTypeFilterChange).toHaveBeenCalledWith('pst');
    });

    it('marks the active chip with aria-pressed="true"', () => {
        render(<ActionSearchDropdown {...defaultProps} actionTypeFilter="disco" />);
        expect(screen.getByTestId('search-dropdown-filter-disco').getAttribute('aria-pressed')).toBe('true');
        expect(screen.getByTestId('search-dropdown-filter-all').getAttribute('aria-pressed')).toBe('false');
        expect(screen.getByTestId('search-dropdown-filter-pst').getAttribute('aria-pressed')).toBe('false');
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

    describe('Target MW sync (Bug 1)', () => {
        // A computed load-shedding action is already in the `actions` map
        // with a simulated shedded_mw value. The score table row for that
        // action must display the simulated value by default instead of an
        // empty input, so the user can see what the action was run with.
        it('populates LS score-table input with stored shedded_mw for computed actions', () => {
            const scoredActionsList = [
                { type: 'load_shedding', actionId: 'load_shedding_L1', score: 1.0, mwStart: 6.4 },
            ];
            const actionScores = {
                load_shedding: { scores: { load_shedding_L1: 1.0 }, params: {} },
            };
            const actions: Record<string, ActionDetail> = {
                load_shedding_L1: {
                    description_unitaire: 'shed L1',
                    rho_before: null,
                    rho_after: null,
                    max_rho: 0.5,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    load_shedding_details: [
                        { load_name: 'L1', voltage_level_id: 'VL1', shedded_mw: 5.4 },
                    ],
                },
            };
            render(
                <ActionSearchDropdown
                    {...defaultProps}
                    scoredActionsList={scoredActionsList}
                    actionScores={actionScores}
                    actions={actions}
                />,
            );
            const input = screen.getByTestId('target-mw-load_shedding_L1') as HTMLInputElement;
            expect(input.value).toBe('5.4');
        });

        // Same guarantee for renewable curtailment: the stored curtailed_mw
        // must show up as the default value for computed rows.
        it('populates RC score-table input with stored curtailed_mw for computed actions', () => {
            const scoredActionsList = [
                { type: 'renewable_curtailment', actionId: 'curtail_G1', score: 1.0, mwStart: 8.0 },
            ];
            const actionScores = {
                renewable_curtailment: { scores: { curtail_G1: 1.0 }, params: {} },
            };
            const actions: Record<string, ActionDetail> = {
                curtail_G1: {
                    description_unitaire: 'curtail G1',
                    rho_before: null,
                    rho_after: null,
                    max_rho: 0.6,
                    max_rho_line: 'LINE_B',
                    is_rho_reduction: true,
                    curtailment_details: [
                        { gen_name: 'G1', voltage_level_id: 'VL2', curtailed_mw: 3.1 },
                    ],
                },
            };
            render(
                <ActionSearchDropdown
                    {...defaultProps}
                    scoredActionsList={scoredActionsList}
                    actionScores={actionScores}
                    actions={actions}
                />,
            );
            const input = screen.getByTestId('target-mw-curtail_G1') as HTMLInputElement;
            expect(input.value).toBe('3.1');
        });

        // The cardEditMw value (written when the user edits the input on the
        // prioritized action card) must be reflected in the score table row
        // input, so the two UIs stay synchronized.
        it('mirrors cardEditMw value in the score-table input', () => {
            const onCardEditMwChange = vi.fn();
            const scoredActionsList = [
                { type: 'load_shedding', actionId: 'load_shedding_L1', score: 1.0, mwStart: 6.4 },
            ];
            const actionScores = {
                load_shedding: { scores: { load_shedding_L1: 1.0 }, params: {} },
            };
            const actions: Record<string, ActionDetail> = {
                load_shedding_L1: {
                    description_unitaire: 'shed L1',
                    rho_before: null,
                    rho_after: null,
                    max_rho: 0.5,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    load_shedding_details: [
                        { load_name: 'L1', voltage_level_id: 'VL1', shedded_mw: 5.4 },
                    ],
                },
            };
            render(
                <ActionSearchDropdown
                    {...defaultProps}
                    scoredActionsList={scoredActionsList}
                    actionScores={actionScores}
                    actions={actions}
                    cardEditMw={{ load_shedding_L1: '4.2' }}
                    onCardEditMwChange={onCardEditMwChange}
                />,
            );
            const input = screen.getByTestId('target-mw-load_shedding_L1') as HTMLInputElement;
            // cardEditMw overrides the stored shedded_mw default.
            expect(input.value).toBe('4.2');
        });

        // Typing in the score-table row must propagate the change through
        // onCardEditMwChange (the shared edit state used by both the row and
        // the action card).
        it('forwards score-table edits through onCardEditMwChange', () => {
            const onCardEditMwChange = vi.fn();
            const scoredActionsList = [
                { type: 'load_shedding', actionId: 'load_shedding_L1', score: 1.0, mwStart: 6.4 },
            ];
            const actionScores = {
                load_shedding: { scores: { load_shedding_L1: 1.0 }, params: {} },
            };
            const actions: Record<string, ActionDetail> = {
                load_shedding_L1: {
                    description_unitaire: 'shed L1',
                    rho_before: null,
                    rho_after: null,
                    max_rho: 0.5,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    load_shedding_details: [
                        { load_name: 'L1', voltage_level_id: 'VL1', shedded_mw: 5.4 },
                    ],
                },
            };
            render(
                <ActionSearchDropdown
                    {...defaultProps}
                    scoredActionsList={scoredActionsList}
                    actionScores={actionScores}
                    actions={actions}
                    onCardEditMwChange={onCardEditMwChange}
                />,
            );
            const input = screen.getByTestId('target-mw-load_shedding_L1');
            fireEvent.change(input, { target: { value: '4.0' } });
            expect(onCardEditMwChange).toHaveBeenCalledWith('load_shedding_L1', '4.0');
        });

        // A non-computed LS row (no action detail yet) should render an
        // empty input — the stored-MW fallback only applies once the action
        // has been simulated.
        it('leaves LS input empty for non-computed actions', () => {
            const scoredActionsList = [
                { type: 'load_shedding', actionId: 'load_shedding_L2', score: 1.0, mwStart: 6.4 },
            ];
            const actionScores = {
                load_shedding: { scores: { load_shedding_L2: 1.0 }, params: {} },
            };
            render(
                <ActionSearchDropdown
                    {...defaultProps}
                    scoredActionsList={scoredActionsList}
                    actionScores={actionScores}
                    actions={{}}
                />,
            );
            const input = screen.getByTestId('target-mw-load_shedding_L2') as HTMLInputElement;
            expect(input.value).toBe('');
        });
    });
});
