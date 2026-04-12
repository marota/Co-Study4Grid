// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActions } from './useActions';
import { interactionLogger } from '../utils/interactionLogger';
import type { ActionDetail, AnalysisResult } from '../types';

describe('useActions — interaction logging', () => {
    beforeEach(() => {
        interactionLogger.clear();
    });

    it('logs action_favorited when handleActionFavorite is called', () => {
        const { result } = renderHook(() => useActions());
        const mockSetResult = vi.fn();

        act(() => {
            result.current.handleActionFavorite('act_42', mockSetResult);
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('action_favorited');
        expect(log[0].details).toEqual({ action_id: 'act_42' });
    });

    it('logs action_rejected when handleActionReject is called', () => {
        const { result } = renderHook(() => useActions());

        act(() => {
            result.current.handleActionReject('act_99');
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('action_rejected');
        expect(log[0].details).toEqual({ action_id: 'act_99' });
    });

    it('logs manual_action_simulated when handleManualActionAdded is called', () => {
        const { result } = renderHook(() => useActions());
        const mockSetResult = vi.fn();
        const mockOnSelect = vi.fn();
        const detail = {
            description_unitaire: 'Test action',
            rho_before: [1.1],
            rho_after: [0.9],
            max_rho: 0.9,
            max_rho_line: 'LINE_A',
            is_rho_reduction: true,
        };

        act(() => {
            result.current.handleManualActionAdded('manual_1', detail, ['LINE_A'], mockSetResult, mockOnSelect);
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('manual_action_simulated');
        expect(log[0].details).toEqual({ action_id: 'manual_1' });
    });

    it('logs each action interaction independently', () => {
        const { result } = renderHook(() => useActions());
        const mockSetResult = vi.fn();

        act(() => {
            result.current.handleActionFavorite('act_1', mockSetResult);
            result.current.handleActionReject('act_2');
            result.current.handleActionFavorite('act_3', mockSetResult);
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(3);
        expect(log[0].type).toBe('action_favorited');
        expect(log[0].details.action_id).toBe('act_1');
        expect(log[1].type).toBe('action_rejected');
        expect(log[1].details.action_id).toBe('act_2');
        expect(log[2].type).toBe('action_favorited');
        expect(log[2].details.action_id).toBe('act_3');
    });

    it('clearActionState does not generate a log event', () => {
        const { result } = renderHook(() => useActions());

        act(() => {
            result.current.clearActionState();
        });

        expect(interactionLogger.getLog()).toHaveLength(0);
    });

    // Bug 5: re-simulating an existing action (editing Target MW / tap and
    // clicking "Re-simulate") must NOT promote it into the Selected
    // Actions bucket. A recommender-suggested card must stay in Suggested,
    // and a recommender-suggested action's is_manual flag must not flip.
    describe('handleActionResimulated (Bug 5)', () => {
        const newDetail: ActionDetail = {
            description_unitaire: 'resimulated',
            rho_before: [1.1],
            rho_after: [0.7],
            max_rho: 0.7,
            max_rho_line: 'LINE_B',
            is_rho_reduction: true,
            load_shedding_details: [
                { load_name: 'LOAD_1', voltage_level_id: 'VL_1', shedded_mw: 4.2 },
            ],
        };

        it('does not add the action id to selectedActionIds or manuallyAddedIds', () => {
            const { result } = renderHook(() => useActions());
            let captured: AnalysisResult | null = null;
            const mockSetResult = (updater: unknown) => {
                if (typeof updater === 'function') {
                    captured = (updater as (p: AnalysisResult | null) => AnalysisResult | null)({
                        pdf_path: null, pdf_url: null, actions: {
                            load_shedding_L1: {
                                description_unitaire: 'initial',
                                rho_before: [1.1],
                                rho_after: [0.9],
                                max_rho: 0.9,
                                max_rho_line: 'LINE_B',
                                is_rho_reduction: true,
                                is_manual: false,
                            },
                        },
                        lines_overloaded: ['LINE_A'],
                        message: '',
                        dc_fallback: false,
                    });
                }
            };
            const mockOnSelect = vi.fn();

            act(() => {
                result.current.handleActionResimulated(
                    'load_shedding_L1',
                    newDetail,
                    ['LINE_A'],
                    mockSetResult as React.Dispatch<React.SetStateAction<AnalysisResult | null>>,
                    mockOnSelect,
                );
            });

            expect(result.current.selectedActionIds.has('load_shedding_L1')).toBe(false);
            expect(result.current.manuallyAddedIds.has('load_shedding_L1')).toBe(false);
            // The force-select callback is still fired so the diagram
            // re-fetches with the new state.
            expect(mockOnSelect).toHaveBeenCalledWith('load_shedding_L1');
            // The action detail got updated, but is_manual stays false
            // because the existing entry had is_manual=false.
            expect(captured?.actions.load_shedding_L1.rho_after).toEqual([0.7]);
            expect(captured?.actions.load_shedding_L1.is_manual).toBe(false);
        });

        it('preserves an existing is_manual=true flag on resimulation', () => {
            const { result } = renderHook(() => useActions());
            let captured: AnalysisResult | null = null;
            const mockSetResult = (updater: unknown) => {
                if (typeof updater === 'function') {
                    captured = (updater as (p: AnalysisResult | null) => AnalysisResult | null)({
                        pdf_path: null, pdf_url: null, actions: {
                            load_shedding_L1: {
                                description_unitaire: 'initial',
                                rho_before: [1.1],
                                rho_after: [0.9],
                                max_rho: 0.9,
                                max_rho_line: 'LINE_B',
                                is_rho_reduction: true,
                                is_manual: true,
                            },
                        },
                        lines_overloaded: ['LINE_A'],
                        message: '',
                        dc_fallback: false,
                    });
                }
            };

            act(() => {
                result.current.handleActionResimulated(
                    'load_shedding_L1',
                    newDetail,
                    ['LINE_A'],
                    mockSetResult as React.Dispatch<React.SetStateAction<AnalysisResult | null>>,
                    vi.fn(),
                );
            });

            expect(captured?.actions.load_shedding_L1.is_manual).toBe(true);
        });

        // Regression guard: handleManualActionAdded still promotes into
        // both sets (the "add brand-new manual action" path is unchanged).
        it('handleManualActionAdded still promotes into Selected and Manually-Added', () => {
            const { result } = renderHook(() => useActions());

            act(() => {
                result.current.handleManualActionAdded(
                    'new_manual_action',
                    newDetail,
                    ['LINE_A'],
                    vi.fn(),
                    vi.fn(),
                );
            });

            expect(result.current.selectedActionIds.has('new_manual_action')).toBe(true);
            expect(result.current.manuallyAddedIds.has('new_manual_action')).toBe(true);
        });

        it('logs manual_action_simulated on resimulation too', () => {
            const { result } = renderHook(() => useActions());

            act(() => {
                result.current.handleActionResimulated(
                    'act_7',
                    newDetail,
                    [],
                    vi.fn(),
                    vi.fn(),
                );
            });

            const log = interactionLogger.getLog();
            expect(log.some(e => e.type === 'manual_action_simulated' && e.details.action_id === 'act_7')).toBe(true);
        });
    });
});
