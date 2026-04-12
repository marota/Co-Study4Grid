// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { ActionDetail, NodeMeta, EdgeMeta, AvailableAction, AnalysisResult, CombinedAction, RecommenderDisplayConfig } from '../types';
import { api } from '../api';
import CombinedActionsModal from './CombinedActionsModal';
import ActionCard from './ActionCard';
import ActionSearchDropdown from './ActionSearchDropdown';

interface ActionFeedProps {
    actions: Record<string, ActionDetail>;
    actionScores?: Record<string, Record<string, unknown>>;
    linesOverloaded: string[];
    selectedActionId: string | null;
    selectedActionIds: Set<string>;
    rejectedActionIds: Set<string>;
    pendingAnalysisResult: AnalysisResult | null;
    onDisplayPrioritizedActions: () => void;
    onRunAnalysis: () => void;
    canRunAnalysis: boolean;
    onActionSelect: (actionId: string | null) => void;
    onActionFavorite: (actionId: string) => void;
    onActionReject: (actionId: string) => void;
    onAssetClick: (actionId: string, assetName: string, tab?: 'action' | 'n-1') => void;
    nodesByEquipmentId: Map<string, NodeMeta> | null;
    edgesByEquipmentId: Map<string, EdgeMeta> | null;
    disconnectedElement: string | null;
    onManualActionAdded: (actionId: string, detail: ActionDetail, linesOverloaded: string[]) => void;
    analysisLoading: boolean;
    monitoringFactor: number;
    manuallyAddedIds: Set<string>;
    onVlDoubleClick?: (actionId: string, vlName: string) => void;
    recommenderConfig: RecommenderDisplayConfig;
    onOpenSettings?: (tab?: 'recommender' | 'configurations' | 'paths') => void;
    actionDictFileName?: string | null;
    actionDictStats?: { reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number } | null;
    combinedActions: Record<string, CombinedAction> | null;
    onUpdateCombinedEstimation?: (pairId: string, estimation: { estimated_max_rho: number; estimated_max_rho_line: string }) => void;
}

const ActionFeed: React.FC<ActionFeedProps> = ({
    actions,
    actionScores,
    linesOverloaded,
    selectedActionId,
    selectedActionIds,
    rejectedActionIds,
    pendingAnalysisResult,
    onDisplayPrioritizedActions,
    onRunAnalysis,
    canRunAnalysis,
    onActionSelect,
    onActionFavorite,
    onActionReject,
    onAssetClick,
    nodesByEquipmentId,
    edgesByEquipmentId,
    disconnectedElement,
    onManualActionAdded,
    analysisLoading,
    monitoringFactor,
    manuallyAddedIds,
    onVlDoubleClick,
    recommenderConfig,
    onOpenSettings,
    actionDictFileName,
    actionDictStats,
    combinedActions,
    onUpdateCombinedEstimation,
}) => {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [combineModalOpen, setCombineModalOpen] = useState(false);
    const [availableActions, setAvailableActions] = useState<AvailableAction[]>([]);
    const [loadingActions, setLoadingActions] = useState(false);
    const [simulating, setSimulating] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [typeFilters, setTypeFilters] = useState({ disco: true, reco: true, open: true, close: true, pst: true, ls: true, rc: true });
    const searchInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [tooltip, setTooltip] = useState<{ content: React.ReactNode; x: number; y: number } | null>(null);
    const [suggestedTab, setSuggestedTab] = useState<'prioritized' | 'rejected'>('prioritized');
    const [dismissedSelectedWarning, setDismissedSelectedWarning] = useState(false);
    // Per-action editable MW for LS/RC actions. This state is shared between
    // the score table row input (in the manual-selection dropdown) and the
    // action card input, so that editing one reflects immediately in the other.
    const [cardEditMw, setCardEditMw] = useState<Record<string, string>>({});
    // Per-action editable tap position for PST action re-simulation (keyed by actionId)
    const [cardEditTap, setCardEditTap] = useState<Record<string, string>>({});
    const [resimulating, setResimulating] = useState<string | null>(null);
    const [dismissedRejectedWarning, setDismissedRejectedWarning] = useState(false);
    const [showActionDictWarning, setShowActionDictWarning] = useState(true);
    const [showRecommenderWarning, setShowRecommenderWarning] = useState(true);

    const showTooltip = (e: React.MouseEvent, content: React.ReactNode) => {
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        setTooltip({ content, x: rect.left, y: rect.bottom + 5 });
    };
    const hideTooltip = () => setTooltip(null);

    // Fetch available actions when search is opened
    const handleOpenSearch = async () => {
        if (searchOpen) { setSearchOpen(false); return; }
        setSearchOpen(true);
        setSearchQuery('');
        setError(null);
        if (availableActions.length === 0) {
            setLoadingActions(true);
            try {
                const list = await api.getAvailableActions();
                setAvailableActions(list);
            } catch (e) {
                console.error('Failed to fetch actions:', e);
                setError('Failed to load actions list');
            } finally {
                setLoadingActions(false);
            }
        }
        setTimeout(() => searchInputRef.current?.focus(), 50);
    };

    // Filter actions for dropdown
    const filteredActions = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const alreadyShown = new Set(Object.keys(actions));
        return availableActions
            .filter(a => !alreadyShown.has(a.id))
            .filter(a => {
                const t = (a.type || 'unknown').toLowerCase();
                const actionId = a.id.toLowerCase();
                const actionDesc = (a.description || '').toLowerCase();

                const isDisco = t.includes('disco') || t.includes('open_line') || t.includes('open_load') || actionDesc.includes('ouverture');
                const isReco = t.includes('reco') || t.includes('close_line') || t.includes('close_load') || actionDesc.includes('fermeture');
                const isOpenCoupling = t.includes('open_coupling');
                const isCloseCoupling = t.includes('close_coupling');
                const isPstAction = (actionId.includes('pst') || actionDesc.includes('pst') || t.includes('pst')) && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling;
                const isLoadShedding = (actionId.includes('load_shedding') || actionDesc.includes('load shedding') || t.includes('load_shedding')) && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling && !isPstAction;
                const isRenewableCurtailment = (t.includes('renewable_curtailment') || t.includes('open_gen')) && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling && !isPstAction && !isLoadShedding;

                if (isDisco) return typeFilters.disco;
                if (isReco) return typeFilters.reco;
                if (isOpenCoupling) return typeFilters.open;
                if (isCloseCoupling) return typeFilters.close;
                if (isPstAction) return typeFilters.pst;
                if (isLoadShedding) return typeFilters.ls;
                if (isRenewableCurtailment) return typeFilters.rc;

                // Handle unknown or categories not explicitly listed above
                return typeFilters.disco && typeFilters.reco && typeFilters.open && typeFilters.close && typeFilters.pst;
            })
            .filter(a => a.id.toLowerCase().includes(q) || (a.description || '').toLowerCase().includes(q))
            .slice(0, 20);
    }, [searchQuery, availableActions, actions, typeFilters]);

    // Format scored actions
    const scoredActionsList = useMemo(() => {
        if (!actionScores) return [];
        const list: { type: string; actionId: string; score: number; mwStart: number | null }[] = [];
        for (const [type, data] of Object.entries(actionScores)) {
            // Apply filtering logic consistent with the search dropdown
            const isDiscoType = type === 'line_disconnection';
            const isRecoType = type === 'line_reconnection';
            const isOpenType = type === 'open_coupling';
            const isCloseType = type === 'close_coupling';
            const isPstType = type === 'pst_tap_change' || type.includes('pst');

            if (isDiscoType && !typeFilters.disco) continue;
            if (isRecoType && !typeFilters.reco) continue;
            if (isOpenType && !typeFilters.open) continue;
            if (isCloseType && !typeFilters.close) continue;
            if (isPstType && !typeFilters.pst) continue;
            if ((type === 'load_shedding' || type.includes('load_shedding')) && !typeFilters.ls) continue;
            if ((type === 'renewable_curtailment' || type.includes('renewable_curtailment')) && !typeFilters.rc) continue;

            // If it's a known type but its filter is off, it's already skipped.
            // If it's an unknown type, we show it only if ALL filters are active.
            const isKnownType = isDiscoType || isRecoType || isOpenType || isCloseType || isPstType || type === 'load_shedding' || type.includes('load_shedding') || type === 'renewable_curtailment' || type.includes('renewable_curtailment');
            if (!isKnownType && !(typeFilters.disco && typeFilters.reco && typeFilters.open && typeFilters.close && typeFilters.pst && typeFilters.ls && typeFilters.rc)) {
                continue;
            }

            const scores = data?.scores || {};
            for (const [actionId, score] of Object.entries(scores)) {
                // Determine if this specific action should be filtered out
                const actionDetail = actions[actionId];
                const actionDesc = (actionDetail?.description_unitaire || '').toLowerCase();
                const aid = actionId.toLowerCase();
                const t = type.toLowerCase();

                const isDisco = t.includes('disco') || t.includes('open_line') || t.includes('open_load') || actionDesc.includes('ouverture');
                const isReco = t.includes('reco') || t.includes('close_line') || t.includes('close_load') || actionDesc.includes('fermeture');
                const isOpenCoupling = t.includes('open_coupling');
                const isCloseCoupling = t.includes('close_coupling');
                const isPstAction = (aid.includes('pst') || actionDesc.includes('pst') || t.includes('pst')) && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling;
                const isLoadShedding = (aid.includes('load_shedding') || actionDesc.includes('load shedding') || t.includes('load_shedding')) && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling && !isPstAction;
                const isRenewableCurtailment = (t.includes('renewable_curtailment') || t.includes('open_gen')) && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling && !isPstAction && !isLoadShedding;

                let shouldShow = false;
                if (isDisco) shouldShow = typeFilters.disco;
                else if (isReco) shouldShow = typeFilters.reco;
                else if (isOpenCoupling) shouldShow = typeFilters.open;
                else if (isCloseCoupling) shouldShow = typeFilters.close;
                else if (isPstAction) shouldShow = typeFilters.pst;
                else if (isLoadShedding) shouldShow = typeFilters.ls;
                else if (isRenewableCurtailment) shouldShow = typeFilters.rc;
                else shouldShow = typeFilters.disco && typeFilters.reco && typeFilters.open && typeFilters.close && typeFilters.pst && typeFilters.ls && typeFilters.rc;

                if (!shouldShow) continue;

                const mwStartMap = (data as { mw_start?: Record<string, number | null> })?.mw_start;
                const mwStart = mwStartMap?.[actionId] ?? null;
                list.push({ type, actionId, score: Number(score), mwStart: mwStart != null ? Number(mwStart) : null });
            }
        }
        return list.sort((a, b) => {
            if (a.type !== b.type) {
                if (a.type === 'line_disconnection') return 1;
                if (b.type === 'line_disconnection') return -1;
                return a.type.localeCompare(b.type);
            }
            return b.score - a.score;
        });
    }, [actionScores, typeFilters, actions]);

    // Close dropdown on outside click
    useEffect(() => {
        if (!searchOpen) return;
        const handler = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setSearchOpen(false);
                setSearchQuery('');
                setError(null);
            }
        };
        document.addEventListener('mousedown', handler);
        return () => document.removeEventListener('mousedown', handler);
    }, [searchOpen]);

    const handleAddAction = async (actionId: string, targetMw?: number, targetTap?: number) => {
        const trimmedId = actionId.trim();
        if (!disconnectedElement) {
            setError('Select a contingency first.');
            return;
        }
        setSimulating(trimmedId);
        setError(null);
        try {
            // Build actionContent from topologies if available (especially for combined actions)
            let actionContent: Record<string, unknown> | null = null;
            if (trimmedId.includes('+')) {
                const parts = trimmedId.split('+').map(p => p.trim());
                const perAction: Record<string, unknown> = {};
                for (const part of parts) {
                    const partDetail = actions[part];
                    if (partDetail?.action_topology) {
                        perAction[part] = partDetail.action_topology;
                    }
                }
                if (Object.keys(perAction).length > 0) {
                    actionContent = perAction;
                }
            } else {
                const detail = actions[trimmedId];
                if (detail?.action_topology) {
                    actionContent = detail.action_topology as unknown as Record<string, unknown>;
                }
            }

            const result = await api.simulateManualAction(trimmedId, disconnectedElement, actionContent, linesOverloaded, targetMw, targetTap);
            const detail: ActionDetail = {
                description_unitaire: result.description_unitaire,
                rho_before: result.rho_before,
                rho_after: result.rho_after,
                max_rho: result.max_rho,
                max_rho_line: result.max_rho_line,
                is_rho_reduction: result.is_rho_reduction,
                is_islanded: result.is_islanded,
                n_components: result.n_components,
                disconnected_mw: result.disconnected_mw,
                non_convergence: result.non_convergence,
                lines_overloaded_after: result.lines_overloaded_after,
                load_shedding_details: result.load_shedding_details,
                curtailment_details: result.curtailment_details,
                pst_details: result.pst_details,

            };
            onManualActionAdded(trimmedId, detail, result.lines_overloaded || []);
            setSearchOpen(false);
            setSearchQuery('');
        } catch (e: unknown) {
            console.error('Simulation failed:', e);
            const err = e as { response?: { data?: { detail?: string } } };
            setError(err?.response?.data?.detail || 'Simulation failed');
        } finally {
            setSimulating(null);
        }
    };

    // Refresh combined estimations for all pairs that include the given action
    const refreshCombinedEstimations = async (actionId: string) => {
        console.log('[refreshCombinedEstimations] called for:', actionId,
            'combinedActions:', combinedActions ? Object.keys(combinedActions).length : null,
            'disconnectedElement:', disconnectedElement,
            'hasCallback:', !!onUpdateCombinedEstimation);
        if (!combinedActions || !disconnectedElement || !onUpdateCombinedEstimation) return;
        const relatedPairs = Object.entries(combinedActions).filter(([pairId]) => {
            const parts = pairId.split('+').map(p => p.trim());
            return parts.includes(actionId);
        });
        console.log('[refreshCombinedEstimations] found', relatedPairs.length, 'related pairs:',
            relatedPairs.map(([id]) => id));
        for (const [pairId] of relatedPairs) {
            const parts = pairId.split('+').map(p => p.trim());
            const [id1, id2] = parts;
            try {
                const result = await api.computeSuperposition(id1, id2, disconnectedElement);
                console.log('[refreshCombinedEstimations] superposition result for', pairId, ':', {
                    error: result.error,
                    estimated_max_rho: result.estimated_max_rho,
                    max_rho: result.max_rho,
                    max_rho_line: result.max_rho_line,
                });
                if (!result.error) {
                    const estRho = result.estimated_max_rho ?? result.max_rho;
                    const estLine = result.estimated_max_rho_line ?? result.max_rho_line;
                    console.log('[refreshCombinedEstimations] updating pair', pairId, 'with estRho:', estRho, 'estLine:', estLine);
                    onUpdateCombinedEstimation(pairId, { estimated_max_rho: estRho, estimated_max_rho_line: estLine });
                }
            } catch (e) {
                console.error(`Failed to refresh estimation for pair ${pairId}:`, e);
            }
        }
    };

    // Re-simulate an existing action with a new target MW value
    const handleResimulate = async (actionId: string, newTargetMw: number) => {
        if (!disconnectedElement) return;
        setResimulating(actionId);
        try {
            const detail = actions[actionId];
            const actionContent = detail?.action_topology ? detail.action_topology as unknown as Record<string, unknown> : null;
            const result = await api.simulateManualAction(actionId, disconnectedElement, actionContent, linesOverloaded, newTargetMw);
            const newDetail: ActionDetail = {
                description_unitaire: result.description_unitaire,
                rho_before: result.rho_before,
                rho_after: result.rho_after,
                max_rho: result.max_rho,
                max_rho_line: result.max_rho_line,
                is_rho_reduction: result.is_rho_reduction,
                is_islanded: result.is_islanded,
                n_components: result.n_components,
                disconnected_mw: result.disconnected_mw,
                non_convergence: result.non_convergence,
                lines_overloaded_after: result.lines_overloaded_after,
                load_shedding_details: result.load_shedding_details,
                curtailment_details: result.curtailment_details,
                pst_details: result.pst_details,
            };
            onManualActionAdded(actionId, newDetail, result.lines_overloaded || []);
            // Clear the edit input so it picks up the new shedded/curtailed MW from results
            setCardEditMw(prev => {
                if (!prev[actionId]) return prev;
                const next = { ...prev };
                delete next[actionId];
                return next;
            });
            // Refresh combined estimations for pairs containing this action
            refreshCombinedEstimations(actionId);
        } catch (e: unknown) {
            console.error('Re-simulation failed:', e);
        } finally {
            setResimulating(null);
        }
    };

    // Re-simulate an existing PST action with a new tap position
    const handleResimulateTap = async (actionId: string, newTap: number) => {
        if (!disconnectedElement) return;
        setResimulating(actionId);
        try {
            const detail = actions[actionId];
            const actionContent = detail?.action_topology ? detail.action_topology as unknown as Record<string, unknown> : null;
            const result = await api.simulateManualAction(actionId, disconnectedElement, actionContent, linesOverloaded, null, newTap);
            const newDetail: ActionDetail = {
                description_unitaire: result.description_unitaire,
                rho_before: result.rho_before,
                rho_after: result.rho_after,
                max_rho: result.max_rho,
                max_rho_line: result.max_rho_line,
                is_rho_reduction: result.is_rho_reduction,
                is_islanded: result.is_islanded,
                n_components: result.n_components,
                disconnected_mw: result.disconnected_mw,
                non_convergence: result.non_convergence,
                lines_overloaded_after: result.lines_overloaded_after,
                load_shedding_details: result.load_shedding_details,
                curtailment_details: result.curtailment_details,
                pst_details: result.pst_details,
            };
            onManualActionAdded(actionId, newDetail, result.lines_overloaded || []);
            // Clear the edit input so it picks up the new tap from results
            setCardEditTap(prev => {
                if (!prev[actionId]) return prev;
                const next = { ...prev };
                delete next[actionId];
                return next;
            });
            // Refresh combined estimations for pairs containing this action
            refreshCombinedEstimations(actionId);
        } catch (e: unknown) {
            console.error('PST re-simulation failed:', e);
        } finally {
            setResimulating(null);
        }
    };

    // Sort actions by max_rho ascending (matching standalone)
    // Filter out combined actions that are only estimations (they will have '+' in ID but no rho_after yet)
    const sortedActionEntries = useMemo(() => {
        return Object.entries(actions)
            .filter(([id, details]) => {
                const isCombined = id.includes('+');
                if (!isCombined) return true;
                // Only show combined if it has been fully simulated (not just estimated)
                // Simulated actions will NOT have the is_estimated flag set.
                if (details.is_estimated) return false;
                return details.rho_after && details.rho_after.length > 0;
            })
            .sort(([, a], [, b]) => {
                const aIslanded = !!a.is_islanded;
                const bIslanded = !!b.is_islanded;
                if (aIslanded !== bIslanded) return aIslanded ? 1 : -1;
                return (a.max_rho ?? 999) - (b.max_rho ?? 999);
            });
    }, [actions]);

    const analysisActionIds = useMemo(() => {
        const ids = new Set<string>();
        if (!actionScores) return ids;
        for (const data of Object.values(actionScores)) {
            const scores = data?.scores || {};
            for (const actionId of Object.keys(scores)) {
                ids.add(actionId);
            }
        }
        return ids;
    }, [actionScores]);

    const selectedEntries = useMemo(() => {
        return sortedActionEntries.filter(([id]) => selectedActionIds.has(id));
    }, [sortedActionEntries, selectedActionIds]);

    const prioritizedEntries = useMemo(() => {
        if (analysisLoading) return [];
        return sortedActionEntries.filter(([id]) => !selectedActionIds.has(id) && !rejectedActionIds.has(id));
    }, [sortedActionEntries, selectedActionIds, rejectedActionIds, analysisLoading]);

    const rejectedEntries = useMemo(() => {
        return sortedActionEntries.filter(([id]) => rejectedActionIds.has(id));
    }, [sortedActionEntries, rejectedActionIds]);

    const activeAnalysisResult = useMemo(() => {
        if (pendingAnalysisResult) return pendingAnalysisResult;
        return {
            actions,
            combined_actions: combinedActions || {},
            lines_overloaded: linesOverloaded,
            action_scores: actionScores,
        } as AnalysisResult;
    }, [pendingAnalysisResult, actions, combinedActions, linesOverloaded, actionScores]);

    const renderActionList = (entries: [string, ActionDetail][]) => {
        return entries.map(([id, details], index) => {
            if (!details) return null;
            return (
                <ActionCard
                    key={id}
                    id={id}
                    details={details}
                    index={index}
                    isViewing={selectedActionId === id}
                    isSelected={selectedActionIds.has(id)}
                    isRejected={rejectedActionIds.has(id)}
                    linesOverloaded={linesOverloaded}
                    monitoringFactor={monitoringFactor}
                    nodesByEquipmentId={nodesByEquipmentId}
                    edgesByEquipmentId={edgesByEquipmentId}
                    cardEditMw={cardEditMw}
                    cardEditTap={cardEditTap}
                    resimulating={resimulating}
                    onActionSelect={onActionSelect}
                    onActionFavorite={onActionFavorite}
                    onActionReject={onActionReject}
                    onAssetClick={onAssetClick}
                    onVlDoubleClick={onVlDoubleClick}
                    onCardEditMwChange={(actionId, value) => setCardEditMw(prev => ({ ...prev, [actionId]: value }))}
                    onCardEditTapChange={(actionId, value) => setCardEditTap(prev => ({ ...prev, [actionId]: value }))}
                    onResimulate={handleResimulate}
                    onResimulateTap={handleResimulateTap}
                />
            );
        });
    };

    return (
        <div style={{ padding: '15px' }}>
            {/* Header with search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px', position: 'relative' }}>
                <h3 data-testid="action-feed-header" style={{ margin: 0, flex: 1 }}>Simulated Actions</h3>
                <button
                    onClick={handleOpenSearch}
                    style={{
                        background: searchOpen ? '#007bff' : '#e9ecef',
                        color: searchOpen ? 'white' : '#333',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 600,
                        marginRight: '6px'
                    }}
                >
                    + Manual Selection
                </button>
                <button
                    onClick={() => setCombineModalOpen(true)}
                    style={{
                        background: combineModalOpen ? '#007bff' : '#e9ecef',
                        color: combineModalOpen ? 'white' : '#333',
                        border: 'none',
                        borderRadius: '6px',
                        padding: '4px 10px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        fontWeight: 600,
                    }}
                >
                    ++ Combine
                </button>

                {/* Search dropdown */}
                {searchOpen && (
                    <ActionSearchDropdown
                        dropdownRef={dropdownRef}
                        searchInputRef={searchInputRef}
                        searchQuery={searchQuery}
                        onSearchQueryChange={setSearchQuery}
                        typeFilters={typeFilters}
                        onTypeFilterChange={(key) => setTypeFilters(prev => ({ ...prev, [key]: !prev[key] }))}
                        error={error}
                        loadingActions={loadingActions}
                        scoredActionsList={scoredActionsList}
                        filteredActions={filteredActions}
                        actionScores={actionScores}
                        actions={actions}
                        cardEditMw={cardEditMw}
                        onCardEditMwChange={(actionId, value) => setCardEditMw(prev => ({ ...prev, [actionId]: value }))}
                        cardEditTap={cardEditTap}
                        onCardEditTapChange={(actionId, value) => setCardEditTap(prev => ({ ...prev, [actionId]: value }))}
                        simulating={simulating}
                        resimulating={resimulating}
                        onAddAction={handleAddAction}
                        onResimulate={handleResimulate}
                        onResimulateTap={handleResimulateTap}
                        onShowTooltip={showTooltip}
                        onHideTooltip={hideTooltip}
                    />
                )}
            </div>
            {/* Action Dict Info Warning */}
            {showActionDictWarning && !simulating && !pendingAnalysisResult && Object.keys(actions).length === 0 && actionDictFileName && actionDictStats && (
                <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
                    gap: '8px', padding: '8px 10px',
                    background: '#fff3cd', border: '1px solid #ffeeba',
                    borderRadius: '6px', marginBottom: '10px', fontSize: '12px', color: '#856404'
                }}>
                    <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 600, marginBottom: '4px' }}>ℹ️ Action dictionary: <code style={{ fontFamily: 'monospace', background: '#fcf3cf', padding: '1px 4px', borderRadius: '3px', border: '1px solid #f9e79f' }}>{actionDictFileName}</code></div>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '4px' }}>
                            <span>🔄 Reco: <strong>{actionDictStats.reco}</strong></span>
                            <span>⛔ Disco: <strong>{actionDictStats.disco}</strong></span>
                            <span>📐 PST: <strong>{actionDictStats.pst}</strong></span>
                            <span>🔓 Open coupling: <strong>{actionDictStats.open_coupling}</strong></span>
                            <span>🔒 Close coupling: <strong>{actionDictStats.close_coupling}</strong></span>
                        </div>
                        {onOpenSettings && (
                            <button onClick={() => onOpenSettings('paths')} style={{ background: 'none', border: 'none', color: '#0056b3', textDecoration: 'underline', cursor: 'pointer', padding: 0, fontSize: '12px' }}>Change in settings</button>
                        )}
                    </div>
                    <button onClick={() => setShowActionDictWarning(false)} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '16px', lineHeight: 1, color: '#856404' }} title="Dismiss">✕</button>
                </div>
            )}
            <div style={{ marginBottom: '15px' }}>
                <h4 style={{ margin: '0 0 10px 0', fontSize: '14px', color: '#333', borderBottom: '1px solid #eee', paddingBottom: '4px', display: 'flex', justifyContent: 'flex-start', alignItems: 'center', gap: '8px' }}>
                    Selected Actions
                    {selectedEntries.length > 0 && <span style={{ background: '#e9ecef', color: '#495057', fontSize: '11px', padding: '2px 6px', borderRadius: '10px' }}>{selectedEntries.length}</span>}
                </h4>
                {selectedEntries.length > 0 ? (
                    <>
                        {!dismissedSelectedWarning && selectedEntries.some(([id]) => manuallyAddedIds.has(id) && analysisActionIds.has(id)) && (() => {
                            const overlapIds = selectedEntries.filter(([id]) => manuallyAddedIds.has(id) && analysisActionIds.has(id)).map(([id]) => id).join(', ');
                            return (
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', background: '#fff3cd', border: '1px solid #ffeeba', borderRadius: '6px', marginBottom: '10px', fontSize: '13px', color: '#856404' }}>
                                    <div>⚠️ User warning: The following manually selected actions are also recommended by the recent analysis run: {overlapIds}</div>
                                    <button onClick={() => setDismissedSelectedWarning(true)} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '16px', lineHeight: 1, color: '#856404' }} title="Dismiss">&times;</button>
                                </div>
                            );
                        })()}
                        {renderActionList(selectedEntries)}
                    </>
                ) : (
                    <p style={{ color: '#666', fontStyle: 'italic', fontSize: '13px', margin: '5px 0 15px 0' }}>Select an action manually or from suggested ones.</p>
                )}
            </div>

            <div style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', borderBottom: '1px solid #eee', marginBottom: '10px' }}>
                    <button
                        onClick={() => setSuggestedTab('prioritized')}
                        style={{ flex: 1, padding: '8px', cursor: 'pointer', border: 'none', background: 'none', borderBottom: suggestedTab === 'prioritized' ? '2px solid #007bff' : 'none', fontWeight: suggestedTab === 'prioritized' ? 'bold' : 'normal', color: suggestedTab === 'prioritized' ? '#007bff' : '#666', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                    >Suggested Actions {prioritizedEntries.length > 0 && <span style={{ background: suggestedTab === 'prioritized' ? '#e7f1ff' : '#f8f9fa', color: suggestedTab === 'prioritized' ? '#007bff' : '#6c757d', fontSize: '11px', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>{prioritizedEntries.length}</span>}</button>
                    <button
                        onClick={() => setSuggestedTab('rejected')}
                        style={{ flex: 1, padding: '8px', cursor: 'pointer', border: 'none', background: 'none', borderBottom: suggestedTab === 'rejected' ? '2px solid #e74c3c' : 'none', fontWeight: suggestedTab === 'rejected' ? 'bold' : 'normal', color: suggestedTab === 'rejected' ? '#e74c3c' : '#666', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '6px' }}
                    >Rejected Actions {rejectedEntries.length > 0 && <span style={{ background: suggestedTab === 'rejected' ? '#fdecea' : '#f8f9fa', color: suggestedTab === 'rejected' ? '#e74c3c' : '#6c757d', fontSize: '11px', padding: '2px 6px', borderRadius: '10px', fontWeight: 'bold' }}>{rejectedEntries.length}</span>}</button>
                </div>


                {/* Unified analysis action slot: Analyze & Suggest → Analyzing… → Display N prioritized actions */}
                {(analysisLoading || pendingAnalysisResult || !Object.values(actions).some(a => !a.is_manual)) && (
                    <div style={{ marginBottom: '10px' }}>
                        {analysisLoading ? (
                            <button disabled style={{
                                width: '100%', padding: '10px 16px',
                                background: '#fff3cd', color: '#856404',
                                border: '1px solid #ffeeba', borderRadius: '8px',
                                cursor: 'not-allowed', fontSize: '14px', fontWeight: 700,
                                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                            }}>
                                ⚙️ Analyzing…
                            </button>
                        ) : pendingAnalysisResult ? (
                            <button
                                onClick={onDisplayPrioritizedActions}
                                style={{
                                    width: '100%', padding: '10px 16px',
                                    background: 'linear-gradient(135deg, #27ae60, #2ecc71)',
                                    color: 'white', border: 'none', borderRadius: '8px',
                                    cursor: 'pointer', fontSize: '14px', fontWeight: 700,
                                    boxShadow: '0 2px 8px rgba(39,174,96,0.3)', transition: 'transform 0.1s',
                                }}
                                onMouseEnter={(e) => (e.target as HTMLButtonElement).style.transform = 'scale(1.02)'}
                                onMouseLeave={(e) => (e.target as HTMLButtonElement).style.transform = 'scale(1)'}
                            >
                                📊 Display {Object.keys(pendingAnalysisResult.actions || {}).length} prioritized actions
                            </button>
                        ) : (
                            <button
                                onClick={onRunAnalysis}
                                disabled={!canRunAnalysis}
                                style={{
                                    width: '100%', padding: '10px 16px',
                                    background: canRunAnalysis ? '#27ae60' : '#95a5a6',
                                    color: 'white', border: 'none', borderRadius: '8px',
                                    cursor: canRunAnalysis ? 'pointer' : 'not-allowed',
                                    fontSize: '14px', fontWeight: 700,
                                    boxShadow: canRunAnalysis ? '0 2px 8px rgba(39,174,96,0.3)' : 'none',
                                    transition: 'transform 0.1s',
                                }}
                                onMouseEnter={(e) => { if (canRunAnalysis) (e.target as HTMLButtonElement).style.transform = 'scale(1.02)'; }}
                                onMouseLeave={(e) => (e.target as HTMLButtonElement).style.transform = 'scale(1)'}
                            >
                                🔍 Analyze & Suggest
                            </button>
                        )}
                    </div>
                )}

                {suggestedTab === 'prioritized' && (
                    prioritizedEntries.length > 0 ? renderActionList(prioritizedEntries) : (
                        !analysisLoading ? (
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ color: '#666', fontStyle: 'italic', fontSize: '13px', margin: '5px 0' }}>
                                    {!pendingAnalysisResult ? 'Click \u201cAnalyze & Suggest\u201d above to get action suggestions.' : 'No suggested actions available.'}
                                </p>
                                {!pendingAnalysisResult && showRecommenderWarning && (
                                    <div style={{
                                        marginTop: '10px',
                                        padding: '10px',
                                        background: '#fff3cd',
                                        border: '1px solid #ffeeba',
                                        borderRadius: '6px',
                                        fontSize: '12px',
                                        color: '#856404',
                                        textAlign: 'left'
                                    }}>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '6px' }}>
                                            <div style={{ fontWeight: 'bold' }}>Recommender Settings:</div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                {onOpenSettings && (
                                                    <button
                                                        onClick={() => onOpenSettings('recommender')}
                                                        style={{
                                                            background: 'none',
                                                            border: 'none',
                                                            color: '#0056b3',
                                                            textDecoration: 'underline',
                                                            cursor: 'pointer',
                                                            padding: '0',
                                                            fontSize: '11px'
                                                        }}
                                                    >
                                                        Change in settings
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => setShowRecommenderWarning(false)}
                                                    style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontSize: '16px', lineHeight: 1, color: '#856404' }}
                                                    title="Dismiss"
                                                >&times;</button>
                                            </div>
                                        </div>
                                        <div>• Minimum actions: {recommenderConfig.minLineReconnections} reco, {recommenderConfig.minCloseCoupling} close, {recommenderConfig.minOpenCoupling} open, {recommenderConfig.minLineDisconnections} disco, {recommenderConfig.minPst} PST, {recommenderConfig.minLoadShedding} load shedding, {recommenderConfig.minRenewableCurtailmentActions} RC</div>
                                        <div>• Maximum suggestions: {recommenderConfig.nPrioritizedActions}</div>
                                        <div>• Ignore reconnections: {recommenderConfig.ignoreReconnections ? 'Yes' : 'No'}</div>
                                    </div>
                                )}
                            </div>
                        ) : null
                    )
                )}
                {suggestedTab === 'rejected' && (
                    rejectedEntries.length > 0 ? (
                        <>
                            {!dismissedRejectedWarning && rejectedEntries.some(([id]) => analysisActionIds.has(id)) && (() => {
                                const overlapIds = rejectedEntries.filter(([id]) => analysisActionIds.has(id)).map(([id]) => id).join(', ');
                                return (
                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', padding: '8px 10px', background: '#fff3cd', border: '1px solid #ffeeba', borderRadius: '6px', marginBottom: '10px', fontSize: '13px', color: '#856404' }}>
                                        <div>⚠️ User warning: The following manually rejected actions were recommended by the recent analysis run: {overlapIds}</div>
                                        <button onClick={() => setDismissedRejectedWarning(true)} style={{ flexShrink: 0, background: 'none', border: 'none', cursor: 'pointer', padding: '0', fontSize: '16px', lineHeight: 1, color: '#856404' }} title="Dismiss">&times;</button>
                                    </div>
                                );
                            })()}
                            {renderActionList(rejectedEntries)}
                        </>
                    ) : (
                        <p style={{ color: '#666', fontStyle: 'italic', fontSize: '13px', margin: '5px 0', textAlign: 'center' }}>No rejected actions.</p>
                    )
                )}
            </div>

            {/* Fixed-position tooltip rendered outside any overflow context */}
            {tooltip && (
                <div style={{
                    position: 'fixed',
                    top: tooltip.y,
                    left: tooltip.x,
                    zIndex: 99999,
                    backgroundColor: '#343a40',
                    color: '#fff',
                    textAlign: 'left',
                    borderRadius: '4px',
                    padding: '6px 8px',
                    fontSize: '10px',
                    fontWeight: 'normal',
                    whiteSpace: 'nowrap',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
                    lineHeight: 1.4,
                    pointerEvents: 'none',
                    maxWidth: '90vw',
                }}>
                    {tooltip.content}
                </div>
            )}

            {/* Combined Actions Modal */}
            <CombinedActionsModal
                isOpen={combineModalOpen}
                onClose={() => setCombineModalOpen(false)}
                analysisResult={activeAnalysisResult}
                simulatedActions={actions}
                disconnectedElement={disconnectedElement}
                onSimulateCombined={onManualActionAdded}
                monitoringFactor={monitoringFactor}
                linesOverloaded={linesOverloaded}
            />
        </div>
    );
};

export default React.memo(ActionFeed);
