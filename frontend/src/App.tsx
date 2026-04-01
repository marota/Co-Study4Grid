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
import { api } from './api';
import { applyOverloadedHighlights, applyDeltaVisuals, applyActionTargetHighlights, applyContingencyHighlight, processSvg } from './utils/svgUtils';
import type { ActionDetail, TabId } from './types';
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
    configFilePath, setConfigFilePath, changeConfigFilePath, lastActiveConfigFilePath,
    networkPath, setNetworkPath, actionPath, setActionPath,
    layoutPath, setLayoutPath, outputFolderPath, setOutputFolderPath,
    minLineReconnections, setMinLineReconnections,
    minCloseCoupling, setMinCloseCoupling,
    minOpenCoupling, setMinOpenCoupling,
    minLineDisconnections, setMinLineDisconnections,
    nPrioritizedActions, setNPrioritizedActions,
    minPst, setMinPst,
    minLoadShedding, setMinLoadShedding,
    ignoreReconnections, setIgnoreReconnections,
    linesMonitoringPath, setLinesMonitoringPath,
    monitoredLinesCount, totalLinesCount,
    showMonitoringWarning, setShowMonitoringWarning,
    monitoringFactor, setMonitoringFactor,
    preExistingOverloadThreshold, setPreExistingOverloadThreshold,
    pypowsyblFastMode, setPypowsyblFastMode,
    actionDictFileName, actionDictStats,
    isSettingsOpen, setIsSettingsOpen,
    settingsTab, setSettingsTab,
    pickSettingsPath,
    handleOpenSettings, handleCloseSettings,
    buildConfigRequest, applyConfigResponse, createCurrentBackup, setSettingsBackup
  } = settings;

  const [selectedBranch, setSelectedBranch] = useState<string>('');
  const [branches, setBranches] = useState<string[]>([]);
  const [voltageLevels, setVoltageLevels] = useState<string[]>([]);
  const diagrams = useDiagrams(branches, voltageLevels, selectedBranch);
  const [configLoading, setConfigLoading] = useState(false);
  const [error, setError] = useState('');

  // Confirmation dialog state for contingency change / load study
  const [confirmDialog, setConfirmDialog] = useState<{ type: 'contingency' | 'loadStudy'; pendingBranch?: string } | null>(null);

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
    activeTab, setActiveTab, nDiagram, n1Diagram, n1Loading,
    selectedActionId, actionDiagram, actionDiagramLoading, actionViewMode,
    inspectQuery, setInspectQuery, uniqueVoltages, voltageRange, setVoltageRange,
    vlOverlay, handleViewModeChange, handleManualZoomIn, handleManualZoomOut,
    handleManualReset, handleVlDoubleClick, handleOverlaySldTabChange, handleOverlayClose,
    inspectableItems,
    nSvgContainerRef, n1SvgContainerRef, actionSvgContainerRef
  } = diagrams;

  const filteredBranches = useMemo(() => {
    const q = selectedBranch.toUpperCase();
    if (!q) return branches.slice(0, 50);
    return branches.filter(b => b.toUpperCase().includes(q)).slice(0, 50);
  }, [branches, selectedBranch]);

  const session = useSession();
  const {
    showReloadModal, setShowReloadModal, sessionList, sessionListLoading, sessionRestoring
  } = session;

  // ===== Cross-Hook Wiring wrappers =====
  const wrappedActionSelect = (actionId: string | null) =>
    diagrams.handleActionSelect(actionId, result, selectedBranch, voltageLevels.length, setResult, setError);

  const wrappedActionFavorite = (actionId: string) =>
    actionsHook.handleActionFavorite(actionId, setResult);

  const wrappedManualActionAdded = (actionId: string, detail: ActionDetail, linesOverloaded: string[]) =>
    actionsHook.handleManualActionAdded(actionId, detail, linesOverloaded, setResult, wrappedActionSelect);

  // Clear all contingency-related analysis state (preserves network/config)
  const clearContingencyState = useCallback(() => {
    analysis.setResult(null);
    analysis.setPendingAnalysisResult(null);
    analysis.setSelectedOverloads(new Set());
    analysis.setMonitorDeselected(false);
    actionsHook.clearActionState();
    diagrams.setSelectedActionId(null);
    diagrams.setActionDiagram(null);
    diagrams.setActiveTab('n');
    diagrams.setVlOverlay(null);
    setError('');
    analysis.setInfoMessage('');
    diagrams.setInspectQuery('');
    diagrams.lastZoomState.current = { query: '', branch: '' };
  }, [setError, actionsHook, analysis, diagrams]);

  const wrappedRunAnalysis = () =>
    analysis.handleRunAnalysis(selectedBranch, clearContingencyState, actionsHook.setSuggestedByRecommenderIds, diagrams.setActiveTab);

  const wrappedDisplayPrioritized = () =>
    analysis.handleDisplayPrioritizedActions(selectedActionIds);

  const wrappedAssetClick = (actionId: string, assetName: string, tab: 'action' | 'n' | 'n-1' = 'action') =>
    diagrams.handleAssetClick(actionId, assetName, tab, diagrams.selectedActionId, wrappedActionSelect);

  const wrappedSaveResults = () => {
    session.handleSaveResults({
      networkPath, actionPath, layoutPath, outputFolderPath,
      minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, minPst, minLoadShedding,
      nPrioritizedActions, linesMonitoringPath, monitoringFactor,
      preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode,
      selectedBranch, selectedOverloads, monitorDeselected,
      nOverloads: nDiagram?.lines_overloaded ?? [],
      n1Overloads: n1Diagram?.lines_overloaded ?? [],
      result, selectedActionIds, rejectedActionIds, manuallyAddedIds, suggestedByRecommenderIds,
      setError, setInfoMessage: analysis.setInfoMessage
    });
  };

  const wrappedOpenReloadModal = () => session.handleOpenReloadModal(outputFolderPath, setError);

  const wrappedRestoreSession = (sessionName: string) => {
    session.handleRestoreSession(sessionName, {
      outputFolderPath,
      setNetworkPath, setActionPath, setLayoutPath,
      setMinLineReconnections, setMinCloseCoupling, setMinOpenCoupling, setMinLineDisconnections, setMinPst, setMinLoadShedding,
      setNPrioritizedActions, setLinesMonitoringPath, setMonitoringFactor, setPreExistingOverloadThreshold,
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
      applyConfigResponse, setBranches, setVoltageLevels, setNominalVoltageMap: diagrams.setNominalVoltageMap,
      setUniqueVoltages: diagrams.setUniqueVoltages, fetchBaseDiagram: diagrams.fetchBaseDiagram,
      setVoltageRange: diagrams.setVoltageRange
    });
  };

  // Check if there is any analysis state that would be lost on contingency change
  const hasAnalysisState = useCallback(() => {
    return !!(result || pendingAnalysisResult || selectedActionId || actionDiagram || manuallyAddedIds.size > 0 || selectedActionIds.size > 0 || rejectedActionIds.size > 0);
  }, [result, pendingAnalysisResult, selectedActionId, actionDiagram, manuallyAddedIds, selectedActionIds, rejectedActionIds]);


  const handleApplySettings = useCallback(async () => {
    interactionLogger.record('settings_applied');
    try {
      setError('');
      analysis.setInfoMessage('');
      diagrams.setNDiagram(null);
      diagrams.setN1Diagram(null);
      diagrams.setActionDiagram(null);
      diagrams.setOriginalViewBox(null);
      setResult(null);
      analysis.setPendingAnalysisResult(null);
      diagrams.setSelectedActionId(null);
      actionsHook.clearActionState();
      analysis.setSelectedOverloads(new Set());
      analysis.setMonitorDeselected(false);
      diagrams.setActiveTab('n');
      diagrams.setActionViewMode('network');
      diagrams.setVlOverlay(null);
      diagrams.setN1Loading(false);
      diagrams.setActionDiagramLoading(false);
      setSelectedBranch('');
      diagrams.committedBranchRef.current = '';
      diagrams.setInspectQuery('');
      diagrams.lastZoomState.current = { query: '', branch: '' };
      diagrams.actionSyncSourceRef.current = null;
      setShowMonitoringWarning(false);

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
  }, [networkPath, actionPath, buildConfigRequest, applyConfigResponse, createCurrentBackup, setResult, setError, setShowMonitoringWarning, setSettingsBackup, setIsSettingsOpen, actionsHook, analysis, diagrams]);


  const handleLoadConfig = useCallback(async () => {
    setConfigLoading(true);
    setError('');
    analysis.setInfoMessage('');
    diagrams.setNDiagram(null);
    diagrams.setN1Diagram(null);
    diagrams.setActionDiagram(null);
    diagrams.setOriginalViewBox(null);
    setResult(null);
    analysis.setPendingAnalysisResult(null);
    diagrams.setSelectedActionId(null);
    actionsHook.clearActionState();
    analysis.setSelectedOverloads(new Set());
    analysis.setMonitorDeselected(false);
    diagrams.setActiveTab('n');
    diagrams.setActionViewMode('network');
    diagrams.setVlOverlay(null);
    diagrams.setN1Loading(false);
    diagrams.setActionDiagramLoading(false);
    setSelectedBranch('');
    diagrams.committedBranchRef.current = '';
    diagrams.setInspectQuery('');
    diagrams.lastZoomState.current = { query: '', branch: '' };
    diagrams.actionSyncSourceRef.current = null;
    setShowMonitoringWarning(false);

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
  }, [buildConfigRequest, applyConfigResponse, setResult, setError, setShowMonitoringWarning, actionsHook, analysis, diagrams]);

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
          const stillOverloaded: string[] = [];
          if (overloadedLines.length > 0 && actionDetail.rho_after) {
            overloadedLines.forEach((name, i) => {
              if (actionDetail.rho_after![i] != null && actionDetail.rho_after![i] > 1.0) {
                stillOverloaded.push(name);
              }
            });
          }
          if (actionDetail.max_rho != null && actionDetail.max_rho > 1.0 && actionDetail.max_rho_line) {
            if (!stillOverloaded.includes(actionDetail.max_rho_line)) {
              stillOverloaded.push(actionDetail.max_rho_line);
            }
          }
          if (diagrams.actionSvgContainerRef.current && diagrams.actionMetaIndex) {
            applyOverloadedHighlights(diagrams.actionSvgContainerRef.current, diagrams.actionMetaIndex, stillOverloaded);
          }
        }

        if (diagrams.actionSvgContainerRef.current) {
          applyActionTargetHighlights(diagrams.actionSvgContainerRef.current, diagrams.actionMetaIndex, actionDetail, selectedActionId);
          applyContingencyHighlight(diagrams.actionSvgContainerRef.current, diagrams.actionMetaIndex, selectedBranch);
        }
      } else {
        if (diagrams.actionSvgContainerRef.current) {
          applyActionTargetHighlights(diagrams.actionSvgContainerRef.current, null, null, null);
        }
      }
    }
  }, [n1Diagram, actionDiagram, result, selectedActionId, actionViewMode, selectedBranch, diagrams]);

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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
      <header style={{
        background: '#2c3e50', color: 'white', padding: '8px 20px',
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        gap: '15px', flexWrap: 'wrap'
      }}>
        <h2 style={{ margin: 0, fontSize: '1.1rem', whiteSpace: 'nowrap' }}>⚡ Co-Study4Grid</h2>

        <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <label style={{ fontSize: '0.7rem', opacity: 0.8, whiteSpace: 'nowrap' }}>Network Path</label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              type="text" value={networkPath} onChange={e => setNetworkPath(e.target.value)}
              placeholder="load your grid xiidm file path"
              style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: '0.8rem' }}
            />
            <button
              onClick={() => pickSettingsPath('file', setNetworkPath)}
              style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px', color: 'white', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              📄
            </button>
          </div>
        </div>

        <button
          onClick={handleLoadStudyClick} disabled={configLoading}
          style={{ padding: '6px 14px', background: configLoading ? '#95a5a6' : '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: configLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        >
          {configLoading ? '⏳ Loading...' : '🔄 Load Study'}
        </button>

        <button
          onClick={wrappedSaveResults}
          disabled={!result && !selectedBranch}
          style={{
            padding: '6px 14px',
            background: (!result && !selectedBranch) ? '#95a5a6' : '#8e44ad',
            color: 'white', border: 'none', borderRadius: '4px',
            cursor: (!result && !selectedBranch) ? 'not-allowed' : 'pointer',
            fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap'
          }}
          title="Save session results to JSON"
        >
          💾 Save Results
        </button>

        <button
          onClick={wrappedOpenReloadModal}
          disabled={sessionRestoring}
          style={{
            padding: '6px 14px',
            background: sessionRestoring ? '#95a5a6' : '#2980b9',
            color: 'white', border: 'none', borderRadius: '4px',
            cursor: sessionRestoring ? 'not-allowed' : 'pointer',
            fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap'
          }}
          title="Reload a previously saved session"
        >
          {sessionRestoring ? 'Restoring...' : 'Reload Session'}
        </button>

        <button
          onClick={() => handleOpenSettings('paths')}
          style={{ background: '#7f8c8d', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '6px 8px', fontSize: '1rem', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          title="Settings"
        >
          &#9881;
        </button>
      </header>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000,
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div
            role="dialog"
            style={{
              background: 'white', padding: '25px', borderRadius: '8px',
              width: '450px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
              display: 'flex', flexDirection: 'column', gap: '15px', color: 'black'
            }}
          >
            <div style={{ display: 'flex', borderBottom: '1px solid #eee', marginBottom: '15px' }}>
              <button
                onClick={() => { interactionLogger.record('settings_tab_changed', { tab: 'paths' }); setSettingsTab('paths'); }}
                style={{
                  flex: 1, padding: '10px', cursor: 'pointer', background: 'none',
                  border: 'none', borderBottom: settingsTab === 'paths' ? '2px solid #3498db' : 'none',
                  fontWeight: settingsTab === 'paths' ? 'bold' : 'normal',
                  color: settingsTab === 'paths' ? '#3498db' : '#555'
                }}
              >
                Paths
              </button>
              <button
                onClick={() => { interactionLogger.record('settings_tab_changed', { tab: 'recommender' }); setSettingsTab('recommender'); }}
                style={{
                  flex: 1, padding: '10px', cursor: 'pointer', background: 'none',
                  border: 'none', borderBottom: settingsTab === 'recommender' ? '2px solid #3498db' : 'none',
                  fontWeight: settingsTab === 'recommender' ? 'bold' : 'normal',
                  color: settingsTab === 'recommender' ? '#3498db' : '#555'
                }}
              >
                Recommender
              </button>
              <button
                onClick={() => { interactionLogger.record('settings_tab_changed', { tab: 'configurations' }); setSettingsTab('configurations'); }}
                style={{
                  flex: 1, padding: '10px', cursor: 'pointer', background: 'none',
                  border: 'none', borderBottom: settingsTab === 'configurations' ? '2px solid #3498db' : 'none',
                  fontWeight: settingsTab === 'configurations' ? 'bold' : 'normal',
                  color: settingsTab === 'configurations' ? '#3498db' : '#555'
                }}
              >
                Configurations
              </button>
            </div>

            {settingsTab === 'paths' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label htmlFor="networkPathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Network File Path (.xiidm)</label>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-3px' }}>Synchronized with the banner field</div>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input id="networkPathInput" type="text" value={networkPath} onChange={e => setNetworkPath(e.target.value)} placeholder="load your grid xiidm file path" style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <button onClick={() => pickSettingsPath('file', setNetworkPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📄</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label htmlFor="actionPathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Action Dictionary File Path</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input id="actionPathInput" type="text" value={actionPath} onChange={e => setActionPath(e.target.value)} style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <button onClick={() => pickSettingsPath('file', setActionPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📄</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label htmlFor="layoutPathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Layout File Path (.json)</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input id="layoutPathInput" type="text" value={layoutPath} onChange={e => setLayoutPath(e.target.value)} style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <button onClick={() => pickSettingsPath('file', setLayoutPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📄</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Output Folder Path</label>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-3px' }}>Session folders (JSON + PDF) are saved here. Leave empty to download JSON to browser.</div>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input type="text" value={outputFolderPath} onChange={e => setOutputFolderPath(e.target.value)} placeholder="e.g. /home/user/sessions" style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <button onClick={() => pickSettingsPath('dir', setOutputFolderPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📂</button>
                  </div>
                </div>
                <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '5px 0' }} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label htmlFor="configFilePathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Config File Path</label>
                  <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-3px' }}>
                    Path to the <code>config.json</code> settings file. Change this to use a config stored outside the repository.
                    The file will be created from defaults if it does not exist.
                  </div>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input
                      id="configFilePathInput"
                      type="text"
                      value={configFilePath}
                      onChange={e => setConfigFilePath(e.target.value)}
                      onBlur={e => changeConfigFilePath(e.target.value).catch(() => { })}
                      placeholder="e.g. /home/user/my_costudy4grid_config.json"
                      style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
                    />
                    <button
                      onClick={() => pickSettingsPath('file', (p) => changeConfigFilePath(p).catch(() => { }))}
                      style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}
                    >📄</button>
                  </div>
                </div>
              </div>
            )}

            {settingsTab === 'recommender' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Min Line Reconnections</label>
                  <input type="number" step="0.1" value={minLineReconnections} onChange={e => setMinLineReconnections(parseFloat(e.target.value))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Min Close Coupling</label>
                  <input type="number" step="0.1" value={minCloseCoupling} onChange={e => setMinCloseCoupling(parseFloat(e.target.value))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Min Open Coupling</label>
                  <input type="number" step="0.1" value={minOpenCoupling} onChange={e => setMinOpenCoupling(parseFloat(e.target.value))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Min Line Disconnections</label>
                  <input type="number" step="0.1" value={minLineDisconnections} onChange={e => setMinLineDisconnections(parseFloat(e.target.value))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Min PST Actions</label>
                  <input type="number" step="0.1" value={minPst} onChange={e => setMinPst(parseFloat(e.target.value))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Min Load Shedding</label>
                  <input type="number" step="0.1" value={minLoadShedding} onChange={e => setMinLoadShedding(parseFloat(e.target.value))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>N Prioritized Actions</label>
                  <input type="number" step="1" value={nPrioritizedActions} onChange={e => setNPrioritizedActions(parseInt(e.target.value, 10))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #eee' }}>
                  <input type="checkbox" id="ignoreRec" checked={ignoreReconnections} onChange={e => setIgnoreReconnections(e.target.checked)} style={{ width: '16px', height: '16px' }} />
                  <label htmlFor="ignoreRec" style={{ fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>Ignore Reconnections</label>
                </div>
              </div>
            )}

            {settingsTab === 'configurations' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label htmlFor="monitoringFactor" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Monitoring Factor Thermal Limits</label>
                  <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                    <input id="monitoringFactor" type="number" step="0.01" min="0" max="2" value={monitoringFactor} onChange={e => setMonitoringFactor(parseFloat(e.target.value))} style={{ padding: '6px', width: '80px', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <span style={{ fontSize: '0.85rem', color: '#666' }}>Multiplier applied to standard limits (e.g., 0.95)</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Lines Monitoring File (Optional)</label>
                  <div style={{ display: 'flex', gap: '5px' }}>
                    <input type="text" value={linesMonitoringPath} onChange={e => setLinesMonitoringPath(e.target.value)} placeholder="Leave empty for IGNORE_LINES_MONITORING=True" style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                    <button onClick={() => pickSettingsPath('file', setLinesMonitoringPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📁</button>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Pre-existing Overload Threshold</label>
                  <input type="number" step="0.01" min="0" max="1" value={preExistingOverloadThreshold} onChange={e => setPreExistingOverloadThreshold(parseFloat(e.target.value))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
                <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-10px' }}>
                  Pre-existing overloads excluded from N-1 & max loading unless worsened by this fraction (default 2%)
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #eee' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <input type="checkbox" id="fastMode" checked={pypowsyblFastMode} onChange={e => setPypowsyblFastMode(e.target.checked)} style={{ width: '16px', height: '16px' }} />
                      <label htmlFor="fastMode" style={{ fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>Pypowsybl Fast Mode</label>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: '#666', fontStyle: 'italic', marginLeft: '26px' }}>
                      Disable voltage control in pypowsybl for faster simulations (may affect convergence)
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', gap: '10px' }}>
              <button
                onClick={handleCloseSettings}
                style={{
                  padding: '8px 20px', background: '#e74c3c', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                }}
              >
                Close
              </button>
              <button
                onClick={handleApplySettings}
                style={{
                  padding: '8px 20px', background: '#3498db', color: 'white',
                  border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold'
                }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Reload Session Modal */}
      {showReloadModal && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3500,
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{
            background: 'white', borderRadius: '10px',
            width: '500px', maxWidth: '95vw', maxHeight: '70vh',
            display: 'flex', flexDirection: 'column',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)', color: 'black'
          }}>
            <div style={{ padding: '15px 20px', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0, fontSize: '1.1rem' }}>Reload Session</h3>
              <button onClick={() => setShowReloadModal(false)} style={{ border: 'none', background: 'none', fontSize: '20px', cursor: 'pointer', color: '#999' }}>&times;</button>
            </div>
            <div style={{ padding: '15px 20px', fontSize: '0.8rem', color: '#666', borderBottom: '1px solid #f0f0f0' }}>
              From: {outputFolderPath}
            </div>
            <div style={{ flex: 1, overflowY: 'auto', padding: '10px 20px' }}>
              {sessionListLoading ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#999' }}>Loading sessions...</div>
              ) : sessionList.length === 0 ? (
                <div style={{ padding: '30px', textAlign: 'center', color: '#999' }}>No saved sessions found in this folder.</div>
              ) : (
                sessionList.map(name => (
                  <div
                    key={name}
                    onClick={() => !sessionRestoring && wrappedRestoreSession(name)}
                    style={{
                      padding: '10px 12px', margin: '4px 0',
                      border: '1px solid #eee', borderRadius: '6px',
                      cursor: sessionRestoring ? 'not-allowed' : 'pointer',
                      fontSize: '0.85rem', fontFamily: 'monospace',
                      transition: 'background 0.15s',
                      opacity: sessionRestoring ? 0.5 : 1,
                    }}
                    onMouseOver={e => { if (!sessionRestoring) (e.currentTarget as HTMLElement).style.background = '#e7f1ff'; }}
                    onMouseOut={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                  >
                    {name}
                  </div>
                ))
              )}
            </div>
            <div style={{ padding: '12px 20px', borderTop: '1px solid #eee', display: 'flex', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowReloadModal(false)}
                style={{ padding: '8px 20px', background: '#95a5a6', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div data-testid="sidebar" style={{ width: '25%', background: '#eee', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column', padding: '15px', gap: '15px', overflowY: 'auto' }}>
          {/* Target Contingency selector */}
          {branches.length > 0 && (
            <div style={{ padding: '10px 15px', background: 'white', borderRadius: '8px', border: '1px solid #dee2e6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🎯 Select Contingency</label>
              <input
                list="contingencies"
                value={selectedBranch}
                onChange={e => { interactionLogger.record('contingency_selected', { element: e.target.value }); setSelectedBranch(e.target.value); }}
                placeholder="Search line/bus..."
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontSize: '0.85rem' }}
              />
              <datalist id="contingencies">
                {filteredBranches.map(b => <option key={b} value={b} />)}
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
              onDismissWarning={() => setShowMonitoringWarning(false)}
              onOpenSettings={() => { setIsSettingsOpen(true); setSettingsTab('configurations'); }}
              selectedOverloads={selectedOverloads}
              onToggleOverload={analysis.handleToggleOverload}
              monitorDeselected={monitorDeselected}
              onToggleMonitorDeselected={() => analysis.setMonitorDeselected(!analysis.monitorDeselected)}
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
              minLineReconnections={minLineReconnections}
              minCloseCoupling={minCloseCoupling}
              minOpenCoupling={minOpenCoupling}
              minLineDisconnections={minLineDisconnections}
              minPst={minPst}
              minLoadShedding={minLoadShedding}
              nPrioritizedActions={nPrioritizedActions}
              ignoreReconnections={ignoreReconnections}
              actionDictFileName={actionDictFileName}
              actionDictStats={actionDictStats}
              onOpenSettings={handleOpenSettings}
            />
          </div>
        </div>
        <div style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column' }}>
          <VisualizationPanel
            activeTab={activeTab}
            configLoading={configLoading}
            onTabChange={(tab: TabId) => { interactionLogger.record('diagram_tab_changed', { tab }); setActiveTab(tab); }}
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
            onVoltageRangeChange={(range: [number, number]) => { interactionLogger.record('voltage_range_changed', { min: range[0], max: range[1] }); setVoltageRange(range); }}
            actionViewMode={actionViewMode}
            onViewModeChange={handleViewModeChange}
            inspectQuery={inspectQuery}
            onInspectQueryChange={(q: string) => { interactionLogger.record('inspect_query_changed', { query: q }); setInspectQuery(q); }}
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
            onVlOpen={(vlName) => handleVlDoubleClick(activeTab === 'action' ? selectedActionId || '' : '', vlName)}
            networkPath={networkPath}
            layoutPath={layoutPath}
            onOpenSettings={handleOpenSettings}
          />
        </div>
      </div>
      {/* Confirmation Dialog for contingency change / load study */}
      {confirmDialog && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 4000,
          display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
          <div style={{
            background: 'white', padding: '25px', borderRadius: '10px',
            boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
            maxWidth: '450px', width: '90%', textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', marginBottom: '12px' }}>&#9888;</div>
            <h3 style={{ margin: '0 0 12px', color: '#2c3e50', fontSize: '1.1rem' }}>
              {confirmDialog.type === 'contingency' ? 'Change Contingency?' : 'Reload Study?'}
            </h3>
            <p style={{ margin: '0 0 20px', color: '#555', fontSize: '0.9rem', lineHeight: '1.5' }}>
              All previous analysis results, manual simulations, action selections, and diagrams will be cleared.
              {confirmDialog.type === 'contingency'
                ? ' The network state will be preserved.'
                : ' The network will be reloaded from scratch.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
              <button
                onClick={() => setConfirmDialog(null)}
                style={{
                  padding: '8px 20px', background: '#95a5a6', color: 'white',
                  border: 'none', borderRadius: '5px', cursor: 'pointer',
                  fontWeight: 'bold', fontSize: '0.85rem'
                }}
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmDialog}
                style={{
                  padding: '8px 20px', background: '#e67e22', color: 'white',
                  border: 'none', borderRadius: '5px', cursor: 'pointer',
                  fontWeight: 'bold', fontSize: '0.85rem'
                }}
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
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
