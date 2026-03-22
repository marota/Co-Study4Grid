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

    const diagramSize = Math.max(viewBox.w, viewBox.h);
    const REFERENCE_SIZE = 1250;
    const BOOST_THRESHOLD = 3;
    const ratio = diagramSize / REFERENCE_SIZE;
    if (ratio <= BOOST_THRESHOLD) return svgString;

    const boost = Math.sqrt(ratio / BOOST_THRESHOLD);
    console.log(`[SVG] vlCount=${vlCount}, viewBox ${diagramSize.toFixed(0)}, ratio ${ratio.toFixed(2)}, boost ${boost.toFixed(2)}`);

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;

    if (ratio > 6) {
        svgEl.setAttribute('data-large-grid', 'true');
    }

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
    const scaledGroups = new Set<Element>();
    svgEl.querySelectorAll('circle').forEach(circle => {
        const g = circle.parentElement;
        if (!g || g.tagName !== 'g' || scaledGroups.has(g)) return;
        if (g.querySelector('foreignObject')) return;
        scaledGroups.add(g);
        const cx = parseFloat(circle.getAttribute('cx') || '0');
        const cy = parseFloat(circle.getAttribute('cy') || '0');
        const t = g.getAttribute('transform') || '';
        g.setAttribute('transform',
            `${t} translate(${cx},${cy}) scale(${boost.toFixed(2)}) translate(${-cx},${-cy})`);
    });

    // === 3. Scale edge-info group transforms (flow arrows + values) ===
    const edgeInfoGroup = svgEl.querySelector('.nad-edge-infos');
    if (edgeInfoGroup) {
        edgeInfoGroup.querySelectorAll(':scope > g[transform]').forEach(g => {
            const t = g.getAttribute('transform');
            if (t && t.includes('translate(') && !t.includes('scale(')) {
                g.setAttribute('transform', t + ` scale(${boost.toFixed(2)})`);
            }
        });
    }

    return new XMLSerializer().serializeToString(svgEl);
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
 * Apply orange highlights to overloaded line edges on a given SVG container.
 */
export const applyOverloadedHighlights = (
    container: HTMLElement,
    metaIndex: MetadataIndex,
    overloadedLines: string[],
) => {
    if (!container || !metaIndex || !overloadedLines || overloadedLines.length === 0) return;

    container.querySelectorAll('.nad-overloaded').forEach(el => el.classList.remove('nad-overloaded'));

    const { edgesByEquipmentId } = metaIndex;
    const idMap = getIdMap(container);
    overloadedLines.forEach(lineName => {
        const edge = edgesByEquipmentId.get(lineName);
        if (edge && edge.svgId) {
            const el = idMap.get(edge.svgId);
            if (el) el.classList.add('nad-overloaded');
        }
    });
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
        const isCoupling = actionId?.toLowerCase().includes('coupling') || actionId?.toLowerCase().includes('busbar');

        // Pst taps are always included
        Object.keys(topo.pst_tap || {}).forEach(l => targets.add(l));

        if (!isCoupling) {
            const lineKeys = new Set([
                ...Object.keys(topo.lines_ex_bus || {}),
                ...Object.keys(topo.lines_or_bus || {}),
            ]);
            const genKeys = Object.keys(topo.gens_bus || {});
            const loadKeys = Object.keys(topo.loads_bus || {});

            if (lineKeys.size > 0 && genKeys.length === 0 && loadKeys.length === 0) {
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
    if (actionId) {
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
            if (nodesByEquipmentId.has(vl)) targets.add(vl);
        }
    }

    // Fallback: action ID suffix — skip for pure line reconnection actions
    const topo = actionDetail?.action_topology;
    const isLineReconnection = topo
        && (Object.keys(topo.gens_bus || {}).length === 0 && Object.keys(topo.loads_bus || {}).length === 0)
        && [...Object.values(topo.lines_ex_bus || {}), ...Object.values(topo.lines_or_bus || {})].some(v => v >= 0);

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
    container: HTMLElement,
    metaIndex: MetadataIndex | null,
    actionDetail: ActionDetail | null,
    actionId: string | null,
) => {
    if (!container) return;
    container.querySelectorAll('.nad-action-target').forEach(el => el.classList.remove('nad-action-target'));
    container.querySelectorAll('.nad-highlight-clone').forEach(el => el.remove());
    if (!metaIndex || !actionDetail) return;

    const { edgesByEquipmentId, nodesByEquipmentId } = metaIndex;

    // Create or find background layer at the root of the SVG
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

    // Cache bgCTM per call — constant for all highlights in a single pass
    let cachedBgCTM: DOMMatrix | null = null;

    const applyHighlight = (el: Element) => {
        if (!el) return;

        if (backgroundLayer) {
            const clone = el.cloneNode(true) as SVGGraphicsElement;
            clone.removeAttribute('id');
            clone.classList.add('nad-action-target');
            clone.classList.add('nad-highlight-clone');

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
    if (!container || !metaIndex || !disconnectedElement) return;

    const { edgesByEquipmentId } = metaIndex;
    const edge = edgesByEquipmentId.get(disconnectedElement);
    if (!edge || !edge.svgId) return;

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

    const el = getIdMap(container).get(edge.svgId);
    if (!el || !backgroundLayer) return;

    const clone = el.cloneNode(true) as SVGGraphicsElement;
    clone.removeAttribute('id');
    clone.classList.add('nad-contingency-highlight');
    clone.classList.add('nad-highlight-clone');

    try {
        const elCTM = (el as SVGGraphicsElement).getScreenCTM();
        // Cache bgCTM on the DOM element — constant for a given SVG
        const bgSvgEl = backgroundLayer as unknown as SVGGraphicsElement & { _cachedScreenCTM?: DOMMatrix | null };
        const bgCTM = bgSvgEl._cachedScreenCTM || (bgSvgEl._cachedScreenCTM = bgSvgEl.getScreenCTM());
        if (elCTM && bgCTM) {
            const relativeCTM = bgCTM.inverse().multiply(elCTM);
            const matrixStr = `matrix(${relativeCTM.a}, ${relativeCTM.b}, ${relativeCTM.c}, ${relativeCTM.d}, ${relativeCTM.e}, ${relativeCTM.f})`;
            clone.setAttribute('transform', matrixStr);
        }
    } catch (e) {
        console.warn('Failed to get CTM for contingency highlight:', e);
    }
    backgroundLayer.prepend(clone);
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
