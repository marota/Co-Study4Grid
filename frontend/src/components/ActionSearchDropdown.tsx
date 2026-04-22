// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { type RefObject } from 'react';
import type { ActionDetail, ActionTypeFilterToken, AvailableAction } from '../types';
import ActionTypeFilterChips from './ActionTypeFilterChips';

export interface ScoredActionItem {
    type: string;
    actionId: string;
    score: number;
    mwStart: number | null;
}

interface ActionSearchDropdownProps {
    dropdownRef: RefObject<HTMLDivElement | null>;
    searchInputRef: RefObject<HTMLInputElement | null>;
    searchQuery: string;
    onSearchQueryChange: (query: string) => void;
    actionTypeFilter: ActionTypeFilterToken;
    onActionTypeFilterChange: (token: ActionTypeFilterToken) => void;
    error: string | null;
    loadingActions: boolean;
    scoredActionsList: ScoredActionItem[];
    filteredActions: AvailableAction[];
    actionScores: Record<string, Record<string, unknown>> | undefined;
    actions: Record<string, ActionDetail>;
    cardEditMw: Record<string, string>;
    onCardEditMwChange: (actionId: string, value: string) => void;
    cardEditTap: Record<string, string>;
    onCardEditTapChange: (actionId: string, value: string) => void;
    simulating: string | null;
    resimulating: string | null;
    onAddAction: (actionId: string, targetMw?: number, targetTap?: number) => void;
    onResimulate: (actionId: string, newMw: number) => void;
    onResimulateTap: (actionId: string, newTap: number) => void;
    onShowTooltip: (e: React.MouseEvent, content: React.ReactNode) => void;
    onHideTooltip: () => void;
}

const ActionSearchDropdown: React.FC<ActionSearchDropdownProps> = ({
    dropdownRef,
    searchInputRef,
    searchQuery,
    onSearchQueryChange,
    actionTypeFilter,
    onActionTypeFilterChange,
    error,
    loadingActions,
    scoredActionsList,
    filteredActions,
    actionScores,
    actions,
    cardEditMw,
    onCardEditMwChange,
    cardEditTap,
    onCardEditTapChange,
    simulating,
    resimulating,
    onAddAction,
    onResimulate,
    onResimulateTap,
    onShowTooltip,
    onHideTooltip,
}) => {
    return (
        <div
            ref={dropdownRef}
            style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                left: 0,
                zIndex: 100,
                backgroundColor: 'white',
                border: '1px solid #ccc',
                borderRadius: '8px',
                boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                marginTop: '4px',
                overflow: 'hidden',
            }}
        >
            <div style={{ padding: '8px' }}>
                <input
                    ref={searchInputRef}
                    type="text"
                    placeholder="Search action by ID or description..."
                    value={searchQuery}
                    onChange={(e) => onSearchQueryChange(e.target.value)}
                    style={{
                        width: '100%',
                        padding: '6px 10px',
                        border: '1px solid #ccc',
                        borderRadius: '4px',
                        fontSize: '13px',
                        boxSizing: 'border-box',
                    }}
                />
            </div>
            <div style={{ padding: '4px 8px', borderTop: '1px solid #eee' }}>
                <ActionTypeFilterChips
                    testIdPrefix="search-dropdown-filter"
                    value={actionTypeFilter}
                    onChange={onActionTypeFilterChange}
                />
            </div>
            {error && (
                <div style={{
                    padding: '6px 8px',
                    fontSize: '12px',
                    color: '#dc3545',
                    borderTop: '1px solid #eee',
                }}>
                    {error}
                </div>
            )}
            <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                {loadingActions ? (
                    <div style={{ padding: '10px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
                        Loading actions...
                    </div>
                ) : (
                    <>
                        {/* Action Scores Table */}
                        {scoredActionsList.length > 0 && !searchQuery && (
                            <ScoreTable
                                scoredActionsList={scoredActionsList}
                                actionScores={actionScores}
                                actions={actions}
                                cardEditMw={cardEditMw}
                                onCardEditMwChange={onCardEditMwChange}
                                cardEditTap={cardEditTap}
                                onCardEditTapChange={onCardEditTapChange}
                                simulating={simulating}
                                resimulating={resimulating}
                                onAddAction={onAddAction}
                                onResimulate={onResimulate}
                                onResimulateTap={onResimulateTap}
                                onShowTooltip={onShowTooltip}
                                onHideTooltip={onHideTooltip}
                            />
                        )}

                        {/* No-relevant-action warning: analysis ran
                            (actionScores present) but the selected type
                            filter yields zero scored actions, so we fall
                            back to the full network action list below.
                            The banner tells the operator that nothing from
                            the analysis recommends actions of this type. */}
                        {!searchQuery
                            && scoredActionsList.length === 0
                            && actionTypeFilter !== 'all'
                            && !!actionScores
                            && Object.values(actionScores).some(d =>
                                d && typeof d === 'object'
                                && Object.keys((d as { scores?: Record<string, number> }).scores ?? {}).length > 0
                            ) && (
                            <div
                                data-testid="no-relevant-action-warning"
                                style={{
                                    margin: '6px 8px',
                                    padding: '6px 8px',
                                    background: '#fff3cd',
                                    border: '1px solid #ffeeba',
                                    borderRadius: 4,
                                    color: '#856404',
                                    fontSize: 12,
                                    lineHeight: 1.35,
                                }}
                            >
                                ⚠️ Warning: no relevant action detected with regards to overflow analysis
                            </div>
                        )}

                        {/* Search Results */}
                        {(!searchQuery && scoredActionsList.length === 0 && filteredActions.length === 0) && (
                            <div style={{ padding: '10px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
                                All actions already added
                            </div>
                        )}
                        {searchQuery && !filteredActions.some(a => a.id === searchQuery) && (
                            <div
                                data-testid={`manual-id-option-${searchQuery}`}
                                onClick={() => onAddAction(searchQuery)}
                                style={{
                                    padding: '8px 10px',
                                    cursor: simulating ? 'wait' : 'pointer',
                                    borderTop: '1px solid #eee',
                                    backgroundColor: '#f8f9fa',
                                    color: '#007bff',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                }}
                                onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).style.backgroundColor = '#eef6ff'}
                                onMouseLeave={(e) => (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f8f9fa'}
                            >
                                ✨ Simulate manual ID: <strong>{searchQuery}</strong>
                            </div>
                        )}
                        {(searchQuery && filteredActions.length === 0 && searchQuery !== (filteredActions[0]?.id)) && (
                            <div style={{ padding: '10px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
                                No other matching actions
                            </div>
                        )}
                        {((!searchQuery && scoredActionsList.length === 0) || searchQuery) && filteredActions.map(a => (
                            <div
                                key={a.id}
                                data-testid={`action-card-${a.id}`}
                                onClick={() => onAddAction(a.id)}
                                style={{
                                    padding: '6px 10px',
                                    cursor: simulating ? 'wait' : 'pointer',
                                    borderTop: '1px solid #eee',
                                    backgroundColor: simulating === a.id ? '#e7f1ff' : 'transparent',
                                    opacity: simulating && simulating !== a.id ? 0.5 : 1,
                                }}
                                onMouseEnter={(e) => { if (!simulating) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f0f0f0'; }}
                                onMouseLeave={(e) => { if (simulating !== a.id) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
                            >
                                <div style={{ fontWeight: 600, fontSize: '12px', color: '#333' }}>
                                    {simulating === a.id ? 'Simulating...' : a.id}
                                </div>
                                {a.description && (
                                    <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>
                                        {a.description}
                                    </div>
                                )}
                            </div>
                        ))}
                    </>
                )}
            </div>
        </div>
    );
};

// --- ScoreTable subcomponent ---

interface ScoreTableProps {
    scoredActionsList: ScoredActionItem[];
    actionScores: Record<string, Record<string, unknown>> | undefined;
    actions: Record<string, ActionDetail>;
    cardEditMw: Record<string, string>;
    onCardEditMwChange: (actionId: string, value: string) => void;
    cardEditTap: Record<string, string>;
    onCardEditTapChange: (actionId: string, value: string) => void;
    simulating: string | null;
    resimulating: string | null;
    onAddAction: (actionId: string, targetMw?: number, targetTap?: number) => void;
    onResimulate: (actionId: string, newMw: number) => void;
    onResimulateTap: (actionId: string, newTap: number) => void;
    onShowTooltip: (e: React.MouseEvent, content: React.ReactNode) => void;
    onHideTooltip: () => void;
}

const ScoreTable: React.FC<ScoreTableProps> = ({
    scoredActionsList,
    actionScores,
    actions,
    cardEditMw,
    onCardEditMwChange,
    cardEditTap,
    onCardEditTapChange,
    simulating,
    resimulating,
    onAddAction,
    onResimulate,
    onResimulateTap,
    onShowTooltip,
    onHideTooltip,
}) => {
    return (
        <div style={{ padding: '0 8px', marginBottom: '8px' }}>
            <div style={{ fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                Scored Actions
            </div>
            {Array.from(new Set(scoredActionsList.map(item => item.type))).map(type => {
                const typeData = (actionScores?.[type] || {}) as {
                    scores?: Record<string, number>;
                    params?: Record<string, Record<string, unknown>>;
                    non_convergence?: Record<string, string | null>;
                };
                const scoresKeys = Object.keys(typeData.scores || {});
                const paramsKeys = Object.keys(typeData.params || {});
                const isPerActionParams = paramsKeys.length > 0 && paramsKeys.some((k: string) => scoresKeys.includes(k));
                const globalParams = isPerActionParams ? null : (paramsKeys.length > 0 ? typeData.params : null);

                const isLsOrRcType = type === 'load_shedding' || type.includes('load_shedding') || type === 'renewable_curtailment' || type.includes('renewable_curtailment');
                const isPstType = type === 'pst_tap_change' || type.includes('pst');
                const hasEditableColumn = isLsOrRcType || isPstType;
                const tapStartMap = isPstType ? (typeData as { tap_start?: Record<string, { pst_name: string; tap: number; low_tap: number | null; high_tap: number | null } | null> }).tap_start : undefined;
                return (
                    <div key={type} style={{ marginBottom: '8px' }}>
                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#0056b3', backgroundColor: '#e9ecef', padding: '2px 6px', borderRadius: '4px 4px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>{type.replace('_', ' ').toUpperCase()}</span>
                            {globalParams && (
                                <span
                                    style={{ color: '#6c757d', fontSize: '12px', cursor: 'help', marginLeft: '6px' }}
                                    onMouseEnter={(e) => onShowTooltip(e, (
                                        <>
                                            <div style={{ fontWeight: 700, marginBottom: '2px', borderBottom: '1px solid #555', paddingBottom: '2px' }}>Scoring Parameters</div>
                                            {Object.entries(globalParams).map(([k, v]) => (
                                                <div key={k}>
                                                    <span style={{ color: '#adb5bd' }}>{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                                </div>
                                            ))}
                                        </>
                                    ))}
                                    onMouseLeave={onHideTooltip}
                                >i</span>
                            )}
                        </div>
                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', border: '1px solid #e9ecef', borderTop: 'none' }}>
                            <thead>
                                <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #ddd' }}>
                                    <th style={{ textAlign: 'left', padding: '4px 6px', width: hasEditableColumn ? '40%' : '55%' }}>Action</th>
                                    <th style={{ textAlign: 'right', padding: '4px 6px', width: '15%' }}>{isPstType ? 'Tap Start' : 'MW Start'}</th>
                                    {isLsOrRcType && <th style={{ textAlign: 'right', padding: '4px 6px', width: '20%' }}>Target MW</th>}
                                    {isPstType && <th style={{ textAlign: 'right', padding: '4px 6px', width: '20%' }}>Target Tap</th>}
                                    <th style={{ textAlign: 'right', padding: '4px 6px', width: hasEditableColumn ? '15%' : '25%' }}>Score</th>
                                </tr>
                            </thead>
                            <tbody>
                                {scoredActionsList.filter(item => item.type === type).map(item => {
                                    const isComputed = !!actions[item.actionId];
                                    // Stored MW from an already-simulated LS/RC action (used as default input value).
                                    const storedMw = isLsOrRcType && isComputed
                                        ? (actions[item.actionId]?.load_shedding_details?.[0]?.shedded_mw
                                            ?? actions[item.actionId]?.curtailment_details?.[0]?.curtailed_mw
                                            ?? null)
                                        : null;
                                    // Displayed value: user edit takes precedence, otherwise the stored simulated MW.
                                    const mwEditVal = cardEditMw[item.actionId];
                                    const effectiveMwStr = mwEditVal
                                        ?? (storedMw != null ? storedMw.toFixed(1) : '');
                                    const parsedTarget = effectiveMwStr !== '' ? parseFloat(effectiveMwStr) : null;
                                    const isValidTarget = parsedTarget !== null && !isNaN(parsedTarget) && parsedTarget >= 0 && (item.mwStart == null || parsedTarget <= item.mwStart);
                                    // Only re-simulate if the user has actually edited the value and it differs from the stored one.
                                    const userEditedMw = mwEditVal !== undefined && (storedMw == null || parseFloat(mwEditVal) !== storedMw);
                                    const canResimulate = isLsOrRcType && isComputed && isValidTarget && userEditedMw;
                                    const actionParams = isPstType ? typeData.params?.[item.actionId] : undefined;
                                    const previousTap = actionParams
                                        ? (actionParams['previous tap'] ?? actionParams['previous_tap'] ?? actionParams['previousTap'] ??
                                           Object.entries(actionParams).find(([k]) => k.toLowerCase().includes('previous') && k.toLowerCase().includes('tap'))?.[1]
                                          ) as number | undefined
                                        : undefined;
                                    const tapStartEntry = isPstType ? tapStartMap?.[item.actionId] ?? null : undefined;
                                    const computedPst = isPstType ? actions[item.actionId]?.pst_details?.[0] : undefined;
                                    const tapInfo = isPstType
                                        ? (previousTap !== undefined
                                            ? {
                                                pst_name: tapStartEntry?.pst_name ?? computedPst?.pst_name ?? '',
                                                tap: previousTap,
                                                low_tap: tapStartEntry?.low_tap ?? computedPst?.low_tap ?? null,
                                                high_tap: tapStartEntry?.high_tap ?? computedPst?.high_tap ?? null,
                                            }
                                            : tapStartEntry
                                                ? tapStartEntry
                                                : computedPst
                                                    ? { pst_name: computedPst.pst_name, tap: computedPst.tap_position, low_tap: computedPst.low_tap, high_tap: computedPst.high_tap }
                                                    : null)
                                        : undefined;
                                    const tapEditVal = cardEditTap[item.actionId];
                                    const simulatedTap = computedPst ? String(computedPst.tap_position) : undefined;
                                    const defaultTap = simulatedTap ?? (tapInfo ? String(tapInfo.tap) : undefined);
                                    const effectiveTap = tapEditVal ?? defaultTap;
                                    const parsedTap = effectiveTap !== undefined ? parseInt(effectiveTap, 10) : null;
                                    const isValidTap = parsedTap !== null && !isNaN(parsedTap) && (tapInfo?.low_tap == null || parsedTap >= tapInfo.low_tap) && (tapInfo?.high_tap == null || parsedTap <= tapInfo.high_tap);
                                    const canResimTap = isPstType && isComputed && isValidTap;
                                    return (
                                        <tr key={item.actionId}
                                            onClick={() => {
                                                if (simulating || resimulating) return;
                                                if (canResimulate) {
                                                    onResimulate(item.actionId, parsedTarget!);
                                                    return;
                                                }
                                                if (canResimTap) {
                                                    onResimulateTap(item.actionId, parsedTap!);
                                                    return;
                                                }
                                                if (isComputed) return;
                                                const mw = isLsOrRcType && isValidTarget ? parsedTarget! : undefined;
                                                const tap = isPstType && isValidTap ? parsedTap! : undefined;
                                                onAddAction(item.actionId, mw, tap);
                                            }}
                                            style={{
                                                borderBottom: '1px solid #eee',
                                                cursor: (simulating || resimulating) ? 'wait' : (isComputed && !canResimulate && !canResimTap) ? 'not-allowed' : 'pointer',
                                                color: (isComputed && !canResimulate && !canResimTap) ? '#888' : 'inherit',
                                                opacity: (simulating === item.actionId || resimulating === item.actionId) ? 0.7 : 1,
                                                background: (simulating === item.actionId || resimulating === item.actionId) ? '#e7f1ff' : 'transparent',
                                            }}>
                                            <td style={{ padding: '4px 6px', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                                                {item.actionId}
                                                {isComputed && (
                                                    actions[item.actionId]?.non_convergence ? (
                                                        <span data-testid={`badge-divergent-${item.actionId}`} style={{ marginLeft: '4px', background: '#dc3545', color: '#fff', padding: '2px 4px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' }} title={actions[item.actionId].non_convergence || undefined}>divergent</span>
                                                    ) : actions[item.actionId]?.is_islanded ? (
                                                        <span data-testid={`badge-islanded-${item.actionId}`} style={{ marginLeft: '4px', background: '#dc3545', color: '#fff', padding: '2px 4px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' }} title={`Islanding detected: ${actions[item.actionId].disconnected_mw?.toFixed(1)} MW disconnected`}>islanded</span>
                                                    ) : (
                                                        <span data-testid={`badge-computed-${item.actionId}`} style={{ marginLeft: '4px', background: '#28a745', color: '#fff', padding: '2px 4px', borderRadius: '4px', fontSize: '9px', opacity: 0.8 }}>computed</span>
                                                    )
                                                )}
                                                {isPerActionParams && typeData.params?.[item.actionId] && (
                                                    <span
                                                        style={{ color: '#6c757d', fontSize: '12px', cursor: 'help', marginLeft: '6px' }}
                                                        onClick={(e) => e.stopPropagation()}
                                                        onMouseEnter={(e) => onShowTooltip(e, (
                                                            <>
                                                                <div style={{ fontWeight: 700, marginBottom: '2px', borderBottom: '1px solid #555', paddingBottom: '2px' }}>Parameters</div>
                                                                {typeData.non_convergence?.[item.actionId] && (
                                                                    <div style={{ fontSize: '10px', color: '#dc3545' }}>
                                                                        Non-convergence: {typeData.non_convergence[item.actionId]}
                                                                    </div>
                                                                )}
                                                                {(actions[item.actionId]?.is_islanded) && (
                                                                    <div style={{ fontSize: '10px', color: '#c2410c' }}>
                                                                        Islanding: {actions[item.actionId].n_components} components
                                                                    </div>
                                                                )}
                                                                {Object.entries(typeData.params![item.actionId]).map(([k, v]) => {
                                                                    const isTargetTapKey = isPstType && (k === 'selected_pst_tap' || k.toLowerCase().includes('target') && k.toLowerCase().includes('tap'));
                                                                    const displayVal = isTargetTapKey && effectiveTap !== undefined ? effectiveTap : (typeof v === 'object' ? JSON.stringify(v) : String(v));
                                                                    return (
                                                                        <div key={k}>
                                                                            <span style={{ color: '#adb5bd' }}>{k}:</span> {displayVal}
                                                                        </div>
                                                                    );
                                                                })}
                                                            </>
                                                        ))}
                                                        onMouseLeave={onHideTooltip}
                                                    >i</span>
                                                )}
                                            </td>
                                            <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', color: (isPstType ? tapInfo == null : item.mwStart == null) ? '#aaa' : '#333' }}>
                                                {isPstType
                                                    ? (tapInfo != null ? `${tapInfo.tap}` : 'N/A')
                                                    : (item.mwStart != null ? item.mwStart.toFixed(1) : 'N/A')
                                                }
                                                {isPstType && tapInfo?.low_tap != null && tapInfo?.high_tap != null && (
                                                    <span style={{ fontSize: '9px', color: '#7c3aed', marginLeft: '2px' }}>
                                                        [{tapInfo.low_tap}..{tapInfo.high_tap}]
                                                    </span>
                                                )}
                                            </td>
                                            {isLsOrRcType && (
                                                <td style={{ padding: '2px 4px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        data-testid={`target-mw-${item.actionId}`}
                                                        type="number"
                                                        min={0}
                                                        max={item.mwStart ?? undefined}
                                                        step={0.1}
                                                        placeholder={item.mwStart != null ? item.mwStart.toFixed(1) : '0'}
                                                        value={effectiveMwStr}
                                                        onChange={(e) => onCardEditMwChange(item.actionId, e.target.value)}
                                                        style={{
                                                            width: '60px',
                                                            fontSize: '11px',
                                                            fontFamily: 'monospace',
                                                            padding: '2px 4px',
                                                            border: '1px solid #ccc',
                                                            borderRadius: '3px',
                                                            textAlign: 'right',
                                                        }}
                                                    />
                                                </td>
                                            )}
                                            {isPstType && (
                                                <td style={{ padding: '2px 4px', textAlign: 'right' }} onClick={(e) => e.stopPropagation()}>
                                                    <input
                                                        data-testid={`target-tap-${item.actionId}`}
                                                        type="number"
                                                        min={tapInfo?.low_tap ?? undefined}
                                                        max={tapInfo?.high_tap ?? undefined}
                                                        step={1}
                                                        value={cardEditTap[item.actionId] ?? (simulatedTap ?? (tapInfo ? String(tapInfo.tap) : ''))}
                                                        onChange={(e) => onCardEditTapChange(item.actionId, e.target.value)}
                                                        style={{
                                                            width: '50px',
                                                            fontSize: '11px',
                                                            fontFamily: 'monospace',
                                                            padding: '2px 4px',
                                                            border: '1px solid #9333ea',
                                                            borderRadius: '3px',
                                                            textAlign: 'right',
                                                        }}
                                                    />
                                                </td>
                                            )}
                                            <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace' }}>
                                                {item.score.toFixed(2)}
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                );
            })}
        </div>
    );
};

export default ActionSearchDropdown;
