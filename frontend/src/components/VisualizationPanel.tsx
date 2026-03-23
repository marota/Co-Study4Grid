import React, { useState, useEffect, useRef, type RefObject } from 'react';
import type { DiagramData, AnalysisResult, TabId, VlOverlay, SldTab, SldFeederNode } from '../types';

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

// ===== SLD Overlay sub-component =====
// Extracted to own component so React resets its local state (position, transform)
// automatically via key={vlOverlay.vlName} when a new VL is selected.
interface SldOverlayProps {
    vlOverlay: VlOverlay;
    actionViewMode: 'network' | 'delta';
    onOverlayClose: () => void;
    onOverlaySldTabChange: (tab: SldTab) => void;
    n1Diagram: DiagramData | null;
    actionDiagram: DiagramData | null;
}

// ===== Memoized SVG Container =====
// Prevents React from diffing massive SVG strings on every parent render
interface SvgContainerProps {
    svg: string;
    containerRef: RefObject<HTMLDivElement | null>;
    display: string;
    tabId: TabId;
}
const MemoizedSvgContainer = React.memo(({ svg, containerRef, display, tabId }: SvgContainerProps) => (
    <div
        ref={containerRef}
        className="svg-container"
        id={`${tabId}-svg-container`}
        style={{ display, width: '100%', height: '100%', overflow: 'hidden' }}
        dangerouslySetInnerHTML={{ __html: svg }}
    />
));

const SldOverlay: React.FC<SldOverlayProps> = ({
    vlOverlay, actionViewMode,
    onOverlayClose, onOverlaySldTabChange,
    n1Diagram, actionDiagram,
}) => {
    const overlayBodyRef = useRef<HTMLDivElement>(null);
    const [overlayPos, setOverlayPos] = useState({ x: 16, y: 16 });
    const [overlayTransform, setOverlayTransform] = useState({ scale: 1, tx: 0, ty: 0 });

    // Apply / clear delta flow colors on the SLD whenever svg/metadata, tab, or mode changes.
    //
    // pypowsybl SLD SVG structure (GraphMetadata):
    //   feederNodes[].id         → SVG element ID of the feeder <g> (sld-top-feeder / sld-bottom-feeder)
    //   feederNodes[].equipmentId → network equipment ID (matches flow_deltas keys)
    //
    // The cell ancestor (sld-extern-cell) wraps BOTH the feeder symbol AND the connecting
    // wire (sld-wire), so we must apply the delta class one level up to color the full branch.
    useEffect(() => {
        const container = overlayBodyRef.current;
        if (!container) return;

        // Clear any previously applied SLD delta classes
        const SLD_DELTA_CLASSES = [
            'sld-delta-positive', 'sld-delta-negative', 'sld-delta-grey',
            'sld-delta-text-positive', 'sld-delta-text-negative', 'sld-delta-text-grey'
        ];
        container.querySelectorAll(SLD_DELTA_CLASSES.map(c => '.' + c).join(','))
            .forEach(el => el.classList.remove(...SLD_DELTA_CLASSES));

        // Restore original text labels
        container.querySelectorAll('[data-original-text]').forEach(el => {
            el.textContent = el.getAttribute('data-original-text');
            el.removeAttribute('data-original-text');
        });

        // Restore flipped arrow directions (sld-in ↔ sld-out)
        container.querySelectorAll('[data-arrow-flipped]').forEach(el => {
            if (el.classList.contains('sld-in')) {
                el.classList.replace('sld-in', 'sld-out');
            } else if (el.classList.contains('sld-out')) {
                el.classList.replace('sld-out', 'sld-in');
            }
            el.removeAttribute('data-arrow-flipped');
        });

        if (!vlOverlay.svg || actionViewMode !== 'delta') return;

        // Choose deltas based on the SLD tab being shown
        const flowDeltas = vlOverlay.flow_deltas;
        const reactiveDeltas = vlOverlay.reactive_flow_deltas;
        const assetDeltas = vlOverlay.asset_deltas;

        if (!flowDeltas && !assetDeltas) return;

        // Build equipmentId → [svgId, ...] multimap from SLD metadata.
        // pypowsybl SLD metadata uses 'nodes' (for lines, transformers, breakers,
        // bus-bar sections) and 'feederInfos' (for ARROW_ACTIVE/ARROW_REACTIVE).
        // Older versions may use 'feederNodes' instead.
        const equipIdToSvgIds = new Map<string, string[]>();
        if (vlOverlay.sldMetadata) {
            try {
                const meta = JSON.parse(vlOverlay.sldMetadata) as {
                    nodes?: SldFeederNode[];
                    feederInfos?: SldFeederNode[];
                    feederNodes?: SldFeederNode[];
                };
                // Collect entries from all possible metadata arrays
                const sources = [
                    ...(meta.nodes ?? []),
                    ...(meta.feederInfos ?? []),
                    ...(meta.feederNodes ?? []),
                ];
                for (const fn of sources) {
                    if (fn.equipmentId && fn.id) {
                        const ids = equipIdToSvgIds.get(fn.equipmentId) ?? [];
                        ids.push(fn.id);
                        equipIdToSvgIds.set(fn.equipmentId, ids);
                    }
                }
            } catch {
                // metadata parse failed — fall through to substring fallback
            }
        }

        // Quick lookup of all elements by SVG id
        const elMap = new Map<string, Element>();
        container.querySelectorAll('[id]').forEach(el => elMap.set(el.id, el));

        /**
         * Look up an SVG element by ID, trying the exact ID first and then
         * common sanitization variants (pypowsybl sometimes replaces dots with
         * underscores in SVG element IDs while preserving the original in metadata).
         */
        const lookupById = (svgId: string): Element | undefined =>
            elMap.get(svgId)
            ?? elMap.get(svgId.replace(/\./g, '_'))   // dots → underscores
            ?? elMap.get(svgId.replace(/_/g, '.'));    // underscores → dots

        /**
         * Look up a key in a Record, trying the exact key first and then
         * dot↔underscore variants.  pypowsybl may sanitize dots in equipment
         * IDs differently between get_lines() (used for flow_deltas keys) and
         * SLD metadata (used for equipmentId).
         */
        const lookupDelta = <T,>(rec: Record<string, T> | null | undefined, key: string): T | undefined => {
            if (!rec) return undefined;
            const exact = rec[key];
            if (exact !== undefined) return exact;
            const dotted = key.replace(/_/g, '.');
            if (dotted !== key && rec[dotted] !== undefined) return rec[dotted];
            const underscored = key.replace(/\./g, '_');
            if (underscored !== key && rec[underscored] !== undefined) return rec[underscored];
            return undefined;
        };

        const applyTextDelta = (label: Element, val: string) => {
            if (!label.hasAttribute('data-original-text')) {
                label.setAttribute('data-original-text', label.textContent || '');
            }
            label.textContent = `\u0394 ${val}`;
        };

        const fmtDelta = (v: number) => v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1);

        /** Walk up from a feeder element to the enclosing cell ancestor. */
        const walkUpToCell = (feederEl: Element): Element => {
            let cellEl: Element = feederEl;
            let cur: Element | null = feederEl.parentElement;
            while (cur && cur !== container) {
                if (cur.classList.contains('sld-extern-cell') ||
                    cur.classList.contains('sld-intern-cell') ||
                    cur.classList.contains('sld-shunt-cell')) {
                    cellEl = cur;
                    break;
                }
                cur = cur.parentElement;
            }
            return cellEl;
        };

        /**
         * Find the cell ancestor element for a given equipment ID.
         * Tries the metadata-based SVG IDs first (with sanitization variants),
         * then falls back to substring matching against all element IDs.
         */
        const findCellEl = (equipId: string): Element | null => {
            let feederEl: Element | undefined;
            // Try exact key, then dot↔underscore variants in metadata map
            const svgIds = equipIdToSvgIds.get(equipId)
                ?? equipIdToSvgIds.get(equipId.replace(/\./g, '_'))
                ?? equipIdToSvgIds.get(equipId.replace(/_/g, '.'));
            if (svgIds) {
                for (const svgId of svgIds) {
                    feederEl = lookupById(svgId);
                    if (feederEl) break;
                }
            }
            if (!feederEl) {
                // Substring fallback: also try with dots replaced by underscores
                const sanitized = equipId.replace(/\./g, '_');
                for (const [eid, el] of elMap) {
                    if (eid.includes(equipId) || (sanitized !== equipId && eid.includes(sanitized))) {
                        feederEl = el;
                        break;
                    }
                }
            }
            if (!feederEl) return null;
            return walkUpToCell(feederEl);
        };

        /** Replace the first numeric label in a query result with a delta string. */
        const replaceFirstNumericLabel = (labels: NodeListOf<Element>, val: string) => {
            for (const label of Array.from(labels)) {
                if (/^-?\d+(\.\d+)?$/.test((label.textContent || '').trim())) {
                    applyTextDelta(label, val);
                    return;
                }
            }
        };

        // Helper to apply P & Q delta text to a cell element
        const applyPQLabels = (cellEl: Element, pStr: string, qStr: string | null) => {
            let pLabels = cellEl.querySelectorAll('.sld-active-power .sld-label');
            if (pLabels.length === 0) pLabels = cellEl.querySelectorAll('.sld-label');
            replaceFirstNumericLabel(pLabels, pStr);

            if (qStr !== null) {
                const qLabels = cellEl.querySelectorAll('.sld-reactive-power .sld-label');
                if (qLabels.length > 0) {
                    replaceFirstNumericLabel(qLabels, qStr);
                } else {
                    // Fallback: P label already replaced (no longer numeric),
                    // so the first remaining numeric label IS the Q label.
                    replaceFirstNumericLabel(cellEl.querySelectorAll('.sld-label'), qStr);
                }
            }
        };

        /** Flip arrow direction within a specific power-type scope.
         *  pypowsybl SLD SVGs use .sld-in / .sld-out classes to control
         *  which arrow (.sld-arrow-in / .sld-arrow-out) is visible.
         *  P and Q arrows are flipped independently by scoping to
         *  .sld-active-power or .sld-reactive-power. */
        const flipArrows = (cellEl: Element, scopeClass: string) => {
            const sel = `.${scopeClass} .sld-in, .${scopeClass} .sld-out, .${scopeClass}.sld-in, .${scopeClass}.sld-out`;
            cellEl.querySelectorAll(sel).forEach(el => {
                if (el.hasAttribute('data-arrow-flipped')) return;
                if (el.classList.contains('sld-in')) {
                    el.classList.replace('sld-in', 'sld-out');
                } else {
                    el.classList.replace('sld-out', 'sld-in');
                }
                el.setAttribute('data-arrow-flipped', '1');
            });
        };

        // Iterate ALL feeders from SLD metadata so we process branches, loads,
        // and generators — not just equipment IDs found in flow_deltas.
        const processedEquipIds = new Set<string>();

        for (const [equipId, svgIds] of equipIdToSvgIds) {
            // Find the first matching feeder element across all SVG IDs for this equipment
            let feederEl: Element | undefined;
            for (const svgId of svgIds) {
                feederEl = lookupById(svgId);
                if (feederEl) break;
            }
            if (!feederEl) continue;

            const cellEl = walkUpToCell(feederEl);

            // Check branch (line/transformer) deltas first
            const branchDelta = lookupDelta(flowDeltas, equipId);
            if (branchDelta) {
                cellEl.classList.add(`sld-delta-${branchDelta.category}`);

                const pStr = fmtDelta(branchDelta.delta);
                const qDelta = lookupDelta(reactiveDeltas, equipId);
                const qStr = qDelta !== undefined ? fmtDelta(qDelta.delta) : null;

                // Always apply labels to ensure original flows are replaced
                applyPQLabels(cellEl, pStr, qStr);

                // Apply specific category classes to the labels instead of the cell
                let pLabels = cellEl.querySelectorAll('.sld-active-power .sld-label');
                if (pLabels.length === 0) pLabels = cellEl.querySelectorAll('.sld-label');
                pLabels.forEach(l => l.classList.add(`sld-delta-text-${branchDelta.category}`));

                if (qDelta) {
                    cellEl.querySelectorAll('.sld-reactive-power .sld-label').forEach(l => l.classList.add(`sld-delta-text-${qDelta.category}`));
                }

                // Flip P and Q arrows independently (regardless of category)
                if (branchDelta.flip_arrow) {
                    flipArrows(cellEl, 'sld-active-power');
                }
                if (qDelta && qDelta.flip_arrow) {
                    flipArrows(cellEl, 'sld-reactive-power');
                }
                processedEquipIds.add(equipId);
                continue;
            }

            // Check asset (load/generator) deltas
            const assetDelta = lookupDelta(assetDeltas, equipId);
            if (assetDelta) {
                cellEl.classList.add(`sld-delta-${assetDelta.category}`);
                const pStr = fmtDelta(assetDelta.delta_p);
                const qStr = fmtDelta(assetDelta.delta_q);
                // Always apply labels to ensure original flows are replaced
                applyPQLabels(cellEl, pStr, qStr);

                // Use independent categories for labels if available
                const catP = assetDelta.category_p || assetDelta.category;
                const catQ = assetDelta.category_q || assetDelta.category;

                cellEl.querySelectorAll('.sld-active-power .sld-label').forEach(l => l.classList.add(`sld-delta-text-${catP}`));
                cellEl.querySelectorAll('.sld-reactive-power .sld-label').forEach(l => l.classList.add(`sld-delta-text-${catQ}`));

                processedEquipIds.add(equipId);
            }
        }

        // Helper: check if an equipment ID (or a dot↔underscore variant) was
        // already processed in the metadata-based loop above.
        const isProcessed = (id: string): boolean =>
            processedEquipIds.has(id)
            || processedEquipIds.has(id.replace(/\./g, '_'))
            || processedEquipIds.has(id.replace(/_/g, '.'));

        // Fallback: process any flow_deltas / asset_deltas keys not found
        // via metadata (in case metadata was incomplete or parse failed).
        for (const [equipId, delta] of Object.entries(flowDeltas ?? {})) {
            if (isProcessed(equipId)) continue;
            const cellEl = findCellEl(equipId);
            if (!cellEl) continue;
            const pStr = fmtDelta(delta.delta);
            const qDelta = lookupDelta(reactiveDeltas, equipId);
            const qStr = qDelta !== undefined ? fmtDelta(qDelta.delta) : null;

            // Always apply labels to ensure original flows are replaced
            applyPQLabels(cellEl, pStr, qStr);

            let pLabels = cellEl.querySelectorAll('.sld-active-power .sld-label');
            if (pLabels.length === 0) pLabels = cellEl.querySelectorAll('.sld-label');
            pLabels.forEach(l => l.classList.add(`sld-delta-text-${delta.category}`));

            if (qDelta) {
                cellEl.querySelectorAll('.sld-reactive-power .sld-label').forEach(l => l.classList.add(`sld-delta-text-${qDelta.category}`));
            }

            if (delta.flip_arrow) flipArrows(cellEl, 'sld-active-power');
            const qDeltaForFlip = lookupDelta(reactiveDeltas, equipId);
            if (qDeltaForFlip && qDeltaForFlip.flip_arrow) flipArrows(cellEl, 'sld-reactive-power');
        }
        for (const [equipId, assetDelta] of Object.entries(assetDeltas ?? {})) {
            if (isProcessed(equipId)) continue;
            if (lookupDelta(flowDeltas, equipId) !== undefined) continue;
            const cellEl = findCellEl(equipId);
            if (!cellEl) continue;
            if (assetDelta.category !== 'grey' || (assetDelta.category_q && assetDelta.category_q !== 'grey')) {
                const pStr = fmtDelta(assetDelta.delta_p);
                const qStr = fmtDelta(assetDelta.delta_q);
                // Always apply labels to ensure original flows are replaced
                applyPQLabels(cellEl, pStr, qStr);

                const catP = assetDelta.category_p || assetDelta.category;
                const catQ = assetDelta.category_q || assetDelta.category;

                cellEl.querySelectorAll('.sld-active-power .sld-label').forEach(l => l.classList.add(`sld-delta-text-${catP}`));
                cellEl.querySelectorAll('.sld-reactive-power .sld-label').forEach(l => l.classList.add(`sld-delta-text-${catQ}`));
            }
        }
    }, [vlOverlay.svg, vlOverlay.sldMetadata, vlOverlay.tab, actionViewMode,
    vlOverlay.flow_deltas, vlOverlay.reactive_flow_deltas, vlOverlay.asset_deltas]);

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
                        {(['n', 'n-1', 'action'] as SldTab[]).filter(tabMode => {
                            if (tabMode === 'n-1') return !!n1Diagram;
                            if (tabMode === 'action') return !!actionDiagram;
                            return true; // always show N
                        }).map(tabMode => (
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

    const hasAnyDiagram = !!(nDiagram?.svg || n1Diagram?.svg || actionDiagram?.svg);
    const showPathWarning = !warningDismissed && !hasAnyDiagram;

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
                                ) : 'Run analysis to see overflow graph'}
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
                        <MemoizedSvgContainer svg={actionDiagram.svg} containerRef={actionSvgContainerRef} display="block" tabId="action" />
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
                        onOverlayClose={onOverlayClose}
                        onOverlaySldTabChange={onOverlaySldTabChange}
                        n1Diagram={n1Diagram}
                        actionDiagram={actionDiagram}
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

export default VisualizationPanel;
