// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React from 'react';

export type SeverityKind = 'solves' | 'lowMargin' | 'unsolved' | 'divergent' | 'islanded';

/**
 * Monochrome severity pictogram. It draws with `currentColor`, so the
 * same glyph works as a coloured chip (the ActionCard severity badge)
 * and as a tinted filter toggle (the ActionFilterRings severity ring)
 * — the caller owns the colour, the icon owns the shape.
 */
export const SeverityIcon: React.FC<{ kind: SeverityKind; size?: number }> = ({ kind, size = 13 }) => {
    const common = { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': true } as const;
    if (kind === 'solves') {
        return (
            <svg {...common}>
                <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.18" />
                <path d="M4.5 8.2 L7 10.5 L11.5 5.8" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        );
    }
    if (kind === 'lowMargin') {
        return (
            <svg {...common}>
                <path d="M8 1.6 L15 13.5 L1 13.5 Z" fill="currentColor" fillOpacity="0.18" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
                <path d="M8 6 L8 9.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
                <circle cx="8" cy="11.5" r="0.9" fill="currentColor" />
            </svg>
        );
    }
    // unsolved / divergent / islanded → X-circle
    return (
        <svg {...common}>
            <circle cx="8" cy="8" r="7" fill="currentColor" fillOpacity="0.18" />
            <path d="M5 5 L11 11 M11 5 L5 11" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
    );
};

export default SeverityIcon;
