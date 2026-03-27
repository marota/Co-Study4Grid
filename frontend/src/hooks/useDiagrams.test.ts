import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useDiagrams } from './useDiagrams';
import { interactionLogger } from '../utils/interactionLogger';

// Mock the api module
vi.mock('../api', () => ({
    api: {
        getNetworkDiagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
        getN1Diagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
        getActionVariantDiagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
        simulateManualAction: vi.fn().mockResolvedValue({}),
        getNSld: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }),
        getN1Sld: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }),
        getActionVariantSld: vi.fn().mockResolvedValue({ svg: '<svg></svg>' }),
        getElementVoltageLevels: vi.fn().mockResolvedValue({ voltage_level_ids: [] }),
        getFocusedDiagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
    },
}));

describe('useDiagrams — interaction logging', () => {
    beforeEach(() => {
        interactionLogger.clear();
        vi.clearAllMocks();
    });

    it('logs view_mode_changed when handleViewModeChange is called', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => {
            result.current.handleViewModeChange('delta');
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('view_mode_changed');
        expect(log[0].details).toEqual({ mode: 'delta' });
    });

    it('logs zoom_in when handleManualZoomIn is called', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => {
            result.current.handleManualZoomIn();
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('zoom_in');
        expect(log[0].details).toEqual({ tab: 'n' }); // default tab
    });

    it('logs zoom_out when handleManualZoomOut is called', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => {
            result.current.handleManualZoomOut();
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('zoom_out');
        expect(log[0].details).toEqual({ tab: 'n' });
    });

    it('logs zoom_reset when handleManualReset is called', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => {
            result.current.handleManualReset();
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('zoom_reset');
        expect(log[0].details).toEqual({ tab: 'n' });
    });

    it('logs sld_overlay_opened when handleVlDoubleClick is called', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => {
            result.current.handleVlDoubleClick('act_1', 'VL_225');
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('sld_overlay_opened');
        expect(log[0].details).toEqual({ vl_name: 'VL_225', action_id: 'act_1' });
    });

    it('logs sld_overlay_closed when handleOverlayClose is called', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => {
            result.current.handleOverlayClose();
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('sld_overlay_closed');
    });

    it('logs sld_overlay_tab_changed when handleOverlaySldTabChange is called with active overlay', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        // First open an overlay
        act(() => {
            result.current.handleVlDoubleClick('', 'VL_400');
        });
        interactionLogger.clear();

        act(() => {
            result.current.handleOverlaySldTabChange('n-1');
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('sld_overlay_tab_changed');
        expect(log[0].details).toEqual({ tab: 'n-1', vl_name: 'VL_400' });
    });

    it('logs asset_clicked when handleAssetClick is called', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => {
            result.current.handleAssetClick('act_5', 'LINE_XY', 'n-1', null, vi.fn());
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('asset_clicked');
        expect(log[0].details).toEqual({ action_id: 'act_5', asset_name: 'LINE_XY', tab: 'n-1' });
    });

    it('logs action_deselected when re-selecting the same action', async () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        // Set a selected action ID first
        act(() => { result.current.setSelectedActionId('act_1'); });
        interactionLogger.clear();

        // Select same action again triggers deselect
        await act(async () => {
            await result.current.handleActionSelect('act_1', null, '', 0, vi.fn(), vi.fn());
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('action_deselected');
        expect(log[0].details).toEqual({ action_id: 'act_1' });
    });

    it('logs action_selected when selecting a new action', async () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));
        interactionLogger.clear();

        await act(async () => {
            await result.current.handleActionSelect('act_2', null, '', 0, vi.fn(), vi.fn());
        });

        const log = interactionLogger.getLog();
        expect(log.some(e => e.type === 'action_selected' && e.details.action_id === 'act_2')).toBe(true);
    });

    it('does not log action_selected when actionId is null', async () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));
        interactionLogger.clear();

        await act(async () => {
            await result.current.handleActionSelect(null, null, '', 0, vi.fn(), vi.fn());
        });

        const log = interactionLogger.getLog();
        expect(log.some(e => e.type === 'action_selected')).toBe(false);
    });

    it('logs zoom events for different active tabs', () => {
        const { result } = renderHook(() => useDiagrams([], [], ''));

        act(() => { result.current.setActiveTab('action'); });
        interactionLogger.clear();

        act(() => { result.current.handleManualZoomIn(); });

        const log = interactionLogger.getLog();
        expect(log[0].type).toBe('zoom_in');
        expect(log[0].details).toEqual({ tab: 'action' });
    });
});
