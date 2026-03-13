import React, { useState, useEffect, useMemo } from 'react';
import { api } from '../api';
import type { AnalysisResult, CombinedAction } from '../types';

interface Props {
    isOpen: boolean;
    onClose: () => void;
    analysisResult: AnalysisResult | null;
    disconnectedElement: string | null;
    onSimulateCombined: (actionId: string) => void;
}

const CombinedActionsModal: React.FC<Props> = ({
    isOpen,
    onClose,
    analysisResult,
    disconnectedElement,
    onSimulateCombined,
}) => {
    const [activeTab, setActiveTab] = useState<'computed' | 'explore'>('computed');
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [preview, setPreview] = useState<CombinedAction | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Get all available computed actions
    const availableActions = useMemo(() => {
        if (!analysisResult || !analysisResult.actions) return [];
        // Only include non-combined/manual actions for manual combination exploration
        return Object.entries(analysisResult.actions)
            .filter(([id]) => !id.includes('+'))
            .map(([id, detail]) => ({
                id,
                description: detail.description_unitaire,
                max_rho: detail.max_rho
            })).sort((a, b) => (a.max_rho ?? 999) - (b.max_rho ?? 999));
    }, [analysisResult]);

    // Pre-computed combined pairs from analysis
    const computedPairsList = useMemo(() => {
        if (!analysisResult?.combined_actions) return [];
        return Object.entries(analysisResult.combined_actions).map(([id, data]) => {
            const parts = id.split('+');
            // Check if this action exists in the main actions list (meaning it was simulated)
            const simulatedData = analysisResult.actions[id];
            const isSimulated = simulatedData && !simulatedData.is_estimated && simulatedData.rho_after && simulatedData.rho_after.length > 0;

            return {
                id,
                action1: parts[0] || 'N/A',
                action2: parts[1] || 'N/A',
                betas: data.betas,
                max_rho: data.max_rho,
                max_rho_line: data.max_rho_line,
                is_rho_reduction: data.is_rho_reduction,
                isSimulated,
                simulated_max_rho: simulatedData?.max_rho,
                simulated_max_rho_line: simulatedData?.max_rho_line
            };
        }).sort((a, b) => (a.max_rho ?? 999) - (b.max_rho ?? 999));
    }, [analysisResult]);

    // Cleanup when modal closes
    useEffect(() => {
        if (!isOpen) {
            setSelectedIds(new Set());
            setPreview(null);
            setError(null);
            setActiveTab('computed');
        }
    }, [isOpen]);

    // Fetch superposition preview when exactly 2 are selected
    useEffect(() => {
        const fetchPreview = async () => {
            if (activeTab === 'explore' && selectedIds.size === 2 && disconnectedElement) {
                const [id1, id2] = Array.from(selectedIds);

                // Check if already in analysisResult.combined_actions
                const pairKey1 = `${id1}+${id2}`;
                const pairKey2 = `${id2}+${id1}`;
                const preComputed = analysisResult?.combined_actions?.[pairKey1] || analysisResult?.combined_actions?.[pairKey2];

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

    const handleSimulate = (actionId?: string) => {
        const idToSimulate = actionId || Array.from(selectedIds).join('+');
        if (idToSimulate.includes('+')) {
            onSimulateCombined(idToSimulate);
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
                                                        <span style={{
                                                            fontWeight: 'bold',
                                                            color: p.is_rho_reduction ? '#28a745' : '#dc3545',
                                                            background: p.is_rho_reduction ? '#e8f5e9' : '#ffebee',
                                                            padding: '2px 6px',
                                                            borderRadius: '4px',
                                                            opacity: 0.8
                                                        }}>
                                                            {(p.max_rho * 100).toFixed(1)}%
                                                        </span>
                                                    </td>
                                                    <td style={{ ...cellStyle, fontSize: '12px', color: '#666' }}>{p.max_rho_line}</td>

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
                                                    <td style={{ padding: '8px', fontWeight: 600 }}>{a.id}</td>
                                                    <td style={{ padding: '8px', color: '#555' }}>{a.description}</td>
                                                    <td style={{ padding: '8px', textAlign: 'right' }}>{a.max_rho ? `${(a.max_rho * 100).toFixed(1)}%` : '-'}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            <div style={{ background: '#f8f9fa', border: '1px solid #ddd', borderRadius: '8px', padding: '20px', minHeight: '120px' }}>
                                <h4 style={{ margin: '0 0 12px 0', fontSize: '14px', color: '#333' }}>Superposition Preview</h4>

                                {selectedIds.size < 2 && (
                                    <div style={{ color: '#888', fontStyle: 'italic', fontSize: '13px' }}>Select two actions to see their estimated combined effect.</div>
                                )}

                                {selectedIds.size === 2 && loading && (
                                    <div style={{ color: '#0056b3', fontSize: '14px', fontWeight: 500 }}>⏳ Computing superposition...</div>
                                )}

                                {selectedIds.size === 2 && error && (
                                    <div style={{ color: '#dc3545', fontSize: '13px', background: '#f8d7da', padding: '12px', borderRadius: '6px', border: '1px solid #f5c6cb' }}>
                                        ⚠️ {error}
                                    </div>
                                )}

                                {selectedIds.size === 2 && preview && (
                                    <div>
                                        <div style={{ fontSize: '13px', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                            <strong>Betas:</strong>
                                            <span style={{ fontFamily: 'monospace', background: 'white', padding: '2px 8px', borderRadius: '4px', border: '1px solid #ddd' }}>
                                                [{preview.betas.map(b => b.toFixed(4)).join(', ')}]
                                            </span>
                                        </div>
                                        <div style={{ fontSize: '13px', marginBottom: '10px' }}>
                                            <strong>A priori max loading:</strong> <span style={{
                                                color: preview.is_rho_reduction ? '#28a745' : '#dc3545',
                                                fontWeight: 'bold',
                                                fontSize: '15px'
                                            }}>{(preview.max_rho * 100).toFixed(1)}%</span> {preview.max_rho_line !== 'N/A' && `on ${preview.max_rho_line}`}
                                        </div>
                                        <div style={{ fontSize: '13px' }}>
                                            <strong>Solves primary overload:</strong> {preview.is_rho_reduction ? <span style={{ color: '#28a745', fontWeight: 'bold' }}>✅ Yes</span> : <span style={{ color: '#dc3545', fontWeight: 'bold' }}>❌ No</span>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                <div style={{ padding: '16px 24px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end', gap: '12px', background: '#fcfcfc' }}>
                    <button onClick={onClose} style={{ padding: '10px 20px', background: 'white', border: '1px solid #ccc', borderRadius: '6px', cursor: 'pointer', fontWeight: 500, color: '#666' }}>Close</button>
                    {activeTab === 'explore' && (
                        <button
                            onClick={() => handleSimulate()}
                            disabled={selectedIds.size !== 2}
                            style={{
                                padding: '10px 24px',
                                background: '#007bff',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: selectedIds.size !== 2 ? 'not-allowed' : 'pointer',
                                opacity: selectedIds.size !== 2 ? 0.6 : 1,
                                fontWeight: 'bold',
                                boxShadow: '0 4px 10px rgba(0,123,255,0.2)'
                            }}
                        >
                            Simulate Manual Combination
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CombinedActionsModal;
