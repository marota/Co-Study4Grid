// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { useState, useEffect, useCallback, useMemo, useRef, type Dispatch, type SetStateAction, type MutableRefObject } from 'react';
import type { ActionDetail, AnalysisResult, TabId } from '../types';
import { interactionLogger } from '../utils/interactionLogger';

export interface AnalysisState {
  result: AnalysisResult | null;
  setResult: Dispatch<SetStateAction<AnalysisResult | null>>;
  pendingAnalysisResult: AnalysisResult | null;
  setPendingAnalysisResult: (v: AnalysisResult | null) => void;
  analysisLoading: boolean;
  setAnalysisLoading: (v: boolean) => void;
  infoMessage: string;
  setInfoMessage: (v: string) => void;
  error: string;
  setError: (v: string) => void;

  // Analysis flow
  selectedOverloads: Set<string>;
  setSelectedOverloads: (v: Set<string>) => void;
  monitorDeselected: boolean;
  setMonitorDeselected: (v: boolean) => void;

  // Ref to previous result for merge logic
  prevResultRef: MutableRefObject<AnalysisResult | null>;

  handleRunAnalysis: (
    selectedBranch: string,
    clearContingencyState: () => void,
    setSuggestedByRecommenderIds: Dispatch<SetStateAction<Set<string>>>,
    setActiveTab?: (tab: TabId) => void
  ) => Promise<void>;
  handleDisplayPrioritizedActions: (selectedActionIds: Set<string>) => void;
  handleToggleOverload: (overload: string) => void;
}

export function useAnalysis(): AnalysisState {
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const prevResultRef = useRef<AnalysisResult | null>(result);
  useEffect(() => { prevResultRef.current = result; }, [result]);

  const [pendingAnalysisResult, setPendingAnalysisResult] = useState<AnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (infoMessage) {
      const timer = setTimeout(() => { setInfoMessage(''); }, 3000);
      return () => clearTimeout(timer);
    }
  }, [infoMessage]);

  // Analysis flow
  const [selectedOverloads, setSelectedOverloads] = useState<Set<string>>(new Set());
  const [monitorDeselected, setMonitorDeselected] = useState(false);

  const handleRunAnalysis = useCallback(async (
    selectedBranch: string,
    clearContingencyState: () => void,
    setSuggestedByRecommenderIds: (fn: (prev: Set<string>) => Set<string>) => void,
    setActiveTab?: (tab: TabId) => void
  ) => {
    if (!selectedBranch) return;
    clearContingencyState();
    setAnalysisLoading(true);
    setError('');
    setInfoMessage('');

    const step1CorrId = interactionLogger.record('analysis_step1_started', { element: selectedBranch });
    const step1StartTs = new Date().toISOString();

    try {
      // Step 1: Detection
      const { api } = await import('../api');
      const res1 = await api.runAnalysisStep1(selectedBranch);
      if (!res1.can_proceed) {
        setError(res1.message || 'Analysis cannot proceed.');
        if (res1.message) setInfoMessage(res1.message);
        setAnalysisLoading(false);
        return;
      }

      interactionLogger.recordCompletion('analysis_step1_completed', step1CorrId, {
        can_proceed: res1.can_proceed,
        overloads_detected: (res1.lines_overloaded || []).length,
      }, step1StartTs);

      const detected = res1.lines_overloaded || [];

      let primaryOverloads: string[] = [];
      if (detected.length > 0) {
        if (selectedOverloads.size > 0) {
          const stillRelevant = detected.filter(name => selectedOverloads.has(name));
          if (stillRelevant.length > 0) {
            primaryOverloads = stillRelevant;
          } else {
            setSelectedOverloads(new Set(detected));
            primaryOverloads = detected;
          }
        } else {
          setSelectedOverloads(new Set(detected));
          primaryOverloads = detected;
        }
      }

      const toResolve = primaryOverloads;

      if (detected.length === 0) {
        setInfoMessage(res1.message || "No overloads detected.");
        setAnalysisLoading(false);
        return;
      }

      // Step 2: Resolution
      const step2CorrId = interactionLogger.record('analysis_step2_started', {
        selected_overloads: toResolve,
        monitor_deselected: monitorDeselected,
      });
      const step2StartTs = new Date().toISOString();
      const response2 = await api.runAnalysisStep2Stream({
        selected_overloads: toResolve,
        all_overloads: detected,
        monitor_deselected: monitorDeselected,
      });

      const reader = response2.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let step2ActionsCount = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const event = JSON.parse(line);
            if (event.type === 'pdf') {
              setResult((p: AnalysisResult | null) => ({
                ...(p || {}),
                pdf_url: event.pdf_url,
                pdf_path: event.pdf_path
              } as AnalysisResult));
              if (setActiveTab) {
                setActiveTab('overflow');
              }
            } else if (event.type === 'result') {
              const actionsWithFlags = { ...event.actions };
              for (const id in actionsWithFlags) {
                const existing = (prevResultRef.current?.actions?.[id] || {}) as Partial<ActionDetail>;
                actionsWithFlags[id] = {
                  ...actionsWithFlags[id],
                  is_manual: false,
                  is_islanded: existing.is_islanded ?? actionsWithFlags[id].is_islanded,
                  estimated_max_rho: existing.estimated_max_rho ?? actionsWithFlags[id].max_rho,
                  estimated_max_rho_line: existing.estimated_max_rho_line ?? actionsWithFlags[id].max_rho_line,
                };
              }
              setSuggestedByRecommenderIds(prev => new Set([...prev, ...Object.keys(actionsWithFlags)]));
              step2ActionsCount = Object.keys(actionsWithFlags).length;
              setPendingAnalysisResult({ ...event, actions: actionsWithFlags });
              if (event.message) setInfoMessage(event.message);
            } else if (event.type === 'error') {
              setError('Analysis failed: ' + event.message);
            }
          } catch {
            // Silent catch for incomplete rows
          }
        }
      }
      interactionLogger.recordCompletion('analysis_step2_completed', step2CorrId, {
        actions_count: step2ActionsCount,
      }, step2StartTs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during analysis.';
      setError(message);
    } finally {
      setAnalysisLoading(false);
    }
  }, [selectedOverloads, monitorDeselected]);

  const handleDisplayPrioritizedActions = useCallback((selectedActionIds: Set<string>) => {
    if (!pendingAnalysisResult) return;
    interactionLogger.record('prioritized_actions_displayed', {
      actions_count: Object.keys(pendingAnalysisResult.actions).length,
    });
    setResult(prev => {
      const manualActionsData: Record<string, ActionDetail> = {};
      if (prev?.actions) {
        for (const [id, data] of Object.entries(prev.actions)) {
          if (selectedActionIds.has(id)) {
            manualActionsData[id] = data;
          }
        }
      }

      const mergedActions = { ...pendingAnalysisResult.actions };
      for (const [id, data] of Object.entries(mergedActions)) {
        const existing = (prev?.actions?.[id] || {}) as Partial<ActionDetail>;
        mergedActions[id] = {
          ...data,
          is_islanded: existing.is_islanded ?? data.is_islanded,
          estimated_max_rho: existing.estimated_max_rho ?? data.estimated_max_rho,
          estimated_max_rho_line: existing.estimated_max_rho_line ?? data.estimated_max_rho_line,
        };
      }

      return {
        ...prev,
        ...pendingAnalysisResult,
        actions: { ...mergedActions, ...manualActionsData },
      };
    });
    setPendingAnalysisResult(null);
  }, [pendingAnalysisResult]);

  const handleToggleOverload = useCallback((overload: string) => {
    interactionLogger.record('overload_toggled', { overload });
    setSelectedOverloads((prev: Set<string>) => {
      const next = new Set(prev);
      if (next.has(overload)) next.delete(overload);
      else next.add(overload);
      return next;
    });
  }, []);

  return useMemo(() => ({
    result, setResult,
    pendingAnalysisResult, setPendingAnalysisResult,
    analysisLoading, setAnalysisLoading,
    infoMessage, setInfoMessage,
    error, setError,
    selectedOverloads, setSelectedOverloads,
    monitorDeselected, setMonitorDeselected,
    prevResultRef,
    handleRunAnalysis,
    handleDisplayPrioritizedActions,
    handleToggleOverload,
  }), [
    result, pendingAnalysisResult, analysisLoading, infoMessage, error,
    selectedOverloads, monitorDeselected,
    handleRunAnalysis, handleDisplayPrioritizedActions, handleToggleOverload,
  ]);
}
