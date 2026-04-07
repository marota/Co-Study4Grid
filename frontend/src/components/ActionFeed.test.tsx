// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Mocking dependencies
vi.mock('../api', () => ({
    api: {
        getAvailableActions: vi.fn(async () => []),
        simulateManualAction: vi.fn(),
        getNetworkDiagram: vi.fn(),
        computeSuperposition: vi.fn(),
    }
}));

vi.mock('../utils/svgUtils', () => ({
    getActionTargetVoltageLevels: vi.fn(() => []),
    getActionTargetLines: vi.fn(() => []),
    processSvg: vi.fn((svg: string) => ({ svg, viewBox: { x: 0, y: 0, w: 100, h: 100 } })),
    buildMetadataIndex: vi.fn(),
    applyOverloadedHighlights: vi.fn(),
    applyDeltaVisuals: vi.fn(),
    applyActionTargetHighlights: vi.fn(),
    applyContingencyHighlight: vi.fn(),
    isCouplingAction: vi.fn(() => false),
}));

import ActionFeed from './ActionFeed';
import { api } from '../api';
import { getActionTargetVoltageLevels, getActionTargetLines } from '../utils/svgUtils';
import type { ActionDetail, AnalysisResult, CombinedAction } from '../types';

describe('ActionFeed', () => {
    const emptyTopo = { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} };

    const defaultProps = {
        actions: {} as Record<string, ActionDetail>,
        actionScores: {} as Record<string, Record<string, unknown>>,
        linesOverloaded: ['LINE_1'] as string[],
        selectedActionId: null,
        selectedActionIds: new Set<string>(),
        rejectedActionIds: new Set<string>(),
        onActionSelect: vi.fn(),
        onActionFavorite: vi.fn(),
        onActionReject: vi.fn(),
        onAssetClick: vi.fn(),
        onDisplayPrioritizedActions: vi.fn(),
        onRunAnalysis: vi.fn(),
        canRunAnalysis: false,
        nodesByEquipmentId: new Map(),
        edgesByEquipmentId: new Map(),
        disconnectedElement: 'LINE_1',
        onManualActionAdded: vi.fn(),
        analysisLoading: false,
        monitoringFactor: 0.95,
        manuallyAddedIds: new Set<string>(),
        minLineReconnections: 2,
        minCloseCoupling: 3,
        minOpenCoupling: 2,
        minLineDisconnections: 3,
        minPst: 1,
        minLoadShedding: 0,
        minRenewableCurtailmentActions: 0,
        nPrioritizedActions: 10,
        ignoreReconnections: false,
        pendingAnalysisResult: null as AnalysisResult | null,
        onOpenSettings: vi.fn(),
        actionDictFileName: null as string | null,
        actionDictStats: null as { reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number } | null,
        combinedActions: null as Record<string, CombinedAction> | null,
    };


    it('renders "Scored Actions" heading when search is opened and actions are present', async () => {
        const actionId = 'act_1';
        const props = {
            ...defaultProps,
            actionScores: {
                line_reconnection: {
                    scores: { [actionId]: 10 },
                    params: {},
                }
            },
        };
        render(<ActionFeed {...props} />);

        fireEvent.click(screen.getByText('+ Manual Selection'));
        expect(await screen.findByText('Scored Actions')).toBeInTheDocument();
    });

    it('hides prioritized suggestions while analysis is loading', () => {
        const actionId = 'suggested_1';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Suggested Action',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    is_manual: false,
                    action_topology: emptyTopo
                }
            },
            analysisLoading: true,
        };
        render(<ActionFeed {...props} />);

        expect(screen.queryByText('Suggested Action')).not.toBeInTheDocument();
        // Processing indicator is now visible during analysis
        expect(screen.getByText('⚙️ Analyzing…')).toBeInTheDocument();
    });

    it('shows manual actions while analysis is loading', () => {
        const actionId = 'manual_1';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Manual Action',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    is_manual: true,
                    action_topology: emptyTopo
                }
            },
            selectedActionIds: new Set([actionId]),
            analysisLoading: true,
        };
        render(<ActionFeed {...props} />);

        expect(screen.getByText('Manual Action')).toBeInTheDocument();
        // Processing indicator is visible even when viewing selected actions
        expect(screen.getByText('⚙️ Analyzing…')).toBeInTheDocument();
    });

    it('shows display prioritized actions button when pending results exist and loading is false', () => {
        const props = {
            ...defaultProps,
            analysisLoading: false,
            pendingAnalysisResult: {
                actions: { 'new_act': { description_unitaire: 'New', rho_before: [], rho_after: [], max_rho: 0.5, max_rho_line: '', is_rho_reduction: true, action_topology: emptyTopo } },
                lines_overloaded: [],
                topo_info: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} },
                pdf_path: null,
                pdf_url: null,
                message: 'done',
                dc_fallback: false
            } as AnalysisResult,
        };
        render(<ActionFeed {...props} />);

        expect(screen.getByText(/Display 1 prioritized actions/)).toBeInTheDocument();
    });

    it('calls onDisplayPrioritizedActions when display button is clicked', () => {
        const onDisplay = vi.fn();
        const props = {
            ...defaultProps,
            analysisLoading: false,
            onDisplayPrioritizedActions: onDisplay,
            pendingAnalysisResult: {
                actions: { 'new_act': { description_unitaire: 'New', rho_before: [], rho_after: [], max_rho: 0.5, max_rho_line: '', is_rho_reduction: true, action_topology: emptyTopo } },
                lines_overloaded: [],
                topo_info: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} },
                pdf_path: null,
                pdf_url: null,
                message: 'done',
                dc_fallback: false
            } as AnalysisResult,
        };
        render(<ActionFeed {...props} />);

        fireEvent.click(screen.getByText(/Display 1 prioritized actions/));
        expect(onDisplay).toHaveBeenCalled();
    });

    it('shows "computed" tag for actions without non_convergence in search table', async () => {
        const actionId = 'act_1';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Test',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: emptyTopo
                }
            },
            actionScores: {
                line_reconnection: {
                    scores: { [actionId]: 10 },
                    params: {},
                }
            }
        };
        render(<ActionFeed {...props} />);

        fireEvent.click(screen.getByText('+ Manual Selection'));

        expect(await screen.findByTestId(`badge-computed-${actionId}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`badge-divergent-${actionId}`)).not.toBeInTheDocument();
    });

    it('shows "divergent" tag for non-convergent actions in search table', async () => {
        const actionId = 'act_2';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Test',
                    rho_before: [1.0],
                    rho_after: null,
                    max_rho: null,
                    max_rho_line: 'N/A',
                    is_rho_reduction: false,
                    non_convergence: 'LF error',
                    action_topology: emptyTopo
                }
            },
            actionScores: {
                line_reconnection: {
                    scores: { [actionId]: 5 },
                    params: {},
                }
            }
        };
        render(<ActionFeed {...props} />);

        fireEvent.click(screen.getByText('+ Manual Selection'));

        expect(await screen.findByTestId(`badge-divergent-${actionId}`)).toBeInTheDocument();
        expect(screen.queryByTestId(`badge-computed-${actionId}`)).not.toBeInTheDocument();
    });

    it('renders red "divergent" badge and orange warning box for non-convergent action card', () => {
        const actionId = 'act_bad';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Test Bad Action',
                    rho_before: [1.0],
                    rho_after: null,
                    max_rho: null,
                    max_rho_line: 'N/A',
                    is_rho_reduction: false,
                    non_convergence: 'Critical Error',
                    action_topology: emptyTopo
                }
            },
            selectedActionIds: new Set([actionId])
        };
        render(<ActionFeed {...props} />);

        const card = screen.getByTestId(`action-card-${actionId}`);

        // 1. Check Divergent Badge (red)
        const badge = screen.getByText('divergent');
        expect(badge.style.background).toContain('rgb(220, 53, 69)'); // #dc3545

        // 2. Check Warning Box (orange)
        const warningBox = screen.getByText(/LoadFlow failure: Critical Error/);
        expect(warningBox.style.color).toContain('rgb(154, 52, 18)'); // #9a3412
        expect(warningBox.style.backgroundColor).toContain('rgb(255, 248, 241)'); // #fff8f1

        // 3. Check Card Background (reddish)
        expect(card.style.background).toContain('rgb(255, 245, 245)');
    });

    it('ranks non-convergent actions at the bottom', () => {
        const props = {
            ...defaultProps,
            actions: {
                act_good: { description_unitaire: 'Good Action', rho_before: [1.0], rho_after: [0.8], max_rho: 0.8, max_rho_line: 'A', is_rho_reduction: true, action_topology: emptyTopo },
                act_bad: { description_unitaire: 'Bad Action', rho_before: [1.0], rho_after: null, max_rho: null, max_rho_line: 'N/A', is_rho_reduction: false, non_convergence: 'Error', action_topology: emptyTopo }
            },
            selectedActionIds: new Set(['act_good', 'act_bad'])
        };
        render(<ActionFeed {...props} />);

        const cards = screen.getAllByTestId(/action-card-/);
        const cardTexts = cards.map(el => el.textContent);

        const goodIndex = cardTexts.findIndex(t => t?.includes('Good Action'));
        const badIndex = cardTexts.findIndex(t => t?.includes('Bad Action'));

        expect(goodIndex).toBeLessThan(badIndex);
    });

    it('filters PST actions based on the PST checkbox', async () => {
        const pstAction = { id: 'pst_tap_up', description: 'PST action', type: 'pst_tap_change' };
        const regularAction = { id: 'line_reco_1', description: 'Regular action', type: 'line_reconnection' };

        // Mock API to return both actions
        vi.mocked(api.getAvailableActions).mockResolvedValueOnce([pstAction, regularAction]);

        render(<ActionFeed {...defaultProps} />);

        // Open search
        fireEvent.click(screen.getByText('+ Manual Selection'));

        // Both should be visible initially (PST filter is true by default)
        expect(await screen.findByText('pst_tap_up')).toBeInTheDocument();
        expect(screen.getByText('line_reco_1')).toBeInTheDocument();

        // Find and click the PST checkbox to uncheck it
        const pstCheckbox = screen.getByLabelText('PST');
        fireEvent.click(pstCheckbox);

        // PST action should be hidden, regular action should remain
        expect(screen.queryByText('pst_tap_up')).not.toBeInTheDocument();
        expect(screen.getByText('line_reco_1')).toBeInTheDocument();

        // Check it again
        fireEvent.click(pstCheckbox);
        expect(await screen.findByText('pst_tap_up')).toBeInTheDocument();
    });

    it('hides PST actions matching search query when PST filter is unchecked', async () => {
        const pstAction = { id: 'pst_tap_up', description: 'PST action' };

        vi.mocked(api.getAvailableActions).mockResolvedValueOnce([pstAction]);

        render(<ActionFeed {...defaultProps} />);

        // Open search
        fireEvent.click(screen.getByText('+ Manual Selection'));

        // Uncheck PST filter
        const pstCheckbox = screen.getByLabelText('PST');
        fireEvent.click(pstCheckbox);

        // Type "pst" in search
        const searchInput = screen.getByPlaceholderText(/Search action/);
        fireEvent.change(searchInput, { target: { value: 'pst' } });

        // Wait for loading to finish if it hasn't already
        await waitFor(() => {
            expect(screen.queryByText('Loading actions...')).not.toBeInTheDocument();
        });

        // PST action should NOT be visible even if it matches search query
        expect(screen.queryByText('pst_tap_up')).not.toBeInTheDocument();
        expect(screen.getByText('No other matching actions')).toBeInTheDocument();
        
        // Manual simulation option should be visible
        expect(screen.getByText(/Simulate manual ID:/)).toBeInTheDocument();
        expect(screen.getByText('pst')).toBeInTheDocument();
    });

    it('shows ONLY PST actions when only PST filter is checked', async () => {
        const pstAction = { id: 'pst_1', description: 'PST action' };
        const discoAction = { id: 'abc', description: 'Ouverture de ligne' }; // Should be recognized as disco
        const unknownAction = { id: 'xyz', description: 'Some unknown action' };

        vi.mocked(api.getAvailableActions).mockResolvedValueOnce([pstAction, discoAction, unknownAction]);

        render(<ActionFeed {...defaultProps} />);

        // Open search
        fireEvent.click(screen.getByText('+ Manual Selection'));

        // Uncheck everything except PST
        fireEvent.click(screen.getByLabelText('Disconnections'));
        fireEvent.click(screen.getByLabelText('Reconnections'));
        fireEvent.click(screen.getByLabelText('Open coupling'));
        fireEvent.click(screen.getByLabelText('Close coupling'));

        // PST should be visible
        expect(await screen.findByText('pst_1')).toBeInTheDocument();

        // Disco and Unknown should NOT be visible
        expect(screen.queryByText('abc')).not.toBeInTheDocument();
        expect(screen.queryByText('xyz')).not.toBeInTheDocument();
    });
    
    it('shows Load shedding actions when Load shedding filter is checked', async () => {
        const lsAction = { id: 'load_shedding_LOAD1', description: 'Load shedding LOAD1' };
        const regularAction = { id: 'line_reco_1', description: 'Reconnexion' };

        vi.mocked(api.getAvailableActions).mockResolvedValueOnce([lsAction, regularAction]);

        render(<ActionFeed {...defaultProps} />);

        // Open search
        fireEvent.click(screen.getByText('+ Manual Selection'));

        // Both visible initially
        expect(await screen.findByText('load_shedding_LOAD1')).toBeInTheDocument();
        expect(screen.getByText('line_reco_1')).toBeInTheDocument();

        // Uncheck Load shedding filter
        const lsCheckbox = screen.getByLabelText('Load Shedding');
        fireEvent.click(lsCheckbox);

        // Load shedding should be hidden
        expect(screen.queryByText('load_shedding_LOAD1')).not.toBeInTheDocument();
        expect(screen.getByText('line_reco_1')).toBeInTheDocument();
    });

    it('triggers manual simulation when "Simulate manual ID" is clicked', async () => {
        render(<ActionFeed {...defaultProps} />);

        // Open search
        fireEvent.click(screen.getByText('+ Manual Selection'));

        // Type something that doesn't exist
        const searchInput = screen.getByPlaceholderText(/Search action/);
        fireEvent.change(searchInput, { target: { value: 'custom_action_123' } });

        // Wait for loading to finish
        await waitFor(() => {
            expect(screen.queryByText('Loading actions...')).not.toBeInTheDocument();
        });

        // Click "Simulate manual ID"
        const manualOption = screen.getByText(/Simulate manual ID:/);
        fireEvent.click(manualOption);

        // Verify simulateManualAction was called
        expect(api.simulateManualAction).toHaveBeenCalledWith(
            'custom_action_123',
            'LINE_1',
            null,
            ['LINE_1'],
            undefined,
        );
    });

    it('hides disconnections on PST branches when Disconnections filter is off but PST is on', async () => {
        const pstDiscoAction = {
            id: 'disco_pst_branch',
            description: 'Ouverture de la branche PST',
            type: 'pst_tap_change' // Simulating backend tagging it as PST
        };

        vi.mocked(api.getAvailableActions).mockResolvedValueOnce([pstDiscoAction]);

        render(<ActionFeed {...defaultProps} />);

        // Open search
        fireEvent.click(screen.getByText('+ Manual Selection'));

        // Ensure Disconnections is unchecked, PST is checked
        const discoCheckbox = screen.getByLabelText('Disconnections') as HTMLInputElement;
        if (discoCheckbox.checked) fireEvent.click(discoCheckbox);

        const pstCheckbox = screen.getByLabelText('PST') as HTMLInputElement;
        if (!pstCheckbox.checked) fireEvent.click(pstCheckbox);

        // PST branch disco should NOT be visible because it's a disconnection
        // even if it has "pst" in id/type
        await waitFor(() => {
            expect(screen.queryByText('Loading actions...')).not.toBeInTheDocument();
        });

        expect(screen.queryByText('disco_pst_branch')).not.toBeInTheDocument();
        expect(screen.getByText('All actions already added')).toBeInTheDocument();
    });
    it('shows action dict stats warning when actionDictFileName and actionDictStats are provided', () => {
        const props = {
            ...defaultProps,
            actionDictFileName: 'actions.json',
            actionDictStats: { reco: 3, disco: 5, pst: 2, open_coupling: 1, close_coupling: 1, total: 12 },
        };
        render(<ActionFeed {...props} />);

        expect(screen.getByText(/Action dictionary/)).toBeInTheDocument();
        expect(screen.getByText(/actions.json/)).toBeInTheDocument();
        expect(screen.getByText(/Reco:/)).toBeInTheDocument();
        expect(screen.getByText(/Disco:/)).toBeInTheDocument();
        expect(screen.getByText(/PST:/)).toBeInTheDocument();
        expect(screen.getByText(/Open coupling:/)).toBeInTheDocument();
        expect(screen.getByText(/Close coupling:/)).toBeInTheDocument();
    });

    it('dismisses action dict stats warning when close button is clicked', () => {
        const props = {
            ...defaultProps,
            actionDictFileName: 'actions.json',
            actionDictStats: { reco: 3, disco: 5, pst: 2, open_coupling: 1, close_coupling: 1, total: 12 },
        };
        render(<ActionFeed {...props} />);

        expect(screen.getByText(/Action dictionary/)).toBeInTheDocument();
        // Multiple dismiss buttons exist; action dict one renders first
        const dismissBtns = screen.getAllByTitle('Dismiss');
        fireEvent.click(dismissBtns[0]);
        expect(screen.queryByText(/Action dictionary/)).not.toBeInTheDocument();
    });

    it('shows action dict warning while analysis is loading with yellow theme', () => {
        const props = {
            ...defaultProps,
            actionDictFileName: 'actions.json',
            actionDictStats: { reco: 3, disco: 5, pst: 2, open_coupling: 1, close_coupling: 1, total: 12 },
            analysisLoading: true,
        };
        render(<ActionFeed {...props} />);
        // Timing fix: it should appear at the same time as other user warnings (even during analysis)
        const warning = screen.getByText(/Action dictionary/);
        expect(warning).toBeInTheDocument();
        // Check yellow theme
        const parent = warning.closest('div[style*="background"]') as HTMLDivElement;
        if (parent) {
            expect(parent.style.background).toContain('rgb(255, 243, 205)'); // #fff3cd
            expect(parent.style.border).toContain('rgb(255, 238, 186)'); // #ffeeba
            expect(parent.style.color).toContain('rgb(133, 100, 4)'); // #856404
        }
    });

    it('shows yellow processing button during analysisLoading', () => {
        const props = {
            ...defaultProps,
            analysisLoading: true,
        };
        render(<ActionFeed {...props} />);

        const banner = screen.getByText('⚙️ Analyzing…');
        expect(banner).toBeInTheDocument();
        expect(banner.style.background).toContain('rgb(255, 243, 205)'); // #fff3cd
        expect(banner.style.color).toContain('rgb(133, 100, 4)'); // #856404
    });

    it('includes minPst in the recommender settings warning', () => {
        const props = {
            ...defaultProps,
            minPst: 2,
            minLineReconnections: 3,
            minLineDisconnections: 4,
        };
        render(<ActionFeed {...props} />);
        // The recommender settings warning appears when no analysis has been run
        expect(screen.getByText(/2 PST/)).toBeInTheDocument();
    });

    it('shows change in settings link in action dict warning calling paths tab', () => {
        const onOpenSettings = vi.fn();
        const props = {
            ...defaultProps,
            actionDictFileName: 'actions.json',
            actionDictStats: { reco: 3, disco: 5, pst: 2, open_coupling: 1, close_coupling: 1, total: 12 },
            onOpenSettings,
        };
        render(<ActionFeed {...props} />);

        // "Change in settings" button in the action dict warning
        const changeLinks = screen.getAllByText('Change in settings');
        // Click the first one (action dict warning)
        fireEvent.click(changeLinks[0]);
        expect(onOpenSettings).toHaveBeenCalledWith('paths');
    });
    it('awaits simulation before calling onManualActionAdded to prevent race conditions', async () => {
        const actionId = 'act1';
        const mockResult = {
            description_unitaire: 'Description',
            rho_before: [1.0],
            rho_after: [0.8],
            max_rho: 0.8,
            max_rho_line: 'LINE_A',
            is_rho_reduction: true,
            action_id: actionId,
            lines_overloaded: []
        };

        vi.mocked(api.getAvailableActions).mockResolvedValue([{ id: 'act1', type: 'disco', description: 'desc' }]);

        // Mock a slow simulation
        let simulationFinished = false;
        vi.mocked(api.simulateManualAction).mockImplementation(async () => {
            await new Promise(resolve => setTimeout(resolve, 50));
            simulationFinished = true;
            return {
                ...mockResult,
                non_convergence: null,
                is_estimated: false,
                lines_overloaded: []
            } as { action_id: string; description_unitaire: string; rho_before: number[] | null; rho_after: number[] | null; max_rho: number | null; max_rho_line: string; is_rho_reduction: boolean; is_islanded?: boolean; n_components?: number; disconnected_mw?: number; non_convergence: string | null; lines_overloaded: string[]; };
        });

        const props = {
            ...defaultProps,
            disconnectedElement: 'contingency_A',
        };
        const { getByText, getByPlaceholderText } = render(<ActionFeed {...props} />);

        // Open search and add action
        fireEvent.click(getByText('+ Manual Selection'));

        // Wait for actions to load
        await waitFor(() => expect(screen.queryByText('Loading actions...')).not.toBeInTheDocument());

        const input = getByPlaceholderText('Search action by ID or description...');
        fireEvent.change(input, { target: { value: 'act1' } });

        const actionCard = await screen.findByTestId('action-card-act1');
        fireEvent.click(actionCard);

        // Verify it shows loading state
        expect(screen.getByText('Simulating...')).toBeInTheDocument();

        // At this point onManualActionAdded should NOT have been called yet
        expect(defaultProps.onManualActionAdded).not.toHaveBeenCalled();

        // Wait for simulation to finish
        await waitFor(() => expect(simulationFinished).toBe(true));

        // Now onManualActionAdded should have been called
        await waitFor(() => {
            expect(defaultProps.onManualActionAdded).toHaveBeenCalledWith(
                actionId,
                expect.objectContaining({ max_rho: 0.8 }),
                []
            );
        });
    });

    it('filters out combined actions that are marked as is_estimated', () => {
        const combinedId = 'act1+act2';
        const props = {
            ...defaultProps,
            actions: {
                [combinedId]: {
                    description_unitaire: 'Combined Action',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    is_estimated: true, // This should cause it to be filtered out
                    action_topology: emptyTopo
                }
            },
            selectedActionIds: new Set([combinedId]),
            analysisLoading: false,
        };
        render(<ActionFeed {...props} />);

        expect(screen.queryByText('Combined Action')).not.toBeInTheDocument();
    });

    it('shows simulated combined actions that are NOT marked as is_estimated', () => {
        const combinedId = 'act1+act2';
        const props = {
            ...defaultProps,
            actions: {
                [combinedId]: {
                    description_unitaire: 'Simulated Combined Action',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    is_estimated: false,
                    action_topology: emptyTopo
                }
            },
            selectedActionIds: new Set([combinedId]),
            analysisLoading: false,
        };
        render(<ActionFeed {...props} />);

        expect(screen.getByText('Simulated Combined Action')).toBeInTheDocument();
    });

    it('renders multiple asset badges for combined actions', () => {
        const combinedId = 'VL1+LINE_A';
        const props = {
            ...defaultProps,
            actions: {
                [combinedId]: {
                    description_unitaire: "Action on 'VL1' and LINE_A",
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_B',
                    is_rho_reduction: true,
                    action_topology: emptyTopo
                }
            },
            selectedActionIds: new Set([combinedId]),
            nodesByEquipmentId: new Map([['VL1', { equipmentId: 'VL1', svgId: 'svg-vl1', x: 0, y: 0 }]]),
            edgesByEquipmentId: new Map([['LINE_A', { equipmentId: 'LINE_A', svgId: 'svg-line-a', node1: 'n1', node2: 'n2' }]]),
        };

        // Mock utils to return the assets
        vi.mocked(getActionTargetVoltageLevels).mockReturnValue(['VL1']);
        vi.mocked(getActionTargetLines).mockReturnValue(['LINE_A']);

        render(<ActionFeed {...props} />);

        // Should see both badges
        expect(screen.getByText('VL1')).toBeInTheDocument();
        expect(screen.getByText('LINE_A')).toBeInTheDocument();

        // Clicking a badge should call onAssetClick
        fireEvent.click(screen.getByText('VL1'));
        expect(props.onAssetClick).toHaveBeenCalledWith(combinedId, 'VL1', 'action');

        fireEvent.click(screen.getByText('LINE_A'));
        expect(props.onAssetClick).toHaveBeenCalledWith(combinedId, 'LINE_A', 'action');
    });

    it('updates severity badges based on monitoringFactor', () => {
        const actionId = 'act_test';
        const actionDetail = {
            description_unitaire: 'Test Action',
            max_rho: 0.93,
            max_rho_line: 'LINE_A',
            rho_before: [1.0],
            rho_after: [0.93],
            is_rho_reduction: true,
            action_topology: emptyTopo
        };

        const renderWithMF = (mf: number) => render(
            <ActionFeed
                {...defaultProps}
                actions={{ [actionId]: actionDetail }}
                selectedActionIds={new Set([actionId])}
                monitoringFactor={mf}
            />
        );

        // 1. MF = 0.95 -> 0.93 is between (0.95-0.05) and 0.95 -> Orange
        const { rerender } = renderWithMF(0.95);
        expect(screen.getByText('Solved \u2014 low margin')).toBeInTheDocument();

        // 2. MF = 0.90 -> 0.93 is above 0.90 -> Red
        rerender(
            <ActionFeed
                {...defaultProps}
                actions={{ [actionId]: actionDetail }}
                selectedActionIds={new Set([actionId])}
                monitoringFactor={0.90}
            />
        );
        expect(screen.getByText('Still overloaded')).toBeInTheDocument();

        // 3. MF = 1.00 -> 0.93 is below (1.00-0.05) -> Green
        rerender(
            <ActionFeed
                {...defaultProps}
                actions={{ [actionId]: actionDetail }}
                selectedActionIds={new Set([actionId])}
                monitoringFactor={1.00}
            />
        );
        expect(screen.getByText('Solves overload')).toBeInTheDocument();
    });

    it('displays load shedding description with MW, load name, and clickable voltage level', () => {
        const actionId = 'load_shed_1';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Shedding action on load',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: { LOAD_1: -1 } },
                    load_shedding_details: [
                        { load_name: 'LOAD_1', voltage_level_id: 'VL_ALPHA', shedded_mw: 42.5 },
                    ],
                }
            },
            selectedActionIds: new Set([actionId]),
        };
        render(<ActionFeed {...props} />);

        // Should show load shedding description with asset name
        expect(screen.getByText(/Shedding on/)).toBeInTheDocument();
        expect(screen.getByText('LOAD_1')).toBeInTheDocument();

        // VL should be rendered as clickable badge button
        const vlButtons = screen.getAllByText('VL_ALPHA');
        expect(vlButtons.length).toBeGreaterThanOrEqual(1);
        expect(vlButtons.every(el => el.tagName === 'BUTTON')).toBe(true);
    });

    it('shows VL badges from load_shedding_details instead of load name badges', () => {
        const actionId = 'load_shed_2';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Shedding action',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: { LOAD_X: -1 } },
                    load_shedding_details: [
                        { load_name: 'LOAD_X', voltage_level_id: 'VL_BETA', shedded_mw: 10.0 },
                    ],
                }
            },
            selectedActionIds: new Set([actionId]),
        };
        render(<ActionFeed {...props} />);

        // VL badge should be present (green VL badge)
        const badges = screen.getAllByText('VL_BETA');
        // There should be at least one button element (the badge) with VL_BETA text
        const buttonBadges = badges.filter(el => el.tagName === 'BUTTON');
        expect(buttonBadges.length).toBeGreaterThan(0);
    });

    it('displays multiple load shedding entries when action sheds multiple loads', () => {
        const actionId = 'load_shed_multi';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Multi-load shedding',
                    rho_before: [1.0],
                    rho_after: [0.7],
                    max_rho: 0.7,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: { LOAD_A: -1, LOAD_B: -1 } },
                    load_shedding_details: [
                        { load_name: 'LOAD_A', voltage_level_id: 'VL_1', shedded_mw: 20.0 },
                        { load_name: 'LOAD_B', voltage_level_id: 'VL_2', shedded_mw: 15.3 },
                    ],
                }
            },
            selectedActionIds: new Set([actionId]),
        };
        render(<ActionFeed {...props} />);

        // Both load names should be shown in the simplified format
        expect(screen.getByText('LOAD_A')).toBeInTheDocument();
        expect(screen.getByText('LOAD_B')).toBeInTheDocument();
        // Both entries should have "Load shedding on" text
        const lsTexts = screen.getAllByText(/Shedding on/);
        expect(lsTexts.length).toBe(2);
    });

    it('clicking VL button in load shedding description triggers onAssetClick', () => {
        const onAssetClick = vi.fn();
        const actionId = 'load_shed_click';
        const props = {
            ...defaultProps,
            onAssetClick,
            actions: {
                [actionId]: {
                    description_unitaire: 'Shedding for click test',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: { LOAD_C: -1 } },
                    load_shedding_details: [
                        { load_name: 'LOAD_C', voltage_level_id: 'VL_GAMMA', shedded_mw: 30.0 },
                    ],
                }
            },
            selectedActionIds: new Set([actionId]),
        };
        render(<ActionFeed {...props} />);

        // Find the VL button in the load shedding description area (not the badge)
        const vlButtons = screen.getAllByText('VL_GAMMA');
        // Click the first one (description area)
        fireEvent.click(vlButtons[0]);
        expect(onAssetClick).toHaveBeenCalledWith(actionId, 'VL_GAMMA', 'action');
    });

    // ── MW Start column ────────────────────────────────────────────────────

    it('shows MW Start column header in score table', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                line_reconnection: {
                    scores: { act_reco: 8 },
                    mw_start: { act_reco: null },
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));

        expect(await screen.findByText('MW Start')).toBeInTheDocument();
    });

    it('shows numeric MW Start value for disco/pst/ls actions', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                line_disconnection: {
                    scores: { disco_L1: 9 },
                    mw_start: { disco_L1: 125.4 },
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));

        expect(await screen.findByText('125.4')).toBeInTheDocument();
    });

    it('shows N/A for reconnection and close-coupling actions', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                line_reconnection: {
                    scores: { reco_L2: 7 },
                    mw_start: { reco_L2: null },
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));

        expect(await screen.findByText('N/A')).toBeInTheDocument();
        expect(screen.queryByText(/^\d+\.\d$/)).not.toBeInTheDocument();
    });

    it('shows N/A when mw_start field is absent for the action', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                pst_tap_change: {
                    scores: { pst_act: 5 },
                    // no mw_start key at all
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));

        expect(await screen.findByText('N/A')).toBeInTheDocument();
    });

    it('shows MW Start for load shedding action', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                load_shedding: {
                    scores: { ls_LOAD_1: 3 },
                    mw_start: { ls_LOAD_1: 75.0 },
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));

        expect(await screen.findByText('75.0')).toBeInTheDocument();
    });

    // ── Power reduction format (loads_p / gens_p) ──────────────────────────

    it('displays load shedding details with new loads_p topology format', () => {
        const actionId = 'load_shed_new_format';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Load shedding (power reduction)',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {}, loads_p: { LOAD_PR: 0.0 } },
                    load_shedding_details: [
                        { load_name: 'LOAD_PR', voltage_level_id: 'VL_PR', shedded_mw: 55.3 },
                    ],
                }
            },
            selectedActionIds: new Set([actionId]),
        };
        render(<ActionFeed {...props} />);

        // Simplified format: "Shedding on LOAD_PR in MW: [input]"
        expect(screen.getByText(/Shedding on/)).toBeInTheDocument();
        expect(screen.getByText('LOAD_PR')).toBeInTheDocument();
        // VL badge should still be rendered
        const vlButtons = screen.getAllByText('VL_PR');
        expect(vlButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('displays curtailment details with new gens_p topology format', () => {
        const actionId = 'curtail_new_format';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Curtailment (power reduction)',
                    rho_before: [1.0],
                    rho_after: [0.85],
                    max_rho: 0.85,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {}, gens_p: { WIND_1: 0.0 } },
                    curtailment_details: [
                        { gen_name: 'WIND_1', voltage_level_id: 'VL_WIND', curtailed_mw: 80.0 },
                    ],
                }
            },
            selectedActionIds: new Set([actionId]),
        };
        render(<ActionFeed {...props} />);

        // Simplified format: "Curtailment on WIND_1 in MW: [input]"
        expect(screen.getByText(/Curtailment on/)).toBeInTheDocument();
        expect(screen.getByText('WIND_1')).toBeInTheDocument();
        // VL badge should still be rendered
        const vlButtons = screen.getAllByText('VL_WIND');
        expect(vlButtons.length).toBeGreaterThanOrEqual(1);
    });

    it('displays load shedding with loads_p and curtailment with gens_p in same action list', () => {
        const lsId = 'ls_new_1';
        const rcId = 'rc_new_1';
        const props = {
            ...defaultProps,
            actions: {
                [lsId]: {
                    description_unitaire: 'Load shedding power reduction',
                    rho_before: [1.0],
                    rho_after: [0.8],
                    max_rho: 0.8,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {}, loads_p: { LOAD_NEW: 0.0 } },
                    load_shedding_details: [
                        { load_name: 'LOAD_NEW', voltage_level_id: 'VL_LS', shedded_mw: 33.0 },
                    ],
                },
                [rcId]: {
                    description_unitaire: 'Curtailment power reduction',
                    rho_before: [1.0],
                    rho_after: [0.85],
                    max_rho: 0.85,
                    max_rho_line: 'LINE_A',
                    is_rho_reduction: true,
                    action_topology: { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {}, gens_p: { GEN_NEW: 0.0 } },
                    curtailment_details: [
                        { gen_name: 'GEN_NEW', voltage_level_id: 'VL_RC', curtailed_mw: 66.0 },
                    ],
                }
            },
            selectedActionIds: new Set([lsId, rcId]),
        };
        render(<ActionFeed {...props} />);

        // Load shedding details with new format
        expect(screen.getByText(/Shedding on/)).toBeInTheDocument();
        expect(screen.getByText('LOAD_NEW')).toBeInTheDocument();

        // Curtailment details with new format
        expect(screen.getByText(/Curtailment on/)).toBeInTheDocument();
        expect(screen.getByText('GEN_NEW')).toBeInTheDocument();
    });

    it('shows Target MW column in score table for load shedding type', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                load_shedding: {
                    scores: { 'load_shedding_LOAD_1': 5.0 },
                    params: {},
                    mw_start: { 'load_shedding_LOAD_1': 100.0 },
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));
        expect(await screen.findByText('Target MW')).toBeInTheDocument();
        expect(screen.getByTestId('target-mw-load_shedding_LOAD_1')).toBeInTheDocument();
    });

    it('shows Target MW column in score table for renewable curtailment type', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                renewable_curtailment: {
                    scores: { 'curtail_GEN_1': 3.0 },
                    params: {},
                    mw_start: { 'curtail_GEN_1': 80.0 },
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));
        expect(await screen.findByText('Target MW')).toBeInTheDocument();
        expect(screen.getByTestId('target-mw-curtail_GEN_1')).toBeInTheDocument();
    });

    it('does NOT show Target MW column for line_disconnection type', async () => {
        const props = {
            ...defaultProps,
            actionScores: {
                line_disconnection: {
                    scores: { 'disco_LINE_1': 7.0 },
                    params: {},
                    mw_start: { 'disco_LINE_1': null },
                }
            },
        };
        render(<ActionFeed {...props} />);
        fireEvent.click(screen.getByText('+ Manual Selection'));
        await screen.findByText('LINE DISCONNECTION');
        expect(screen.queryByText('Target MW')).not.toBeInTheDocument();
    });

    it('shows editable MW and re-simulate button on load shedding action card', () => {
        const actionId = 'load_shedding_LOAD_X';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Load shedding on LOAD_X',
                    rho_before: [0.95],
                    rho_after: [0.70],
                    max_rho: 0.70,
                    max_rho_line: 'LINE_1',
                    is_rho_reduction: true,
                    non_convergence: null,
                    load_shedding_details: [{ load_name: 'LOAD_X', voltage_level_id: 'VL_A', shedded_mw: 42.5 }],
                    action_topology: { ...emptyTopo, loads_p: { LOAD_X: 0.0 } },
                } as ActionDetail,
            },
        };
        render(<ActionFeed {...props} />);
        expect(screen.getByTestId(`edit-mw-${actionId}`)).toBeInTheDocument();
        expect(screen.getByTestId(`resimulate-${actionId}`)).toBeInTheDocument();
        expect(screen.getByTestId(`resimulate-${actionId}`)).toHaveTextContent('Re-simulate');
    });

    it('shows editable MW and re-simulate button on curtailment action card', () => {
        const actionId = 'curtail_GEN_Y';
        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Curtailment on GEN_Y',
                    rho_before: [0.95],
                    rho_after: [0.80],
                    max_rho: 0.80,
                    max_rho_line: 'LINE_1',
                    is_rho_reduction: true,
                    non_convergence: null,
                    curtailment_details: [{ gen_name: 'GEN_Y', voltage_level_id: 'VL_W', curtailed_mw: 60.0 }],
                    action_topology: { ...emptyTopo, gens_p: { GEN_Y: 0.0 } },
                } as ActionDetail,
            },
        };
        render(<ActionFeed {...props} />);
        expect(screen.getByTestId(`edit-mw-${actionId}`)).toBeInTheDocument();
        expect(screen.getByTestId(`resimulate-${actionId}`)).toBeInTheDocument();
    });

    it('calls simulateManualAction with target_mw when re-simulate is clicked', async () => {
        const actionId = 'load_shedding_LOAD_X';
        const mockResult = {
            action_id: actionId,
            description_unitaire: 'Load shedding on LOAD_X',
            rho_before: [0.95],
            rho_after: [0.60],
            max_rho: 0.60,
            max_rho_line: 'LINE_1',
            is_rho_reduction: true,
            non_convergence: null,
            lines_overloaded: ['LINE_1'],
            load_shedding_details: [{ load_name: 'LOAD_X', voltage_level_id: 'VL_A', shedded_mw: 25.0 }],
        };
        (api.simulateManualAction as ReturnType<typeof vi.fn>).mockResolvedValueOnce(mockResult);

        const props = {
            ...defaultProps,
            actions: {
                [actionId]: {
                    description_unitaire: 'Load shedding on LOAD_X',
                    rho_before: [0.95],
                    rho_after: [0.70],
                    max_rho: 0.70,
                    max_rho_line: 'LINE_1',
                    is_rho_reduction: true,
                    non_convergence: null,
                    load_shedding_details: [{ load_name: 'LOAD_X', voltage_level_id: 'VL_A', shedded_mw: 42.5 }],
                    action_topology: { ...emptyTopo, loads_p: { LOAD_X: 0.0 } },
                } as ActionDetail,
            },
        };
        render(<ActionFeed {...props} />);

        // Change the MW input value
        const mwInput = screen.getByTestId(`edit-mw-${actionId}`);
        fireEvent.change(mwInput, { target: { value: '25' } });

        // Click re-simulate
        fireEvent.click(screen.getByTestId(`resimulate-${actionId}`));

        await waitFor(() => {
            expect(api.simulateManualAction).toHaveBeenCalledWith(
                actionId,
                'LINE_1',
                expect.anything(),
                ['LINE_1'],
                25,
            );
        });
    });
});
