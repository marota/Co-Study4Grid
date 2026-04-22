// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import ActionTypeFilterChips from './ActionTypeFilterChips';

afterEach(() => cleanup());

describe('ActionTypeFilterChips', () => {
    it('renders one chip per token (ALL + seven type buckets)', () => {
        const onChange = vi.fn();
        const { getByTestId } = render(
            <ActionTypeFilterChips value="all" onChange={onChange} />,
        );
        expect(getByTestId('action-type-filter-all')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-disco')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-reco')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-ls')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-rc')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-open')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-close')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-pst')).toBeInTheDocument();
    });

    it('marks the active chip via aria-pressed', () => {
        const { getByTestId, rerender } = render(
            <ActionTypeFilterChips value="all" onChange={vi.fn()} />,
        );
        expect(getByTestId('action-type-filter-all').getAttribute('aria-pressed')).toBe('true');
        expect(getByTestId('action-type-filter-disco').getAttribute('aria-pressed')).toBe('false');

        rerender(<ActionTypeFilterChips value="disco" onChange={vi.fn()} />);
        expect(getByTestId('action-type-filter-disco').getAttribute('aria-pressed')).toBe('true');
        expect(getByTestId('action-type-filter-all').getAttribute('aria-pressed')).toBe('false');
    });

    it('fires onChange with the clicked token', () => {
        const onChange = vi.fn();
        const { getByTestId } = render(
            <ActionTypeFilterChips value="all" onChange={onChange} />,
        );
        fireEvent.click(getByTestId('action-type-filter-pst'));
        expect(onChange).toHaveBeenCalledTimes(1);
        expect(onChange).toHaveBeenCalledWith('pst');
    });

    it('honours a custom `tokens` override', () => {
        const { getByTestId, queryByTestId } = render(
            <ActionTypeFilterChips value="all" onChange={vi.fn()} tokens={['all', 'disco']} />,
        );
        expect(getByTestId('action-type-filter-all')).toBeInTheDocument();
        expect(getByTestId('action-type-filter-disco')).toBeInTheDocument();
        expect(queryByTestId('action-type-filter-pst')).toBeNull();
    });

    it('respects a custom testIdPrefix', () => {
        const { getByTestId } = render(
            <ActionTypeFilterChips testIdPrefix="my-chips" value="all" onChange={vi.fn()} />,
        );
        expect(getByTestId('my-chips')).toBeInTheDocument();
        expect(getByTestId('my-chips-disco')).toBeInTheDocument();
    });
});
