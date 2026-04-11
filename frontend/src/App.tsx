// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
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
import type { ActionDetail, TabId, RecommenderDisplayConfig } from './types';
import { useSettings } from './hooks/useSettings';
import { useActions } from './hooks/useActions';
import { useAnalysis } from './hooks/useAnalysis';
import { useDiagrams } from './hooks/useDiagrams';
import { useSession } from './hooks/useSession';
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
  const diagrams = useDiagrams(branches, voltageLevels, selectedBranch);
  const [configLoading, setConfigLoading] = useState(false);
  const [error, setError] = useState('');

  // Confirmation dialog state for contingency change / load study
  const [confirmDialog, setConfirmDialog] = useState<ConfirmDialogState>(null);

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

  const contingencyOptions = useMemo(() => {
    const q = selectedBranch.toUpperCase();
    const opts: string[] = [];
    if (!q) {
      opts.push(...branches.slice(0, 50));
    } else {
      for (const b of branches) {
        if (b.toUpperCase().includes(q)) {
          opts.push(b);
          if (opts.length >= 50) break;
        }
      }
    }
    return opts.map(b => <option key={b} value={b} />);
  }, [branches, selectedBranch]);

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
    diagrams.lastZoomState.current = { query: '', branch: '' };
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

  const wrappedActionFavorite = useCallback(
    (actionId: string) => actionsHook.handleActionFavorite(actionId, setResult),
    [actionsHook, setResult]
  );

  const wrappedManualActionAdded = useCallback(
    (actionId: string, detail: ActionDetail, linesOverloaded: string[]) =>
      actionsHook.handleManualActionAdded(actionId, detail, linesOverloaded, setResult, wrappedActionSelect),
    [actionsHook, setResult, wrappedActionSelect]
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
    () => analysis.handleRunAnalysis(selectedBranch, clearContingencyState, actionsHook.setSuggestedByRecommenderIds, diagrams.setActiveTab),
    [analysis, selectedBranch, clearContingencyState, actionsHook.setSuggestedByRecommenderIds, diagrams.setActiveTab]
  );

  const wrappedDisplayPrioritized = useCallback(
    () => analysis.handleDisplayPrioritizedActions(selectedActionIds),
    [analysis, selectedActionIds]
  );

  const wrappedAssetClick = useCallback(
    (actionId: string, assetName: string, tab: 'action' | 'n' | 'n-1' = 'action') =>
      diagrams.handleAssetClick(actionId, assetName, tab, diagrams.selectedActionId, wrappedActionSelect),
    [diagrams, wrappedActionSelect]
  );

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
    setError, setInfoMessage: analysis.setInfoMessage,
    applyConfigResponse, setBranches, setVoltageLevels,
    setNominalVoltageMap: diagrams.setNominalVoltageMap,
    setUniqueVoltages: diagrams.setUniqueVoltages,
    fetchBaseDiagram: diagrams.fetchBaseDiagram,
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
    diagrams, setError, applyConfigResponse, setBranches, setVoltageLevels,
  ]);

  const wrappedRestoreSession = useCallback(
    (sessionName: string) => session.handleRestoreSession(sessionName, restoreContext),
    [session, restoreContext]
  );

  // Check if there is any analysis state that would be lost on contingency change
  const hasAnalysisState = useCallback(() => {
    return !!(result || pendingAnalysisResult || selectedActionId || actionDiagram || manuallyAddedIds.size > 0 || selectedActionIds.size > 0 || rejectedActionIds.size > 0);
  }, [result, pendingAnalysisResult, selectedActionId, actionDiagram, manuallyAddedIds, selectedActionIds, rejectedActionIds]);


  const handleApplySettings = useCallback(async () => {
    interactionLogger.record('settings_applied');
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

      const [branchesList, vlRes, nomVRes] = await Promise.all([
        api.getBranches(),
        api.getVoltageLevels(),
        api.getNominalVoltages(),
      ]);

      setBranches(branchesList);
      setVoltageLevels(vlRes);
      setSelectedBranch('');

      diagrams.setNominalVoltageMap(nomVRes.mapping);
      diagrams.setUniqueVoltages(nomVRes.unique_kv);
      if (nomVRes.unique_kv.length > 0) {
        diagrams.setVoltageRange([nomVRes.unique_kv[0], nomVRes.unique_kv[nomVRes.unique_kv.length - 1]]);
      }

      diagrams.fetchBaseDiagram(vlRes.length);

      interactionLogger.record('config_loaded', { network_path: networkPath, action_path: actionPath });
      setSettingsBackup(createCurrentBackup());
      setIsSettingsOpen(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to apply settings: ' + (e.response?.data?.detail || e.message));
    }
  }, [networkPath, actionPath, buildConfigRequest, applyConfigResponse, createCurrentBackup, setError, setSettingsBackup, setIsSettingsOpen, diagrams, configFilePath, lastActiveConfigFilePath, changeConfigFilePath, resetAllState]);



  const handleLoadConfig = useCallback(async () => {
    setConfigLoading(true);
    resetAllState();

    try {
      if (configFilePath && configFilePath !== lastActiveConfigFilePath) {
        await changeConfigFilePath(configFilePath);
      }
      const configRes = await api.updateConfig(buildConfigRequest());
      applyConfigResponse(configRes as Record<string, unknown>);

      const [branchesList, vlRes, nomVRes] = await Promise.all([
        api.getBranches(),
        api.getVoltageLevels(),
        api.getNominalVoltages(),
      ]);

      setBranches(branchesList);
      setVoltageLevels(vlRes);
      setSelectedBranch('');

      diagrams.setNominalVoltageMap(nomVRes.mapping);
      diagrams.setUniqueVoltages(nomVRes.unique_kv);
      if (nomVRes.unique_kv.length > 0) {
        diagrams.setVoltageRange([nomVRes.unique_kv[0], nomVRes.unique_kv[nomVRes.unique_kv.length - 1]]);
      }

      diagrams.fetchBaseDiagram(vlRes.length);
      interactionLogger.record('config_loaded', { network_path: networkPath, action_path: actionPath });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to load config: ' + (e.response?.data?.detail || e.message));
    } finally {
      setConfigLoading(false);
    }
  }, [buildConfigRequest, applyConfigResponse, setError, diagrams, networkPath, actionPath, configFilePath, lastActiveConfigFilePath, changeConfigFilePath, resetAllState]);


  const handleLoadStudyClick = useCallback(() => {
    if (hasAnalysisState()) {
      setConfirmDialog({ type: 'loadStudy' });
    } else {
      handleLoadConfig();
    }
  }, [hasAnalysisState, handleLoadConfig]);

  const handleConfirmDialog = useCallback(() => {
    if (!confirmDialog) return;
    interactionLogger.record('contingency_confirmed', { type: confirmDialog.type, pending_branch: confirmDialog.pendingBranch });
    if (confirmDialog.type === 'contingency') {
      clearContingencyState();
      setSelectedBranch(confirmDialog.pendingBranch || '');
    } else {
      handleLoadConfig();
    }
    setConfirmDialog(null);
  }, [confirmDialog, clearContingencyState, handleLoadConfig]);


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

    if (selectedBranch === diagrams.committedBranchRef.current && (n1Diagram || hasAnalysisState() || n1Loading || analysisLoading)) return;

    if (selectedBranch !== diagrams.committedBranchRef.current && hasAnalysisState() && !diagrams.restoringSessionRef.current) {
      setConfirmDialog({ type: 'contingency', pendingBranch: selectedBranch });
      setSelectedBranch(diagrams.committedBranchRef.current);
      return;
    }
    diagrams.restoringSessionRef.current = false;

    diagrams.committedBranchRef.current = selectedBranch;
    clearContingencyState();
    diagrams.setN1Diagram(null);

    const fetchN1 = async () => {
      diagrams.setN1Loading(true);
      diagrams.setActiveTab('n-1');
      try {
        const res = await api.getN1Diagram(selectedBranch);
        const { svg, viewBox } = processSvg(res.svg, voltageLevels.length);
        diagrams.setN1Diagram({ ...res, svg, originalViewBox: viewBox });
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

  const applyHighlightsForTab = useCallback((tab: TabId) => {
    const overloadedLines = result?.lines_overloaded || [];

    if (tab === 'n-1') {
      if (diagrams.n1SvgContainerRef.current) {
        if (actionViewMode !== 'delta' && diagrams.n1MetaIndex && overloadedLines.length > 0) {
          applyOverloadedHighlights(diagrams.n1SvgContainerRef.current, diagrams.n1MetaIndex, overloadedLines);
        }
        applyDeltaVisuals(diagrams.n1SvgContainerRef.current, n1Diagram, diagrams.n1MetaIndex, actionViewMode === 'delta');
        applyContingencyHighlight(diagrams.n1SvgContainerRef.current, diagrams.n1MetaIndex, selectedBranch);
      }
    }
    if (tab === 'action') {
      applyDeltaVisuals(diagrams.actionSvgContainerRef.current, actionDiagram, diagrams.actionMetaIndex, actionViewMode === 'delta');

      const actionDetail = result?.actions?.[selectedActionId || ''];

      if (actionDetail) {
        if (actionViewMode !== 'delta') {
          let overloadsToHighlight: string[] = [];

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

          if (diagrams.actionSvgContainerRef.current && diagrams.actionMetaIndex) {
            applyOverloadedHighlights(diagrams.actionSvgContainerRef.current, diagrams.actionMetaIndex, overloadsToHighlight);
          }
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
    }
  }, [n1Diagram, actionDiagram, result, selectedActionId, actionViewMode, selectedBranch, diagrams, monitoringFactor]);

  useEffect(() => {
    const isTabSwitch = prevHighlightTabRef.current !== activeTab;
    prevHighlightTabRef.current = activeTab;
    const otherTabs: TabId[] = ['n', 'n-1', 'action'].filter(t => t !== activeTab) as TabId[];
    otherTabs.forEach(t => staleHighlights.current.add(t));

    if (isTabSwitch) {
      // Double rAF to ensure browser layout is settled before getScreenCTM()
      const id = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          applyHighlightsForTab(activeTab);
          staleHighlights.current.delete(activeTab);
        });
      });
      return () => cancelAnimationFrame(id);
    } else {
      applyHighlightsForTab(activeTab);
      staleHighlights.current.delete(activeTab);
    }
  }, [nDiagram, n1Diagram, actionDiagram, diagrams.nMetaIndex, diagrams.n1MetaIndex, diagrams.actionMetaIndex, result, selectedActionId, actionViewMode, activeTab, selectedBranch, applyHighlightsForTab]);

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

  const handleVlOpen = useCallback((vlName: string) => {
    handleVlDoubleClick(activeTab === 'action' ? selectedActionId || '' : '', vlName);
  }, [handleVlDoubleClick, activeTab, selectedActionId]);

  const handleCancelDialog = useCallback(() => {
    setConfirmDialog(null);
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <Header
        networkPath={networkPath}
        setNetworkPath={setNetworkPath}
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
      <SettingsModal settings={settings} onApply={handleApplySettings} />


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
        <div data-testid="sidebar" style={{ width: '25%', background: '#eee', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column', padding: '15px', gap: '15px', overflowY: 'auto' }}>
          {/* Target Contingency selector */}
          {branches.length > 0 && (
            <div style={{ padding: '10px 15px', background: 'white', borderRadius: '8px', border: '1px solid #dee2e6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🎯 Select Contingency</label>
              <input
                list="contingencies"
                value={selectedBranch}
                onChange={handleContingencyChange}
                placeholder="Search line/bus..."
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontSize: '0.85rem' }}
              />
              <datalist id="contingencies">
                {contingencyOptions}
              </datalist>
            </div>
          )}

          <div style={{ flexShrink: 0 }}>
            <OverloadPanel
              nOverloads={nDiagram?.lines_overloaded || []}
              n1Overloads={n1Diagram?.lines_overloaded || []}
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
            />
          </div>
          <div style={{ flexShrink: 0 }}>
            <ActionFeed
              actions={result?.actions || {}}
              actionScores={result?.action_scores}
              linesOverloaded={result?.lines_overloaded || []}
              selectedActionId={selectedActionId}
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
              analysisLoading={analysisLoading}
              monitoringFactor={monitoringFactor}
              onVlDoubleClick={handleVlDoubleClick}
              recommenderConfig={recommenderConfig}
              actionDictFileName={actionDictFileName}
              actionDictStats={actionDictStats}
              onOpenSettings={handleOpenSettings}
              onUpdateCombinedEstimation={handleUpdateCombinedEstimation}
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
            inspectQuery={inspectQuery}
            onInspectQueryChange={handleInspectQueryChange}
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
