// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import React, { useState, useMemo, type RefObject } from 'react';
import type { DiagramData, AnalysisResult, TabId, VlOverlay, SldTab } from '../types';
import MemoizedSvgContainer from './MemoizedSvgContainer';
import SldOverlay from './SldOverlay';

interface VisualizationPanelProps {
    activeTab: TabId;
    configLoading: boolean;
    onTabChange: (tab: TabId) => void;
    nDiagram: DiagramData | null;
    n1Diagram: DiagramData | null;
    n1Loading: boolean;
    actionDiagram: DiagramData | null;
    actionDiagramLoading: boolean;
    selectedActionId: string | null;
    result: AnalysisResult | null;
    analysisLoading: boolean;
    nSvgContainerRef: RefObject<HTMLDivElement | null>;
    n1SvgContainerRef: RefObject<HTMLDivElement | null>;
    actionSvgContainerRef: RefObject<HTMLDivElement | null>;
    uniqueVoltages: number[];
    voltageRange: [number, number];
    onVoltageRangeChange: (range: [number, number]) => void;
    actionViewMode: 'network' | 'delta';
    onViewModeChange: (mode: 'network' | 'delta') => void;
    inspectQuery: string;
    onInspectQueryChange: (query: string) => void;
    inspectableItems: string[];
    onResetView: () => void;
    onZoomIn: () => void;
    onZoomOut: () => void;
    hasBranches: boolean;
    selectedBranch: string;
    vlOverlay: VlOverlay | null;
    onOverlayClose: () => void;
    onOverlaySldTabChange: (tab: SldTab) => void;
    voltageLevels: string[];
    onVlOpen: (vlName: string) => void;
    networkPath: string;
    layoutPath: string;
    onOpenSettings: (tab?: 'recommender' | 'configurations' | 'paths') => void;
}


const VisualizationPanel: React.FC<VisualizationPanelProps> = ({
    activeTab,
    configLoading,
    onTabChange,
    nDiagram,
    n1Diagram,
    n1Loading,
    actionDiagram,
    actionDiagramLoading,
    selectedActionId,
    result,
    analysisLoading,
    nSvgContainerRef,
    n1SvgContainerRef,
    actionSvgContainerRef,
    uniqueVoltages,
    voltageRange,
    onVoltageRangeChange,
    actionViewMode,
    onViewModeChange,
    inspectQuery,
    onInspectQueryChange,
    inspectableItems,
    onResetView,
    onZoomIn,
    onZoomOut,
    hasBranches,
    selectedBranch,
    vlOverlay,
    onOverlayClose,
    onOverlaySldTabChange,
    voltageLevels,
    onVlOpen,
    networkPath,
    layoutPath,
    onOpenSettings,
}) => {
    const [warningDismissed, setWarningDismissed] = useState(false);
    const [voltageFilterExpanded, setVoltageFilterExpanded] = useState(false);

    const hasAnyDiagram = !!(nDiagram?.svg || n1Diagram?.svg || actionDiagram?.svg);
    const showPathWarning = !warningDismissed && !hasAnyDiagram;

    const showViewModeToggle = activeTab !== 'overflow' && (
        (activeTab === 'n' && !!nDiagram?.svg) ||
        (activeTab === 'n-1' && !!n1Diagram?.svg) ||
        (activeTab === 'action' && !!actionDiagram?.svg)
    );

    const filteredInspectables = useMemo(() => {
        const q = inspectQuery.toUpperCase();
        if (!q) return inspectableItems.slice(0, 50);
        return inspectableItems.filter(b => b.toUpperCase().includes(q)).slice(0, 50);
    }, [inspectableItems, inspectQuery]);

    return (
        <>
            {/* Tab bar — all 4 tabs always visible; unavailable ones show placeholder */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc', flexShrink: 0 }}>
                {(
                    [
                        { id: 'n' as TabId, label: 'Network (N)', available: !!nDiagram?.svg, accentColor: '#3498db', dimColor: '#7f8c8d', placeholder: 'Configure a network path in Settings to load the base-case diagram.' },
                        { id: 'n-1' as TabId, label: 'Contingency (N-1)', available: !!n1Diagram?.svg, accentColor: '#e74c3c', dimColor: '#aab', placeholder: 'Select a contingency element from the dropdown to view the N-1 state.' },
                        { id: 'action' as TabId, label: selectedActionId ? `Remedial Action: ${selectedActionId}` : 'Remedial Action', available: !!actionDiagram?.svg, accentColor: '#ff4081', dimColor: '#aab', placeholder: 'Select an action card from the suggestions panel to view its effect on the network.' },
                        { id: 'overflow' as TabId, label: 'Overflow Analysis', available: !!result?.pdf_url, accentColor: '#27ae60', dimColor: '#aab', placeholder: 'Run \u201cAnalyze & Suggest\u201d to see the overflow graph.' },
                    ] as const
                ).map(tab => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                            title={tab.available ? undefined : tab.placeholder}
                            style={{
                                flex: 1, borderRadius: 0, border: 'none', padding: '8px 6px',
                                cursor: 'pointer',
                                fontWeight: isActive && tab.available ? 'bold' : 400,
                                fontStyle: !tab.available ? 'italic' : 'normal',
                                background: isActive ? 'white' : '#ecf0f1',
                                color: tab.available ? (isActive ? '#2c3e50' : tab.dimColor) : '#bbb',
                                borderBottom: isActive && tab.available ? `3px solid ${tab.accentColor}` : 'none',
                                fontSize: tab.id === 'action' && selectedActionId ? '0.75rem' : '0.85rem',
                                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                            }}
                        >
                            {tab.label}
                        </button>
                    );
                })}
            </div>

            {/* Content area */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {/* View Mode Overlay */}
                {showViewModeToggle && (
                    <div style={{
                        position: 'absolute',
                        top: '10px',
                        right: '75px',
                        zIndex: 100,
                        display: 'flex',
                        borderRadius: '6px',
                        overflow: 'hidden',
                        border: '1px solid #ccc',
                        boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                        fontSize: '12px',
                        fontWeight: 600,
                        backgroundColor: '#fff',
                    }}>
                        <button
                            onClick={() => onViewModeChange('network')}
                            style={{
                                padding: '4px 12px', border: 'none', cursor: 'pointer',
                                backgroundColor: actionViewMode === 'network' ? '#007bff' : '#fff',
                                color: actionViewMode === 'network' ? '#fff' : '#555',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            Flows
                        </button>
                        <button
                            onClick={() => onViewModeChange('delta')}
                            style={{
                                padding: '4px 12px', border: 'none', borderLeft: '1px solid #ccc', cursor: 'pointer',
                                backgroundColor: actionViewMode === 'delta' ? '#007bff' : '#fff',
                                color: actionViewMode === 'delta' ? '#fff' : '#555',
                                transition: 'all 0.15s ease'
                            }}
                        >
                            Impacts
                        </button>
                    </div>
                )}

                {/* Path Warning Banner */}
                {!nDiagram?.svg && !configLoading && showPathWarning && (
                    <div style={{
                        position: 'absolute',
                        top: '10px',
                        left: '50%',
                        transform: 'translateX(-50%)',
                        zIndex: 150,
                        backgroundColor: '#fff3cd',
                        color: '#856404',
                        padding: '12px 20px',
                        borderRadius: '8px',
                        border: '1px solid #ffeeba',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        maxWidth: '80%',
                        fontSize: '13px'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                            <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span>⚠️</span> Configuration Paths
                            </div>
                            <button
                                onClick={() => setWarningDismissed(true)}
                                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '16px', color: '#856404' }}
                            >✕</button>
                        </div>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <strong>Layout Path:</strong> {layoutPath || 'Not set'}
                        </div>
                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            <strong>Output Folder:</strong> {networkPath ? networkPath.substring(0, networkPath.lastIndexOf('/')) : 'Not set'}
                        </div>
                        <div style={{ marginTop: '4px' }}>
                            <a
                                href="#"
                                onClick={(e) => { e.preventDefault(); onOpenSettings('paths'); }}
                                style={{ color: '#0056b3', textDecoration: 'underline', fontWeight: 500 }}
                            >
                                Change in settings
                            </a>
                        </div>
                    </div>
                )}

                {/* Overflow Container */}
                {activeTab === 'overflow' && (
                    <div style={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                        backgroundColor: 'white', zIndex: 20,
                    }}>
                        {result?.pdf_url ? (
                            <iframe
                                src={`http://localhost:8000${result.pdf_url}`}
                                key={result.pdf_url}
                                style={{ width: '100%', height: '100%', border: 'none' }}
                                title="Overflow Graph"
                            />
                        ) : (
                            <div style={{
                                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%',
                                color: analysisLoading ? '#856404' : '#999',
                                background: analysisLoading ? '#fff3cd' : 'white',
                                fontWeight: analysisLoading ? 600 : 'normal',
                                gap: '10px'
                            }}>
                                {analysisLoading ? (
                                    <>
                                        <span style={{ fontSize: '24px' }}>⚙️</span>
                                        <span>Processing Analysis...</span>
                                    </>
                                ) : <span style={{ fontStyle: 'italic', color: '#999' }}>Run &ldquo;Analyze &amp; Suggest&rdquo; to see the overflow graph.</span>}
                            </div>
                        )}
                    </div>
                )}

                <div style={{
                    width: '100%', height: '100%',
                    position: 'absolute', top: 0, left: 0,
                    zIndex: activeTab === 'n' ? 10 : -1,
                    visibility: activeTab === 'n' ? 'visible' : 'hidden',
                    pointerEvents: activeTab === 'n' ? 'auto' : 'none',
                }}>
                    {configLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Loading configuration...
                        </div>
                    ) : nDiagram?.svg ? (
                        <MemoizedSvgContainer svg={nDiagram.svg} containerRef={nSvgContainerRef} display="block" tabId="n" />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Load configuration to see diagram
                        </div>
                    )}
                </div>

                {/* N-1 Container — always mounted, hidden via CSS to preserve zoom state */}
                <div style={{
                    width: '100%', height: '100%',
                    position: 'absolute', top: 0, left: 0,
                    zIndex: activeTab === 'n-1' ? 10 : -1,
                    visibility: activeTab === 'n-1' ? 'visible' : 'hidden',
                    pointerEvents: activeTab === 'n-1' ? 'auto' : 'none',
                }}>
                    {/* Convergence warning banner */}
                    {n1Diagram && n1Diagram.lf_converged === false && (
                        <div style={{
                            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
                            background: '#fff3cd', color: '#856404', padding: '6px 12px',
                            fontSize: '0.8rem', borderBottom: '1px solid #ffc107',
                            textAlign: 'center', pointerEvents: 'none',
                        }}>
                            AC load flow: {n1Diagram.lf_status || 'did not converge'} — voltage values may be missing or approximate
                        </div>
                    )}
                    {n1Loading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Generating N-1 Diagram...
                        </div>
                    ) : n1Diagram?.svg ? (
                        <MemoizedSvgContainer svg={n1Diagram.svg} containerRef={n1SvgContainerRef} display="block" tabId="n-1" />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontStyle: 'italic', textAlign: 'center', padding: '40px' }}>
                            Select a contingency element from the dropdown to view the N-1 state.
                        </div>
                    )}
                </div>

                {/* Action Variant Container — always mounted, hidden via CSS to preserve zoom state */}
                <div style={{
                    width: '100%', height: '100%',
                    position: 'absolute', top: 0, left: 0,
                    zIndex: activeTab === 'action' ? 10 : -1,
                    visibility: activeTab === 'action' ? 'visible' : 'hidden',
                    pointerEvents: activeTab === 'action' ? 'auto' : 'none',
                }}>
                    {/* Convergence warning banner */}
                    {actionDiagram && actionDiagram.lf_converged === false && (
                        <div style={{
                            position: 'absolute', top: 0, left: 0, right: 0, zIndex: 30,
                            background: '#fff3cd', color: '#856404', padding: '6px 12px',
                            fontSize: '0.8rem', borderBottom: '1px solid #ffc107',
                            textAlign: 'center', pointerEvents: 'none',
                        }}>
                            AC load flow: {actionDiagram.lf_status || 'did not converge'} — voltage values may be missing or approximate
                        </div>
                    )}
                    {actionDiagramLoading ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Generating Action Variant Diagram...
                        </div>
                    ) : actionDiagram?.svg ? (
                        <MemoizedSvgContainer svg={actionDiagram.svg} containerRef={actionSvgContainerRef} display="block" tabId="action" />
                    ) : selectedActionId ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Failed to load diagram for action {selectedActionId}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontStyle: 'italic', textAlign: 'center', padding: '40px' }}>
                            Select an action card from the suggestions panel to view its effect on the network.
                        </div>
                    )}
                </div>

                {/* Voltage Range Sidebar — collapsed by default, toggle to expand */}
                {uniqueVoltages.length > 1 && (() => {
                    const minV = uniqueVoltages[0];
                    const maxV = uniqueVoltages[uniqueVoltages.length - 1];
                    const logMin = Math.log(minV);
                    const logMax = Math.log(maxV);
                    const logScale = (kv: number) => ((Math.log(kv) - logMin) / (logMax - logMin)) * 100;
                    const pctLow = logScale(voltageRange[0]);
                    const pctHigh = logScale(voltageRange[1]);
                    if (!voltageFilterExpanded) {
                        return (
                            <button
                                className="voltage-sidebar-toggle"
                                onClick={() => setVoltageFilterExpanded(true)}
                                title="Show voltage filter"
                            >
                                <span style={{ writingMode: 'vertical-rl', fontSize: '11px', letterSpacing: '1px' }}>kV ▸</span>
                            </button>
                        );
                    }
                    return (
                        <div className="voltage-sidebar">
                            <button
                                onClick={() => setVoltageFilterExpanded(false)}
                                title="Hide voltage filter"
                                style={{
                                    alignSelf: 'flex-end', background: 'none', border: 'none',
                                    cursor: 'pointer', fontSize: '14px', color: '#666',
                                    padding: '0 4px', lineHeight: 1,
                                }}
                            >✕</button>
                            <span className="vs-label">kV Filter</span>
                            <span className="vs-range-label">
                                {voltageRange[1]}<br />{voltageRange[0]}
                            </span>
                            <div className="voltage-slider-container">
                                <div className="voltage-slider-track" />
                                <div className="voltage-slider-range" style={{ bottom: pctLow + '%', top: (100 - pctHigh) + '%' }} />
                                <input type="range"
                                    min={logMin} max={logMax} step="any"
                                    value={Math.log(voltageRange[0])}
                                    onChange={e => {
                                        const logV = parseFloat(e.target.value);
                                        const snapped = uniqueVoltages.reduce((best, uv) =>
                                            Math.abs(Math.log(uv) - logV) < Math.abs(Math.log(best) - logV) ? uv : best
                                        );
                                        if (snapped <= voltageRange[1]) onVoltageRangeChange([snapped, voltageRange[1]]);
                                    }}
                                    style={{ zIndex: 3, height: '100%' }}
                                />
                                <input type="range"
                                    min={logMin} max={logMax} step="any"
                                    value={Math.log(voltageRange[1])}
                                    onChange={e => {
                                        const logV = parseFloat(e.target.value);
                                        const snapped = uniqueVoltages.reduce((best, uv) =>
                                            Math.abs(Math.log(uv) - logV) < Math.abs(Math.log(best) - logV) ? uv : best
                                        );
                                        if (snapped >= voltageRange[0]) onVoltageRangeChange([voltageRange[0], snapped]);
                                    }}
                                    style={{ zIndex: 4, height: '100%' }}
                                />
                                <div className="voltage-slider-ticks">
                                    {uniqueVoltages.map(kv => (
                                        <span key={kv} style={{ bottom: logScale(kv) + '%' }}>
                                            {kv === 25 ? '<25' : kv}
                                        </span>
                                    ))}
                                </div>
                            </div>
                        </div>
                    );
                })()}

                {/* SLD Overlay — floating panel for voltage-level Single Line Diagram.
                    key={vlOverlay.vlName} ensures position/zoom resets automatically
                    when a different VL is selected. */}
                {vlOverlay && (
                    <SldOverlay
                        key={vlOverlay.vlName}
                        vlOverlay={vlOverlay}
                        actionViewMode={actionViewMode}
                        onOverlayClose={onOverlayClose}
                        onOverlaySldTabChange={onOverlaySldTabChange}
                        n1Diagram={n1Diagram}
                        actionDiagram={actionDiagram}
                        selectedBranch={selectedBranch}
                        result={result}
                    />
                )}

                {/* Bottom-left overlay: Zoom + Inspect */}
                {activeTab !== 'overflow' && (
                    <div style={{
                        position: 'absolute',
                        bottom: '12px',
                        left: '12px',
                        zIndex: 100,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '6px',
                        alignItems: 'flex-start',
                    }}>
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <button
                                onClick={onZoomIn}
                                style={{
                                    background: 'white', color: '#333',
                                    border: '1px solid #ccc', borderRadius: '4px',
                                    padding: '5px 12px', cursor: 'pointer',
                                    fontSize: '14px', fontWeight: 600,
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                }}
                                title="Zoom In"
                            >
                                +
                            </button>
                            <button
                                onClick={onResetView}
                                style={{
                                    background: 'white', color: '#333',
                                    border: '1px solid #ccc', borderRadius: '4px',
                                    padding: '5px 14px', cursor: 'pointer',
                                    fontSize: '12px', fontWeight: 600,
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                }}
                            >
                                🔍 Unzoom
                            </button>
                            <button
                                onClick={onZoomOut}
                                style={{
                                    background: 'white', color: '#333',
                                    border: '1px solid #ccc', borderRadius: '4px',
                                    padding: '5px 12px', cursor: 'pointer',
                                    fontSize: '14px', fontWeight: 600,
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                }}
                                title="Zoom Out"
                            >
                                -
                            </button>
                        </div>

                        {hasBranches && (
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                <input
                                    list="inspectables"
                                    value={inspectQuery}
                                    onChange={e => onInspectQueryChange(e.target.value)}
                                    placeholder="🔍 Inspect..."
                                    style={{
                                        padding: '5px 10px',
                                        border: inspectQuery ? '2px solid #3498db' : '1px solid #ccc',
                                        borderRadius: '4px',
                                        fontSize: '12px',
                                        width: '180px',
                                        boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                        background: 'white',
                                    }}
                                />
                                <datalist id="inspectables">
                                    {filteredInspectables.map(b => <option key={b} value={b} />)}
                                </datalist>
                                {inspectQuery && voltageLevels.includes(inspectQuery) && (
                                    <button
                                        onClick={() => onVlOpen(inspectQuery)}
                                        style={{
                                            background: '#d1fae5', color: '#065f46', border: 'none',
                                            borderRadius: '4px', padding: '4px 8px', cursor: 'pointer',
                                            fontSize: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                            fontWeight: 600
                                        }}
                                        title="Open Single Line Diagram"
                                    >
                                        📄 SLD
                                    </button>
                                )}
                                {inspectQuery && (
                                    <button
                                        onClick={() => onInspectQueryChange('')}
                                        style={{
                                            background: '#e74c3c', color: 'white', border: 'none',
                                            borderRadius: '4px', padding: '4px 8px', cursor: 'pointer',
                                            fontSize: '12px', boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                        }}
                                        title="Clear"
                                    >
                                        X
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </>
    );
};

export default React.memo(VisualizationPanel);
