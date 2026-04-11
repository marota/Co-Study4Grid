// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { useState, useCallback, useRef, type MutableRefObject } from 'react';
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

export function useSldOverlay(activeTab: TabId): SldOverlayState {
    const [vlOverlay, setVlOverlay] = useState<VlOverlay | null>(null);
    const selectedBranchForSld = useRef('');

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
                const res = await api.getActionVariantSld(actionId!, vlName);
                svgData = res.svg;
                metaData = res.sld_metadata ?? null;
                flowDeltas = res.flow_deltas;
                reactiveFlowDeltas = res.reactive_flow_deltas;
                assetDeltas = res.asset_deltas;
                changedSwitches = res.changed_switches;
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
