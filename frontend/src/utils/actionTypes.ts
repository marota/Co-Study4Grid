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

import type { ActionOverviewFilters, ActionTypeFilterToken } from '../types';

/** Canonical chip tokens rendered in the filter row (in display order). */
export const ACTION_TYPE_FILTER_TOKENS: readonly ActionTypeFilterToken[] = [
    'all', 'disco', 'reco', 'ls', 'rc', 'open', 'close', 'pst',
];

/**
 * Default value for the shared `ActionOverviewFilters` object.
 *
 * This is the single source of truth for the filter initial state
 * (App.tsx), the in-component fallback used when legacy call sites
 * do not pass the filters prop (ActionOverviewDiagram), and the
 * merge base used when ActionFeed patches only the `actionType`
 * field through `onOverviewFiltersChange`.
 *
 * Keeping one literal means adding a new field to the filter object
 * requires a single update here.
 */
export const DEFAULT_ACTION_OVERVIEW_FILTERS: ActionOverviewFilters = {
    categories: { green: true, orange: true, red: true, grey: true },
    threshold: 1.5,
    showUnsimulated: false,
    actionType: 'all',
    showCombinedOnly: false,
};

export type { ActionTypeFilterToken };

/** Action-type buckets that own a pictogram (everything except `all`). */
export type ActionTypeKind = Exclude<ActionTypeFilterToken, 'all'>;

/**
 * Human-readable wording for each action-type bucket. Used as the
 * hover tooltip on the uncoloured action-type pictograms (the
 * pictogram itself carries no text — see `ActionTypeIcon`).
 */
export const ACTION_TYPE_LABELS: Record<ActionTypeKind, string> = {
    disco: 'Line disconnection',
    reco: 'Line reconnection',
    open: 'Open coupling',
    close: 'Close coupling',
    ls: 'Load shedding',
    rc: 'Renewable curtailment',
    pst: 'Phase shifter tap',
};

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

    // A two-step classification for couplings vs lines:
    //
    //   1. `isCouplingSignal` — does anything in the id / type /
    //      description say "this operates on a bus coupling"? We
    //      check id tokens (`_coupling`, `busbar`, `node_merging`,
    //      `node_splitting`, `noeud`), score-table types with the
    //      same tokens, AND description markers (`coupl` which
    //      matches both `coupling` and uppercase `COUPL` post-
    //      lowercasing, `busbar`, and the specific French phrasing
    //      `"du poste 'X'"` used when the coupling/poste itself
    //      is the target). The earlier "desc contains 'poste' AND
    //      'ouverture'" rule mis-classified line-opening actions
    //      whose description has `... DJ_OC dans le poste POSTE`
    //      because `dans le poste` also contains the substring
    //      "poste" — regression fix.
    //
    //   2. OPEN/CLOSE/DISCO/RECO buckets are then gated by this
    //      signal: direction heuristics (ouverture/fermeture /
    //      open_* / close_* / node_splitting / node_merging) only
    //      land in the coupling bucket when `isCouplingSignal` is
    //      true, otherwise they land in disco/reco.
    const isCouplingSignal = t.includes('coupling')
        || t.includes('node_merging')
        || t.includes('node_splitting')
        || aid.includes('coupling')
        || aid.includes('busbar')
        || aid.includes('noeud')
        || aid.includes('node_merging')
        || aid.includes('node_splitting')
        || desc.includes('coupl')
        || desc.includes('busbar')
        || /du poste\s+['"]/.test(desc);

    const opensViaSignal = t.includes('open_coupling')
        || aid.includes('open_coupling')
        || aid.includes('node_splitting')
        || t.includes('node_splitting')
        || desc.includes('ouverture');
    const closesViaSignal = t.includes('close_coupling')
        || aid.includes('close_coupling')
        || aid.includes('node_merging')
        || t.includes('node_merging')
        || desc.includes('fermeture');

    const isOpenCoupling = isCouplingSignal && opensViaSignal;
    const isCloseCoupling = isCouplingSignal && closesViaSignal;
    const isDisco = !isCouplingSignal && (
        t.includes('disco') || t.includes('open_line') || t.includes('open_load') || desc.includes('ouverture')
    );
    const isReco = !isCouplingSignal && (
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
