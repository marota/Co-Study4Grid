import React, { type RefObject } from 'react';
import type { DiagramData, AnalysisResult, TabId } from '../types';

interface VisualizationPanelProps {
    activeTab: TabId;
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
}

const VisualizationPanel: React.FC<VisualizationPanelProps> = ({
    activeTab,
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
}) => {
    const showViewModeToggle = activeTab !== 'overflow' && (
        (activeTab === 'n' && !!nDiagram?.svg) ||
        (activeTab === 'n-1' && !!n1Diagram?.svg) ||
        (activeTab === 'action' && !!actionDiagram?.svg)
    );

    return (
        <>
            {/* Tab bar */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc', flexShrink: 0 }}>
                <button
                    onClick={() => onTabChange('n')}
                    style={{
                        flex: 1, borderRadius: 0, border: 'none', padding: '8px 15px', cursor: 'pointer', fontWeight: activeTab === 'n' ? 'bold' : 400,
                        background: activeTab === 'n' ? 'white' : '#ecf0f1',
                        color: activeTab === 'n' ? '#2c3e50' : '#7f8c8d',
                        borderBottom: activeTab === 'n' ? '3px solid #3498db' : 'none',
                    }}
                >
                    Network (N)
                </button>
                {selectedBranch && (
                    <button
                        onClick={() => onTabChange('n-1')}
                        style={{
                            flex: 1, borderRadius: 0, border: 'none', padding: '8px 15px', cursor: 'pointer', fontWeight: activeTab === 'n-1' ? 'bold' : 400,
                            background: activeTab === 'n-1' ? 'white' : '#ecf0f1',
                            color: activeTab === 'n-1' ? '#2c3e50' : '#7f8c8d',
                            borderBottom: activeTab === 'n-1' ? '3px solid #e74c3c' : 'none',
                        }}
                    >
                        Contingency (N-1)
                    </button>
                )}
                {selectedActionId && (
                    <button
                        onClick={() => onTabChange('action')}
                        style={{
                            flex: 1, borderRadius: 0, border: 'none', padding: '8px 15px', cursor: 'pointer', fontWeight: activeTab === 'action' ? 'bold' : 400,
                            background: activeTab === 'action' ? 'white' : '#ecf0f1',
                            color: activeTab === 'action' ? '#0056b3' : '#7f8c8d',
                            borderBottom: activeTab === 'action' ? '3px solid #007bff' : 'none',
                        }}
                    >
                        Action: {selectedActionId}
                    </button>
                )}
                {result?.pdf_url && (
                    <button
                        onClick={() => onTabChange('overflow')}
                        style={{
                            flex: 1, borderRadius: 0, border: 'none', padding: '8px 15px', cursor: 'pointer', fontWeight: activeTab === 'overflow' ? 'bold' : 400,
                            background: activeTab === 'overflow' ? 'white' : '#ecf0f1',
                            color: activeTab === 'overflow' ? '#2c3e50' : '#7f8c8d',
                            borderBottom: activeTab === 'overflow' ? '3px solid #27ae60' : 'none',
                        }}
                    >
                        Overflow Analysis
                    </button>
                )}

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
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                                {analysisLoading ? 'Processing Analysis...' : 'Run analysis to see overflow graph'}
                            </div>
                        )}
                    </div>
                )}

                {/* N Container — always mounted, hidden via CSS to preserve zoom state */}
                <div style={{
                    width: '100%', height: '100%',
                    position: 'absolute', top: 0, left: 0,
                    zIndex: activeTab === 'n' ? 10 : -1,
                    visibility: activeTab === 'n' ? 'visible' : 'hidden',
                    pointerEvents: activeTab === 'n' ? 'auto' : 'none',
                }}>
                    {nDiagram?.svg ? (
                        <div className="svg-container" ref={nSvgContainerRef} dangerouslySetInnerHTML={{ __html: nDiagram.svg }} />
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
                        <div className="svg-container" ref={n1SvgContainerRef} dangerouslySetInnerHTML={{ __html: n1Diagram.svg }} />
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Select a target contingency to view N-1
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
                        <div className="svg-container" ref={actionSvgContainerRef} dangerouslySetInnerHTML={{ __html: actionDiagram.svg }} />
                    ) : selectedActionId ? (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Failed to load diagram for action {selectedActionId}
                        </div>
                    ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999' }}>
                            Select an action card to view its network variant
                        </div>
                    )}
                </div>

                {/* Voltage Range Sidebar */}
                {uniqueVoltages.length > 1 && (() => {
                    const minV = uniqueVoltages[0];
                    const maxV = uniqueVoltages[uniqueVoltages.length - 1];
                    const logMin = Math.log(minV);
                    const logMax = Math.log(maxV);
                    const logScale = (kv: number) => ((Math.log(kv) - logMin) / (logMax - logMin)) * 100;
                    const pctLow = logScale(voltageRange[0]);
                    const pctHigh = logScale(voltageRange[1]);
                    return (
                        <div className="voltage-sidebar">
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
                                    {inspectableItems.map(b => <option key={b} value={b} />)}
                                </datalist>
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

export default VisualizationPanel;
