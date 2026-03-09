import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mocking dependencies
vi.mock('../api', () => ({
    api: {
        getAvailableActions: vi.fn(async () => []),
    }
}));

vi.mock('../utils/svgUtils', () => ({
    getActionTargetVoltageLevel: vi.fn(() => null),
    getActionTargetLines: vi.fn(() => []),
    processSvg: vi.fn(),
    buildMetadataIndex: vi.fn(),
    applyOverloadedHighlights: vi.fn(),
    applyDeltaVisuals: vi.fn(),
    applyActionTargetHighlights: vi.fn(),
    applyContingencyHighlight: vi.fn(),
}));

import ActionFeed from './ActionFeed';
import type { ActionDetail, AnalysisResult } from '../types';

describe('ActionFeed', () => {
    const emptyTopo = { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} };
    
    const defaultProps = {
        actions: {} as Record<string, ActionDetail>,
        actionScores: {} as Record<string, Record<string, unknown>>,
        linesOverloaded: [] as string[],
        selectedActionId: null,
        selectedActionIds: new Set<string>(),
        rejectedActionIds: new Set<string>(),
        onActionSelect: vi.fn(),
        onActionFavorite: vi.fn(),
        onActionReject: vi.fn(),
        onAssetClick: vi.fn(),
        onDisplayPrioritizedActions: vi.fn(),
        nodesByEquipmentId: new Map(),
        edgesByEquipmentId: new Map(),
        disconnectedElement: null,
        onManualActionAdded: vi.fn(),
        analysisLoading: false,
        monitoringFactor: 0.95,
        manuallyAddedIds: new Set<string>(),
        minLineReconnections: 2,
        minCloseCoupling: 3,
        minOpenCoupling: 2,
        minLineDisconnections: 3,
        nPrioritizedActions: 10,
        ignoreReconnections: false,
        pendingAnalysisResult: null as AnalysisResult | null,
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
        expect(screen.getByText('⚙️ Processing analysis...')).toBeInTheDocument();
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
        expect(screen.getByText('⚙️ Processing analysis...')).toBeInTheDocument();
    });

    it('shows display prioritized actions button when pending results exist and loading is false', () => {
        const props = {
            ...defaultProps,
            analysisLoading: false,
            pendingAnalysisResult: {
                actions: { 'new_act': { description_unitaire: 'New', rho_before: [], rho_after: [], max_rho: 0.5, max_rho_line: '', is_rho_reduction: true } }
            } as unknown as AnalysisResult,
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
                actions: { 'new_act': { description_unitaire: 'New', rho_before: [], rho_after: [], max_rho: 0.5, max_rho_line: '', is_rho_reduction: true } }
            } as unknown as AnalysisResult,
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
});
