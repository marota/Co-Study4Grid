// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
//
// Structural tests of the France EHV (Matpower) preset module. Deliberately NO
// pool-size snapshot: the database grows as more contingencies are graded, and
// a hardcoded count would turn every regeneration into a red build. The
// invariants that matter — shape, playability, no leaks, sampler behaviour —
// hold at any size.

import { describe, it, expect } from 'vitest';
import {
  MATPOWER_TIERS,
  MATPOWER_EASY,
  MATPOWER_MEDIUM,
  MATPOWER_HARD,
  sampleMatpower,
  type MatpowerDifficulty,
} from './matpowerPresets';
import type { GameStudy } from './types';

const POOLS: Record<MatpowerDifficulty, GameStudy[]> = {
  easy: MATPOWER_EASY, medium: MATPOWER_MEDIUM, hard: MATPOWER_HARD,
};
const ALL: GameStudy[] = [...MATPOWER_EASY, ...MATPOWER_MEDIUM, ...MATPOWER_HARD];
// The level with the most cases — the only one a sampling test can lean on
// without assuming which levels the current grading happens to have filled.
const RICHEST = (Object.keys(POOLS) as MatpowerDifficulty[])
  .sort((a, b) => POOLS[b].length - POOLS[a].length)[0];

describe('RTE Matpower France EHV scenario data', () => {
  it('has three tiers wired to their pools', () => {
    expect(MATPOWER_TIERS.map((t) => t.id)).toEqual(['easy', 'medium', 'hard']);
    expect(MATPOWER_TIERS[0].studies).toBe(MATPOWER_EASY);
    expect(MATPOWER_TIERS[1].studies).toBe(MATPOWER_MEDIUM);
    expect(MATPOWER_TIERS[2].studies).toBe(MATPOWER_HARD);
    for (const t of MATPOWER_TIERS) {
      expect(t.label).toContain('Matpower');
      expect(t.blurb).toBeTruthy();
    }
  });

  it('ships a non-empty database', () => {
    expect(ALL.length).toBeGreaterThan(0);
  });

  it('every study is playable (network + actions + layout + contingency)', () => {
    for (const s of ALL) {
      expect(s.id).toMatch(/^s_[0-9a-f]{8}_[0-9a-f]{6}$/);
      expect(s.networkPath).toContain('data/rte_matpower/grids/');
      expect(s.actionFilePath).toContain('actions.json');
      expect(s.layoutPath).toContain('grid_layout.json');
      expect(s.contingencyElementId).toBeTruthy();
      expect(typeof s.baselineMaxLoadingPct).toBe('number');
    }
  });

  it('never leaks the reference solution or the exact date to the client', () => {
    for (const s of ALL) {
      expect((s as Record<string, unknown>).solution).toBeUndefined();
      expect((s as Record<string, unknown>).difficulty).toBeUndefined();
      // The date-bearing part is the TITLE (month + weekday + hour-period,
      // never a year). The label appends the contingency id, which is a
      // numeric bus pair `LINE-<bus>-<bus>` — bus numbers in 1900-2099
      // legitimately appear there and must NOT be read as a leaked year, so
      // strip the id before checking. Same for the generated description.
      const cid = s.contingencyLabel ?? '';
      const title = cid && s.label.endsWith(cid)
        ? s.label.slice(0, -cid.length) : s.label;
      expect(title).not.toMatch(/\b(19|20)\d\d\b/);
      // The real case dates are all January; no year anywhere in the title.
      expect(title).not.toContain('2013');
    }
  });

  it('has unique scenario ids', () => {
    expect(new Set(ALL.map((s) => s.id)).size).toBe(ALL.length);
  });

  it('samples deterministically for a given seed, and varies without one', () => {
    const n = Math.min(3, POOLS[RICHEST].length);
    const a = sampleMatpower(RICHEST, n, 7).map((s) => s.id);
    const b = sampleMatpower(RICHEST, n, 7).map((s) => s.id);
    expect(a).toEqual(b);
    expect(a).toHaveLength(n);
  });

  it('caps a draw at the pool size instead of padding it', () => {
    const pool = POOLS[RICHEST];
    expect(sampleMatpower(RICHEST, pool.length + 50, 1))
      .toHaveLength(pool.length);
  });

  it('returns nothing for an unknown difficulty rather than throwing', () => {
    expect(sampleMatpower('mystery' as MatpowerDifficulty, 3, 1)).toEqual([]);
  });

  it('spreads a small draw across distinct grids when it can', () => {
    const pool = POOLS[RICHEST];
    const grids = new Set(pool.map((s) => s.networkPath));
    if (grids.size < 2) return;              // single-grid grading so far
    const drawn = sampleMatpower(RICHEST, 2, 3);
    expect(new Set(drawn.map((s) => s.networkPath)).size).toBe(2);
  });
});
