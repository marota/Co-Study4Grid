// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import type { ViewBox } from '../../types';

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
    // Apply a milder factor to node circles than to text / edge-info groups.
    // On dense PyPSA-derived grids (lots of voltage levels collocated at the
    // same urban substation) scaling the node radii by the full text-boost
    // factor pushes neighbouring nodes into each other and produces the
    // overlapping-circle blob the operator sees on fr225_400. Damping the
    // node scale by a sqrt keeps zoomed-in labels readable while leaving
    // enough whitespace around each VL to distinguish it from its peers.
    const nodeBoost = Math.sqrt(boost);
    const nodeBoostStr = nodeBoost.toFixed(2);

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgString, 'image/svg+xml');
        const svgEl = doc.documentElement;

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
                targetEl.setAttribute('transform', `${t} translate(${cxNum},${cyNum}) scale(${nodeBoostStr}) translate(${-cxNum},${-cyNum})`);
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
