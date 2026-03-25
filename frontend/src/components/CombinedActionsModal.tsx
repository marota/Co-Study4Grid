import React, { useState, useEffect, useMemo, useRef } from 'react';
import { api } from '../api';
import type { AnalysisResult, CombinedAction, ActionDetail } from '../types';

interface SimulationFeedback {
    max_rho: number | null;
    max_rho_line: string;
    is_rho_reduction: boolean;
    is_islanded?: boolean;
    disconnected_mw?: number;
    non_convergence?: string | null;
}

interface Props {
    isOpen: boolean;
    onClose: () => void;
    analysisResult: AnalysisResult | null;
    simulatedActions?: Record<string, ActionDetail>;
    disconnectedElement: string | null;
    onSimulateCombined: (actionId: string, detail: ActionDetail, linesOverloaded: string[]) => void;
    monitoringFactor?: number;
    linesOverloaded?: string[];
}

/** Canonicalize a combined action ID by sorting the parts alphabetically. */
function canonicalizeId(id: string): string {
    if (!id || !id.includes('+')) return id;
    return id.split('+').map(p => p.trim()).sort().join('+');
}

const CombinedActionsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    analysisResult,
    simulatedActions = {},
    disconnectedElement,
    onSimulateCombined,
    monitoringFactor = 1.0,
    linesOverloaded = [],
}) => {
    const [activeTab, setActiveTab] = useState<'computed' | 'explore'>('computed');
    const [exploreFilter, setExploreFilter] = useState<string>('all');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<CombinedAction | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [simulating, setSimulating] = useState(false);
    const [simulationFeedback, setSimulationFeedback] = useState<SimulationFeedback | null>(null);
    // Per-pair simulation results tracked within this modal session
    const [sessionSimResults, setSessionSimResults] = useState<Record<string, SimulationFeedback>>({});
    const lastSelectionRef = useRef<string>('');

    // Scored actions for exploration, derived from analysisResult.action_scores
    const scoredActionsList = useMemo(() => {
        if (!analysisResult?.action_scores) return [];
        const list: { actionId: string; score: number; type: string; mwStart: number | null }[] = [];
        for (const [type, data] of Object.entries(analysisResult.action_scores)) {
            const scores = data?.scores || {};
            const mwStartMap = data?.mw_start;
            for (const [actionId, score] of Object.entries(scores)) {
                // Filter out estimated-only combined actions from the exploration list
                if (actionId.includes('+')) {
                    const detail = analysisResult.actions?.[actionId];
                    if (detail?.is_estimated || !detail?.rho_after || detail.rho_after.length === 0) continue;
                }
                const mwStart = mwStartMap?.[actionId] ?? null;
                list.push({ actionId, score, type, mwStart: mwStart != null ? Number(mwStart) : null });
            }
        }
        return list.sort((a, b) => {
            if (a.type !== b.type) return a.type.localeCompare(b.type);
            return b.score - a.score;
        });
    }, [analysisResult]);

    // Pre-computed combined pairs from analysis
    const computedPairsList = useMemo(() => {
        const combined_actions = analysisResult?.combined_actions || {};
        const combinedEntries = Object.entries(combined_actions);

        // Build a set of canonical keys present in combined_actions
        const combinedCanonicalKeys = new Set(combinedEntries.map(([id]) => canonicalizeId(id)));

        // Also include any simulated pairs in result.actions not in combined_actions
        const simulatedOnly = Object.entries(analysisResult?.actions || {})
            .filter(([id]) => id.includes('+') && !combined_actions[id] && !combinedCanonicalKeys.has(canonicalizeId(id)));

        const allPairs = [
            ...combinedEntries.map(([id, ca]) => {
                const cId = canonicalizeId(id);
                const sessionResult = sessionSimResults[id] || sessionSimResults[cId];
                const parentSimData = simulatedActions[id] || simulatedActions[cId];
                const analysisSimData = analysisResult?.actions?.[id] || analysisResult?.actions?.[cId];
                const simData = parentSimData || analysisSimData;
                const isRealSim = !!sessionResult || (simData && !simData.is_estimated && simData.rho_after && simData.rho_after.length > 0);
                return { id, data: ca, simData: isRealSim ? (sessionResult || simData) : null };
            }),
            ...simulatedOnly.map(([id, data]) => ({ id, data: {} as CombinedAction, simData: data })),
        ];

        return allPairs
            .sort((a, b) => {
                const valA = (a.data.estimated_max_rho ?? a.data.max_rho) ?? 999;
                const valB = (b.data.estimated_max_rho ?? b.data.max_rho) ?? 999;
                return valA - valB;
            })
            .map(({ id, data, simData }) => {
                const parts = id.split('+');
                const isSimulated = !!simData;
                const simMaxRho = (simData as ActionDetail | SimulationFeedback)?.max_rho ?? null;
                const simMaxRhoLine = (simData as ActionDetail | SimulationFeedback)?.max_rho_line ?? null;
                const estMaxRho = data.estimated_max_rho ?? data.max_rho;
                const estMaxRhoLine = data.estimated_max_rho_line ?? data.max_rho_line;

                return {
                    id,
                    action1: parts[0]?.trim() || 'N/A',
                    action2: parts[1]?.trim() || 'N/A',
                    betas: data.betas,
                    estimated_max_rho: estMaxRho,
                    estimated_max_rho_line: estMaxRhoLine,
                    is_suspect: !!data.is_islanded,
                    isSimulated,
                    simulated_max_rho: simMaxRho,
                    simulated_max_rho_line: simMaxRhoLine,
                    simData: simData
                };
            });
    }, [analysisResult, simulatedActions, sessionSimResults]);

    const hasLS = Array.from(selectedIds).some(id => id.startsWith('load_shedding_') || id.includes('load_shedding'));

    // Cleanup when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedIds(new Set());
            setPreview(null);
            setError(null);
            setActiveTab('computed');
            setExploreFilter('all');
            setSimulationFeedback(null);
            setSimulating(false);
            setSessionSimResults({});
        }
    }, [isOpen]);

    // Only handle automatic preview for pre-computed actions or resetting
    useEffect(() => {
        const currentSelection = Array.from(selectedIds).sort().join('+');
        const selectionChanged = currentSelection !== lastSelectionRef.current;
        lastSelectionRef.current = currentSelection;

        if (activeTab === 'explore' && selectedIds.size === 2 && disconnectedElement) {
            const [id1, id2] = Array.from(selectedIds);
            const pairKey = [id1, id2].sort().join('+');
            const preComputed = analysisResult?.combined_actions?.[pairKey];

            if (preComputed) {
                setPreview(preComputed);
                setError(null);
            } else if (selectionChanged) {
                // If not pre-computed, ONLY clear if selection actually changed
                setPreview(null);
                setSimulationFeedback(null);
            }
        } else {
            setPreview(null);
            setError(null);
            setSimulationFeedback(null);
        }
    }, [selectedIds, disconnectedElement, analysisResult, activeTab]);

    const handleEstimate = async () => {
        if (activeTab !== 'explore' || selectedIds.size !== 2 || !disconnectedElement) return;
        const [id1, id2] = Array.from(selectedIds);

        setLoading(true);
        setError(null);
        try {
            const result = await api.computeSuperposition(id1, id2, disconnectedElement);
            if (result.error) {
                setError(result.error);
                setPreview(result);
            } else {
                setPreview(result);
                setError(null);
            }
        } catch (e: unknown) {
            const err = e as { response?: { data?: { detail?: string } }, message?: string };
            setError(err?.response?.data?.detail || err.message || 'Failed to compute superposition');
            setPreview(null);
        } finally {
            setLoading(false);
        }
    };

    if (!isOpen) return null;

    const handleToggle = (id: string) => {
        setSimulationFeedback(null);
        setError(null);
        const newSet = new Set(selectedIds);
        if (newSet.has(id)) {
            newSet.delete(id);
        } else {
            if (newSet.size >= 2) return; // Only allow 2
            newSet.add(id);
        }
        setSelectedIds(newSet);
    };

    const handleSimulate = async (actionId?: string) => {
        const idToSimulate = actionId ? (actionId.includes('+') ? canonicalizeId(actionId) : actionId) : Array.from(selectedIds).sort().join('+');
        if (!idToSimulate || !disconnectedElement) return;

        // Try to find estimation data to preserve it
        const estimationData = actionId
            ? (analysisResult?.combined_actions?.[idToSimulate] || analysisResult?.combined_actions?.[actionId])
            : preview;

        // Build action_content from saved topologies
        let actionContent: Record<string, unknown> | null = null;
        const parts = idToSimulate.includes('+') ? idToSimulate.split('+') : [idToSimulate];
        const allActions = { ...simulatedActions, ...analysisResult?.actions };
        const perAction: Record<string, unknown> = {};
        for (const part of parts) {
            const partDetail = allActions[part];
            if (partDetail?.action_topology) perAction[part] = partDetail.action_topology;
        }
        if (Object.keys(perAction).length > 0) actionContent = perAction;

        setSimulating(true);
        if (!actionId || actionId.includes('+')) {
            setSimulationFeedback(null);
        }
        setError(null);
        try {
            const actualLinesOverloaded = (linesOverloaded && linesOverloaded.length > 0) ? linesOverloaded : null;
            const result = await api.simulateManualAction(idToSimulate, disconnectedElement, actionContent, actualLinesOverloaded);
            const feedback: SimulationFeedback = {
                max_rho: result.max_rho,
                max_rho_line: result.max_rho_line,
                is_rho_reduction: result.is_rho_reduction,
                is_islanded: result.is_islanded,
                disconnected_mw: result.disconnected_mw,
                non_convergence: result.non_convergence,
            };
            
            setSessionSimResults(prev => ({ ...prev, [idToSimulate]: feedback }));
            if (!actionId || actionId.includes('+')) {
                setSimulationFeedback(feedback);
            }
            
            const detail: ActionDetail = {
                description_unitaire: result.description_unitaire,
                rho_before: result.rho_before,
                rho_after: result.rho_after,
                max_rho: result.max_rho,
                max_rho_line: result.max_rho_line,
                is_rho_reduction: result.is_rho_reduction,
                is_islanded: result.is_islanded,
                n_components: result.n_components,
                disconnected_mw: result.disconnected_mw,
                non_convergence: result.non_convergence,
                estimated_max_rho: estimationData?.estimated_max_rho ?? estimationData?.max_rho,
                estimated_max_rho_line: estimationData?.estimated_max_rho_line ?? estimationData?.max_rho_line,
                is_estimated: false,
                action_topology: result.action_topology
            };
            
            onSimulateCombined(idToSimulate, detail, result.lines_overloaded || []);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { detail?: string } }, message?: string };
            setError(err?.response?.data?.detail || err?.message || 'Simulation failed');
        } finally {
            setSimulating(false);
        }
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center'
        }}>
            <div style={{
                background: 'white',
                borderRadius: '12px',
                width: '950px',
                maxWidth: '95vw',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
                overflow: 'hidden'
            }}>
                <div style={{ padding: '15px 24px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fcfcfc' }}>
                    <h2 style={{ margin: 0, fontSize: '1.25rem' }}>Combine Actions</h2>
                    <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '24px', cursor: 'pointer', color: '#999' }}>&times;</button>
                </div>

                <div style={{ display: 'flex', borderBottom: '1px solid #ddd', background: '#fcfcfc', padding: '0 24px' }}>
                    <div className={`modal-tab ${activeTab === 'computed' ? 'active' : ''}`} onClick={() => setActiveTab('computed')} data-testid="tab-computed">Computed Pairs</div>
                    <div className={`modal-tab ${activeTab === 'explore' ? 'active' : ''}`} onClick={() => setActiveTab('explore')} data-testid="tab-explore">Explore Pairs</div>
                </div>

                <div style={{ padding: '20px 24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {activeTab === 'computed' ? (
                        <div style={{ maxHeight: '500px', overflowY: 'auto' }}>
                            <table className="action-table">
                                <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                                    <tr>
                                        <th>Action 1</th>
                                        <th>Action 2</th>
                                        <th>Betas</th>
                                        <th>Max Loading (Est.)</th>
                                        <th>Line (Est.)</th>
                                        <th>Simulated Max Rho</th>
                                        <th>Simulated Line</th>
                                        <th>Action</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {computedPairsList.length === 0 ? (
                                        <tr>
                                            <td colSpan={8} style={{ padding: '40px', textAlign: 'center', color: '#888', fontStyle: 'italic' }}>
                                                No computed combinations found.<br />Go to <strong>Explore Pairs</strong> to create new ones.
                                            </td>
                                        </tr>
                                    ) : computedPairsList.map(p => {
                                        const estMaxRho = p.estimated_max_rho;
                                        const isSimulated = p.isSimulated;
                                        const simMaxRho = p.simulated_max_rho;

                                        return (
                                            <tr key={p.id}>
                                                <td style={{ fontWeight: 'bold', fontSize: '12px' }}>{p.action1}</td>
                                                <td style={{ fontWeight: 'bold', fontSize: '12px' }}>{p.action2}</td>
                                                <td style={{ fontSize: '11px', fontFamily: 'monospace', color: '#666' }}>
                                                    {p.betas ? p.betas.map(b => b.toFixed(2)).join(', ') : '-'}
                                                </td>
                                                <td>
                                                    {estMaxRho != null && !isNaN(estMaxRho) ? (
                                                        <span className="metric-badge metric-rho" style={{
                                                            background: estMaxRho > monitoringFactor ? '#ffebee' : estMaxRho > (monitoringFactor - 0.05) ? '#fff3cd' : '#e8f5e9',
                                                            color: estMaxRho > monitoringFactor ? '#c62828' : estMaxRho > (monitoringFactor - 0.05) ? '#856404' : '#2e7d32',
                                                            border: estMaxRho > monitoringFactor ? '1px solid #c62828' : estMaxRho > (monitoringFactor - 0.05) ? '1px solid #856404' : '1px dashed #2e7d32'
                                                        }}>
                                                            {(estMaxRho * 100).toFixed(1)}%
                                                            {p.is_suspect && (
                                                                <span style={{ marginLeft: '4px' }} title="Estimation suspect due to islanding">⚠️</span>
                                                            )}
                                                        </span>
                                                    ) : '—'}
                                                </td>
                                                <td style={{ fontSize: '11px', color: '#666', fontStyle: 'italic' }}>{p.estimated_max_rho_line || 'N/A'}</td>

                                                <td style={{ textAlign: 'center' }}>
                                                    {isSimulated && simMaxRho != null ? (
                                                        <span className="metric-badge metric-rho" style={{
                                                            background: simMaxRho > monitoringFactor ? '#ffebee' : simMaxRho > (monitoringFactor - 0.05) ? '#fff3cd' : '#e8f5e9',
                                                            color: simMaxRho > monitoringFactor ? '#c62828' : simMaxRho > (monitoringFactor - 0.05) ? '#856404' : '#2e7d32'
                                                        }}>
                                                            {(simMaxRho * 100).toFixed(1)}%
                                                            {(p.simData as ActionDetail | SimulationFeedback)?.is_islanded && (
                                                                <span style={{ fontSize: '10px', marginLeft: '4px' }} title="Islanding detected">🏝️</span>
                                                            )}
                                                        </span>
                                                    ) : (
                                                        <span style={{ color: '#aaa', fontSize: '11px' }}>Not simulated</span>
                                                    )}
                                                </td>
                                                <td style={{ fontSize: '11px', color: '#333', fontWeight: isSimulated ? 'bold' : 'normal' }}>
                                                    {isSimulated ? p.simulated_max_rho_line : '-'}
                                                </td>

                                                <td>
                                                    <button
                                                        onClick={() => handleSimulate(p.id)}
                                                        disabled={simulating}
                                                        style={{
                                                            padding: '6px 14px',
                                                            background: isSimulated ? '#007bff' : '#28a745',
                                                            color: 'white',
                                                            border: 'none',
                                                            borderRadius: '4px',
                                                            cursor: simulating ? 'not-allowed' : 'pointer',
                                                            fontSize: '11px',
                                                            fontWeight: 'bold',
                                                            opacity: simulating ? 0.6 : 1,
                                                            minWidth: '100px'
                                                        }}
                                                    >
                                                        {simulating ? '⌛' : (isSimulated ? 'Re-Simulate' : 'Simulate')}
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
                            {/* Selection Chips Header */}
                            <div style={{ background: '#f8f9fa', padding: '10px 15px', borderRadius: '6px', marginBottom: '15px', border: '1px solid #e9ecef' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                                    <div style={{ fontSize: '12px', fontWeight: 'bold', color: '#444' }}>Selected Actions ({selectedIds.size}/2)</div>
                                    <button
                                        onClick={() => setSelectedIds(new Set())}
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
                                                    <span onClick={(e) => { e.stopPropagation(); handleToggle(id); }} style={{ cursor: 'pointer', fontSize: '14px', lineHeight: '10px' }}>&times;</span>
                                                </div>
                                            ))
                                        )}
                                </div>
                            </div>

                            {/* Filter Buttons */}
                            <div style={{ marginBottom: '12px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {['all', 'disco', 'reco', 'ls', 'open', 'close', 'pst'].map(f => (
                                    <button
                                        key={f}
                                        onClick={() => setExploreFilter(f)}
                                        style={{
                                            padding: '4px 12px',
                                            borderRadius: '15px',
                                            border: '1px solid',
                                            borderColor: exploreFilter === f ? '#007bff' : '#ddd',
                                            background: exploreFilter === f ? '#007bff' : 'white',
                                            color: exploreFilter === f ? 'white' : '#666',
                                            fontSize: '11px',
                                            cursor: 'pointer',
                                            fontWeight: exploreFilter === f ? 'bold' : 'normal',
                                            transition: 'all 0.2s'
                                        }}
                                    >
                                        {f.toUpperCase()}
                                    </button>
                                ))}
                            </div>

                            {/* Grouped Table */}
                            <div style={{ flex: 1, maxHeight: '350px', overflowY: 'auto', border: '1px solid #eee', borderRadius: '4px', marginBottom: '15px' }}>
                                {(() => {
                                    const filteredList = scoredActionsList.filter(item => {
                                        if (exploreFilter === 'all') return true;
                                        const t = item.type.toLowerCase();
                                        if (exploreFilter === 'disco') return t.includes('disco') || t.includes('line_disconnection') || t.includes('open_line');
                                        if (exploreFilter === 'reco') return t.includes('reco') || t.includes('line_reconnection') || t.includes('close_line');
                                        if (exploreFilter === 'open') return t.includes('open_coupling');
                                        if (exploreFilter === 'close') return t.includes('close_coupling');
                                        if (exploreFilter === 'pst') return t.includes('pst');
                                        if (exploreFilter === 'ls') return t.includes('load_shedding') || t.includes('ls');
                                        return t.includes(exploreFilter);
                                    });

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
                                                                    onClick={() => handleToggle(actionId)}
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
                                                                            onClick={() => handleSimulate(actionId)}
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
                                            onClick={handleEstimate}
                                            disabled={selectedIds.size !== 2 || loading || hasLS}
                                            data-testid="estimate-button"
                                            style={{
                                                width: '100%',
                                                padding: '12px',
                                                background: (selectedIds.size === 2 && !loading && !hasLS) ? '#3498db' : '#ecf0f1',
                                                color: (selectedIds.size === 2 && !loading && !hasLS) ? 'white' : '#bdc3c7',
                                                border: 'none',
                                                borderRadius: '6px',
                                                cursor: (selectedIds.size !== 2 || loading || hasLS) ? 'not-allowed' : 'pointer',
                                                fontWeight: 'bold',
                                                fontSize: '14px',
                                                transition: 'all 0.2s',
                                                boxShadow: (selectedIds.size === 2 && !loading && !hasLS) ? '0 4px 6px rgba(52, 152, 219, 0.2)' : 'none'
                                            }}
                                        >
                                            {loading ? '⚙️ Estimating Combination...' : (selectedIds.size === 2 ? (hasLS ? 'Combination not allowed' : 'Estimate combination effect') : 'Select 2 actions to estimate')}
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
                                                    onClick={handleEstimate}
                                                    disabled={loading}
                                                    style={{ padding: '6px 12px', background: 'white', border: '1px solid #3498db', color: '#3498db', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold' }}
                                                >
                                                    {loading ? '...' : 'Estimate combination effect'}
                                                </button>
                                                <button
                                                    onClick={() => handleSimulate()}
                                                    disabled={simulating || hasLS}
                                                    style={{ 
                                                        padding: '6px 16px', 
                                                        background: (simulating || hasLS) ? '#6c757d' : '#27ae60', 
                                                        color: 'white', 
                                                        border: 'none', 
                                                        borderRadius: '6px', 
                                                        cursor: (simulating || hasLS) ? 'not-allowed' : 'pointer', 
                                                        fontWeight: 'bold', 
                                                        fontSize: '12px', 
                                                        boxShadow: (simulating || hasLS) ? 'none' : '0 2px 4px rgba(39,174,96,0.2)', 
                                                        minWidth: '140px' 
                                                    }}
                                                >
                                                    {simulating ? '⌛ Simulating...' : (hasLS ? 'Simulation Locked' : 'Simulate Combined')}
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
                                                        Line: {preview.estimated_max_rho_line ?? preview.max_rho_line}
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
                                                                Line: {simulationFeedback.max_rho_line}
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
                    )}
                </div>

                <div style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#fcfcfc' }}>
                    <button onClick={onClose} style={{ padding: '10px 20px', background: 'white', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, color: '#666' }}>Close</button>
                </div>

            </div>
        </div>
    );
};

export default CombinedActionsModal;
