import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CombinedActionsModal from './CombinedActionsModal';
import { api } from '../api';
import type { AnalysisResult, CombinedAction } from '../types';

// Mock API
vi.mock('../api', () => ({
    api: {
        computeSuperposition: vi.fn(),
        simulateManualAction: vi.fn(),
    }
}));

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
        vi.clearAllMocks();
    });

    const getExploreTab = () => screen.getAllByText('Explore Pairs')[0];

    it('renders and shows computed pairs by default', () => {
        render(<CombinedActionsModal {...defaultProps} />);
        expect(screen.getByText('Computed Pairs')).toBeInTheDocument();
        expect(screen.getByText('75.0%')).toBeInTheDocument();
    });

    it('identifies simulated data in computed pairs list from analysisResult.actions', () => {
        const resultWithSim = {
            ...mockAnalysisResult,
            actions: {
                ...mockAnalysisResult.actions,
                'act1+act2': {
                    description_unitaire: 'Simulated',
                    rho_before: [0.75],
                    max_rho: 0.72,
                    max_rho_line: 'L3',
                    rho_after: [0.72],
                    is_rho_reduction: true,
                    is_estimated: false
                }
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithSim as AnalysisResult} />);

        expect(screen.getByText('75.0%')).toBeInTheDocument();
        expect(screen.getByText('72.0%')).toBeInTheDocument();
    });

    it('identifies simulated data from simulatedActions prop (result.actions)', () => {
        const simActions = {
            'act1+act2': {
                description_unitaire: 'Simulated via parent',
                rho_before: [0.75],
                max_rho: 0.71,
                max_rho_line: 'L3_PARENT',
                rho_after: [0.71],
                is_rho_reduction: true,
                is_estimated: false
            }
        };
        render(<CombinedActionsModal {...defaultProps} simulatedActions={simActions as Record<string, import('../types').ActionDetail>} />);

        expect(screen.getByText('75.0%')).toBeInTheDocument();
        expect(screen.getByText('71.0%')).toBeInTheDocument();
        expect(screen.getByText('Re-Simulate')).toBeInTheDocument();
    });

    it('tracks per-pair simulation results when simulating in chain', async () => {
        // Set up two combined pairs
        const resultWithTwoPairs: AnalysisResult = {
            ...mockAnalysisResult,
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
                    description: 'Pair 1',
                    p_or_combined: [],
                    rho_before: [0.75],
                    rho_after: [0.72]
                },
                'act1+act3': {
                    action1_id: 'act1',
                    action2_id: 'act3',
                    betas: [0.8, 0.7],
                    max_rho: 0.78,
                    max_rho_line: 'L4',
                    estimated_max_rho: 0.80,
                    estimated_max_rho_line: 'L4_EST',
                    is_rho_reduction: true,
                    description: 'Pair 2',
                    p_or_combined: [],
                    rho_before: [0.80],
                    rho_after: [0.78]
                },
            },
        };

        // Simulate pair 1 first, then pair 2
        vi.mocked(api.simulateManualAction)
            .mockResolvedValueOnce({
                action_id: 'act1+act2',
                max_rho: 0.68,
                max_rho_line: 'L3_SIM',
                is_rho_reduction: true,
                is_islanded: false,
                description_unitaire: 'Sim pair 1',
                rho_before: [0.75],
                rho_after: [0.68],
                non_convergence: null,
                lines_overloaded: [],
            } as unknown as SimulateResult)
            .mockResolvedValueOnce({
                action_id: 'act1+act3',
                max_rho: 0.77,
                max_rho_line: 'L4_SIM',
                is_rho_reduction: true,
                is_islanded: false,
                description_unitaire: 'Sim pair 2',
                rho_before: [0.80],
                rho_after: [0.77],
                non_convergence: null,
                lines_overloaded: [],
            } as unknown as SimulateResult);

        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithTwoPairs} />);

        // Both pairs should show "Simulate" initially
        const simButtons = screen.getAllByText('Simulate');
        expect(simButtons).toHaveLength(2);

        // Simulate pair 1
        fireEvent.click(simButtons[0]);
        await waitFor(() => {
            expect(screen.getByText('68.0%')).toBeInTheDocument();
        });

        // Now simulate pair 2
        const simButton2 = screen.getByText('Simulate');
        fireEvent.click(simButton2);
        await waitFor(() => {
            expect(screen.getByText('77.0%')).toBeInTheDocument();
        });

        // Pair 1's result (68.0%) should still be displayed correctly
        expect(screen.getByText('68.0%')).toBeInTheDocument();
        // Both should show "Re-Simulate"
        expect(screen.getAllByText('Re-Simulate')).toHaveLength(2);
    });

    it('switches to explore tab and selects actions', async () => {
        render(<CombinedActionsModal {...defaultProps} />);

        fireEvent.click(getExploreTab());

        expect(screen.getByText('Action 1')).toBeInTheDocument();
        expect(screen.getByText('Action 2')).toBeInTheDocument();

        fireEvent.click(screen.getByText('act1'));
        fireEvent.click(screen.getByText('act2'));

        await waitFor(() => {
            expect(screen.getByText('Combined action result')).toBeInTheDocument();
            expect(screen.getByText('75.0%')).toBeInTheDocument();
        });

        expect(api.computeSuperposition).not.toHaveBeenCalled();
    });

    it('canonicalizes IDs when fetching pre-computed results in explore tab', async () => {
        render(<CombinedActionsModal {...defaultProps} />);

        fireEvent.click(getExploreTab());

        fireEvent.click(screen.getByText('act2'));
        fireEvent.click(screen.getByText('act1'));

        await waitFor(() => {
            expect(screen.getByText('Combined action result')).toBeInTheDocument();
            expect(screen.getByText('75.0%')).toBeInTheDocument();
        });
        expect(api.computeSuperposition).not.toHaveBeenCalled();
    });

    it('performs on-demand superposition for non-pre-computed pairs', async () => {
        const emptyResult = { ...mockAnalysisResult, combined_actions: {} };
        vi.mocked(api.computeSuperposition).mockResolvedValueOnce({
            action1_id: 'act1',
            action2_id: 'act3',
            betas: [0.5, 0.5],
            max_rho: 0.85,
            max_rho_line: 'L_NEW',
            is_rho_reduction: true,
            p_or_combined: [],
            rho_after: [0.85],
            description: 'Computed',
            rho_before: [0.9],
            estimated_max_rho: 0.85,
            estimated_max_rho_line: 'L_NEW_EST'
        } as unknown as CombinedAction);

        render(<CombinedActionsModal {...defaultProps} analysisResult={emptyResult as AnalysisResult} />);

        fireEvent.click(getExploreTab());
        fireEvent.click(screen.getByText('act1'));
        fireEvent.click(screen.getByText('act3'));

        await waitFor(() => {
            expect(api.computeSuperposition).toHaveBeenCalled();
            expect(screen.getByText('85.0%')).toBeInTheDocument();
        });
    });

    it('performs simulation and shows feedback', async () => {
        vi.mocked(api.simulateManualAction).mockResolvedValueOnce({
            action_id: 'act1+act2',
            max_rho: 0.73,
            max_rho_line: 'L3_SIM',
            is_rho_reduction: true,
            is_islanded: true,
            disconnected_mw: 15.5,
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

    it('disables simulation button while simulating', async () => {
        let resolveSim: (val: unknown) => void;
        const simPromise = new Promise<unknown>(resolve => { resolveSim = resolve; });
        vi.mocked(api.simulateManualAction).mockReturnValueOnce(simPromise as unknown as Promise<SimulateResult>);

        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());
        fireEvent.click(screen.getByText('act1'));
        fireEvent.click(screen.getByText('act2'));

        const simButton = await screen.findByText('Simulate Combined');
        fireEvent.click(simButton);

        await waitFor(() => {
            const simulatingButton = screen.getAllByRole('button').find(b => b.textContent === 'Simulating...');
            expect(simulatingButton).toBeInTheDocument();
            expect(simulatingButton).toBeDisabled();
        });

        resolveSim!({});
    });

    it('displays suspect indicator (⚠️) for islanded estimations', () => {
        const resultWithIslanded: AnalysisResult = {
            ...mockAnalysisResult,
            combined_actions: {
                'act1+act2': {
                    ...mockAnalysisResult.combined_actions!['act1+act2'],
                    is_islanded: true
                }
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithIslanded} />);

        // Check for the warning emoji next to the estimated rho
        expect(screen.getByText(/⚠️/)).toBeInTheDocument();

        // Switch to explore tab and verify it's there too
        fireEvent.click(getExploreTab());
        fireEvent.click(screen.getByText('act1'));
        fireEvent.click(screen.getByText('act2'));

        expect(screen.getByText(/⚠️/)).toBeInTheDocument();
    });
});
