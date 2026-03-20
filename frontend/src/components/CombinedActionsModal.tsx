import React, { useState, useEffect, useMemo } from 'react';
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
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<CombinedAction | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [simulating, setSimulating] = useState(false);
    const [simulationFeedback, setSimulationFeedback] = useState<SimulationFeedback | null>(null);
    // Per-pair simulation results tracked within this modal session
    const [sessionSimResults, setSessionSimResults] = useState<Record<string, SimulationFeedback>>({});

    // Get all available computed actions
    const availableActions = useMemo(() => {
        if (!analysisResult || !analysisResult.actions) return [];
        // Only include non-combined/manual actions for manual combination exploration
        return Object.entries(analysisResult.actions)
            .filter(([id]) => !id.includes('+'))
            .map(([id, detail]) => ({
                id,
                description: detail.description_unitaire,
                max_rho: detail.max_rho,
                is_pst: id.toLowerCase().includes('pst_') ||
                    Object.keys(detail.action_topology?.pst_tap ?? {}).length > 0
            })).sort((a, b) => (a.max_rho ?? 999) - (b.max_rho ?? 999));
    }, [analysisResult]);

    // Pre-computed combined pairs from analysis
    const computedPairsList = useMemo(() => {
        if (!analysisResult?.combined_actions) return [];
        return Object.entries(analysisResult.combined_actions).map(([id, data]) => {
            const parts = id.split('+');
            const cId = canonicalizeId(id);
            // Check for simulation data: prefer session-local results, then parent-provided
            // simulatedActions (from result.actions), then analysisResult.actions
            // Look up by both original key and canonical key to handle key ordering mismatches
            const sessionResult = sessionSimResults[id] || sessionSimResults[cId];
            const parentSimData = simulatedActions[id] || simulatedActions[cId];
            const analysisSimData = analysisResult.actions[id] || analysisResult.actions[cId];
            const simData = parentSimData || analysisSimData;
            const isSimulated = !!sessionResult || (simData && !simData.is_estimated && simData.rho_after && simData.rho_after.length > 0);

            // Use session result if available, otherwise fall back to stored simulation data
            const simMaxRho = sessionResult?.max_rho ?? simData?.max_rho;
            const simMaxRhoLine = sessionResult?.max_rho_line ?? simData?.max_rho_line;

            return {
                id,
                action1: parts[0] || 'N/A',
                action2: parts[1] || 'N/A',
                betas: data.betas,
                // These are simulation data (if simulated) or estimated data (from backend)
                max_rho: data.rho_after && data.rho_after.length > 0 ? data.max_rho : null,
                max_rho_line: data.max_rho_line,
                is_rho_reduction: data.is_rho_reduction,
                is_suspect: !!data.is_islanded,
                isSimulated,
                // Explicitly use estimation fields for the "Est." column
                estimated_max_rho: data.estimated_max_rho,
                estimated_max_rho_line: data.estimated_max_rho_line,
                simulated_max_rho: simMaxRho,
                simulated_max_rho_line: simMaxRhoLine
            };
        }).sort((a, b) => (a.max_rho ?? 999) - (b.max_rho ?? 999));
    }, [analysisResult, simulatedActions, sessionSimResults]);

    // Cleanup when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedIds(new Set());
            setPreview(null);
            setError(null);
            setActiveTab('computed');
            setSimulationFeedback(null);
            setSimulating(false);
            setSessionSimResults({});
        }
    }, [isOpen]);

    // Clear simulation feedback when selection changes
    useEffect(() => {
        setSimulationFeedback(null);
    }, [selectedIds]);

    // Fetch superposition preview when exactly 2 are selected
    useEffect(() => {
        const fetchPreview = async () => {
            if (activeTab === 'explore' && selectedIds.size === 2 && disconnectedElement) {
                const [id1, id2] = Array.from(selectedIds);

                // Check if already in analysisResult.combined_actions
                const pairKey = [id1, id2].sort().join('+');
                const preComputed = analysisResult?.combined_actions?.[pairKey];

                if (preComputed) {
                    setPreview(preComputed);
                    setError(null);
                    return;
                }

                setLoading(true);
                setError(null);
                try {
                    const result = await api.computeSuperposition(id1, id2, disconnectedElement);
                    if (result.error) {
                        setError(result.error);
                        setPreview(null);
                    } else {
                        setPreview(result);
                    }
                } catch (e: unknown) {
                    const err = e as { response?: { data?: { detail?: string } }, message?: string };
                    setError(err?.response?.data?.detail || err.message || 'Failed to compute superposition');
                    setPreview(null);
                } finally {
                    setLoading(false);
                }
            } else {
                setPreview(null);
                setError(null);
            }
        };
        fetchPreview();
    }, [selectedIds, disconnectedElement, analysisResult, activeTab]);

    if (!isOpen) return null;

    const handleToggle = (id: string) => {
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
        const idToSimulate = actionId ? (actionId.includes('+') ? actionId.split('+').sort().join('+') : actionId) : Array.from(selectedIds).sort().join('+');
        if (!idToSimulate.includes('+') || !disconnectedElement) return;

        // Try to find estimation data to preserve it (check both original and canonical key)
        const estimationData = actionId
            ? (analysisResult?.combined_actions?.[idToSimulate] || analysisResult?.combined_actions?.[actionId])
            : preview;

        // Build action_content from saved topologies so the backend can
        // reconstruct actions not in the dictionary (e.g. node_merging,
        // coupling actions generated during analysis).
        let actionContent: Record<string, unknown> | null = null;
        const parts = idToSimulate.split('+');
        const allActions = { ...simulatedActions, ...analysisResult?.actions };
        const perAction: Record<string, unknown> = {};
        for (const part of parts) {
            const partDetail = allActions[part];
            if (partDetail?.action_topology) perAction[part] = partDetail.action_topology;
        }
        if (Object.keys(perAction).length > 0) actionContent = perAction;

        setSimulating(true);
        setSimulationFeedback(null);
        setError(null);
        try {
            const result = await api.simulateManualAction(idToSimulate, disconnectedElement, actionContent, linesOverloaded.length > 0 ? linesOverloaded : null);
            const feedback: SimulationFeedback = {
                max_rho: result.max_rho,
                max_rho_line: result.max_rho_line,
                is_rho_reduction: result.is_rho_reduction,
                is_islanded: result.is_islanded,
                disconnected_mw: result.disconnected_mw,
                non_convergence: result.non_convergence,
            };
            setSimulationFeedback(feedback);
            // Store per-pair result in session map so the computed pairs table
            // correctly reflects each pair's own simulation result
            setSessionSimResults(prev => ({ ...prev, [idToSimulate]: feedback }));
            // Notify parent to add the action to the main action list
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
                estimated_max_rho: estimationData?.max_rho,
                estimated_max_rho_line: estimationData?.max_rho_line,
            };
            onSimulateCombined(idToSimulate, detail, result.lines_overloaded || []);
        } catch (e: unknown) {
            const err = e as { response?: { data?: { detail?: string } }, message?: string };
            setError(err?.response?.data?.detail || err?.message || 'Simulation failed');
        } finally {
            setSimulating(false);
        }
    };

    const tabStyle = (tab: 'computed' | 'explore'): React.CSSProperties => ({
        padding: '10px 20px',
        cursor: 'pointer',
        borderBottom: activeTab === tab ? '3px solid #007bff' : '3px solid transparent',
        fontWeight: 'bold',
        color: activeTab === tab ? '#007bff' : '#666',
        transition: 'all 0.2s'
    });

    const headerCellStyle: React.CSSProperties = { padding: '10px 8px', borderBottom: '2px solid #ddd', textAlign: 'left', fontSize: '12px', color: '#666', fontWeight: 600, background: '#f8f9fa', position: 'sticky', top: 0, zIndex: 1 };
    const cellStyle: React.CSSProperties = { padding: '10px 8px', borderBottom: '1px solid #eee', fontSize: '13px' };

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
                width: '900px',
                maxWidth: '95vw',
                maxHeight: '85vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 10px 25px rgba(0,0,0,0.25)',
                overflow: 'hidden'
            }}>
                <div style={{ padding: '15px 24px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: '#fcfcfc' }}>
                    <h3 style={{ margin: 0, fontSize: '1.25rem', color: '#1a1a1a' }}>Combine Actions</h3>
                    <button onClick={onClose} style={{ border: 'none', background: 'none', fontSize: '24px', cursor: 'pointer', color: '#999', outline: 'none' }}>&times;</button>
                </div>

                <div style={{ display: 'flex', borderBottom: '1px solid #eee', background: '#fcfcfc', padding: '0 24px' }}>
                    <div style={tabStyle('computed')} onClick={() => setActiveTab('computed')}>Computed Pairs</div>
                    <div style={tabStyle('explore')} onClick={() => setActiveTab('explore')}>Explore Pairs</div>
                </div>

                <div style={{ padding: '24px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column' }}>
                    {activeTab === 'computed' ? (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <p style={{ marginTop: 0, marginBottom: '20px', fontSize: '14px', color: '#666' }}>
                                Pairs estimated as promising during the last analysis run using the superposition theorem.
                            </p>
                            <div style={{ border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden', flex: 1 }}>
                                <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                                        <thead>
                                            <tr>
                                                <th style={headerCellStyle}>Action 1</th>
                                                <th style={headerCellStyle}>Action 2</th>
                                                <th style={headerCellStyle}>Betas</th>
                                                <th style={headerCellStyle}>Max Loading (Est.)</th>
                                                <th style={headerCellStyle}>Line (Est.)</th>
                                                <th style={headerCellStyle}>Simulated Max Rho</th>
                                                <th style={headerCellStyle}>Simulated Line</th>
                                                <th style={{ ...headerCellStyle, textAlign: 'center' }}>Action</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {computedPairsList.length === 0 ? (
                                                <tr>
                                                    <td colSpan={6} style={{ padding: '40px', textAlign: 'center', color: '#999', fontStyle: 'italic' }}>No promising combinations identified during analysis.</td>
                                                </tr>
                                            ) : computedPairsList.map(p => (
                                                <tr key={p.id} style={{ borderBottom: '1px solid #eee' }}>
                                                    <td style={{ ...cellStyle, fontWeight: 600 }}>{p.action1}</td>
                                                    <td style={{ ...cellStyle, fontWeight: 600 }}>{p.action2}</td>
                                                    <td style={cellStyle}>
                                                        <span style={{ fontSize: '11px', background: '#f0f0f0', padding: '2px 4px', borderRadius: '4px', fontFamily: 'monospace' }}>
                                                            {p.betas.map(b => b.toFixed(2)).join(', ')}
                                                        </span>
                                                    </td>
                                                    <td style={cellStyle}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                            {p.estimated_max_rho != null && !isNaN(p.estimated_max_rho) ? (
                                                                <>
                                                                    <span style={{
                                                                        fontWeight: 'bold',
                                                                        color: p.estimated_max_rho <= monitoringFactor ? '#28a745' : '#dc3545',
                                                                        background: p.estimated_max_rho <= monitoringFactor ? '#e8f5e9' : '#ffebee',
                                                                        padding: '2px 6px',
                                                                        borderRadius: '4px',
                                                                        opacity: 0.8
                                                                    }}>
                                                                        {(p.estimated_max_rho * 100).toFixed(1)}%
                                                                    </span>
                                                                    {p.is_suspect && (
                                                                        <span title="Suspect estimation (islanding detected or linear superposition breakdown)" style={{ cursor: 'help' }}>⚠️</span>
                                                                    )}
                                                                </>
                                                            ) : '\u2014'}
                                                        </div>
                                                    </td>
                                                    <td style={{ ...cellStyle, fontSize: '12px', color: '#666' }}>{p.estimated_max_rho_line || '\u2014'}</td>

                                                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                        {p.isSimulated ? (
                                                            <span style={{
                                                                fontWeight: 'bold',
                                                                color: '#007bff',
                                                                background: '#e7f1ff',
                                                                padding: '2px 6px',
                                                                borderRadius: '4px'
                                                            }}>
                                                                {(p.simulated_max_rho! * 100).toFixed(1)}%
                                                            </span>
                                                        ) : '-'}
                                                    </td>
                                                    <td style={{ ...cellStyle, fontSize: '12px', fontWeight: p.isSimulated ? 600 : 400 }}>
                                                        {p.isSimulated ? p.simulated_max_rho_line : '-'}
                                                    </td>

                                                    <td style={{ ...cellStyle, textAlign: 'center' }}>
                                                        <button
                                                            onClick={() => handleSimulate(p.id)}
                                                            style={{
                                                                padding: '6px 14px',
                                                                background: p.isSimulated ? '#007bff' : '#28a745',
                                                                color: 'white',
                                                                border: 'none',
                                                                borderRadius: '4px',
                                                                cursor: 'pointer',
                                                                fontSize: '12px',
                                                                fontWeight: 'bold',
                                                                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
                                                            }}
                                                        >{p.isSimulated ? 'Re-Simulate' : 'Simulate'}</button>
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                            <p style={{ marginTop: 0, marginBottom: '20px', fontSize: '14px', color: '#666' }}>
                                Manually select two actions to estimate their combined effect using linear superposition.
                            </p>

                            <div style={{ border: '1px solid #eee', borderRadius: '8px', overflow: 'hidden', marginBottom: '24px' }}>
                                <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                        <thead style={{ position: 'sticky', top: 0, background: '#f8f9fa', zIndex: 1 }}>
                                            <tr>
                                                <th style={{ padding: '10px 8px', borderBottom: '2px solid #ddd', width: '40px' }}></th>
                                                <th style={{ padding: '10px 8px', borderBottom: '2px solid #ddd', textAlign: 'left' }}>Action ID</th>
                                                <th style={{ padding: '10px 8px', borderBottom: '2px solid #ddd', textAlign: 'left' }}>Description</th>
                                                <th style={{ padding: '10px 8px', borderBottom: '2px solid #ddd', textAlign: 'right' }}>Max Rho</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {availableActions.length === 0 ? (
                                                <tr>
                                                    <td colSpan={4} style={{ padding: '30px', textAlign: 'center', color: '#999' }}>No base actions available.</td>
                                                </tr>
                                            ) : availableActions.map(a => (
                                                <tr key={a.id} style={{ borderBottom: '1px solid #eee', cursor: selectedIds.size >= 2 && !selectedIds.has(a.id) ? 'not-allowed' : 'pointer', background: selectedIds.has(a.id) ? '#e7f1ff' : 'transparent', opacity: selectedIds.size >= 2 && !selectedIds.has(a.id) ? 0.5 : 1 }} onClick={() => handleToggle(a.id)}>
                                                    <td style={{ padding: '8px', textAlign: 'center' }}>
                                                        <input
                                                            type="checkbox"
                                                            checked={selectedIds.has(a.id)}
                                                            onChange={() => handleToggle(a.id)}
                                                            disabled={selectedIds.size >= 2 && !selectedIds.has(a.id)}
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                    </td>
                                                    <td style={{ padding: '8px', fontWeight: 600 }}>
                                                        {a.id}
                                                        {a.is_pst && (
                                                            <span title="Phase Shifting Transformer action" style={{ marginLeft: '6px', fontSize: '10px', background: '#e3f2fd', color: '#1565c0', padding: '1px 5px', borderRadius: '4px', fontWeight: 700, letterSpacing: '0.5px', verticalAlign: 'middle' }}>PST</span>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '8px', color: '#555' }}>{a.description}</td>
                                                    <td style={{ padding: '8px', textAlign: 'right' }}>{a.max_rho ? `${(a.max_rho * 100).toFixed(1)}%` : '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div style={{ background: preview ? '#e1f5fe' : '#f8f9fa', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', minHeight: '120px', borderLeft: preview ? '5px solid #0288d1' : undefined }}>
                                {selectedIds.size < 2 && !preview && (
                                    <div style={{ color: '#888', fontStyle: 'italic', fontSize: '13px' }}>Select two actions to see their estimated combined effect.</div>
                                )}

                                {selectedIds.size === 2 && loading && (
                                    <div style={{ color: '#0056b3', fontSize: '14px', fontWeight: 500 }}>Computing superposition...</div>
                                )}

                                {selectedIds.size === 2 && error && (
                                    <div style={{ color: '#dc3545', fontSize: '13px', background: '#f8d7da', padding: '12px', borderRadius: '6px', border: '1px solid #f5c6cb' }}>
                                        {error}
                                    </div>
                                )}

                                {selectedIds.size === 2 && preview && (
                                    <div>
                                        <div style={{ fontWeight: 800, color: '#01579b', marginBottom: '8px', fontSize: '14px' }}>
                                            Combined action result
                                        </div>
                                        <div style={{ fontSize: '12px', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <span style={{ fontFamily: 'monospace', background: 'rgba(255,255,255,0.5)', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>
                                                Betas: {preview.betas.map(b => b.toFixed(3)).join(', ')}
                                            </span>
                                        </div>
                                        <div style={{ display: 'flex', gap: '24px' }}>
                                            <div style={{ flex: 1 }}>
                                                <div style={{ fontSize: '11px', fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: '6px' }}>Estimation</div>
                                                <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                                                    Max loading estimated by superposition: <strong style={{
                                                        color: (preview.estimated_max_rho ?? preview.max_rho) <= monitoringFactor ? '#28a745' : '#dc3545',
                                                        fontSize: '15px'
                                                    }}>{((preview.estimated_max_rho ?? preview.max_rho) * 100).toFixed(1)}%</strong>
                                                    {preview.is_islanded && (
                                                        <span title="Suspect estimation (islanding detected)" style={{ cursor: 'help', marginLeft: '6px' }}>⚠️</span>
                                                    )}
                                                </div>
                                                <div style={{ fontSize: '12px', color: '#666' }}>
                                                    Line: {preview.estimated_max_rho_line ?? preview.max_rho_line}
                                                </div>
                                            </div>
                                            <div style={{ flex: 1 }} data-testid="simulation-feedback">
                                                <div style={{ fontSize: '11px', fontWeight: 700, color: '#666', textTransform: 'uppercase', marginBottom: '6px' }}>Simulation Feedback</div>
                                                {simulating && (
                                                    <div style={{ color: '#0056b3', fontSize: '13px' }}>Simulating...</div>
                                                )}
                                                {!simulating && simulationFeedback && (
                                                    <>
                                                        <div style={{ fontSize: '13px', marginBottom: '4px' }}>
                                                            Actual Max Loading: <strong style={{
                                                                color: (simulationFeedback.max_rho ?? 1) <= monitoringFactor ? '#28a745' : '#dc3545',
                                                                fontSize: '15px'
                                                            }}>{simulationFeedback.max_rho != null ? `${(simulationFeedback.max_rho * 100).toFixed(1)}%` : 'N/A'}</strong>
                                                        </div>
                                                        <div style={{ fontSize: '12px', color: '#666' }}>
                                                            Line: {simulationFeedback.max_rho_line}
                                                        </div>
                                                        {simulationFeedback.is_islanded && (
                                                            <div style={{ fontSize: '11px', color: '#dc3545', marginTop: '4px' }}>
                                                                Islanding detected ({simulationFeedback.disconnected_mw?.toFixed(1)} MW disconnected)
                                                            </div>
                                                        )}
                                                        {simulationFeedback.non_convergence && (
                                                            <div style={{ fontSize: '11px', color: '#dc3545', marginTop: '4px' }}>
                                                                Non-convergence: {simulationFeedback.non_convergence}
                                                            </div>
                                                        )}
                                                    </>
                                                )}
                                                {!simulating && !simulationFeedback && (
                                                    <div style={{ color: '#aaa', fontSize: '12px', fontStyle: 'italic' }}>Click "Simulate Combined" to run</div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#fcfcfc' }}>
                    <button onClick={onClose} style={{ padding: '10px 20px', background: 'white', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, color: '#666' }}>Close</button>
                    {activeTab === 'explore' && preview && (
                        <button
                            onClick={() => handleSimulate()}
                            disabled={selectedIds.size !== 2 || simulating}
                            style={{
                                padding: '10px 24px',
                                background: simulating ? '#6c757d' : '#27ae60',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: (selectedIds.size !== 2 || simulating) ? 'not-allowed' : 'pointer',
                                opacity: (selectedIds.size !== 2 || simulating) ? 0.6 : 1,
                                fontWeight: 'bold',
                                boxShadow: '0 4px 10px rgba(39,174,96,0.2)'
                            }}
                        >
                            {simulating ? 'Simulating...' : 'Simulate Combined'}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CombinedActionsModal;
