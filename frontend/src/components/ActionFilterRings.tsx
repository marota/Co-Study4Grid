// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useCallback } from 'react';
import type { ActionOverviewFilters, ActionSeverityCategory } from '../types';
import { interactionLogger } from '../utils/interactionLogger';
import { colors, pinColorVars, space } from '../styles/tokens';
import { ACTION_TYPE_LABELS, type ActionTypeKind } from '../utils/actionTypes';
import { SeverityIcon, type SeverityKind } from './SeverityIcon';
import { ActionTypeIcon } from './ActionTypeIcon';

/**
 * Two compact icon "rings" for the sidebar's persistent strip:
 *
 *  - the SEVERITY ring — colour-coded pictograms (one per outcome
 *    bucket: solved / low-margin / still-overloaded / divergent).
 *    Multi-select toggles, each flipping `filters.categories[cat]`.
 *  - the ACTION-TYPE ring — uncoloured pictograms (disco / reco /
 *    open / close / ls / rc / pst). Single-select; re-clicking the
 *    active one clears back to `all`.
 *
 * Both drive the SAME shared `ActionOverviewFilters` object the
 * Remedial-Action overview header already owns, so the sidebar feed
 * and the overview diagram stay in lock-step. The pictogram-only
 * styling keeps the whole control to two short rows so it can live
 * alongside the contingency / overloads lines without crowding the
 * action-id titles.
 */

const SEVERITY_RING: ReadonlyArray<{ cat: ActionSeverityCategory; kind: SeverityKind; label: string }> = [
    { cat: 'green', kind: 'solves', label: 'Solves overload' },
    { cat: 'orange', kind: 'lowMargin', label: 'Low margin' },
    { cat: 'red', kind: 'unsolved', label: 'Still overloaded' },
    { cat: 'grey', kind: 'divergent', label: 'Divergent / islanded' },
];

const TYPE_RING: ReadonlyArray<ActionTypeKind> = ['disco', 'reco', 'open', 'close', 'ls', 'rc', 'pst'];

const TOGGLE_SIZE = 22;

const toggleBase: React.CSSProperties = {
    width: TOGGLE_SIZE,
    height: TOGGLE_SIZE,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 0,
    borderRadius: '50%',
    cursor: 'pointer',
    flexShrink: 0,
    lineHeight: 0,
    transition: 'all 0.15s ease',
};

interface ActionFilterRingsProps {
    filters: ActionOverviewFilters;
    onFiltersChange: (next: ActionOverviewFilters) => void;
}

const ActionFilterRings: React.FC<ActionFilterRingsProps> = ({ filters, onFiltersChange }) => {
    const toggleCategory = useCallback((cat: ActionSeverityCategory) => {
        const enabled = !filters.categories[cat];
        interactionLogger.record('overview_filter_changed', { kind: 'category', category: cat, enabled });
        onFiltersChange({
            ...filters,
            categories: { ...filters.categories, [cat]: enabled },
        });
    }, [filters, onFiltersChange]);

    const selectType = useCallback((token: ActionTypeKind) => {
        // Single-select with toggle-off: re-clicking the active type
        // clears back to `all` so the operator always has an obvious
        // "show everything" gesture without a dedicated ALL chip.
        const next = filters.actionType === token ? 'all' : token;
        interactionLogger.record('overview_filter_changed', { kind: 'action_type', action_type: next });
        onFiltersChange({ ...filters, actionType: next });
    }, [filters, onFiltersChange]);

    return (
        <div
            data-testid="sidebar-action-filters"
            style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: space[1] }}
        >
            <span style={{ color: colors.textSecondary, fontWeight: 600, whiteSpace: 'nowrap' }}>
                Filter:
            </span>
            <div role="group" aria-label="Filter actions by outcome" style={{ display: 'flex', gap: space.half }}>
                {SEVERITY_RING.map(({ cat, kind, label }) => {
                    const enabled = filters.categories[cat];
                    const tint = pinColorVars[cat];
                    return (
                        <button
                            key={cat}
                            type="button"
                            data-testid={`sidebar-filter-category-${cat}`}
                            aria-pressed={enabled}
                            title={enabled ? `Hide: ${label}` : `Show: ${label}`}
                            onClick={() => toggleCategory(cat)}
                            style={{
                                ...toggleBase,
                                border: `1.5px solid ${enabled ? tint : colors.border}`,
                                background: enabled ? colors.surface : colors.surfaceMuted,
                                color: enabled ? tint : colors.textTertiary,
                                opacity: enabled ? 1 : 0.55,
                            }}
                        >
                            <SeverityIcon kind={kind} size={13} />
                        </button>
                    );
                })}
            </div>
            <span aria-hidden style={{ width: 1, height: 16, background: colors.border, flexShrink: 0 }} />
            <div role="group" aria-label="Filter actions by type" style={{ display: 'flex', gap: space.half }}>
                {TYPE_RING.map((token) => {
                    const active = filters.actionType === token;
                    const label = ACTION_TYPE_LABELS[token];
                    return (
                        <button
                            key={token}
                            type="button"
                            data-testid={`sidebar-filter-type-${token}`}
                            aria-pressed={active}
                            title={active ? `${label} (click to clear)` : `Show only: ${label}`}
                            onClick={() => selectType(token)}
                            style={{
                                ...toggleBase,
                                border: `1.5px solid ${active ? colors.brand : colors.border}`,
                                background: active ? colors.brandSoft : colors.surface,
                                color: active ? colors.brand : colors.textTertiary,
                            }}
                        >
                            <ActionTypeIcon kind={token} size={13} />
                        </button>
                    );
                })}
            </div>
        </div>
    );
};

export default React.memo(ActionFilterRings);
