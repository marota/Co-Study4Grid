// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSldOverlay } from './useSldOverlay';

vi.mock('../api', () => ({
    api: {
        getNSld: vi.fn(),
        getN1Sld: vi.fn(),
        getActionVariantSld: vi.fn(),
    }
}));

vi.mock('../utils/interactionLogger', () => ({
    interactionLogger: { record: vi.fn() },
}));

import { api } from '../api';
import { interactionLogger } from '../utils/interactionLogger';

describe('useSldOverlay', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with null vlOverlay', () => {
        const { result } = renderHook(() => useSldOverlay('n'));
        expect(result.current.vlOverlay).toBeNull();
    });

    it('initializes selectedBranchForSld ref with empty string', () => {
        const { result } = renderHook(() => useSldOverlay('n'));
        expect(result.current.selectedBranchForSld.current).toBe('');
    });

    it('handleVlDoubleClick sets vlOverlay with loading state', () => {
        vi.mocked(api.getNSld).mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const { result } = renderHook(() => useSldOverlay('n'));

        act(() => {
            result.current.handleVlDoubleClick('action_1', 'VL_400');
        });

        expect(result.current.vlOverlay).not.toBeNull();
        expect(result.current.vlOverlay!.vlName).toBe('VL_400');
        expect(result.current.vlOverlay!.actionId).toBe('action_1');
        expect(result.current.vlOverlay!.loading).toBe(true);
        expect(result.current.vlOverlay!.svg).toBeNull();
    });

    it('handleVlDoubleClick logs interaction', () => {
        vi.mocked(api.getNSld).mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const { result } = renderHook(() => useSldOverlay('n'));

        act(() => {
            result.current.handleVlDoubleClick('action_1', 'VL_400');
        });

        expect(interactionLogger.record).toHaveBeenCalledWith('sld_overlay_opened', {
            vl_name: 'VL_400',
            action_id: 'action_1',
        });
    });

    it('handleVlDoubleClick uses correct initial tab based on activeTab', () => {
        vi.mocked(api.getN1Sld).mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const { result } = renderHook(() => useSldOverlay('n-1'));

        act(() => {
            result.current.handleVlDoubleClick('act1', 'VL_220');
        });

        expect(result.current.vlOverlay!.tab).toBe('n-1');
    });

    it('handleVlDoubleClick sets tab to action for action activeTab', () => {
        vi.mocked(api.getActionVariantSld).mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const { result } = renderHook(() => useSldOverlay('action'));

        act(() => {
            result.current.handleVlDoubleClick('act1', 'VL_63');
        });

        expect(result.current.vlOverlay!.tab).toBe('action');
    });

    it('handleOverlayClose sets vlOverlay to null', () => {
        vi.mocked(api.getNSld).mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const { result } = renderHook(() => useSldOverlay('n'));

        act(() => {
            result.current.handleVlDoubleClick('act1', 'VL_400');
        });
        expect(result.current.vlOverlay).not.toBeNull();

        act(() => {
            result.current.handleOverlayClose();
        });
        expect(result.current.vlOverlay).toBeNull();
    });

    it('handleOverlayClose logs interaction', () => {
        const { result } = renderHook(() => useSldOverlay('n'));
        act(() => {
            result.current.handleOverlayClose();
        });
        expect(interactionLogger.record).toHaveBeenCalledWith('sld_overlay_closed');
    });

    it('handleOverlaySldTabChange does nothing when vlOverlay is null', () => {
        const { result } = renderHook(() => useSldOverlay('n'));
        act(() => {
            result.current.handleOverlaySldTabChange('n-1');
        });
        // No error thrown, no overlay set
        expect(result.current.vlOverlay).toBeNull();
    });

    it('handleOverlaySldTabChange logs interaction when vlOverlay exists', () => {
        vi.mocked(api.getNSld).mockImplementation(() => new Promise(() => { /* never resolves */ }));
        const { result } = renderHook(() => useSldOverlay('n'));

        act(() => {
            result.current.handleVlDoubleClick('act1', 'VL_400');
        });

        vi.mocked(api.getN1Sld).mockImplementation(() => new Promise(() => { /* never resolves */ }));
        act(() => {
            result.current.handleOverlaySldTabChange('n-1');
        });

        expect(interactionLogger.record).toHaveBeenCalledWith('sld_overlay_tab_changed', {
            tab: 'n-1',
            vl_name: 'VL_400',
        });
    });

    it('setVlOverlay allows direct state manipulation', () => {
        const { result } = renderHook(() => useSldOverlay('n'));

        act(() => {
            result.current.setVlOverlay({
                vlName: 'VL_TEST',
                actionId: null,
                svg: '<svg/>',
                sldMetadata: null,
                loading: false,
                error: null,
                tab: 'n',
            });
        });

        expect(result.current.vlOverlay).not.toBeNull();
        expect(result.current.vlOverlay!.vlName).toBe('VL_TEST');
    });

    it('fetchSldVariant resolves and populates vlOverlay with N SLD data', async () => {
        vi.mocked(api.getNSld).mockResolvedValue({
            svg: '<svg>N-SLD</svg>',
            sld_metadata: '{"nodes":[]}',
        });

        const { result } = renderHook(() => useSldOverlay('n'));

        act(() => {
            result.current.handleVlDoubleClick('act1', 'VL_400');
        });

        // Wait for the async fetch to complete
        await vi.waitFor(() => {
            expect(result.current.vlOverlay!.loading).toBe(false);
        });

        expect(result.current.vlOverlay!.svg).toBe('<svg>N-SLD</svg>');
        expect(result.current.vlOverlay!.sldMetadata).toBe('{"nodes":[]}');
    });

    it('fetchSldVariant handles error gracefully', async () => {
        vi.mocked(api.getNSld).mockRejectedValue({
            response: { data: { detail: 'Network error' } },
        });

        const { result } = renderHook(() => useSldOverlay('n'));

        act(() => {
            result.current.handleVlDoubleClick('act1', 'VL_400');
        });

        await vi.waitFor(() => {
            expect(result.current.vlOverlay!.loading).toBe(false);
        });

        expect(result.current.vlOverlay!.error).toBe('Network error');
        expect(result.current.vlOverlay!.svg).toBeNull();
    });
});
