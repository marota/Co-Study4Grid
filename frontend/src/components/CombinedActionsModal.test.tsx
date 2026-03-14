import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CombinedActionsModal from './CombinedActionsModal';
import { api } from '../api';
import type { AnalysisResult } from '../types';

// Mock API
vi.mock('../api', () => ({
    api: {
        computeSuperposition: vi.fn(),
        simulateManualAction: vi.fn(),
    }
}));

describe('CombinedActionsModal', () => {
    const mockAnalysisResult: AnalysisResult = {
        actions: {
            'act1': { description_unitaire: 'Action 1', max_rho: 0.8, rho_before: [0.8], rho_after: [0.7], max_rho_line: 'L1', is_rho_reduction: true },
            'act2': { description_unitaire: 'Action 2', max_rho: 0.9, rho_before: [0.9], rho_after: [0.8], max_rho_line: 'L2', is_rho_reduction: true },
            'act3': { description_unitaire: 'Action 3', max_rho: 0.85, rho_before: [0.85], rho_after: [0.8], max_rho_line: 'L3', is_rho_reduction: true },
        },
        combined_actions: {
            'act1+act2': {
                action1_id: 'act1',
                action2_id: 'act2',
                betas: [1.0, 0.9],
                max_rho: 0.75,
                max_rho_line: 'L3',
                is_rho_reduction: true,
                description: 'Pre-computed Pair'
            }
        },
        lines_overloaded: [],
        topo_info: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} }
    } as any;

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

    it('identifies simulated data in computed pairs list', () => {
        const resultWithSim = {
            ...mockAnalysisResult,
            actions: {
                ...mockAnalysisResult.actions,
                'act1+act2': {
                    description_unitaire: 'Simulated',
                    max_rho: 0.72,
                    max_rho_line: 'L3',
                    rho_after: [0.72],
                    is_estimated: false
                }
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithSim as any} />);

        expect(screen.getByText('75.0%')).toBeInTheDocument();
        expect(screen.getByText('72.0%')).toBeInTheDocument();
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
            rho_after: [0.85]
        } as any);

        render(<CombinedActionsModal {...defaultProps} analysisResult={emptyResult as any} />);

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
            lines_overloaded: []
        } as any);

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
        }, { timeout: 3000 });
    });

    it('disables simulation button while simulating', async () => {
        let resolveSim: (val: any) => void;
        const simPromise = new Promise(resolve => { resolveSim = resolve; });
        vi.mocked(api.simulateManualAction).mockReturnValueOnce(simPromise as any);

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
});
