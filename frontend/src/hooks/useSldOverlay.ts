// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { useState, useCallback, useRef, useEffect, type MutableRefObject } from 'react';
import { api } from '../api';
import type { VlOverlay, SldTab, FlowDelta, AssetDelta, TabId } from '../types';
import { interactionLogger } from '../utils/interactionLogger';

export interface SldOverlayState {
    vlOverlay: VlOverlay | null;
    setVlOverlay: (v: VlOverlay | null) => void;
    selectedBranchForSld: MutableRefObject<string>;
    handleVlDoubleClick: (actionId: string, vlName: string) => void;
    handleOverlaySldTabChange: (sldTab: SldTab) => void;
    handleOverlayClose: () => void;
}

/**
 * @param activeTab              currently-visible main-window tab
 * @param liveSelectedActionId   optional live selectedActionId used as a
 *                                fallback when `vlOverlay.actionId` is
 *                                empty (e.g. the operator opened the SLD
 *                                from the N tab and THEN switched to the
 *                                "action" sub-tab of the overlay). Without
 *                                this fallback the backend rejected the
 *                                switch with "Action '' not found in
 *                                last analysis result."
 */
export function useSldOverlay(activeTab: TabId, liveSelectedActionId?: string | null): SldOverlayState {
    const [vlOverlay, setVlOverlay] = useState<VlOverlay | null>(null);
    const selectedBranchForSld = useRef('');
    // Mirror the selectedActionId into a ref so the fetch closure
    // can read the latest value without being re-created on every
    // action change — keeping `fetchSldVariant`'s identity stable.
    const selectedActionIdRef = useRef<string | null | undefined>(liveSelectedActionId);
    useEffect(() => { selectedActionIdRef.current = liveSelectedActionId; }, [liveSelectedActionId]);

    const fetchSldVariant = useCallback(async (vlName: string, actionId: string | null, sldTab: SldTab, selectedBranch: string) => {
        setVlOverlay(prev => prev ? { ...prev, loading: true, error: null, tab: sldTab } : null);
        try {
            let svgData: string;
            let metaData: string | null = null;
            let flowDeltas: Record<string, FlowDelta> | undefined;
            let reactiveFlowDeltas: Record<string, FlowDelta> | undefined;
            let assetDeltas: Record<string, AssetDelta> | undefined;
            let changedSwitches: Record<string, { from_open: boolean; to_open: boolean }> | undefined;

            if (sldTab === 'n') {
                const res = await api.getNSld(vlName);
                svgData = res.svg;
                metaData = res.sld_metadata ?? null;
            } else if (sldTab === 'n-1') {
                const res = await api.getN1Sld(selectedBranch, vlName);
                svgData = res.svg;
                metaData = res.sld_metadata ?? null;
                flowDeltas = res.flow_deltas;
                reactiveFlowDeltas = res.reactive_flow_deltas;
                assetDeltas = res.asset_deltas;
            } else {
                // Fallback to the live selectedActionId if the
                // overlay was opened from a tab where no action
                // was carried along (the stored `actionId` is ''
                // in that case). This prevents a backend error
                // when the operator switches to the action
                // sub-tab AFTER opening the SLD from the N /
                // N-1 tab.
                const effectiveActionId = (actionId && actionId.length > 0)
                    ? actionId
                    : (selectedActionIdRef.current ?? '');
                if (!effectiveActionId) {
                    setVlOverlay(prev => prev && prev.tab === sldTab
                        ? { ...prev, loading: false, error: 'No action selected. Pick an action first and then re-open the SLD.' }
                        : prev
                    );
                    return;
                }
                const res = await api.getActionVariantSld(effectiveActionId, vlName);
                svgData = res.svg;
                metaData = res.sld_metadata ?? null;
                flowDeltas = res.flow_deltas;
                reactiveFlowDeltas = res.reactive_flow_deltas;
                assetDeltas = res.asset_deltas;
                changedSwitches = res.changed_switches;
                // Persist the resolved actionId back onto the
                // overlay so subsequent re-renders and highlight
                // passes can find it on `vlOverlay.actionId`.
                setVlOverlay(prev =>
                    prev && prev.vlName === vlName && prev.tab === sldTab
                        ? { ...prev, actionId: effectiveActionId }
                        : prev
                );
            }
            setVlOverlay(prev =>
                prev && prev.vlName === vlName && prev.tab === sldTab
                    ? {
                        ...prev, svg: svgData, sldMetadata: metaData, loading: false,
                        flow_deltas: flowDeltas, reactive_flow_deltas: reactiveFlowDeltas, asset_deltas: assetDeltas,
                        changed_switches: changedSwitches,
                    }
                    : prev
            );
        } catch (err: unknown) {
            const e = err as { response?: { data?: { detail?: string } }; message?: string };
            setVlOverlay(prev => prev && prev.tab === sldTab
                ? { ...prev, loading: false, error: e.response?.data?.detail || 'Failed to load SLD' }
                : prev
            );
        }
    }, []);

    const handleVlDoubleClick = useCallback((actionId: string, vlName: string) => {
        interactionLogger.record('sld_overlay_opened', { vl_name: vlName, action_id: actionId });
        let initialTab: SldTab;
        if (activeTab === 'n') {
            initialTab = 'n';
        } else if (activeTab === 'n-1') {
            initialTab = 'n-1';
        } else {
            initialTab = 'action';
        }
        setVlOverlay({ vlName, actionId, svg: null, sldMetadata: null, loading: true, error: null, tab: initialTab });
        fetchSldVariant(vlName, actionId, initialTab, selectedBranchForSld.current);
    }, [activeTab, fetchSldVariant]);

    const handleOverlaySldTabChange = useCallback((sldTab: SldTab) => {
        if (!vlOverlay) return;
        interactionLogger.record('sld_overlay_tab_changed', { tab: sldTab, vl_name: vlOverlay.vlName });
        fetchSldVariant(vlOverlay.vlName, vlOverlay.actionId, sldTab, selectedBranchForSld.current);
    }, [vlOverlay, fetchSldVariant]);

    const handleOverlayClose = useCallback(() => {
        interactionLogger.record('sld_overlay_closed');
        setVlOverlay(null);
    }, []);

    return {
        vlOverlay,
        setVlOverlay,
        selectedBranchForSld,
        handleVlDoubleClick,
        handleOverlaySldTabChange,
        handleOverlayClose,
    };
}
