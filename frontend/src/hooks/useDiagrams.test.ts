// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

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

    // Bug 3: re-simulating an action that is ALREADY the currently-viewed
    // action must re-fetch its variant diagram instead of silently
    // deselecting it (which left the action tab blank). `handleActionSelect`
    // now accepts a `force` flag that bypasses the "same id → toggle off"
    // early return and always proceeds with the fetch.
    describe('handleActionSelect force flag (Bug 3)', () => {
        it('does NOT deselect when called with force=true on the already-selected action', async () => {
            const { api } = await import('../api');
            const { result } = renderHook(() => useDiagrams([], [], ''));

            act(() => { result.current.setSelectedActionId('act_1'); });
            interactionLogger.clear();
            vi.mocked(api.getActionVariantDiagram).mockClear();

            await act(async () => {
                await result.current.handleActionSelect('act_1', null, '', 0, vi.fn(), vi.fn(), true);
            });

            // Must NOT have logged a deselect event.
            const log = interactionLogger.getLog();
            expect(log.some(e => e.type === 'action_deselected')).toBe(false);
            // Must have requested a fresh diagram fetch for act_1.
            expect(api.getActionVariantDiagram).toHaveBeenCalledWith('act_1');
            // Selection must still be on act_1.
            expect(result.current.selectedActionId).toBe('act_1');
        });

        it('still deselects when called without force on the already-selected action', async () => {
            const { api } = await import('../api');
            const { result } = renderHook(() => useDiagrams([], [], ''));

            act(() => { result.current.setSelectedActionId('act_1'); });
            interactionLogger.clear();
            vi.mocked(api.getActionVariantDiagram).mockClear();

            await act(async () => {
                await result.current.handleActionSelect('act_1', null, '', 0, vi.fn(), vi.fn());
            });

            const log = interactionLogger.getLog();
            expect(log.some(e => e.type === 'action_deselected')).toBe(true);
            // No fetch is issued on the toggle-off path.
            expect(api.getActionVariantDiagram).not.toHaveBeenCalled();
        });
    });

    // Regression tests for the detachable-tab fixes (see
    // docs/detachable-viz-tabs.md "Bugs fixed in the second iteration").
    // The previous `active` gate on usePanZoom was `activeTab === '<id>'`
    // alone, which meant that when the user detached a tab the main
    // window auto-switched activeTab elsewhere and the detached tab's
    // pan/zoom listeners were never bound — the popup looked frozen.
    // The fix threads a detachedTabs map through useDiagrams so a
    // detached tab stays interactive even when it is not activeTab.
    describe('useDiagrams accepts detachedTabs for pan/zoom activation (Bug 1)', () => {
        it('accepts a detachedTabs map as the 4th argument', () => {
            // With an empty map the hook behaves exactly like before.
            const { result } = renderHook(() => useDiagrams([], [], '', {}));
            expect(result.current.activeTab).toBe('n');
        });

        it('tolerates each detached-tab key variant without throwing', () => {
            const maps: Array<Partial<Record<string, unknown>>> = [
                { n: { window: {}, mountNode: document.createElement('div') } },
                { 'n-1': { window: {}, mountNode: document.createElement('div') } },
                { action: { window: {}, mountNode: document.createElement('div') } },
                { overflow: { window: {}, mountNode: document.createElement('div') } },
            ];
            for (const m of maps) {
                // Each map represents one tab being detached; the
                // hook should still initialise without any runtime
                // error. This guards against a regression where the
                // 4th-argument type tightens and the map's shape can
                // no longer be passed in.
                expect(() => renderHook(() => useDiagrams([], [], '', m as never))).not.toThrow();
            }
        });

        it('re-renders with a new detachedTabs map without losing state', () => {
            // Start with no detached tabs.
            const { result, rerender } = renderHook(
                ({ dt }: { dt: Record<string, unknown> }) => useDiagrams([], [], '', dt),
                { initialProps: { dt: {} as Record<string, unknown> } }
            );
            const initialActiveTab = result.current.activeTab;

            // Detach the N tab.
            rerender({ dt: { n: { window: {}, mountNode: document.createElement('div') } } });
            // Hook state (refs, active tab) is not clobbered.
            expect(result.current.activeTab).toBe(initialActiveTab);
            // SVG refs remain the same object identity — critical for
            // stable pan/zoom across detach.
            const nRef = result.current.nSvgContainerRef;
            rerender({ dt: {} });
            expect(result.current.nSvgContainerRef).toBe(nRef);
        });
    });
});
