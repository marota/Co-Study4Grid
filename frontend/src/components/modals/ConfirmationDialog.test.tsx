// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ConfirmationDialog from './ConfirmationDialog';

describe('ConfirmationDialog', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultProps = {
        confirmDialog: { type: 'contingency' as const, pendingBranch: 'L1' },
        onCancel: vi.fn(),
        onConfirm: vi.fn(),
    };

    it('returns null when confirmDialog is null', () => {
        const { container } = render(<ConfirmationDialog {...defaultProps} confirmDialog={null} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders correctly for contingency change', () => {
        render(<ConfirmationDialog {...defaultProps} />);
        expect(screen.getByText('Change Contingency?')).toBeInTheDocument();
        expect(screen.getByText(/All previous analysis results/)).toBeInTheDocument();
        expect(screen.getByText(/The network state will be preserved./)).toBeInTheDocument();
    });

    it('renders correctly for load study', () => {
        render(<ConfirmationDialog {...defaultProps} confirmDialog={{ type: 'loadStudy' }} />);
        expect(screen.getByText('Reload Study?')).toBeInTheDocument();
        expect(screen.getByText(/The network will be reloaded from scratch./)).toBeInTheDocument();
    });

    it('renders correctly for apply settings', () => {
        render(<ConfirmationDialog {...defaultProps} confirmDialog={{ type: 'applySettings' }} />);
        expect(screen.getByText('Apply New Settings?')).toBeInTheDocument();
        expect(screen.getByText(/All previous analysis results/)).toBeInTheDocument();
        expect(
            screen.getByText(/The network will be reloaded with the new configuration./),
        ).toBeInTheDocument();
        // The dialog must carry a stable testid so App.tsx integration
        // tests can target the apply-settings variant unambiguously.
        expect(screen.getByTestId('confirm-dialog-applySettings')).toBeInTheDocument();
    });

    it('renders correctly for clearSuggested', () => {
        // The Clear button on the Action Feed routes through the shared
        // confirmation dialog with a bespoke body that spells out what is
        // removed (un-touched recommender suggestions) and what is kept
        // (starred / rejected / manually-added actions).
        render(<ConfirmationDialog {...defaultProps} confirmDialog={{ type: 'clearSuggested' }} />);
        expect(screen.getByText('Clear Suggestions?')).toBeInTheDocument();
        expect(screen.getByText(/will be removed from the feed/)).toBeInTheDocument();
        expect(screen.getByText(/starred, rejected, and\s+manually-added actions are kept/)).toBeInTheDocument();
        // It must NOT carry the destructive study-reset copy.
        expect(screen.queryByText(/All previous analysis results/)).not.toBeInTheDocument();
        expect(screen.getByTestId('confirm-dialog-clearSuggested')).toBeInTheDocument();
    });

    it('calls onConfirm when confirm button is clicked', () => {
        render(<ConfirmationDialog {...defaultProps} />);
        fireEvent.click(screen.getByText('Confirm'));
        expect(defaultProps.onConfirm).toHaveBeenCalled();
    });

    it('calls onCancel when cancel button is clicked', () => {
        render(<ConfirmationDialog {...defaultProps} />);
        fireEvent.click(screen.getByText('Cancel'));
        expect(defaultProps.onCancel).toHaveBeenCalled();
    });
});
