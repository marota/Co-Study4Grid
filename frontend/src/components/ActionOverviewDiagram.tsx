// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { ActionDetail, DiagramData, MetadataIndex, ViewBox } from '../types';
import {
    applyActionOverviewHighlights,
    applyActionOverviewPins,
    buildActionOverviewPins,
    computeActionOverviewFitRect,
    computeEquipmentFitRect,
    invalidateIdMapCache,
    rescaleActionOverviewPins,
} from '../utils/svgUtils';
import { usePanZoom } from '../hooks/usePanZoom';
import ActionCardPopover from './ActionCardPopover';
import {
    POPOVER_WIDTH,
    POPOVER_MAX_HEIGHT,
    decidePopoverPlacement,
    computePopoverStyle,
} from '../utils/popoverPlacement';

/** Measure a named code section and log it to the console + Performance timeline. */
const perfMeasure = (name: string, startMark: string, endMark: string) => {
    const entry = performance.measure(name, startMark, endMark);
    console.log(`[PERF] ${name}: ${entry.duration.toFixed(2)}ms`);
};

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
    /**
     * Called with a pin id on a DOUBLE click — this is the
     * "activate the action drill-down view" path. The parent
     * wires it to the existing action-select flow so the action
     * network diagram replaces the overview in the tab.
     */
    onActionSelect: (actionId: string) => void;
    /** Toggle the favourite status of an action (popover action). */
    onActionFavorite?: (actionId: string) => void;
    /** Reject an action (popover action). */
    onActionReject?: (actionId: string) => void;
    /** Selected-action set, for the popover's `isSelected` styling. */
    selectedActionIds?: Set<string>;
    /** Rejected-action set, for the popover's `isRejected` styling. */
    rejectedActionIds?: Set<string>;
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
    onActionFavorite,
    onActionReject,
    selectedActionIds,
    rejectedActionIds,
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

    // Pre-parse the SVG string into an SVGSVGElement so the layout
    // effect below can inject it with `replaceChildren()` — zero
    // extra parse, matching the MemoizedSvgContainer optimisation
    // used by the N and N-1 tabs.  The dim-layer wrapping is done
    // here as well (moving children into a `<g>` with reduced
    // opacity) so the DOM mutation happens on the detached element
    // before it enters the live document — no forced layout.
    const preparedSvg = useMemo<SVGSVGElement | null>(() => {
        if (!svgString) return null;
        const start = performance.now();
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svg = doc.documentElement as unknown as SVGSVGElement;
        if (!svg || svg.nodeName !== 'svg') return null;

        // Style the root so it fills the container; viewBox is the
        // only thing usePanZoom manipulates.
        svg.setAttribute('width', '100%');
        svg.setAttribute('height', '100%');
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        // Guard: jsdom's DOMParser returns XML documents whose
        // elements lack a `.style` property; real browsers always
        // have it.
        if (svg.style) {
            svg.style.width = '100%';
            svg.style.height = '100%';
        }

        // Dim the network background by inserting a semi-transparent
        // white <rect> that covers the entire viewBox, placed AFTER
        // all the original NAD content.  This dims everything behind
        // it without applying `opacity` to any child element — which
        // avoids creating stacking contexts (CSS per-child opacity)
        // or SVG transparency groups (SVG opacity attribute on <g>),
        // both of which force Chrome's Layerize step to composite
        // each child individually (~25-31s on large grids).
        //
        // Visual stack (back to front):
        //   1. original NAD content (full opacity)
        //   2. white rect overlay (opacity 0.65 → dims to ~35% visible)
        //   3. highlight layer (inserted later by applyActionOverviewHighlights)
        //   4. pin layer (inserted later by applyActionOverviewPins)
        const SVG_NS = 'http://www.w3.org/2000/svg';
        const vb = svg.getAttribute('viewBox');
        if (vb) {
            const parts = vb.split(/[\s,]+/).map(Number);
            if (parts.length === 4) {
                const dimRect = document.createElementNS(SVG_NS, 'rect');
                dimRect.setAttribute('class', 'nad-overview-dim-rect');
                // Extend 10% beyond viewBox on each side to cover any
                // pan-zoom overshoot — the rect is cheap, and gaps at
                // the edges look ugly.
                const margin = Math.max(parts[2], parts[3]) * 0.1;
                dimRect.setAttribute('x', String(parts[0] - margin));
                dimRect.setAttribute('y', String(parts[1] - margin));
                dimRect.setAttribute('width', String(parts[2] + 2 * margin));
                dimRect.setAttribute('height', String(parts[3] + 2 * margin));
                dimRect.setAttribute('fill', 'white');
                dimRect.setAttribute('opacity', '0.65');
                // pointer-events: none so clicks pass through to
                // highlights/pins above OR the NAD content below.
                dimRect.setAttribute('pointer-events', 'none');
                svg.appendChild(dimRect);
            }
        }
        // Mark the SVG so highlight/pin insertion code knows the
        // dimming rect is present and can insert AFTER it.
        svg.classList.add('nad-overview-dimmed');
        console.log(`[SVG] Action overview pre-parse took ${(performance.now() - start).toFixed(2)}ms`);
        return svg;
    }, [svgString]);

    const pins = useMemo(() => {
        if (!n1MetaIndex || !actions) return [];
        performance.mark('aod:buildPins:start');
        const result = buildActionOverviewPins(actions, n1MetaIndex, monitoringFactor);
        performance.mark('aod:buildPins:end');
        perfMeasure('aod:buildPins', 'aod:buildPins:start', 'aod:buildPins:end');
        return result;
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

    // Inject the pre-parsed SVGSVGElement into the container using
    // `replaceChildren()` — zero extra parse, matching the
    // MemoizedSvgContainer optimisation used by the N/N-1 tabs.
    //
    // DECLARED BEFORE `usePanZoom` so React runs this layout
    // effect first and the hook can cache its svgElRef against the
    // freshly-injected element.
    //
    // The dim-layer wrapping has already been done in `preparedSvg`
    // (off-DOM), so this effect only moves the ready element in.
    useLayoutEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        if (!preparedSvg) {
            container.replaceChildren();
            return;
        }
        const start = performance.now();
        container.replaceChildren(preparedSvg);
        // The id-map cache from a previous SVG is now stale.
        invalidateIdMapCache(container);
        console.log(`[SVG] Action overview replaceChildren took ${(performance.now() - start).toFixed(2)}ms`);
    }, [preparedSvg]);

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

    // ----- Click popover -----
    // Single-click on a pin opens a floating ActionCard popover
    // anchored next to the pin in screen coordinates; double-click
    // activates the full action drill-down view (see
    // `handlePinDoubleClick`) and closes the popover.
    //
    // Placement is computed at click time from the pin's screen
    // position relative to the viewport. The popover may sit
    // ABOVE or BELOW the pin (whichever side has more room) and
    // is horizontally aligned LEFT-of, CENTERED-on, or RIGHT-of
    // the pin to avoid clipping at the visualisation panel
    // edges. See `decidePopoverPlacement` for the rules.
    const [popoverPin, setPopoverPin] = useState<{
        id: string;
        screenX: number;
        screenY: number;
        placeAbove: boolean;
        horizontalAlign: 'start' | 'center' | 'end';
    } | null>(null);

    const handlePinClick = useCallback((actionId: string, screenPos: { x: number; y: number }) => {
        performance.mark('aod:pinClick:start');
        const placement = decidePopoverPlacement(screenPos.x, screenPos.y);
        setPopoverPin({
            id: actionId,
            screenX: screenPos.x,
            screenY: screenPos.y,
            ...placement,
        });
        // Measure will complete after React commits the state update.
        requestAnimationFrame(() => {
            performance.mark('aod:pinClick:end');
            perfMeasure('aod:pinClick', 'aod:pinClick:start', 'aod:pinClick:end');
        });
    }, []);

    const handlePinDoubleClick = useCallback((actionId: string) => {
        // Make sure no stale popover is left behind on the way
        // into the drill-down view.
        setPopoverPin(null);
        onActionSelect(actionId);
    }, [onActionSelect]);

    // (Re)apply contingency + overload highlights whenever the
    // contingency or the N-1 overload set changes.  Mirrors what
    // the N-1 tab shows so the operator keeps the same situational
    // awareness on the overview.  The helper inserts a dedicated
    // `.nad-overview-highlight-layer` as a sibling of the dim layer
    // so the halos render at full opacity above the faded
    // background but below the pin layer.
    useEffect(() => {
        if (!svgReady) return;
        const container = containerRef.current;
        if (!container) return;
        performance.mark('aod:highlights:start');
        applyActionOverviewHighlights(container, n1MetaIndex ?? null, contingency, overloadedLines);
        performance.mark('aod:highlights:end');
        perfMeasure('aod:highlights', 'aod:highlights:start', 'aod:highlights:end');
    }, [svgReady, preparedSvg, n1MetaIndex, contingency, overloadedLines]);

    // (Re)apply pins whenever the source SVG or pin list changes.
    // Pins are appended to the SVG itself (not to the container
    // div) so the existing viewBox-based pan/zoom naturally
    // transforms them with the rest of the diagram.
    useEffect(() => {
        if (!svgReady) return;
        const container = containerRef.current;
        if (!container) return;
        performance.mark('aod:applyPins:start');
        applyActionOverviewPins(container, pins, handlePinClick, handlePinDoubleClick);
        performance.mark('aod:applyPins:end');
        perfMeasure('aod:applyPins', 'aod:applyPins:start', 'aod:applyPins:end');
    }, [pins, handlePinClick, handlePinDoubleClick, svgReady, preparedSvg]);

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
    //
    // The rescale call is rAF-throttled because the wheel-zoom and
    // drag-pan paths in usePanZoom mutate the viewBox on every
    // animation frame (and sometimes more than once per frame on
    // wheel bursts). Without throttling, large grids would call
    // `getScreenCTM()` — a forced layout — many times per frame
    // and freeze the page (the "Page ne répondant pas" we saw in
    // the field). One scheduled rescale per frame is enough.
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

        let rafId: number | null = null;
        const scheduleRescale = () => {
            if (rafId !== null) return;
            rafId = requestAnimationFrame(() => {
                rafId = null;
                rescaleActionOverviewPins(container);
            });
        };
        const observer = new MutationObserver(scheduleRescale);
        observer.observe(svg, { attributes: true, attributeFilter: ['viewBox'] });
        return () => {
            observer.disconnect();
            if (rafId !== null) cancelAnimationFrame(rafId);
        };
    }, [svgReady, visible, preparedSvg, pins]);

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

    // ----- Popover dismissal -----
    // Close on Escape, on outside-click, or when visibility is
    // toggled away (e.g. the user switched tabs).
    const popoverRef = useRef<HTMLDivElement | null>(null);
    useEffect(() => {
        if (!popoverPin) return;
        const onDocMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (popoverRef.current && target && popoverRef.current.contains(target)) return;
            // Also ignore clicks on any pin — the pin's own click
            // handler owns the popover-state update and would
            // otherwise race with this listener.
            if (target instanceof Element && target.closest('.nad-action-overview-pin')) return;
            setPopoverPin(null);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setPopoverPin(null);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [popoverPin]);

    // Pre-compute the props ActionCard needs for the popover render.
    const popoverDetails = popoverPin && actions ? actions[popoverPin.id] : null;
    const popoverIndex = useMemo(() => {
        if (!popoverPin || !actions) return 0;
        const keys = Object.keys(actions);
        const idx = keys.indexOf(popoverPin.id);
        return idx < 0 ? 0 : idx;
    }, [popoverPin, actions]);
    // ActionCardPopover wraps the no-op stubs for the
    // re-simulate / asset-click callbacks internally — we only
    // need to pass the minimal set of handlers below.
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

            {/*
              Click popover.
              - Position is fixed (not absolute) because the
                click handler captured screen-space coordinates
                at click time, and we want the popover to land
                exactly next to the pin the operator clicked.
              - `portaled` via React means the popover sits in
                the same React tree as the overview, so React
                owns its lifecycle and we don't need a separate
                reconciliation root.
              - Outside clicks, Escape, and popover close button
                all dismiss it via setPopoverPin(null).
            */}
            {/*
              Popover.
              The ActionCard rendered inside the popover is the
              EXACT SAME `ActionCard` component the sidebar feed
              uses — both callsites import from the same module.
              The `ActionCardPopover` wrapper handles the floating
              chrome (position, close button, shadow) and forwards
              the minimal set of callbacks this preview view
              needs, so when we add or rename a field on
              `ActionCard` we only need to update the feed's
              render call and the popover wrapper — never
              two parallel implementations.
            */}
            {visible && popoverPin && popoverDetails && (
                <ActionCardPopover
                    popoverRef={popoverRef}
                    testId="action-overview-popover"
                    extraDataAttributes={{
                        'data-place-above': popoverPin.placeAbove ? 'true' : 'false',
                        'data-horizontal-align': popoverPin.horizontalAlign,
                    }}
                    actionId={popoverPin.id}
                    details={popoverDetails}
                    index={popoverIndex}
                    style={{
                        ...computePopoverStyle(popoverPin),
                        width: POPOVER_WIDTH,
                        maxHeight: POPOVER_MAX_HEIGHT,
                        overflowY: 'auto',
                    }}
                    linesOverloaded={overloadedLines}
                    monitoringFactor={monitoringFactor}
                    metaIndex={n1MetaIndex ?? null}
                    selectedActionIds={selectedActionIds}
                    rejectedActionIds={rejectedActionIds}
                    onActivateAction={onActionSelect}
                    onActionFavorite={onActionFavorite}
                    onActionReject={onActionReject}
                    onClose={() => setPopoverPin(null)}
                />
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
