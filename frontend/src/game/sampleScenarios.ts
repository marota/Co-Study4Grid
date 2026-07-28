// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
//
// Shared seeded sampler for the difficulty-graded scenario families (RTE7000
// France THT, RTE Matpower France EHV). Both preset modules are generated, so
// the algorithm lives here rather than being emitted twice by two generators.

import type { GameStudy } from './types';

/**
 * Draw up to `n` scenarios from `pool`, round-robin across distinct grids
 * first so a small sample spans different operating points rather than
 * landing entirely on one snapshot.
 *
 * `seed` omitted -> non-deterministic draw. With a seed the draw is stable
 * across reloads, which is what makes a shared session reproducible.
 */
export function sampleScenarios(
  pool: GameStudy[], n: number, seed?: number,
): GameStudy[] {
  const shuffled = [...pool];
  let s = (seed ?? Math.floor(Math.random() * 2 ** 31)) >>> 0;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const byGrid = new Map<string, GameStudy[]>();
  for (const st of shuffled) {
    const g = st.networkPath;
    if (!byGrid.has(g)) byGrid.set(g, []);
    byGrid.get(g)!.push(st);
  }
  const groups = [...byGrid.values()];
  const ordered: GameStudy[] = [];
  while (groups.some((g) => g.length)) {
    for (const g of groups) { const st = g.pop(); if (st) ordered.push(st); }
  }
  return ordered.slice(0, n);
}
