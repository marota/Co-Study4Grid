// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import React, { useState, useEffect, useRef, useMemo } from 'react';
import type { ActionDetail, NodeMeta, EdgeMeta, AvailableAction, AnalysisResult, CombinedAction } from '../types';
import { api } from '../api';
import { getActionTargetVoltageLevels, getActionTargetLines, isCouplingAction } from '../utils/svgUtils';
import CombinedActionsModal from './CombinedActionsModal';

interface ActionFeedProps {
    actions: Record<string, ActionDetail>;
    actionScores?: Record<string, Record<string, unknown>>;
    linesOverloaded: string[];
    selectedActionId: string | null;
    selectedActionIds: Set<string>;
    rejectedActionIds: Set<string>;
    pendingAnalysisResult: AnalysisResult | null;
    onDisplayPrioritizedActions: () => void;
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
    minLineReconnections: number;
    minCloseCoupling: number;
    minOpenCoupling: number;
    minLineDisconnections: number;
    nPrioritizedActions: number;
    minPst: number;
    minLoadShedding: number;
    ignoreReconnections: boolean;
    onOpenSettings?: (tab?: 'recommender' | 'configurations' | 'paths') => void;
    actionDictFileName?: string | null;
    actionDictStats?: { reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number } | null;
    combinedActions: Record<string, CombinedAction> | null;
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
    minLineReconnections,
    minCloseCoupling,
    minOpenCoupling,
    minLineDisconnections,
    minPst,
    minLoadShedding,
    nPrioritizedActions,
    ignoreReconnections,
    onOpenSettings,
    actionDictFileName,
    actionDictStats,
    combinedActions,
}) => {
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [combineModalOpen, setCombineModalOpen] = useState(false);
    const [availableActions, setAvailableActions] = useState<AvailableAction[]>([]);
    const [loadingActions, setLoadingActions] = useState(false);
    const [simulating, setSimulating] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [typeFilters, setTypeFilters] = useState({ disco: true, reco: true, open: true, close: true, pst: true, ls: true });
    const searchInputRef = useRef<HTMLInputElement>(null);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const [tooltip, setTooltip] = useState<{ content: React.ReactNode; x: number; y: number } | null>(null);
    const [suggestedTab, setSuggestedTab] = useState<'prioritized' | 'rejected'>('prioritized');
    const [dismissedSelectedWarning, setDismissedSelectedWarning] = useState(false);
    const [dismissedRejectedWarning, setDismissedRejectedWarning] = useState(false);
    const [showActionDictWarning, setShowActionDictWarning] = useState(true);

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

                if (isDisco) return typeFilters.disco;
                if (isReco) return typeFilters.reco;
                if (isOpenCoupling) return typeFilters.open;
                if (isCloseCoupling) return typeFilters.close;
                if (isPstAction) return typeFilters.pst;
                if (isLoadShedding) return typeFilters.ls;

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

            // If it's a known type but its filter is off, it's already skipped.
            // If it's an unknown type, we show it only if ALL filters are active.
            const isKnownType = isDiscoType || isRecoType || isOpenType || isCloseType || isPstType || type === 'load_shedding' || type.includes('load_shedding');
            if (!isKnownType && !(typeFilters.disco && typeFilters.reco && typeFilters.open && typeFilters.close && typeFilters.pst && typeFilters.ls)) {
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

                let shouldShow = false;
                if (isDisco) shouldShow = typeFilters.disco;
                else if (isReco) shouldShow = typeFilters.reco;
                else if (isOpenCoupling) shouldShow = typeFilters.open;
                else if (isCloseCoupling) shouldShow = typeFilters.close;
                else if (isPstAction) shouldShow = typeFilters.pst;
                else if (isLoadShedding) shouldShow = typeFilters.ls;
                else shouldShow = typeFilters.disco && typeFilters.reco && typeFilters.open && typeFilters.close && typeFilters.pst && typeFilters.ls;

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

    const handleAddAction = async (actionId: string) => {
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

            const result = await api.simulateManualAction(trimmedId, disconnectedElement, actionContent, linesOverloaded);
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
                load_shedding_details: result.load_shedding_details,
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

    const clickableLinkStyle: React.CSSProperties = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        fontSize: 'inherit',
        color: '#1e40af',
        fontWeight: 600,
        textDecoration: 'underline dotted',
    };

    const renderRho = (arr: number[] | null, actionId: string, tab: 'action' | 'n-1' = 'action'): React.ReactNode => {
        if (!arr || arr.length === 0) return '\u2014';
        return arr.map((v, i) => {
            const lineName = linesOverloaded[i] || `line ${i}`;
            return (
                <React.Fragment key={i}>
                    {i > 0 && ', '}
                    <button
                        style={clickableLinkStyle}
                        title={`Zoom to ${lineName}`}
                        onClick={(e) => { e.stopPropagation(); onAssetClick(actionId, lineName, tab); }}
                    >{lineName}</button>
                    {`: ${(v * 100).toFixed(1)}%`}
                </React.Fragment>
            );
        });
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
            const maxRhoPct = details.max_rho != null ? (details.max_rho * 100).toFixed(1) : null;
            const severity = details.max_rho != null
                ? (details.max_rho > monitoringFactor ? 'red' as const : details.max_rho > (monitoringFactor - 0.05) ? 'orange' as const : 'green' as const)
                : (details.is_rho_reduction ? 'green' as const : 'red' as const);
            const severityColors = {
                green: { border: '#28a745', badgeBg: '#d4edda', badgeText: '#155724', label: 'Solves overload' },
                orange: { border: '#f0ad4e', badgeBg: '#fff3cd', badgeText: '#856404', label: 'Solved \u2014 low margin' },
                red: { border: '#dc3545', badgeBg: '#f8d7da', badgeText: '#721c24', label: details.is_rho_reduction ? 'Still overloaded' : 'No reduction' },
            };
            const sc = details.non_convergence
                ? { border: '#dc3545', badgeBg: '#dc3545', badgeText: '#fff', label: 'divergent' }
                : details.is_islanded
                    ? { border: '#dc3545', badgeBg: '#dc3545', badgeText: '#fff', label: 'islanded' }
                    : severityColors[severity];
            const isSelected = selectedActionId === id;
            return (
                <div key={id}
                    data-testid={`action-card-${id}`}
                    style={{
                        background: (details.non_convergence || details.is_islanded) ? '#fff5f5' : (isSelected ? '#e7f1ff' : 'white'),
                        border: (details.non_convergence || details.is_islanded) ? '1px solid #dc3545' : '1px solid #ddd',
                        borderRadius: '8px',
                        padding: '10px',
                        marginBottom: '10px',
                        boxShadow: isSelected ? '0 0 0 2px rgba(0,123,255,0.3), 0 2px 8px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.1)',
                        borderLeft: `5px solid ${isSelected ? '#007bff' : sc.border}`,
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                    }} onClick={() => onActionSelect(id)}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <h4 style={{
                            margin: 0,
                            fontSize: '14px',
                            color: isSelected ? '#0056b3' : undefined,
                            flex: 1,
                            minWidth: 0,
                            overflowWrap: 'anywhere'
                        }}>
                            #{index + 1} {'\u2014'} {id}
                        </h4>
                        <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                            {isSelected && (
                                <span style={{ fontSize: '10px', fontWeight: 600, padding: '2px 6px', borderRadius: '4px', background: '#007bff', color: 'white' }}>
                                    VIEWING
                                </span>
                            )}
                            <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: sc.badgeBg, color: sc.badgeText }}>
                                {sc.label}
                            </span>
                        </div>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', margin: '4px 0 5px' }}>
                        <div style={{ flex: 1 }}>
                            <p style={{ fontSize: '13px', margin: 0 }}>{details.description_unitaire}</p>
                            {details.load_shedding_details && details.load_shedding_details.length > 0 && (
                                <div style={{ fontSize: '12px', background: '#fef3c7', color: '#92400e', padding: '6px 10px', marginTop: '5px', borderRadius: '4px', border: '1px solid #fcd34d', fontWeight: 500 }}>
                                    {details.load_shedding_details.map((ls, i) => (
                                        <div key={ls.load_name}>
                                            {i > 0 && <br />}
                                            Load shedding of <strong>{ls.shedded_mw} MW</strong> on load <strong>{ls.load_name}</strong>
                                            {ls.voltage_level_id && (
                                                <> at voltage level <button
                                                    style={{ ...clickableLinkStyle, fontSize: '12px', color: '#92400e', fontWeight: 700 }}
                                                    title={`Double-click to open SLD for ${ls.voltage_level_id}`}
                                                    onClick={(e) => { e.stopPropagation(); onAssetClick(id, ls.voltage_level_id!, 'action'); }}
                                                    onDoubleClick={(e) => { e.stopPropagation(); onVlDoubleClick?.(id, ls.voltage_level_id!); }}
                                                >{ls.voltage_level_id}</button></>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}
                            {details.non_convergence && (
                                <div style={{ fontSize: '11px', color: '#9a3412', backgroundColor: '#fff8f1', padding: '2px 6px', borderRadius: '4px', marginTop: '4px', border: '1px solid #ffedd5', display: 'inline-block' }}>
                                    ⚠️ LoadFlow failure: {details.non_convergence}
                                </div>
                            )}
                            {details.is_islanded && (
                                <div style={{ fontSize: '12px', background: '#fff5f5', color: '#dc3545', padding: '6px 10px', marginTop: '5px', borderRadius: '4px', border: '1px solid #dc3545', fontWeight: 500 }}>
                                    🏝️ Islanding detected ({details.disconnected_mw?.toFixed(1)} MW disconnected)
                                </div>
                            )}
                        </div>
                        {(() => {
                            const badges: React.ReactNode[] = [];
                            const isLoadShedding = details.load_shedding_details && details.load_shedding_details.length > 0;
                            const badgeBtn = (name: string, bg: string, color: string, title: string, onDoubleClick?: (e: React.MouseEvent) => void) => (
                                <button key={name}
                                    style={{ padding: '2px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600, textDecoration: 'underline dotted', flexShrink: 0, backgroundColor: bg, color }}
                                    title={title}
                                    onClick={(e) => { e.stopPropagation(); onAssetClick(id, name, 'action'); }}
                                    onDoubleClick={onDoubleClick}>
                                    {name}
                                </button>
                            );

                            // For load shedding actions, show VL badges from load_shedding_details
                            if (isLoadShedding) {
                                const vlSet = new Set<string>();
                                details.load_shedding_details!.forEach(ls => {
                                    if (ls.voltage_level_id && !vlSet.has(ls.voltage_level_id)) {
                                        vlSet.add(ls.voltage_level_id);
                                        badges.push(badgeBtn(ls.voltage_level_id, '#d1fae5', '#065f46', `Click: zoom to ${ls.voltage_level_id} | Double-click: open SLD`, (e) => {
                                            e.stopPropagation();
                                            onVlDoubleClick?.(id, ls.voltage_level_id!);
                                        }));
                                    }
                                });
                            } else {
                                // 1. Substations (VLs)
                                if (nodesByEquipmentId) {
                                    const vlNames = getActionTargetVoltageLevels(details, id, nodesByEquipmentId);
                                    vlNames.forEach(vlName => {
                                        badges.push(badgeBtn(vlName, '#d1fae5', '#065f46', `Click: zoom to ${vlName} | Double-click: open SLD`, (e) => {
                                            e.stopPropagation();
                                            onVlDoubleClick?.(id, vlName);
                                        }));
                                    });
                                }

                                // 2. Lines / Equipments
                                const isCoupling = isCouplingAction(id, details.description_unitaire);
                                const lineNames = edgesByEquipmentId
                                    ? getActionTargetLines(details, id, edgesByEquipmentId)
                                    : Array.from(new Set([
                                        ...(isCoupling ? [] : Object.keys(details.action_topology?.lines_ex_bus || {})),
                                        ...(isCoupling ? [] : Object.keys(details.action_topology?.lines_or_bus || {})),
                                        ...Object.keys(details.action_topology?.pst_tap || {}),
                                    ]));

                                lineNames.forEach(name => {
                                    if (badges.some(b => React.isValidElement(b) && b.key === name)) return;
                                    badges.push(badgeBtn(name, '#dbeafe', '#1e40af', `Zoom to ${name}`));
                                });

                                // 3. Fallback: gen/load equipment names from topology
                                if (badges.length === 0) {
                                    const topo = details.action_topology;
                                    const equipNames = Array.from(new Set([
                                        ...Object.keys(topo?.gens_bus || {}),
                                        ...Object.keys(topo?.loads_bus || {}),
                                    ]));
                                    equipNames.forEach(name => {
                                        badges.push(badgeBtn(name, '#dbeafe', '#1e40af', `Zoom to ${name}`));
                                    });
                                }
                            }

                            return (
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', flexShrink: 0, maxWidth: '180px', justifyContent: 'flex-end' }}>
                                    {badges}
                                </div>
                            );
                        })()}
                    </div>
                    <div style={{ fontSize: '12px', background: isSelected ? '#dce8f7' : '#f8f9fa', padding: '5px', marginTop: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                        <div>
                            <div>Loading before: {renderRho(details.rho_before, id, 'n-1')}</div>
                            <div>Loading after: {renderRho(details.rho_after, id, 'action')}</div>
                            {maxRhoPct != null && (
                                <div style={{ marginTop: '3px' }}>
                                    Max loading: <strong style={{ color: sc.border }}>{maxRhoPct}%</strong>
                                    {details.max_rho_line && (
                                        <span style={{ color: '#888' }}> on <button
                                            style={{ ...clickableLinkStyle, color: '#888' }}
                                            title={`Zoom to ${details.max_rho_line}`}
                                            onClick={(e) => { e.stopPropagation(); onAssetClick(id, details.max_rho_line, 'action'); }}
                                        >{details.max_rho_line}</button></span>
                                    )}
                                </div>
                            )}
                        </div>
                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0, paddingBottom: '2px' }}>
                            {!selectedActionIds.has(id) && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onActionFavorite(id); }}
                                    style={{ background: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    title="Select this action"
                                ><span style={{ fontSize: '14px' }}>⭐</span></button>
                            )}
                            {!rejectedActionIds.has(id) && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); onActionReject(id); }}
                                    style={{ background: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                    title={selectedActionIds.has(id) ? "Remove from selected" : "Reject this action"}
                                ><span style={{ fontSize: '14px' }}>❌</span></button>
                            )}
                        </div>
                    </div>
                </div >
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
                    <div
                        ref={dropdownRef}
                        style={{
                            position: 'absolute',
                            top: '100%',
                            right: 0,
                            left: 0,
                            zIndex: 100,
                            backgroundColor: 'white',
                            border: '1px solid #ccc',
                            borderRadius: '8px',
                            boxShadow: '0 4px 16px rgba(0,0,0,0.15)',
                            marginTop: '4px',
                            overflow: 'hidden',
                        }}
                    >
                        <div style={{ padding: '8px' }}>
                            <input
                                ref={searchInputRef}
                                type="text"
                                placeholder="Search action by ID or description..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                style={{
                                    width: '100%',
                                    padding: '6px 10px',
                                    border: '1px solid #ccc',
                                    borderRadius: '4px',
                                    fontSize: '13px',
                                    boxSizing: 'border-box',
                                }}
                            />
                        </div>
                        {/* Action type filter checkboxes */}
                        <div style={{ padding: '4px 8px', display: 'flex', flexWrap: 'wrap', gap: '6px', borderTop: '1px solid #eee', fontSize: '11px' }}>
                            {([['disco', 'Disconnections'], ['reco', 'Reconnections'], ['ls', 'Load Shedding'], ['pst', 'PST'], ['open', 'Open coupling'], ['close', 'Close coupling']] as const).map(([key, label]) => (
                                <label key={key} style={{ display: 'flex', alignItems: 'center', gap: '3px', cursor: 'pointer', color: '#555' }}>
                                    <input
                                        type="checkbox"
                                        checked={typeFilters[key]}
                                        onChange={() => setTypeFilters(prev => ({ ...prev, [key]: !prev[key] }))}
                                        style={{ margin: 0, cursor: 'pointer' }}
                                    />
                                    {label}
                                </label>
                            ))}
                        </div>
                        {error && (
                            <div style={{
                                padding: '6px 8px',
                                fontSize: '12px',
                                color: '#dc3545',
                                borderTop: '1px solid #eee',
                            }}>
                                {error}
                            </div>
                        )}
                        <div style={{ maxHeight: '250px', overflowY: 'auto' }}>
                            {loadingActions ? (
                                <div style={{ padding: '10px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
                                    Loading actions...
                                </div>
                            ) : (
                                <>
                                    {/* Action Scores Table */}
                                    {scoredActionsList.length > 0 && !searchQuery && (
                                        <div style={{ padding: '0 8px', marginBottom: '8px' }}>
                                            <div style={{ fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '4px' }}>
                                                Scored Actions
                                            </div>
                                            {Array.from(new Set(scoredActionsList.map(item => item.type))).map(type => {
                                                const typeData = (actionScores?.[type] || {}) as {
                                                    scores?: Record<string, number>;
                                                    params?: Record<string, Record<string, unknown>>;
                                                    non_convergence?: Record<string, string | null>;
                                                };
                                                const scoresKeys = Object.keys(typeData.scores || {});
                                                const paramsKeys = Object.keys(typeData.params || {});
                                                const isPerActionParams = paramsKeys.length > 0 && paramsKeys.some((k: string) => scoresKeys.includes(k));
                                                const globalParams = isPerActionParams ? null : (paramsKeys.length > 0 ? typeData.params : null);

                                                return (
                                                    <div key={type} style={{ marginBottom: '8px' }}>
                                                        <div style={{ fontSize: '11px', fontWeight: 600, color: '#0056b3', backgroundColor: '#e9ecef', padding: '2px 6px', borderRadius: '4px 4px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                                            <span>{type.replace('_', ' ').toUpperCase()}</span>
                                                            {globalParams && (
                                                                <span
                                                                    style={{ color: '#6c757d', fontSize: '12px', cursor: 'help', marginLeft: '6px' }}
                                                                    onMouseEnter={(e) => showTooltip(e, (
                                                                        <>
                                                                            <div style={{ fontWeight: 700, marginBottom: '2px', borderBottom: '1px solid #555', paddingBottom: '2px' }}>Scoring Parameters</div>
                                                                            {Object.entries(globalParams).map(([k, v]) => (
                                                                                <div key={k}>
                                                                                    <span style={{ color: '#adb5bd' }}>{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                                                                </div>
                                                                            ))}
                                                                        </>
                                                                    ))}
                                                                    onMouseLeave={hideTooltip}
                                                                >i</span>
                                                            )}
                                                        </div>
                                                        <table style={{ width: '100%', fontSize: '11px', borderCollapse: 'collapse', border: '1px solid #e9ecef', borderTop: 'none' }}>
                                                            <thead>
                                                                <tr style={{ background: '#f8f9fa', borderBottom: '1px solid #ddd' }}>
                                                                    <th style={{ textAlign: 'left', padding: '4px 6px', width: '55%' }}>Action</th>
                                                                    <th style={{ textAlign: 'right', padding: '4px 6px', width: '20%' }}>MW Start</th>
                                                                    <th style={{ textAlign: 'right', padding: '4px 6px', width: '25%' }}>Score</th>
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {scoredActionsList.filter(item => item.type === type).map(item => {
                                                                    const isComputed = !!actions[item.actionId];
                                                                    return (
                                                                        <tr key={item.actionId}
                                                                            onClick={() => !isComputed && handleAddAction(item.actionId)}
                                                                            style={{
                                                                                borderBottom: '1px solid #eee',
                                                                                cursor: (isComputed || simulating) ? 'not-allowed' : 'pointer',
                                                                                color: isComputed ? '#888' : 'inherit',
                                                                                opacity: simulating === item.actionId ? 0.7 : 1,
                                                                                background: simulating === item.actionId ? '#e7f1ff' : 'transparent',
                                                                            }}>
                                                                            <td style={{ padding: '4px 6px', fontWeight: 600, display: 'flex', alignItems: 'center' }}>
                                                                                {item.actionId}
                                                                                {isComputed && (
                                                                                    actions[item.actionId]?.non_convergence ? (
                                                                                        <span data-testid={`badge-divergent-${item.actionId}`} style={{ marginLeft: '4px', background: '#dc3545', color: '#fff', padding: '2px 4px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' }} title={actions[item.actionId].non_convergence || undefined}>divergent</span>
                                                                                    ) : actions[item.actionId]?.is_islanded ? (
                                                                                        <span data-testid={`badge-islanded-${item.actionId}`} style={{ marginLeft: '4px', background: '#dc3545', color: '#fff', padding: '2px 4px', borderRadius: '4px', fontSize: '9px', fontWeight: 'bold' }} title={`Islanding detected: ${actions[item.actionId].disconnected_mw?.toFixed(1)} MW disconnected`}>islanded</span>
                                                                                    ) : (
                                                                                        <span data-testid={`badge-computed-${item.actionId}`} style={{ marginLeft: '4px', background: '#28a745', color: '#fff', padding: '2px 4px', borderRadius: '4px', fontSize: '9px', opacity: 0.8 }}>computed</span>
                                                                                    )
                                                                                )}
                                                                                {isPerActionParams && typeData.params?.[item.actionId] && (
                                                                                    <span
                                                                                        style={{ color: '#6c757d', fontSize: '12px', cursor: 'help', marginLeft: '6px' }}
                                                                                        onClick={(e) => e.stopPropagation()}
                                                                                        onMouseEnter={(e) => showTooltip(e, (
                                                                                            <>
                                                                                                <div style={{ fontWeight: 700, marginBottom: '2px', borderBottom: '1px solid #555', paddingBottom: '2px' }}>Parameters</div>
                                                                                                {typeData.non_convergence?.[item.actionId] && (
                                                                                                    <div style={{ fontSize: '10px', color: '#dc3545' }}>
                                                                                                        ⚠️ Non-convergence: {typeData.non_convergence[item.actionId]}
                                                                                                    </div>
                                                                                                )}
                                                                                                {(actions[item.actionId]?.is_islanded) && (
                                                                                                    <div style={{ fontSize: '10px', color: '#c2410c' }}>
                                                                                                        🏝️ Islanding: {actions[item.actionId].n_components} components
                                                                                                    </div>
                                                                                                )}
                                                                                                {Object.entries(typeData.params![item.actionId]).map(([k, v]) => (
                                                                                                    <div key={k}>
                                                                                                        <span style={{ color: '#adb5bd' }}>{k}:</span> {typeof v === 'object' ? JSON.stringify(v) : String(v)}
                                                                                                    </div>
                                                                                                ))}
                                                                                            </>
                                                                                        ))}
                                                                                        onMouseLeave={hideTooltip}
                                                                                    >i</span>
                                                                                )}
                                                                            </td>
                                                                            <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace', color: item.mwStart == null ? '#aaa' : '#333' }}>
                                                                                {item.mwStart != null ? item.mwStart.toFixed(1) : 'N/A'}
                                                                            </td>
                                                                            <td style={{ padding: '4px 6px', textAlign: 'right', fontFamily: 'monospace' }}>
                                                                                {item.score.toFixed(2)}
                                                                            </td>
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    )}

                                    {/* Search Results */}
                                    {(!searchQuery && scoredActionsList.length === 0 && filteredActions.length === 0) && (
                                        <div style={{ padding: '10px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
                                            All actions already added
                                        </div>
                                    )}
                                    {searchQuery && !filteredActions.some(a => a.id === searchQuery) && (
                                        <div
                                            data-testid={`manual-id-option-${searchQuery}`}
                                            onClick={() => handleAddAction(searchQuery)}
                                            style={{
                                                padding: '8px 10px',
                                                cursor: simulating ? 'wait' : 'pointer',
                                                borderTop: '1px solid #eee',
                                                backgroundColor: '#f8f9fa',
                                                color: '#007bff',
                                                fontSize: '12px',
                                                fontWeight: 600,
                                            }}
                                            onMouseEnter={(e) => (e.currentTarget as HTMLDivElement).style.backgroundColor = '#eef6ff'}
                                            onMouseLeave={(e) => (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f8f9fa'}
                                        >
                                            ✨ Simulate manual ID: <strong>{searchQuery}</strong>
                                        </div>
                                    )}
                                    {(searchQuery && filteredActions.length === 0 && searchQuery !== (filteredActions[0]?.id)) && (
                                        <div style={{ padding: '10px', textAlign: 'center', color: '#888', fontSize: '13px' }}>
                                            No other matching actions
                                        </div>
                                    )}
                                    {((!searchQuery && scoredActionsList.length === 0) || searchQuery) && filteredActions.map(a => (
                                        <div
                                            key={a.id}
                                            data-testid={`action-card-${a.id}`}
                                            onClick={() => handleAddAction(a.id)}
                                            style={{
                                                padding: '6px 10px',
                                                cursor: simulating ? 'wait' : 'pointer',
                                                borderTop: '1px solid #eee',
                                                backgroundColor: simulating === a.id ? '#e7f1ff' : 'transparent',
                                                opacity: simulating && simulating !== a.id ? 0.5 : 1,
                                            }}
                                            onMouseEnter={(e) => { if (!simulating) (e.currentTarget as HTMLDivElement).style.backgroundColor = '#f0f0f0'; }}
                                            onMouseLeave={(e) => { if (simulating !== a.id) (e.currentTarget as HTMLDivElement).style.backgroundColor = 'transparent'; }}
                                        >
                                            <div style={{ fontWeight: 600, fontSize: '12px', color: '#333' }}>
                                                {simulating === a.id ? 'Simulating...' : a.id}
                                            </div>
                                            {a.description && (
                                                <div style={{ fontSize: '11px', color: '#777', marginTop: '2px' }}>
                                                    {a.description}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>
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


                {/* Processing indicator during analysis */}
                {analysisLoading && (
                    <div style={{
                        padding: '12px',
                        background: '#fff3cd',
                        border: '1px solid #ffeeba',
                        borderRadius: '8px',
                        marginBottom: '15px',
                        textAlign: 'center',
                        color: '#856404',
                        fontWeight: 600,
                        fontSize: '14px',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                        animation: 'pulse 2s infinite ease-in-out'
                    }}>
                        ⚙️ Processing analysis...
                    </div>
                )}
                {/* Display prioritized actions button inside Suggested Actions section */}
                {pendingAnalysisResult && !analysisLoading && (
                    <button
                        onClick={onDisplayPrioritizedActions}
                        style={{
                            width: '100%',
                            padding: '10px 16px',
                            margin: '0 0 10px 0',
                            background: 'linear-gradient(135deg, #27ae60, #2ecc71)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '8px',
                            cursor: 'pointer',
                            fontSize: '14px',
                            fontWeight: 700,
                            boxShadow: '0 2px 8px rgba(39,174,96,0.3)',
                            transition: 'transform 0.1s',
                        }}
                        onMouseEnter={(e) => (e.target as HTMLButtonElement).style.transform = 'scale(1.02)'}
                        onMouseLeave={(e) => (e.target as HTMLButtonElement).style.transform = 'scale(1)'}
                    >
                        📊 Display {Object.keys(pendingAnalysisResult.actions || {}).length} prioritized actions
                    </button>
                )}

                {suggestedTab === 'prioritized' && (
                    prioritizedEntries.length > 0 ? renderActionList(prioritizedEntries) : (
                        !analysisLoading ? (
                            <div style={{ textAlign: 'center' }}>
                                <p style={{ color: '#666', fontStyle: 'italic', fontSize: '13px', margin: '5px 0' }}>
                                    {!pendingAnalysisResult ? 'Run analysis to get action suggestions.' : 'No suggested actions available.'}
                                </p>
                                {!pendingAnalysisResult && (
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
                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <div style={{ fontWeight: 'bold' }}>Recommender Settings:</div>
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
                                        </div>
                                        <div>• Minimum actions: {minLineReconnections} reco, {minCloseCoupling} close, {minOpenCoupling} open, {minLineDisconnections} disco, {minPst} PST, {minLoadShedding} load shedding</div>
                                        <div>• Maximum suggestions: {nPrioritizedActions}</div>
                                        <div>• Ignore reconnections: {ignoreReconnections ? 'Yes' : 'No'}</div>
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

export default ActionFeed;
