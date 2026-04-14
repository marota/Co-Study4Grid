// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

/**
 * Compute the list of overloaded line IDs that should receive an
 * orange halo on the N-1 tab.
 *
 * Source priority:
 *   1. `analysisOverloads` — populated once an action analysis has run
 *      (`result.lines_overloaded`). When non-empty, this list wins.
 *   2. `n1DiagramOverloads` — what the backend reports along with the
 *      N-1 diagram fetch (`n1Diagram.lines_overloaded`). This is the
 *      EARLY source: it is available as soon as the user picks a
 *      contingency, so the orange halos must show up immediately on
 *      the N-1 view — without waiting for the user to run "Analyze &
 *      Suggest". The previous implementation forgot this fallback,
 *      which made the N-1 overload halos disappear until after a
 *      remedial-action simulation had populated `result`.
 *
 * In both cases the user's `selectedOverloads` set (from the Overloads
 * panel) further filters the list down — when the set is empty the
 * filter is a no-op (empty selection means "no explicit selection
 * yet", not "highlight nothing").
 */
export function computeN1OverloadHighlights(
  analysisOverloads: string[] | undefined | null,
  n1DiagramOverloads: string[] | undefined | null,
  selectedOverloads: Set<string>,
): string[] {
  const source = (analysisOverloads && analysisOverloads.length > 0)
    ? analysisOverloads
    : (n1DiagramOverloads || []);
  if (selectedOverloads.size === 0) return [...source];
  return source.filter(name => selectedOverloads.has(name));
}
