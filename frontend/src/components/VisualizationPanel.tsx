// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import React, { useState, useMemo, useRef, type RefObject } from 'react';
import type { DiagramData, AnalysisResult, TabId, VlOverlay, SldTab, MetadataIndex } from '../types';
import MemoizedSvgContainer from './MemoizedSvgContainer';
import SldOverlay from './SldOverlay';
import DetachableTabHost from './DetachableTabHost';
import ActionOverviewDiagram from './ActionOverviewDiagram';
import type { DetachedTabsMap } from '../hooks/useDetachedTabs';

/**
 * Inspect text field + custom suggestions dropdown.
 *
 * This replaces a native <input list=...> + <datalist> pair. The
 * native datalist is unreliable when its owning subtree is physically
 * relocated between documents via DetachableTabHost — Chromium in
 * particular has been observed to show the dropdown in the wrong
 * window (or not at all in the window being typed into) when a tied
 * detached tab shares the same `inspectQuery` state with the main
 * window's active tab overlay.
 *
 * By rendering the suggestion list ourselves, as a plain
 * absolutely-positioned div sibling of the input, the dropdown is
 * guaranteed to live in the same DOM subtree as the input it belongs
 * to, in whichever window that subtree happens to be. It therefore
 * renders reliably whether the overlay sits in the main window or in
 * a detached popup, regardless of the tied state.
 */
const InspectSearchField: React.FC<{
    tabId: TabId;
    inspectQuery: string;
    onChangeQuery: (tab: TabId, q: string) => void;
    filteredInspectables: string[];
}> = ({ tabId, inspectQuery, onChangeQuery, filteredInspectables }) => {
    const [focused, setFocused] = useState(false);
    // Keep the dropdown visible long enough for an option click to
    // register before onBlur hides it (click fires after blur).
    const closeTimer = useRef<number | null>(null);

    // Hide the dropdown after a matched commit so the user isn't left
    // with a hovering suggestion panel while zoomed in on the asset.
    const exactMatch = inspectQuery.length > 0
        && filteredInspectables.some(v => v.toUpperCase() === inspectQuery.toUpperCase());
    const showDropdown = focused && inspectQuery.length > 0 && filteredInspectables.length > 0 && !exactMatch;

    return (
        <div style={{ position: 'relative' }}>
            <input
                value={inspectQuery}
                onChange={e => onChangeQuery(tabId, e.target.value)}
                onFocus={() => {
                    if (closeTimer.current !== null) {
                        window.clearTimeout(closeTimer.current);
                        closeTimer.current = null;
                    }
                    setFocused(true);
                }}
                onBlur={() => {
                    // Defer the hide so onMouseDown on an option can
                    // complete and fire its onClick before the
                    // dropdown unmounts.
                    closeTimer.current = window.setTimeout(() => {
                        setFocused(false);
                        closeTimer.current = null;
                    }, 150);
                }}
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
            {showDropdown && (
                <div
                    style={{
                        position: 'absolute',
                        bottom: '100%',
                        left: 0,
                        marginBottom: '4px',
                        width: '220px',
                        maxHeight: '220px',
                        overflowY: 'auto',
                        background: 'white',
                        border: '1px solid #3498db',
                        borderRadius: '4px',
                        boxShadow: '0 4px 12px rgba(0,0,0,0.18)',
                        zIndex: 200,
                        fontSize: '12px',
                    }}
                >
                    {filteredInspectables.map(item => (
                        <div
                            key={item}
                            // Use onMouseDown (fires before the
                            // input's onBlur) so the selection is
                            // recorded even though the blur is about
                            // to hide us.
                            onMouseDown={e => {
                                e.preventDefault();
                                onChangeQuery(tabId, item);
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
    );
};

// Module-level stable references so React.memo children don't
// break referential equality on every parent render.
const NOOP_ACTION_SELECT = (_id: string | null) => { /* intentional no-op */ };
const EMPTY_STRING_ARRAY: readonly string[] = [];

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
    /**
     * Resolves the Flow/Impacts view mode for a specific tab. A
     * detached tab has its own view mode independent of the main
     * window's `actionViewMode` — see App.tsx's `detachedViewModes`.
     */
    viewModeForTab?: (tab: TabId) => 'network' | 'delta';
    /**
     * Per-tab Flow/Impacts toggle handler. Routes the change into
     * either the main-window `actionViewMode` or the detached
     * tab's entry in `detachedViewModes` based on whether the tab
     * is currently detached.
     */
    onViewModeChangeForTab?: (tab: TabId, mode: 'network' | 'delta') => void;
    inspectQuery: string;
    onInspectQueryChange: (query: string) => void;
    /**
     * Same as `onInspectQueryChange` but records which tab the
     * auto-zoom should target — used by per-tab overlays rendered
     * inside a detached popup so they zoom their own tab instead of
     * the main-window activeTab.
     */
    onInspectQueryChangeFor?: (targetTab: TabId, query: string) => void;
    inspectableItems: string[];
    onResetView: (targetTab?: TabId) => void;
    onZoomIn: (targetTab?: TabId) => void;
    onZoomOut: (targetTab?: TabId) => void;
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
    /**
     * Map of tabs currently living in a secondary browser window.
     * Optional so existing call sites / tests that don't care about the
     * detach feature continue to work without wiring the props up.
     */
    detachedTabs?: DetachedTabsMap;
    /** Detach a tab into a new popup window. */
    onDetachTab?: (tab: TabId) => void;
    /** Close the popup for a tab and fold it back inline. */
    onReattachTab?: (tab: TabId) => void;
    /** Bring focus to the popup window hosting a detached tab. */
    onFocusDetachedTab?: (tab: TabId) => void;
    /** True iff the given tab is currently "tied" to the main window's activeTab. */
    isTabTied?: (tab: TabId) => boolean;
    /** Toggle the "tied" flag for the given tab. */
    onToggleTabTie?: (tab: TabId) => void;
    /**
     * Metadata index for the N-1 diagram. Used by the
     * action-overview view (shown in the Remedial Action tab
     * when no card is selected) to resolve each action to an
     * (x, y) anchor on the network.
     */
    n1MetaIndex?: MetadataIndex | null;
    /**
     * Invoked when the user clicks a pin on the action-overview
     * view — should trigger the same action-select flow as
     * clicking a card in the sidebar. Accepts `null` so the
     * top-right ✕ button on the action tab can deselect.
     */
    onActionSelect?: (actionId: string | null) => void;
    /** Toggle an action's favourite (starred) status. */
    onActionFavorite?: (actionId: string) => void;
    /** Reject an action from the suggestions feed. */
    onActionReject?: (actionId: string) => void;
    /** Selected-action id set (for the overview popover styling). */
    selectedActionIds?: Set<string>;
    /** Rejected-action id set (for the overview popover styling). */
    rejectedActionIds?: Set<string>;
    /**
     * Monitoring factor used to derive each action's severity
     * colour, kept in sync with the card palette.
     */
    monitoringFactor?: number;
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
    detachedTabs = {},
    onDetachTab,
    onReattachTab,
    onFocusDetachedTab,
    onInspectQueryChangeFor,
    viewModeForTab,
    onViewModeChangeForTab,
    isTabTied,
    onToggleTabTie,
    n1MetaIndex,
    onActionSelect,
    onActionFavorite,
    onActionReject,
    selectedActionIds,
    rejectedActionIds,
    monitoringFactor,
}) => {
    // No-op fallbacks so conditional branches don't need to guard.
    const detachTabCb = onDetachTab ?? (() => {});
    const reattachTabCb = onReattachTab ?? (() => {});
    const focusDetachedTabCb = onFocusDetachedTab ?? (() => {});
    const inspectQueryChangeForCb = onInspectQueryChangeFor
        ?? ((_tab: TabId, q: string) => onInspectQueryChange(q));
    // When the per-tab view mode hooks are not wired up (older call
    // sites / tests) we fall back to the global `actionViewMode`
    // state passed in as a prop. That preserves backward compatibility.
    const viewModeForTabFn = viewModeForTab ?? (() => actionViewMode);
    const viewModeChangeForTabCb = onViewModeChangeForTab ?? ((_tab: TabId, mode: 'network' | 'delta') => onViewModeChange(mode));
    const isTabTiedFn = isTabTied ?? (() => false);
    const toggleTabTieCb = onToggleTabTie ?? (() => {});

    // Stable fallbacks for the ActionOverviewDiagram props so that
    // React.memo on the child doesn't break on every parent render.
    const actionSelectCb = onActionSelect ?? NOOP_ACTION_SELECT;
    const overloadedLinesMemo = React.useMemo(
        () => n1Diagram?.lines_overloaded ?? result?.lines_overloaded ?? EMPTY_STRING_ARRAY,
        [n1Diagram?.lines_overloaded, result?.lines_overloaded],
    );
    const [warningDismissed, setWarningDismissed] = useState(false);
    const [voltageFilterExpanded, setVoltageFilterExpanded] = useState(false);

    const hasAnyDiagram = !!(nDiagram?.svg || n1Diagram?.svg || actionDiagram?.svg);
    const showPathWarning = !warningDismissed && !hasAnyDiagram;

    const filteredInspectables = useMemo(() => {
        const q = inspectQuery.toUpperCase();
        if (!q) return inspectableItems.slice(0, 50);
        return inspectableItems.filter(b => b.toUpperCase().includes(q)).slice(0, 50);
    }, [inspectableItems, inspectQuery]);

    // When a tab is portaled into a secondary window we inject a small
    // floating header with a Reattach button. This is the ONLY thing the
    // popup-specific wrapper adds on top of the regular tab content — the
    // rest of the layout (MemoizedSvgContainer, warning banners, etc.)
    // is the exact same React tree that lives in the main window, which
    // is why refs and zoom state survive the detach/reattach round-trip.
    const renderDetachedHeader = (tabId: TabId, label: string, accentColor: string) => (
        <div style={{
            position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)',
            zIndex: 400, display: 'flex', alignItems: 'center', gap: '8px',
            padding: '4px 10px', background: 'rgba(255,255,255,0.95)',
            border: `1px solid ${accentColor}`, borderRadius: '14px',
            boxShadow: '0 2px 8px rgba(0,0,0,0.15)', fontSize: '12px', fontWeight: 600,
            color: '#2c3e50', pointerEvents: 'auto',
        }}>
            <span style={{ color: accentColor }}>●</span>
            <span>{label}</span>
            <button
                onClick={() => reattachTabCb(tabId)}
                title="Reattach this tab to the main window"
                style={{
                    border: `1px solid ${accentColor}`, background: 'white',
                    color: accentColor, borderRadius: '10px',
                    padding: '2px 10px', fontSize: '11px', fontWeight: 700, cursor: 'pointer',
                }}
            >
                {'\u21A9 Reattach'}
            </button>
        </div>
    );

    // Renders the per-tab control overlay (zoom in/out/reset, inspect
    // search, Flow/Impacts toggle, and the "tie" button for detached
    // tabs). This lives INSIDE each DetachableTabHost's children so
    // that when the tab is relocated into a popup the controls move
    // with it — which is how the operator gets zoom / asset focus /
    // flow-impacts interactions inside the detached window.
    //
    // Note that every tab renders its own copy of the overlay, but
    // only the currently-visible one (active-in-main-window OR
    // detached) is visible, because the tab container's home
    // placeholder carries `visibility: hidden` when neither applies.
    const renderTabOverlay = (tabId: TabId, supportsViewMode: boolean) => {
        if (tabId === 'overflow') return null;
        const isDetachedTab = !!detachedTabs[tabId];
        const hasDiagramForTab =
            (tabId === 'n' && !!nDiagram?.svg) ||
            (tabId === 'n-1' && !!n1Diagram?.svg) ||
            (tabId === 'action' && !!actionDiagram?.svg);
        const tied = isTabTiedFn(tabId);
        // Per-tab view mode: each detached popup tracks its own
        // Flow/Impacts state, independent of the main window — so
        // the toggle inside the popup only affects the popup, and
        // vice versa.
        const tabViewMode = viewModeForTabFn(tabId);

        return (
            <>
                {/* Top-right cluster: Flow/Impacts + Tie button.
                    Only rendered when the tab actually has a
                    diagram so we don't clutter empty tabs. The Tie
                    button lives DOWN in the bottom-left cluster next
                    to the controls it actually synchronises
                    (zoom / inspect), not here. */}
                {hasDiagramForTab && supportsViewMode && (
                    <div style={{
                        position: 'absolute', top: '10px', right: '10px', zIndex: 100,
                        display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                        <div style={{
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
                                onClick={() => viewModeChangeForTabCb(tabId, 'network')}
                                style={{
                                    padding: '4px 12px', border: 'none', cursor: 'pointer',
                                    backgroundColor: tabViewMode === 'network' ? '#007bff' : '#fff',
                                    color: tabViewMode === 'network' ? '#fff' : '#555',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                Flows
                            </button>
                            <button
                                onClick={() => viewModeChangeForTabCb(tabId, 'delta')}
                                style={{
                                    padding: '4px 12px', border: 'none', borderLeft: '1px solid #ccc', cursor: 'pointer',
                                    backgroundColor: tabViewMode === 'delta' ? '#007bff' : '#fff',
                                    color: tabViewMode === 'delta' ? '#fff' : '#555',
                                    transition: 'all 0.15s ease'
                                }}
                            >
                                Impacts
                            </button>
                        </div>
                    </div>
                )}

                {/* Bottom-left cluster: Tie (detached only) + zoom
                    controls + inspect search. The Tie button sits
                    directly above the zoom + inspect row so it's
                    visually associated with the interactions it
                    actually synchronises — pan/zoom and asset
                    focus. It is deliberately NOT grouped with the
                    Flow/Impacts toggle in the top-right because
                    view mode is per-window and never tied. */}
                {hasDiagramForTab && (
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
                        {isDetachedTab && (
                            <button
                                onClick={() => toggleTabTieCb(tabId)}
                                title={tied
                                    ? 'Untie: pan/zoom and asset focus no longer mirror between this window and the main window'
                                    : 'Tie: pan/zoom and asset focus will be mirrored between this window and the main window\'s active tab'}
                                style={{
                                    padding: '4px 10px', border: `1px solid ${tied ? '#2c7be5' : '#ccc'}`,
                                    borderRadius: '6px', cursor: 'pointer',
                                    backgroundColor: tied ? '#e8f0fe' : '#fff',
                                    color: tied ? '#2c7be5' : '#555',
                                    fontSize: '12px', fontWeight: 600,
                                    boxShadow: '0 2px 5px rgba(0,0,0,0.15)',
                                }}
                            >
                                {tied ? '\u{1F517} Tied' : '\u{26D3} Tie'}
                            </button>
                        )}
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                            <button
                                onClick={() => onZoomIn(tabId)}
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
                                onClick={() => onResetView(tabId)}
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
                                onClick={() => onZoomOut(tabId)}
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
                            <div style={{ display: 'flex', gap: '4px', alignItems: 'center', position: 'relative' }}>
                                <InspectSearchField
                                    tabId={tabId}
                                    inspectQuery={inspectQuery}
                                    onChangeQuery={inspectQueryChangeForCb}
                                    filteredInspectables={filteredInspectables}
                                />
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
                                        onClick={() => inspectQueryChangeForCb(tabId, '')}
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
            </>
        );
    };

    // Placeholder shown in the main window in place of a detached tab's
    // content. The tab's DOM lives in a popup — we show a friendly
    // "click to focus" indicator so the main-window user can find it.
    const renderDetachedPlaceholder = (tabId: TabId, label: string, accentColor: string) => (
        <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
            gap: '12px', background: '#f8fafc', color: '#475569', fontSize: '13px',
        }}>
            <div style={{ fontSize: '32px', color: accentColor }}>{'\u21D7'}</div>
            <div style={{ fontWeight: 600 }}>"{label}" is open in a separate window</div>
            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    onClick={() => focusDetachedTabCb(tabId)}
                    style={{
                        border: `1px solid ${accentColor}`, background: 'white', color: accentColor,
                        borderRadius: '4px', padding: '6px 14px', fontSize: '12px',
                        fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    Focus window
                </button>
                <button
                    onClick={() => reattachTabCb(tabId)}
                    style={{
                        border: '1px solid #cbd5e1', background: '#f1f5f9', color: '#475569',
                        borderRadius: '4px', padding: '6px 14px', fontSize: '12px',
                        fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    Reattach
                </button>
            </div>
        </div>
    );

    return (
        <>
            {/* Tab bar — all 4 tabs always visible; unavailable ones show placeholder.
                Each tab exposes a small detach/reattach button so the user can move
                its content into a secondary browser window and back. */}
            <div style={{ display: 'flex', borderBottom: '1px solid #ccc', flexShrink: 0 }}>
                {(
                    [
                        { id: 'n' as TabId, label: 'Network (N)' as React.ReactNode, available: !!nDiagram?.svg, accentColor: '#3498db', dimColor: '#7f8c8d', placeholder: 'Configure a network path in Settings to load the base-case diagram.' },
                        { id: 'n-1' as TabId, label: 'Contingency (N-1)' as React.ReactNode, available: !!n1Diagram?.svg, accentColor: '#e74c3c', dimColor: '#aab', placeholder: 'Select a contingency element from the dropdown to view the N-1 state.' },
                        // When no card is selected, the Remedial Action tab hosts the
                        // action-overview view (pins over the N-1 network). It is considered
                        // "available" as soon as the N-1 diagram has loaded, so the tab is no
                        // longer italicised while the user is still browsing the overview.
                        //
                        // When a card IS selected, the action id is rendered as a
                        // clickable chip that deselects the action on click — taking
                        // the user back to the overview view in the same tab. The chip
                        // lives INSIDE the tab text instead of as a separate close
                        // button so it does not collide with the Flow/Impacts toggle
                        // and other top-right controls.
                        //
                        // The label uses a flex layout so the chip stays visible and
                        // clickable even on narrow tabs (the outer button otherwise
                        // applies `overflow: hidden; text-overflow: ellipsis` which
                        // was truncating the chip to a bare "..." ellipsis).
                        {
                            id: 'action' as TabId,
                            label: selectedActionId ? (
                                <span
                                    style={{
                                        display: 'inline-flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: 6,
                                        width: '100%',
                                        minWidth: 0,
                                    }}
                                >
                                    <span style={{ flexShrink: 0, whiteSpace: 'nowrap' }}>Remedial Action:</span>
                                    <span
                                        data-testid="action-tab-deselect-chip"
                                        role="button"
                                        tabIndex={0}
                                        title={`${selectedActionId} — click to return to the overview`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onActionSelect?.(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' || e.key === ' ') {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                onActionSelect?.(null);
                                            }
                                        }}
                                        style={{
                                            display: 'inline-flex',
                                            alignItems: 'center',
                                            gap: 6,
                                            padding: '2px 10px',
                                            borderRadius: 12,
                                            background: '#fce4ec',
                                            color: '#ad1457',
                                            border: '1.5px solid #ec407a',
                                            cursor: 'pointer',
                                            fontWeight: 700,
                                            // Let the chip shrink before the "Remedial Action:" label does
                                            flex: '1 1 auto',
                                            minWidth: 0,
                                            maxWidth: '100%',
                                            overflow: 'hidden',
                                        }}
                                    >
                                        <span
                                            style={{
                                                overflow: 'hidden',
                                                textOverflow: 'ellipsis',
                                                whiteSpace: 'nowrap',
                                                minWidth: 0,
                                            }}
                                        >
                                            {selectedActionId}
                                        </span>
                                        <span
                                            aria-hidden
                                            style={{
                                                display: 'inline-flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                flexShrink: 0,
                                                width: 14,
                                                height: 14,
                                                borderRadius: '50%',
                                                background: '#ec407a',
                                                color: 'white',
                                                fontSize: 10,
                                                lineHeight: 1,
                                            }}
                                        >
                                            {'\u2715'}
                                        </span>
                                    </span>
                                </span>
                            ) as React.ReactNode : 'Remedial action: overview' as React.ReactNode,
                            available: !!actionDiagram?.svg || !!n1Diagram?.svg,
                            accentColor: '#ff4081',
                            dimColor: '#aab',
                            placeholder: 'Select a contingency and run the analysis to see remedial actions.',
                        },
                        { id: 'overflow' as TabId, label: 'Overflow Analysis' as React.ReactNode, available: !!result?.pdf_url, accentColor: '#27ae60', dimColor: '#aab', placeholder: 'Run \u201cAnalyze & Suggest\u201d to see the overflow graph.' },
                    ] as const
                ).map(tab => {
                    const isActive = activeTab === tab.id;
                    const isDetached = !!detachedTabs[tab.id];
                    return (
                        <div
                            key={tab.id}
                            style={{
                                flex: 1, display: 'flex', alignItems: 'stretch',
                                background: isActive && !isDetached ? 'white' : '#ecf0f1',
                                borderBottom: isActive && tab.available && !isDetached ? `3px solid ${tab.accentColor}` : 'none',
                                minWidth: 0,
                            }}
                        >
                            <button
                                onClick={() => {
                                    if (isDetached) {
                                        focusDetachedTabCb(tab.id);
                                    } else {
                                        onTabChange(tab.id);
                                    }
                                }}
                                title={isDetached ? 'Tab is open in a separate window — click to focus it' : (tab.available ? undefined : tab.placeholder)}
                                style={{
                                    flex: 1, borderRadius: 0, border: 'none', padding: '8px 6px',
                                    cursor: 'pointer',
                                    fontWeight: isActive && tab.available && !isDetached ? 'bold' : 400,
                                    fontStyle: !tab.available || isDetached ? 'italic' : 'normal',
                                    background: 'transparent',
                                    color: isDetached ? '#7c8894' : (tab.available ? (isActive ? '#2c3e50' : tab.dimColor) : '#bbb'),
                                    fontSize: tab.id === 'action' && selectedActionId ? '0.75rem' : '0.85rem',
                                    // The action tab with a selected card carries its
                                    // own flex label with internal ellipsis on the chip.
                                    // We must NOT apply white-space: nowrap /
                                    // text-overflow: ellipsis on the outer button for
                                    // that tab — it was truncating the whole label
                                    // down to a bare "Remedial Action: ..." string and
                                    // hiding the clickable deselect chip.
                                    overflow: 'hidden',
                                    textOverflow: tab.id === 'action' && selectedActionId ? 'clip' : 'ellipsis',
                                    whiteSpace: tab.id === 'action' && selectedActionId ? 'normal' : 'nowrap',
                                    display: tab.id === 'action' && selectedActionId ? 'flex' : undefined,
                                    alignItems: tab.id === 'action' && selectedActionId ? 'center' : undefined,
                                    justifyContent: tab.id === 'action' && selectedActionId ? 'center' : undefined,
                                    minWidth: 0,
                                }}
                            >
                                {tab.label}{isDetached ? ' \u21D7' : ''}
                            </button>
                            {tab.available && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (isDetached) reattachTabCb(tab.id);
                                        else detachTabCb(tab.id);
                                    }}
                                    title={isDetached ? 'Reattach this tab to the main window' : 'Detach this tab into a separate window'}
                                    style={{
                                        border: 'none', background: 'transparent', cursor: 'pointer',
                                        padding: '0 8px', color: isDetached ? tab.accentColor : '#7c8894',
                                        fontSize: '13px', fontWeight: 700,
                                    }}
                                >
                                    {isDetached ? '\u21A9' : '\u29C9'}
                                </button>
                            )}
                        </div>
                    );
                })}
            </div>

            {/* Content area */}
            <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
                {/* Flow/Impacts, zoom, inspect and tie controls now
                    live INSIDE each tab container (see renderTabOverlay).
                    That way they move with the tab into a detached
                    popup window. */}

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

                {/* Overflow Container — always rendered via DetachableTabHost so
                    its sub-tree stays mounted across detach/reattach. */}
                <DetachableTabHost
                    detachedMountNode={detachedTabs['overflow']?.mountNode ?? null}
                    homeStyle={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                        backgroundColor: 'white',
                        zIndex: !detachedTabs['overflow'] && activeTab === 'overflow' ? 20 : -1,
                        visibility: !detachedTabs['overflow'] && activeTab === 'overflow' ? 'visible' : 'hidden',
                        pointerEvents: !detachedTabs['overflow'] && activeTab === 'overflow' ? 'auto' : 'none',
                    }}
                >
                    <div style={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                        backgroundColor: 'white',
                    }}>
                        {detachedTabs['overflow'] && renderDetachedHeader('overflow', 'Overflow Analysis', '#27ae60')}
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
                </DetachableTabHost>
                {activeTab === 'overflow' && detachedTabs['overflow'] && renderDetachedPlaceholder('overflow', 'Overflow Analysis', '#27ae60')}

                <DetachableTabHost
                    detachedMountNode={detachedTabs['n']?.mountNode ?? null}
                    homeStyle={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                        zIndex: !detachedTabs['n'] && activeTab === 'n' ? 10 : -1,
                        visibility: !detachedTabs['n'] && activeTab === 'n' ? 'visible' : 'hidden',
                        pointerEvents: !detachedTabs['n'] && activeTab === 'n' ? 'auto' : 'none',
                    }}
                >
                    <div style={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                    }}>
                        {detachedTabs['n'] && renderDetachedHeader('n', 'Network (N)', '#3498db')}
                        {/* Always mounted — see comment on N-1 container below. */}
                        <MemoizedSvgContainer svg={nDiagram?.svg || ''} containerRef={nSvgContainerRef} display="block" tabId="n" />
                        {configLoading && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', background: 'rgba(255,255,255,0.85)', zIndex: 20 }}>
                                Loading configuration...
                            </div>
                        )}
                        {!configLoading && !nDiagram?.svg && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', background: 'white' }}>
                                Load configuration to see diagram
                            </div>
                        )}
                        {renderTabOverlay('n', true)}
                    </div>
                </DetachableTabHost>
                {activeTab === 'n' && detachedTabs['n'] && renderDetachedPlaceholder('n', 'Network (N)', '#3498db')}

                {/* N-1 Container — always mounted, hidden via CSS to preserve zoom state */}
                <DetachableTabHost
                    detachedMountNode={detachedTabs['n-1']?.mountNode ?? null}
                    homeStyle={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                        zIndex: !detachedTabs['n-1'] && activeTab === 'n-1' ? 10 : -1,
                        visibility: !detachedTabs['n-1'] && activeTab === 'n-1' ? 'visible' : 'hidden',
                        pointerEvents: !detachedTabs['n-1'] && activeTab === 'n-1' ? 'auto' : 'none',
                    }}
                >
                    <div style={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                    }}>
                        {detachedTabs['n-1'] && renderDetachedHeader('n-1', 'Contingency (N-1)', '#e74c3c')}
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
                        {/* MemoizedSvgContainer ALWAYS mounted to avoid unmount/remount
                            cycles when n1Diagram flips from null to loaded.  Remounting
                            would cause StrictMode to double-invoke its layout effect,
                            and the second DOM injection would overwrite the auto-zoom
                            viewBox that was applied between the two invocations. */}
                        <MemoizedSvgContainer svg={n1Diagram?.svg || ''} containerRef={n1SvgContainerRef} display="block" tabId="n-1" />
                        {n1Loading && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', background: 'rgba(255,255,255,0.85)', zIndex: 20 }}>
                                Generating N-1 Diagram...
                            </div>
                        )}
                        {!n1Loading && !n1Diagram?.svg && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontStyle: 'italic', textAlign: 'center', padding: '40px', background: 'white' }}>
                                Select a contingency element from the dropdown to view the N-1 state.
                            </div>
                        )}
                        {renderTabOverlay('n-1', true)}
                    </div>
                </DetachableTabHost>
                {activeTab === 'n-1' && detachedTabs['n-1'] && renderDetachedPlaceholder('n-1', 'Contingency (N-1)', '#e74c3c')}

                {/* Action Variant Container — always mounted, hidden via CSS to preserve zoom state */}
                <DetachableTabHost
                    detachedMountNode={detachedTabs['action']?.mountNode ?? null}
                    homeStyle={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                        zIndex: !detachedTabs['action'] && activeTab === 'action' ? 10 : -1,
                        visibility: !detachedTabs['action'] && activeTab === 'action' ? 'visible' : 'hidden',
                        pointerEvents: !detachedTabs['action'] && activeTab === 'action' ? 'auto' : 'none',
                    }}
                >
                    <div style={{
                        width: '100%', height: '100%',
                        position: 'absolute', top: 0, left: 0,
                    }}>
                        {detachedTabs['action'] && renderDetachedHeader('action', selectedActionId ? `Remedial Action: ${selectedActionId}` : 'Remedial action: overview', '#ff4081')}
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
                        {/* Always mounted — see comment on N-1 container. */}
                        <MemoizedSvgContainer svg={actionDiagram?.svg || ''} containerRef={actionSvgContainerRef} display="block" tabId="action" />
                        {/*
                          Action-overview layer: rendered on top of the
                          (hidden) action-diagram container when no card
                          is selected. When a card IS selected it folds
                          away (visible=false) and the existing action
                          variant diagram + highlights take over, so the
                          selection-driven interactions persist intact.
                        */}
                        <ActionOverviewDiagram
                            n1Diagram={n1Diagram}
                            n1MetaIndex={n1MetaIndex ?? null}
                            actions={result?.actions}
                            monitoringFactor={monitoringFactor ?? 1}
                            onActionSelect={actionSelectCb}
                            onActionFavorite={onActionFavorite}
                            onActionReject={onActionReject}
                            selectedActionIds={selectedActionIds}
                            rejectedActionIds={rejectedActionIds}
                            contingency={selectedBranch || null}
                            overloadedLines={overloadedLinesMemo}
                            inspectableItems={inspectableItems}
                            visible={!selectedActionId && !actionDiagramLoading}
                        />
                        {/*
                          The "back to overview" affordance now lives
                          inside the tab label as a clickable chip
                          around the action id (see the action tab
                          definition above). The previous top-right ✕
                          button was removed because it overlapped
                          with the Flow/Impacts toggle.
                        */}
                        {actionDiagramLoading && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', background: 'rgba(255,255,255,0.85)', zIndex: 20 }}>
                                Generating Action Variant Diagram...
                            </div>
                        )}
                        {!actionDiagramLoading && !actionDiagram?.svg && selectedActionId && (
                            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', background: 'white' }}>
                                Failed to load diagram for action {selectedActionId}
                            </div>
                        )}
                        {/*
                          The "select a card..." placeholder is now
                          replaced by the ActionOverviewDiagram above
                          (which itself shows its own empty-state copy
                          when the N-1 background is missing).
                        */}
                        {renderTabOverlay('action', true)}
                    </div>
                </DetachableTabHost>
                {activeTab === 'action' && detachedTabs['action'] && renderDetachedPlaceholder('action', selectedActionId ? `Remedial Action: ${selectedActionId}` : 'Remedial action: overview', '#ff4081')}

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

                {/* (Zoom, inspect, Flow/Impacts and Tie controls are
                    rendered INSIDE each tab container via
                    renderTabOverlay so they follow detached tabs
                    into their popup windows.) */}
            </div>
        </>
    );
};

export default React.memo(VisualizationPanel);
