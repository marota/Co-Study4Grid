// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { SeverityIcon, type SeverityKind } from './SeverityIcon';

describe('SeverityIcon', () => {
    const kinds: SeverityKind[] = ['solves', 'lowMargin', 'unsolved', 'divergent', 'islanded'];

    it('renders an aria-hidden 16-viewBox svg for every severity kind', () => {
        for (const kind of kinds) {
            const { container } = render(<SeverityIcon kind={kind} />);
            const svg = container.querySelector('svg');
            expect(svg).not.toBeNull();
            expect(svg).toHaveAttribute('aria-hidden', 'true');
            expect(svg).toHaveAttribute('viewBox', '0 0 16 16');
        }
    });

    it('defaults to a 13px glyph and honours the size prop', () => {
        expect(render(<SeverityIcon kind="solves" />).container.querySelector('svg'))
            .toHaveAttribute('width', '13');
        const big = render(<SeverityIcon kind="solves" size={20} />).container.querySelector('svg');
        expect(big).toHaveAttribute('width', '20');
        expect(big).toHaveAttribute('height', '20');
    });

    it('draws the low-margin glyph as a circle, NOT a warning triangle', () => {
        // De-conflicted from the overloads warning sign — low margin is
        // a circle-with-exclamation, sharing the circle frame with the
        // solves / unsolved glyphs.
        const { container } = render(<SeverityIcon kind="lowMargin" />);
        expect(container.querySelector('circle')).not.toBeNull();
        const paths = Array.from(container.querySelectorAll('path')).map(p => p.getAttribute('d') ?? '');
        // The old triangle glyph drew an "M8 1.6 L15 13.5 L1 13.5 Z" path.
        expect(paths.some(d => d.includes('L15 13.5'))).toBe(false);
    });

    it('draws a check path for "solves" and an X for the unsolved family', () => {
        const solves = render(<SeverityIcon kind="solves" />).container;
        expect(Array.from(solves.querySelectorAll('path'))
            .some(p => (p.getAttribute('d') ?? '').includes('L7 10.5'))).toBe(true);
        const unsolved = render(<SeverityIcon kind="unsolved" />).container;
        expect(Array.from(unsolved.querySelectorAll('path'))
            .some(p => (p.getAttribute('d') ?? '').includes('M5 5 L11 11'))).toBe(true);
    });
});
