import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSettings } from './useSettings';
import { interactionLogger } from '../utils/interactionLogger';

// Mock the api module
vi.mock('../api', () => ({
    api: {
        pickPath: vi.fn(),
        getUserConfig: vi.fn().mockResolvedValue({}),
        getConfigFilePath: vi.fn().mockResolvedValue(''),
        saveUserConfig: vi.fn().mockResolvedValue({}),
        setConfigFilePath: vi.fn().mockResolvedValue({ config_file_path: '', config: {} }),
    },
}));

describe('useSettings — interaction logging', () => {
    beforeEach(() => {
        interactionLogger.clear();
        vi.clearAllMocks();
    });

    it('logs settings_opened with tab when handleOpenSettings is called', () => {
        const { result } = renderHook(() => useSettings());

        act(() => {
            result.current.handleOpenSettings('recommender');
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('settings_opened');
        expect(log[0].details).toEqual({ tab: 'recommender' });
    });

    it('logs settings_opened with default tab "paths"', () => {
        const { result } = renderHook(() => useSettings());

        act(() => {
            result.current.handleOpenSettings();
        });

        const log = interactionLogger.getLog();
        expect(log[0].details).toEqual({ tab: 'paths' });
    });

    it('logs settings_cancelled when handleCloseSettings is called', () => {
        const { result } = renderHook(() => useSettings());

        // Open first to set backup
        act(() => { result.current.handleOpenSettings(); });
        interactionLogger.clear();

        act(() => { result.current.handleCloseSettings(); });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('settings_cancelled');
    });

    it('logs path_picked when pickSettingsPath succeeds', async () => {
        const { api } = await import('../api');
        (api.pickPath as ReturnType<typeof vi.fn>).mockResolvedValue('/data/network.xiidm');

        const { result } = renderHook(() => useSettings());
        const setter = vi.fn();

        await act(async () => {
            await result.current.pickSettingsPath('file', setter);
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('path_picked');
        expect(log[0].details).toEqual({ type: 'file', path: '/data/network.xiidm' });
        expect(setter).toHaveBeenCalledWith('/data/network.xiidm');
    });

    it('does not log path_picked when pickSettingsPath returns empty', async () => {
        const { api } = await import('../api');
        (api.pickPath as ReturnType<typeof vi.fn>).mockResolvedValue('');

        const { result } = renderHook(() => useSettings());

        await act(async () => {
            await result.current.pickSettingsPath('dir', vi.fn());
        });

        expect(interactionLogger.getLog()).toHaveLength(0);
    });

    it('does not log path_picked when pickSettingsPath throws', async () => {
        const { api } = await import('../api');
        (api.pickPath as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('No picker'));

        const { result } = renderHook(() => useSettings());

        await act(async () => {
            await result.current.pickSettingsPath('file', vi.fn());
        });

        expect(interactionLogger.getLog()).toHaveLength(0);
    });

    it('logs settings_opened for each tab type', () => {
        const { result } = renderHook(() => useSettings());

        const tabs = ['paths', 'recommender', 'configurations'] as const;
        for (const tab of tabs) {
            act(() => { result.current.handleOpenSettings(tab); });
        }

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(3);
        expect(log.map(e => e.details.tab)).toEqual(['paths', 'recommender', 'configurations']);
    });
});
