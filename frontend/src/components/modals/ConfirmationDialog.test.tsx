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
