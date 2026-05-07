// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useMemo, useRef, useState } from 'react';
import { colors, space, text, radius } from '../styles/tokens';

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
    /**
     * Catalogue of disconnectable elements used to populate the
     * "additional lines to cut" autocomplete. Lines / transformers
     * already detected as N-1 overloads are filtered out at render
     * time so the operator only picks new ones.
     */
    branches?: string[];
    /**
     * Extra lines the operator wants the recommender to treat as
     * "lines to cut" beyond the detected overloads — ExpertAgent's
     * `additionalLinesToCut` semantic. They are not actually
     * overloaded, but resolving actions will also relieve flow on
     * them. Pass undefined to hide the input row.
     */
    additionalLinesToCut?: Set<string>;
    onToggleAdditionalLineToCut?: (line: string) => void;
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
    branches,
    additionalLinesToCut,
    onToggleAdditionalLineToCut,
}) => {
    const [extraQuery, setExtraQuery] = useState('');
    const [extraFocused, setExtraFocused] = useState(false);
    const extraCloseTimer = useRef<number | null>(null);

    const showAdditionalRow = branches !== undefined
        && additionalLinesToCut !== undefined
        && onToggleAdditionalLineToCut !== undefined;

    const detectedSet = useMemo(() => new Set(n1Overloads), [n1Overloads]);
    const extraSuggestions = useMemo(() => {
        if (!showAdditionalRow || !branches) return [];
        const q = extraQuery.trim().toUpperCase();
        const picked = additionalLinesToCut!;
        return branches
            .filter(b => !detectedSet.has(b) && !picked.has(b))
            .filter(b => q === '' || b.toUpperCase().includes(q) || displayName(b).toUpperCase().includes(q))
            .slice(0, 50);
    }, [branches, detectedSet, additionalLinesToCut, extraQuery, displayName, showAdditionalRow]);

    const commitExtraLine = (line: string) => {
        if (!line || !onToggleAdditionalLineToCut) return;
        if (additionalLinesToCut?.has(line)) return;
        if (detectedSet.has(line)) return;
        if (branches && !branches.includes(line)) return;
        onToggleAdditionalLineToCut(line);
        setExtraQuery('');
    };

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

                {showAdditionalRow && (
                    <div
                        data-testid="additional-lines-to-cut-row"
                        style={{
                            padding: `${space[1]} 6px`,
                            borderLeft: `3px solid ${colors.borderSubtle}`,
                            borderBottom: `1px solid ${colors.borderSubtle}`,
                            lineHeight: '1.6',
                        }}
                    >
                        <strong style={{ whiteSpace: 'nowrap', marginRight: space[1] }}>
                            Additional lines to cut:
                        </strong>
                        <span
                            title="Extra lines the recommender will treat as 'lines to cut' on top of the detected overloads (ExpertAgent's additionalLinesToCut). They are not currently overloaded but resolving actions will also relieve flow on them."
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
                            {Array.from(additionalLinesToCut!).map(line => (
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
                                        onClick={() => onToggleAdditionalLineToCut!(line)}
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
                                    value={extraQuery}
                                    placeholder="Add line ID…"
                                    onChange={e => setExtraQuery(e.target.value)}
                                    onFocus={() => {
                                        if (extraCloseTimer.current !== null) {
                                            window.clearTimeout(extraCloseTimer.current);
                                            extraCloseTimer.current = null;
                                        }
                                        setExtraFocused(true);
                                    }}
                                    onBlur={() => {
                                        extraCloseTimer.current = window.setTimeout(() => {
                                            setExtraFocused(false);
                                            extraCloseTimer.current = null;
                                        }, 120);
                                    }}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') {
                                            e.preventDefault();
                                            const exact = extraSuggestions.find(
                                                s => s.toUpperCase() === extraQuery.trim().toUpperCase(),
                                            );
                                            if (exact) commitExtraLine(exact);
                                            else if (extraSuggestions.length === 1) commitExtraLine(extraSuggestions[0]);
                                        } else if (e.key === 'Escape') {
                                            setExtraQuery('');
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
                                {extraFocused && extraQuery.length > 0 && extraSuggestions.length > 0 && (
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
                                        {extraSuggestions.map(line => (
                                            <div
                                                key={line}
                                                role="option"
                                                aria-selected={false}
                                                onMouseDown={e => {
                                                    e.preventDefault();
                                                    commitExtraLine(line);
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
                )}
            </div>
        </div>
    );
};

export default React.memo(OverloadPanel);
