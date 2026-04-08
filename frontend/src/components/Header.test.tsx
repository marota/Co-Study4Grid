// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import Header from './Header';
import type { AnalysisResult } from '../types';

describe('Header', () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    const defaultProps = {
        networkPath: '/path/to/network.xiidm',
        setNetworkPath: vi.fn(),
        configLoading: false,
        result: null,
        selectedBranch: '',
        sessionRestoring: false,
        onPickSettingsPath: vi.fn(),
        onLoadStudy: vi.fn(),
        onSaveResults: vi.fn(),
        onOpenReloadModal: vi.fn(),
        onOpenSettings: vi.fn(),
    };

    it('renders correctly with default props', () => {
        render(<Header {...defaultProps} />);
        expect(screen.getByText('⚡ Co-Study4Grid')).toBeInTheDocument();
        expect(screen.getByDisplayValue('/path/to/network.xiidm')).toBeInTheDocument();
        expect(screen.getByText('🔄 Load Study')).toBeInTheDocument();
    });

    it('shows loading state on Load Study button', () => {
        render(<Header {...defaultProps} configLoading={true} />);
        expect(screen.getByText('⏳ Loading...')).toBeInTheDocument();
        expect(screen.getByText('⏳ Loading...')).toBeDisabled();
    });

    it('disables Save Results when no result or selected branch', () => {
        render(<Header {...defaultProps} />);
        expect(screen.getByText('💾 Save Results')).toBeDisabled();
    });

    it('enables Save Results when result is present', () => {
        render(<Header {...defaultProps} result={{} as unknown as AnalysisResult} />); // result present
        expect(screen.getByText('💾 Save Results')).not.toBeDisabled();
    });

    it('calls callbacks when buttons are clicked', () => {
        render(<Header {...defaultProps} />);
        
        fireEvent.click(screen.getByText('🔄 Load Study'));
        expect(defaultProps.onLoadStudy).toHaveBeenCalled();

        fireEvent.click(screen.getByText('Reload Session'));
        expect(defaultProps.onOpenReloadModal).toHaveBeenCalled();

        fireEvent.click(screen.getByTitle('Settings'));
        expect(defaultProps.onOpenSettings).toHaveBeenCalledWith('paths');
    });

    it('calls onPickSettingsPath when file icon is clicked', () => {
        render(<Header {...defaultProps} />);
        fireEvent.click(screen.getByText('📄'));
        expect(defaultProps.onPickSettingsPath).toHaveBeenCalled();
    });
});
