// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React from 'react';
import { colors, space, text } from '../styles/tokens';

interface OverloadPanelProps {
    nOverloads: string[];
    n1Overloads: string[];
    /**
     * Per-line loading ratios (aligned with `nOverloads`).
     * Rendered as "(XX.X%)" after the line name.
     */
    nOverloadsRho?: number[];
    /**
     * Per-line loading ratios (aligned with `n1Overloads`).
     * Rendered as "(XX.X%)" after the line name.
     */
    n1OverloadsRho?: number[];
    /**
     * Clicking an overloaded line switches to the matching diagram
     * tab (N for N-overloads, N-1 for N-1-overloads) and zooms on
     * the element — mirroring the old "Loading Before" behavior on
     * action cards so the operator lands directly on the relevant
     * network state.
     */
    onAssetClick: (actionId: string, assetName: string, tab?: 'n' | 'contingency') => void;
    /**
     * Inline contextual hint shown beneath the heading. Replaces the
     * previous full yellow banner — the full notice now lives in
     * NoticesPanel (tier-warning-system PR). Pass a short string like "130/150 lines
     * monitored — see Notices for details" or leave undefined.
     */
    monitoringHint?: string | null;
    selectedOverloads?: Set<string>;
    onToggleOverload?: (overload: string) => void;
    monitorDeselected?: boolean;
    onToggleMonitorDeselected?: () => void;
    /** Resolve an element ID to its human-readable display name. Falls back to the ID. */
    displayName?: (id: string) => string;
}

const OverloadPanel: React.FC<OverloadPanelProps> = ({
    nOverloads,
    n1Overloads,
    nOverloadsRho,
    n1OverloadsRho,
    onAssetClick,
    monitoringHint,
    selectedOverloads,
    onToggleOverload,
    monitorDeselected = false,
    onToggleMonitorDeselected,
    displayName = (id: string) => id,
}) => {
    const clickableLinkStyle: React.CSSProperties = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        fontSize: 'inherit',
        color: colors.brand,
        fontWeight: 600,
        textDecoration: 'underline dotted',
        textAlign: 'left',
        display: 'inline',
    };

    const formatRho = (v: number | undefined) =>
        v == null || Number.isNaN(v) ? null : `${(v * 100).toFixed(1)}%`;

    const renderLinks = (lines: string[], rhos: number[] | undefined, tab: 'n' | 'contingency') => {
        if (!lines || lines.length === 0) return <span style={{ color: colors.textTertiary, fontStyle: 'italic' }}>None</span>;
        return lines.map((lineName, i) => {
            const isSelected = tab === 'contingency' ? (selectedOverloads?.has(lineName) ?? true) : true;
            const rhoPct = formatRho(rhos?.[i]);
            return (
                <React.Fragment key={i}>
                    {i > 0 && ', '}
                    <button
                        style={{
                            ...clickableLinkStyle,
                            color: isSelected ? colors.brand : colors.borderStrong,
                            fontWeight: isSelected ? 600 : 400,
                            textDecoration: isSelected ? 'underline dotted' : 'none'
                        }}
                        title={tab === 'contingency'
                            ? (isSelected ? `Zoom to ${lineName} (Double-click to unselect)` : `Zoom to ${lineName} (Double-click to select)`)
                            : `Zoom to ${lineName}`}
                        onClick={(e) => { e.stopPropagation(); onAssetClick('', lineName, tab); }}
                        onDoubleClick={(e) => {
                            if (tab === 'contingency') {
                                e.stopPropagation();
                                onToggleOverload?.(lineName);
                            }
                        }}
                    >
                        {displayName(lineName)}
                    </button>
                    {rhoPct && (
                        <span
                            style={{
                                color: isSelected ? colors.textPrimary : colors.borderStrong,
                                fontWeight: 500,
                                marginLeft: space.half,
                            }}
                        >
                            ({rhoPct})
                        </span>
                    )}
                </React.Fragment>
            );
        });
    };

    const hasDeselected = n1Overloads.some(name => !(selectedOverloads?.has(name) ?? true));

    return (
        <div style={{
            background: colors.surface,
            borderBottom: `1px solid ${colors.border}`,
            padding: `${space[2]} ${space[3]}`,
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            zIndex: 10
        }}>
            <h3 style={{ margin: `0 0 6px 0`, fontSize: text.md, display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: colors.danger }}>⚠️</span> Overloads
            </h3>

            {monitoringHint && (
                <div
                    data-testid="overload-monitoring-hint"
                    style={{
                        marginBottom: space[1],
                        fontSize: text.xs,
                        color: colors.textTertiary,
                        fontStyle: 'italic',
                    }}
                >
                    {monitoringHint}
                </div>
            )}

            <div style={{ fontSize: text.sm, display: 'flex', flexDirection: 'column', gap: space[1] }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: space[2],
                    padding: `${space[1]} 6px`,
                    background: nOverloads.length > 0 ? colors.warningSoft : 'transparent',
                    borderLeft: `3px solid ${nOverloads.length > 0 ? 'var(--color-warning)' : 'transparent'}`,
                    borderBottom: `1px solid ${colors.borderSubtle}`
                }}>
                    <strong style={{ whiteSpace: 'nowrap' }}>N Overloads:</strong>
                    <div style={{ display: 'inline', wordBreak: 'break-word' }}>
                        {renderLinks(nOverloads, nOverloadsRho, 'n')}
                    </div>
                </div>

                <div style={{
                    padding: `${space[1]} 6px`,
                    background: n1Overloads.length > 0 ? colors.dangerSoft : 'transparent',
                    borderLeft: `3px solid ${n1Overloads.length > 0 ? 'var(--color-danger)' : 'transparent'}`,
                    borderBottom: `1px solid ${colors.borderSubtle}`,
                    lineHeight: '1.6',
                }}>
                    <strong style={{ whiteSpace: 'nowrap', marginRight: space[1] }}>N-1 Overloads:</strong>
                    <span
                        title="Double-click on an overload name to toggle its inclusion in the analysis. Selected overloads are blue; unselected are light grey."
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
                    {hasDeselected && onToggleMonitorDeselected && (
                        <label
                            style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '3px',
                                cursor: 'pointer',
                                fontSize: '10px',
                                color: monitorDeselected ? colors.brandStrong : colors.chromeSoft,
                                fontWeight: monitorDeselected ? 600 : 400,
                                whiteSpace: 'nowrap',
                                marginRight: '6px',
                                verticalAlign: 'middle',
                            }}
                            title="When checked, deselected overloads are still included in the analysis monitoring scope"
                        >
                            <input
                                type="checkbox"
                                checked={monitorDeselected}
                                onChange={onToggleMonitorDeselected}
                                style={{ margin: 0, cursor: 'pointer', width: '11px', height: '11px' }}
                                onClick={(e) => e.stopPropagation()}
                            />
                            monitor deselected
                        </label>
                    )}
                    <span style={{ wordBreak: 'break-word' }}>
                        {renderLinks(n1Overloads, n1OverloadsRho, 'contingency')}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default React.memo(OverloadPanel);
