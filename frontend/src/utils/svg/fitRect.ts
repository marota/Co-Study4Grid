// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import type { MetadataIndex, NodeMeta, ViewBox } from '../../types';

/**
 * Collect SVG (x, y) coordinates for a single equipment id, looking
 * it up first as an edge (accumulating both endpoints) and then as
 * a voltage-level node. Silently no-ops if nothing matches —
 * callers accumulate into a shared xs/ys array.
 *
 * Exported so tests and callers can compose their own fit-rect
 * shapes without reaching into the helpers below.
 */
export const pushEquipmentPoints = (
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
 * Expand a (minX, maxX, minY, maxY) range to a minimum span then add
 * padding. Returns a `ViewBox` centred on the original range. Shared
 * between `computeActionOverviewFitRect` and `computeEquipmentFitRect`
 * so the zero-size-clamp + padding rules stay identical.
 */
const rectFromBounds = (
    xs: number[],
    ys: number[],
    minSpan: number,
    padRatio: number,
): ViewBox => {
    let minX = Math.min(...xs);
    let maxX = Math.max(...xs);
    let minY = Math.min(...ys);
    let maxY = Math.max(...ys);
    let w = maxX - minX;
    let h = maxY - minY;
    if (w < minSpan) {
        const cx = (minX + maxX) / 2;
        minX = cx - minSpan / 2;
        maxX = cx + minSpan / 2;
        w = minSpan;
    }
    if (h < minSpan) {
        const cy = (minY + maxY) / 2;
        minY = cy - minSpan / 2;
        maxY = cy + minSpan / 2;
        h = minSpan;
    }
    const padX = w * padRatio;
    const padY = h * padRatio;
    return { x: minX - padX, y: minY - padY, w: w + 2 * padX, h: h + 2 * padY };
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
    return rectFromBounds(xs, ys, 200, padRatio);
};

/**
 * Compute a padded viewBox centred on a single equipment id — used
 * by the action-overview's inspect-search asset focus.
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
    return rectFromBounds(xs, ys, 150, padRatio);
};
