import React, { useState, useEffect, useRef, type RefObject } from 'react';
import type { DiagramData, AnalysisResult, TabId, VlOverlay, SldTab, FlowDelta } from '../types';

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
    vlOverlay: VlOverlay | null;
    onOverlayClose: () => void;
    onOverlaySldTabChange: (tab: SldTab) => void;
}

// ===== SLD Overlay sub-component =====
// Extracted to own component so React resets its local state (position, transform)
// automatically via key={vlOverlay.vlName} when a new VL is selected.
interface SldOverlayProps {
    vlOverlay: VlOverlay;
    actionViewMode: 'network' | 'delta';
    n1FlowDeltas: Record<string, FlowDelta> | null | undefined;
    actionFlowDeltas: Record<string, FlowDelta> | null | undefined;
    onOverlayClose: () => void;
    onOverlaySldTabChange: (tab: SldTab) => void;
}

const SldOverlay: React.FC<SldOverlayProps> = ({ vlOverlay, actionViewMode, n1FlowDeltas, actionFlowDeltas, onOverlayClose, onOverlaySldTabChange }) => {
    const overlayBodyRef = useRef<HTMLDivElement>(null);
    const [overlayPos, setOverlayPos] = useState({ x: 16, y: 16 });
    const [overlayTransform, setOverlayTransform] = useState({ scale: 1, tx: 0, ty: 0 });

    // Apply / clear delta flow colors on the SLD whenever svg, tab, or mode changes.
    // In Impacts mode the lines are colored orange/blue/grey by flow delta category,
    // mirroring the NAD coloring.  In Flows mode all delta classes are removed and
    // original text values restored so the diagram shows its native voltage coloring.
    //
    // pypowsybl SLD SVG structure:
    //   <g class="sld-extern-cell">
    //     <g id="..." class="sld-top-feeder / sld-bottom-feeder">
    //       <g class="sld-wire"><polyline .../></g>
    //       <g class="sld-feeder-info sld-active-power"><text class="sld-label">16</text></g>
    //       <g class="sld-feeder-info sld-reactive-power"><text class="sld-label">-43</text></g>
    //     </g>
    //   </g>
    // Element IDs use internal node IDs (not equipment IDs directly), but the
    // equipment ID typically appears as a substring.
    useEffect(() => {
        const container = overlayBodyRef.current;
        if (!container) return;

        // Clear any previously applied SLD delta classes
        const SLD_DELTA_CLASSES = ['sld-delta-positive', 'sld-delta-negative', 'sld-delta-grey'];
        container.querySelectorAll(SLD_DELTA_CLASSES.map(c => '.' + c).join(','))
            .forEach(el => el.classList.remove(...SLD_DELTA_CLASSES));

        // Restore original text labels
        container.querySelectorAll('[data-original-text]').forEach(el => {
            el.textContent = el.getAttribute('data-original-text');
            el.removeAttribute('data-original-text');
        });

        if (!vlOverlay.svg || actionViewMode !== 'delta') return;

        // Choose deltas based on the SLD tab being shown
        const deltas: Record<string, FlowDelta> | null | undefined =
            vlOverlay.tab === 'n-1' ? n1FlowDeltas
            : vlOverlay.tab === 'action' ? actionFlowDeltas
            : null;

        if (!deltas) return;

        // Build a quick lookup of all SVG elements that carry an id
        const elMap = new Map<string, Element>();
        container.querySelectorAll('[id]').forEach(el => elMap.set(el.id, el));

        for (const [lineId, delta] of Object.entries(deltas)) {
            const cls = `sld-delta-${delta.category}`;

            // Find ALL elements whose id contains this equipment ID
            const matchedEls: Element[] = [];
            for (const [svgId, svgEl] of elMap) {
                if (svgId === lineId || svgId.includes(lineId)) {
                    matchedEls.push(svgEl);
                }
            }
            if (matchedEls.length === 0) continue;

            // Walk up to feeder groups (sld-top-feeder / sld-bottom-feeder) so the
            // CSS class cascades to all child wires, symbols, and arrows.
            const feederGroups = new Set<Element>();
            for (const el of matchedEls) {
                let cur: Element | null = el;
                while (cur && cur !== container) {
                    if (cur.classList.contains('sld-top-feeder') ||
                        cur.classList.contains('sld-bottom-feeder')) {
                        feederGroups.add(cur);
                        break;
                    }
                    cur = cur.parentElement;
                }
            }

            // Apply class to feeder groups if found, otherwise to matched elements
            const targets = feederGroups.size > 0
                ? Array.from(feederGroups)
                : matchedEls;
            for (const t of targets) t.classList.add(cls);

            // Replace active-power text labels with delta values
            const deltaStr = delta.delta >= 0 ? `+${delta.delta.toFixed(1)}` : delta.delta.toFixed(1);
            for (const t of targets) {
                // Prefer .sld-active-power labels; fall back to all .sld-label
                let labels = t.querySelectorAll('.sld-active-power .sld-label');
                if (labels.length === 0) labels = t.querySelectorAll('.sld-label');
                labels.forEach(label => {
                    const text = (label.textContent || '').trim();
                    if (/^-?\d+(\.\d+)?$/.test(text)) {
                        if (!label.hasAttribute('data-original-text')) {
                            label.setAttribute('data-original-text', label.textContent || '');
                        }
                        label.textContent = `\u0394 ${deltaStr}`;
                    }
                });
            }
        }
    }, [vlOverlay.svg, vlOverlay.tab, actionViewMode, n1FlowDeltas, actionFlowDeltas]);

    // Non-passive wheel zoom on overlay body
    useEffect(() => {
        const el = overlayBodyRef.current;
        if (!el) return;
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
            const rect = el.getBoundingClientRect();
            const cx = e.clientX - rect.left;
            const cy = e.clientY - rect.top;
            setOverlayTransform(prev => {
                const s = Math.max(0.1, Math.min(10, prev.scale * factor));
                return { scale: s, tx: cx - (cx - prev.tx) * (s / prev.scale), ty: cy - (cy - prev.ty) * (s / prev.scale) };
            });
        };
        el.addEventListener('wheel', onWheel, { passive: false });
        return () => el.removeEventListener('wheel', onWheel);
    }, []);

    const startOverlayDrag = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const x0 = e.clientX, y0 = e.clientY;
        const px0 = overlayPos.x, py0 = overlayPos.y;
        const onMove = (ev: MouseEvent) => setOverlayPos({ x: px0 + ev.clientX - x0, y: py0 + ev.clientY - y0 });
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    const startOverlayPan = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        const x0 = e.clientX, y0 = e.clientY;
        const tx0 = overlayTransform.tx, ty0 = overlayTransform.ty;
        const onMove = (ev: MouseEvent) => setOverlayTransform(prev => ({ ...prev, tx: tx0 + ev.clientX - x0, ty: ty0 + ev.clientY - y0 }));
        const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    };

    return (
        <div style={{
            position: 'absolute', top: overlayPos.y + 'px', left: overlayPos.x + 'px',
            width: '440px', height: '420px', minWidth: '220px', minHeight: '150px',
            background: 'white', border: '1px solid #ccc', borderRadius: '8px',
            boxShadow: '0 4px 24px rgba(0,0,0,0.22)', zIndex: 45,
            display: 'flex', flexDirection: 'column', overflow: 'hidden',
            resize: 'both', boxSizing: 'border-box',
        }}>
            {/* Header — drag handle */}
            <div
                onMouseDown={startOverlayDrag}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', background: '#f0faf4', borderBottom: '1px solid #d1fae5', flexShrink: 0, cursor: 'move', userSelect: 'none' }}
            >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#065f46' }}>{vlOverlay.vlName}</span>
                        {/* Mode indicator — shows which Flow vs Impact mode was active when overlay opened */}
                        <span style={{
                            fontSize: '10px', fontWeight: 700, padding: '1px 6px', borderRadius: '10px',
                            background: actionViewMode === 'delta' ? '#dbeafe' : '#f3f4f6',
                            color: actionViewMode === 'delta' ? '#1d4ed8' : '#374151',
                        }}>
                            {actionViewMode === 'delta' ? 'Impacts' : 'Flows'}
                        </span>
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {(['n', 'n-1', 'action'] as SldTab[]).map(tabMode => (
                            <button
                                key={tabMode}
                                onMouseDown={e => e.stopPropagation()}
                                onClick={(e) => { e.stopPropagation(); onOverlaySldTabChange(tabMode); }}
                                style={{
                                    background: vlOverlay.tab === tabMode ? '#059669' : '#e5e7eb',
                                    color: vlOverlay.tab === tabMode ? 'white' : '#374151',
                                    border: 'none', borderRadius: '4px', padding: '2px 8px',
                                    fontSize: '11px', fontWeight: vlOverlay.tab === tabMode ? 'bold' : 'normal',
                                    cursor: vlOverlay.loading ? 'wait' : 'pointer',
                                }}
                            >
                                {tabMode.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
                <button
                    onMouseDown={e => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); onOverlayClose(); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: '16px', color: '#666', lineHeight: 1, padding: '0 2px' }}
                    title="Close"
                >✕</button>
            </div>
            {/* Body — pan/zoom canvas */}
            <div
                ref={overlayBodyRef}
                style={{ flex: 1, overflow: 'hidden', minHeight: 0, cursor: 'grab', userSelect: 'none' }}
                onMouseDown={startOverlayPan}
            >
                {vlOverlay.loading && (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#999', fontSize: '13px' }}>
                        Generating diagram…
                    </div>
                )}
                {vlOverlay.error && (
                    <div style={{ padding: '12px', color: '#dc3545', fontSize: '12px' }}>{vlOverlay.error}</div>
                )}
                {vlOverlay.svg && (
                    <div style={{
                        transformOrigin: '0 0',
                        transform: `translate(${overlayTransform.tx}px,${overlayTransform.ty}px) scale(${overlayTransform.scale})`,
                        padding: '4px',
                    }} dangerouslySetInnerHTML={{ __html: vlOverlay.svg }} />
                )}
            </div>
        </div>
    );
};

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
    vlOverlay,
    onOverlayClose,
    onOverlaySldTabChange,
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

                {/* SLD Overlay — floating panel for voltage-level Single Line Diagram.
                    key={vlOverlay.vlName} ensures position/zoom resets automatically
                    when a different VL is selected. */}
                {vlOverlay && (
                    <SldOverlay
                        key={vlOverlay.vlName}
                        vlOverlay={vlOverlay}
                        actionViewMode={actionViewMode}
                        n1FlowDeltas={n1Diagram?.flow_deltas}
                        actionFlowDeltas={actionDiagram?.flow_deltas}
                        onOverlayClose={onOverlayClose}
                        onOverlaySldTabChange={onOverlaySldTabChange}
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
