// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActionDetail, DiagramData, MetadataIndex, ViewBox } from '../types';
import {
    applyActionOverviewPins,
    buildActionOverviewPins,
    computeActionOverviewFitRect,
    computeEquipmentFitRect,
    rescaleActionOverviewPins,
} from '../utils/svgUtils';
import { usePanZoom } from '../hooks/usePanZoom';

/**
 * Action-overview diagram.
 *
 * When the Remedial Action tab is opened without any action card
 * selected, this view is rendered inside that tab. It shows the
 * N-1 NAD as an immutable background and overlays one Google-Maps
 * style pin per prioritised action, anchored on the asset the
 * corresponding action card highlights in its badges.
 *
 * Interactions supported here:
 *  - auto-zoom on open to the bounding rectangle of
 *    (contingency + overloads + all pins), with a small margin
 *  - wheel-zoom + drag-pan via the shared `usePanZoom` hook
 *  - local zoom-in / zoom-out / reset buttons
 *  - asset-focus inspect search that pans/zooms to a named
 *    equipment (line or voltage-level) using the same metadata
 *    index as the rest of the NAD highlights
 *  - pin click → delegate to the existing action-select flow,
 *    which folds this view away and reveals the detailed
 *    action-variant diagram with all its existing interactions
 */
interface ActionOverviewDiagramProps {
    n1Diagram: DiagramData | null;
    n1MetaIndex: MetadataIndex | null;
    actions: Record<string, ActionDetail> | undefined;
    monitoringFactor: number;
    /** Invoked when a pin is clicked — wired to the existing action-select flow. */
    onActionSelect: (actionId: string) => void;
    /** Current contingency (selected branch) — included in the auto-fit rectangle. */
    contingency: string | null;
    /** Overloaded lines in the N-1 state — included in the auto-fit rectangle. */
    overloadedLines: readonly string[];
    /** Searchable equipment ids for the inspect field. */
    inspectableItems: readonly string[];
    visible: boolean;
}

const ZOOM_STEP_IN = 0.8;
const ZOOM_STEP_OUT = 1.25;

const scaleViewBox = (vb: ViewBox, factor: number): ViewBox => ({
    x: vb.x + (vb.w * (1 - factor)) / 2,
    y: vb.y + (vb.h * (1 - factor)) / 2,
    w: vb.w * factor,
    h: vb.h * factor,
});

const ActionOverviewDiagram: React.FC<ActionOverviewDiagramProps> = ({
    n1Diagram,
    n1MetaIndex,
    actions,
    monitoringFactor,
    onActionSelect,
    contingency,
    overloadedLines,
    inspectableItems,
    visible,
}) => {
    const containerRef = useRef<HTMLDivElement | null>(null);
    // Pull the svg string into a local so the React Compiler can
    // see that both the injection effect and the initialViewBox memo
    // depend on the same primitive, not on the full `n1Diagram`
    // object identity.
    const svgString = n1Diagram?.svg ?? null;
    // `svgReady` is derived, not stateful: svg injection happens
    // synchronously in the layout effect below (which is declared
    // BEFORE usePanZoom so its layout effect runs first, i.e. the
    // DOM is already populated by the time usePanZoom caches its
    // svgElRef). Once the string is in hand the svg IS in the DOM.
    const svgReady = svgString != null;

    const pins = useMemo(() => {
        if (!n1MetaIndex || !actions) return [];
        return buildActionOverviewPins(actions, n1MetaIndex, monitoringFactor);
    }, [n1MetaIndex, actions, monitoringFactor]);

    // Deterministic auto-fit rectangle derived from the bounding
    // box of contingency + overloads + pins. Recomputed whenever any
    // of those inputs changes — the new object identity propagates
    // into `usePanZoom` via its `initialViewBox` effect, which
    // re-applies the fit automatically.
    const fitRect = useMemo<ViewBox | null>(() => {
        if (!n1MetaIndex) return null;
        return computeActionOverviewFitRect(n1MetaIndex, contingency, overloadedLines, pins);
    }, [n1MetaIndex, contingency, overloadedLines, pins]);

    // Fall back to the original NAD viewBox if we couldn't build a
    // fit rectangle (e.g. no analysis has run yet) — that way the
    // user still sees the full network the moment the tab opens.
    const initialViewBox = useMemo<ViewBox | null>(() => {
        if (fitRect) return fitRect;
        if (!svgString) return null;
        const match = svgString.match(/viewBox=["']([^"']+)["']/);
        if (!match) return null;
        const parts = match[1].split(/\s+|,/).map(parseFloat);
        if (parts.length !== 4 || parts.some(p => !Number.isFinite(p))) return null;
        return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }, [fitRect, svgString]);

    // Inject (or re-inject) the N-1 SVG into our own container.
    // Using innerHTML is intentional: we want a standalone DOM
    // subtree so nothing clashes with the main-window pan/zoom
    // infra that drives the N-1 and action-variant tabs.
    //
    // DECLARED BEFORE `usePanZoom` so React runs this layout
    // effect first and the hook can cache its svgElRef against the
    // freshly-injected element.
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!svgString) {
            container.innerHTML = '';
            return;
        }
        container.innerHTML = svgString;
        const svg = container.querySelector('svg');
        if (svg) {
            // Let the SVG fill the container. The viewBox is the
            // only thing usePanZoom manipulates, so width/height
            // 100% gives a stable mapping from SVG coords to
            // screen coords.
            svg.setAttribute('width', '100%');
            svg.setAttribute('height', '100%');
            svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
            (svg as SVGSVGElement).style.width = '100%';
            (svg as SVGSVGElement).style.height = '100%';
        }
    }, [svgString]);

    // The hook handles wheel-zoom and drag-pan on the container.
    // `active` gates the event listeners so an invisible overview
    // doesn't steal wheel events from other tabs.
    const pz = usePanZoom(containerRef, initialViewBox, visible && svgReady);

    // Asset-focus "consume once" tracking — declared up here so
    // `handleReset` (defined just below) can clear it.
    //
    // Mirrors the pattern used by `useDiagrams` for the main
    // inspect field (see `lastZoomState` and the auto-zoom
    // effect around useDiagrams.ts:787): only apply the zoom
    // when the resolved query TRANSITIONS to a new value. If we
    // re-ran the zoom on every dependency change (e.g. every
    // time `pz.viewBox` updates on wheel-zoom), the user would
    // get yanked back onto the asset the moment they try to
    // zoom out — the "sticking" bug.
    const lastFocusedRef = useRef<string | null>(null);

    // (Re)apply pins whenever the source SVG or pin list changes.
    // Pins are appended to the SVG itself (not to the container
    // div) so the existing viewBox-based pan/zoom naturally
    // transforms them with the rest of the diagram.
    useEffect(() => {
        if (!svgReady) return;
        const container = containerRef.current;
        if (!container) return;
        applyActionOverviewPins(container, pins, onActionSelect);
    }, [pins, onActionSelect, svgReady, svgString]);

    // Screen-constant pin compensation.
    //
    // The pin glyph is drawn in SVG-space at a base radius equal to
    // the voltage-level circle radius (so at normal zoom they match
    // the VL glyphs). As the operator zooms OUT, the SVG units map
    // to fewer screen pixels and the pins would become tiny dots on
    // large grids. To fight that we upscale the pin body in
    // SVG-space whenever the viewBox changes — same spirit as the
    // non-scaling-stroke trick used on overload / contingency
    // circle halos in App.css.
    //
    // A MutationObserver on the svg's `viewBox` attribute catches
    // every update: the wheel-zoom path in usePanZoom writes the
    // DOM directly (bypassing React state for perf), so a plain
    // `pz.viewBox` useEffect dep would lag behind the live drag.
    useEffect(() => {
        if (!svgReady || !visible) return;
        const container = containerRef.current;
        if (!container) return;
        const svg = container.querySelector('svg');
        if (!svg) return;

        // Initial compensation — pins are already mounted by the
        // applyActionOverviewPins effect above; make sure they
        // come up at the right size on the first paint.
        rescaleActionOverviewPins(container);

        const observer = new MutationObserver(() => {
            rescaleActionOverviewPins(container);
        });
        observer.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
        return () => observer.disconnect();
    }, [svgReady, visible, svgString, pins]);

    // When the view becomes visible for the first time (or again
    // after a round-trip through an action drill-down), re-assert
    // the fit rectangle. Without this, a card selection + deselect
    // would leave the overview on whatever viewBox the user had
    // last panned to — surprising, because the tab is nominally
    // "opening fresh".
    const wasVisibleRef = useRef(false);
    useEffect(() => {
        if (visible && !wasVisibleRef.current && initialViewBox) {
            pz.setViewBox(initialViewBox);
        }
        wasVisibleRef.current = visible;
    }, [visible, initialViewBox, pz]);

    const handleZoomIn = useCallback(() => {
        if (!pz.viewBox) return;
        pz.setViewBox(scaleViewBox(pz.viewBox, ZOOM_STEP_IN));
    }, [pz]);

    const handleZoomOut = useCallback(() => {
        if (!pz.viewBox) return;
        pz.setViewBox(scaleViewBox(pz.viewBox, ZOOM_STEP_OUT));
    }, [pz]);

    const handleReset = useCallback(() => {
        if (initialViewBox) pz.setViewBox(initialViewBox);
        // Clearing here ensures that re-typing the same asset id
        // after a reset will focus it again — without this the
        // consume-once guard would treat the effect re-run as
        // "nothing changed" and silently skip the zoom.
        lastFocusedRef.current = null;
    }, [initialViewBox, pz]);

    // ----- Inspect / asset-focus search -----
    // Kept deliberately local so the overview manages its own
    // focus without plumbing through the detached-tab /
    // tied-tab infrastructure of the main-window inspect field.
    const [inspectQuery, setInspectQuery] = useState('');
    const [inspectFocused, setInspectFocused] = useState(false);
    const closeTimerRef = useRef<number | null>(null);

    const filteredInspectables = useMemo(() => {
        const q = inspectQuery.toUpperCase();
        if (!q) return [] as string[];
        return inspectableItems.filter(item => item.toUpperCase().includes(q)).slice(0, 20);
    }, [inspectQuery, inspectableItems]);

    const exactInspectMatch = useMemo(() => {
        if (!inspectQuery) return null;
        const q = inspectQuery.toUpperCase();
        return inspectableItems.find(item => item.toUpperCase() === q) ?? null;
    }, [inspectQuery, inspectableItems]);

    useEffect(() => {
        if (!svgReady || !visible || !n1MetaIndex) return;
        // Nothing changed — bail out. This is the guard that
        // suppresses re-zooming when the effect re-runs because
        // `pz.viewBox` (and therefore the `pz` object) changed
        // during a user-initiated pan/zoom.
        if (exactInspectMatch === lastFocusedRef.current) return;

        if (exactInspectMatch) {
            // Consume the new query — zoom onto the asset.
            const target = computeEquipmentFitRect(n1MetaIndex, exactInspectMatch);
            if (target) pz.setViewBox(target);
        } else if (lastFocusedRef.current && initialViewBox) {
            // Query cleared (or no longer an exact match): go
            // back to the auto-fit rectangle so the user sees
            // the whole network-plus-pins again.
            pz.setViewBox(initialViewBox);
        }
        lastFocusedRef.current = exactInspectMatch;
    }, [exactInspectMatch, svgReady, visible, n1MetaIndex, pz, initialViewBox]);

    // Imperative zoom helper used by the suggestions dropdown —
    // committing the query through state triggers the effect
    // above, but the dropdown also commits the text value so
    // the click feels instantaneous without waiting for the
    // next effect tick.
    const focusEquipment = useCallback((equipmentId: string) => {
        const target = computeEquipmentFitRect(n1MetaIndex, equipmentId);
        if (target) pz.setViewBox(target);
        lastFocusedRef.current = equipmentId;
    }, [n1MetaIndex, pz]);

    const hasAnyAction = !!actions && Object.keys(actions).length > 0;
    const noBackground = !n1Diagram?.svg;
    const showInspectDropdown = inspectFocused
        && inspectQuery.length > 0
        && filteredInspectables.length > 0
        && !exactInspectMatch;

    return (
        <div
            data-testid="action-overview-diagram"
            style={{
                position: 'absolute',
                inset: 0,
                display: visible ? 'flex' : 'none',
                flexDirection: 'column',
                background: 'white',
                // Sit above the hidden MemoizedSvgContainer for
                // actionDiagram (which stays mounted to preserve
                // zoom state) so clicks land on the overview.
                zIndex: 15,
            }}
        >
            {/* Header strip — title + severity legend, mirrors the
                card palette so the operator understands the colour
                encoding at a glance. */}
            <div
                style={{
                    flexShrink: 0,
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '10px',
                    fontSize: '12px',
                    background: '#f8fafc',
                    borderBottom: '1px solid #e2e8f0',
                    color: '#334155',
                }}
            >
                <div style={{ fontWeight: 700 }}>
                    {'\uD83D\uDCCD Remedial actions overview'}
                    {hasAnyAction && (
                        <span style={{ marginLeft: 8, fontWeight: 400, color: '#64748b' }}>
                            {pins.length} pin{pins.length === 1 ? '' : 's'} on the N-1 network
                        </span>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                    <Legend color="#28a745" label="Solves overload" />
                    <Legend color="#f0ad4e" label="Low margin" />
                    <Legend color="#dc3545" label="Still overloaded" />
                    <Legend color="#9ca3af" label="Divergent / islanded" />
                </div>
            </div>

            {/* SVG body: the pan/zoom container. Wheel + drag work
                via usePanZoom listeners bound in useEffect. */}
            <div
                ref={containerRef}
                className="svg-container nad-action-overview-container"
                style={{
                    flex: 1,
                    overflow: 'hidden',
                    position: 'relative',
                }}
            />

            {/* Bottom-left control cluster: zoom buttons + inspect
                search. Rendered inside the overview's own flex
                layout (not via renderTabOverlay) so they are
                trivially shown/hidden with the overview itself. */}
            {svgReady && (
                <div
                    data-testid="overview-controls"
                    style={{
                        position: 'absolute',
                        bottom: 12,
                        left: 12,
                        zIndex: 100,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        alignItems: 'flex-start',
                        pointerEvents: 'none',
                    }}
                >
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', pointerEvents: 'auto' }}>
                        <button
                            onClick={handleZoomIn}
                            title="Zoom In"
                            style={controlButtonStyle}
                        >
                            +
                        </button>
                        <button
                            onClick={handleReset}
                            title="Reset view to auto-fit (contingency + overloads + pins)"
                            style={{ ...controlButtonStyle, padding: '5px 14px', fontSize: 12 }}
                        >
                            {'\uD83D\uDD0D Fit'}
                        </button>
                        <button
                            onClick={handleZoomOut}
                            title="Zoom Out"
                            style={controlButtonStyle}
                        >
                            -
                        </button>
                    </div>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center', position: 'relative', pointerEvents: 'auto' }}>
                        <div style={{ position: 'relative' }}>
                            <input
                                data-testid="overview-inspect-input"
                                value={inspectQuery}
                                onChange={e => setInspectQuery(e.target.value)}
                                onFocus={() => {
                                    if (closeTimerRef.current !== null) {
                                        window.clearTimeout(closeTimerRef.current);
                                        closeTimerRef.current = null;
                                    }
                                    setInspectFocused(true);
                                }}
                                onBlur={() => {
                                    closeTimerRef.current = window.setTimeout(() => {
                                        setInspectFocused(false);
                                        closeTimerRef.current = null;
                                    }, 150);
                                }}
                                placeholder="🔍 Focus asset..."
                                style={{
                                    padding: '5px 10px',
                                    border: inspectQuery ? '2px solid #3498db' : '1px solid #ccc',
                                    borderRadius: 4,
                                    fontSize: 12,
                                    width: 180,
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                    background: 'white',
                                }}
                            />
                            {showInspectDropdown && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        bottom: '100%',
                                        left: 0,
                                        marginBottom: 4,
                                        width: 220,
                                        maxHeight: 220,
                                        overflowY: 'auto',
                                        background: 'white',
                                        border: '1px solid #3498db',
                                        borderRadius: 4,
                                        boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                                        zIndex: 200,
                                        fontSize: 12,
                                    }}
                                >
                                    {filteredInspectables.map(item => (
                                        <div
                                            key={item}
                                            onMouseDown={e => {
                                                e.preventDefault();
                                                setInspectQuery(item);
                                                focusEquipment(item);
                                            }}
                                            style={{
                                                padding: '5px 10px',
                                                cursor: 'pointer',
                                                borderBottom: '1px solid #eee',
                                                whiteSpace: 'nowrap',
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                            }}
                                            onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f0f8ff'; }}
                                            onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.backgroundColor = 'white'; }}
                                        >
                                            {item}
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                        {inspectQuery && (
                            <button
                                onClick={() => setInspectQuery('')}
                                style={{
                                    background: '#e74c3c', color: 'white', border: 'none',
                                    borderRadius: 4, padding: '4px 8px', cursor: 'pointer',
                                    fontSize: 12, boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                }}
                                title="Clear"
                            >
                                X
                            </button>
                        )}
                    </div>
                </div>
            )}

            {noBackground && (
                <div style={{
                    position: 'absolute', inset: 0, top: 40,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#999', fontStyle: 'italic', textAlign: 'center', padding: '40px',
                    pointerEvents: 'none',
                }}>
                    Load a contingency first, then run the analysis to populate this overview.
                </div>
            )}
            {!noBackground && !hasAnyAction && (
                <div style={{
                    position: 'absolute', inset: 0, top: 40,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    color: '#999', fontStyle: 'italic', textAlign: 'center', padding: '40px',
                    pointerEvents: 'none',
                }}>
                    Run &ldquo;Analyze &amp; Suggest&rdquo; to see prioritised remedial actions as pins on the network.
                </div>
            )}
        </div>
    );
};

const controlButtonStyle: React.CSSProperties = {
    background: 'white',
    color: '#333',
    border: '1px solid #ccc',
    borderRadius: 4,
    padding: '5px 12px',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
};

const Legend: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <span
            aria-hidden
            style={{
                display: 'inline-block',
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: color,
            }}
        />
        <span style={{ color: '#475569' }}>{label}</span>
    </span>
);

export default React.memo(ActionOverviewDiagram);
