// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ReloadSessionModal from './ReloadSessionModal';

describe('ReloadSessionModal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultProps = {
        showReloadModal: true,
        setShowReloadModal: vi.fn(),
        outputFolderPath: '/sessions',
        sessionListLoading: false,
        sessionList: ['session1', 'session2'],
        sessionRestoring: false,
        onRestoreSession: vi.fn(),
    };

    it('returns null when showReloadModal is false', () => {
        const { container } = render(<ReloadSessionModal {...defaultProps} showReloadModal={false} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders session list correctly', () => {
        render(<ReloadSessionModal {...defaultProps} />);
        expect(screen.getByText('Reload Session')).toBeInTheDocument();
        expect(screen.getByText('session1')).toBeInTheDocument();
        expect(screen.getByText('session2')).toBeInTheDocument();
    });

    it('shows loading state', () => {
        render(<ReloadSessionModal {...defaultProps} sessionListLoading={true} />);
        expect(screen.getByText('Loading sessions...')).toBeInTheDocument();
    });

    it('shows empty state', () => {
        render(<ReloadSessionModal {...defaultProps} sessionList={[]} />);
        expect(screen.getByText('No saved sessions found in this folder.')).toBeInTheDocument();
    });

    it('calls onRestoreSession when a session is clicked', () => {
        render(<ReloadSessionModal {...defaultProps} />);
        fireEvent.click(screen.getByText('session1'));
        expect(defaultProps.onRestoreSession).toHaveBeenCalledWith('session1');
    });

    it('prevents click when sessionRestoring is true', () => {
        render(<ReloadSessionModal {...defaultProps} sessionRestoring={true} />);
        fireEvent.click(screen.getByText('session1'));
        expect(defaultProps.onRestoreSession).not.toHaveBeenCalled();
    });

    it('closes modal when close button or cancel is clicked', () => {
        render(<ReloadSessionModal {...defaultProps} />);
        fireEvent.click(screen.getByText('×'));
        expect(defaultProps.setShowReloadModal).toHaveBeenCalledWith(false);

        fireEvent.click(screen.getByText('Cancel'));
        expect(defaultProps.setShowReloadModal).toHaveBeenCalledWith(false);
    });
});
