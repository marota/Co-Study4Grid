// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import type { ActionDetail, EdgeMeta, MetadataIndex, NodeMeta } from '../../types';
import { getIdMap } from './idMap';

/**
 * Create or find the background layer at the root of the SVG. Highlight
 * clones live here so they render BEHIND the NAD content — matching the
 * visual stack of contingency / overload halos.
 */
export const getBackgroundLayer = (container: HTMLElement): Element | null => {
    let backgroundLayer = container.querySelector('#nad-background-layer');
    if (!backgroundLayer) {
        const svg = container.querySelector('svg');
        if (svg) {
            backgroundLayer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            backgroundLayer.setAttribute('id', 'nad-background-layer');
            if (svg.firstChild) {
                svg.insertBefore(backgroundLayer, svg.firstChild);
            } else {
                svg.appendChild(backgroundLayer);
            }
        }
    }
    return backgroundLayer;
};

/**
 * Apply orange highlights to overloaded line edges on a given SVG container.
 */
export const applyOverloadedHighlights = (
    container: HTMLElement,
    metaIndex: MetadataIndex,
    overloadedLines: string[],
) => {
    if (!container || !metaIndex) return;

    // Remove existing highlights from both originals and clones
    container.querySelectorAll('.nad-overloaded').forEach(el => {
        if (el.classList.contains('nad-highlight-clone')) {
            el.remove();
        } else {
            el.classList.remove('nad-overloaded');
        }
    });

    if (!overloadedLines || overloadedLines.length === 0) return;

    const backgroundLayer = getBackgroundLayer(container);
    const { edgesByEquipmentId } = metaIndex;
    const idMap = getIdMap(container);

    let cachedBgCTM: DOMMatrix | null = null;

    overloadedLines.forEach(lineName => {
        const edge = edgesByEquipmentId.get(lineName);
        if (edge && edge.svgId) {
            const el = idMap.get(edge.svgId);
            if (el) {
                if (backgroundLayer) {
                    const clone = el.cloneNode(true) as SVGGraphicsElement;
                    clone.classList.add('nad-overloaded');
                    clone.classList.add('nad-highlight-clone');
                    // Strip any nad-delta-* class the original may
                    // already be tagged with — those rules are declared
                    // later in App.css and would otherwise win the
                    // cascade and turn the orange halo into a 3px
                    // delta-colored stroke (effectively making the
                    // overload highlight disappear in Impacts mode).
                    clone.classList.remove('nad-delta-positive', 'nad-delta-negative', 'nad-delta-grey');
                    clone.removeAttribute('id');
                    clone.style.display = 'block';
                    clone.style.visibility = 'visible';

                    try {
                        const elCTM = (el as SVGGraphicsElement).getScreenCTM();
                        if (!cachedBgCTM) cachedBgCTM = (backgroundLayer as unknown as SVGGraphicsElement).getScreenCTM();
                        if (elCTM && cachedBgCTM) {
                            const relativeCTM = cachedBgCTM.inverse().multiply(elCTM);
                            const matrixStr = `matrix(${relativeCTM.a}, ${relativeCTM.b}, ${relativeCTM.c}, ${relativeCTM.d}, ${relativeCTM.e}, ${relativeCTM.f})`;
                            clone.setAttribute('transform', matrixStr);
                        }
                    } catch (e) {
                        console.warn('Failed to get CTM for overloaded highlight:', e);
                    }

                    backgroundLayer.appendChild(clone);
                } else {
                    el.classList.add('nad-overloaded');
                }
            }
        }
    });
};

/**
 * Robust detection of coupling/nodal actions.
 */
export const isCouplingAction = (actionId: string | null, description?: string): boolean => {
    const q = ((actionId || '') + ' ' + (description || '')).toLowerCase();
    return q.includes('coupling') || q.includes('busbar') || q.includes('coupl') || q.includes('noeud') || q.includes('node');
};

/**
 * Determine which lines an action acts upon (for line disconnection/reconnection actions).
 */
export const getActionTargetLines = (
    actionDetail: ActionDetail | null,
    actionId: string | null,
    edgesByEquipmentId: Map<string, EdgeMeta>,
): string[] => {
    const targets = new Set<string>();

    // 1. From topology
    const topo = actionDetail?.action_topology;
    if (topo) {
        const isCoupling = isCouplingAction(actionId, actionDetail?.description_unitaire);

        // Pst taps are always included
        Object.keys(topo.pst_tap || {}).forEach(l => targets.add(l));

        if (!isCoupling) {
            const lineKeys = new Set([
                ...Object.keys(topo.lines_ex_bus || {}),
                ...Object.keys(topo.lines_or_bus || {}),
            ]);
            const genKeys = Object.keys(topo.gens_bus || {});
            const loadKeys = Object.keys(topo.loads_bus || {});
            const loadsPKeys = Object.keys(topo.loads_p || {});
            const gensPKeys = Object.keys(topo.gens_p || {});

            if (lineKeys.size > 0 && genKeys.length === 0 && loadKeys.length === 0
                && loadsPKeys.length === 0 && gensPKeys.length === 0) {
                lineKeys.forEach(l => targets.add(l));
            } else {
                const allValues = [
                    ...Object.values(topo.lines_ex_bus || {}),
                    ...Object.values(topo.lines_or_bus || {}),
                    ...Object.values(topo.gens_bus || {}),
                    ...Object.values(topo.loads_bus || {}),
                ];
                if (allValues.length > 0 && allValues.every(v => v === -1)) {
                    lineKeys.forEach(l => targets.add(l));
                }
            }
        }
    }

    // 2. From action ID (handles combined IDs)
    const isCoupling = isCouplingAction(actionId, actionDetail?.description_unitaire);
    if (actionId && !isCoupling) {
        actionId.split('+').forEach(part => {
            // Strip any suffix added by discovery (e.g. _inc1, _dec2)
            const cleanPart = part.replace(/_(inc|dec)\d+$/, '');

            if (edgesByEquipmentId.has(cleanPart)) {
                targets.add(cleanPart);
                return;
            }
            if (edgesByEquipmentId.has(part)) {
                targets.add(part);
                return;
            }

            const subParts = cleanPart.split('_');
            for (let i = 1; i < subParts.length; i++) {
                const candidate = subParts.slice(i).join('_');
                if (edgesByEquipmentId.has(candidate)) {
                    targets.add(candidate);
                    return;
                }
            }
            // Fallback: last segment
            const last = subParts[subParts.length - 1];
            if (edgesByEquipmentId.has(last)) {
                targets.add(last);
            }
        });
    }

    return [...targets];
};

/**
 * Extract the voltage level name for nodal actions.
 */
export const getActionTargetVoltageLevels = (
    actionDetail: ActionDetail | null,
    actionId: string | null,
    nodesByEquipmentId: Map<string, NodeMeta>,
): string[] => {
    const targets = new Set<string>();
    const desc = actionDetail?.description_unitaire;
    if (desc && desc !== 'No description available') {
        // Try all quoted strings — any might be the VL name
        const quotedMatches = desc.match(/'([^']+)'/g);
        if (quotedMatches) {
            quotedMatches.forEach(match => {
                const vl = match.replace(/'/g, '');
                if (nodesByEquipmentId.has(vl)) targets.add(vl);
            });
        }
        // Match "dans le poste", "du poste", "au poste", etc.
        const posteMatches = desc.matchAll(/(?:dans le |du |au )?poste\s+'?([^',]+?)'?(?=\s*(?:['",]|$))/gi);
        for (const match of posteMatches) {
            const vl = match[1].trim();
            if (nodesByEquipmentId.has(vl)) {
                targets.add(vl);
            } else {
                // Try to find the longest prefix that matches a known node (handles "MICQ P7 is open")
                const parts = vl.split(/\s+/);
                for (let i = parts.length; i >= 1; i--) {
                    const candidate = parts.slice(0, i).join(' ');
                    if (nodesByEquipmentId.has(candidate)) {
                        targets.add(candidate);
                        break;
                    }
                }
            }
        }
    }

    // Fallback: action ID suffix — skip for pure line reconnection actions
    const topo = actionDetail?.action_topology;
    const isCoupling = isCouplingAction(actionId, actionDetail?.description_unitaire);
    const isLineReconnection = !isCoupling && !!topo
        && (Object.keys(topo.gens_bus || {}).length === 0 && Object.keys(topo.loads_bus || {}).length === 0
            && Object.keys(topo.loads_p || {}).length === 0 && Object.keys(topo.gens_p || {}).length === 0)
        && ([...Object.values(topo.lines_ex_bus || {}), ...Object.values(topo.lines_or_bus || {})] as number[]).some(v => v >= 0);

    if (actionId && !isLineReconnection) {
        actionId.split('+').forEach(part => {
            const cleanPart = part.replace(/_(inc|dec)\d+$/, '');

            if (nodesByEquipmentId.has(cleanPart)) {
                targets.add(cleanPart);
                return;
            }
            if (nodesByEquipmentId.has(part)) {
                targets.add(part);
                return;
            }

            const subParts = cleanPart.split('_');
            // Check each sub-part individually (e.g. for MQIS P7 in UUID_MQIS P7_coupling)
            subParts.forEach(sp => {
                if (nodesByEquipmentId.has(sp)) targets.add(sp);
            });

            for (let i = 1; i < subParts.length; i++) {
                const candidate = subParts.slice(i).join('_');
                if (nodesByEquipmentId.has(candidate)) {
                    targets.add(candidate);
                    return;
                }
            }
            // Fallback: last segment
            const last = subParts[subParts.length - 1];
            if (!targets.has(last) && nodesByEquipmentId.has(last)) {
                targets.add(last);
            }
        });
    }
    return [...targets];
};

/**
 * Apply yellow fluo halo to action targets: edges (line actions) or nodes (nodal actions).
 */
export const applyActionTargetHighlights = (
    container: HTMLElement | null,
    metaIndex: MetadataIndex | null,
    actionDetail: ActionDetail | null,
    actionId: string | null,
) => {
    if (!container) return;
    // IMPORTANT: remove OUR action-target clones BEFORE stripping the
    // `.nad-action-target` class from originals — otherwise the class
    // gets stripped from the clones too (they also carry it) and the
    // follow-up cleanup selector would no longer match them, leaving
    // stale clones in the background layer. Use a compound selector
    // (`.nad-highlight-clone.nad-action-target`) so we only wipe our
    // own clones and leave `.nad-overloaded` halos planted by
    // applyOverloadedHighlights untouched — the Action tab calls us
    // straight after applyOverloadedHighlights, so a blanket
    // `.nad-highlight-clone` removal silently deleted every
    // persistent / newly-created overload highlight on the Remedial
    // Action NAD (the SLD was unaffected because it uses a different
    // highlight pipeline).
    container
        .querySelectorAll('.nad-highlight-clone.nad-action-target')
        .forEach(el => el.remove());
    container.querySelectorAll('.nad-action-target, .nad-action-target-original').forEach(el => {
        el.classList.remove('nad-action-target', 'nad-action-target-original');
    });
    if (!metaIndex || !actionDetail) return;

    const { edgesByEquipmentId, nodesByEquipmentId } = metaIndex;

    // Create or find background layer at the root of the SVG
    const backgroundLayer = getBackgroundLayer(container);

    // Cache bgCTM per call — constant for all highlights in a single pass
    let cachedBgCTM: DOMMatrix | null = null;

    const applyHighlight = (el: Element) => {
        if (!el) return;

        if (backgroundLayer) {
            const clone = el.cloneNode(true) as SVGGraphicsElement;
            clone.removeAttribute('id');
            clone.classList.add('nad-action-target');
            clone.classList.add('nad-highlight-clone');
            // See comment in applyOverloadedHighlights: strip any
            // nad-delta-* class the original carries so the late
            // delta CSS rules don't override the action-target halo.
            clone.classList.remove('nad-delta-positive', 'nad-delta-negative', 'nad-delta-grey');

            try {
                const elCTM = (el as SVGGraphicsElement).getScreenCTM();
                if (!cachedBgCTM) cachedBgCTM = (backgroundLayer as unknown as SVGGraphicsElement).getScreenCTM();
                if (elCTM && cachedBgCTM) {
                    const relativeCTM = cachedBgCTM.inverse().multiply(elCTM);
                    const matrixStr = `matrix(${relativeCTM.a}, ${relativeCTM.b}, ${relativeCTM.c}, ${relativeCTM.d}, ${relativeCTM.e}, ${relativeCTM.f})`;
                    clone.setAttribute('transform', matrixStr);
                }
            } catch (e) {
                console.warn('Failed to get CTM for highlight:', e);
            }
            backgroundLayer.appendChild(clone);
            el.classList.add('nad-action-target-original');
        } else {
            el.classList.add('nad-action-target');
        }
    };

    const idMap = getIdMap(container);

    // 1. Identify all VL targets
    const vlNames = getActionTargetVoltageLevels(actionDetail, actionId, nodesByEquipmentId);
    vlNames.forEach(vlName => {
        const node = nodesByEquipmentId.get(vlName);
        if (node && node.svgId) {
            const el = idMap.get(node.svgId);
            if (el) applyHighlight(el);
        }
    });

    // 2. Identify all line/equipment targets
    const targetLines = getActionTargetLines(actionDetail, actionId, edgesByEquipmentId);
    targetLines.forEach(lineName => {
        const edge = edgesByEquipmentId.get(lineName);
        if (edge && edge.svgId) {
            const el = idMap.get(edge.svgId);
            if (el) applyHighlight(el);
        }
    });
};

/**
 * Apply orange halo to the disconnected branch in the N-1 state.
 */
export const applyContingencyHighlight = (
    container: HTMLElement,
    metaIndex: MetadataIndex | null,
    disconnectedElement: string | null,
) => {
    if (!container) return;
    container.querySelectorAll('.nad-contingency-highlight').forEach(el => {
        if (el.classList.contains('nad-highlight-clone')) {
            el.remove();
        } else {
            el.classList.remove('nad-contingency-highlight');
        }
    });

    if (!disconnectedElement || !metaIndex) return;

    const { edgesByEquipmentId } = metaIndex;
    const edge = edgesByEquipmentId.get(disconnectedElement);
    if (!edge || !edge.svgId) return;

    const idMap = getIdMap(container);
    const el = idMap.get(edge.svgId);
    if (!el) return;

    const backgroundLayer = getBackgroundLayer(container);
    if (backgroundLayer) {
        const clone = el.cloneNode(true) as SVGGraphicsElement;
        clone.classList.add('nad-contingency-highlight');
        clone.classList.add('nad-highlight-clone');
        // See comment in applyOverloadedHighlights: strip any
        // nad-delta-* class the original may carry so the late delta
        // CSS rules don't override the yellow contingency halo.
        clone.classList.remove('nad-delta-positive', 'nad-delta-negative', 'nad-delta-grey');
        clone.removeAttribute('id');

        // Ensure highlight is visible even if the original is hidden
        clone.style.display = 'block';
        clone.style.visibility = 'visible';

        try {
            const elCTM = (el as SVGGraphicsElement).getScreenCTM();
            const bgCTM = (backgroundLayer as unknown as SVGGraphicsElement).getScreenCTM();
            if (elCTM && bgCTM) {
                const relativeCTM = bgCTM.inverse().multiply(elCTM);
                const matrixStr = `matrix(${relativeCTM.a}, ${relativeCTM.b}, ${relativeCTM.c}, ${relativeCTM.d}, ${relativeCTM.e}, ${relativeCTM.f})`;
                clone.setAttribute('transform', matrixStr);
            }
        } catch (e) {
            console.warn('Failed to get CTM for contingency highlight:', e);
        }

        backgroundLayer.appendChild(clone);
    } else {
        el.classList.add('nad-contingency-highlight');
    }
};
