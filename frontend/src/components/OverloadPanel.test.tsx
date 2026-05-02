// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OverloadPanel from './OverloadPanel';

describe('OverloadPanel', () => {
    const defaultProps = {
        nOverloads: [] as string[],
        n1Overloads: [] as string[],
        onAssetClick: vi.fn(),
    };

    it('renders the Overloads heading', () => {
        render(<OverloadPanel {...defaultProps} />);
        expect(screen.getByText('Overloads')).toBeInTheDocument();
    });

    it('shows "None" when no overloads', () => {
        render(<OverloadPanel {...defaultProps} />);
        const noneElements = screen.getAllByText('None');
        expect(noneElements).toHaveLength(2);
    });

    it('renders N overload links', () => {
        render(
            <OverloadPanel
                {...defaultProps}
                nOverloads={['LINE_A', 'LINE_B']}
            />
        );
        expect(screen.getByText('LINE_A')).toBeInTheDocument();
        expect(screen.getByText('LINE_B')).toBeInTheDocument();
    });

    it('renders N-1 overload links', () => {
        render(
            <OverloadPanel
                {...defaultProps}
                n1Overloads={['TRAFO_1']}
            />
        );
        expect(screen.getByText('TRAFO_1')).toBeInTheDocument();
    });

    it('calls onAssetClick with N tab for N overloads', async () => {
        const user = userEvent.setup();
        const onAssetClick = vi.fn();
        render(
            <OverloadPanel
                {...defaultProps}
                nOverloads={['LINE_A']}
                onAssetClick={onAssetClick}
            />
        );

        await user.click(screen.getByText('LINE_A'));
        expect(onAssetClick).toHaveBeenCalledWith('', 'LINE_A', 'n');
    });

    it('calls onAssetClick with N-1 tab for N-1 overloads', async () => {
        const user = userEvent.setup();
        const onAssetClick = vi.fn();
        render(
            <OverloadPanel
                {...defaultProps}
                n1Overloads={['LINE_B']}
                onAssetClick={onAssetClick}
            />
        );

        await user.click(screen.getByText('LINE_B'));
        expect(onAssetClick).toHaveBeenCalledWith('', 'LINE_B', 'n-1');
    });

    it('renders loading percentages next to overload names when rho is provided', () => {
        render(
            <OverloadPanel
                {...defaultProps}
                nOverloads={['LINE_A']}
                nOverloadsRho={[1.024]}
                n1Overloads={['LINE_B']}
                n1OverloadsRho={[1.1765]}
            />
        );
        expect(screen.getByText('(102.4%)')).toBeInTheDocument();
        expect(screen.getByText('(117.7%)')).toBeInTheDocument();
    });

    it('renders both N and N-1 overloads simultaneously', () => {
        render(
            <OverloadPanel
                {...defaultProps}
                nOverloads={['LINE_A']}
                n1Overloads={['LINE_B', 'LINE_C']}
            />
        );
        expect(screen.getByText('LINE_A')).toBeInTheDocument();
        expect(screen.getByText('LINE_B')).toBeInTheDocument();
        expect(screen.getByText('LINE_C')).toBeInTheDocument();
    });

    it('renders section labels', () => {
        render(<OverloadPanel {...defaultProps} />);
        expect(screen.getByText('N Overloads:')).toBeInTheDocument();
        expect(screen.getByText('N-1 Overloads:')).toBeInTheDocument();
    });

    describe('Monitoring Hint', () => {
        // tier-warning-system PR (`docs/proposals/ui-design-critique.md` recommendation #4)
        // demoted the inline yellow monitoring banner. The full notice now
        // lives in NoticesPanel; OverloadPanel keeps only a small grey
        // contextual hint under the heading.
        it('renders the monitoring hint when provided', () => {
            render(
                <OverloadPanel
                    {...defaultProps}
                    monitoringHint="130/150 lines monitored — see Notices for details."
                />
            );
            expect(screen.getByTestId('overload-monitoring-hint')).toHaveTextContent(
                '130/150 lines monitored — see Notices for details.',
            );
        });

        it('omits the hint when monitoringHint is null', () => {
            render(<OverloadPanel {...defaultProps} monitoringHint={null} />);
            expect(screen.queryByTestId('overload-monitoring-hint')).not.toBeInTheDocument();
        });
    });
});
