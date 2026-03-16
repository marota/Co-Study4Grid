import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';
import { api } from './api';

vi.mock('axios');
const mockedAxios = vi.mocked(axios, true);

describe('api client', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe('updateConfig', () => {
        it('sends POST to /api/config', async () => {
            const config = {
                network_path: '/test/path',
                action_file_path: '/test/actions.json',
                min_line_reconnections: 2.0,
                min_close_coupling: 3.0,
                min_open_coupling: 2.0,
                min_line_disconnections: 3.0,
                n_prioritized_actions: 10,
                monitoring_factor: 0.95,
                pre_existing_overload_threshold: 0.02,
                ignore_reconnections: false,
                pypowsybl_fast_mode: true
            };
            mockedAxios.post.mockResolvedValue({ data: { status: 'success' } });

            const result = await api.updateConfig(config);
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'http://localhost:8000/api/config',
                config,
            );
            expect(result).toEqual({ status: 'success' });
        });
    });

    describe('getBranches', () => {
        it('sends GET to /api/branches and returns branches array', async () => {
            mockedAxios.get.mockResolvedValue({
                data: { branches: ['LINE_A', 'LINE_B'] },
            });

            const result = await api.getBranches();
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'http://localhost:8000/api/branches',
            );
            expect(result).toEqual(['LINE_A', 'LINE_B']);
        });
    });

    describe('getVoltageLevels', () => {
        it('returns voltage levels array', async () => {
            mockedAxios.get.mockResolvedValue({
                data: { voltage_levels: ['VL1', 'VL2'] },
            });

            const result = await api.getVoltageLevels();
            expect(result).toEqual(['VL1', 'VL2']);
        });
    });

    describe('getNominalVoltages', () => {
        it('returns mapping and unique_kv', async () => {
            const responseData = {
                mapping: { VL1: 400, VL2: 225 },
                unique_kv: [225, 400],
            };
            mockedAxios.get.mockResolvedValue({ data: responseData });

            const result = await api.getNominalVoltages();
            expect(result).toEqual(responseData);
        });
    });

    describe('getNetworkDiagram', () => {
        it('returns diagram data', async () => {
            const diagramData = { svg: '<svg/>', metadata: '{}' };
            mockedAxios.get.mockResolvedValue({ data: diagramData });

            const result = await api.getNetworkDiagram();
            expect(result).toEqual(diagramData);
        });
    });

    describe('getN1Diagram', () => {
        it('sends POST with disconnected element', async () => {
            const diagramData = { svg: '<svg/>', metadata: '{}', lf_converged: true };
            mockedAxios.post.mockResolvedValue({ data: diagramData });

            const result = await api.getN1Diagram('LINE_A');
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'http://localhost:8000/api/n1-diagram',
                { disconnected_element: 'LINE_A' },
            );
            expect(result).toEqual(diagramData);
        });
    });

    describe('getActionVariantDiagram', () => {
        it('sends POST with action ID', async () => {
            mockedAxios.post.mockResolvedValue({
                data: { svg: '<svg/>', metadata: '{}', action_id: 'act_1' },
            });

            const result = await api.getActionVariantDiagram('act_1');
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'http://localhost:8000/api/action-variant-diagram',
                { action_id: 'act_1' },
            );
            expect(result.action_id).toBe('act_1');
        });
    });

    describe('getAvailableActions', () => {
        it('returns actions list', async () => {
            const actions = [{ id: 'act_1', description: 'Test' }];
            mockedAxios.get.mockResolvedValue({
                data: { actions },
            });

            const result = await api.getAvailableActions();
            expect(result).toEqual(actions);
        });
    });

    describe('simulateManualAction', () => {
        it('sends POST with action_id and disconnected_element', async () => {
            const responseData = {
                action_id: 'act_1',
                description_unitaire: 'Open line',
                rho_before: [0.95],
                rho_after: [0.80],
                max_rho: 0.80,
                max_rho_line: 'LINE_A',
                is_rho_reduction: true,
                lines_overloaded: ['LINE_A'],
            };
            mockedAxios.post.mockResolvedValue({ data: responseData });

            const result = await api.simulateManualAction('act_1', 'LINE_B');
            expect(mockedAxios.post).toHaveBeenCalledWith(
                'http://localhost:8000/api/simulate-manual-action',
                { action_id: 'act_1', disconnected_element: 'LINE_B', action_content: null },
            );
            expect(result).toEqual(responseData);
        });
    });

    describe('pickPath', () => {
        it('sends GET with file type parameter', async () => {
            mockedAxios.get.mockResolvedValue({
                data: { path: '/home/user/test.xiidm' },
            });

            const result = await api.pickPath('file');
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'http://localhost:8000/api/pick-path?type=file',
            );
            expect(result).toBe('/home/user/test.xiidm');
        });

        it('sends GET with dir type parameter', async () => {
            mockedAxios.get.mockResolvedValue({
                data: { path: '/home/user/networks' },
            });

            const result = await api.pickPath('dir');
            expect(mockedAxios.get).toHaveBeenCalledWith(
                'http://localhost:8000/api/pick-path?type=dir',
            );
            expect(result).toBe('/home/user/networks');
        });
    });

    describe('runAnalysis', () => {
        it('parses NDJSON streaming response', async () => {
            // Mock the global fetch for streaming
            const pdfEvent = JSON.stringify({ type: 'pdf', pdf_url: '/results/pdf/graph.pdf', pdf_path: '/tmp/graph.pdf' });
            const resultEvent = JSON.stringify({
                type: 'result',
                actions: { act_1: { description_unitaire: 'Test', rho_before: null, rho_after: null, max_rho: null, max_rho_line: '', is_rho_reduction: false } },
                action_scores: {},
                lines_overloaded: ['LINE_A'],
                message: 'Analysis completed',
                dc_fallback: false,
            });
            const body = `${pdfEvent}\n${resultEvent}\n`;

            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(body));
                    controller.close();
                },
            });

            const mockResponse = {
                ok: true,
                body: stream,
                statusText: 'OK',
            } as unknown as Response;

            const originalFetch = globalThis.fetch;
            globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

            try {
                const result = await api.runAnalysis('LINE_A');
                expect(result.pdf_url).toBe('/results/pdf/graph.pdf');
                expect(result.message).toBe('Analysis completed');
                expect(result.lines_overloaded).toEqual(['LINE_A']);
                expect(result.dc_fallback).toBe(false);
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        it('throws on non-ok response', async () => {
            const mockResponse = {
                ok: false,
                statusText: 'Internal Server Error',
            } as unknown as Response;

            const originalFetch = globalThis.fetch;
            globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

            try {
                await expect(api.runAnalysis('LINE_A')).rejects.toThrow('Analysis failed');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });

        it('throws on error event in stream', async () => {
            const errorEvent = JSON.stringify({ type: 'error', message: 'Something went wrong' });
            const body = `${errorEvent}\n`;

            const encoder = new TextEncoder();
            const stream = new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(body));
                    controller.close();
                },
            });

            const mockResponse = {
                ok: true,
                body: stream,
                statusText: 'OK',
            } as unknown as Response;

            const originalFetch = globalThis.fetch;
            globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

            try {
                await expect(api.runAnalysis('LINE_A')).rejects.toThrow('Something went wrong');
            } finally {
                globalThis.fetch = originalFetch;
            }
        });
    });
});
