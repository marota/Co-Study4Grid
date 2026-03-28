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
    linesOverloaded: string[],
    setResult: React.Dispatch<React.SetStateAction<AnalysisResult | null>>,
    onSelectAction: (actionId: string) => void,
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
      return {
        ...base,
        lines_overloaded: base.lines_overloaded.length > 0 ? base.lines_overloaded : linesOverloaded,
        actions: {
          ...base.actions,
          [actionId]: { ...detail, is_manual: true },
        },
      };
    });

    setSelectedActionIds(prev => new Set(prev).add(actionId));
    setManuallyAddedIds(prev => new Set(prev).add(actionId));
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
    clearActionState,
  }), [
    selectedActionIds, manuallyAddedIds, rejectedActionIds, suggestedByRecommenderIds,
    handleActionFavorite, handleActionReject, handleManualActionAdded, clearActionState
  ]);
}
