// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import type { ActionOverviewFilters } from '../types';
import { interactionLogger } from '../utils/interactionLogger';
import { decidePopoverPlacement } from '../utils/popoverPlacement';
import type { OverflowPin } from '../utils/svg/overflowPinPayload';

export interface OverflowIframePopoverPin {
    id: string;
    screenX: number;
    screenY: number;
    placeAbove: boolean;
    horizontalAlign: 'start' | 'center' | 'end';
}

export interface OverflowIframeState {
    overflowIframeRef: React.MutableRefObject<HTMLIFrameElement | null>;
    overflowPopoverRef: React.MutableRefObject<HTMLDivElement | null>;
    overflowPopoverPin: OverflowIframePopoverPin | null;
    setOverflowPopoverPin: React.Dispatch<React.SetStateAction<OverflowIframePopoverPin | null>>;
    overflowPopoverViewport: { width: number; height: number } | null;
    setOverflowPopoverViewport: React.Dispatch<React.SetStateAction<{ width: number; height: number } | null>>;
}

interface UseOverflowIframeArgs {
    pdfUrl: string | null | undefined;
    overflowPinsEnabled: boolean;
    overflowPins: ReadonlyArray<OverflowPin> | undefined;
    overviewFilters: ActionOverviewFilters | undefined;
    onOverflowPinPreview?: (actionId: string) => void;
    onOverflowPinDoubleClick?: (actionId: string, substation: string) => void;
    onSimulateUnsimulatedAction?: (actionId: string) => void;
    onOverviewFiltersChange?: (filters: ActionOverviewFilters) => void;
    onVlOpen?: (vlId: string) => void;
}

/**
 * Encapsulates the overflow-graph iframe ↔ parent-window plumbing:
 *
 *   1. ``cs4g:overlay-ready`` handshake so we know the iframe has
 *      registered its message listener before the first pin payload
 *      is broadcast.
 *   2. Routing every iframe-originated message to the right parent
 *      callback (pin click, pin double-click, unsimulated-pin
 *      double-click, filter change, layer toggle, node double-click)
 *      and emitting the matching interactionLogger event.
 *   3. Pin-popover state (`overflowPopoverPin` / `overflowPopoverViewport`)
 *      with outside-click + Escape dismissal, mirroring the Action-
 *      Overview pin preview UX.
 *   4. Broadcasting current pin payload + filter chip state back into
 *      the iframe whenever they change (or once at overlay-ready time).
 *
 * The iframe is same-origin (localhost:8000), so postMessage is safe.
 */
export function useOverflowIframe(args: UseOverflowIframeArgs): OverflowIframeState {
    const {
        pdfUrl,
        overflowPinsEnabled,
        overflowPins,
        overviewFilters,
        onOverflowPinPreview,
        onOverflowPinDoubleClick,
        onSimulateUnsimulatedAction,
        onOverviewFiltersChange,
        onVlOpen,
    } = args;

    const overflowIframeRef = React.useRef<HTMLIFrameElement | null>(null);
    const [overlayReady, setOverlayReady] = React.useState(false);
    const [overflowPopoverPin, setOverflowPopoverPin] = React.useState<OverflowIframePopoverPin | null>(null);
    const [overflowPopoverViewport, setOverflowPopoverViewport] = React.useState<{
        width: number; height: number;
    } | null>(null);
    const overflowPopoverRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        // Reset readiness on URL change (a new file means a fresh load).
        setOverlayReady(false);
        // A fresh iframe means any old popover is referencing a pin
        // that no longer exists. Drop it on URL change.
        setOverflowPopoverPin(null);
        setOverflowPopoverViewport(null);
    }, [pdfUrl]);

    React.useEffect(() => {
        const onMessage = (ev: MessageEvent) => {
            const msg = ev?.data;
            if (!msg || typeof msg !== 'object') return;
            if (msg.type === 'cs4g:overlay-ready') {
                setOverlayReady(true);
            } else if (msg.type === 'cs4g:pin-clicked' && typeof msg.actionId === 'string') {
                // Single click on an overflow pin mirrors the
                // Action-Overview pin: focus the feed card on the
                // matching action (`onOverflowPinPreview`) AND show
                // a floating ActionCardPopover anchored on the pin.
                // It must NOT call `onActionSelect`, which would
                // switch the active tab to the action variant diagram
                // and stop the operator from completing a double-click
                // drill into the SLD overlay.
                if (onOverflowPinPreview) onOverflowPinPreview(msg.actionId);
                interactionLogger.record('overflow_pin_clicked', { actionId: msg.actionId });
                // The pin's bounding rect is in iframe-screen pixels;
                // translate to parent-screen pixels by adding the
                // iframe's own offset so the popover lands on the
                // correct spot in the parent document.
                const iframeEl = overflowIframeRef.current;
                const rect = msg.screenRect;
                if (iframeEl && rect && typeof rect === 'object') {
                    const ifRect = iframeEl.getBoundingClientRect();
                    const cx = ifRect.left + (rect.left ?? 0) + (rect.width ?? 0) / 2;
                    const cy = ifRect.top + (rect.top ?? 0) + (rect.height ?? 0) / 2;
                    const viewport = {
                        width: window.innerWidth,
                        height: window.innerHeight,
                    };
                    const placement = decidePopoverPlacement(cx, cy, viewport);
                    setOverflowPopoverPin({
                        id: msg.actionId,
                        screenX: cx,
                        screenY: cy,
                        ...placement,
                    });
                    setOverflowPopoverViewport(viewport);
                }
            } else if (msg.type === 'cs4g:pin-double-clicked'
                && typeof msg.actionId === 'string'
                && typeof msg.substation === 'string') {
                // Drill into the SLD on the action sub-tab for that
                // substation. Logging happens in the parent handler so
                // the event is suppressed when the action is not
                // actually known to the result.
                // Double click cancels any open preview popover so the
                // SLD overlay takes the focus on the way in.
                setOverflowPopoverPin(null);
                setOverflowPopoverViewport(null);
                if (onOverflowPinDoubleClick) {
                    onOverflowPinDoubleClick(msg.actionId, msg.substation);
                }
            } else if (msg.type === 'cs4g:overflow-unsimulated-pin-double-clicked'
                && typeof msg.actionId === 'string') {
                // Double-click on an un-simulated overflow pin kicks
                // off a manual simulation — same path the Action
                // Overview's renderUnsimulatedPin double-click takes
                // through ``handleSimulateUnsimulatedAction``. Drop
                // any popover open over the previous pin first; the
                // simulation will replace this pin with a real one.
                setOverflowPopoverPin(null);
                setOverflowPopoverViewport(null);
                if (onSimulateUnsimulatedAction) {
                    onSimulateUnsimulatedAction(msg.actionId);
                }
                interactionLogger.record('overview_unsimulated_pin_simulated', {
                    action_id: msg.actionId,
                });
            } else if (msg.type === 'cs4g:overflow-filter-changed'
                && msg.filters && typeof msg.filters === 'object') {
                // The iframe sidebar carries a copy of the Action-
                // Overview filter chips. When the operator changes
                // one there we forward the new state up so the
                // parent's shared ``overviewFilters`` (which also
                // drives the Action Feed and the Action Overview
                // NAD pins) stays in lock-step with the iframe's UI.
                if (onOverviewFiltersChange) {
                    onOverviewFiltersChange(msg.filters);
                }
                interactionLogger.record('overview_filter_changed', {
                    kind: 'overflow_iframe',
                });
            } else if (msg.type === 'cs4g:overflow-layer-toggled') {
                interactionLogger.record('overflow_layer_toggled', {
                    key: msg.key, label: msg.label, visible: !!msg.visible,
                });
            } else if (msg.type === 'cs4g:overflow-select-all-layers') {
                interactionLogger.record('overflow_select_all_layers', { visible: !!msg.visible });
            } else if (msg.type === 'cs4g:overflow-node-double-clicked' && typeof msg.name === 'string') {
                // The overflow graph node double-click opens the SLD
                // overlay for that voltage level (or substation, depending
                // on the backend). The parent's `onVlOpen` handler routes
                // through the same path used by the NAD double-click.
                if (onVlOpen) onVlOpen(msg.name);
                interactionLogger.record('overflow_node_double_clicked', { name: msg.name });
            }
        };
        window.addEventListener('message', onMessage);
        return () => window.removeEventListener('message', onMessage);
    }, [onVlOpen, onOverflowPinPreview, onOverflowPinDoubleClick,
        onOverviewFiltersChange, onSimulateUnsimulatedAction]);

    // Outside-click + Escape dismissal for the overflow pin popover —
    // mirrors `ActionOverviewDiagram`. Clicks INSIDE the iframe (the
    // pin itself, the graph background) live in a different document
    // and don't reach the parent's mousedown handler, so they don't
    // close the popover. To prevent that the iframe's own background
    // click is forwarded by the upstream interactive_html clicker
    // through the existing `cs4g:overflow-node-double-clicked` path
    // (clicks not on a pin are silently ignored), so the popover
    // stays open until the user clicks outside the iframe / hits Esc
    // / clicks the popover's own close button.
    React.useEffect(() => {
        if (!overflowPopoverPin) return;
        const onDocMouseDown = (e: MouseEvent) => {
            const target = e.target as Node | null;
            if (overflowPopoverRef.current && target
                && overflowPopoverRef.current.contains(target)) return;
            // Clicks ON the iframe itself bubble up to the parent as
            // an event whose target is the iframe element. Don't close
            // the popover in that case — the click might be a follow-up
            // pin click handled separately.
            if (target instanceof Element
                && target === overflowIframeRef.current) return;
            setOverflowPopoverPin(null);
            setOverflowPopoverViewport(null);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setOverflowPopoverPin(null);
                setOverflowPopoverViewport(null);
            }
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onKey);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onKey);
        };
    }, [overflowPopoverPin]);

    React.useEffect(() => {
        const iframe = overflowIframeRef.current;
        if (!iframe || !iframe.contentWindow) return;
        if (!overlayReady) return;
        iframe.contentWindow.postMessage({
            type: 'cs4g:pins',
            visible: !!overflowPinsEnabled,
            pins: overflowPinsEnabled ? (overflowPins ?? []) : [],
        }, '*');
    }, [overlayReady, overflowPinsEnabled, overflowPins]);

    // Broadcast the current Action-Overview filter state into the
    // iframe whenever it changes (and once at overlay-ready time).
    // The iframe's sidebar mirrors these chips so a change made on
    // the Action Overview NAD instantly reflects in the overflow
    // graph filter panel — and vice versa.
    React.useEffect(() => {
        const iframe = overflowIframeRef.current;
        if (!iframe || !iframe.contentWindow) return;
        if (!overlayReady) return;
        if (!overviewFilters) return;
        iframe.contentWindow.postMessage({
            type: 'cs4g:filters',
            filters: overviewFilters,
        }, '*');
    }, [overlayReady, overviewFilters]);

    return {
        overflowIframeRef,
        overflowPopoverRef,
        overflowPopoverPin,
        setOverflowPopoverPin,
        overflowPopoverViewport,
        setOverflowPopoverViewport,
    };
}
