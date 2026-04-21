// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import './App.css';
import VisualizationPanel from './components/VisualizationPanel';
import ActionFeed from './components/ActionFeed';
import OverloadPanel from './components/OverloadPanel';
import Header from './components/Header';
import SettingsModal from './components/modals/SettingsModal';
import ReloadSessionModal from './components/modals/ReloadSessionModal';
import ConfirmationDialog from './components/modals/ConfirmationDialog';
import type { ConfirmDialogState } from './components/modals/ConfirmationDialog';
import { api } from './api';
import { applyOverloadedHighlights, applyDeltaVisuals, applyActionTargetHighlights, applyContingencyHighlight, processSvg } from './utils/svgUtils';
import { computeN1OverloadHighlights } from './utils/overloadHighlights';
import type { ActionDetail, ActionOverviewFilters, DiagramData, TabId, RecommenderDisplayConfig, UnsimulatedActionScoreInfo } from './types';
import { useSettings } from './hooks/useSettings';
import { useActions } from './hooks/useActions';
import { useAnalysis } from './hooks/useAnalysis';
import { useDiagrams } from './hooks/useDiagrams';
import { useSession } from './hooks/useSession';
import { useDetachedTabs } from './hooks/useDetachedTabs';
import { useTiedTabsSync, type PZInstance } from './hooks/useTiedTabsSync';
import { interactionLogger } from './utils/interactionLogger';

function App() {
  // ===== Settings Hook =====
  const settings = useSettings();
  const {
    // Paths and values used in App-level logic (handleApplySettings, handleLoadConfig, wrappedSaveResults/RestoreSession)
    configFilePath, changeConfigFilePath, lastActiveConfigFilePath,
    networkPath, setNetworkPath, actionPath, setActionPath,
    layoutPath, setLayoutPath, outputFolderPath,
    minLineReconnections, setMinLineReconnections,
    minCloseCoupling, setMinCloseCoupling,
    minOpenCoupling, setMinOpenCoupling,
    minLineDisconnections, setMinLineDisconnections,
    nPrioritizedActions, setNPrioritizedActions,
    minPst, setMinPst,
    minLoadShedding, setMinLoadShedding,
    minRenewableCurtailmentActions, setMinRenewableCurtailmentActions,
    ignoreReconnections, setIgnoreReconnections,
    linesMonitoringPath, setLinesMonitoringPath,
    monitoredLinesCount, totalLinesCount,
    showMonitoringWarning, setShowMonitoringWarning,
    monitoringFactor, setMonitoringFactor,
    preExistingOverloadThreshold, setPreExistingOverloadThreshold,
    pypowsyblFastMode, setPypowsyblFastMode,
    actionDictFileName, actionDictStats,
    setIsSettingsOpen, setSettingsTab,
    pickSettingsPath,
    handleOpenSettings,
    buildConfigRequest, applyConfigResponse, createCurrentBackup, setSettingsBackup
  } = settings;

  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branches, setBranches] = useState<string[]>([]);
  const [voltageLevels, setVoltageLevels] = useState<string[]>([]);
  /** ID → human-readable name for branches (lines + transformers) and VLs. */
  const [nameMap, setNameMap] = useState<Record<string, string>>({});
  const [configLoading, setConfigLoading] = useState(false);
  const [error, setError] = useState('');

  /** Resolve an element or VL ID to its display name. Falls back to the ID. */
  const displayName = useCallback((id: string) => nameMap[id] || id, [nameMap]);

  // ===== Detached Visualization Tabs (must be instantiated BEFORE useDiagrams
  // so that the detached-tabs map can be threaded into useDiagrams → usePanZoom,
  // keeping a detached tab interactive even when it's not the main `activeTab`.)
  const detachedTabsHook = useDetachedTabs({
    onPopupBlocked: () => setError('Popup blocked by the browser. Please allow popups for this site to detach tabs.'),
  });
  const { detachedTabs, detach: detachTab, reattach: reattachTab, focus: focusDetachedTab } = detachedTabsHook;

  const diagrams = useDiagrams(branches, voltageLevels, selectedBranch, detachedTabs);

  // ===== Action Overview PZ (for tied-tab sync) =====
  // The action overview has its own independent usePanZoom instance
  // (it renders the N-1 NAD as a background with pins).  We need to
  // include it in the tie system so that when the action tab is
  // detached and showing the overview (no selectedActionId), zoom /
  // focus changes are mirrored to the main window.
  //
  // This MUST be React state (not a ref) so that when the overview's
  // viewBox changes inside ActionOverviewDiagram, the new PZ instance
  // propagates up to App via the onPzChange callback, triggering a
  // re-render.  That re-render updates `actionVb` inside
  // useTiedTabsSync's deps, letting it detect the change and mirror
  // it to the main window.  A ref would silently hold the new value
  // without triggering the sync hook — making detached→main sync
  // one-directional.
  const [overviewPz, setOverviewPz] = useState<PZInstance | null>(null);
  const handleOverviewPzChange = useCallback((pz: PZInstance) => {
    setOverviewPz(pz);
  }, []);

  // When the overview is visible (no selected action), use its PZ
  // for the 'action' slot in the tie map.  Otherwise fall back to
  // the action-variant diagram's PZ.
  const actionPZForTie = (!diagrams.selectedActionId && overviewPz)
    ? overviewPz
    : diagrams.actionPZ;

  // ===== Tied Detached Tabs =====
  // When a detached tab is "tied", its viewBox is mirrored one-way
  // into the main window's active tab on every pan/zoom change —
  // supporting side-by-side comparison workflows. See
  // docs/features/detachable-viz-tabs.md#tied-detached-tabs for the full
  // design rationale.
  const tiedTabsHook = useTiedTabsSync(
    { 'n': diagrams.nPZ, 'n-1': diagrams.n1PZ, 'action': actionPZForTie },
    diagrams.activeTab,
    detachedTabs,
  );
  const { isTied: isTabTied, toggleTie: toggleTabTie } = tiedTabsHook;

  // Confirmation dialog state for contingency change / load study /
  // apply settings / change network path.
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);

  // Path of the network file the currently-loaded study was loaded from.
  // Updated after every successful handleLoadConfig / applySettings, used
  // by requestNetworkPathChange to detect "user is switching to a
  // different network while a study is already loaded" and prompt for
  // confirmation before silently dropping the in-flight work.
  const committedNetworkPathRef = useRef('');

  // ===== Hook integrations =====
  const actionsHook = useActions();
  const {
    selectedActionIds, manuallyAddedIds, rejectedActionIds, suggestedByRecommenderIds
  } = actionsHook;

  const analysis = useAnalysis();
  const {
    result, setResult, pendingAnalysisResult, analysisLoading,
    infoMessage, selectedOverloads, monitorDeselected
  } = analysis;

  const {
    activeTab, nDiagram, n1Diagram, n1Loading,
    selectedActionId, actionDiagram, actionDiagramLoading, actionViewMode,
    inspectQuery, uniqueVoltages, voltageRange,
    vlOverlay, handleViewModeChange, handleManualZoomIn, handleManualZoomOut,
    handleManualReset, handleVlDoubleClick, handleOverlaySldTabChange, handleOverlayClose,
    inspectableItems,
    nSvgContainerRef, n1SvgContainerRef, actionSvgContainerRef
  } = diagrams;

  // When a pin on the overview is single-clicked we want the sidebar
  // action feed to scroll to the matching card without selecting it
  // (which would drill into the action-variant view).  This counter-
  // based state lets ActionFeed react on every click even if the same
  // pin is tapped twice in a row (a plain id string would not trigger
  // a re-render on the second identical value).
  const [scrollTarget, setScrollTarget] = useState<{ id: string; seq: number } | null>(null);
  const scrollSeqRef = useRef(0);
  const handlePinPreview = useCallback((actionId: string) => {
    scrollSeqRef.current += 1;
    setScrollTarget({ id: actionId, seq: scrollSeqRef.current });
  }, []);

  // Shared filter state for the Remedial Action overview. The same
  // `ActionOverviewFilters` drives (a) the pin visibility + dimmed
  // un-simulated pins on ActionOverviewDiagram and (b) the card
  // visibility in the sidebar ActionFeed, so both views stay in
  // lock-step regardless of which entry point the operator uses.
  const [overviewFilters, setOverviewFilters] = useState<ActionOverviewFilters>({
    categories: { green: true, orange: true, red: true, grey: true },
    threshold: 1.5,
    showUnsimulated: false,
  });

  // Flat list of action ids that appear in `action_scores` but are
  // not yet simulated. Feeds ActionOverviewDiagram's un-simulated pin
  // layer. We dedupe across action_scores.<type>.scores to avoid
  // pinning the same id twice. Computed alongside `unsimulatedActionInfo`
  // so the two structures always stay in sync.
  const { unsimulatedActionIds, unsimulatedActionInfo } = useMemo(() => {
    const scores = analysis.result?.action_scores;
    if (!scores) return { unsimulatedActionIds: [] as string[], unsimulatedActionInfo: {} as Record<string, UnsimulatedActionScoreInfo> };
    const simulated = new Set(Object.keys(analysis.result?.actions ?? {}));
    const ids: string[] = [];
    const info: Record<string, UnsimulatedActionScoreInfo> = {};
    const seen = new Set<string>();
    for (const [type, rawData] of Object.entries(scores)) {
      const data = rawData as {
        scores?: Record<string, number>;
        mw_start?: Record<string, number | null>;
        tap_start?: Record<string, { pst_name: string; tap: number; low_tap: number | null; high_tap: number | null } | null>;
      };
      const per = data.scores ?? {};
      const mwStartMap = data.mw_start ?? {};
      const tapStartMap = data.tap_start ?? {};
      // Rank is assigned by descending score so the operator sees
      // the top-scoring un-simulated candidate as "rank 1".
      const rankedEntries = Object.entries(per).sort(([, a], [, b]) => b - a);
      const maxScoreInType = rankedEntries.length > 0 ? rankedEntries[0][1] : 0;
      const countInType = rankedEntries.length;
      for (let i = 0; i < rankedEntries.length; i++) {
        const [id, score] = rankedEntries[i];
        if (simulated.has(id) || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
        info[id] = {
          type,
          score,
          mwStart: mwStartMap[id] ?? null,
          tapStart: tapStartMap[id] ?? null,
          rankInType: i + 1,
          countInType,
          maxScoreInType,
        };
      }
    }
    return { unsimulatedActionIds: ids, unsimulatedActionInfo: info };
  }, [analysis.result?.action_scores, analysis.result?.actions]);

  const contingencyOptions = useMemo(() => {
    const q = selectedBranch.toUpperCase();
    const opts: string[] = [];
    if (!q) {
      opts.push(...branches.slice(0, 50));
    } else {
      for (const b of branches) {
        const name = nameMap[b] || '';
        if (b.toUpperCase().includes(q) || name.toUpperCase().includes(q)) {
          opts.push(b);
          if (opts.length >= 50) break;
        }
      }
    }
    // Show "DisplayName (ID)" as the visible label so the user sees real names,
    // while `value` stays the raw ID that gets submitted.
    return opts.map(b => {
      const name = nameMap[b];
      return <option key={b} value={b} label={name ? `${name}  —  ${b}` : b} />;
    });
  }, [branches, selectedBranch, nameMap]);

  const recommenderConfig = useMemo<RecommenderDisplayConfig>(() => ({
    minLineReconnections, minCloseCoupling, minOpenCoupling,
    minLineDisconnections, minPst, minLoadShedding,
    minRenewableCurtailmentActions, nPrioritizedActions, ignoreReconnections,
  }), [
    minLineReconnections, minCloseCoupling, minOpenCoupling,
    minLineDisconnections, minPst, minLoadShedding,
    minRenewableCurtailmentActions, nPrioritizedActions, ignoreReconnections,
  ]);

  const session = useSession();
  const {
    showReloadModal, setShowReloadModal, sessionList, sessionListLoading, sessionRestoring
  } = session;

  // ===== Detached Visualization Tabs =====
  // `useDetachedTabs` is instantiated higher up so its map can be passed
  // into `useDiagrams` (see above). Here we wire the detach/reattach
  // callbacks that depend on diagrams (activeTab fallback logic) and
  // the interaction logger.
  const handleDetachTab = useCallback((tabId: TabId) => {
    interactionLogger.record('tab_detached', { tab: tabId });
    const entry = detachTab(tabId);
    // If the user detached the currently-active tab, switch the main
    // window to any other available tab so the main panel doesn't show
    // an empty slot by default. Prefers the first tab that is not itself
    // detached; falls back to 'n' (which is always available).
    if (entry && diagrams.activeTab === tabId) {
      const order: TabId[] = ['n', 'n-1', 'action', 'overflow'];
      const fallback = order.find(t => t !== tabId && !detachedTabs[t]);
      diagrams.setActiveTab(fallback ?? 'n');
    }
  }, [detachTab, diagrams, detachedTabs]);

  const handleReattachTab = useCallback((tabId: TabId) => {
    interactionLogger.record('tab_reattached', { tab: tabId });
    reattachTab(tabId);
  }, [reattachTab]);

  // ===== Cross-Hook Wiring wrappers (all memoized) =====

  // Clear all contingency-related analysis state (preserves network/config)
  const clearContingencyState = useCallback(() => {
    analysis.setResult(null);
    analysis.setPendingAnalysisResult(null);
    analysis.setSelectedOverloads(new Set());
    analysis.setMonitorDeselected(false);
    actionsHook.clearActionState();
    diagrams.setSelectedActionId(null);
    diagrams.setActionDiagram(null);
    // Do NOT reset activeTab to 'n' here — the caller (fetchN1) sets
    // it to 'n-1' immediately. Resetting to 'n' interfered with the
    // auto-zoom effect on the second contingency change.
    diagrams.setVlOverlay(null);
    setError('');
    analysis.setInfoMessage('');
    diagrams.setInspectQuery('');
    // Do NOT reset lastZoomState here.  Resetting it causes the auto-zoom
    // effect to detect a spurious "branch change" during the same render
    // cycle in which the old n1Diagram SVG is still mounted, firing the
    // zoom on stale data and consuming the intent before the new diagram
    // loads.  Leaving lastZoomState intact lets the natural selectedBranch
    // change trigger the zoom correctly after the new SVG is ready.
  }, [setError, actionsHook, analysis, diagrams]);

  // Narrower reset used when re-running the analysis on the SAME
  // contingency. Unlike `clearContingencyState`, this preserves any
  // manually-added ("first guess") actions so they stay in the
  // Selected Actions section through the analysis run — mirroring the
  // standalone interface, which filters result.actions down to the
  // is_manual=true subset on Analyze & Suggest instead of wiping
  // everything.
  //
  // Specifically: keeps manuallyAddedIds, keeps the selected-action
  // set restricted to manually-added IDs, and filters result.actions
  // to the is_manual subset (with pdf / lines_overloaded cleared so
  // the UI correctly shows the "analysis in progress" state).
  const resetForAnalysisRun = useCallback(() => {
    analysis.setResult(prev => {
      if (!prev) return null;
      const manuals: Record<string, import('./types').ActionDetail> = {};
      for (const [id, data] of Object.entries(prev.actions || {})) {
        if (data.is_manual) manuals[id] = data;
      }
      return {
        ...prev,
        actions: manuals,
        lines_overloaded: [],
        pdf_url: null,
        pdf_path: null,
      };
    });
    analysis.setPendingAnalysisResult(null);
    analysis.setMonitorDeselected(false);
    // Keep manuallyAddedIds intact and trim selectedActionIds down
    // to the manually-added subset — that way any favorited
    // recommender suggestions are dropped (the new run will
    // re-emit them) while the user's own "first guess" stays put.
    actionsHook.setSelectedActionIds(prev => {
      const manuallyAdded = actionsHook.manuallyAddedIds;
      const next = new Set<string>();
      for (const id of prev) if (manuallyAdded.has(id)) next.add(id);
      return next;
    });
    actionsHook.setRejectedActionIds(new Set());
    actionsHook.setSuggestedByRecommenderIds(new Set());
    // Don't wipe selectedActionId if it points to a manual action —
    // keep the user's variant diagram around through the re-run.
    const sel = diagrams.selectedActionId;
    if (sel && !actionsHook.manuallyAddedIds.has(sel)) {
      diagrams.setSelectedActionId(null);
      diagrams.setActionDiagram(null);
    }
    diagrams.setVlOverlay(null);
    setError('');
    analysis.setInfoMessage('');
    diagrams.setInspectQuery('');
  }, [setError, actionsHook, analysis, diagrams]);

  // Full reset: contingency state + network/diagram state
  const resetAllState = useCallback(() => {
    clearContingencyState();
    diagrams.setActiveTab('n');
    diagrams.setNDiagram(null);
    diagrams.setN1Diagram(null);
    diagrams.setOriginalViewBox(null);
    diagrams.setActionViewMode('network');
    diagrams.setN1Loading(false);
    diagrams.setActionDiagramLoading(false);
    diagrams.committedBranchRef.current = '';
    diagrams.actionSyncSourceRef.current = null;
    diagrams.lastZoomState.current = { query: '', branch: '' };
    setSelectedBranch('');
    setShowMonitoringWarning(false);
  }, [clearContingencyState, diagrams, setShowMonitoringWarning]);

  const wrappedActionSelect = useCallback(
    (actionId: string | null) =>
      diagrams.handleActionSelect(actionId, result, selectedBranch, voltageLevels.length, setResult, setError),
    [diagrams, result, selectedBranch, voltageLevels.length, setResult, setError]
  );

  // Force-select variant used after a (re)simulation. This skips the
  // "already selected → deselect" toggle path in handleActionSelect so the
  // newly-simulated action diagram is always re-fetched.
  const wrappedForcedActionSelect = useCallback(
    (actionId: string | null) =>
      diagrams.handleActionSelect(actionId, result, selectedBranch, voltageLevels.length, setResult, setError, true),
    [diagrams, result, selectedBranch, voltageLevels.length, setResult, setError]
  );

  const wrappedActionFavorite = useCallback(
    (actionId: string) => actionsHook.handleActionFavorite(actionId, setResult),
    [actionsHook, setResult]
  );

  // Manually-added (first-time simulated) action. Same SLD refresh
  // rationale as `wrappedActionResimulated` below: the new detail
  // carries fresh `load_shedding_details` / `curtailment_details` /
  // `pst_details` arrays which the SLD highlight pass needs to see.
  const wrappedManualActionAdded = useCallback(
    (actionId: string, detail: ActionDetail, linesOverloaded: string[]) => {
      actionsHook.handleManualActionAdded(actionId, detail, linesOverloaded, setResult, wrappedForcedActionSelect);
      diagrams.refreshSldIfAction(actionId);
    },
    [actionsHook, setResult, wrappedForcedActionSelect, diagrams]
  );

  // Double-click on an un-simulated pin in ActionOverviewDiagram —
  // mirrors the Manual Selection flow in ActionFeed but without the
  // editable MW / tap inputs (those aren't available on the overview
  // pin). Uses the diagram-priming streaming endpoint so the
  // subsequent action-variant render is paint-ready instantly, same
  // as the feed add path.
  const handleSimulateUnsimulatedAction = useCallback(
    async (actionId: string) => {
      if (!selectedBranch) {
        setError('Select a contingency first.');
        return;
      }
      try {
        const response = await api.simulateAndVariantDiagramStream({
          action_id: actionId,
          disconnected_element: selectedBranch,
          action_content: null,
          lines_overloaded: result?.lines_overloaded ?? null,
          target_mw: null,
          target_tap: null,
        });
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let metrics: Awaited<ReturnType<typeof api.simulateManualAction>> | null = null;
        let streamErr: string | null = null;
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            // Flush any trailing content that lacked a final \n.
            // Backend always appends \n today, but this guard keeps
            // the path robust if a future change emits a final
            // event without one.
            if (buffer.trim()) {
              try {
                const event = JSON.parse(buffer) as Record<string, unknown>;
                if (event.type === 'metrics') {
                  const { type: _t, ...rest } = event;
                  void _t;
                  metrics = rest as Awaited<ReturnType<typeof api.simulateManualAction>>;
                } else if (event.type === 'diagram') {
                  const { type: _t, ...rest } = event;
                  void _t;
                  diagrams.primeActionDiagram(actionId, rest as unknown as DiagramData, voltageLevels.length);
                } else if (event.type === 'error') {
                  streamErr = (event.message as string) || 'stream error';
                }
              } catch { /* ignore malformed trailing bytes */ }
            }
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop()!;
          for (const line of lines) {
            if (!line.trim()) continue;
            let event: Record<string, unknown>;
            try { event = JSON.parse(line); } catch { continue; }
            if (event.type === 'metrics') {
              const { type: _t, ...rest } = event;
              void _t;
              metrics = rest as Awaited<ReturnType<typeof api.simulateManualAction>>;
            } else if (event.type === 'diagram') {
              const { type: _t, ...rest } = event;
              void _t;
              diagrams.primeActionDiagram(actionId, rest as unknown as DiagramData, voltageLevels.length);
            } else if (event.type === 'error') {
              streamErr = (event.message as string) || 'stream error';
            }
          }
        }
        if (streamErr) throw new Error(streamErr);
        if (!metrics) throw new Error('Stream ended without metrics event');
        const detail: ActionDetail = {
          description_unitaire: metrics.description_unitaire,
          rho_before: metrics.rho_before,
          rho_after: metrics.rho_after,
          max_rho: metrics.max_rho,
          max_rho_line: metrics.max_rho_line,
          is_rho_reduction: metrics.is_rho_reduction,
          is_islanded: metrics.is_islanded,
          n_components: metrics.n_components,
          disconnected_mw: metrics.disconnected_mw,
          non_convergence: metrics.non_convergence,
          lines_overloaded_after: metrics.lines_overloaded_after,
          load_shedding_details: metrics.load_shedding_details,
          curtailment_details: metrics.curtailment_details,
          pst_details: metrics.pst_details,
        };
        wrappedManualActionAdded(actionId, detail, metrics.lines_overloaded || []);
      } catch (e: unknown) {
        console.error('Unsimulated pin simulation failed:', e);
        const err = e as { response?: { data?: { detail?: string } } };
        setError(err?.response?.data?.detail || 'Simulation failed');
      }
    },
    [selectedBranch, result?.lines_overloaded, diagrams, voltageLevels.length, wrappedManualActionAdded]
  );

  // Re-simulation of an already-present action (edit Target MW / tap on a
  // suggested card). Does NOT move the action into the selected bucket.
  //
  // When the SLD overlay is open on this action, refresh it so the
  // per-equipment load-shedding / curtailment / PST highlights (and the
  // flow deltas baked into the backend SLD response) reflect the new
  // simulation result instead of the pre-resimulation snapshot.
  // Covers all three editable action families: MW edits on load-shedding
  // and renewable-curtailment, and tap edits on PST — all three flow
  // through `onActionResimulated` in ActionFeed.tsx, so one refresh
  // hook-up covers them.
  const wrappedActionResimulated = useCallback(
    (actionId: string, detail: ActionDetail, linesOverloaded: string[]) => {
      actionsHook.handleActionResimulated(actionId, detail, linesOverloaded, setResult, wrappedForcedActionSelect);
      diagrams.refreshSldIfAction(actionId);
    },
    [actionsHook, setResult, wrappedForcedActionSelect, diagrams]
  );

  const handleUpdateCombinedEstimation = useCallback(
    (pairId: string, estimation: { estimated_max_rho: number; estimated_max_rho_line: string }) => {
      console.log('[handleUpdateCombinedEstimation] called with pairId:', pairId, 'estimation:', estimation);
      setResult(prev => {
        console.log('[handleUpdateCombinedEstimation] prev combined_actions keys:',
          prev?.combined_actions ? Object.keys(prev.combined_actions) : 'null',
          'pairId exists:', !!prev?.combined_actions?.[pairId]);
        if (!prev?.combined_actions?.[pairId]) return prev;
        return {
          ...prev,
          combined_actions: {
            ...prev.combined_actions,
            [pairId]: { ...prev.combined_actions[pairId], ...estimation },
          },
        };
      });
    },
    [setResult]
  );

  const wrappedRunAnalysis = useCallback(
    () => analysis.handleRunAnalysis(selectedBranch, resetForAnalysisRun, actionsHook.setSuggestedByRecommenderIds, diagrams.setActiveTab),
    [analysis, selectedBranch, resetForAnalysisRun, actionsHook.setSuggestedByRecommenderIds, diagrams.setActiveTab]
  );

  const wrappedDisplayPrioritized = useCallback(
    () => analysis.handleDisplayPrioritizedActions(selectedActionIds, diagrams.setActiveTab),
    [analysis, selectedActionIds, diagrams.setActiveTab]
  );

  const wrappedAssetClick = useCallback(
    (actionId: string, assetName: string, tab: 'action' | 'n' | 'n-1' = 'action') =>
      diagrams.handleAssetClick(actionId, assetName, tab, diagrams.selectedActionId, wrappedActionSelect),
    [diagrams, wrappedActionSelect]
  );

  // Zoom the currently-active diagram tab on a named asset without
  // switching tabs. Used by the sticky Contingency and Overloads
  // sections: operators want to keep the view they're on (N / N-1 /
  // Action) and just focus the clicked line in place.
  const handleZoomOnActiveTab = useCallback((assetName: string) => {
    if (!assetName) return;
    const tab = diagrams.activeTab;
    if (tab === 'overflow') return;
    interactionLogger.record('asset_clicked', { action_id: '', asset_name: assetName, tab });
    // Update inspectQuery (so the inspect overlay, if open, reflects
    // the focus) AND call zoomToElement directly — the auto-zoom effect
    // skips no-op query changes, whereas we want re-clicking the same
    // line to re-center the view.
    diagrams.setInspectQueryForTab(tab, assetName);
    diagrams.zoomToElement(assetName, tab);
  }, [diagrams]);

  const saveParams = useMemo(() => ({
    networkPath, actionPath, layoutPath, outputFolderPath,
    minLineReconnections, minCloseCoupling, minOpenCoupling,
    minLineDisconnections, minPst, minLoadShedding,
    minRenewableCurtailmentActions, nPrioritizedActions,
    linesMonitoringPath, monitoringFactor,
    preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode,
    selectedBranch, selectedOverloads, monitorDeselected,
    nOverloads: nDiagram?.lines_overloaded ?? [],
    n1Overloads: n1Diagram?.lines_overloaded ?? [],
    nOverloadsRho: nDiagram?.lines_overloaded_rho,
    n1OverloadsRho: n1Diagram?.lines_overloaded_rho,
    result, selectedActionIds, rejectedActionIds,
    manuallyAddedIds, suggestedByRecommenderIds,
    setError, setInfoMessage: analysis.setInfoMessage,
  }), [
    networkPath, actionPath, layoutPath, outputFolderPath,
    minLineReconnections, minCloseCoupling, minOpenCoupling,
    minLineDisconnections, minPst, minLoadShedding,
    minRenewableCurtailmentActions, nPrioritizedActions,
    linesMonitoringPath, monitoringFactor,
    preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode,
    selectedBranch, selectedOverloads, monitorDeselected,
    nDiagram, n1Diagram,
    result, selectedActionIds, rejectedActionIds,
    manuallyAddedIds, suggestedByRecommenderIds,
    setError, analysis.setInfoMessage,
  ]);

  const wrappedSaveResults = useCallback(
    () => session.handleSaveResults(saveParams),
    [session, saveParams]
  );

  const wrappedOpenReloadModal = useCallback(
    () => session.handleOpenReloadModal(outputFolderPath, setError),
    [session, outputFolderPath, setError]
  );

  const restoreContext = useMemo(() => ({
    outputFolderPath,
    setNetworkPath, setActionPath, setLayoutPath,
    setMinLineReconnections, setMinCloseCoupling, setMinOpenCoupling,
    setMinLineDisconnections, setMinPst, setMinLoadShedding,
    setMinRenewableCurtailmentActions, setNPrioritizedActions,
    setLinesMonitoringPath, setMonitoringFactor, setPreExistingOverloadThreshold,
    setIgnoreReconnections, setPypowsyblFastMode,
    setMonitorDeselected: analysis.setMonitorDeselected,
    setSelectedOverloads: analysis.setSelectedOverloads,
    setResult,
    setSelectedActionIds: actionsHook.setSelectedActionIds,
    setRejectedActionIds: actionsHook.setRejectedActionIds,
    setManuallyAddedIds: actionsHook.setManuallyAddedIds,
    setSuggestedByRecommenderIds: actionsHook.setSuggestedByRecommenderIds,
    setSelectedBranch,
    restoringSessionRef: diagrams.restoringSessionRef,
    committedBranchRef: diagrams.committedBranchRef,
    committedNetworkPathRef,
    setError, setInfoMessage: analysis.setInfoMessage,
    applyConfigResponse, setBranches, setVoltageLevels, setNameMap,
    setNominalVoltageMap: diagrams.setNominalVoltageMap,
    setUniqueVoltages: diagrams.setUniqueVoltages,
    fetchBaseDiagram: diagrams.fetchBaseDiagram,
    ingestBaseDiagram: diagrams.ingestBaseDiagram,
    setVoltageRange: diagrams.setVoltageRange,
  }), [
    outputFolderPath,
    setNetworkPath, setActionPath, setLayoutPath,
    setMinLineReconnections, setMinCloseCoupling, setMinOpenCoupling,
    setMinLineDisconnections, setMinPst, setMinLoadShedding,
    setMinRenewableCurtailmentActions, setNPrioritizedActions,
    setLinesMonitoringPath, setMonitoringFactor, setPreExistingOverloadThreshold,
    setIgnoreReconnections, setPypowsyblFastMode,
    analysis, actionsHook, setResult, setSelectedBranch,
    diagrams, setError, applyConfigResponse, setBranches, setVoltageLevels, setNameMap,
  ]);

  const wrappedRestoreSession = useCallback(
    (sessionName: string) => session.handleRestoreSession(sessionName, restoreContext),
    [session, restoreContext]
  );

  // Check if there is any analysis state that would be lost on contingency change
  const hasAnalysisState = useCallback(() => {
    return !!(result || pendingAnalysisResult || selectedActionId || actionDiagram || manuallyAddedIds.size > 0 || selectedActionIds.size > 0 || rejectedActionIds.size > 0);
  }, [result, pendingAnalysisResult, selectedActionId, actionDiagram, manuallyAddedIds, selectedActionIds, rejectedActionIds]);

  // Full-fidelity snapshot of every parameter an agent would need to
  // replay a config-loaded / settings-applied gesture. Per the
  // interaction-logging replay contract each event must carry ALL
  // inputs — "click Load Study" alone is not enough, the agent has
  // to know which paths and recommender thresholds to type in first.
  const buildConfigInteractionDetails = useCallback((): Record<string, unknown> => ({
    network_path: networkPath,
    action_file_path: actionPath,
    layout_path: layoutPath,
    output_folder_path: outputFolderPath,
    min_line_reconnections: minLineReconnections,
    min_close_coupling: minCloseCoupling,
    min_open_coupling: minOpenCoupling,
    min_line_disconnections: minLineDisconnections,
    min_pst: minPst,
    min_load_shedding: minLoadShedding,
    min_renewable_curtailment_actions: minRenewableCurtailmentActions,
    n_prioritized_actions: nPrioritizedActions,
    lines_monitoring_path: linesMonitoringPath,
    monitoring_factor: monitoringFactor,
    pre_existing_overload_threshold: preExistingOverloadThreshold,
    ignore_reconnections: ignoreReconnections,
    pypowsybl_fast_mode: pypowsyblFastMode,
  }), [
    networkPath, actionPath, layoutPath, outputFolderPath,
    minLineReconnections, minCloseCoupling, minOpenCoupling,
    minLineDisconnections, minPst, minLoadShedding,
    minRenewableCurtailmentActions, nPrioritizedActions,
    linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold,
    ignoreReconnections, pypowsyblFastMode,
  ]);


  const applySettingsImmediate = useCallback(async () => {
    // settings_applied carries the full settings payload so a replay
    // agent can populate every field before clicking Apply. It's
    // treated as a wait-point by consumers of the log: the next
    // action must wait until the network reload (network, branches,
    // voltage levels) has finished.
    interactionLogger.record('settings_applied', buildConfigInteractionDetails());
    try {
      resetAllState();

      if (!networkPath || !actionPath) {
        setSettingsBackup(createCurrentBackup());
        setIsSettingsOpen(false);
        return;
      }

      if (configFilePath && configFilePath !== lastActiveConfigFilePath) {
        await changeConfigFilePath(configFilePath);
      }

      const configRes = await api.updateConfig(buildConfigRequest());
      applyConfigResponse(configRes as Record<string, unknown>);

      // Fire the 4 post-config XHRs in parallel. The base-diagram call is
      // the slowest (~6-7s pypowsybl NAD on large grids) and previously
      // only started after branches resolved — wasting the ~0.8s branches
      // gap off the critical path of the initial load.
      // See docs/performance/history/loading-parallel.md.
      const [branchRes, vlRes, nomVRes, diagramRaw] = await Promise.all([
        api.getBranches(),
        api.getVoltageLevels(),
        api.getNominalVoltages(),
        api.getNetworkDiagram(),
      ]);

      setBranches(branchRes.branches);
      setVoltageLevels(vlRes.voltage_levels);
      // Merge element + VL name maps into a single lookup
      setNameMap({ ...branchRes.name_map, ...vlRes.name_map });
      setSelectedBranch('');

      diagrams.setNominalVoltageMap(nomVRes.mapping);
      diagrams.setUniqueVoltages(nomVRes.unique_kv);
      if (nomVRes.unique_kv.length > 0) {
        diagrams.setVoltageRange([nomVRes.unique_kv[0], nomVRes.unique_kv[nomVRes.unique_kv.length - 1]]);
      }

      diagrams.ingestBaseDiagram(diagramRaw, vlRes.voltage_levels.length);

      committedNetworkPathRef.current = networkPath;
      interactionLogger.record('config_loaded', buildConfigInteractionDetails());
      setSettingsBackup(createCurrentBackup());
      setIsSettingsOpen(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to apply settings: ' + (e.response?.data?.detail || e.message));
    }
  }, [networkPath, actionPath, buildConfigRequest, applyConfigResponse, createCurrentBackup, setError, setSettingsBackup, setIsSettingsOpen, diagrams, configFilePath, lastActiveConfigFilePath, changeConfigFilePath, resetAllState, buildConfigInteractionDetails]);

  // Apply Settings entry point used by the Settings modal. If a study
  // is already loaded — whether or not analysis has been run yet — we
  // route through the same confirmation dialog as the "Load Study"
  // button. Applying any settings (in particular changing the config
  // file path) silently reloads the network and drops the in-flight
  // study, so the user must be warned even when only a base network
  // is loaded with no analysis state.
  const handleApplySettingsClick = useCallback(() => {
    if (hasAnalysisState() || committedNetworkPathRef.current) {
      setConfirmDialog({ type: 'applySettings' });
      return;
    }
    applySettingsImmediate();
  }, [hasAnalysisState, applySettingsImmediate]);



  const handleLoadConfig = useCallback(async () => {
    setConfigLoading(true);
    resetAllState();

    try {
      if (configFilePath && configFilePath !== lastActiveConfigFilePath) {
        await changeConfigFilePath(configFilePath);
      }
      const configRes = await api.updateConfig(buildConfigRequest());
      applyConfigResponse(configRes as Record<string, unknown>);

      // See the sibling call site in `applySettingsImmediate` for context:
      // fire 4 XHRs in parallel so the slow base-diagram call overlaps
      // with branches/voltage-levels/nominal-voltages.
      const [branchRes, vlRes, nomVRes, diagramRaw] = await Promise.all([
        api.getBranches(),
        api.getVoltageLevels(),
        api.getNominalVoltages(),
        api.getNetworkDiagram(),
      ]);

      setBranches(branchRes.branches);
      setVoltageLevels(vlRes.voltage_levels);
      setNameMap({ ...branchRes.name_map, ...vlRes.name_map });
      setSelectedBranch('');

      diagrams.setNominalVoltageMap(nomVRes.mapping);
      diagrams.setUniqueVoltages(nomVRes.unique_kv);
      if (nomVRes.unique_kv.length > 0) {
        diagrams.setVoltageRange([nomVRes.unique_kv[0], nomVRes.unique_kv[nomVRes.unique_kv.length - 1]]);
      }

      diagrams.ingestBaseDiagram(diagramRaw, vlRes.voltage_levels.length);
      committedNetworkPathRef.current = networkPath;
      interactionLogger.record('config_loaded', buildConfigInteractionDetails());
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to load config: ' + (e.response?.data?.detail || e.message));
    } finally {
      setConfigLoading(false);
    }
  }, [buildConfigRequest, applyConfigResponse, setError, diagrams, networkPath, configFilePath, lastActiveConfigFilePath, changeConfigFilePath, resetAllState, buildConfigInteractionDetails]);


  const handleLoadStudyClick = useCallback(() => {
    if (hasAnalysisState()) {
      setConfirmDialog({ type: 'loadStudy' });
    } else {
      handleLoadConfig();
    }
  }, [hasAnalysisState, handleLoadConfig]);

  // Network path commit pipeline used by the Header (file picker AND
  // input blur). When a study is already loaded and the path is being
  // changed to a different value, prompt for confirmation before
  // silently dropping the in-flight study. The setNetworkPath call is
  // optimistic — it makes the input immediately reflect the new path
  // even while the dialog is open — and is reverted by
  // handleCancelDialog if the user backs out.
  const requestNetworkPathChange = useCallback((newPath: string) => {
    setNetworkPath(newPath);
    const trimmed = newPath.trim();
    if (!trimmed) return;
    if (trimmed === committedNetworkPathRef.current) return;
    // Only warn once a study has actually been loaded — initial path
    // entry on an empty session must not trigger the dialog.
    if (!committedNetworkPathRef.current) return;
    setConfirmDialog({ type: 'changeNetwork', pendingNetworkPath: trimmed });
  }, [setNetworkPath]);

  const handleConfirmDialog = useCallback(() => {
    if (!confirmDialog) return;
    interactionLogger.record('contingency_confirmed', { type: confirmDialog.type, pending_branch: confirmDialog.pendingBranch });
    if (confirmDialog.type === 'contingency') {
      clearContingencyState();
      setSelectedBranch(confirmDialog.pendingBranch || '');
    } else if (confirmDialog.type === 'applySettings') {
      applySettingsImmediate();
    } else if (confirmDialog.type === 'changeNetwork') {
      // pendingNetworkPath was already setNetworkPath'd by
      // requestNetworkPathChange. Reload the config so the backend
      // picks up the new file.
      handleLoadConfig();
    } else {
      handleLoadConfig();
    }
    setConfirmDialog(null);
  }, [confirmDialog, clearContingencyState, handleLoadConfig, applySettingsImmediate]);


  // ===== App-Level Effects =====

  useEffect(() => {
    diagrams.selectedBranchForSld.current = selectedBranch;
  }, [selectedBranch, diagrams.selectedBranchForSld]);



  useEffect(() => {
    if (!selectedBranch) {
      diagrams.setN1Diagram(null);
      if (!hasAnalysisState()) {
        diagrams.committedBranchRef.current = '';
      }
      return;
    }

    if (branches.length > 0 && !branches.includes(selectedBranch)) return;

    // Short-circuit when we already have the N-1 diagram / fetch /
    // analysis for this branch — EXCEPT on session restore, where
    // `hasAnalysisState()` is already true (actions were rehydrated
    // by `useSession::handleRestoreSession`) while `n1Diagram` is
    // still null. In that case the early-return would silently skip
    // the N-1 fetch, leaving the N-1 tab blank and the N-1 overloads
    // panel empty. `restoringSessionRef.current` is the signal we
    // use to force the fetch through.
    if (selectedBranch === diagrams.committedBranchRef.current
        && !diagrams.restoringSessionRef.current
        && (n1Diagram || hasAnalysisState() || n1Loading || analysisLoading)) return;

    if (selectedBranch !== diagrams.committedBranchRef.current && hasAnalysisState() && !diagrams.restoringSessionRef.current) {
      setConfirmDialog({ type: 'contingency', pendingBranch: selectedBranch });
      setSelectedBranch(diagrams.committedBranchRef.current);
      return;
    }
    // Capture BEFORE we reset the ref so the rest of this effect can
    // distinguish "user changed contingency" from "session was just
    // restored". Without the local capture, any later branch in
    // this effect would see `restoringSessionRef.current === false`
    // and incorrectly wipe the just-restored analysis state via
    // `clearContingencyState()`.
    const isRestoring = diagrams.restoringSessionRef.current;
    diagrams.restoringSessionRef.current = false;

    diagrams.committedBranchRef.current = selectedBranch;
    if (!isRestoring) {
      clearContingencyState();
      diagrams.setN1Diagram(null);
    }

    const fetchN1 = async () => {
      diagrams.setN1Loading(true);
      // On user-initiated contingency change, switch to N-1 so the
      // fetched diagram is visible. On session restore, leave the
      // active tab alone so the user lands on whichever tab the
      // VisualizationPanel default (Action / Overflow) resolves to
      // given the restored state.
      if (!isRestoring) {
        diagrams.setActiveTab('n-1');
      }
      try {
        const res = await api.getN1Diagram(selectedBranch);
        const { svg, viewBox } = processSvg(res.svg, voltageLevels.length);
        diagrams.setN1Diagram({ ...res, svg, originalViewBox: viewBox });
        // Ensure auto-zoom fires after the new N-1 diagram is ready.
        // Reset lastZoomState so the auto-zoom effect sees a "branch change"
        // on the render that has both activeTab='n-1' and the new SVG in DOM.
        diagrams.lastZoomState.current = { query: '', branch: '' };
      } catch (err) {
        console.error('Failed to fetch N-1 diagram', err);
        setError(`Failed to fetch N-1 diagram for ${selectedBranch}`);
      } finally {
        diagrams.setN1Loading(false);
      }
    };
    fetchN1();
  }, [selectedBranch, branches, voltageLevels.length, hasAnalysisState, clearContingencyState, analysisLoading, n1Diagram, n1Loading, setError, diagrams]);

  useEffect(() => {
    const nextSet = n1Diagram?.lines_overloaded ? new Set(n1Diagram.lines_overloaded) : new Set<string>();
    const currentSet = analysis.selectedOverloads;
    if (nextSet.size === currentSet.size && [...nextSet].every(x => currentSet.has(x))) {
      return;
    }
    analysis.setSelectedOverloads(nextSet);
  }, [n1Diagram, analysisLoading, n1Loading, analysis]);




  const staleHighlights = useRef<Set<TabId>>(new Set());
  const prevHighlightTabRef = useRef<TabId>(activeTab);

  // Flow vs Impacts view mode is now TAB-SCOPED and WINDOW-SCOPED:
  // main window has `actionViewMode` (from useDiagrams) while each
  // detached tab has its own entry here. Toggling Impacts in a
  // detached popup therefore only affects that popup's tab; the
  // main window's mode is untouched, and vice versa. A reattach
  // clears the detached-mode entry so the tab resumes the
  // main-window mode from that point onward.
  const [detachedViewModes, setDetachedViewModes] = useState<Partial<Record<TabId, 'network' | 'delta'>>>({});

  // Which Flow/Impacts mode applies to a given tab right now.
  const viewModeForTab = useCallback((tab: TabId): 'network' | 'delta' => {
    if (detachedTabs[tab]) return detachedViewModes[tab] ?? 'network';
    return actionViewMode;
  }, [detachedTabs, detachedViewModes, actionViewMode]);

  // Per-tab Flow/Impacts toggle routing: if the tab is currently
  // detached, update its entry in `detachedViewModes`; otherwise
  // update the main-window `actionViewMode`. This is how a Flow
  // /Impacts button inside a detached popup affects ONLY the
  // detached window.
  const handleViewModeChangeForTab = useCallback((tab: TabId, mode: 'network' | 'delta') => {
    interactionLogger.record('view_mode_changed', { mode, tab, scope: detachedTabs[tab] ? 'detached' : 'main' });
    if (detachedTabs[tab]) {
      setDetachedViewModes(prev => ({ ...prev, [tab]: mode }));
    } else {
      diagrams.setActionViewMode(mode);
    }
  }, [detachedTabs, diagrams]);

  // On reattach, drop the tab's detached view-mode entry so the
  // main window's `actionViewMode` takes over for that tab from
  // that point onward.
  useEffect(() => {
    setDetachedViewModes(prev => {
      const next: Partial<Record<TabId, 'network' | 'delta'>> = {};
      let changed = false;
      for (const tabId of Object.keys(prev) as TabId[]) {
        if (detachedTabs[tabId]) {
          next[tabId] = prev[tabId];
        } else {
          changed = true; // dropped
        }
      }
      return changed ? next : prev;
    });
  }, [detachedTabs]);

  const applyHighlightsForTab = useCallback((tab: TabId, mode?: 'network' | 'delta') => {
    const effectiveMode = mode ?? viewModeForTab(tab);
    const overloadedLines = result?.lines_overloaded || [];

    // For the N-1 tab, the overloads are known as soon as the N-1
    // diagram comes back from the backend (`n1Diagram.lines_overloaded`)
    // — well before any action analysis has run. Falling back to that
    // list lets the orange overload halos show up immediately on the
    // N-1 view, matching the standalone interface and what the user
    // expects to see right after picking a contingency. Once analysis
    // runs and `result.lines_overloaded` becomes available, we use that.
    // In both cases the user's selected-overload set (from the
    // Overloads panel) further filters the list down. Extracted to a
    // pure helper for unit testing.
    const n1OverloadedLines = computeN1OverloadHighlights(
      overloadedLines,
      n1Diagram?.lines_overloaded,
      selectedOverloads,
    );

    if (tab === 'n-1') {
      if (diagrams.n1SvgContainerRef.current) {
        // IMPORTANT: run highlight CLONES before applyDeltaVisuals.
        // The clone-based highlights (`applyOverloadedHighlights`,
        // `applyContingencyHighlight`) use cloneNode(true) on the
        // original SVG element. If applyDeltaVisuals has already
        // tagged the original with `nad-delta-positive/negative/grey`,
        // the clone inherits that class — and because the `.nad-delta-*`
        // CSS is declared LATER in App.css than `.nad-contingency-highlight`
        // / `.nad-overloaded`, the delta rule wins the cascade and the
        // halo becomes a thin orange/blue stroke, effectively making the
        // highlight disappear in Impacts mode. Cloning first guarantees
        // the halos stay on a pristine copy of the element.
        //
        // Overloaded lines must also be highlighted in BOTH Flows and
        // Impacts modes — the user looks at the Impacts view to see how
        // the action redistributes flows AND which lines are still
        // (or newly) overloaded; suppressing the halos in delta mode
        // hides exactly that information.
        if (diagrams.n1MetaIndex && n1OverloadedLines.length > 0) {
          applyOverloadedHighlights(diagrams.n1SvgContainerRef.current, diagrams.n1MetaIndex, n1OverloadedLines);
        }
        applyContingencyHighlight(diagrams.n1SvgContainerRef.current, diagrams.n1MetaIndex, selectedBranch);
        applyDeltaVisuals(diagrams.n1SvgContainerRef.current, n1Diagram, diagrams.n1MetaIndex, effectiveMode === 'delta');
      }
    }
    if (tab === 'action') {
      const actionDetail = result?.actions?.[selectedActionId || ''];

      if (actionDetail) {
        // Same ordering rule as the N-1 tab: clone-based highlights
        // first (so they capture pristine elements), delta visuals
        // last. Overload halos render in both Flows and Impacts modes.
        //
        // ActionCard severity classification (`components/ActionCard.tsx:76-78`):
        //   - red:    `max_rho > monitoringFactor`         ("Still overloaded")
        //   - orange: `max_rho > monitoringFactor - 0.05`  ("Solved — low margin")
        //   - green:  else                                 ("Solves overload")
        // When the card says "Solved" (orange or green) no line in the
        // post-action state exceeds the operator's tolerance threshold,
        // so overload halos on the NAD contradict the card's label.
        // The backend's manual-simulation path flags `lines_overloaded_after`
        // on raw rho >= monitoring_factor (0.95) whereas the analysis
        // path uses raw rho >= 1.0 (`analysis_mixin.py:97` vs
        // `simulation_mixin.py:536`). In the low-margin band — raw rho
        // in `[mf, 1.0)` — the two paths disagree: manual ships a
        // non-empty list, analysis ships an empty one. Without this
        // gate, halos appear on manual low-margin actions but not on
        // suggested ones with the same displayed max_rho — the exact
        // user-reported bug (commit-time 2026-04-20).
        const isSolved =
          actionDetail.max_rho != null && actionDetail.max_rho <= monitoringFactor;

        let overloadsToHighlight: string[] = [];

        if (!isSolved) {
          if (actionDetail.lines_overloaded_after && actionDetail.lines_overloaded_after.length > 0) {
            overloadsToHighlight = actionDetail.lines_overloaded_after;
          } else {
            // Fallback for legacy results or actions without full enrichment
            if (overloadedLines.length > 0 && actionDetail.rho_after) {
              overloadedLines.forEach((name, i) => {
                const rho = actionDetail.rho_after![i];
                if (rho != null && rho > monitoringFactor) {
                  overloadsToHighlight.push(name);
                }
              });
            }
            if (actionDetail.max_rho != null && actionDetail.max_rho > monitoringFactor && actionDetail.max_rho_line) {
              if (!overloadsToHighlight.includes(actionDetail.max_rho_line)) {
                overloadsToHighlight.push(actionDetail.max_rho_line);
              }
            }
          }
        }

        if (diagrams.actionSvgContainerRef.current && diagrams.actionMetaIndex) {
          applyOverloadedHighlights(diagrams.actionSvgContainerRef.current, diagrams.actionMetaIndex, overloadsToHighlight);
        }

        if (diagrams.actionSvgContainerRef.current) {
          applyActionTargetHighlights(diagrams.actionSvgContainerRef.current, diagrams.actionMetaIndex, actionDetail, selectedActionId);
          applyContingencyHighlight(diagrams.actionSvgContainerRef.current, diagrams.actionMetaIndex, selectedBranch);
        }
      }
      else {
        if (diagrams.actionSvgContainerRef.current) {
          applyActionTargetHighlights(diagrams.actionSvgContainerRef.current, null, null, null);
        }
      }

      // Delta visuals run LAST so they decorate the originals without
      // contaminating the highlight clones already in the background
      // layer.
      applyDeltaVisuals(diagrams.actionSvgContainerRef.current, actionDiagram, diagrams.actionMetaIndex, effectiveMode === 'delta');
    }
  }, [n1Diagram, actionDiagram, result, selectedActionId, selectedBranch, diagrams, monitoringFactor, viewModeForTab, selectedOverloads]);

  useEffect(() => {
    const isTabSwitch = prevHighlightTabRef.current !== activeTab;
    prevHighlightTabRef.current = activeTab;
    const otherTabs: TabId[] = ['n', 'n-1', 'action'].filter(t => t !== activeTab) as TabId[];
    otherTabs.forEach(t => staleHighlights.current.add(t));

    // Apply highlights + delta visuals to both the main window's
    // active tab AND every currently-detached tab — because Impacts
    // mode must keep working inside a detached popup when only the
    // popup's view mode changes (the main window may be showing a
    // different tab entirely).
    const applyAll = () => {
      applyHighlightsForTab(activeTab);
      staleHighlights.current.delete(activeTab);
      for (const detachedId of Object.keys(detachedTabs) as TabId[]) {
        if (detachedId === activeTab) continue;
        if (detachedId === 'overflow') continue;
        applyHighlightsForTab(detachedId);
        staleHighlights.current.delete(detachedId);
      }
    };

    if (isTabSwitch) {
      // Double rAF to ensure browser layout is settled before getScreenCTM()
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applyAll();
        });
      });
      return () => cancelAnimationFrame(id);
    } else {
      applyAll();
    }
  }, [nDiagram, n1Diagram, actionDiagram, diagrams.nMetaIndex, diagrams.n1MetaIndex, diagrams.actionMetaIndex, result, selectedActionId, actionViewMode, detachedViewModes, detachedTabs, activeTab, selectedBranch, selectedOverloads, applyHighlightsForTab]);

  // ===== Extracted JSX callbacks (stable references for React.memo) =====

  const handleContingencyChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    interactionLogger.record('contingency_selected', { element: e.target.value });
    setSelectedBranch(e.target.value);
  }, []);

  const handleDismissWarning = useCallback(() => {
    setShowMonitoringWarning(false);
  }, [setShowMonitoringWarning]);

  const handleOpenConfigSettings = useCallback(() => {
    setIsSettingsOpen(true);
    setSettingsTab('configurations');
  }, [setIsSettingsOpen, setSettingsTab]);

  const handleToggleMonitorDeselected = useCallback(() => {
    analysis.setMonitorDeselected(!analysis.monitorDeselected);
  }, [analysis]);

  const handleTabChange = useCallback((tab: TabId) => {
    interactionLogger.record('diagram_tab_changed', { tab });
    diagrams.setActiveTab(tab);
  }, [diagrams]);

  const handleVoltageRangeChange = useCallback((range: [number, number]) => {
    interactionLogger.record('voltage_range_changed', { min: range[0], max: range[1] });
    diagrams.setVoltageRange(range);
  }, [diagrams]);

  const handleInspectQueryChange = useCallback((q: string) => {
    interactionLogger.record('inspect_query_changed', { query: q });
    diagrams.setInspectQuery(q);
  }, [diagrams]);

  // Per-tab inspect variant. Lets a detached tab's overlay zoom its
  // own tab rather than the main-window activeTab — see
  // useDiagrams.setInspectQueryForTab for the full story.
  const handleInspectQueryChangeFor = useCallback((targetTab: TabId, q: string) => {
    interactionLogger.record('inspect_query_changed', { query: q, target_tab: targetTab });
    diagrams.setInspectQueryForTab(targetTab, q);
  }, [diagrams]);

  const handleVlOpen = useCallback((vlName: string) => {
    // Always carry the currently-selected action id into the SLD
    // overlay — NOT just when activeTab === 'action'. The SLD's
    // internal sub-tab buttons let the user switch to the "action"
    // sub-tab from any tab, and if we open the overlay with an
    // empty actionId the backend rejects the switch with
    // "Action '' not found in last analysis result".
    handleVlDoubleClick(selectedActionId || '', vlName);
  }, [handleVlDoubleClick, selectedActionId]);

  const handleCancelDialog = useCallback(() => {
    // Cancelling a "Change Network?" dialog must roll back the
    // optimistic networkPath update done by requestNetworkPathChange,
    // otherwise the Header field would silently diverge from the
    // currently-loaded study's path.
    if (confirmDialog?.type === 'changeNetwork') {
      setNetworkPath(committedNetworkPathRef.current);
    }
    setConfirmDialog(null);
  }, [confirmDialog, setNetworkPath]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header
        networkPath={networkPath}
        setNetworkPath={setNetworkPath}
        onCommitNetworkPath={requestNetworkPathChange}
        configLoading={configLoading}
        result={result}
        selectedBranch={selectedBranch}
        sessionRestoring={sessionRestoring}
        onPickSettingsPath={pickSettingsPath}
        onLoadStudy={handleLoadStudyClick}
        onSaveResults={wrappedSaveResults}
        onOpenReloadModal={wrappedOpenReloadModal}
        onOpenSettings={handleOpenSettings}
      />

      {/* Settings Modal */}
      <SettingsModal settings={settings} onApply={handleApplySettingsClick} />


      <ReloadSessionModal
        showReloadModal={showReloadModal}
        setShowReloadModal={setShowReloadModal}
        outputFolderPath={outputFolderPath}
        sessionListLoading={sessionListLoading}
        sessionList={sessionList}
        sessionRestoring={sessionRestoring}
        onRestoreSession={wrappedRestoreSession}
      />

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        {/*
          Sidebar layout:
          - A COMPACT sticky strip at the top keeps only the
            clickable fields of interest visible while scrolling
            (selected contingency → zoom active tab; N-1 overloads →
            jump to N-1 tab + zoom, same behavior as the old
            "Loading Before" link on action cards).
          - Everything else — the full Select Contingency card with
            the search input, the Overloads panel with its warnings
            and N/N-1 breakdown, and the ActionFeed — scrolls
            together in a single column below, saving vertical space.
        */}
        <div data-testid="sidebar" style={{ width: '25%', background: '#eee', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          {(selectedBranch || (n1Diagram?.lines_overloaded?.length ?? 0) > 0) && (
            <div
              data-testid="sticky-feed-summary"
              style={{
                flexShrink: 0,
                padding: '6px 12px',
                background: '#f8f9fa',
                borderBottom: '1px solid #ccc',
                fontSize: '11px',
                lineHeight: 1.5,
                boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              }}
            >
              {selectedBranch && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                  <span style={{ color: '#555', fontWeight: 600, whiteSpace: 'nowrap' }}>🎯 Contingency:</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleZoomOnActiveTab(selectedBranch); }}
                    title={`Zoom to ${selectedBranch} in the current diagram`}
                    style={{
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      padding: 0,
                      fontSize: '11px',
                      color: '#1e40af',
                      fontWeight: 600,
                      textDecoration: 'underline dotted',
                      wordBreak: 'break-word',
                      textAlign: 'left',
                    }}
                  >
                    🔍 {displayName(selectedBranch)}
                  </button>
                </div>
              )}
              {(n1Diagram?.lines_overloaded?.length ?? 0) > 0 && (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
                  <span style={{ color: '#b91c1c', fontWeight: 600, whiteSpace: 'nowrap' }}>⚠️ N-1:</span>
                  <span style={{ wordBreak: 'break-word' }}>
                    {n1Diagram!.lines_overloaded!.map((name, i) => {
                      const rho = n1Diagram!.lines_overloaded_rho?.[i];
                      const rhoPct = rho != null && !Number.isNaN(rho) ? `${(rho * 100).toFixed(1)}%` : null;
                      const isSelected = selectedOverloads?.has(name) ?? true;
                      return (
                        <React.Fragment key={name}>
                          {i > 0 && ', '}
                          <button
                            onClick={(e) => { e.stopPropagation(); wrappedAssetClick('', name, 'n-1'); }}
                            title={`Open N-1 tab and zoom to ${name}`}
                            style={{
                              background: 'none',
                              border: 'none',
                              cursor: 'pointer',
                              padding: 0,
                              fontSize: '11px',
                              color: isSelected ? '#1e40af' : '#bdc3c7',
                              fontWeight: isSelected ? 600 : 400,
                              textDecoration: isSelected ? 'underline dotted' : 'none',
                            }}
                          >
                            {displayName(name)}
                          </button>
                          {rhoPct && (
                            <span style={{ color: isSelected ? '#374151' : '#bdc3c7', marginLeft: '2px' }}>
                              ({rhoPct})
                            </span>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </span>
                </div>
              )}
            </div>
          )}
          <div style={{ flex: 1, overflowY: 'auto', padding: '15px', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {/* Target Contingency selector — full card lives in the
                scroll area so the compact sticky strip above stays
                minimal. */}
            {branches.length > 0 && (
              <div style={{ flexShrink: 0, padding: '10px 15px', background: 'white', borderRadius: '8px', border: '1px solid #dee2e6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🎯 Select Contingency</label>
                <input
                  list="contingencies"
                  value={selectedBranch}
                  onChange={handleContingencyChange}
                  placeholder="Search line/bus..."
                  style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontSize: '0.85rem' }}
                />
                {selectedBranch && nameMap[selectedBranch] && (
                  <div style={{ fontSize: '0.78rem', color: '#4b5563', marginTop: '3px', fontStyle: 'italic', lineHeight: 1.3 }}>
                    {nameMap[selectedBranch]}
                  </div>
                )}
                <datalist id="contingencies">
                  {contingencyOptions}
                </datalist>
              </div>
            )}

            <div style={{ flexShrink: 0 }}>
              <OverloadPanel
                nOverloads={nDiagram?.lines_overloaded || []}
                n1Overloads={n1Diagram?.lines_overloaded || []}
                nOverloadsRho={nDiagram?.lines_overloaded_rho}
                n1OverloadsRho={n1Diagram?.lines_overloaded_rho}
                onAssetClick={wrappedAssetClick as (actionId: string, assetName: string, tab?: 'n' | 'n-1') => void}
                showMonitoringWarning={showMonitoringWarning}
                monitoredLinesCount={monitoredLinesCount}
                totalLinesCount={totalLinesCount}
                monitoringFactor={monitoringFactor}
                preExistingOverloadThreshold={preExistingOverloadThreshold}
                onDismissWarning={handleDismissWarning}
                onOpenSettings={handleOpenConfigSettings}
                selectedOverloads={selectedOverloads}
                onToggleOverload={analysis.handleToggleOverload}
                monitorDeselected={monitorDeselected}
                onToggleMonitorDeselected={handleToggleMonitorDeselected}
                displayName={displayName}
              />
            </div>
            <ActionFeed
              actions={result?.actions || {}}
              actionScores={result?.action_scores}
              linesOverloaded={result?.lines_overloaded || []}
              selectedActionId={selectedActionId}
              scrollTarget={scrollTarget}
              selectedActionIds={selectedActionIds}
              rejectedActionIds={rejectedActionIds}
              manuallyAddedIds={manuallyAddedIds}
              combinedActions={result?.combined_actions ?? null}
              pendingAnalysisResult={pendingAnalysisResult}
              onDisplayPrioritizedActions={wrappedDisplayPrioritized}
              onRunAnalysis={wrappedRunAnalysis}
              canRunAnalysis={!!selectedBranch && !analysisLoading}
              onActionSelect={wrappedActionSelect}
              onActionFavorite={wrappedActionFavorite}
              onActionReject={actionsHook.handleActionReject}
              onAssetClick={wrappedAssetClick}
              nodesByEquipmentId={diagrams.nMetaIndex?.nodesByEquipmentId ?? null}
              edgesByEquipmentId={diagrams.nMetaIndex?.edgesByEquipmentId ?? null}
              disconnectedElement={selectedBranch || null}
              onManualActionAdded={wrappedManualActionAdded}
              onActionResimulated={wrappedActionResimulated}
              analysisLoading={analysisLoading}
              monitoringFactor={monitoringFactor}
              onVlDoubleClick={handleVlDoubleClick}
              recommenderConfig={recommenderConfig}
              actionDictFileName={actionDictFileName}
              actionDictStats={actionDictStats}
              onOpenSettings={handleOpenSettings}
              onUpdateCombinedEstimation={handleUpdateCombinedEstimation}
              displayName={displayName}
              onActionDiagramPrimed={diagrams.primeActionDiagram}
              voltageLevelsLength={voltageLevels.length}
              overviewFilters={overviewFilters}
            />
          </div>
        </div>
        <div style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column' }}>
          <VisualizationPanel
            activeTab={activeTab}
            configLoading={configLoading}
            onTabChange={handleTabChange}
            nDiagram={nDiagram}
            n1Diagram={n1Diagram}
            n1Loading={n1Loading}
            actionDiagram={actionDiagram}
            actionDiagramLoading={actionDiagramLoading}
            selectedActionId={selectedActionId}
            result={result}
            analysisLoading={analysisLoading}
            nSvgContainerRef={nSvgContainerRef}
            n1SvgContainerRef={n1SvgContainerRef}
            actionSvgContainerRef={actionSvgContainerRef}
            uniqueVoltages={uniqueVoltages}
            voltageRange={voltageRange}
            onVoltageRangeChange={handleVoltageRangeChange}
            actionViewMode={actionViewMode}
            onViewModeChange={handleViewModeChange}
            viewModeForTab={viewModeForTab}
            onViewModeChangeForTab={handleViewModeChangeForTab}
            inspectQuery={inspectQuery}
            onInspectQueryChange={handleInspectQueryChange}
            onInspectQueryChangeFor={handleInspectQueryChangeFor}
            inspectableItems={inspectableItems}
            onResetView={handleManualReset}
            onZoomIn={handleManualZoomIn}
            onZoomOut={handleManualZoomOut}
            hasBranches={branches.length > 0}
            selectedBranch={selectedBranch}
            vlOverlay={vlOverlay}
            onOverlayClose={handleOverlayClose}
            onOverlaySldTabChange={handleOverlaySldTabChange}
            voltageLevels={voltageLevels}
            onVlOpen={handleVlOpen}
            networkPath={networkPath}
            layoutPath={layoutPath}
            onOpenSettings={handleOpenSettings}
            detachedTabs={detachedTabs}
            onDetachTab={handleDetachTab}
            onReattachTab={handleReattachTab}
            onFocusDetachedTab={focusDetachedTab}
            isTabTied={isTabTied}
            onToggleTabTie={toggleTabTie}
            n1MetaIndex={diagrams.n1MetaIndex}
            onActionSelect={wrappedActionSelect}
            onActionFavorite={wrappedActionFavorite}
            onActionReject={actionsHook.handleActionReject}
            selectedActionIds={selectedActionIds}
            rejectedActionIds={rejectedActionIds}
            onPinPreview={handlePinPreview}
            onOverviewPzChange={handleOverviewPzChange}
            monitoringFactor={monitoringFactor}
            displayName={displayName}
            overviewFilters={overviewFilters}
            onOverviewFiltersChange={setOverviewFilters}
            unsimulatedActionIds={unsimulatedActionIds}
            unsimulatedActionInfo={unsimulatedActionInfo}
            onSimulateUnsimulatedAction={handleSimulateUnsimulatedAction}
          />
        </div>
      </div>
      {/* Confirmation Dialog for contingency change / load study */}
      <ConfirmationDialog
        confirmDialog={confirmDialog}
        onCancel={handleCancelDialog}
        onConfirm={handleConfirmDialog}
      />
      {error && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20,
          background: '#e74c3c', color: 'white',
          padding: '10px 20px', borderRadius: '4px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)', zIndex: 1000,
        }}>
          {error}
        </div>
      )}
      {infoMessage && (
        <div style={{
          position: 'fixed', bottom: 20, left: 20,
          background: infoMessage.startsWith('SUCCESS') ? '#27ae60' : '#3498db',
          color: 'white',
          padding: '12px 24px', borderRadius: '4px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.3)', zIndex: 1000,
          fontWeight: 'bold',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          {infoMessage}
        </div>
      )}
    </div>
  );
}

export default App;
