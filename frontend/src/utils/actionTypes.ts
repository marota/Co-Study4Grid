// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

/**
 * Shared action-type classifier + filter tokens.
 *
 * Three call sites need the same taxonomy today:
 *   - ExplorePairsTab (filter chips on the combined-pair explorer),
 *   - ActionOverviewDiagram (filter chips on the pin overview),
 *   - ActionFeed (filter cards in Selected / Suggested / Rejected lists).
 *
 * Keeping the classifier here — and the chip tokens with it — means
 * all three stay in lock-step when a new bucket is added.
 */

import type { ActionTypeFilterToken } from '../types';

/** Canonical chip tokens rendered in the filter row (in display order). */
export const ACTION_TYPE_FILTER_TOKENS: readonly ActionTypeFilterToken[] = [
    'all', 'disco', 'reco', 'ls', 'rc', 'open', 'close', 'pst',
];

export type { ActionTypeFilterToken };

/**
 * Classify an action into one of the filter-token buckets, given
 * any of these signals:
 *   - the action-score `type` key (`line_disconnection`, `pst_tap_change`, …),
 *   - the action's `description_unitaire` (French free-text),
 *   - the action id itself.
 *
 * Heuristics mirror what ActionFeed and ExplorePairsTab already do
 * inline — extracted here so the three filter sites cannot drift.
 */
export const classifyActionType = (
    actionId: string,
    description: string | null | undefined,
    scoreType: string | null | undefined,
): Exclude<ActionTypeFilterToken, 'all'> | 'unknown' => {
    const t = (scoreType ?? '').toLowerCase();
    const aid = actionId.toLowerCase();
    const desc = (description ?? '').toLowerCase();

    // Couplings take precedence: an id / desc like "open_coupling" or
    // "Ouverture du poste" is unambiguously a bus-coupling operation,
    // NOT a line disconnection — even though the description contains
    // "ouverture". Without this precedence the desc-based disco check
    // below would mis-classify them as 'disco'.
    //
    // `node_merging_*` / `node_splitting_*` are coupling actions
    // expressed as node operations (merging two buses = closing the
    // coupling between them; splitting = opening). They carry no
    // `open_coupling` / `close_coupling` token in their id or
    // description, so we match them explicitly here — otherwise they
    // fall through to the `unknown` bucket and disappear when the
    // operator picks the CLOSE / OPEN chip.
    const isOpenCoupling = t.includes('open_coupling')
        || aid.includes('open_coupling')
        || aid.includes('node_splitting')
        || t.includes('node_splitting')
        || (desc.includes('poste') && desc.includes('ouverture'));
    const isCloseCoupling = t.includes('close_coupling')
        || aid.includes('close_coupling')
        || aid.includes('node_merging')
        || t.includes('node_merging')
        || (desc.includes('poste') && desc.includes('fermeture'));
    const isDisco = !isOpenCoupling && (
        t.includes('disco') || t.includes('open_line') || t.includes('open_load') || desc.includes('ouverture')
    );
    const isReco = !isCloseCoupling && (
        t.includes('reco') || t.includes('close_line') || t.includes('close_load') || desc.includes('fermeture')
    );
    // PST / LS / RC classifiers defer to the coupling checks above so
    // a string like "PST" appearing inside a coupling description
    // doesn't flip the bucket.
    const isPstAction = (aid.includes('pst') || desc.includes('pst') || t.includes('pst'))
        && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling;
    const isLoadShedding = (aid.includes('load_shedding') || desc.includes('load shedding') || t.includes('load_shedding'))
        && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling && !isPstAction;
    const isRenewableCurtailment = (t.includes('renewable_curtailment') || t.includes('open_gen'))
        && !isDisco && !isReco && !isOpenCoupling && !isCloseCoupling && !isPstAction && !isLoadShedding;

    if (isDisco) return 'disco';
    if (isReco) return 'reco';
    if (isOpenCoupling) return 'open';
    if (isCloseCoupling) return 'close';
    if (isPstAction) return 'pst';
    if (isLoadShedding) return 'ls';
    if (isRenewableCurtailment) return 'rc';
    return 'unknown';
};

/**
 * True iff the classified bucket for an action matches the active
 * filter token. `all` matches everything; `unknown` matches only
 * when the filter is `all` (no chip for the unknown bucket today).
 */
export const matchesActionTypeFilter = (
    filter: ActionTypeFilterToken,
    actionId: string,
    description: string | null | undefined,
    scoreType: string | null | undefined,
): boolean => {
    if (filter === 'all') return true;
    return classifyActionType(actionId, description, scoreType) === filter;
};
