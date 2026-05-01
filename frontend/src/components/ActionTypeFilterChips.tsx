// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React from 'react';
import { ACTION_TYPE_FILTER_TOKENS, type ActionTypeFilterToken } from '../utils/actionTypes';
import { colors, text } from '../styles/tokens';

/**
 * Single-select action-type chip row shared by ExplorePairsTab,
 * ActionOverviewDiagram, and (via App.tsx state) ActionFeed.
 *
 * Matches the Explore-Pairs chip styling so the affordance feels
 * the same everywhere the operator uses it.
 */
interface ActionTypeFilterChipsProps {
    value: ActionTypeFilterToken;
    onChange: (next: ActionTypeFilterToken) => void;
    /**
     * Optional override for the chip set (defaults to the full
     * `ACTION_TYPE_FILTER_TOKENS` list). Used when a caller needs
     * to hide buckets that do not apply (e.g. a view with no
     * load-shedding actions at all).
     */
    tokens?: readonly ActionTypeFilterToken[];
    /** Test-id prefix so callers can isolate their own chip row. */
    testIdPrefix?: string;
    /** Optional inline style override for the container. */
    style?: React.CSSProperties;
}

const ActionTypeFilterChips: React.FC<ActionTypeFilterChipsProps> = ({
    value, onChange, tokens = ACTION_TYPE_FILTER_TOKENS, testIdPrefix = 'action-type-filter',
    style,
}) => (
    <div
        data-testid={testIdPrefix}
        style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', ...style }}
    >
        {tokens.map(t => {
            const active = value === t;
            return (
                <button
                    key={t}
                    type="button"
                    data-testid={`${testIdPrefix}-${t}`}
                    aria-pressed={active}
                    onClick={() => onChange(t)}
                    style={{
                        padding: '4px 12px',
                        borderRadius: '15px',
                        border: '1px solid',
                        borderColor: active ? colors.brand : colors.border,
                        background: active ? colors.brand : colors.surface,
                        color: active ? colors.textOnBrand : colors.textTertiary,
                        fontSize: text.xs,
                        cursor: 'pointer',
                        fontWeight: active ? 'bold' : 'normal',
                        transition: 'all 0.2s',
                    }}
                >
                    {t.toUpperCase()}
                </button>
            );
        })}
    </div>
);

export default ActionTypeFilterChips;
