// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NoticesPanel, { type Notice } from './NoticesPanel';

describe('NoticesPanel', () => {
    const baseNotices: Notice[] = [
        { id: 'one', title: 'First notice', body: 'Lorem ipsum.', severity: 'info' },
        { id: 'two', title: 'Second notice', body: 'Dolor sit amet.', severity: 'warning' },
    ];

    it('renders nothing when the notices array is empty', () => {
        const { container } = render(<NoticesPanel notices={[]} />);
        expect(container.firstChild).toBeNull();
    });

    it('renders the pill with a count badge when notices are present', () => {
        render(<NoticesPanel notices={baseNotices} />);
        const pill = screen.getByTestId('notices-pill');
        expect(pill).toBeInTheDocument();
        expect(pill).toHaveTextContent('2');
        // Panel is collapsed by default — list should not be visible.
        expect(screen.queryByTestId('notices-list')).not.toBeInTheDocument();
    });

    it('expands the panel and shows each notice when the pill is clicked', async () => {
        const user = userEvent.setup();
        render(<NoticesPanel notices={baseNotices} />);
        await user.click(screen.getByTestId('notices-pill'));
        expect(screen.getByTestId('notices-list')).toBeInTheDocument();
        expect(screen.getByTestId('notice-one')).toHaveTextContent('First notice');
        expect(screen.getByTestId('notice-two')).toHaveTextContent('Second notice');
    });

    it('invokes onDismiss when the dismiss button is clicked', async () => {
        const user = userEvent.setup();
        const onDismiss = vi.fn();
        render(
            <NoticesPanel
                notices={[{ id: 'mon', title: 'Monitoring', body: 'body', onDismiss }]}
            />,
        );
        await user.click(screen.getByTestId('notices-pill'));
        await user.click(screen.getByLabelText('Dismiss Monitoring'));
        expect(onDismiss).toHaveBeenCalledTimes(1);
    });

    it('renders an in-card action button and triggers it on click', async () => {
        const user = userEvent.setup();
        const onClick = vi.fn();
        render(
            <NoticesPanel
                notices={[{
                    id: 'rec',
                    title: 'Recommender',
                    body: 'body',
                    action: { label: 'Open settings', onClick },
                }]}
            />,
        );
        await user.click(screen.getByTestId('notices-pill'));
        await user.click(screen.getByText('Open settings'));
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it('hides the panel when the underlying notice list becomes empty', async () => {
        const user = userEvent.setup();
        const { rerender } = render(<NoticesPanel notices={baseNotices} />);
        await user.click(screen.getByTestId('notices-pill'));
        expect(screen.getByTestId('notices-list')).toBeInTheDocument();

        rerender(<NoticesPanel notices={[]} />);
        // With zero notices the pill self-hides entirely.
        expect(screen.queryByTestId('notices-pill')).not.toBeInTheDocument();
        expect(screen.queryByTestId('notices-list')).not.toBeInTheDocument();
    });
});
