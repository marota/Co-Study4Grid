// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

vi.mock('../utils/svgUtils', () => ({
    getActionTargetVoltageLevels: vi.fn(() => []),
    getActionTargetLines: vi.fn(() => []),
    isCouplingAction: vi.fn(() => false),
}));

import ActionCard from './ActionCard';
import type { ActionDetail } from '../types';

describe('ActionCard', () => {
    const emptyTopo = { lines_ex_bus: {}, lines_or_bus: {}, gens_bus: {}, loads_bus: {} };

    const baseDetails: ActionDetail = {
        description_unitaire: 'Open line L1',
        rho_before: [1.05],
        rho_after: [0.85],
        max_rho: 0.85,
        max_rho_line: 'LINE_A',
        is_rho_reduction: true,
        action_topology: emptyTopo,
    };

    const defaultProps = {
        id: 'act_1',
        details: baseDetails,
        index: 0,
        isViewing: false,
        isSelected: false,
        isRejected: false,
        linesOverloaded: ['LINE_A'],
        monitoringFactor: 0.95,
        nodesByEquipmentId: null,
        edgesByEquipmentId: null,
        cardEditMw: {} as Record<string, string>,
        cardEditTap: {} as Record<string, string>,
        resimulating: null,
        onActionSelect: vi.fn(),
        onActionFavorite: vi.fn(),
        onActionReject: vi.fn(),
        onAssetClick: vi.fn(),
        onVlDoubleClick: vi.fn(),
        onCardEditMwChange: vi.fn(),
        onCardEditTapChange: vi.fn(),
        onResimulate: vi.fn(),
        onResimulateTap: vi.fn(),
    };

    it('renders action card with description and id', () => {
        render(<ActionCard {...defaultProps} />);
        expect(screen.getByText('Open line L1')).toBeInTheDocument();
        expect(screen.getByTestId('action-card-act_1')).toBeInTheDocument();
    });

    it('displays action index and id in header', () => {
        render(<ActionCard {...defaultProps} index={2} />);
        expect(screen.getByText(/^#3/)).toBeInTheDocument();
    });

    it('shows "Solves overload" badge when max_rho is below monitoring factor', () => {
        render(<ActionCard {...defaultProps} />);
        expect(screen.getByText('Solves overload')).toBeInTheDocument();
    });

    it('shows "Still overloaded" badge when max_rho exceeds monitoring factor', () => {
        const details = { ...baseDetails, max_rho: 0.98, is_rho_reduction: true };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText('Still overloaded')).toBeInTheDocument();
    });

    it('shows "Solved — low margin" badge when max_rho is close to monitoring factor', () => {
        const details = { ...baseDetails, max_rho: 0.92 };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText(/Solved.*low margin/)).toBeInTheDocument();
    });

    it('shows "divergent" badge for non-convergence actions', () => {
        const details = { ...baseDetails, non_convergence: 'AC did not converge' };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText('divergent')).toBeInTheDocument();
        expect(screen.getByText(/LoadFlow failure/)).toBeInTheDocument();
    });

    it('shows "islanded" badge for islanded actions', () => {
        const details = { ...baseDetails, is_islanded: true, disconnected_mw: 12.5 };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText('islanded')).toBeInTheDocument();
        expect(screen.getByText(/12\.5 MW disconnected/)).toBeInTheDocument();
    });

    it('shows VIEWING indicator when isViewing is true', () => {
        render(<ActionCard {...defaultProps} isViewing={true} />);
        expect(screen.getByText('VIEWING')).toBeInTheDocument();
    });

    it('does not show VIEWING indicator when isViewing is false', () => {
        render(<ActionCard {...defaultProps} isViewing={false} />);
        expect(screen.queryByText('VIEWING')).not.toBeInTheDocument();
    });

    it('renders the VIEWING marker as a vertical ribbon on the left edge', () => {
        // The ribbon sits flush against the left border to free a full
        // row of horizontal space inside the card header (long action
        // IDs on a narrow sidebar).  It must be a sibling of the
        // content column — not inside the header — and must use
        // vertical writing mode.
        render(<ActionCard {...defaultProps} isViewing={true} />);
        const ribbon = screen.getByTestId('action-card-act_1-viewing-ribbon');
        expect(ribbon).toBeInTheDocument();
        expect(ribbon).toHaveTextContent('VIEWING');
        expect(ribbon).toHaveStyle({ writingMode: 'vertical-rl' });

        // And the inline top-right VIEWING pill is gone (the severity
        // badge — "Solves overload" — is still rendered next to the
        // title, but not the old rectangular "VIEWING" pill).
        const card = screen.getByTestId('action-card-act_1');
        const inlinePill = card.querySelectorAll('span');
        const pillTexts = Array.from(inlinePill).map(el => el.textContent);
        // The vertical ribbon is a <div>, not a <span>, so no <span>
        // should contain exactly "VIEWING".
        expect(pillTexts).not.toContain('VIEWING');
    });

    it('does not render the vertical ribbon when isViewing is false', () => {
        render(<ActionCard {...defaultProps} isViewing={false} />);
        expect(screen.queryByTestId('action-card-act_1-viewing-ribbon')).not.toBeInTheDocument();
    });

    it('calls onActionSelect when card is clicked', () => {
        const onActionSelect = vi.fn();
        render(<ActionCard {...defaultProps} onActionSelect={onActionSelect} />);
        fireEvent.click(screen.getByTestId('action-card-act_1'));
        expect(onActionSelect).toHaveBeenCalledWith('act_1');
    });

    it('shows star button when action is not selected', () => {
        render(<ActionCard {...defaultProps} isSelected={false} />);
        expect(screen.getByTitle('Select this action')).toBeInTheDocument();
    });

    it('hides star button when action is already selected', () => {
        render(<ActionCard {...defaultProps} isSelected={true} />);
        expect(screen.queryByTitle('Select this action')).not.toBeInTheDocument();
    });

    it('shows reject button when action is not rejected', () => {
        render(<ActionCard {...defaultProps} isRejected={false} />);
        expect(screen.getByTitle('Reject this action')).toBeInTheDocument();
    });

    it('hides reject button when action is already rejected', () => {
        render(<ActionCard {...defaultProps} isRejected={true} />);
        expect(screen.queryByTitle('Reject this action')).not.toBeInTheDocument();
    });

    it('calls onActionFavorite when star button is clicked', () => {
        const onActionFavorite = vi.fn();
        render(<ActionCard {...defaultProps} onActionFavorite={onActionFavorite} />);
        fireEvent.click(screen.getByTitle('Select this action'));
        expect(onActionFavorite).toHaveBeenCalledWith('act_1');
    });

    it('calls onActionReject when reject button is clicked', () => {
        const onActionReject = vi.fn();
        render(<ActionCard {...defaultProps} onActionReject={onActionReject} />);
        fireEvent.click(screen.getByTitle('Reject this action'));
        expect(onActionReject).toHaveBeenCalledWith('act_1');
    });

    it('displays max loading percentage and line name', () => {
        render(<ActionCard {...defaultProps} />);
        expect(screen.getByText('Max loading:')).toBeInTheDocument();
        // Multiple elements contain 85.0% (rho_after + max_rho); check at least one is present
        expect(screen.getAllByText(/85\.0%/).length).toBeGreaterThan(0);
        expect(screen.getAllByTitle('Zoom to LINE_A').length).toBeGreaterThan(0);
    });

    it('clicks on the max-loading line name zoom the new worst line, not the pre-action overload', () => {
        // Regression: the action re-distributes flows and the new worst
        // line (LINE_B) is NOT in linesOverloaded (which reflects the
        // pre-action N-1 overloads — only LINE_A here). Clicking
        // "LINE_B" in the "Max loading: X% on LINE_B" row must zoom on
        // LINE_B, not on any of the pre-action lines.
        const onAssetClick = vi.fn();
        const details: ActionDetail = {
            ...baseDetails,
            rho_before: [1.05],
            rho_after: [0.72],     // LINE_A is now below the limit
            max_rho: 0.967,        // but LINE_B (newly overloaded) peaks at 96.7%
            max_rho_line: 'LINE_B',
            is_rho_reduction: true,
        };
        render(
            <ActionCard
                {...defaultProps}
                details={details}
                linesOverloaded={['LINE_A']}
                onAssetClick={onAssetClick}
            />
        );

        // The displayed text must mention the new worst line
        expect(screen.getByText('96.7%')).toBeInTheDocument();

        // Click specifically the "on LINE_B" button inside the Max
        // loading row — not the rho_after button (which would be on
        // LINE_A) and not any sticky-panel button (not in this test).
        const maxRhoButton = screen.getByTitle('Zoom to LINE_B');
        fireEvent.click(maxRhoButton);

        expect(onAssetClick).toHaveBeenCalledTimes(1);
        expect(onAssetClick).toHaveBeenCalledWith('act_1', 'LINE_B', 'action');
    });

    it('renders loading after rho section (loading before is shown in the sticky Overloads panel)', () => {
        render(<ActionCard {...defaultProps} />);
        expect(screen.queryByText(/Loading before/)).not.toBeInTheDocument();
        expect(screen.getByText(/Loading after/)).toBeInTheDocument();
    });

    it('renders load shedding details with MW input and re-simulate button', () => {
        const details: ActionDetail = {
            ...baseDetails,
            load_shedding_details: [
                { load_name: 'LOAD_X', voltage_level_id: 'VL1', shedded_mw: 5.0 }
            ],
        };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText(/Shedding on/)).toBeInTheDocument();
        expect(screen.getByText('LOAD_X')).toBeInTheDocument();
        expect(screen.getByTestId('edit-mw-act_1')).toBeInTheDocument();
        expect(screen.getByTestId('resimulate-act_1')).toBeInTheDocument();
    });

    it('renders curtailment details with MW input and re-simulate button', () => {
        const details: ActionDetail = {
            ...baseDetails,
            curtailment_details: [
                { gen_name: 'GEN_Y', voltage_level_id: 'VL2', curtailed_mw: 3.0 }
            ],
        };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText(/Curtailment on/)).toBeInTheDocument();
        expect(screen.getByText('GEN_Y')).toBeInTheDocument();
        expect(screen.getByTestId('edit-mw-act_1')).toBeInTheDocument();
    });

    it('renders PST details with tap input and re-simulate button', () => {
        const details: ActionDetail = {
            ...baseDetails,
            pst_details: [
                { pst_name: 'PST_Z', tap_position: 5, low_tap: -10, high_tap: 10 }
            ],
        };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText('PST_Z')).toBeInTheDocument();
        expect(screen.getByTestId('edit-tap-act_1')).toBeInTheDocument();
        expect(screen.getByText('[-10..10]')).toBeInTheDocument();
    });

    it('calls onResimulate when load shedding re-simulate is clicked', () => {
        const onResimulate = vi.fn();
        const details: ActionDetail = {
            ...baseDetails,
            load_shedding_details: [
                { load_name: 'LOAD_X', voltage_level_id: 'VL1', shedded_mw: 5.0 }
            ],
        };
        render(<ActionCard {...defaultProps} details={details} onResimulate={onResimulate} />);
        fireEvent.click(screen.getByTestId('resimulate-act_1'));
        expect(onResimulate).toHaveBeenCalledWith('act_1', 5.0);
    });

    it('calls onResimulateTap when PST re-simulate is clicked', () => {
        const onResimulateTap = vi.fn();
        const details: ActionDetail = {
            ...baseDetails,
            pst_details: [
                { pst_name: 'PST_Z', tap_position: 5, low_tap: -10, high_tap: 10 }
            ],
        };
        render(<ActionCard {...defaultProps} details={details} onResimulateTap={onResimulateTap} />);
        fireEvent.click(screen.getByTestId('resimulate-tap-act_1'));
        expect(onResimulateTap).toHaveBeenCalledWith('act_1', 5);
    });

    it('shows "Simulating..." on re-simulate button when resimulating matches id', () => {
        const details: ActionDetail = {
            ...baseDetails,
            load_shedding_details: [
                { load_name: 'LOAD_X', voltage_level_id: 'VL1', shedded_mw: 5.0 }
            ],
        };
        render(<ActionCard {...defaultProps} details={details} resimulating="act_1" />);
        expect(screen.getByText('Simulating...')).toBeInTheDocument();
    });

    it('calls onCardEditMwChange when MW input value changes', () => {
        const onCardEditMwChange = vi.fn();
        const details: ActionDetail = {
            ...baseDetails,
            load_shedding_details: [
                { load_name: 'LOAD_X', voltage_level_id: 'VL1', shedded_mw: 5.0 }
            ],
        };
        render(<ActionCard {...defaultProps} details={details} onCardEditMwChange={onCardEditMwChange} />);
        fireEvent.change(screen.getByTestId('edit-mw-act_1'), { target: { value: '7.5' } });
        expect(onCardEditMwChange).toHaveBeenCalledWith('act_1', '7.5');
    });

    it('renders "No reduction" badge when is_rho_reduction is false', () => {
        const details = { ...baseDetails, max_rho: 1.1, is_rho_reduction: false };
        render(<ActionCard {...defaultProps} details={details} />);
        expect(screen.getByText('No reduction')).toBeInTheDocument();
    });
});
