import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useActions } from './useActions';
import { interactionLogger } from '../utils/interactionLogger';

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
});
