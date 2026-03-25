import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CombinedActionsModal from './CombinedActionsModal';
import { api } from '../api';
import type { AnalysisResult, CombinedAction } from '../types';

type SimulateResult = Awaited<ReturnType<typeof api.simulateManualAction>>;

describe('CombinedActionsModal', () => {
    const mockAnalysisResult: AnalysisResult = {
        actions: {
            'act1': { description_unitaire: 'Action 1', max_rho: 0.8, rho_before: [0.8], rho_after: [0.7], max_rho_line: 'L1', is_rho_reduction: true, action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} } },
            'act2': { description_unitaire: 'Action 2', max_rho: 0.9, rho_before: [0.9], rho_after: [0.8], max_rho_line: 'L2', is_rho_reduction: true, action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} } },
            'act3': { description_unitaire: 'Action 3', max_rho: 0.85, rho_before: [0.85], rho_after: [0.8], max_rho_line: 'L3', is_rho_reduction: true, action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} } },
        },
        combined_actions: {
            'act1+act2': {
                action1_id: 'act1',
                action2_id: 'act2',
                betas: [1.0, 0.9],
                max_rho: 0.72,
                max_rho_line: 'L3',
                estimated_max_rho: 0.75,
                estimated_max_rho_line: 'L3_EST',
                is_rho_reduction: true,
                description: 'Pre-computed Pair',
                p_or_combined: [],
                rho_before: [0.75],
                rho_after: [0.72]
            }
        },
        action_scores: {
            'disco': { scores: { 'act1': 10, 'act2': 20, 'act3': 15 } }
        },
        lines_overloaded: [],
        message: 'done',
        dc_fallback: false,
        pdf_path: null,
        pdf_url: null,
    };

    const defaultProps = {
        isOpen: true,
        onClose: vi.fn(),
        analysisResult: mockAnalysisResult,
        disconnectedElement: 'L_FAULTY',
        onSimulateCombined: vi.fn(),
    };

    beforeEach(() => {
        vi.restoreAllMocks();
        vi.spyOn(api, 'computeSuperposition').mockImplementation(() => Promise.resolve({} as unknown as CombinedAction));
        vi.spyOn(api, 'simulateManualAction').mockImplementation(() => Promise.resolve({} as unknown as SimulateResult));
    });

    afterEach(() => {
        cleanup();
    });

    const getExploreTab = () => screen.getByTestId('tab-explore');

    it('renders and shows computed pairs by default', () => {
        render(<CombinedActionsModal {...defaultProps} />);
        expect(screen.getByText('Computed Pairs')).toBeInTheDocument();
        expect(screen.getByText('75.0%')).toBeInTheDocument();
    });

    it('filters actions by category including LS in explore tab', async () => {
        const resultWithTypes: AnalysisResult = {
            ...mockAnalysisResult,
            actions: {
                ...mockAnalysisResult.actions,
                'disco1': { description_unitaire: 'Disco 1', max_rho: 0.8, rho_before: [0.8], rho_after: [0.7], max_rho_line: 'L1', is_rho_reduction: true, action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} } },
                'reco1': { description_unitaire: 'Reco 1', max_rho: 0.9, rho_before: [0.9], rho_after: [0.8], max_rho_line: 'L2', is_rho_reduction: true, action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} } },
                'ls1': { description_unitaire: 'LS 1', max_rho: 0.7, rho_before: [0.7], rho_after: [0.6], max_rho_line: 'L1', is_rho_reduction: true, action_topology: { loads_bus: { 'L1': -1 }, lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {} } },
            },
            action_scores: {
                'disco': { scores: { 'disco1': 10 } },
                'reco': { scores: { 'reco1': 20 } },
                'load_shedding': { scores: { 'ls1': 5 } }
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithTypes as AnalysisResult} />);

        fireEvent.click(getExploreTab());

        // Filter for disconnections
        fireEvent.click(screen.getByRole('button', { name: 'DISCO' }));
        expect(screen.getByText('disco1')).toBeInTheDocument();
        expect(screen.queryByText('reco1')).not.toBeInTheDocument();

        // Filter for load shedding
        fireEvent.click(screen.getByRole('button', { name: 'LS' }));
        expect(screen.getByText('ls1')).toBeInTheDocument();
        expect(screen.queryByText('disco1')).not.toBeInTheDocument();
    });

    it('groups actions by type in explore tab table including LS', async () => {
        const resultWithLS: AnalysisResult = {
            ...mockAnalysisResult,
            actions: {
                ...mockAnalysisResult.actions,
                'ls_test': { description_unitaire: 'LS Test', max_rho: 0.7, rho_before: [0.7], rho_after: [0.6], max_rho_line: 'L1', is_rho_reduction: true, action_topology: { loads_bus: { 'L1': -1 }, lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {} } },
            },
            action_scores: {
                ...mockAnalysisResult.action_scores,
                'load_shedding': { scores: { 'ls_test': 5 } }
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithLS as AnalysisResult} />);
        fireEvent.click(getExploreTab());

        expect(screen.getAllByText('DISCO').length).toBeGreaterThan(0);
        expect(screen.getAllByText('LS').length).toBeGreaterThan(0);
        expect(screen.getByText('ls_test')).toBeInTheDocument();
    });

    it('performs simulation and shows feedback', async () => {
        vi.mocked(api.simulateManualAction).mockResolvedValueOnce({
            action_id: 'act1+act2',
            max_rho: 0.73,
            max_rho_line: 'L3_SIM',
            is_rho_reduction: true,
            is_islanded: false,
            description_unitaire: 'Simulated combined',
            rho_before: [0.8],
            rho_after: [0.73],
            non_convergence: null,
            lines_overloaded: [],
            is_estimated: false
        } as unknown as SimulateResult);

        render(<CombinedActionsModal {...defaultProps} />);

        fireEvent.click(getExploreTab());
        fireEvent.click(screen.getByText('act1'));
        fireEvent.click(screen.getByText('act2'));

        const simButton = await screen.findByText('Simulate Combined');
        fireEvent.click(simButton);

        await waitFor(() => {
            const feedback = screen.getByTestId('simulation-feedback');
            expect(within(feedback).getByText('73.0%')).toBeInTheDocument();
            expect(within(feedback).getByText(/Line: L3_SIM/)).toBeInTheDocument();
        });
    });

    it('falls back to max_rho if estimated_max_rho is missing', () => {
        const resultWithMissingEst: AnalysisResult = {
            ...mockAnalysisResult,
            combined_actions: {
                'act1+act2': {
                    ...mockAnalysisResult.combined_actions!['act1+act2'],
                    estimated_max_rho: undefined,
                    max_rho: 0.99
                }
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithMissingEst} />);
        expect(screen.getByText('99.0%')).toBeInTheDocument();
    });
});
