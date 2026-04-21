// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect } from 'vitest';
import {
    classifyActionType,
    matchesActionTypeFilter,
    ACTION_TYPE_FILTER_TOKENS,
} from './actionTypes';

describe('classifyActionType', () => {
    it('classifies line disconnection actions from their score-table type', () => {
        expect(classifyActionType('disco_LINE_A', null, 'line_disconnection')).toBe('disco');
    });

    it('classifies line reconnection actions from "reco_" prefix / description', () => {
        expect(classifyActionType('reco_LINE_A', 'Fermeture de la ligne', 'line_reconnection')).toBe('reco');
    });

    it('classifies open coupling actions', () => {
        expect(classifyActionType('open_coupling_VL_A', null, 'open_coupling')).toBe('open');
    });

    it('classifies close coupling actions', () => {
        expect(classifyActionType('close_coupling_VL_A', null, 'close_coupling')).toBe('close');
    });

    it('classifies "Ouverture du poste X" as OPEN coupling (not disco)', () => {
        // Description-only classification: couplings take precedence
        // over the desc-based disco check so "Ouverture du poste"
        // doesn't fall into the line-disconnection bucket.
        expect(classifyActionType('some_id', "Ouverture du poste 'VL_FAR'", null)).toBe('open');
    });

    it('classifies "Fermeture du poste X" as CLOSE coupling (not reco)', () => {
        expect(classifyActionType('some_id', "Fermeture du poste 'VL_FAR'", null)).toBe('close');
    });

    it('classifies "Ouverture de la ligne X" as DISCO', () => {
        expect(classifyActionType('some_id', "Ouverture de la ligne 'LINE_A'", null)).toBe('disco');
    });

    it('classifies open-coupling via the id even when desc is empty', () => {
        expect(classifyActionType('open_coupling_VL_A', null, null)).toBe('open');
    });

    it('classifies node_merging_* as CLOSE coupling (id-based)', () => {
        // Regression: node_merging actions carry no "close_coupling"
        // or "fermeture" token — they used to fall into 'unknown'
        // and disappear when the CLOSE chip was active.
        expect(classifyActionType('node_merging_PYMONP3', null, null)).toBe('close');
        expect(classifyActionType('node_merging_PYMONP3', 'No description available', null)).toBe('close');
    });

    it('classifies node_splitting_* as OPEN coupling (id-based)', () => {
        expect(classifyActionType('node_splitting_VL_X', null, null)).toBe('open');
    });

    it('classifies node_merging/node_splitting from the score-table type too', () => {
        expect(classifyActionType('xyz', null, 'node_merging')).toBe('close');
        expect(classifyActionType('xyz', null, 'node_splitting')).toBe('open');
    });

    it('classifies PST tap changes — and DOES NOT mis-bucket "PST" inside a coupling description', () => {
        expect(classifyActionType('pst_PST_X', 'PST tap change', 'pst_tap_change')).toBe('pst');
        // coupling description that mentions PST must still be open/close
        expect(classifyActionType('open_coupling_VL_A', "PST d'origine du poste", 'open_coupling')).toBe('open');
    });

    it('classifies load shedding from id / description / type', () => {
        expect(classifyActionType('load_shedding_LOAD_X', 'load shedding', 'load_shedding')).toBe('ls');
    });

    it('classifies renewable curtailment from open_gen / renewable_curtailment type', () => {
        expect(classifyActionType('rc_GEN_X', null, 'renewable_curtailment')).toBe('rc');
        expect(classifyActionType('rc_GEN_X', null, 'open_gen')).toBe('rc');
    });

    it('falls back to "unknown" when no signal matches', () => {
        expect(classifyActionType('mystery_action', 'floats', 'weird_type')).toBe('unknown');
    });

    it('uses description "Ouverture" as a disco signal when type is missing', () => {
        expect(classifyActionType('mystery', "Ouverture de la ligne 'LINE_A'", null)).toBe('disco');
    });
});

describe('matchesActionTypeFilter', () => {
    it('all matches everything, including unknown', () => {
        expect(matchesActionTypeFilter('all', 'mystery', 'floats', null)).toBe(true);
        expect(matchesActionTypeFilter('all', 'disco_LINE_A', null, 'line_disconnection')).toBe(true);
    });

    it('specific filter only matches its bucket', () => {
        expect(matchesActionTypeFilter('disco', 'disco_LINE_A', null, 'line_disconnection')).toBe(true);
        expect(matchesActionTypeFilter('reco', 'disco_LINE_A', null, 'line_disconnection')).toBe(false);
    });

    it('specific filter does NOT match unknown bucket actions', () => {
        expect(matchesActionTypeFilter('disco', 'mystery', 'floats', null)).toBe(false);
    });
});

describe('ACTION_TYPE_FILTER_TOKENS', () => {
    it('lists all eight chip tokens in display order', () => {
        expect(ACTION_TYPE_FILTER_TOKENS).toEqual(['all', 'disco', 'reco', 'ls', 'rc', 'open', 'close', 'pst']);
    });
});
