// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useMemo, useRef, useState } from 'react';
import { colors, radius, space, text } from '../styles/tokens';

interface AdditionalLinesPickerProps {
    branches: string[];
    /** Lines already detected as N-1 overloads — excluded from suggestions. */
    n1Overloads: string[];
    additionalLinesToCut: Set<string>;
    onToggle: (line: string) => void;
    /** Resolve an element ID to its human-readable display name. Falls back to the ID. */
    displayName?: (id: string) => string;
}

/**
 * Operator-controlled extra "lines to cut" tied to the recommender
 * analysis (ExpertAgent's `additionalLinesToCut`/`ltc` semantic).
 * Sits directly above the "Analyze & Suggest" button so the operator
 * configures the extra targets right where the analysis is launched.
 *
 * Lines selected here are simulated as disconnected during the
 * overflow analysis to prevent flow increase on them, but are NOT
 * rendered as overloads. Useful for highlighting alternate path
 * flows in double/triple-line corridors when only studying N-1.
 */
const AdditionalLinesPicker: React.FC<AdditionalLinesPickerProps> = ({
    branches,
    n1Overloads,
    additionalLinesToCut,
    onToggle,
    displayName = (id: string) => id,
}) => {
    const [query, setQuery] = useState('');
    const [focused, setFocused] = useState(false);
    const closeTimer = useRef<number | null>(null);

    const detectedSet = useMemo(() => new Set(n1Overloads), [n1Overloads]);
    const suggestions = useMemo(() => {
        const q = query.trim().toUpperCase();
        return branches
            .filter(b => !detectedSet.has(b) && !additionalLinesToCut.has(b))
            .filter(b => q === '' || b.toUpperCase().includes(q) || displayName(b).toUpperCase().includes(q))
            .slice(0, 50);
    }, [branches, detectedSet, additionalLinesToCut, query, displayName]);

    const commit = (line: string) => {
        if (!line) return;
        if (additionalLinesToCut.has(line)) return;
        if (detectedSet.has(line)) return;
        if (!branches.includes(line)) return;
        onToggle(line);
        setQuery('');
    };

    return (
        <div
            data-testid="additional-lines-picker"
            style={{
                marginBottom: space[1],
                padding: `${space[1]} 6px`,
                border: `1px solid ${colors.borderSubtle}`,
                borderRadius: radius.sm,
                background: colors.surface,
                fontSize: text.sm,
                lineHeight: '1.6',
            }}
        >
            <strong style={{ whiteSpace: 'nowrap', marginRight: space[1] }}>
                Additional lines to prevent flow increase:
            </strong>
            <span
                title="Extra lines the recommender in its overflow analysis will consider as ones to also prevent flow increase. This will simulate them disconnected in this analysis similarly to overloads. But they are not rendered as overloads. This can be of use to highlights other path flows in the case of double or triple lines for instance, if only studying N-1"
                style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: '14px',
                    height: '14px',
                    borderRadius: '50%',
                    background: colors.chromeSoft,
                    color: colors.textOnBrand,
                    fontSize: '10px',
                    cursor: 'help',
                    verticalAlign: 'middle',
                    marginRight: space[1],
                }}
            >
                ?
            </span>
            <span style={{ display: 'inline-flex', flexWrap: 'wrap', gap: '4px', verticalAlign: 'middle' }}>
                {Array.from(additionalLinesToCut).map(line => (
                    <span
                        key={line}
                        style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            background: colors.brandSoft,
                            color: colors.brand,
                            border: `1px solid ${colors.border}`,
                            borderRadius: radius.sm,
                            padding: `1px 6px`,
                            fontSize: text.xs,
                            fontWeight: 600,
                        }}
                    >
                        {displayName(line)}
                        <button
                            type="button"
                            onClick={() => onToggle(line)}
                            title={`Remove ${displayName(line)}`}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: colors.textSecondary,
                                padding: 0,
                                fontSize: text.xs,
                                lineHeight: 1,
                            }}
                        >
                            ×
                        </button>
                    </span>
                ))}
                <span style={{ position: 'relative', display: 'inline-block' }}>
                    <input
                        type="text"
                        value={query}
                        placeholder="Add line ID…"
                        onChange={e => setQuery(e.target.value)}
                        onFocus={() => {
                            if (closeTimer.current !== null) {
                                window.clearTimeout(closeTimer.current);
                                closeTimer.current = null;
                            }
                            setFocused(true);
                        }}
                        onBlur={() => {
                            closeTimer.current = window.setTimeout(() => {
                                setFocused(false);
                                closeTimer.current = null;
                            }, 120);
                        }}
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                const exact = suggestions.find(
                                    s => s.toUpperCase() === query.trim().toUpperCase(),
                                );
                                if (exact) commit(exact);
                                else if (suggestions.length === 1) commit(suggestions[0]);
                            } else if (e.key === 'Escape') {
                                setQuery('');
                            }
                        }}
                        style={{
                            fontSize: text.xs,
                            padding: '2px 6px',
                            border: `1px solid ${colors.border}`,
                            borderRadius: radius.sm,
                            minWidth: '140px',
                        }}
                    />
                    {focused && query.length > 0 && suggestions.length > 0 && (
                        <div
                            role="listbox"
                            style={{
                                position: 'absolute',
                                top: '100%',
                                left: 0,
                                zIndex: 20,
                                background: colors.surface,
                                border: `1px solid ${colors.border}`,
                                borderRadius: radius.sm,
                                boxShadow: '0 4px 10px rgba(0,0,0,0.1)',
                                maxHeight: '180px',
                                overflowY: 'auto',
                                minWidth: '180px',
                                marginTop: '2px',
                            }}
                        >
                            {suggestions.map(line => (
                                <div
                                    key={line}
                                    role="option"
                                    aria-selected={false}
                                    onMouseDown={e => {
                                        e.preventDefault();
                                        commit(line);
                                    }}
                                    style={{
                                        padding: '4px 8px',
                                        fontSize: text.xs,
                                        cursor: 'pointer',
                                        color: colors.textPrimary,
                                    }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.background = colors.surfaceMuted; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.background = 'transparent'; }}
                                >
                                    {displayName(line)}
                                </div>
                            ))}
                        </div>
                    )}
                </span>
            </span>
        </div>
    );
};

export default React.memo(AdditionalLinesPicker);
