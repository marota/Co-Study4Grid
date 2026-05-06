// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { TabId, ViewBox } from '../types';
import type { usePanZoom } from './usePanZoom';
import { interactionLogger } from '../utils/interactionLogger';

/**
 * "Tied" detached tabs feature.
 *
 * When a detached tab is "tied", the operator wants its pan/zoom
 * region to stay synchronized with the main window's active tab —
 * useful for side-by-side comparison (e.g., comparing the Network (N)
 * view in one window with the Remedial Action variant in the main
 * window, keeping both views focused on the same substation).
 *
 * Sync is **bidirectional**: zoom/pan/focus from either the
 * detached popup OR the main window is mirrored into the other.
 * Loop protection uses two guards:
 *
 *   1. A ref `isSyncingRef` set just before we call `setViewBox`
 *      programmatically. The very next effect invocation reads this
 *      flag, resets it, and returns early — so a mirror write
 *      doesn't bounce back.
 *   2. A `prevVbsRef` that snapshots the previous viewBox of every
 *      tab so we can detect WHICH side changed, which is what lets
 *      us decide the mirror direction (popup → main or main → popup).
 *
 * Only tied AND detached tabs are mirrored. An "un-detached but
 * tied" tab would be the same PZ as the main window's active tab
 * in most cases, which makes no sense, so we skip it.
 */
export type PZInstance = ReturnType<typeof usePanZoom>;

export interface PZMap {
    'n': PZInstance;
    'contingency': PZInstance;
    'action': PZInstance;
}

export interface UseTiedTabsSyncResult {
    /** Which detached tabs are currently tied to the main window. */
    tiedTabs: Set<TabId>;
    /** True iff tabId is currently in the tied set. */
    isTied: (tabId: TabId) => boolean;
    /** Add tabId to the tied set. */
    tie: (tabId: TabId) => void;
    /** Remove tabId from the tied set. */
    untie: (tabId: TabId) => void;
    /** Toggle tabId membership in the tied set. */
    toggleTie: (tabId: TabId) => void;
}

/**
 * @param pzMap           the pan/zoom instances for the three tabs
 *                         that support it (n / n-1 / action).
 * @param activeTab       the currently visible tab in the main window.
 * @param detachedTabs    the set of currently-detached tab IDs
 *                         (tying an undetached tab is a no-op).
 */
export function useTiedTabsSync(
    pzMap: PZMap,
    activeTab: TabId,
    detachedTabs: Partial<Record<TabId, unknown>>,
): UseTiedTabsSyncResult {
    const [tiedTabs, setTiedTabs] = useState<Set<TabId>>(() => new Set());
    // Guard: set to true just before we call setViewBox from the
    // mirroring effect so that the next effect run (triggered by
    // the mirrored viewBox update) skips re-mirroring and breaks
    // the loop.
    const isSyncingRef = useRef(false);
    // Snapshot of each tab's previous viewBox so we can tell which
    // side a change originated from — and therefore pick the
    // correct mirror direction (popup → main or main → popup).
    const prevVbsRef = useRef<Record<'n' | 'contingency' | 'action', ViewBox | null>>({
        'n': null,
        'contingency': null,
        'action': null,
    });
    // Snapshot of the tied set from the previous effect run so we
    // can detect which tabs were JUST added. A newly-tied tab
    // triggers a one-time sync from the popup → main so both
    // windows start at the same baseline instead of waiting for
    // the first interaction.
    const prevTiedRef = useRef<Set<TabId>>(new Set());

    const tie = useCallback((tabId: TabId) => {
        setTiedTabs(prev => {
            if (prev.has(tabId)) return prev;
            const next = new Set(prev);
            next.add(tabId);
            interactionLogger.record('tab_tied', { tab: tabId });
            return next;
        });
    }, []);

    const untie = useCallback((tabId: TabId) => {
        setTiedTabs(prev => {
            if (!prev.has(tabId)) return prev;
            const next = new Set(prev);
            next.delete(tabId);
            interactionLogger.record('tab_untied', { tab: tabId });
            return next;
        });
    }, []);

    const toggleTie = useCallback((tabId: TabId) => {
        setTiedTabs(prev => {
            const next = new Set(prev);
            if (next.has(tabId)) {
                next.delete(tabId);
                interactionLogger.record('tab_untied', { tab: tabId });
            } else {
                next.add(tabId);
                interactionLogger.record('tab_tied', { tab: tabId });
            }
            return next;
        });
    }, []);

    const isTied = useCallback((tabId: TabId) => tiedTabs.has(tabId), [tiedTabs]);

    // Extract viewBoxes into locals so the effect deps list remains
    // shallow and ESLint-friendly.
    const nVb = pzMap['n'].viewBox;
    const n1Vb = pzMap['contingency'].viewBox;
    const actionVb = pzMap['action'].viewBox;

    // ViewBox equality helper. Used to skip mirror writes that
    // wouldn't actually change anything on the target — essential
    // because `setViewBox` bails on equality inside usePanZoom, so
    // a no-op mirror wouldn't trigger the re-render that would
    // otherwise reset `isSyncingRef`, and the guard would stay
    // stuck on.
    const vbsEqual = (a: ViewBox | null, b: ViewBox | null) => {
        if (a === b) return true;
        if (!a || !b) return false;
        return a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
    };

    useEffect(() => {
        // Always refresh the snapshot on exit so the next run sees
        // the latest values.
        const prev = prevVbsRef.current;
        const currentNVb = pzMap['n'].viewBox;
        const currentN1Vb = pzMap['contingency'].viewBox;
        const currentActionVb = pzMap['action'].viewBox;

        const commitSnapshot = () => {
            prevVbsRef.current = {
                'n': currentNVb,
                'contingency': currentN1Vb,
                'action': currentActionVb,
            };
        };

        // If this effect run was caused by our own mirror write,
        // drop the guard and return without re-mirroring — this is
        // what breaks the ping-pong loop.
        if (isSyncingRef.current) {
            isSyncingRef.current = false;
            commitSnapshot();
            return;
        }

        if (tiedTabs.size === 0 || activeTab === 'overflow') {
            commitSnapshot();
            prevTiedRef.current = new Set(tiedTabs);
            return;
        }

        // Detect tabs that were freshly added to the tied set since
        // the previous effect run — they need a one-time seed mirror
        // from popup → main (or nothing if the popup's viewBox is
        // unset yet) so both windows share a starting viewBox.
        const newlyTied: TabId[] = [];
        for (const t of tiedTabs) {
            if (!prevTiedRef.current.has(t)) newlyTied.push(t);
        }
        prevTiedRef.current = new Set(tiedTabs);

        // Figure out WHICH tab's viewBox just changed. Comparing by
        // reference is enough: `setViewBox` always produces a new
        // ViewBox object on a real change (and returns the previous
        // reference on a no-op) — so identity equality tells us
        // whether a given tab was updated in this render cycle.
        const changedTabs: TabId[] = [];
        if (currentNVb !== prev['n']) changedTabs.push('n');
        if (currentN1Vb !== prev['contingency']) changedTabs.push('contingency');
        if (currentActionVb !== prev['action']) changedTabs.push('action');

        commitSnapshot();

        // Helper: mirror `vb` into `target`. Skips the write (and the
        // loop guard) entirely if `target` already has the same
        // viewBox value — otherwise the bail inside
        // `setViewBoxPublic` would prevent the re-render that resets
        // `isSyncingRef`, and the guard would get stuck on.
        const mirror = (target: PZInstance | null, vb: ViewBox) => {
            if (!target) return;
            if (vbsEqual(target.viewBox, vb)) return;
            isSyncingRef.current = true;
            target.setViewBox(vb);
        };

        // Seed mirror for newly-tied tabs: their current viewBox is
        // pushed into the main window's active PZ so both windows
        // share a baseline from the moment the button is clicked.
        for (const newTab of newlyTied) {
            if (!detachedTabs[newTab]) continue;
            if (newTab === activeTab) continue;
            const seedVb = newTab === 'n' ? currentNVb
                : newTab === 'contingency' ? currentN1Vb
                    : newTab === 'action' ? currentActionVb
                        : null;
            if (!seedVb) continue;
            const targetPZ = activeTab === 'n' ? pzMap['n']
                : activeTab === 'contingency' ? pzMap['contingency']
                    : activeTab === 'action' ? pzMap['action']
                        : null;
            mirror(targetPZ, seedVb);
        }

        if (changedTabs.length === 0) return;

        for (const changed of changedTabs) {
            const changedVb = changed === 'n' ? currentNVb
                : changed === 'contingency' ? currentN1Vb
                    : currentActionVb;
            if (!changedVb) continue;

            // Case A: the change happened in a TIED+DETACHED popup
            // — mirror it into the main window's currently-active tab.
            if (tiedTabs.has(changed) && detachedTabs[changed] && changed !== activeTab) {
                const targetPZ = activeTab === 'n' ? pzMap['n']
                    : activeTab === 'contingency' ? pzMap['contingency']
                        : activeTab === 'action' ? pzMap['action']
                            : null;
                mirror(targetPZ, changedVb);
                continue;
            }

            // Case B: the change happened in the MAIN window's
            // active tab, and at least one tied+detached tab exists
            // — mirror the change out into each of them.
            if (changed === activeTab) {
                for (const tiedTab of tiedTabs) {
                    if (!detachedTabs[tiedTab]) continue;
                    if (tiedTab === activeTab) continue;
                    const targetPZ = tiedTab === 'n' ? pzMap['n']
                        : tiedTab === 'contingency' ? pzMap['contingency']
                            : tiedTab === 'action' ? pzMap['action']
                                : null;
                    mirror(targetPZ, changedVb);
                }
            }
        }
    }, [tiedTabs, activeTab, detachedTabs, pzMap, nVb, n1Vb, actionVb]);

    return { tiedTabs, isTied, tie, untie, toggleTie };
}
