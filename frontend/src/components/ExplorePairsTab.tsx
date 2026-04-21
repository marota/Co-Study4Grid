// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useState } from 'react';
import type { CombinedAction, AnalysisResult, ActionTypeFilterToken } from '../types';
import ActionTypeFilterChips from './ActionTypeFilterChips';
import { matchesActionTypeFilter } from '../utils/actionTypes';

interface SimulationFeedback {
    max_rho: number | null;
    max_rho_line: string;
    is_rho_reduction: boolean;
    is_islanded?: boolean;
    disconnected_mw?: number;
    non_convergence?: string | null;
}

export interface ScoredActionEntry {
    actionId: string;
    score: number;
    type: string;
    mwStart: number | null;
}

interface ExplorePairsTabProps {
    scoredActionsList: ScoredActionEntry[];
    selectedIds: Set<string>;
    onToggle: (id: string) => void;
    onClearSelection: () => void;
    preview: CombinedAction | null;
    simulationFeedback: SimulationFeedback | null;
    sessionSimResults: Record<string, SimulationFeedback>;
    analysisResult: AnalysisResult | null;
    loading: boolean;
    error: string | null;
    simulating: boolean;
    hasRestricted: boolean;
    monitoringFactor: number;
    onEstimate: () => void;
    onSimulate: () => void;
    onSimulateSingle: (actionId: string) => void;
    displayName?: (id: string) => string;
}

const ExplorePairsTab: React.FC<ExplorePairsTabProps> = ({
    scoredActionsList,
    selectedIds,
    onToggle,
    onClearSelection,
    preview,
    simulationFeedback,
    sessionSimResults,
    analysisResult,
    loading,
    error,
    simulating,
    hasRestricted,
    monitoringFactor,
    onEstimate,
    onSimulate,
    onSimulateSingle,
    displayName = (id: string) => id,
}) => {
    const [exploreFilter, setExploreFilter] = useState<ActionTypeFilterToken>('all');

    return (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            {/* Selection Chips Header */}
            <div style={{ background: '#f8f9fa', padding: '10px 15px', borderRadius: '6px', marginBottom: '15px', border: '1px solid #e9ecef' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#444' }}>Selected Actions ({selectedIds.size}/2)</div>
                    <button
                        onClick={onClearSelection}
                        disabled={selectedIds.size === 0}
                        style={{ background: 'none', border: 'none', color: '#007bff', fontSize: '11px', cursor: 'pointer', padding: 0 }}
                    >Clear All</button>
                </div>
                <div style={{ display: 'flex', gap: '8px', minHeight: '30px', flexWrap: 'wrap' }} data-testid="selection-chips">
                    {selectedIds.size === 0 ? (
                        <div style={{ color: '#999', fontSize: '12px', fontStyle: 'italic', display: 'flex', alignItems: 'center' }}>Click rows in the table below to select...</div>
                    ) : (
                        Array.from(selectedIds).map(id => (
                            <div key={id} data-testid={`chip-${id}`} style={{ background: '#e7f1ff', color: '#007bff', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: 'bold', border: '1px solid #b3d7ff', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                {id}
                                <span onClick={(e) => { e.stopPropagation(); onToggle(id); }} style={{ cursor: 'pointer', fontSize: '14px', lineHeight: '10px' }}>&times;</span>
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* Filter Buttons — reuses the shared chip row so
                styling stays in sync with the action-overview filter. */}
            <ActionTypeFilterChips
                testIdPrefix="explore-pairs-filter"
                value={exploreFilter}
                onChange={setExploreFilter}
                style={{ marginBottom: '12px' }}
            />

            {/* Grouped Table */}
            <div style={{ flex: 1, maxHeight: '350px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '4px', marginBottom: '15px' }}>
                {(() => {
                    const filteredList = scoredActionsList.filter(item =>
                        matchesActionTypeFilter(exploreFilter, item.actionId, null, item.type),
                    );

                    const types = Array.from(new Set(filteredList.map(item => item.type)));

                    if (filteredList.length === 0) {
                        return (
                            <div style={{ textAlign: 'center', color: '#888', fontStyle: 'italic', padding: '40px 20px' }}>
                                No scored actions available for this filter.
                            </div>
                        );
                    }

                    return types.map(type => (
                        <div key={type} style={{ marginBottom: '1px' }}>
                            <div style={{ fontSize: '11px', fontWeight: 600, color: '#444', backgroundColor: '#f0f2f5', padding: '4px 10px', borderBottom: '1px solid #e1e4e8', display: 'flex', justifyContent: 'space-between' }}>
                                <span>{type.replace(/_/g, ' ').toUpperCase()}</span>
                                <span>{filteredList.filter(item => item.type === type).length} actions</span>
                            </div>
                            {(type === 'load_shedding' || type === 'ls') && (
                                <div style={{
                                    padding: '6px 10px',
                                    background: '#fff3cd',
                                    color: '#856404',
                                    borderBottom: '1px solid #ffeeba',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    <span>⚠️</span> Load shedding actions cannot be combined for estimation.
                                </div>
                            )}
                            {(type === 'renewable_curtailment' || type === 'rc') && (
                                <div style={{
                                    padding: '6px 10px',
                                    background: '#e3f2fd',
                                    color: '#0d47a1',
                                    borderBottom: '1px solid #bbdefb',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}>
                                    <span>ℹ️</span> Renewable curtailment actions cannot be combined for estimation.
                                </div>
                            )}
                            <table className="action-table" style={{ margin: 0, border: 'none' }}>
                                <tbody>
                                    {filteredList
                                        .filter(item => item.type === type)
                                        .map(({ actionId, score, mwStart }) => {
                                            const isSelected = selectedIds.has(actionId);
                                            const simResult = sessionSimResults[actionId] || (analysisResult?.actions?.[actionId]?.rho_after ? analysisResult.actions[actionId] : null);

                                            return (
                                                <tr
                                                    key={actionId}
                                                    className={isSelected ? 'selected' : ''}
                                                    onClick={() => onToggle(actionId)}
                                                    style={{ cursor: 'pointer', background: isSelected ? '#fff9db' : '#fdfdfd' }}
                                                >
                                                    <td style={{ width: '30px', padding: '8px 0 8px 12px' }}>
                                                        <input type="checkbox" checked={isSelected} readOnly style={{ cursor: 'pointer' }} />
                                                    </td>
                                                    <td style={{ fontWeight: 'bold', fontSize: '12px' }}>{actionId}</td>
                                                    <td style={{ width: '65px', textAlign: 'right', fontFamily: 'monospace', fontSize: '11px', color: mwStart == null ? '#aaa' : '#333' }}>
                                                        {mwStart != null ? `${mwStart.toFixed(1)}` : 'N/A'}
                                                    </td>
                                                    <td style={{ width: '60px', textAlign: 'right' }}>
                                                        <span className="metric-badge metric-score" style={{ transform: 'scale(0.9)', display: 'inline-block' }}>
                                                            {score.toFixed(2)}
                                                        </span>
                                                    </td>
                                                    <td style={{ width: '80px', textAlign: 'right' }}>
                                                        {simResult ? (
                                                            <span className="metric-badge metric-rho" style={{
                                                                transform: 'scale(0.9)',
                                                                display: 'inline-block',
                                                                background: (simResult.max_rho ?? 0) > monitoringFactor ? '#ffebee' : '#e8f5e9',
                                                                color: (simResult.max_rho ?? 0) > monitoringFactor ? '#c62828' : '#2e7d32',
                                                                border: '1px solid currentColor'
                                                            }}>
                                                                {((simResult.max_rho ?? 0) * 100).toFixed(1)}%
                                                            </span>
                                                        ) : (
                                                            <span style={{ color: '#aaa', fontStyle: 'italic', fontSize: '10px' }}>Untested</span>
                                                        )}
                                                    </td>
                                                    <td onClick={(e) => e.stopPropagation()} style={{ width: '100px', textAlign: 'right', paddingRight: '12px' }}>
                                                        <button
                                                            onClick={() => onSimulateSingle(actionId)}
                                                            disabled={simulating}
                                                            style={{
                                                                padding: '3px 10px',
                                                                background: simResult ? '#95a5a6' : '#2980b9',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: simulating ? 'not-allowed' : 'pointer',
                                                                fontSize: '10px',
                                                                fontWeight: 'bold',
                                                                minWidth: '70px'
                                                            }}
                                                        >
                                                            {simulating ? '...' : (simResult ? 'Re-run' : 'Simulate')}
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    }
                                </tbody>
                            </table>
                        </div>
                    ));
                })()}
            </div>

            {/* Action Bar / Comparison Card */}
            <div style={{ marginTop: '5px' }}>
                {!preview ? (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <button
                            onClick={onEstimate}
                            disabled={selectedIds.size !== 2 || loading || hasRestricted}
                            data-testid="estimate-button"
                            style={{
                                width: '100%',
                                padding: '12px',
                                background: (selectedIds.size === 2 && !loading && !hasRestricted) ? '#3498db' : '#ecf0f1',
                                color: (selectedIds.size === 2 && !loading && !hasRestricted) ? 'white' : '#bdc3c7',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: (selectedIds.size !== 2 || loading || hasRestricted) ? 'not-allowed' : 'pointer',
                                fontWeight: 'bold',
                                fontSize: '14px',
                                transition: 'all 0.2s',
                                boxShadow: (selectedIds.size === 2 && !loading && !hasRestricted) ? '0 4px 6px rgba(52, 152, 219, 0.2)' : 'none'
                            }}
                        >
                            {loading ? '⚙️ Estimating Combination...' : (selectedIds.size === 2 ? (hasRestricted ? 'Combination not allowed' : 'Estimate combination effect') : 'Select 2 actions to estimate')}
                        </button>
                    </div>
                ) : (
                    <div style={{
                        padding: '15px',
                        background: error ? '#fff3cd' : '#e1f5fe',
                        borderRadius: '8px',
                        borderLeft: '5px solid ' + (error ? '#856404' : '#0288d1'),
                        boxShadow: '0 2px 5px rgba(0,0,0,0.05)'
                    }} data-testid="comparison-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' }}>
                            <div style={{ flex: 1 }}>
                                {preview.betas && (
                                    <div style={{ marginBottom: '8px', fontSize: '11px', color: '#666', background: 'rgba(255,255,255,0.6)', padding: '2px 8px', borderRadius: '4px', display: 'inline-block', fontWeight: 600 }}>
                                        Betas: {preview.betas.map(b => b.toFixed(3)).join(', ')}
                                    </div>
                                )}
                                <div style={{ fontWeight: 800, color: error ? '#856404' : '#01579b', fontSize: '15px' }}>
                                    {error ? '⚠️ Estimation Failed' : 'Explore Pairs Comparison'}
                                </div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                                <button
                                    onClick={onEstimate}
                                    disabled={loading}
                                    style={{ padding: '6px 12px', background: 'white', border: '1px solid #3498db', color: '#3498db', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                                >
                                    {loading ? '...' : 'Estimate combination effect'}
                                </button>
                                <button
                                    onClick={onSimulate}
                                    disabled={simulating || hasRestricted}
                                    style={{
                                        padding: '6px 16px',
                                        background: (simulating || hasRestricted) ? '#6c757d' : '#27ae60',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: '6px',
                                        cursor: (simulating || hasRestricted) ? 'not-allowed' : 'pointer',
                                        fontWeight: 'bold',
                                        fontSize: '12px',
                                        boxShadow: (simulating || hasRestricted) ? 'none' : '0 2px 4px rgba(39,174,96,0.2)',
                                        minWidth: '140px'
                                    }}
                                >
                                    {simulating ? '⌛ Simulating...' : (hasRestricted ? 'Simulation Locked' : 'Simulate Combined')}
                                </button>
                            </div>
                        </div>

                        {!error && (
                            <div style={{ display: 'flex', gap: '30px', borderTop: '1px solid rgba(0,0,0,0.05)', paddingTop: '12px' }}>
                                <div style={{ flex: 1, borderRight: '1px solid rgba(0,0,0,0.05)', paddingRight: '15px' }}>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>Estimated Effect</div>
                                    <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                                        Estimated Max Loading: <strong style={{ color: (preview.estimated_max_rho ?? preview.max_rho ?? 0) <= monitoringFactor ? '#28a745' : '#d35400', fontSize: '16px' }}>{((preview.estimated_max_rho ?? preview.max_rho ?? 0) * 100).toFixed(1)}%</strong>
                                        {preview.is_islanded && (
                                            <span style={{ marginLeft: '6px' }} title="Estimation suspect due to islanding">⚠️</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#666' }}>
                                        Line: {displayName(preview.estimated_max_rho_line ?? preview.max_rho_line)}
                                    </div>
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontSize: '11px', fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: '8px', letterSpacing: '0.5px' }}>Simulation Result</div>
                                    {simulating && (
                                        <div style={{ color: '#0056b3', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span>⌛</span> Simulating combined action...
                                        </div>
                                    )}
                                    {!simulating && simulationFeedback && (
                                        <div data-testid="simulation-feedback">
                                            <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                                                Actual Max Loading: <strong style={{ color: (simulationFeedback.max_rho ?? 1) <= monitoringFactor ? '#28a745' : '#d35400', fontSize: '16px' }}>{simulationFeedback.max_rho != null ? `${(simulationFeedback.max_rho * 100).toFixed(1)}%` : 'N/A'}</strong>
                                            </div>
                                            <div style={{ fontSize: '12px', color: '#666' }}>
                                                Line: {displayName(simulationFeedback.max_rho_line)}
                                            </div>
                                            {simulationFeedback.is_islanded && (
                                                <div style={{ fontSize: '11px', color: '#dc3545', marginTop: '6px', fontWeight: 600, background: '#fff5f5', padding: '2px 8px', borderRadius: '4px', display: 'inline-block' }}>
                                                    Islanding detected ({simulationFeedback.disconnected_mw?.toFixed(1)} MW disconnected)
                                                </div>
                                            )}
                                            {simulationFeedback.non_convergence && (
                                                <div style={{ fontSize: '11px', color: '#dc3545', marginTop: '6px', fontWeight: 600, background: '#fff5f5', padding: '2px 8px', borderRadius: '4px', display: 'inline-block' }}>
                                                    Non-convergence: {simulationFeedback.non_convergence}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {!simulating && !simulationFeedback && (
                                        <div style={{ color: '#aaa', fontSize: '12px', fontStyle: 'italic', marginTop: '5px' }}>Click "Simulate Combined" to run</div>
                                    )}
                                </div>
                            </div>
                        )}
                        {error && (
                            <div style={{ fontSize: '13px', color: '#856404' }}>{error}</div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ExplorePairsTab;
