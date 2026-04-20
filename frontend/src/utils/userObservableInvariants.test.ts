// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid.

/**
 * Runtime twin of `scripts/check_invariants.py` (Layer 4 static).
 *
 * The Python script guards the STANDALONE HTML against the six bug
 * classes we kept shipping past layers 1-3 (visual thresholds,
 * conditional rendering, field semantics, auto-effects, loading-
 * state, performance).  This Vitest suite guards the REACT side
 * by exercising the same invariants at runtime, because static
 * regex checks can only assert "the pattern is still in the
 * source" — they can't prove the CODE ACTUALLY DOES what the
 * pattern claims.
 *
 * Each test corresponds to a user-observed regression that made
 * it to production.  The test fails if that regression comes back.
 */
import { describe, it, expect } from 'vitest';
import {
    buildActionOverviewPins,
    buildCombinedActionPins,
    resolveActionAnchor,
    type ActionPinInfo,
} from './svgUtils';
import type { ActionDetail, MetadataIndex } from '../types';

// ---------------------------------------------------------------------
// Helpers — tiny synthetic metadata so we don't need real pypowsybl.
// ---------------------------------------------------------------------

const makeMeta = (): MetadataIndex => {
    const nodesByEquipmentId = new Map<string, any>([
        ['VL_A', { equipmentId: 'VL_A', svgId: 'n-VL_A', x: 0, y: 0 }],
        ['VL_B', { equipmentId: 'VL_B', svgId: 'n-VL_B', x: 100, y: 0 }],
        ['VL_C', { equipmentId: 'VL_C', svgId: 'n-VL_C', x: 50, y: 100 }],
    ]);
    const nodesBySvgId = new Map<string, any>();
    for (const n of nodesByEquipmentId.values()) nodesBySvgId.set(n.svgId, n);
    const edgesByEquipmentId = new Map<string, any>([
        ['LINE_AB', { equipmentId: 'LINE_AB', svgId: 'e-LINE_AB', node1: 'n-VL_A', node2: 'n-VL_B' }],
        ['LINE_BC', { equipmentId: 'LINE_BC', svgId: 'e-LINE_BC', node1: 'n-VL_B', node2: 'n-VL_C' }],
    ]);
    return {
        nodesByEquipmentId,
        nodesBySvgId,
        edgesByEquipmentId,
        edgesByNode: new Map(),
    };
};

const makeAction = (overrides: Partial<ActionDetail> = {}): ActionDetail => ({
    description_unitaire: 'test',
    rho_before: [1.0],
    rho_after: [0.8],
    max_rho: 0.8,
    max_rho_line: 'LINE_AB',
    is_rho_reduction: true,
    ...overrides,
});

// ---------------------------------------------------------------------
// Invariant 1 — pin severity is threshold-parameterised by monitoringFactor
// ---------------------------------------------------------------------
// The bug: severity was hardcoded to 0.9 / 1.0 cutoffs, so when the
// user set monitoringFactor=0.85 the palette misclassified pins.
// The Layer 4 script checks the monitoringFactor - 0.05 token exists
// in the source.  This test proves the RUNTIME behaviour.

describe('Layer 4 invariant — pin severity ↔ monitoringFactor', () => {
    const meta = makeMeta();
    const render = (rho: number, mf: number): string => {
        const pins = buildActionOverviewPins(
            { act: makeAction({ max_rho: rho }) },
            meta,
            mf,
        );
        return pins[0]?.severity || 'missing';
    };

    it('red when rho > monitoringFactor (regression of the 97%/MF=0.95 user bug)', () => {
        expect(render(0.96, 0.95)).toBe('red');
        expect(render(0.86, 0.85)).toBe('red'); // MF=0.85 means any rho>0.85 is red
    });

    it('orange in the margin (monitoringFactor - 0.05, monitoringFactor]', () => {
        expect(render(0.91, 0.95)).toBe('orange');
        expect(render(0.81, 0.85)).toBe('orange');
    });

    it('green when rho ≤ monitoringFactor - 0.05', () => {
        expect(render(0.5, 0.95)).toBe('green');
        expect(render(0.5, 0.85)).toBe('green');
    });

    it('grey for non-convergent or islanded actions', () => {
        const pins = buildActionOverviewPins(
            { a: makeAction({ max_rho: 0.5, non_convergence: 'DIV' }) },
            meta, 0.95,
        );
        expect(pins[0]?.severity).toBe('grey');
    });
});

// ---------------------------------------------------------------------
// Invariant 2 — combined-pair dashed lines render only for simulated pairs
// ---------------------------------------------------------------------

describe('Layer 4 invariant — combined pairs filter estimated-only entries', () => {
    const meta = makeMeta();
    const unitary: ActionPinInfo[] = [
        { id: 'disco_LINE_AB', x: 50, y: 0, severity: 'green', label: '50%', title: '' },
        { id: 'reco_LINE_BC', x: 75, y: 50, severity: 'orange', label: '92%', title: '' },
    ];

    it('renders a curve for a SIMULATED combined pair', () => {
        // Simulated pairs LIVE IN `actions` with is_estimated: false.
        const combined = buildCombinedActionPins({
            'disco_LINE_AB+reco_LINE_BC': makeAction({
                max_rho: 0.7, is_estimated: false,
            }),
        }, unitary, 0.95);
        expect(combined).toHaveLength(1);
        expect(combined[0].pairId).toBe('disco_LINE_AB+reco_LINE_BC');
    });

    it('contract: React segregates estimated pairs into result.combined_actions (not result.actions)', () => {
        // This invariant is STRUCTURAL on the React side: the
        // recommender's estimated-only pairs are stored under
        // `combined_actions`, which `buildCombinedActionPins` does
        // NOT iterate.  So an estimated-only entry can only sneak
        // in if someone mis-merges it into `actions`.  We encode
        // the invariant by constructing a crossover scenario and
        // verifying the function's contract holds at runtime.
        const crossoverActions = {
            'disco_LINE_AB+reco_LINE_BC': makeAction({
                max_rho: 0.85,
                is_estimated: true, // shouldn't normally land here, but if it does…
            }),
        };
        const combined = buildCombinedActionPins(crossoverActions, unitary, 0.95);
        // React's implementation doesn't filter is_estimated, because
        // the storage separation is the guard.  The PYTHON Layer-4
        // check ensures the standalone (which DOES flatten both into
        // result.actions) has an explicit filter.  Document that
        // difference here so future readers don't add a filter to
        // React and quietly hide real simulated pairs:
        expect(combined).toHaveLength(1);
    });
});

// ---------------------------------------------------------------------
// Invariant 3 — pin resolver is topology-first, max_rho_line is last-resort
// ---------------------------------------------------------------------

describe('Layer 4 invariant — pin anchor uses topology before max_rho_line', () => {
    const meta = makeMeta();

    it('prefers topology target (LINE_AB) over max_rho_line (LINE_BC)', () => {
        // An action that DISCONNECTS LINE_AB but whose post-action
        // max_rho ends up on LINE_BC.  The pin must anchor on
        // LINE_AB's midpoint (the asset the operator acts on),
        // not on LINE_BC.
        const detail = makeAction({
            action_topology: {
                lines_ex_bus: { LINE_AB: -1 },
                lines_or_bus: {}, gens_bus: {}, loads_bus: {},
            },
            max_rho_line: 'LINE_BC',
        });
        const anchor = resolveActionAnchor('disco_LINE_AB', detail, meta);
        // LINE_AB midpoint = (0,0) + (100,0) / 2 = (50, 0)
        expect(anchor).toEqual({ x: 50, y: 0 });
    });

    it('falls back to max_rho_line when the action has no resolvable topology target', () => {
        const detail = makeAction({
            // Neither topology nor action-id hints resolve to an edge.
            action_topology: undefined,
            description_unitaire: '',
            max_rho_line: 'LINE_BC',
        });
        const anchor = resolveActionAnchor('opaque_action_id', detail, meta);
        // LINE_BC midpoint = (100,0) + (50,100) / 2 = (75, 50)
        expect(anchor).toEqual({ x: 75, y: 50 });
    });
});

// ---------------------------------------------------------------------
// Invariant 4 — load-shedding / curtailment actions anchor on affected VL
// ---------------------------------------------------------------------

describe('Layer 4 invariant — load-shedding anchors on affected VL, not max_rho_line', () => {
    const meta = makeMeta();

    it('uses load_shedding_details[].voltage_level_id as the primary anchor', () => {
        const detail = makeAction({
            load_shedding_details: [
                { load_name: 'LOAD_1', voltage_level_id: 'VL_C', shedded_mw: 5 },
            ],
            max_rho_line: 'LINE_AB',
        });
        const anchor = resolveActionAnchor('load_shedding_LOAD_1', detail, meta);
        expect(anchor).toEqual({ x: 50, y: 100 }); // VL_C's coords
    });
});
