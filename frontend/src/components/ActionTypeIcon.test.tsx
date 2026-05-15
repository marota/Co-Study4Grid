// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ActionTypeIcon } from './ActionTypeIcon';
import type { ActionTypeKind } from '../utils/actionTypes';

describe('ActionTypeIcon', () => {
    const kinds: ActionTypeKind[] = ['disco', 'reco', 'open', 'close', 'ls', 'rc', 'pst'];

    it('renders an aria-hidden currentColor svg with a glyph for every action-type kind', () => {
        for (const kind of kinds) {
            const { container } = render(<ActionTypeIcon kind={kind} />);
            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();
            expect(svg).toHaveAttribute('aria-hidden', 'true');
            expect(svg).toHaveAttribute('stroke', 'currentColor');
            expect(svg!.querySelector('path, circle')).not.toBeNull();
        }
    });

    it('defaults to a 13px glyph and honours the size prop', () => {
        expect(render(<ActionTypeIcon kind="disco" />).container.querySelector('svg'))
            .toHaveAttribute('width', '13');
        expect(render(<ActionTypeIcon kind="disco" size={18} />).container.querySelector('svg'))
            .toHaveAttribute('width', '18');
    });

    it('draws line glyphs as a vertical trace — dashed for disco, solid for reco', () => {
        const discoPath = render(<ActionTypeIcon kind="disco" />).container.querySelector('path');
        expect(discoPath).toHaveAttribute('d', 'M8 2 V14');
        expect(discoPath).toHaveAttribute('stroke-dasharray');

        const recoPath = render(<ActionTypeIcon kind="reco" />).container.querySelector('path');
        expect(recoPath).toHaveAttribute('d', 'M8 2 V14');
        expect(recoPath).not.toHaveAttribute('stroke-dasharray');
    });

    it('draws coupler glyphs as a horizontal switch with two terminal nodes', () => {
        // open / close carry the switch-blade motif framed by two
        // terminal dots so they read as voltage-level couplers, not
        // the single-line disco / reco glyphs.
        for (const kind of ['open', 'close'] as const) {
            const { container } = render(<ActionTypeIcon kind={kind} />);
            expect(container.querySelectorAll('circle').length).toBe(2);
        }
        // open = the blade swung clear of the contact (a diagonal segment).
        const openPaths = Array.from(
            render(<ActionTypeIcon kind="open" />).container.querySelectorAll('path'),
        ).map(p => p.getAttribute('d') ?? '');
        expect(openPaths.some(d => d.includes('L10 3.7'))).toBe(true);
    });
});
