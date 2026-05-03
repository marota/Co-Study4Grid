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

    it('renders the popover via a portal so it escapes ancestor overflow:hidden clipping', async () => {
        const user = userEvent.setup();
        render(
            <div data-testid="clipping-parent" style={{ overflow: 'hidden', position: 'relative', width: 200, height: 50 }}>
                <NoticesPanel notices={baseNotices} />
            </div>,
        );
        await user.click(screen.getByTestId('notices-pill'));
        const list = screen.getByTestId('notices-list');
        const clippingParent = screen.getByTestId('clipping-parent');
        // The portal target is document.body, so the popover must NOT
        // be a DOM descendant of the clipping container — that's how
        // it escapes the sidebar's `overflow: hidden`.
        expect(clippingParent.contains(list)).toBe(false);
        expect(document.body.contains(list)).toBe(true);
        expect(list).toHaveStyle({ position: 'fixed' });
    });

    it('wraps long unbreakable strings inside the notice card so they cannot bleed out', async () => {
        const user = userEvent.setup();
        render(
            <NoticesPanel
                notices={[{
                    id: 'long-path',
                    title: 'Action dictionary',
                    body: <code>feature_actions_from_REPAS.2024.12.10_withPSTs.json</code>,
                    severity: 'info',
                }]}
            />,
        );
        await user.click(screen.getByTestId('notices-pill'));
        const card = screen.getByTestId('notice-long-path');
        // overflowWrap: anywhere + wordBreak: break-word are what allow
        // a long filename or path to break inside the 320 px panel
        // instead of pushing past the card edges.
        expect(card).toHaveStyle({ overflow: 'hidden' });
        expect(card).toHaveStyle({ overflowWrap: 'anywhere' });
        expect(card).toHaveStyle({ wordBreak: 'break-word' });
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
