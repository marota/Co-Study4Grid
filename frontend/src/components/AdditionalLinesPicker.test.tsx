// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdditionalLinesPicker from './AdditionalLinesPicker';

describe('AdditionalLinesPicker', () => {
    it('renders the heading and existing chips', () => {
        render(
            <AdditionalLinesPicker
                branches={['LINE_A', 'LINE_B', 'LINE_C']}
                n1Overloads={[]}
                additionalLinesToCut={new Set(['LINE_A'])}
                onToggle={vi.fn()}
            />,
        );
        expect(screen.getByTestId('additional-lines-picker')).toBeInTheDocument();
        expect(screen.getByText('Additional lines to prevent flow increase:')).toBeInTheDocument();
        expect(screen.getByText('LINE_A')).toBeInTheDocument();
    });

    it('commits a suggestion on click and excludes detected overloads', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(
            <AdditionalLinesPicker
                branches={['LINE_A', 'LINE_B', 'LINE_C']}
                n1Overloads={['LINE_A']}
                additionalLinesToCut={new Set()}
                onToggle={onToggle}
            />,
        );

        const input = screen.getByPlaceholderText('Add line ID…');
        await user.click(input);
        await user.type(input, 'LINE_');

        const labels = screen.getAllByRole('option').map(o => o.textContent);
        expect(labels).toContain('LINE_B');
        expect(labels).toContain('LINE_C');
        expect(labels).not.toContain('LINE_A');

        await user.click(screen.getByText('LINE_B'));
        expect(onToggle).toHaveBeenCalledWith('LINE_B');
    });

    it('removes a chip when its × button is clicked', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(
            <AdditionalLinesPicker
                branches={['LINE_A', 'LINE_B']}
                n1Overloads={[]}
                additionalLinesToCut={new Set(['LINE_A'])}
                onToggle={onToggle}
            />,
        );

        await user.click(screen.getByTitle('Remove LINE_A'));
        expect(onToggle).toHaveBeenCalledWith('LINE_A');
    });

    it('skips lines not in branches even on Enter', async () => {
        const user = userEvent.setup();
        const onToggle = vi.fn();
        render(
            <AdditionalLinesPicker
                branches={['LINE_A']}
                n1Overloads={[]}
                additionalLinesToCut={new Set()}
                onToggle={onToggle}
            />,
        );

        const input = screen.getByPlaceholderText('Add line ID…');
        await user.click(input);
        await user.type(input, 'UNKNOWN_LINE{Enter}');
        expect(onToggle).not.toHaveBeenCalled();
    });
});
