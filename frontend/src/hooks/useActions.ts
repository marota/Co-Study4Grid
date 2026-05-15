// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { useState, useCallback, useMemo, type Dispatch, type SetStateAction } from 'react';
import type { ActionDetail, AnalysisResult } from '../types';
import { interactionLogger } from '../utils/interactionLogger';

export interface ActionsState {
  selectedActionIds: Set<string>;
  setSelectedActionIds: Dispatch<SetStateAction<Set<string>>>;
  manuallyAddedIds: Set<string>;
  setManuallyAddedIds: Dispatch<SetStateAction<Set<string>>>;
  rejectedActionIds: Set<string>;
  setRejectedActionIds: Dispatch<SetStateAction<Set<string>>>;
  suggestedByRecommenderIds: Set<string>;
  setSuggestedByRecommenderIds: Dispatch<SetStateAction<Set<string>>>;

  handleActionFavorite: (actionId: string, setResult: Dispatch<SetStateAction<AnalysisResult | null>>) => void;
  handleActionReject: (actionId: string) => void;
  handleManualActionAdded: (
    actionId: string,
    detail: ActionDetail,
    linesOverloaded: string[],
    setResult: Dispatch<SetStateAction<AnalysisResult | null>>,
    onSelectAction: (actionId: string) => void,
    /**
     * Provenance stamped on the new action card. Defaults to `"user"`
     * (manual search dropdown / "Make a first guess"). The
     * unsimulated-pin path passes the recommender model id instead,
     * because that pin was scored by the model — the operator only
     * triggered its materialisation.
     */
    origin?: string,
  ) => void;
  handleActionResimulated: (
    actionId: string,
    detail: ActionDetail,
    linesOverloaded: string[],
    setResult: Dispatch<SetStateAction<AnalysisResult | null>>,
    onSelectAction: (actionId: string) => void,
  ) => void;
  clearActionState: () => void;
}

export function useActions(): ActionsState {
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [manuallyAddedIds, setManuallyAddedIds] = useState<Set<string>>(new Set());
  const [rejectedActionIds, setRejectedActionIds] = useState<Set<string>>(new Set());
  const [suggestedByRecommenderIds, setSuggestedByRecommenderIds] = useState<Set<string>>(new Set());

  const handleActionFavorite = useCallback((actionId: string, setResult: React.Dispatch<React.SetStateAction<AnalysisResult | null>>) => {
    interactionLogger.record('action_favorited', { action_id: actionId });
    setSelectedActionIds(prev => {
      const next = new Set(prev);
      next.add(actionId);
      return next;
    });
    setResult(prev => {
      if (!prev || !prev.actions[actionId]) return prev;
      return {
        ...prev,
        actions: {
          ...prev.actions,
          [actionId]: { ...prev.actions[actionId], is_manual: true }
        }
      };
    });
    setRejectedActionIds(prev => {
      const next = new Set(prev);
      next.delete(actionId);
      return next;
    });
  }, []);

  const handleActionReject = useCallback((actionId: string) => {
    interactionLogger.record('action_rejected', { action_id: actionId });
    setRejectedActionIds(prev => {
      const next = new Set(prev);
      next.add(actionId);
      return next;
    });
    setSelectedActionIds(prev => {
      const next = new Set(prev);
      next.delete(actionId);
      return next;
    });
    setManuallyAddedIds(prev => {
      const next = new Set(prev);
      next.delete(actionId);
      return next;
    });
  }, []);

  const handleManualActionAdded = useCallback((
    actionId: string,
    detail: ActionDetail,
    _linesOverloaded: string[],
    setResult: React.Dispatch<React.SetStateAction<AnalysisResult | null>>,
    onSelectAction: (actionId: string) => void,
    origin: string = 'user',
  ) => {
    interactionLogger.record('manual_action_simulated', { action_id: actionId });
    setResult(prev => {
      const base = prev || {
        pdf_path: null,
        pdf_url: null,
        actions: {},
        lines_overloaded: [],
        message: '',
        dc_fallback: false,
      };
      // ``_linesOverloaded`` is the manual-simulation backend response's
      // ``lines_overloaded`` field. It carries grid2op's synthetic
      // ``line_<i>`` names when the user hits "+ Manual Selection"
      // before running analysis (no ``_analysis_context``; backend
      // falls through to the vectorised obs-based path). Keeping
      // ``lines_overloaded`` empty in that case lets ``App.tsx`` fall
      // back to ``n1Diagram.lines_overloaded`` — the authoritative
      // pypowsybl-style identifier list — for the card display.
      // Step1 / session reload set it on their own setResult paths.
      //
      // ``origin`` is preserved if the action already exists with one
      // (e.g. re-adding a recommender suggestion the operator pulled
      // into the feed) — the first provenance wins.
      const existing = base.actions[actionId];
      return {
        ...base,
        actions: {
          ...base.actions,
          [actionId]: { ...detail, is_manual: true, origin: existing?.origin ?? origin },
        },
      };
    });

    setSelectedActionIds(prev => new Set(prev).add(actionId));
    setManuallyAddedIds(prev => new Set(prev).add(actionId));
    onSelectAction(actionId);
  }, []);

  // Re-simulating an existing action (e.g. editing the Target MW of a
  // suggested load-shedding card and clicking "Re-simulate") must update
  // the action's details in place WITHOUT promoting it into the Selected
  // Actions list — otherwise a still-suggested action would silently jump
  // into the selected bucket on every edit. We still trigger onSelectAction
  // so the action-variant diagram is refetched for the new state.
  const handleActionResimulated = useCallback((
    actionId: string,
    detail: ActionDetail,
    _linesOverloaded: string[],
    setResult: React.Dispatch<React.SetStateAction<AnalysisResult | null>>,
    onSelectAction: (actionId: string) => void,
  ) => {
    // NOTE: re-simulation events (action_mw_resimulated /
    // pst_tap_resimulated) are logged at the call site in
    // ActionFeed.tsx so the logger can capture the user-edited
    // target value (MW or tap). This hook used to also log
    // 'manual_action_simulated' which conflated the two flows
    // and made replay impossible — the log entry now lives next
    // to the actual button click instead.
    //
    // ``_linesOverloaded`` (the manual-sim response array) is
    // intentionally NOT promoted to ``prev.lines_overloaded`` —
    // see ``handleManualActionAdded`` for the rationale (the
    // backend emits grid2op's synthetic ``line_<i>`` names when
    // no analysis context has been set yet).
    setResult(prev => {
      if (!prev) return prev;
      const existing = prev.actions[actionId];
      return {
        ...prev,
        actions: {
          ...prev.actions,
          // Preserve the is_manual flag AND the origin from the
          // existing entry — re-simulation changes the metrics, never
          // the provenance: a recommender-suggested action stays
          // recommender-suggested, a user action stays a user action.
          [actionId]: {
            ...detail,
            is_manual: existing?.is_manual ?? false,
            origin: existing?.origin ?? detail.origin ?? 'user',
          },
        },
      };
    });
    onSelectAction(actionId);
  }, []);

  const clearActionState = useCallback(() => {
    setSelectedActionIds(new Set());
    setManuallyAddedIds(new Set());
    setRejectedActionIds(new Set());
    setSuggestedByRecommenderIds(new Set());
  }, []);

  return useMemo(() => ({
    selectedActionIds, setSelectedActionIds,
    manuallyAddedIds, setManuallyAddedIds,
    rejectedActionIds, setRejectedActionIds,
    suggestedByRecommenderIds, setSuggestedByRecommenderIds,
    handleActionFavorite,
    handleActionReject,
    handleManualActionAdded,
    handleActionResimulated,
    clearActionState,
  }), [
    selectedActionIds, manuallyAddedIds, rejectedActionIds, suggestedByRecommenderIds,
    handleActionFavorite, handleActionReject, handleManualActionAdded, handleActionResimulated, clearActionState
  ]);
}
