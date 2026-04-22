// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import { describe, expect, it } from 'vitest';
import {
    computeActionOverviewFitRect,
    computeEquipmentFitRect,
    pushEquipmentPoints,
} from './fitRect';
import type { EdgeMeta, MetadataIndex, NodeMeta } from '../../types';

const makeMetaIndex = (overrides: Partial<MetadataIndex> = {}): MetadataIndex => ({
    nodesByEquipmentId: new Map<string, NodeMeta>(),
    nodesBySvgId: new Map<string, NodeMeta>(),
    edgesByEquipmentId: new Map<string, EdgeMeta>(),
    edgesByNode: new Map<string, EdgeMeta[]>(),
    ...overrides,
});

const node = (id: string, x: number, y: number): NodeMeta => ({
    equipmentId: id, svgId: `svg-${id}`, x, y,
} as unknown as NodeMeta);

const edge = (id: string, n1: string, n2: string): EdgeMeta => ({
    equipmentId: id, svgId: `svg-${id}`, node1: n1, node2: n2,
} as unknown as EdgeMeta);

describe('pushEquipmentPoints', () => {
    it('accumulates both endpoints for a known edge', () => {
        const nodes = new Map<string, NodeMeta>([
            ['A', node('A', 10, 20)],
            ['B', node('B', 30, 40)],
        ]);
        const edges = new Map<string, EdgeMeta>([['LINE_AB', edge('LINE_AB', 'A', 'B')]]);
        const nodesBySvgId = new Map<string, NodeMeta>();
        const meta = makeMetaIndex({
            nodesByEquipmentId: nodes, nodesBySvgId, edgesByEquipmentId: edges,
        });

        const xs: number[] = [];
        const ys: number[] = [];
        pushEquipmentPoints(meta, 'LINE_AB', xs, ys);
        expect(xs.sort()).toEqual([10, 30]);
        expect(ys.sort()).toEqual([20, 40]);
    });

    it('falls back to a node when the id is not an edge', () => {
        const nodes = new Map<string, NodeMeta>([['VL_1', node('VL_1', 7, 8)]]);
        const meta = makeMetaIndex({ nodesByEquipmentId: nodes });
        const xs: number[] = [];
        const ys: number[] = [];
        pushEquipmentPoints(meta, 'VL_1', xs, ys);
        expect(xs).toEqual([7]);
        expect(ys).toEqual([8]);
    });

    it('silently no-ops for an unknown id', () => {
        const meta = makeMetaIndex();
        const xs: number[] = [];
        const ys: number[] = [];
        pushEquipmentPoints(meta, 'UNKNOWN', xs, ys);
        expect(xs).toEqual([]);
        expect(ys).toEqual([]);
    });

    it('ignores NaN coordinates on nodes', () => {
        const nodes = new Map<string, NodeMeta>([['BAD', node('BAD', NaN, NaN)]]);
        const meta = makeMetaIndex({ nodesByEquipmentId: nodes });
        const xs: number[] = [];
        const ys: number[] = [];
        pushEquipmentPoints(meta, 'BAD', xs, ys);
        expect(xs).toEqual([]);
    });
});

describe('computeActionOverviewFitRect', () => {
    const build = () => {
        const nodes = new Map<string, NodeMeta>([
            ['A', node('A', 0, 0)],
            ['B', node('B', 100, 100)],
            ['C', node('C', 200, 0)],
        ]);
        const edges = new Map<string, EdgeMeta>([
            ['LINE_AB', edge('LINE_AB', 'A', 'B')],
            ['LINE_BC', edge('LINE_BC', 'B', 'C')],
        ]);
        return makeMetaIndex({ nodesByEquipmentId: nodes, edgesByEquipmentId: edges });
    };

    it('returns null with no metaIndex', () => {
        expect(computeActionOverviewFitRect(null, 'LINE_AB', [], [])).toBeNull();
    });

    it('returns null when nothing can be located', () => {
        const meta = build();
        const r = computeActionOverviewFitRect(meta, null, [], []);
        expect(r).toBeNull();
    });

    it('covers contingency + overloads + pins with padding', () => {
        const meta = build();
        const r = computeActionOverviewFitRect(meta, 'LINE_AB', ['LINE_BC'], [{ x: 150, y: 150 }], 0.1);
        expect(r).not.toBeNull();
        // Raw bounds: x ∈ [0, 200], y ∈ [0, 150] → w=200 (at MIN_SPAN),
        // h=150 → clamped to MIN_SPAN=200 recentred on cy=75, so
        // y range becomes [-25, 125]. Pad 10% on each → padX=padY=20.
        expect(r!.x).toBeCloseTo(-20, 5);
        expect(r!.w).toBeCloseTo(240, 5);
        expect(r!.y).toBeCloseTo(-45, 5);
        expect(r!.h).toBeCloseTo(240, 5);
    });

    it('clamps to the minimum span for a single-point anchor', () => {
        const meta = build();
        const r = computeActionOverviewFitRect(meta, null, [], [{ x: 100, y: 100 }]);
        // Single point → expanded to MIN_SPAN=200 each axis, then pad 5%.
        expect(r!.w).toBeCloseTo(220, 5);
        expect(r!.h).toBeCloseTo(220, 5);
    });

    it('ignores non-finite pin coordinates', () => {
        const meta = build();
        const r = computeActionOverviewFitRect(meta, 'LINE_AB', [], [{ x: NaN, y: NaN }]);
        expect(r).not.toBeNull();
    });
});

describe('computeEquipmentFitRect', () => {
    it('returns null with no metaIndex or empty id', () => {
        expect(computeEquipmentFitRect(null, 'X')).toBeNull();
        const meta = makeMetaIndex();
        expect(computeEquipmentFitRect(meta, '')).toBeNull();
    });

    it('returns a padded viewBox centred on the equipment', () => {
        const nodes = new Map<string, NodeMeta>([['VL', node('VL', 100, 200)]]);
        const meta = makeMetaIndex({ nodesByEquipmentId: nodes });
        const r = computeEquipmentFitRect(meta, 'VL', 0.5);
        // Single point → MIN_SPAN=150 on each axis, then pad 50% = 75.
        expect(r!.w).toBeCloseTo(300, 5);
        expect(r!.h).toBeCloseTo(300, 5);
        expect(r!.x).toBeCloseTo(100 - 75 - 75, 5);
    });

    it('uses tight bounds when the edge endpoints span more than MIN_SPAN', () => {
        const nodes = new Map<string, NodeMeta>([
            ['A', node('A', 0, 0)],
            ['B', node('B', 400, 300)],
        ]);
        const edges = new Map<string, EdgeMeta>([['LINE_AB', edge('LINE_AB', 'A', 'B')]]);
        const meta = makeMetaIndex({ nodesByEquipmentId: nodes, edgesByEquipmentId: edges });
        const r = computeEquipmentFitRect(meta, 'LINE_AB', 0);
        expect(r!.w).toBe(400);
        expect(r!.h).toBe(300);
    });
});
