// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React from 'react';
import type { ActionDetail, NodeMeta, EdgeMeta } from '../types';
import { getActionTargetVoltageLevels, getActionTargetLines, isCouplingAction } from '../utils/svgUtils';

interface ActionCardProps {
    id: string;
    details: ActionDetail;
    index: number;
    isViewing: boolean;
    isSelected: boolean;
    isRejected: boolean;
    linesOverloaded: string[];
    monitoringFactor: number;
    nodesByEquipmentId: Map<string, NodeMeta> | null;
    edgesByEquipmentId: Map<string, EdgeMeta> | null;
    cardEditMw: Record<string, string>;
    cardEditTap: Record<string, string>;
    resimulating: string | null;
    onActionSelect: (actionId: string | null) => void;
    onActionFavorite: (actionId: string) => void;
    onActionReject: (actionId: string) => void;
    onAssetClick: (actionId: string, assetName: string, tab?: 'action' | 'n-1') => void;
    onVlDoubleClick?: (actionId: string, vlName: string) => void;
    onCardEditMwChange: (actionId: string, value: string) => void;
    onCardEditTapChange: (actionId: string, value: string) => void;
    onResimulate: (actionId: string, newMw: number) => void;
    onResimulateTap: (actionId: string, newTap: number) => void;
    /** Resolve an element ID to its human-readable display name. Falls back to the ID. */
    displayName?: (id: string) => string;
}

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

const ActionCard: React.FC<ActionCardProps> = ({
    id,
    details,
    index,
    isViewing,
    isSelected,
    isRejected,
    linesOverloaded,
    monitoringFactor,
    nodesByEquipmentId,
    edgesByEquipmentId,
    cardEditMw,
    cardEditTap,
    resimulating,
    onActionSelect,
    onActionFavorite,
    onActionReject,
    onAssetClick,
    onVlDoubleClick,
    onCardEditMwChange,
    onCardEditTapChange,
    onResimulate,
    onResimulateTap,
    displayName = (id: string) => id,
}) => {
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
                    >{displayName(lineName)}</button>
                    {`: ${(v * 100).toFixed(1)}%`}
                </React.Fragment>
            );
        });
    };

    const renderBadges = () => {
        const badges: React.ReactNode[] = [];
        const badgeBtn = (name: string, bg: string, color: string, title: string, onDoubleClick?: (e: React.MouseEvent) => void) => (
            <button key={name}
                style={{ padding: '2px 7px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontSize: '11px', fontWeight: 600, textDecoration: 'underline dotted', flexShrink: 0, backgroundColor: bg, color }}
                title={title}
                onClick={(e) => { e.stopPropagation(); onAssetClick(id, name, 'action'); }}
                onDoubleClick={onDoubleClick}>
                {displayName(name)}
            </button>
        );

        // Collect badges from every source that applies. A combined
        // action like ``load_shedding_X+reco_Y`` owes a badge to BOTH
        // sub-actions — using an if/else-if/else here used to drop the
        // topology-based sub-action (reco / disco / coupling) whenever
        // the pair also contained a load-shedding or curtailment leg.
        const vlSet = new Set<string>();

        details.load_shedding_details?.forEach(ls => {
            if (ls.voltage_level_id && !vlSet.has(ls.voltage_level_id)) {
                vlSet.add(ls.voltage_level_id);
                badges.push(badgeBtn(ls.voltage_level_id, '#d1fae5', '#065f46', `Click: zoom to ${ls.voltage_level_id} | Double-click: open SLD`, (e) => {
                    e.stopPropagation();
                    onVlDoubleClick?.(id, ls.voltage_level_id!);
                }));
            }
        });

        details.curtailment_details?.forEach(rc => {
            if (rc.voltage_level_id && !vlSet.has(rc.voltage_level_id)) {
                vlSet.add(rc.voltage_level_id);
                badges.push(badgeBtn(rc.voltage_level_id, '#d1fae5', '#065f46', `Click: zoom to ${rc.voltage_level_id} | Double-click: open SLD`, (e) => {
                    e.stopPropagation();
                    onVlDoubleClick?.(id, rc.voltage_level_id!);
                }));
            }
        });

        if (nodesByEquipmentId) {
            const vlNames = getActionTargetVoltageLevels(details, id, nodesByEquipmentId);
            vlNames.forEach(vlName => {
                if (vlSet.has(vlName)) return;
                vlSet.add(vlName);
                badges.push(badgeBtn(vlName, '#d1fae5', '#065f46', `Click: zoom to ${vlName} | Double-click: open SLD`, (e) => {
                    e.stopPropagation();
                    onVlDoubleClick?.(id, vlName);
                }));
            });
        }

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

        if (badges.length === 0) {
            const topo = details.action_topology;
            const equipNames = Array.from(new Set([
                ...Object.keys(topo?.gens_bus || {}),
                ...Object.keys(topo?.loads_bus || {}),
                ...Object.keys(topo?.loads_p || {}),
                ...Object.keys(topo?.gens_p || {}),
            ]));
            equipNames.forEach(name => {
                badges.push(badgeBtn(name, '#dbeafe', '#1e40af', `Zoom to ${name}`));
            });
        }

        return (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', flexShrink: 0, maxWidth: '180px', justifyContent: 'flex-end' }}>
                {badges}
            </div>
        );
    };

    return (
        <div
            data-testid={`action-card-${id}`}
            style={{
                background: (details.non_convergence || details.is_islanded) ? '#fff5f5' : (isViewing ? '#e7f1ff' : 'white'),
                border: (details.non_convergence || details.is_islanded) ? '1px solid #dc3545' : '1px solid #ddd',
                borderRadius: '8px',
                marginBottom: '10px',
                boxShadow: isViewing ? '0 0 0 2px rgba(0,123,255,0.3), 0 2px 8px rgba(0,0,0,0.15)' : '0 2px 4px rgba(0,0,0,0.1)',
                borderLeft: `5px solid ${isViewing ? '#007bff' : sc.border}`,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
                display: 'flex',
                alignItems: 'stretch',
                overflow: 'hidden',
            }} onClick={() => onActionSelect(id)}>
            {/*
              When the card is the currently-viewed action, the
              VIEWING marker is rendered as a vertical ribbon flush
              against the left edge (between the colored border and
              the content) — this frees up a full line of horizontal
              space inside the header, which matters on a narrow
              sidebar with long equipment IDs.

              Implementation note: `writing-mode: vertical-rl` +
              `transform: rotate(180deg)` yields bottom-to-top text
              with letters rotated the "book-spine" way — the
              cross-browser combination that works consistently on
              Chromium / Firefox / Safari (unlike the newer
              `sideways-lr`, which is still WebKit-patchy).
            */}
            {isViewing && (
                <div
                    data-testid={`action-card-${id}-viewing-ribbon`}
                    style={{
                        writingMode: 'vertical-rl',
                        transform: 'rotate(180deg)',
                        background: '#007bff',
                        color: 'white',
                        fontSize: '10px',
                        fontWeight: 700,
                        letterSpacing: '1.5px',
                        padding: '8px 3px',
                        textAlign: 'center',
                        flexShrink: 0,
                        userSelect: 'none',
                    }}
                    aria-label="Currently viewing this action"
                >
                    VIEWING
                </div>
            )}
            <div style={{ flex: 1, padding: '10px', minWidth: 0 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <h4 style={{
                    margin: 0,
                    fontSize: '12px',
                    color: isViewing ? '#0056b3' : undefined,
                    flex: 1,
                    minWidth: 0,
                    overflowWrap: 'anywhere'
                }}>
                    #{index + 1} {'\u2014'} {id}
                </h4>
                <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <span style={{ fontSize: '11px', fontWeight: 600, padding: '2px 8px', borderRadius: '12px', background: sc.badgeBg, color: sc.badgeText }}>
                        {sc.label}
                    </span>
                </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px', margin: '4px 0 5px' }}>
                <div style={{ flex: 1 }}>
                    <p style={{ fontSize: '12px', margin: 0 }}>{details.description_unitaire}</p>
                    {details.load_shedding_details && details.load_shedding_details.length > 0 && (
                        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ fontSize: '12px', background: '#fef3c7', color: '#92400e', padding: '6px 10px', marginTop: '5px', borderRadius: '4px', border: '1px solid #fcd34d', fontWeight: 500 }}>
                            {details.load_shedding_details.map((ls, i) => (
                                <div key={ls.load_name} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: i > 0 ? '4px' : 0 }}>
                                    <span>Shedding on <strong>{ls.load_name}</strong> in MW:</span>
                                    <input
                                        data-testid={`edit-mw-${id}`}
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        value={cardEditMw[id] ?? ls.shedded_mw.toFixed(1)}
                                        onChange={(e) => onCardEditMwChange(id, e.target.value)}
                                        style={{ width: '65px', fontSize: '11px', fontFamily: 'monospace', padding: '2px 4px', border: '1px solid #d97706', borderRadius: '3px', textAlign: 'right' }}
                                    />
                                    <button
                                        data-testid={`resimulate-${id}`}
                                        onClick={() => {
                                            const mwVal = parseFloat(cardEditMw[id] ?? String(ls.shedded_mw));
                                            if (!isNaN(mwVal) && mwVal >= 0) onResimulate(id, mwVal);
                                        }}
                                        disabled={resimulating === id}
                                        style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '3px', border: '1px solid #d97706', background: '#fbbf24', color: '#78350f', cursor: resimulating === id ? 'wait' : 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                    >
                                        {resimulating === id ? 'Simulating...' : 'Re-simulate'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    {details.curtailment_details && details.curtailment_details.length > 0 && (
                        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ fontSize: '12px', background: '#e0f2fe', color: '#075985', padding: '6px 10px', marginTop: '5px', borderRadius: '4px', border: '1px solid #7dd3fc', fontWeight: 500 }}>
                            {details.curtailment_details.map((rc, i) => (
                                <div key={rc.gen_name} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: i > 0 ? '4px' : 0 }}>
                                    <span>Curtailment on <strong>{rc.gen_name}</strong> in MW:</span>
                                    <input
                                        data-testid={`edit-mw-${id}`}
                                        type="number"
                                        min={0}
                                        step={0.1}
                                        value={cardEditMw[id] ?? rc.curtailed_mw.toFixed(1)}
                                        onChange={(e) => onCardEditMwChange(id, e.target.value)}
                                        style={{ width: '65px', fontSize: '11px', fontFamily: 'monospace', padding: '2px 4px', border: '1px solid #0284c7', borderRadius: '3px', textAlign: 'right' }}
                                    />
                                    <button
                                        data-testid={`resimulate-${id}`}
                                        onClick={() => {
                                            const mwVal = parseFloat(cardEditMw[id] ?? String(rc.curtailed_mw));
                                            if (!isNaN(mwVal) && mwVal >= 0) onResimulate(id, mwVal);
                                        }}
                                        disabled={resimulating === id}
                                        style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '3px', border: '1px solid #0284c7', background: '#38bdf8', color: '#0c4a6e', cursor: resimulating === id ? 'wait' : 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                    >
                                        {resimulating === id ? 'Simulating...' : 'Re-simulate'}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                    {details.pst_details && details.pst_details.length > 0 && (
                        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()} style={{ fontSize: '12px', background: '#f3e8ff', color: '#6b21a8', padding: '6px 10px', marginTop: '5px', borderRadius: '4px', border: '1px solid #c084fc', fontWeight: 500 }}>
                            {details.pst_details.map((pst, i) => (
                                <div key={pst.pst_name} style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginTop: i > 0 ? '4px' : 0 }}>
                                    <span>PST <strong>{pst.pst_name}</strong> tap:</span>
                                    <input
                                        data-testid={`edit-tap-${id}`}
                                        type="number"
                                        min={pst.low_tap ?? undefined}
                                        max={pst.high_tap ?? undefined}
                                        step={1}
                                        value={cardEditTap[id] ?? pst.tap_position}
                                        onChange={(e) => onCardEditTapChange(id, e.target.value)}
                                        style={{ width: '55px', fontSize: '11px', fontFamily: 'monospace', padding: '2px 4px', border: '1px solid #9333ea', borderRadius: '3px', textAlign: 'right' }}
                                    />
                                    {pst.low_tap != null && pst.high_tap != null && (
                                        <span style={{ fontSize: '10px', color: '#7c3aed' }}>
                                            [{pst.low_tap}..{pst.high_tap}]
                                        </span>
                                    )}
                                    <button
                                        data-testid={`resimulate-tap-${id}`}
                                        onClick={() => {
                                            const tapVal = parseInt(cardEditTap[id] ?? String(pst.tap_position), 10);
                                            if (!isNaN(tapVal)) onResimulateTap(id, tapVal);
                                        }}
                                        disabled={resimulating === id}
                                        style={{ fontSize: '10px', padding: '2px 8px', borderRadius: '3px', border: '1px solid #9333ea', background: '#c084fc', color: '#3b0764', cursor: resimulating === id ? 'wait' : 'pointer', fontWeight: 600, whiteSpace: 'nowrap' }}
                                    >
                                        {resimulating === id ? 'Simulating...' : 'Re-simulate'}
                                    </button>
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
                {renderBadges()}
            </div>
            <div style={{ fontSize: '12px', background: isViewing ? '#dce8f7' : '#f8f9fa', padding: '5px', marginTop: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                    {/*
                      "Loading before" removed — the N-1 pre-action loading
                      is already shown in the sticky Overloads N-1 section
                      of the left feed, with percentages next to each
                      overloaded line. No need to duplicate it per card.
                    */}
                    <div>Loading after: {renderRho(details.rho_after, id, 'action')}</div>
                    {maxRhoPct != null && (
                        <div style={{ marginTop: '3px' }}>
                            Max loading: <strong style={{ color: sc.border }}>{maxRhoPct}%</strong>
                            {details.max_rho_line && (
                                <span style={{ color: '#888' }}> on <button
                                    style={{ ...clickableLinkStyle, color: '#888' }}
                                    title={`Zoom to ${details.max_rho_line}`}
                                    onClick={(e) => { e.stopPropagation(); onAssetClick(id, details.max_rho_line, 'action'); }}
                                >{displayName(details.max_rho_line)}</button></span>
                            )}
                        </div>
                    )}
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0, paddingBottom: '2px' }}>
                    {!isSelected && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onActionFavorite(id); }}
                            style={{ background: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            title="Select this action"
                        ><span style={{ fontSize: '14px' }}>⭐</span></button>
                    )}
                    {!isRejected && (
                        <button
                            onClick={(e) => { e.stopPropagation(); onActionReject(id); }}
                            style={{ background: 'white', border: '1px solid #ddd', borderRadius: '4px', cursor: 'pointer', padding: '4px 6px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                            title={isSelected ? "Remove from selected" : "Reject this action"}
                        ><span style={{ fontSize: '14px' }}>❌</span></button>
                    )}
                </div>
            </div>
            </div>{/* /content column */}
        </div>
    );
};

export default React.memo(ActionCard);
