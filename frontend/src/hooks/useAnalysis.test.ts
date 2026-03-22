import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAnalysis } from './useAnalysis';

// Mock the api module (dynamic import in useAnalysis)
const mockRunAnalysisStep1 = vi.fn();
const mockRunAnalysisStep2Stream = vi.fn();

vi.mock('../api', () => ({
    api: {
        runAnalysisStep1: (...args: unknown[]) => mockRunAnalysisStep1(...args),
        runAnalysisStep2Stream: (...args: unknown[]) => mockRunAnalysisStep2Stream(...args),
    },
}));

/** Helper: build a ReadableStream from an NDJSON string */
function makeStream(ndjson: string): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            controller.enqueue(encoder.encode(ndjson));
            controller.close();
        },
    });
}

describe('useAnalysis', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it('initializes with null result and no loading', () => {
        const { result } = renderHook(() => useAnalysis());
        expect(result.current.result).toBeNull();
        expect(result.current.analysisLoading).toBe(false);
        expect(result.current.error).toBe('');
    });

    it('does nothing when selectedBranch is empty', async () => {
        const { result } = renderHook(() => useAnalysis());
        const clear = vi.fn();
        const setSuggested = vi.fn();

        await act(async () => {
            await result.current.handleRunAnalysis('', clear, setSuggested);
        });

        expect(clear).not.toHaveBeenCalled();
        expect(mockRunAnalysisStep1).not.toHaveBeenCalled();
    });

    it('sets error when step1 returns can_proceed=false', async () => {
        mockRunAnalysisStep1.mockResolvedValue({
            can_proceed: false,
            message: 'Network not loaded',
            lines_overloaded: [],
        });

        const { result } = renderHook(() => useAnalysis());
        const clear = vi.fn();
        const setSuggested = vi.fn();

        await act(async () => {
            await result.current.handleRunAnalysis('LINE_X', clear, setSuggested);
        });

        expect(result.current.error).toBe('Network not loaded');
        expect(result.current.analysisLoading).toBe(false);
        expect(mockRunAnalysisStep2Stream).not.toHaveBeenCalled();
    });

    it('sets info message when no overloads detected', async () => {
        mockRunAnalysisStep1.mockResolvedValue({
            can_proceed: true,
            message: 'No overloads detected',
            lines_overloaded: [],
        });

        const { result } = renderHook(() => useAnalysis());

        await act(async () => {
            await result.current.handleRunAnalysis('LINE_X', vi.fn(), vi.fn());
        });

        expect(result.current.infoMessage).toBe('No overloads detected');
        expect(result.current.analysisLoading).toBe(false);
    });

    it('calls runAnalysisStep2Stream with all_overloads and monitor_deselected', async () => {
        const detected = ['LINE_A', 'LINE_B'];
        mockRunAnalysisStep1.mockResolvedValue({
            can_proceed: true,
            message: '',
            lines_overloaded: detected,
        });

        const resultEvent = JSON.stringify({
            type: 'result',
            actions: {},
            lines_overloaded: detected,
            message: 'Done',
            dc_fallback: false,
        });
        const stream = makeStream(`${resultEvent}\n`);

        mockRunAnalysisStep2Stream.mockResolvedValue({
            ok: true,
            body: stream,
        });

        const { result } = renderHook(() => useAnalysis());

        await act(async () => {
            await result.current.handleRunAnalysis('LINE_X', vi.fn(), vi.fn());
        });

        // Verify step2 was called with correct params
        expect(mockRunAnalysisStep2Stream).toHaveBeenCalledWith({
            selected_overloads: detected,
            all_overloads: detected,
            monitor_deselected: false,
        });
    });

    it('passes monitor_deselected=true when enabled', async () => {
        const detected = ['LINE_A'];
        mockRunAnalysisStep1.mockResolvedValue({
            can_proceed: true,
            message: '',
            lines_overloaded: detected,
        });

        const stream = makeStream(
            JSON.stringify({ type: 'result', actions: {}, lines_overloaded: detected, message: '', dc_fallback: false }) + '\n',
        );
        mockRunAnalysisStep2Stream.mockResolvedValue({ ok: true, body: stream });

        const { result } = renderHook(() => useAnalysis());

        // Enable monitor_deselected
        act(() => { result.current.setMonitorDeselected(true); });

        await act(async () => {
            await result.current.handleRunAnalysis('LINE_X', vi.fn(), vi.fn());
        });

        expect(mockRunAnalysisStep2Stream).toHaveBeenCalledWith(
            expect.objectContaining({ monitor_deselected: true }),
        );
    });

    it('processes PDF and result NDJSON events from stream', async () => {
        const detected = ['LINE_A'];
        mockRunAnalysisStep1.mockResolvedValue({
            can_proceed: true, message: '', lines_overloaded: detected,
        });

        const pdfEvent = JSON.stringify({ type: 'pdf', pdf_url: '/results/pdf/graph.pdf', pdf_path: '/tmp/graph.pdf' });
        const resultEvent = JSON.stringify({
            type: 'result',
            actions: {
                act_1: {
                    description_unitaire: 'Test action',
                    rho_before: [0.95], rho_after: [0.80],
                    max_rho: 0.80, max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                },
            },
            lines_overloaded: detected,
            message: 'Analysis done',
            dc_fallback: false,
        });

        const stream = makeStream(`${pdfEvent}\n${resultEvent}\n`);
        mockRunAnalysisStep2Stream.mockResolvedValue({ ok: true, body: stream });

        const { result } = renderHook(() => useAnalysis());
        const setSuggested = vi.fn();

        await act(async () => {
            await result.current.handleRunAnalysis('LINE_X', vi.fn(), setSuggested);
        });

        // PDF event sets result.pdf_url
        expect(result.current.result?.pdf_url).toBe('/results/pdf/graph.pdf');

        // Result event sets pending result and suggested IDs
        expect(result.current.pendingAnalysisResult).not.toBeNull();
        expect(result.current.pendingAnalysisResult?.actions?.act_1).toBeDefined();
        expect(setSuggested).toHaveBeenCalled();
    });

    it('sets error on stream error event', async () => {
        const detected = ['LINE_A'];
        mockRunAnalysisStep1.mockResolvedValue({
            can_proceed: true, message: '', lines_overloaded: detected,
        });

        const stream = makeStream(
            JSON.stringify({ type: 'error', message: 'Backend crashed' }) + '\n',
        );
        mockRunAnalysisStep2Stream.mockResolvedValue({ ok: true, body: stream });

        const { result } = renderHook(() => useAnalysis());

        await act(async () => {
            await result.current.handleRunAnalysis('LINE_X', vi.fn(), vi.fn());
        });

        expect(result.current.error).toBe('Analysis failed: Backend crashed');
    });

    it('sets error when step2 rejects', async () => {
        mockRunAnalysisStep1.mockResolvedValue({
            can_proceed: true, message: '', lines_overloaded: ['LINE_A'],
        });
        mockRunAnalysisStep2Stream.mockRejectedValue(new Error('Network error'));

        const { result } = renderHook(() => useAnalysis());

        await act(async () => {
            await result.current.handleRunAnalysis('LINE_X', vi.fn(), vi.fn());
        });

        expect(result.current.error).toBe('Network error');
        expect(result.current.analysisLoading).toBe(false);
    });

    describe('handleToggleOverload', () => {
        it('adds and removes overloads from selection', () => {
            const { result } = renderHook(() => useAnalysis());

            act(() => { result.current.handleToggleOverload('LINE_A'); });
            expect(result.current.selectedOverloads.has('LINE_A')).toBe(true);

            act(() => { result.current.handleToggleOverload('LINE_A'); });
            expect(result.current.selectedOverloads.has('LINE_A')).toBe(false);
        });
    });

    describe('handleDisplayPrioritizedActions', () => {
        it('merges pending result into result and clears pending', async () => {
            const { result } = renderHook(() => useAnalysis());

            // Simulate having a pending result
            const pendingResult = {
                actions: {
                    act_1: {
                        description_unitaire: 'Reco',
                        rho_before: [1.1], rho_after: [0.9],
                        max_rho: 0.9, max_rho_line: 'LINE_A',
                        is_rho_reduction: true,
                    },
                },
                lines_overloaded: ['LINE_A'],
                message: 'OK',
                dc_fallback: false,
                pdf_path: null,
                pdf_url: null,
            };

            act(() => {
                result.current.setPendingAnalysisResult(pendingResult);
            });

            act(() => {
                result.current.handleDisplayPrioritizedActions(new Set());
            });

            expect(result.current.result?.actions?.act_1).toBeDefined();
            expect(result.current.pendingAnalysisResult).toBeNull();
        });

        it('preserves manually selected actions during merge', async () => {
            const { result } = renderHook(() => useAnalysis());

            // Set an existing result with a manual action
            act(() => {
                result.current.setResult({
                    actions: {
                        manual_1: {
                            description_unitaire: 'Manual',
                            rho_before: null, rho_after: [0.85],
                            max_rho: 0.85, max_rho_line: 'LINE_B',
                            is_rho_reduction: true, is_manual: true,
                        },
                    },
                    lines_overloaded: ['LINE_A'],
                    message: '', dc_fallback: false,
                    pdf_path: null, pdf_url: null,
                });
            });

            // Set pending result with new recommended actions
            act(() => {
                result.current.setPendingAnalysisResult({
                    actions: {
                        reco_1: {
                            description_unitaire: 'Reco',
                            rho_before: [1.1], rho_after: [0.9],
                            max_rho: 0.9, max_rho_line: 'LINE_A',
                            is_rho_reduction: true,
                        },
                    },
                    lines_overloaded: ['LINE_A'],
                    message: 'OK', dc_fallback: false,
                    pdf_path: null, pdf_url: null,
                });
            });

            // Display prioritized, keeping manual_1 selected
            act(() => {
                result.current.handleDisplayPrioritizedActions(new Set(['manual_1']));
            });

            // Both actions should be in the final result
            expect(result.current.result?.actions?.manual_1).toBeDefined();
            expect(result.current.result?.actions?.reco_1).toBeDefined();
        });
    });

    describe('overload filtering in step 2', () => {
        it('uses previously selected overloads when still relevant', async () => {
            const detected = ['LINE_A', 'LINE_B', 'LINE_C'];
            mockRunAnalysisStep1.mockResolvedValue({
                can_proceed: true, message: '', lines_overloaded: detected,
            });

            const stream = makeStream(
                JSON.stringify({ type: 'result', actions: {}, lines_overloaded: detected, message: '', dc_fallback: false }) + '\n',
            );
            mockRunAnalysisStep2Stream.mockResolvedValue({ ok: true, body: stream });

            const { result } = renderHook(() => useAnalysis());

            // Pre-select a subset of overloads
            act(() => { result.current.setSelectedOverloads(new Set(['LINE_A', 'LINE_B'])); });

            await act(async () => {
                await result.current.handleRunAnalysis('LINE_X', vi.fn(), vi.fn());
            });

            // Should resolve only the intersection of detected and previously selected
            expect(mockRunAnalysisStep2Stream).toHaveBeenCalledWith(
                expect.objectContaining({
                    selected_overloads: ['LINE_A', 'LINE_B'],
                    all_overloads: detected,
                }),
            );
        });

        it('resets to all detected when previous selection has no overlap', async () => {
            const detected = ['LINE_C', 'LINE_D'];
            mockRunAnalysisStep1.mockResolvedValue({
                can_proceed: true, message: '', lines_overloaded: detected,
            });

            const stream = makeStream(
                JSON.stringify({ type: 'result', actions: {}, lines_overloaded: detected, message: '', dc_fallback: false }) + '\n',
            );
            mockRunAnalysisStep2Stream.mockResolvedValue({ ok: true, body: stream });

            const { result } = renderHook(() => useAnalysis());

            // Pre-select overloads that won't be detected
            act(() => { result.current.setSelectedOverloads(new Set(['LINE_A', 'LINE_B'])); });

            await act(async () => {
                await result.current.handleRunAnalysis('LINE_X', vi.fn(), vi.fn());
            });

            // Should fall back to all detected
            expect(mockRunAnalysisStep2Stream).toHaveBeenCalledWith(
                expect.objectContaining({
                    selected_overloads: detected,
                    all_overloads: detected,
                }),
            );
        });
    });

    describe('info message auto-clear', () => {
        it('clears info message after timeout', async () => {
            vi.useFakeTimers();
            const { result } = renderHook(() => useAnalysis());

            act(() => { result.current.setInfoMessage('Temporary message'); });
            expect(result.current.infoMessage).toBe('Temporary message');

            act(() => { vi.advanceTimersByTime(3000); });
            expect(result.current.infoMessage).toBe('');

            vi.useRealTimers();
        });
    });
});
