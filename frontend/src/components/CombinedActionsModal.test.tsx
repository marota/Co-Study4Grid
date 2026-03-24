import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import CombinedActionsModal from './CombinedActionsModal';
import { api } from '../api';
import type { AnalysisResult, CombinedAction } from '../types';

// We'll use vi.spyOn below

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
            'disco': {
                scores: {
                    'act1': 10,
                    'act2': 20,
                    'act3': 15
                }
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

        expect(screen.getByText('act1')).toBeInTheDocument();
        expect(screen.getByText('act2')).toBeInTheDocument();

        fireEvent.click(screen.getByText('act1'));
        fireEvent.click(screen.getByText('act2'));

        await waitFor(() => {
            expect(screen.getByText('Explore Pairs Comparison')).toBeInTheDocument();
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
            expect(screen.getByText('Explore Pairs Comparison')).toBeInTheDocument();
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
        expect(await screen.findByTestId('chip-act1')).toBeInTheDocument();
        fireEvent.click(screen.getByText('act3'));
        expect(await screen.findByTestId('chip-act3')).toBeInTheDocument();

        // Manual click required now
        const estimateBtn = screen.getByTestId('estimate-button');
        await waitFor(() => expect(estimateBtn).not.toBeDisabled(), { timeout: 5000 });
        fireEvent.click(estimateBtn);

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
            const simulatingButton = screen.getAllByRole('button').find(b => b.textContent?.includes('Simulating...'));
            expect(simulatingButton).toBeInTheDocument();
            expect(simulatingButton).toBeDisabled();
        });

        resolveSim!({});
    });

    it('displays suspect indicator (⚠️) for islanded estimations', async () => {
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

        await waitFor(() => {
            expect(screen.getByText(/⚠️/)).toBeInTheDocument();
        });
    });

    it('filters actions by category in explore tab', async () => {
        const resultWithTypes: AnalysisResult = {
            ...mockAnalysisResult,
            actions: {
                ...mockAnalysisResult.actions,
                'disco1': { description_unitaire: 'Disco 1', max_rho: 0.8, rho_before: [0.8], rho_after: [0.7], max_rho_line: 'L1', is_rho_reduction: true, action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} } },
                'reco1': { description_unitaire: 'Reco 1', max_rho: 0.9, rho_before: [0.9], rho_after: [0.8], max_rho_line: 'L2', is_rho_reduction: true, action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} } },
            },
            action_scores: {
                'disco': { scores: { 'disco1': 10 } },
                'reco': { scores: { 'reco1': 20 } }
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultWithTypes as AnalysisResult} />);

        fireEvent.click(getExploreTab());

        // Initially both should show
        expect(screen.getByText('disco1')).toBeInTheDocument();
        expect(screen.getByText('reco1')).toBeInTheDocument();

        // Filter for disconnections
        fireEvent.click(screen.getByRole('button', { name: 'DISCO' }));
        expect(screen.getByText('disco1')).toBeInTheDocument();
        expect(screen.queryByText('reco1')).not.toBeInTheDocument();

        // Filter for reconnections
        fireEvent.click(screen.getByRole('button', { name: 'RECO' }));
        expect(screen.queryByText('disco1')).not.toBeInTheDocument();
        expect(screen.getByText('reco1')).toBeInTheDocument();
    });

    it('groups actions by type in explore tab table', async () => {
        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());

        // Header should be there (uppercase match, might be multiple if it's also a filter)
        expect(screen.getAllByText('DISCO').length).toBeGreaterThan(0);
        const rows = screen.getAllByRole('row');
        // Headers + action rows
        expect(rows.length).toBeGreaterThan(1);
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
        
        // Should show 99.0% (max_rho) as fallback for estimation column
        expect(screen.getByText('99.0%')).toBeInTheDocument();
    });

    it('handles superposition API error gracefully', async () => {
        vi.mocked(api.computeSuperposition).mockImplementation(async () => {
            console.log('MOCK: computeSuperposition called');
            return { error: 'Backend exploded' } as unknown as CombinedAction;
        });
        const emptyResult = { ...mockAnalysisResult, combined_actions: {} };
        
        render(<CombinedActionsModal {...defaultProps} analysisResult={emptyResult as AnalysisResult} />);
        fireEvent.click(getExploreTab());
        fireEvent.click(screen.getByText('act1'));
        expect(await screen.findByTestId('chip-act1')).toBeInTheDocument();
        fireEvent.click(screen.getByText('act3'));
        expect(await screen.findByTestId('chip-act3')).toBeInTheDocument();
 
        // Trigger manual estimation
        const estimateBtn = screen.getByTestId('estimate-button');
        await waitFor(() => expect(estimateBtn).not.toBeDisabled());
        fireEvent.click(estimateBtn);

        // Wait for the error message specifically
        expect(await screen.findByText(/Estimation Failed/i, {}, { timeout: 8000 })).toBeInTheDocument();
        expect(screen.getByText("Backend exploded")).toBeInTheDocument();
    }, 15000);

    it('handles simulation API failure gracefully', async () => {
        vi.mocked(api.simulateManualAction).mockRejectedValueOnce(new Error('Simulation timed out'));
        vi.mocked(api.computeSuperposition).mockResolvedValueOnce({ ...mockAnalysisResult.combined_actions!["act1+act2"], action1_id: "act1", action2_id: "act3" });
        
        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());
        fireEvent.click(screen.getByText('act1'));
        expect(await screen.findByTestId('chip-act1')).toBeInTheDocument();
        fireEvent.click(screen.getByText('act3'));
        expect(await screen.findByTestId('chip-act3')).toBeInTheDocument();
 
        // Trigger manual estimation
        const estimateBtn2 = screen.getByTestId('estimate-button');
        await waitFor(() => expect(estimateBtn2).not.toBeDisabled());
        fireEvent.click(estimateBtn2);

        const simButton = await screen.findByText('Simulate Combined');
        fireEvent.click(simButton);

        await waitFor(() => {
            expect(screen.getByText(/Simulation timed out/)).toBeInTheDocument();
        });
    });

    it('sorts computed pairs by estimated max rho (lowest first)', () => {
        const resultUnsorted: AnalysisResult = {
            ...mockAnalysisResult,
            combined_actions: {
                'p_worst': { ...mockAnalysisResult.combined_actions!['act1+act2'], estimated_max_rho: 0.95 },
                'p_best': { ...mockAnalysisResult.combined_actions!['act1+act2'], estimated_max_rho: 0.65 },
            }
        };
        render(<CombinedActionsModal {...defaultProps} analysisResult={resultUnsorted} />);
        
        const rows = screen.getAllByRole('row');
        // Row 1 is header, Row 2 should be 'p_best', Row 3 should be 'p_worst'
        expect(within(rows[1]).getByText('65.0%')).toBeInTheDocument();
        expect(within(rows[2]).getByText('95.0%')).toBeInTheDocument();
    });

    it('removes individual action from selection chips', async () => {
        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());
        const act1Row = screen.getByText('act1').closest('tr');
        const act2Row = screen.getByText('act2').closest('tr');
        fireEvent.click(act1Row!);
        fireEvent.click(act2Row!);

        // Chips should be there in the "Selected Actions" area
        const chip1 = screen.getByTestId('chip-act1');
        const removeBtn1 = within(chip1).getByText('×');
        fireEvent.click(removeBtn1);

        expect(screen.queryByTestId('chip-act1')).not.toBeInTheDocument();
        expect(screen.getByTestId('chip-act2')).toBeInTheDocument();
    });

    it('clears all selected actions via Clear All button', async () => {
        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());
        const act1Row = screen.getByText('act1').closest('tr');
        const act2Row = screen.getByText('act2').closest('tr');
        fireEvent.click(act1Row!);
        fireEvent.click(act2Row!);

        fireEvent.click(screen.getByText('Clear All'));
        expect(screen.queryByTestId('chip-act1')).not.toBeInTheDocument();
        expect(screen.queryByTestId('chip-act2')).not.toBeInTheDocument();
    });

    it('simulates individual action from Explore tab table', async () => {
        vi.mocked(api.simulateManualAction).mockResolvedValueOnce({
            action_id: 'act1',
            description_unitaire: 'Description',
            rho_before: [0.8],
            rho_after: [0.75],
            max_rho: 0.75,
            max_rho_line: 'L1',
            is_rho_reduction: true,
            non_convergence: null,
            lines_overloaded: []
        });

        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());

        // Find Re-run button in act1 row (since it's pre-simulated in mockAnalysisResult)
        const row = screen.getByText('act1').closest('tr');
        const simButton = within(row!).getByText('Re-run');
        fireEvent.click(simButton);

        await waitFor(() => {
            expect(within(row!).getByText('75.0%')).toBeInTheDocument();
            expect(within(row!).getByText('Re-run')).toBeInTheDocument();
        });
    });

    it('displays scores with two decimal places in Explore tab', () => {
        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());
        
        // act1 has score 10 in mockAnalysisResult
        // In the new 2nd decimal rounding, it should show '10.00'
        expect(screen.getByText('10.00')).toBeInTheDocument();
    });

    it('renders comparison card with side-by-side estimated and actual effects', async () => {
        vi.mocked(api.simulateManualAction).mockResolvedValueOnce({
            action_id: 'act1+act3',
            description_unitaire: 'Combined',
            rho_before: [0.75],
            rho_after: [0.73],
            max_rho: 0.73,
            max_rho_line: 'L_RES',
            is_rho_reduction: true,
            non_convergence: null,
            lines_overloaded: []
        });

        // Mock estimation with correct IDs
        vi.mocked(api.computeSuperposition).mockResolvedValueOnce({
            ...mockAnalysisResult.combined_actions!['act1+act2'],
            action1_id: 'act1',
            action2_id: 'act3'
        });

        render(<CombinedActionsModal {...defaultProps} />);
        fireEvent.click(getExploreTab());
        
        const act1Row = screen.getByText('act1').closest('tr');
        const act3Row = screen.getByText('act3').closest('tr');
        fireEvent.click(act1Row!);
        expect(await screen.findByTestId('chip-act1')).toBeInTheDocument();
        fireEvent.click(act3Row!);
        expect(await screen.findByTestId('chip-act3')).toBeInTheDocument();
 
        // Trigger manual estimation
        const estimateBtn3 = screen.getByTestId('estimate-button');
        await waitFor(() => expect(estimateBtn3).not.toBeDisabled());
        fireEvent.click(estimateBtn3);
        // Result should appear
        const card = await screen.findByTestId('comparison-card');
        expect(within(card).getByText(/Estimated Effect/i)).toBeInTheDocument();
        expect(within(card).getByText('75.0%')).toBeInTheDocument();
        
        const simButton = within(card).getByText('Simulate Combined');
        fireEvent.click(simButton);

        // Simulation result should appear
        expect(await within(card).findByText(/Simulation Result/i, {}, { timeout: 8000 })).toBeInTheDocument();
        // Use a more flexible matcher for the percentage to avoid whitespace issues
        expect(await within(card).findByText((content) => content.includes('73.0%'))).toBeInTheDocument();
    }, 15000);

    it('preserves comparison card for explored pair when analysisResult updates', async () => {
        const emptyResult = { ...mockAnalysisResult, combined_actions: {} };
        vi.mocked(api.computeSuperposition).mockResolvedValueOnce({
            action1_id: 'act1',
            action2_id: 'act3',
            estimated_max_rho: 0.85,
            estimated_max_rho_line: 'L_NEW_EST'
        } as unknown as CombinedAction);

        const { rerender } = render(<CombinedActionsModal {...defaultProps} analysisResult={emptyResult as unknown as AnalysisResult} />);
        fireEvent.click(getExploreTab());
        fireEvent.click(screen.getByText('act1'));
        expect(await screen.findByTestId('chip-act1')).toBeInTheDocument();
        fireEvent.click(screen.getByText('act3'));
        expect(await screen.findByTestId('chip-act3')).toBeInTheDocument();

        // Manual estimate
        fireEvent.click(screen.getByTestId('estimate-button'));
        expect(await screen.findByTestId('comparison-card')).toBeInTheDocument();

        // Simulate a prop update (e.g. from parent simulation result)
        const updatedResult = { ...emptyResult, message: 'Updated' };
        rerender(<CombinedActionsModal {...defaultProps} analysisResult={updatedResult as unknown as AnalysisResult} />);

        // Card should STILL be there!
        const finalCard = screen.getByTestId('comparison-card');
        expect(finalCard).toBeInTheDocument();
        expect(within(finalCard).getByText('85.0%')).toBeInTheDocument();
    });
});
