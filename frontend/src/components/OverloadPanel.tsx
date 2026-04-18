// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import React from 'react';

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
    onAssetClick: (actionId: string, assetName: string, tab?: 'n' | 'n-1') => void;
    showMonitoringWarning?: boolean;
    monitoredLinesCount?: number;
    totalLinesCount?: number;
    monitoringFactor?: number;
    preExistingOverloadThreshold?: number;
    onDismissWarning?: () => void;
    onOpenSettings?: () => void;
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
    showMonitoringWarning,
    monitoredLinesCount,
    totalLinesCount,
    monitoringFactor,
    preExistingOverloadThreshold,
    onDismissWarning,
    onOpenSettings,
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
        color: '#1e40af',
        fontWeight: 600,
        textDecoration: 'underline dotted',
        textAlign: 'left',
        display: 'inline',
    };

    const formatRho = (v: number | undefined) =>
        v == null || Number.isNaN(v) ? null : `${(v * 100).toFixed(1)}%`;

    const renderLinks = (lines: string[], rhos: number[] | undefined, tab: 'n' | 'n-1') => {
        if (!lines || lines.length === 0) return <span style={{ color: '#888', fontStyle: 'italic' }}>None</span>;
        return lines.map((lineName, i) => {
            const isSelected = tab === 'n-1' ? (selectedOverloads?.has(lineName) ?? true) : true;
            const rhoPct = formatRho(rhos?.[i]);
            return (
                <React.Fragment key={i}>
                    {i > 0 && ', '}
                    <button
                        style={{
                            ...clickableLinkStyle,
                            color: isSelected ? '#1e40af' : '#bdc3c7',
                            fontWeight: isSelected ? 600 : 400,
                            textDecoration: isSelected ? 'underline dotted' : 'none'
                        }}
                        title={tab === 'n-1'
                            ? (isSelected ? `Zoom to ${lineName} (Double-click to unselect)` : `Zoom to ${lineName} (Double-click to select)`)
                            : `Zoom to ${lineName}`}
                        onClick={(e) => { e.stopPropagation(); onAssetClick('', lineName, tab); }}
                        onDoubleClick={(e) => {
                            if (tab === 'n-1') {
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
                                color: isSelected ? '#374151' : '#bdc3c7',
                                fontWeight: 500,
                                marginLeft: '2px',
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
    const deselectedCount = hasDeselected && selectedOverloads ? n1Overloads.filter(name => !selectedOverloads.has(name)).length : 0;

    return (
        <div style={{
            background: 'white',
            borderBottom: '1px solid #ccc',
            padding: '8px 12px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            zIndex: 10
        }}>
            <h3 style={{ margin: '0 0 6px 0', fontSize: '14px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#e74c3c' }}>⚠️</span> Overloads
            </h3>

            {showMonitoringWarning && totalLinesCount && totalLinesCount > 0 && (
                <div style={{
                    marginBottom: '8px',
                    padding: '8px 12px',
                    background: '#fff3cd',
                    border: '1px solid #ffeeba',
                    borderRadius: '4px',
                    color: '#856404',
                    fontSize: '0.8rem',
                    position: 'relative'
                }}>
                    ⚠️ <strong>{monitorDeselected ? (monitoredLinesCount || 0) : (monitoredLinesCount || 0) - (hasDeselected ? deselectedCount : 0)}</strong> out of <strong>{totalLinesCount}</strong> lines monitored ({totalLinesCount - (monitoredLinesCount || 0)} without permanent limits{hasDeselected && !monitorDeselected ? `, and ${deselectedCount} deselected` : ''}). Monitoring factor: {Math.round((monitoringFactor || 0.95) * 100)}%. {Math.round((preExistingOverloadThreshold || 0.02) * 100)}% loading increase threshold for considering worsened overload in N.
                    <button
                        onClick={onOpenSettings}
                        style={{ background: 'none', border: 'none', color: '#0056b3', textDecoration: 'underline', cursor: 'pointer', padding: '0 0 0 5px', fontSize: 'inherit' }}
                    >
                        Change in settings
                    </button>
                    {onDismissWarning && (
                        <button
                            onClick={onDismissWarning}
                            style={{ float: 'right', background: 'none', border: 'none', fontSize: '16px', lineHeight: 1, color: '#856404', cursor: 'pointer' }}
                            title="Dismiss"
                        >
                            &times;
                        </button>
                    )}
                </div>
            )}

            <div style={{ fontSize: '12px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '8px',
                    padding: '4px 6px',
                    background: nOverloads.length > 0 ? '#fff3cd' : 'transparent',
                    borderLeft: nOverloads.length > 0 ? '3px solid #ffc107' : '3px solid transparent',
                    borderBottom: '1px solid #eee'
                }}>
                    <strong style={{ whiteSpace: 'nowrap' }}>N Overloads:</strong>
                    <div style={{ display: 'inline', wordBreak: 'break-word' }}>
                        {renderLinks(nOverloads, nOverloadsRho, 'n')}
                    </div>
                </div>

                <div style={{
                    padding: '4px 6px',
                    background: n1Overloads.length > 0 ? '#f8d7da' : 'transparent',
                    borderLeft: n1Overloads.length > 0 ? '3px solid #dc3545' : '3px solid transparent',
                    borderBottom: '1px solid #eee',
                    lineHeight: '1.6',
                }}>
                    <strong style={{ whiteSpace: 'nowrap', marginRight: '4px' }}>N-1 Overloads:</strong>
                    <span 
                        title="Double-click on an overload name to toggle its inclusion in the analysis. Selected overloads are blue; unselected are light grey." 
                        style={{ 
                            display: 'inline-flex', 
                            alignItems: 'center', 
                            justifyContent: 'center', 
                            width: '14px', 
                            height: '14px', 
                            borderRadius: '50%', 
                            background: '#6c757d', 
                            color: 'white', 
                            fontSize: '10px', 
                            cursor: 'help',
                            verticalAlign: 'middle',
                            marginRight: '4px',
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
                                color: monitorDeselected ? '#0056b3' : '#6c757d',
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
                        {renderLinks(n1Overloads, n1OverloadsRho, 'n-1')}
                    </span>
                </div>
            </div>
        </div>
    );
};

export default React.memo(OverloadPanel);
