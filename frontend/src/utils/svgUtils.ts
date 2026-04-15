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

const severityFill: Record<ActionPinInfo['severity'], string> = {
    green: '#28a745',
    orange: '#f0ad4e',
    red: '#dc3545',
    grey: '#9ca3af',
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
const resolveActionAnchor = (
    actionId: string,
    details: ActionDetail,
    metaIndex: MetadataIndex,
): { x: number; y: number } | null => {
    const { nodesByEquipmentId, nodesBySvgId, edgesByEquipmentId } = metaIndex;

    const lookupNode = (nodeRef: unknown): NodeMeta | undefined => {
        if (typeof nodeRef !== 'string') return undefined;
        return nodesBySvgId.get(nodeRef) ?? nodesByEquipmentId.get(nodeRef);
    };

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
    return pins;
};

/**
 * Inject (or refresh) the action-overview pin layer inside the
 * given container's SVG. Clicking a pin invokes `onPinClick` with
 * the action id, which should trigger the existing action-select
 * flow. Calling this with an empty `pins` array wipes the layer.
 */
export const applyActionOverviewPins = (
    container: HTMLElement | null,
    pins: ActionPinInfo[],
    onPinClick: (actionId: string) => void,
) => {
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;

    // Purge any existing layer so repeated calls stay idempotent.
    svg.querySelectorAll('.nad-action-overview-pins').forEach(el => el.remove());

    if (pins.length === 0) return;

    // Pins are sized relative to the viewBox so they remain
    // visually stable across large and small grids.
    const vbAttr = svg.getAttribute('viewBox');
    let diagramSize = 1000;
    if (vbAttr) {
        const parts = vbAttr.split(/\s+|,/).map(parseFloat);
        if (parts.length === 4) {
            diagramSize = Math.max(parts[2], parts[3]);
        }
    }
    // Pin body radius ~ 2% of the diagram span, clamped so the
    // pin is always legible without swamping small grids.
    const r = Math.max(12, Math.min(60, diagramSize * 0.018));
    const labelFont = Math.max(9, r * 0.8);

    const SVG_NS = 'http://www.w3.org/2000/svg';
    const layer = document.createElementNS(SVG_NS, 'g');
    layer.setAttribute('class', 'nad-action-overview-pins');
    // Render on top of everything else in the SVG.
    svg.appendChild(layer);

    pins.forEach(pin => {
        const g = document.createElementNS(SVG_NS, 'g');
        g.setAttribute('class', 'nad-action-overview-pin');
        g.setAttribute('transform', `translate(${pin.x} ${pin.y})`);
        g.setAttribute('data-action-id', pin.id);
        (g as unknown as SVGGElement).style.cursor = 'pointer';

        const title = document.createElementNS(SVG_NS, 'title');
        title.textContent = pin.title;
        g.appendChild(title);

        // Google-Maps style teardrop: a circle bubble with a
        // triangular tail ending at the anchor point (0,0). The
        // glyph is drawn in a local coord system where (0,0) is
        // the pointer tip and the bubble sits above it.
        const R = r;
        const tail = R * 0.9;
        const path = document.createElementNS(SVG_NS, 'path');
        const d = `M ${-R} ${-R - tail} A ${R} ${R} 0 1 1 ${R} ${-R - tail} L 0 0 Z`;
        path.setAttribute('d', d);
        path.setAttribute('fill', severityFill[pin.severity]);
        path.setAttribute('stroke', '#1f2937');
        path.setAttribute('stroke-width', String(Math.max(1.5, r * 0.08)));
        path.setAttribute('stroke-linejoin', 'round');
        g.appendChild(path);

        // Inner white disc to host the label.
        const inner = document.createElementNS(SVG_NS, 'circle');
        inner.setAttribute('cx', '0');
        inner.setAttribute('cy', String(-R - tail));
        inner.setAttribute('r', String(R * 0.72));
        inner.setAttribute('fill', '#ffffff');
        inner.setAttribute('fill-opacity', '0.92');
        inner.setAttribute('pointer-events', 'none');
        g.appendChild(inner);

        const text = document.createElementNS(SVG_NS, 'text');
        text.setAttribute('x', '0');
        text.setAttribute('y', String(-R - tail));
        text.setAttribute('text-anchor', 'middle');
        text.setAttribute('dominant-baseline', 'central');
        text.setAttribute('font-size', String(labelFont));
        text.setAttribute('font-weight', '700');
        text.setAttribute('font-family', 'system-ui, -apple-system, Arial, sans-serif');
        text.setAttribute('fill', severityFill[pin.severity]);
        text.setAttribute('pointer-events', 'none');
        text.textContent = pin.label;
        g.appendChild(text);

        g.addEventListener('click', (evt) => {
            evt.stopPropagation();
            onPinClick(pin.id);
        });

        layer.appendChild(g);
    });
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
    padRatio: number = 0.15,
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
