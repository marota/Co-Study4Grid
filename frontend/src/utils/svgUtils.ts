// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import type { AssetDelta, ViewBox, MetadataIndex, NodeMeta, EdgeMeta, ActionDetail } from '../types';

// ===== Cached DOM ID Map =====
// Avoids repeated querySelectorAll('[id]') scans on large SVG containers.
// The cache is keyed by container element and invalidated when the SVG content changes.
const idMapCache = new WeakMap<HTMLElement, { svg: SVGSVGElement | null; map: Map<string, Element> }>();

export const getIdMap = (container: HTMLElement): Map<string, Element> => {
    const svg = container.querySelector('svg');
    const cached = idMapCache.get(container);
    if (cached && cached.svg === svg) return cached.map;
    const map = new Map<string, Element>();
    container.querySelectorAll('[id]').forEach(el => map.set(el.id, el));
    idMapCache.set(container, { svg, map });
    return map;
};

export const invalidateIdMapCache = (container: HTMLElement) => {
    idMapCache.delete(container);
};

/**
 * Scale SVG elements for large grids so text, nodes, and flow values
 * are readable when zoomed in and naturally shrink at full view.
 */
export const boostSvgForLargeGrid = (svgString: string, viewBox: ViewBox | null, vlCount: number): string => {
    if (!viewBox) return svgString;

    // Skip boost entirely for grids with < 500 voltage levels
    if (!vlCount || vlCount < 500) return svgString;

    const start = Date.now();
    const diagramSize = Math.max(viewBox.w, viewBox.h);
    const REFERENCE_SIZE = 1250;
    const BOOST_THRESHOLD = 3;
    const ratio = diagramSize / REFERENCE_SIZE;
    if (ratio <= BOOST_THRESHOLD) return svgString;

    const boost = Math.sqrt(ratio / BOOST_THRESHOLD);
    const boostStr = boost.toFixed(2);

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = doc.documentElement;

        // svgEl.setAttribute('data-large-grid', 'true'); // Removed: handled by CSS-less scaling

        // === 1. Scale CSS values in <style> blocks ===
        const styles = svgEl.querySelectorAll('style');
        styles.forEach(style => {
            let css = style.textContent || '';
            css = css.replace(/font:\s*25px\s+serif/, `font: ${Math.round(25 * boost)}px serif`);
            css = css.replace(
                'padding: 10px; border-radius: 10px;',
                `padding: ${Math.round(10 * boost)}px; border-radius: ${Math.round(10 * boost)}px;`
            );
            css = css.replace(
                'margin-right: 10px; width: 20px; height: 20px;',
                `margin-right: ${Math.round(10 * boost)}px; width: ${Math.round(20 * boost)}px; height: ${Math.round(20 * boost)}px;`
            );
            style.textContent = css;
        });

        // === 2. Scale node groups (circles + inner bus sectors/paths) ===
        const circles = svgEl.querySelectorAll('circle');
        const scaledGroups = new Set<Element>();

        for (let i = 0; i < circles.length; i++) {
            const circle = circles[i];
            let targetEl: Element = circle.parentElement as Element;

            // If flattened, target might not be a 'g' or might be a large container
            if (!targetEl || targetEl.tagName !== 'g' || (targetEl.children.length > 5 && targetEl.querySelector('foreignObject'))) {
                targetEl = circle;
            }

            if (scaledGroups.has(targetEl)) continue;

            const t = targetEl.getAttribute('transform') || '';
            if (t.includes('NaN')) continue;

            scaledGroups.add(targetEl);
            const cx = circle.getAttribute('cx');
            const cy = circle.getAttribute('cy');

            if (cx === 'NaN' || cy === 'NaN') continue;

            const cxNum = parseFloat(cx || '0');
            const cyNum = parseFloat(cy || '0');

            if (!isNaN(cxNum) && !isNaN(cyNum)) {
                targetEl.setAttribute('transform', `${t} translate(${cxNum},${cyNum}) scale(${boostStr}) translate(${-cxNum},${-cyNum})`);
            }

            if (i % 100 === 0 && Date.now() - start > 5000) {
                console.warn('[SVG] Boosting taking too long, some elements might not be scaled.');
                break;
            }
        }

        // === 3. Scale edge-info group transforms (flow arrows + values) ===
        const edgeInfoGroup = svgEl.querySelector('.nad-edge-infos');
        if (edgeInfoGroup) {
            const infoGs = edgeInfoGroup.querySelectorAll(':scope > g[transform]');
            for (let i = 0; i < infoGs.length; i++) {
                const g = infoGs[i];
                const t = g.getAttribute('transform');
                if (t && t.includes('translate(') && !t.includes('scale(') && !t.includes('NaN')) {
                    g.setAttribute('transform', t + ` scale(${boostStr})`);
                }
            }
        }

        const result = new XMLSerializer().serializeToString(svgEl);
        console.log(`[SVG] Boosted vlCount=${vlCount}, ratio ${ratio.toFixed(2)}, boost ${boostStr} in ${Date.now() - start}ms`);
        return result;
    } catch (err) {
        console.error('[SVG] Failed to boost SVG:', err);
        return svgString;
    }
};

/**
 * Parse viewBox from raw SVG string and apply boost for large grids.
 */
export const processSvg = (rawSvg: string, vlCount: number): { svg: string; viewBox: ViewBox | null } => {
    const match = rawSvg.match(/viewBox=["']([^"']+)["']/);
    let vb: ViewBox | null = null;
    if (match) {
        const parts = match[1].split(/\s+|,/).map(parseFloat);
        if (parts.length === 4) vb = { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    }

    const svg = boostSvgForLargeGrid(rawSvg, vb, vlCount);
    return { svg, viewBox: vb };
};

/**
 * Build Map indices from metadata for O(1) lookups.
 */
export const buildMetadataIndex = (metadata: unknown): MetadataIndex | null => {
    if (!metadata) return null;
    const meta = typeof metadata === 'string' ? JSON.parse(metadata) : metadata;
    const nodes: NodeMeta[] = (meta as { nodes?: NodeMeta[] }).nodes || [];
    const edges: EdgeMeta[] = (meta as { edges?: EdgeMeta[] }).edges || [];

    const nodesByEquipmentId = new Map<string, NodeMeta>();
    const nodesBySvgId = new Map<string, NodeMeta>();
    const edgesByEquipmentId = new Map<string, EdgeMeta>();
    const edgesByNode = new Map<string, EdgeMeta[]>();

    nodes.forEach(n => {
        nodesByEquipmentId.set(n.equipmentId, n);
        nodesBySvgId.set(n.svgId, n);
    });

    edges.forEach(e => {
        edgesByEquipmentId.set(e.equipmentId, e);
        if (!edgesByNode.has(e.node1)) edgesByNode.set(e.node1, []);
        edgesByNode.get(e.node1)!.push(e);
        if (!edgesByNode.has(e.node2)) edgesByNode.set(e.node2, []);
        edgesByNode.get(e.node2)!.push(e);
    });

    return { nodesByEquipmentId, nodesBySvgId, edgesByEquipmentId, edgesByNode };
};

/**
 * Create or find background layer at the root of the SVG.
 */
const getBackgroundLayer = (container: HTMLElement): Element | null => {
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


/**
 * Apply delta flow visualizations (coloring + text replacement) on a container.
 * - Branch coloring is based on active power (P) delta only.
 * - edgeInfo1 (active power / black arrow) shows P delta text.
 * - edgeInfo2 (reactive power / blue arrow) shows Q delta text.
 * - Load/generator assets are colored based on P delta.
 * Saves original text in data-original-text attribute for restoration.
 */
export const applyDeltaVisuals = (
    container: HTMLElement | null,
    diagram: {
        flow_deltas?: Record<string, { delta: number; category: string }>;
        reactive_flow_deltas?: Record<string, { delta: number; category: string }>;
        asset_deltas?: Record<string, AssetDelta>;
    } | null,
    metaIndex: MetadataIndex | null,
    isDeltaMode: boolean,
) => {
    if (!container || !diagram || !metaIndex) return;

    // Clear delta classes on edges and nodes
    container.querySelectorAll('.nad-delta-positive').forEach(el => el.classList.remove('nad-delta-positive'));
    container.querySelectorAll('.nad-delta-negative').forEach(el => el.classList.remove('nad-delta-negative'));
    container.querySelectorAll('.nad-delta-grey').forEach(el => el.classList.remove('nad-delta-grey'));

    // Restore original text labels
    container.querySelectorAll('[data-original-text]').forEach(el => {
        el.textContent = el.getAttribute('data-original-text');
        el.removeAttribute('data-original-text');
    });

    if (!isDeltaMode || !diagram.flow_deltas) return;

    const { edgesByEquipmentId } = metaIndex;
    const flowDeltas = diagram.flow_deltas;
    const assetDeltas = diagram.asset_deltas || {};
    const idMap = getIdMap(container);

    const classMap: Record<string, string> = {
        positive: 'nad-delta-positive',
        negative: 'nad-delta-negative',
        grey: 'nad-delta-grey',
    };

    // --- Branch (edge) deltas ---
    for (const [lineId, deltaInfo] of Object.entries(flowDeltas)) {
        const edge = edgesByEquipmentId.get(lineId);
        if (!edge || !edge.svgId) continue;

        // Color the edge based on active power delta
        const el = idMap.get(edge.svgId);
        if (el) {
            const cls = classMap[deltaInfo.category];
            if (cls) el.classList.add(cls);
        }

        // Apply delta text labels to both Terminal 1 and Terminal 2 (edgeInfo1 and edgeInfo2 represent P flow at terminals in NADs)
        const pDeltaStr = deltaInfo.delta >= 0 ? `+${deltaInfo.delta.toFixed(1)}` : deltaInfo.delta.toFixed(1);

        // edgeInfo1 = Terminal 1 active power (P)
        if (edge.edgeInfo1?.svgId) {
            const infoEl = idMap.get(edge.edgeInfo1.svgId);
            if (infoEl) {
                infoEl.querySelectorAll('foreignObject, text').forEach(t => {
                    if (!t.hasAttribute('data-original-text')) {
                        t.setAttribute('data-original-text', t.textContent || '');
                    }
                    t.textContent = `\u0394 ${pDeltaStr}`;
                });
            }
        }

        // edgeInfo2 = Terminal 2 active power (P) (Note: NOT reactive power in NADs)
        if (edge.edgeInfo2?.svgId) {
            const infoEl = idMap.get(edge.edgeInfo2.svgId);
            if (infoEl) {
                infoEl.querySelectorAll('foreignObject, text').forEach(t => {
                    if (!t.hasAttribute('data-original-text')) {
                        t.setAttribute('data-original-text', t.textContent || '');
                    }
                    t.textContent = `\u0394 ${pDeltaStr}`;
                });
            }
        }
    }

    // --- Asset (load/generator) deltas ---
    for (const [assetId, assetInfo] of Object.entries(assetDeltas)) {
        // Assets appear as legend edges connected to VL nodes.
        // Try to find them as edges first (pypowsybl maps loads/gens as short edges).
        const edge = edgesByEquipmentId.get(assetId);
        if (edge && edge.svgId) {
            const el = idMap.get(edge.svgId);
            if (el) {
                const cls = classMap[assetInfo.category];
                if (cls) el.classList.add(cls);
            }

            // Update P arrow text on edgeInfo1
            const pStr = assetInfo.delta_p >= 0 ? `+${assetInfo.delta_p.toFixed(1)}` : assetInfo.delta_p.toFixed(1);
            if (edge.edgeInfo1?.svgId) {
                const infoEl = idMap.get(edge.edgeInfo1.svgId);
                if (infoEl) {
                    infoEl.querySelectorAll('foreignObject, text').forEach(t => {
                        if (!t.hasAttribute('data-original-text')) {
                            t.setAttribute('data-original-text', t.textContent || '');
                        }
                        t.textContent = `\u0394 ${pStr}`;
                    });
                }
            }

            // Update Q arrow text on edgeInfo2
            const qStr = assetInfo.delta_q >= 0 ? `+${assetInfo.delta_q.toFixed(1)}` : assetInfo.delta_q.toFixed(1);
            if (edge.edgeInfo2?.svgId) {
                const infoEl = idMap.get(edge.edgeInfo2.svgId);
                if (infoEl) {
                    infoEl.querySelectorAll('foreignObject, text').forEach(t => {
                        if (!t.hasAttribute('data-original-text')) {
                            t.setAttribute('data-original-text', t.textContent || '');
                        }
                        t.textContent = `\u0394 ${qStr}`;
                    });
                }
            }
        }
    }
};

// ============================================================
// Action-overview pins
//
// Renders Google-Maps style pins on top of the N-1 network SVG,
// one per prioritised action. Each pin anchors on the asset
// (line mid-point or voltage-level node) that the corresponding
// action card highlights in its badges — the same resolution
// logic (getActionTargetLines / getActionTargetVoltageLevels) is
// reused so card↔diagram stay in sync.
//
// The pin colour follows the severity palette used by the cards
// (green/orange/red) and the label shows the max loading (%).
// Pins are clickable: the click callback maps through to the
// action-select handler, giving the operator direct manipulation
// from the overview to the drill-down view.
//
// Like the other NAD highlights, this helper is idempotent: it
// purges any previously-injected pin layer before re-rendering.
// ============================================================

export interface ActionPinInfo {
    id: string;
    x: number;
    y: number;
    severity: 'green' | 'orange' | 'red' | 'grey';
    label: string;
    title: string;
}

/**
 * Descriptor for a combined-action pin — rendered at the midpoint of
 * a curved connection between the two unitary action pins it combines.
 */
export interface CombinedPinInfo {
    /** Pair key, e.g. "action1+action2". */
    pairId: string;
    /** The two unitary action ids. */
    action1Id: string;
    action2Id: string;
    /** Anchor positions of the two unitary pins (endpoints of the curve). */
    p1: { x: number; y: number };
    p2: { x: number; y: number };
    /** Midpoint of the curve (where the combined pin sits). */
    x: number;
    y: number;
    /** Max loading after combined application. */
    label: string;
    title: string;
    severity: ActionPinInfo['severity'];
}

const severityFill: Record<ActionPinInfo['severity'], string> = {
    green: '#28a745',
    orange: '#f0ad4e',
    red: '#dc3545',
    grey: '#9ca3af',
};

/**
 * Dimmed fill colours for rejected actions — each severity hue is
 * shifted toward grey and lowered in saturation so the pin recedes
 * visually while still being colour-identifiable.
 */
const severityFillDimmed: Record<ActionPinInfo['severity'], string> = {
    green: '#a3c9ab',
    orange: '#dcd0b8',
    red: '#d4a5ab',
    grey: '#c8cdd2',
};

/**
 * Highlighted (selected) fill colours — slightly more vivid/brighter
 * versions of the severity palette so the pin stands out.
 */
const severityFillHighlighted: Record<ActionPinInfo['severity'], string> = {
    green: '#1e9e3a',
    orange: '#e89e20',
    red: '#c82333',
    grey: '#7b8a96',
};


const computeActionSeverity = (
    details: ActionDetail,
    monitoringFactor: number,
): ActionPinInfo['severity'] => {
    if (details.non_convergence || details.is_islanded) return 'grey';
    if (details.max_rho == null) {
        return details.is_rho_reduction ? 'green' : 'red';
    }
    if (details.max_rho > monitoringFactor) return 'red';
    if (details.max_rho > monitoringFactor - 0.05) return 'orange';
    return 'green';
};

/**
 * Resolve an action to a point on the NAD background.
 *
 * For line / PST actions we take the midpoint of the edge; for
 * nodal actions we take the voltage-level node position. Returns
 * null when no impacted asset can be located — the pin is then
 * silently skipped.
 */
export const resolveActionAnchor = (
    actionId: string,
    details: ActionDetail,
    metaIndex: MetadataIndex,
): { x: number; y: number } | null => {
    const { nodesByEquipmentId, nodesBySvgId, edgesByEquipmentId } = metaIndex;

    const lookupNode = (nodeRef: unknown): NodeMeta | undefined => {
        if (typeof nodeRef !== 'string') return undefined;
        return nodesBySvgId.get(nodeRef) ?? nodesByEquipmentId.get(nodeRef);
    };

    // Load shedding / curtailment actions carry an explicit
    // voltage_level_id in their detail objects — use it directly
    // so the pin lands on the VL node, not on an unrelated line.
    if (details.load_shedding_details?.length) {
        const vlId = details.load_shedding_details[0].voltage_level_id;
        if (vlId) {
            const node = nodesByEquipmentId.get(vlId);
            if (node && Number.isFinite(node.x)) return { x: node.x, y: node.y };
        }
    }
    if (details.curtailment_details?.length) {
        const vlId = details.curtailment_details[0].voltage_level_id;
        if (vlId) {
            const node = nodesByEquipmentId.get(vlId);
            if (node && Number.isFinite(node.x)) return { x: node.x, y: node.y };
        }
    }

    // Try line targets first
    const lineTargets = getActionTargetLines(details, actionId, edgesByEquipmentId);
    for (const lineName of lineTargets) {
        const edge = edgesByEquipmentId.get(lineName);
        if (!edge) continue;
        const n1 = lookupNode(edge.node1);
        const n2 = lookupNode(edge.node2);
        if (n1 && n2 && Number.isFinite(n1.x) && Number.isFinite(n2.x)) {
            return { x: (n1.x + n2.x) / 2, y: (n1.y + n2.y) / 2 };
        }
        if (n1 && Number.isFinite(n1.x)) return { x: n1.x, y: n1.y };
        if (n2 && Number.isFinite(n2.x)) return { x: n2.x, y: n2.y };
    }

    // Fallback on voltage-level targets
    const vlTargets = getActionTargetVoltageLevels(details, actionId, nodesByEquipmentId);
    for (const vlName of vlTargets) {
        const node = nodesByEquipmentId.get(vlName);
        if (node && Number.isFinite(node.x)) {
            return { x: node.x, y: node.y };
        }
    }

    // Last resort: max_rho_line (a line the action redistributes onto)
    if (details.max_rho_line) {
        const edge = edgesByEquipmentId.get(details.max_rho_line);
        if (edge) {
            const n1 = lookupNode(edge.node1);
            const n2 = lookupNode(edge.node2);
            if (n1 && n2 && Number.isFinite(n1.x) && Number.isFinite(n2.x)) {
                return { x: (n1.x + n2.x) / 2, y: (n1.y + n2.y) / 2 };
            }
        }
    }
    return null;
};

/**
 * Build the list of pin descriptors for the action-overview view.
 * Pure function — no DOM access — so it can be unit-tested.
 */
export const buildActionOverviewPins = (
    actions: Record<string, ActionDetail>,
    metaIndex: MetadataIndex,
    monitoringFactor: number,
    filterIds?: Iterable<string>,
): ActionPinInfo[] => {
    const allowed = filterIds ? new Set(filterIds) : null;
    const pins: ActionPinInfo[] = [];
    for (const [actionId, details] of Object.entries(actions)) {
        if (allowed && !allowed.has(actionId)) continue;
        // Skip combined-action entries (key contains '+') — those are
        // rendered separately by buildCombinedActionPins with a curved
        // connection between their constituent unitary pins.
        if (actionId.includes('+')) continue;
        const anchor = resolveActionAnchor(actionId, details, metaIndex);
        if (!anchor) continue;
        const severity = computeActionSeverity(details, monitoringFactor);
        const label = details.max_rho != null
            ? `${(details.max_rho * 100).toFixed(0)}%`
            : details.non_convergence
                ? 'DIV'
                : details.is_islanded
                    ? 'ISL'
                    : '\u2014';
        const title = [
            actionId,
            details.description_unitaire,
            details.max_rho != null
                ? `max loading ${(details.max_rho * 100).toFixed(1)}%${details.max_rho_line ? ` on ${details.max_rho_line}` : ''}`
                : details.non_convergence
                    ? 'load-flow divergent'
                    : details.is_islanded
                        ? 'islanding'
                        : '',
        ].filter(Boolean).join(' \u2014 ');
        pins.push({ id: actionId, x: anchor.x, y: anchor.y, severity, label, title });
    }

    // Fan out pins that share the same anchor position so they don't
    // stack on top of each other and remain individually clickable.
    // Group by position (rounded to avoid floating-point near-misses),
    // then distribute each group in a circle around the shared centre.
    const bucketKey = (p: ActionPinInfo) =>
        `${Math.round(p.x * 100)}:${Math.round(p.y * 100)}`;
    const groups = new Map<string, number[]>();
    pins.forEach((p, i) => {
        const k = bucketKey(p);
        const arr = groups.get(k);
        if (arr) arr.push(i);
        else groups.set(k, [i]);
    });
    for (const indices of groups.values()) {
        if (indices.length < 2) continue;
        // Offset radius: 1.2x the base VL circle radius — just enough
        // to expose each pin's clickable area without scattering them
        // too far from the original anchor.
        const offsetR = 30 * 1.2; // conservative default
        const angleStep = (2 * Math.PI) / indices.length;
        indices.forEach((idx, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            pins[idx] = {
                ...pins[idx],
                x: pins[idx].x + offsetR * Math.cos(angle),
                y: pins[idx].y + offsetR * Math.sin(angle),
            };
        });
    }

    return pins;
};

/**
 * Build descriptors for combined-action pins. A simulated combined
 * action is identified by an action key containing '+' in the
 * `actions` dict (e.g. "disco_X+reco_Y"). For each such entry the
 * function locates the two constituent unitary pins and produces a
 * `CombinedPinInfo` with a curved connection between them and a
 * dedicated pin at the curve midpoint.
 *
 * NOTE: simulated pairs land in `actions` (not `combined_actions`)
 * — see CombinedActionsModal's handleSimulate. That is why this
 * function scans `actions` for '+' keys rather than iterating over
 * `combined_actions`.
 *
 * Pure function — no DOM access.
 */
export const buildCombinedActionPins = (
    actions: Record<string, ActionDetail> | null | undefined,
    unitaryPins: readonly ActionPinInfo[],
    monitoringFactor: number,
): CombinedPinInfo[] => {
    if (!actions) return [];
    const pinById = new Map(unitaryPins.map(p => [p.id, p]));
    const result: CombinedPinInfo[] = [];

    const combinedKeys = Object.keys(actions).filter(k => k.includes('+'));
    if (combinedKeys.length > 0) {
        console.log('[buildCombinedActionPins] combined keys in actions:', combinedKeys);
        console.log('[buildCombinedActionPins] unitary pin ids:', [...pinById.keys()]);
    }

    for (const [actionId, detail] of Object.entries(actions)) {
        if (!actionId.includes('+')) continue;

        const parts = actionId.split('+');
        if (parts.length !== 2) continue;
        const [id1, id2] = parts;

        const pin1 = pinById.get(id1);
        const pin2 = pinById.get(id2);
        if (!pin1 || !pin2) {
            console.warn(`[buildCombinedActionPins] skipping "${actionId}": pin1(${id1})=${!!pin1}, pin2(${id2})=${!!pin2}`);
            continue;
        }

        // Midpoint of the quadratic curve control point offset.
        // The control point is offset perpendicular to the line
        // between the two pins.
        const dx = pin2.x - pin1.x;
        const dy = pin2.y - pin1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offsetFraction = 0.3;
        const ctrlX = (pin1.x + pin2.x) / 2 + (-dy / dist) * dist * offsetFraction;
        const ctrlY = (pin1.y + pin2.y) / 2 + (dx / dist) * dist * offsetFraction;
        // Midpoint of quadratic Bezier: B(0.5)
        const t = 0.5;
        const midX = (1 - t) * (1 - t) * pin1.x + 2 * t * (1 - t) * ctrlX + t * t * pin2.x;
        const midY = (1 - t) * (1 - t) * pin1.y + 2 * t * (1 - t) * ctrlY + t * t * pin2.y;

        const severity = computeActionSeverity(detail, monitoringFactor);

        const label = detail.max_rho != null
            ? `${(detail.max_rho * 100).toFixed(0)}%`
            : detail.non_convergence ? 'DIV'
                : detail.is_islanded ? 'ISL' : '\u2014';

        const title = [
            `${id1} + ${id2}`,
            detail.description_unitaire,
            detail.max_rho != null
                ? `max loading ${(detail.max_rho * 100).toFixed(1)}%${detail.max_rho_line ? ` on ${detail.max_rho_line}` : ''}`
                : detail.non_convergence ? 'load-flow divergent'
                    : detail.is_islanded ? 'islanding' : '',
        ].filter(Boolean).join(' \u2014 ');

        result.push({
            pairId: actionId,
            action1Id: id1,
            action2Id: id2,
            p1: { x: pin1.x, y: pin1.y },
            p2: { x: pin2.x, y: pin2.y },
            x: midX,
            y: midY,
            label,
            title,
            severity,
        });
    }
    return result;
};

/**
 * Apply contingency + overload halo highlights to the
 * action-overview diagram, mirroring what the N-1 tab shows.
 *
 * The overview dims the NAD background via a CSS class
 * (`nad-overview-dimmed`) on the SVG root — each direct child
 * stays at full opacity — the dimming is achieved by a single
 * white `<rect>` overlay with `opacity: 0.65` placed between
 * the NAD content and the highlight/pin layers, avoiding both
 * SVG transparency groups and CSS per-child opacity stacking
 * contexts (both cause ~25-31s Layerize on large grids).
 *
 * Visual stack (back to front):
 *   1. overview highlight layer (contingency + overload halos —
 *      behind NAD content, matching N-1 tab's background-layer)
 *   2. original NAD content (full opacity)
 *   3. dim rect (white, opacity 0.65 — dims NAD + highlights)
 *   4. action overview pin layer (Google-Maps pins on top)
 *
 * The clones reuse the existing `.nad-contingency-highlight` and
 * `.nad-overloaded` CSS rules from App.css so the visual encoding
 * stays identical to the N-1 tab.
 *
 * Idempotent: the existing highlight layer is removed before
 * being re-created, so calling this on every `selectedBranch`
 * change is safe.
 */
export const applyActionOverviewHighlights = (
    container: HTMLElement | null,
    metaIndex: MetadataIndex | null,
    contingency: string | null,
    overloadedLines: readonly string[],
) => {
    if (!container) return;
    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    // Wipe any existing overview highlight layer — keeps repeated
    // calls idempotent.
    svg.querySelectorAll('.nad-overview-highlight-layer').forEach(el => el.remove());

    if (!metaIndex) return;
    const haveContingency = !!contingency;
    const haveOverloads = overloadedLines.length > 0;
    if (!haveContingency && !haveOverloads) return;

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(SVG_NS, 'g') as SVGGElement;
    layer.setAttribute('class', 'nad-overview-highlight-layer');
    // Insert at the START of the SVG so highlights render BEHIND
    // the NAD content, matching the N-1 tab's getBackgroundLayer()
    // pattern.  The dim rect (which sits above NAD content) will
    // partially dim the highlights, but the thick halo strokes
    // (120-150px) with bright colours still show through, creating
    // a visible "background glow" behind the network lines — the
    // same visual effect as the N-1 diagram.
    //
    // Visual stack: highlights → NAD content → dim rect → pins.
    if (svg.firstChild) {
        svg.insertBefore(layer, svg.firstChild);
    } else {
        svg.appendChild(layer);
    }

    const idMap = getIdMap(container);

    // --- BATCHED READ/WRITE PATTERN ---
    // Phase 1: collect all edge ids to highlight (pure data — no DOM reads).
    const edgesToClone: { svgId: string; klass: string }[] = [];
    if (contingency) {
        const edge = metaIndex.edgesByEquipmentId.get(contingency);
        if (edge?.svgId) edgesToClone.push({ svgId: edge.svgId, klass: 'nad-contingency-highlight' });
    }
    overloadedLines.forEach(name => {
        const edge = metaIndex.edgesByEquipmentId.get(name);
        if (edge?.svgId) edgesToClone.push({ svgId: edge.svgId, klass: 'nad-overloaded' });
    });
    if (edgesToClone.length === 0) return;

    // Phase 2: READ — clone nodes and read all CTMs in a single
    // contiguous pass (no DOM writes in between, avoiding layout
    // thrashing).
    let layerCTM: DOMMatrix | null = null;
    try {
        layerCTM = (layer as unknown as SVGGraphicsElement).getScreenCTM?.() ?? null;
    } catch { /* jsdom */ }

    const prepared: { clone: SVGGraphicsElement; transform: string | null }[] = [];
    for (const { svgId, klass } of edgesToClone) {
        const original = idMap.get(svgId);
        if (!original) continue;
        const clone = original.cloneNode(true) as SVGGraphicsElement;
        clone.removeAttribute('id');
        clone.classList.add(klass, 'nad-highlight-clone');
        clone.classList.remove('nad-delta-positive', 'nad-delta-negative', 'nad-delta-grey');

        let transform: string | null = null;
        try {
            const origCTM = (original as SVGGraphicsElement).getScreenCTM?.();
            if (origCTM && layerCTM) {
                const m = layerCTM.inverse().multiply(origCTM);
                transform = `matrix(${m.a}, ${m.b}, ${m.c}, ${m.d}, ${m.e}, ${m.f})`;
            }
        } catch { /* jsdom */ }
        prepared.push({ clone, transform });
    }

    // Phase 3: WRITE — batch all DOM mutations via a DocumentFragment
    // to trigger a single reflow instead of one per clone.
    const frag = document.createDocumentFragment();
    for (const { clone, transform } of prepared) {
        if (transform) clone.setAttribute('transform', transform);
        frag.appendChild(clone);
    }
    layer.appendChild(frag);
};

/**
 * Read a sensible base radius for the pin glyph from the SVG.
 *
 * We want pins to be "similar in size to voltage-level circles when
 * zoomed" (as the operator sees other highlights in the NAD), so we
 * pick up the radius of the first VL circle in the diagram and use
 * it as the pin body radius. Falls back to 30 user units when the
 * SVG has no circles (e.g. a handcrafted test fixture).
 */
const readPinBaseRadius = (svg: SVGSVGElement): number => {
    // Prefer circles under the voltage-level nodes group; fall back
    // to any circle that has an explicit `r` attribute.
    const vlCircle =
        svg.querySelector('.nad-vl-nodes circle[r]') ??
        svg.querySelector('circle[r]');
    if (vlCircle) {
        const attr = vlCircle.getAttribute('r');
        const n = attr ? parseFloat(attr) : NaN;
        if (Number.isFinite(n) && n > 0) return n;
    }
    return 30;
};

/**
 * Minimum pin body radius in SCREEN pixels. Enforced by
 * {@link rescaleActionOverviewPins} so that pins remain readable
 * when the operator zooms far out to inspect a large grid — the
 * rescaler upscales the pin body in SVG-space as the viewBox grows.
 */
const PIN_MIN_SCREEN_RADIUS_PX = 22;

/**
 * Minimum pin body radius as a fraction of the current viewBox
 * extent. On large grids the VL circle radius (used as `baseR`)
 * is tiny relative to the diagram — e.g. r=40 on a 30000-unit
 * wide diagram. The screen-pixel floor (`PIN_MIN_SCREEN_RADIUS_PX`)
 * only kicks in during zoom, but at the initial auto-fit zoom the
 * pins may still be too small to notice. This fraction ensures
 * pin diameter is always at least 1/50th of the viewBox window.
 */
const PIN_VIEWBOX_FRACTION = 50;

/**
 * Rescale the action-overview pin glyphs so that, as the viewBox
 * grows (user zooms out), they grow proportionally in SVG-space to
 * stay at least `PIN_MIN_SCREEN_RADIUS_PX` pixels wide on screen —
 * mirroring the non-scaling-stroke trick used on contingency and
 * overload circle halos in App.css.
 *
 * The per-pin transform is applied to the inner `<g>` wrapping the
 * glyph, leaving the outer `translate(x y)` and the click listener
 * intact. Reads `getScreenCTM()` on the SVG to map SVG units back
 * to screen pixels. No-ops gracefully when the CTM is unavailable
 * (e.g. in jsdom or when the element is detached), falling back to
 * a 1:1 mapping which keeps the pins at their base radius.
 */
// Cache the base radius per SVG element so `rescaleActionOverviewPins`
// (called on every rAF during zoom) skips the querySelectorAll lookup.
const pinBaseRadiusCache = new WeakMap<SVGSVGElement, number>();

export const rescaleActionOverviewPins = (container: HTMLElement | null) => {
    if (!container) return;
    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;
    const layer = svg.querySelector('.nad-action-overview-pins');
    if (!layer) return;

    performance.mark('aod:rescalePins:start');

    // Derive pxPerSvgUnit from the viewBox width and the container's
    // client width — pure math, no forced layout.  The previous
    // implementation called `getScreenCTM()` which triggers a
    // synchronous layout recalculation on every zoom frame and was
    // the root cause of "Page ne répondant pas" on large grids.
    //
    // `clientWidth` is cheap to read (it's already known to the
    // layout engine from the last completed layout) and does NOT
    // force a layout flush on its own — only a forced layout happens
    // when you read geometry AFTER pending DOM writes, but here the
    // only pending write is the `viewBox` attribute which changes the
    // SVG viewport, not the CSS box model of the container div.
    //
    // Falls back to getScreenCTM() when clientWidth is unavailable
    // (e.g. element not yet laid out) to keep pin scaling working.
    let pxPerSvgUnit = 1;
    const vbAttr = svg.getAttribute('viewBox');
    if (vbAttr) {
        const parts = vbAttr.split(/[\s,]+/).map(Number);
        if (parts.length === 4 && Number.isFinite(parts[2]) && parts[2] > 0) {
            const containerW = container.clientWidth;
            if (containerW > 0) {
                pxPerSvgUnit = containerW / parts[2];
            } else {
                // Fallback: use getScreenCTM when container has no layout yet.
                // This path is hit only once (initial render) — subsequent
                // calls during zoom will have a valid clientWidth.
                const ctm = (svg as unknown as SVGGraphicsElement).getScreenCTM?.();
                if (ctm) pxPerSvgUnit = ctm.a;
            }
        }
    }

    // Use cached base radius — avoids querySelectorAll('circle[r]')
    // on every zoom frame.
    let baseR = pinBaseRadiusCache.get(svg);
    if (baseR === undefined) {
        baseR = readPinBaseRadius(svg);
        pinBaseRadiusCache.set(svg, baseR);
    }
    const minSvgR = PIN_MIN_SCREEN_RADIUS_PX / pxPerSvgUnit;
    // Second floor: pin radius must be at least 1/50th of the
    // current viewBox extent so pins stay prominent on large grids
    // where the VL circles are tiny relative to the diagram.
    let viewBoxMinR = 0;
    if (vbAttr) {
        const parts = vbAttr.split(/[\s,]+/).map(Number);
        if (parts.length === 4) {
            const extent = Math.max(parts[2], parts[3]);
            viewBoxMinR = extent / PIN_VIEWBOX_FRACTION;
        }
    }
    // Keep `baseR` as the floor — this is what makes pins match VL
    // circles at normal zoom. When the user zooms far out, minSvgR
    // exceeds baseR and the pins grow to stay visible. The viewBox
    // fraction floor ensures pins are prominent even on first render
    // of very large grids.
    const effectiveR = Math.max(baseR, minSvgR, viewBoxMinR);
    const scale = effectiveR / baseR;

    layer.querySelectorAll('.nad-action-overview-pin-body').forEach(body => {
        body.setAttribute('transform', `scale(${scale})`);
    });

    // Curves use a fixed stroke width that matches the network edges
    // — no dynamic rescaling needed since they live in SVG-space and
    // scale naturally with the viewBox, just like the edges do.

    performance.mark('aod:rescalePins:end');
    const entry = performance.measure('aod:rescalePins', 'aod:rescalePins:start', 'aod:rescalePins:end');
    if (entry.duration > 5) console.log(`[PERF] aod:rescalePins: ${entry.duration.toFixed(2)}ms`);
};

/**
 * Delay (ms) used by {@link applyActionOverviewPins} to distinguish
 * a pin single-click from the first click of a double-click. The
 * single-click action is deferred for this window and cancelled if
 * a `dblclick` event lands on the same pin. Exposed as a constant
 * so tests can fast-forward it deterministically.
 */
export const PIN_SINGLE_CLICK_DELAY_MS = 250;

/**
 * Build a 5-pointed star SVG path string centred at (cx, cy) with
 * the given outer radius. Used as the "selected" status symbol.
 */
const starPath = (cx: number, cy: number, outerR: number): string => {
    const innerR = outerR * 0.4;
    const pts: string[] = [];
    for (let i = 0; i < 10; i++) {
        const angle = (Math.PI / 2) + (i * Math.PI / 5);
        const r = i % 2 === 0 ? outerR : innerR;
        pts.push(`${cx + r * Math.cos(angle)},${cy - r * Math.sin(angle)}`);
    }
    return `M ${pts.join(' L ')} Z`;
};

/**
 * Build an X (cross) SVG path string centred at (cx, cy) with the
 * given half-width. Used as the "rejected" status symbol.
 */
const crossPath = (cx: number, cy: number, halfW: number): string => {
    const t = halfW * 0.25; // arm thickness
    return [
        `M ${cx - halfW} ${cy - halfW + t}`,
        `L ${cx - t} ${cy}`,
        `L ${cx - halfW} ${cy + halfW - t}`,
        `L ${cx - halfW + t} ${cy + halfW}`,
        `L ${cx} ${cy + t}`,
        `L ${cx + halfW - t} ${cy + halfW}`,
        `L ${cx + halfW} ${cy + halfW - t}`,
        `L ${cx + t} ${cy}`,
        `L ${cx + halfW} ${cy - halfW + t}`,
        `L ${cx + halfW - t} ${cy - halfW}`,
        `L ${cx} ${cy - t}`,
        `L ${cx - halfW + t} ${cy - halfW}`,
        'Z',
    ].join(' ');
};

/** Options bag for {@link applyActionOverviewPins}. */
export interface ApplyPinsOptions {
    selectedActionIds?: Set<string>;
    rejectedActionIds?: Set<string>;
    combinedPins?: readonly CombinedPinInfo[];
}

/**
 * Inject (or refresh) the action-overview pin layer inside the
 * given container's SVG.
 *
 * Click semantics:
 *  - a single click on a pin invokes `onPinClick` after
 *    {@link PIN_SINGLE_CLICK_DELAY_MS} ms, with the pin's screen
 *    coordinates so the caller can anchor a popover next to it;
 *  - a double click on a pin cancels the pending single-click and
 *    invokes `onPinDoubleClick` instead — the caller typically
 *    uses that to activate the action drill-down view.
 *
 * Status decorations:
 *  - **selected** pins get a highlighted fill and a gold star symbol
 *    rendered above the teardrop bubble;
 *  - **rejected** pins get a dimmed fill and a red cross symbol
 *    rendered above the teardrop bubble.
 *
 * Combined action connections:
 *  - For each combined action, a curved SVG path is drawn between
 *    the two unitary pins, and a dedicated combined-action pin sits
 *    at the midpoint of the curve.
 *
 * Calling this with an empty `pins` array wipes the layer.
 */
export const applyActionOverviewPins = (
    container: HTMLElement | null,
    pins: ActionPinInfo[],
    onPinClick: (actionId: string, screenPos: { x: number; y: number }) => void,
    onPinDoubleClick?: (actionId: string) => void,
    opts?: ApplyPinsOptions,
) => {
    if (!container) return;
    const svg = container.querySelector('svg') as SVGSVGElement | null;
    if (!svg) return;

    // Purge any existing layer so repeated calls stay idempotent.
    svg.querySelectorAll('.nad-action-overview-pins').forEach(el => el.remove());

    const combinedPins = opts?.combinedPins ?? [];
    if (pins.length === 0 && combinedPins.length === 0) return;

    const selectedIds = opts?.selectedActionIds;
    const rejectedIds = opts?.rejectedActionIds;

    // Base pin body radius = radius of a voltage-level circle. This
    // is the "when zoomed in" size — at typical detail zoom, pins
    // appear roughly the same size as the VL glyphs they sit on.
    // {@link rescaleActionOverviewPins} then enforces a screen-pixel
    // floor so pins stay visible when the operator unzooms.
    const r = readPinBaseRadius(svg);
    // Populate the cache eagerly so rescaleActionOverviewPins (called
    // on every zoom frame) skips the querySelectorAll lookup.
    pinBaseRadiusCache.set(svg, r);
    const labelFont = Math.max(9, r * 0.8);

    // Read the actual edge stroke width from the network SVG so
    // combined-action curves match the underlying edge thickness.
    // Falls back to 3 SVG units if no edge path is found.
    let edgeStrokeW = 3;
    const edgePath = svg.querySelector('.nad-edge-paths path[style*="stroke-width"], .nad-edge-paths path') as SVGElement | null;
    if (edgePath) {
        const sw = edgePath.style?.strokeWidth || edgePath.getAttribute('stroke-width');
        if (sw) {
            const n = parseFloat(sw);
            if (Number.isFinite(n) && n > 0) edgeStrokeW = n;
        }
    }

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'nad-action-overview-pins');

    // Build all pin elements into a DocumentFragment off-DOM first,
    // then insert them in a single DOM mutation to avoid per-pin
    // reflow.
    const frag = document.createDocumentFragment();

    // ── Helper: attach click/dblclick listeners to a pin group ──
    const attachClickListeners = (
        g: SVGGElement,
        pinId: string,
        clickCb: typeof onPinClick,
        dblClickCb: typeof onPinDoubleClick,
    ) => {
        let clickTimer: ReturnType<typeof setTimeout> | null = null;
        g.addEventListener('mousedown', (evt) => { evt.stopPropagation(); });
        g.addEventListener('click', (evt) => {
            evt.stopPropagation();
            if (clickTimer !== null) return;
            const rect = (evt.currentTarget as SVGGElement).getBoundingClientRect();
            const screenPos = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
            clickTimer = setTimeout(() => {
                clickTimer = null;
                clickCb(pinId, screenPos);
            }, PIN_SINGLE_CLICK_DELAY_MS);
        });
        g.addEventListener('dblclick', (evt) => {
            evt.stopPropagation();
            if (clickTimer !== null) { clearTimeout(clickTimer); clickTimer = null; }
            if (dblClickCb) dblClickCb(pinId);
        });
    };

    // ── Helper: create a teardrop pin glyph ──
    const buildPinGlyph = (
        body: SVGGElement,
        R: number,
        fill: string,
        label: string,
        titleText: string,
        strokeColor?: string,
        strokeWidth?: number,
    ) => {
        const tail = R * 0.9;
        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = titleText;
        body.appendChild(title);

        const path = document.createElementNS(SVG_NS, 'path');
        const d = `M ${-R} ${-R - tail} A ${R} ${R} 0 1 1 ${R} ${-R - tail} L 0 0 Z`;
        path.setAttribute('d', d);
        path.setAttribute('fill', fill);
        if (strokeColor) {
            path.setAttribute('stroke', strokeColor);
            path.setAttribute('stroke-width', String(strokeWidth ?? R * 0.12));
        } else {
            path.setAttribute('stroke', 'none');
        }
        body.appendChild(path);

        const inner = document.createElementNS(SVG_NS, 'circle');
        inner.setAttribute('cx', '0');
        inner.setAttribute('cy', String(-R - tail));
        inner.setAttribute('r', String(R * 0.72));
        inner.setAttribute('fill', '#ffffff');
        inner.setAttribute('fill-opacity', '0.92');
        inner.setAttribute('pointer-events', 'none');
        body.appendChild(inner);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', '0');
        text.setAttribute('y', String(-R - tail));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', String(labelFont));
        text.setAttribute('font-weight', '800');
        text.setAttribute('font-family', 'system-ui, -apple-system, Arial, sans-serif');
        text.setAttribute('fill', '#1f2937');
        text.setAttribute('pointer-events', 'none');
        text.textContent = label;
        body.appendChild(text);
    };

    // ── 1. Combined action curved connections + midpoint pins ──
    combinedPins.forEach(cp => {
        // Curved connection line between the two unitary pins.
        const dx = cp.p2.x - cp.p1.x;
        const dy = cp.p2.y - cp.p1.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const offsetFraction = 0.3;
        const ctrlX = (cp.p1.x + cp.p2.x) / 2 + (-dy / dist) * dist * offsetFraction;
        const ctrlY = (cp.p1.y + cp.p2.y) / 2 + (dx / dist) * dist * offsetFraction;

        const curvePath = document.createElementNS(SVG_NS, 'path');
        curvePath.setAttribute('d',
            `M ${cp.p1.x} ${cp.p1.y} Q ${ctrlX} ${ctrlY} ${cp.p2.x} ${cp.p2.y}`);
        curvePath.setAttribute('class', 'nad-combined-action-curve');
        curvePath.setAttribute('fill', 'none');
        curvePath.setAttribute('stroke', severityFill[cp.severity]);
        curvePath.setAttribute('stroke-width', String(edgeStrokeW));
        curvePath.setAttribute('stroke-dasharray', `${edgeStrokeW * 2.5} ${edgeStrokeW * 1.5}`);
        curvePath.setAttribute('stroke-linecap', 'round');
        curvePath.setAttribute('pointer-events', 'none');
        frag.appendChild(curvePath);

        // Combined-action pin at the midpoint.
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'nad-action-overview-pin nad-combined-action-pin');
        g.setAttribute('transform', `translate(${cp.x} ${cp.y})`);
        g.setAttribute('data-action-id', cp.pairId);
        (g as unknown as SVGGElement).style.cursor = 'pointer';

        const body = document.createElementNS(SVG_NS, 'g');
        body.setAttribute('class', 'nad-action-overview-pin-body');
        body.setAttribute('transform', 'scale(1)');
        g.appendChild(body);

        // Use the severity palette (same as unitary pins) so the
        // combined pin colour matches the action card.
        let fill: string;
        let stroke: string | undefined;
        if (selectedIds?.has(cp.pairId)) {
            fill = severityFillHighlighted[cp.severity];
            stroke = '#eab308';
        } else if (rejectedIds?.has(cp.pairId)) {
            fill = severityFillDimmed[cp.severity];
        } else {
            fill = severityFill[cp.severity];
        }

        buildPinGlyph(body, r, fill, cp.label, cp.title, stroke, stroke ? r * 0.12 : undefined);

        // "+" badge on the bubble top to indicate it's a combined pin
        const tail = r * 0.9;
        const badgeCy = -r - tail - r * 0.95;
        const badge = document.createElementNS(SVG_NS, 'circle');
        badge.setAttribute('cx', '0');
        badge.setAttribute('cy', String(badgeCy));
        badge.setAttribute('r', String(r * 0.35));
        badge.setAttribute('fill', severityFill[cp.severity]);
        badge.setAttribute('stroke', 'white');
        badge.setAttribute('stroke-width', String(r * 0.06));
        badge.setAttribute('pointer-events', 'none');
        body.appendChild(badge);

        const plusText = document.createElementNS(SVG_NS, 'text');
        plusText.setAttribute('x', '0');
        plusText.setAttribute('y', String(badgeCy));
        plusText.setAttribute('text-anchor', 'middle');
        plusText.setAttribute('dominant-baseline', 'central');
        plusText.setAttribute('font-size', String(r * 0.5));
        plusText.setAttribute('font-weight', '900');
        plusText.setAttribute('font-family', 'system-ui, -apple-system, Arial, sans-serif');
        plusText.setAttribute('fill', 'white');
        plusText.setAttribute('pointer-events', 'none');
        plusText.textContent = '+';
        body.appendChild(plusText);

        attachClickListeners(g, cp.pairId, onPinClick, onPinDoubleClick);
        frag.appendChild(g);
    });

    // ── 2. Unitary action pins ──
    pins.forEach(pin => {
        const isSelected = selectedIds?.has(pin.id) ?? false;
        const isRejected = rejectedIds?.has(pin.id) ?? false;

        // OUTER group: anchor translate + click handler.
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'nad-action-overview-pin');
        g.setAttribute('transform', `translate(${pin.x} ${pin.y})`);
        g.setAttribute('data-action-id', pin.id);
        (g as unknown as SVGGElement).style.cursor = 'pointer';

        // INNER group: the glyph itself.
        const body = document.createElementNS(SVG_NS, 'g');
        body.setAttribute('class', 'nad-action-overview-pin-body');
        body.setAttribute('transform', 'scale(1)');
        g.appendChild(body);

        // Choose fill based on status.
        let fill: string;
        let strokeColor: string | undefined;
        let strokeWidth: number | undefined;
        if (isSelected) {
            fill = severityFillHighlighted[pin.severity];
            strokeColor = '#eab308';    // gold border for emphasis
            strokeWidth = r * 0.12;
        } else if (isRejected) {
            fill = severityFillDimmed[pin.severity];
        } else {
            fill = severityFill[pin.severity];
        }

        const R = r;
        const tail = R * 0.9;

        buildPinGlyph(body, R, fill, pin.label, pin.title, strokeColor, strokeWidth);

        // ── Status symbol above the teardrop bubble ──
        const symbolCy = -R - tail - R * 0.95;
        if (isSelected) {
            // Gold star
            const starEl = document.createElementNS(SVG_NS, 'path');
            starEl.setAttribute('d', starPath(0, symbolCy, R * 0.45));
            starEl.setAttribute('fill', '#eab308');
            starEl.setAttribute('stroke', '#a16207');
            starEl.setAttribute('stroke-width', String(R * 0.05));
            starEl.setAttribute('pointer-events', 'none');
            body.appendChild(starEl);
        } else if (isRejected) {
            // Red cross
            const crossEl = document.createElementNS(SVG_NS, 'path');
            crossEl.setAttribute('d', crossPath(0, symbolCy, R * 0.35));
            crossEl.setAttribute('fill', '#ef4444');
            crossEl.setAttribute('stroke', '#b91c1c');
            crossEl.setAttribute('stroke-width', String(R * 0.05));
            crossEl.setAttribute('pointer-events', 'none');
            body.appendChild(crossEl);
        }

        // Dim the whole pin group for rejected actions.
        if (isRejected) {
            g.setAttribute('opacity', '0.55');
        }

        attachClickListeners(g, pin.id, onPinClick, onPinDoubleClick);
        frag.appendChild(g);
    });

    // Batch-insert all pins, then mount the layer in the live SVG
    // — a single DOM mutation for the entire pin set.
    layer.appendChild(frag);
    svg.appendChild(layer);

    // Apply the initial scale compensation so the pins come up at
    // the right size on the very first paint, before the user has
    // panned or zoomed. Safe to call here — the layer is already in
    // the DOM (we just appended it).
    rescaleActionOverviewPins(container);
};

/**
 * Collect SVG (x, y) coordinates for a single equipment id, looking
 * it up first as an edge (accumulating both endpoints) and then as
 * a voltage-level node. Silently no-ops if nothing matches —
 * callers accumulate into a shared xs/ys array.
 */
const pushEquipmentPoints = (
    metaIndex: MetadataIndex,
    equipmentId: string,
    xs: number[],
    ys: number[],
) => {
    const edge = metaIndex.edgesByEquipmentId.get(equipmentId);
    if (edge) {
        const lookupNode = (ref: unknown): NodeMeta | undefined => {
            if (typeof ref !== 'string') return undefined;
            return metaIndex.nodesBySvgId.get(ref) ?? metaIndex.nodesByEquipmentId.get(ref);
        };
        const n1 = lookupNode(edge.node1);
        const n2 = lookupNode(edge.node2);
        if (n1 && Number.isFinite(n1.x)) { xs.push(n1.x); ys.push(n1.y); }
        if (n2 && Number.isFinite(n2.x)) { xs.push(n2.x); ys.push(n2.y); }
        if (n1 || n2) return;
    }
    const node = metaIndex.nodesByEquipmentId.get(equipmentId);
    if (node && Number.isFinite(node.x)) {
        xs.push(node.x);
        ys.push(node.y);
    }
};

/**
 * Compute a padded bounding rectangle that contains the contingency
 * edge, all overloaded lines, and every action-overview pin. Used by
 * the action-overview auto-zoom when the Remedial Action tab opens
 * without any card selected. Returns `null` when nothing can be
 * located (in which case the caller typically falls back to the
 * full NAD viewBox).
 */
export const computeActionOverviewFitRect = (
    metaIndex: MetadataIndex | null,
    contingency: string | null,
    overloads: readonly string[],
    pins: readonly { x: number; y: number }[],
    padRatio: number = 0.05,
): ViewBox | null => {
    if (!metaIndex) return null;
    const xs: number[] = [];
    const ys: number[] = [];

    if (contingency) pushEquipmentPoints(metaIndex, contingency, xs, ys);
    overloads.forEach(o => pushEquipmentPoints(metaIndex, o, xs, ys));
    pins.forEach(p => {
        if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
            xs.push(p.x);
            ys.push(p.y);
        }
    });

    if (xs.length === 0) return null;

    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);

    // A single point (or a degenerate line) would give a zero-size
    // viewBox that the browser refuses to render — clamp it to a
    // minimum span scaled loosely on the overall diagram.
    let w = maxX - minX;
    let h = maxY - minY;
    const MIN_SPAN = 200;
    if (w < MIN_SPAN) {
        const cx = (minX + maxX) / 2;
        minX = cx - MIN_SPAN / 2;
        maxX = cx + MIN_SPAN / 2;
        w = MIN_SPAN;
    }
    if (h < MIN_SPAN) {
        const cy = (minY + maxY) / 2;
        minY = cy - MIN_SPAN / 2;
        maxY = cy + MIN_SPAN / 2;
        h = MIN_SPAN;
    }

    const padX = w * padRatio;
    const padY = h * padRatio;
    return { x: minX - padX, y: minY - padY, w: w + 2 * padX, h: h + 2 * padY };
};

/**
 * Compute a padded viewBox centred on a single equipment id — used
 * by the action-overview's inspect-search asset focus. Reuses the
 * same point-collection helper as the fit-rect.
 */
export const computeEquipmentFitRect = (
    metaIndex: MetadataIndex | null,
    equipmentId: string,
    padRatio: number = 0.35,
): ViewBox | null => {
    if (!metaIndex || !equipmentId) return null;
    const xs: number[] = [];
    const ys: number[] = [];
    pushEquipmentPoints(metaIndex, equipmentId, xs, ys);
    if (xs.length === 0) return null;

    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    let w = maxX - minX;
    let h = maxY - minY;
    const MIN_SPAN = 150;
    if (w < MIN_SPAN) {
        const cx = (minX + maxX) / 2;
        minX = cx - MIN_SPAN / 2;
        maxX = cx + MIN_SPAN / 2;
        w = MIN_SPAN;
    }
    if (h < MIN_SPAN) {
        const cy = (minY + maxY) / 2;
        minY = cy - MIN_SPAN / 2;
        maxY = cy + MIN_SPAN / 2;
        h = MIN_SPAN;
    }
    const padX = w * padRatio;
    const padY = h * padRatio;
    return { x: minX - padX, y: minY - padY, w: w + 2 * padX, h: h + 2 * padY };
};
