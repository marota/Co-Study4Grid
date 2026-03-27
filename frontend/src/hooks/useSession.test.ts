import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSession } from './useSession';
import { interactionLogger } from '../utils/interactionLogger';

// Mock the api module
const mockSaveSession = vi.fn();
const mockListSessions = vi.fn();
const mockLoadSession = vi.fn();

vi.mock('../api', () => ({
    api: {
        saveSession: (...args: unknown[]) => mockSaveSession(...args),
        listSessions: (...args: unknown[]) => mockListSessions(...args),
        loadSession: (...args: unknown[]) => mockLoadSession(...args),
        updateConfig: vi.fn().mockResolvedValue({}),
        getBranches: vi.fn().mockResolvedValue([]),
        getVoltageLevels: vi.fn().mockResolvedValue([]),
        getNominalVoltages: vi.fn().mockResolvedValue({ mapping: {}, unique_kv: [] }),
        restoreAnalysisContext: vi.fn().mockResolvedValue({}),
    },
}));

vi.mock('../utils/sessionUtils', () => ({
    buildSessionResult: vi.fn().mockReturnValue({
        saved_at: '2026-03-27T12:00:00.000Z',
        configuration: {},
        contingency: { disconnected_element: '', selected_overloads: [], monitor_deselected: false },
        overloads: { n_overloads: [], n1_overloads: [], resolved_overloads: [] },
        overflow_graph: null,
        analysis: null,
        interaction_log: [],
    }),
}));

describe('useSession — interaction logging', () => {
    beforeEach(() => {
        interactionLogger.clear();
        vi.clearAllMocks();
    });

    const makeSaveParams = (overrides: Record<string, unknown> = {}) => ({
        networkPath: '/data/net.xiidm',
        actionPath: '/data/actions.json',
        layoutPath: '',
        outputFolderPath: '/tmp/output',
        minLineReconnections: 2, minCloseCoupling: 3, minOpenCoupling: 2, minLineDisconnections: 3,
        minPst: 1, minLoadShedding: 0, nPrioritizedActions: 10,
        linesMonitoringPath: '', monitoringFactor: 0.95, preExistingOverloadThreshold: 0.02,
        ignoreReconnections: false, pypowsyblFastMode: true,
        selectedBranch: 'LINE_A', selectedOverloads: new Set(['OL1']), monitorDeselected: false,
        nOverloads: [] as string[], n1Overloads: ['OL1'],
        result: null,
        selectedActionIds: new Set<string>(), rejectedActionIds: new Set<string>(),
        manuallyAddedIds: new Set<string>(), suggestedByRecommenderIds: new Set<string>(),
        setInfoMessage: vi.fn(), setError: vi.fn(),
        ...overrides,
    });

    it('logs session_saved when handleSaveResults is called with output folder', async () => {
        mockSaveSession.mockResolvedValue({ session_folder: '/tmp/session_1', pdf_copied: false });

        const { result } = renderHook(() => useSession());

        await act(async () => {
            await result.current.handleSaveResults(makeSaveParams());
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('session_saved');
        expect(log[0].details).toEqual({ output_folder: '/tmp/output' });
    });

    it('logs session_saved even for browser download (no output folder)', async () => {
        // Render the hook FIRST before mocking document.createElement
        const { result } = renderHook(() => useSession());

        // Now mock DOM for download
        const mockAnchor = document.createElement('a');
        const clickSpy = vi.spyOn(mockAnchor, 'click').mockImplementation(() => {});
        const createElementSpy = vi.spyOn(document, 'createElement').mockReturnValue(mockAnchor);
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:test');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

        await act(async () => {
            await result.current.handleSaveResults(makeSaveParams({ outputFolderPath: '', selectedBranch: '' }));
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('session_saved');
        expect(log[0].details).toEqual({ output_folder: '' });
        expect(clickSpy).toHaveBeenCalled();

        createElementSpy.mockRestore();
    });

    it('logs session_reload_modal_opened when handleOpenReloadModal is called', async () => {
        mockListSessions.mockResolvedValue({ sessions: ['session_1', 'session_2'] });

        const { result } = renderHook(() => useSession());
        const setError = vi.fn();

        await act(async () => {
            await result.current.handleOpenReloadModal('/tmp/output', setError);
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('session_reload_modal_opened');
    });

    it('logs session_reload_modal_opened even when outputFolderPath is empty (before error)', async () => {
        const { result } = renderHook(() => useSession());
        const setError = vi.fn();

        await act(async () => {
            await result.current.handleOpenReloadModal('', setError);
        });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(1);
        expect(log[0].type).toBe('session_reload_modal_opened');
        expect(setError).toHaveBeenCalled();
    });

    it('passes interaction_log to api.saveSession', async () => {
        mockSaveSession.mockResolvedValue({ session_folder: '/tmp/s', pdf_copied: false });

        // Record some interactions first
        interactionLogger.record('zoom_in');
        interactionLogger.record('config_loaded', { path: '/data' });

        const { result } = renderHook(() => useSession());

        await act(async () => {
            await result.current.handleSaveResults(makeSaveParams());
        });

        expect(mockSaveSession).toHaveBeenCalledTimes(1);
        const callArgs = mockSaveSession.mock.calls[0][0];
        expect(callArgs.interaction_log).toBeDefined();
        // Should be valid JSON containing our logged events
        const parsed = JSON.parse(callArgs.interaction_log);
        expect(Array.isArray(parsed)).toBe(true);
        // At least the two we recorded plus the session_saved event
        expect(parsed.length).toBeGreaterThanOrEqual(3);
    });

    it('handleSaveResults passes interactionLog to buildSessionResult', async () => {
        mockSaveSession.mockResolvedValue({ session_folder: '/tmp/s', pdf_copied: false });
        const { buildSessionResult } = await import('../utils/sessionUtils');

        interactionLogger.record('zoom_in');

        const { result } = renderHook(() => useSession());

        await act(async () => {
            await result.current.handleSaveResults(makeSaveParams({ networkPath: '', actionPath: '', selectedBranch: '' }));
        });

        expect(buildSessionResult).toHaveBeenCalledTimes(1);
        const buildArgs = (buildSessionResult as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(buildArgs.interactionLog).toBeDefined();
        expect(Array.isArray(buildArgs.interactionLog)).toBe(true);
    });
});
