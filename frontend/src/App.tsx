import { useState, useEffect, useCallback, useRef } from 'react';
import './App.css';
import VisualizationPanel from './components/VisualizationPanel';
import ActionFeed from './components/ActionFeed';
import OverloadPanel from './components/OverloadPanel';
import { api } from './api';
import { usePanZoom } from './hooks/usePanZoom';
import {
  buildMetadataIndex, applyOverloadedHighlights,
  applyDeltaVisuals, applyActionTargetHighlights, applyContingencyHighlight,
  getIdMap, invalidateIdMapCache,
} from './utils/svgUtils';
import { processSvgAsync } from './utils/svgWorkerClient';
import type { ActionDetail, AnalysisResult, DiagramData, ViewBox, MetadataIndex, TabId, SettingsBackup, VlOverlay, SldTab, FlowDelta, AssetDelta, SessionResult, CombinedAction } from './types';
import { buildSessionResult } from './utils/sessionUtils';
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
    analysis.handleRunAnalysis(selectedBranch, clearContingencyState, actionsHook.setSuggestedByRecommenderIds);

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

  // ===== Analysis State =====
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const prevResultRef = useRef<AnalysisResult | null>(result);
  useEffect(() => { prevResultRef.current = result; }, [result]);
  const [pendingAnalysisResult, setPendingAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [manuallyAddedIds, setManuallyAddedIds] = useState<Set<string>>(new Set());
  const [rejectedActionIds, setRejectedActionIds] = useState<Set<string>>(new Set());
  // Tracks every action ID ever returned by the recommender for the current contingency.
  // Kept separate from manuallyAddedIds so an action can be both is_suggested AND
  // is_manually_simulated when the user simulated it before the recommender returned it.
  const [suggestedByRecommenderIds, setSuggestedByRecommenderIds] = useState<Set<string>>(new Set());
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');

  useEffect(() => {
    if (infoMessage) {
      const timer = setTimeout(() => {
        setInfoMessage('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [infoMessage]);

  // ===== Analysis Flow State =====
  const [selectedOverloads, setSelectedOverloads] = useState<Set<string>>(new Set());
  const [monitorDeselected, setMonitorDeselected] = useState(false);

  // ===== Visualization State =====
  const [activeTab, setActiveTab] = useState<TabId>('n');
  const activeTabRef = useRef<TabId>(activeTab);
  useLayoutEffect(() => { activeTabRef.current = activeTab; }, [activeTab]);
  const prevTabRef = useRef<TabId>(activeTab);

  const [nDiagram, setNDiagram] = useState<DiagramData | null>(null);
  const [n1Diagram, setN1Diagram] = useState<DiagramData | null>(null);
  const [n1Loading, setN1Loading] = useState(false);

  // Action variant diagram state
  const [selectedActionId, setSelectedActionId] = useState<string | null>(null);
  const [actionDiagram, setActionDiagram] = useState<DiagramData | null>(null);
  const [actionDiagramLoading, setActionDiagramLoading] = useState(false);

  // Delta visualization mode
  const [actionViewMode, setActionViewMode] = useState<'network' | 'delta'>('network');

  const [originalViewBox, setOriginalViewBox] = useState<ViewBox | null>(null);
  const [inspectQuery, setInspectQuery] = useState('');

  // Independent Refs for N, N-1, and Action Variant
  const nSvgContainerRef = useRef<HTMLDivElement>(null);
  const n1SvgContainerRef = useRef<HTMLDivElement>(null);
  const actionSvgContainerRef = useRef<HTMLDivElement>(null);

  // Native Pan/Zoom Instances
  const nPZ = usePanZoom(nSvgContainerRef, nDiagram?.originalViewBox, activeTab === 'n');
  const n1PZ = usePanZoom(n1SvgContainerRef, n1Diagram?.originalViewBox, activeTab === 'n-1');
  const actionPZ = usePanZoom(actionSvgContainerRef, actionDiagram?.originalViewBox, activeTab === 'action');

  // Zoom state tracking
  const lastZoomState = useRef({ query: '', branch: '' });
  // Captured viewBox to re-apply after the action diagram loads
  const actionSyncSourceRef = useRef<ViewBox | null>(null);

  const fetchBaseDiagram = useCallback(async (vlCount: number) => {
    try {
      const res = await api.getNetworkDiagram();
      const { svg, viewBox } = await processSvgAsync(res.svg, vlCount || 0);
      if (viewBox) setOriginalViewBox(viewBox);
      setNDiagram({ ...res, svg, originalViewBox: viewBox });
    } catch (err) {
      console.error('Failed to fetch diagram:', err);
    }
  }, []);

  const handleOpenSettings = useCallback((tab: 'recommender' | 'configurations' | 'paths' = 'paths') => {
    interactionLogger.record('settings_opened', { tab });
    setSettingsBackup({
      networkPath,
      actionPath,
      layoutPath,
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

  const handleCloseSettings = useCallback(() => {
    interactionLogger.record('settings_cancelled');
    if (settingsBackup) {
      if (settingsBackup.networkPath !== undefined) setNetworkPath(settingsBackup.networkPath);
      if (settingsBackup.actionPath !== undefined) setActionPath(settingsBackup.actionPath);
      if (settingsBackup.layoutPath !== undefined) setLayoutPath(settingsBackup.layoutPath);
      if (settingsBackup.outputFolderPath !== undefined) setOutputFolderPath(settingsBackup.outputFolderPath);
      setMinLineReconnections(settingsBackup.minLineReconnections);
      setMinCloseCoupling(settingsBackup.minCloseCoupling);
      setMinOpenCoupling(settingsBackup.minOpenCoupling);
      setMinLineDisconnections(settingsBackup.minLineDisconnections);
      setNPrioritizedActions(settingsBackup.nPrioritizedActions);
      setLinesMonitoringPath(settingsBackup.linesMonitoringPath);
      setMonitoringFactor(settingsBackup.monitoringFactor);
      setPreExistingOverloadThreshold(settingsBackup.preExistingOverloadThreshold);
      setIgnoreReconnections(settingsBackup.ignoreReconnections ?? false);
      setPypowsyblFastMode(settingsBackup.pypowsyblFastMode ?? true);
    }
    setIsSettingsOpen(false);
  }, [settingsBackup]);

  const handleApplySettings = useCallback(async () => {
    interactionLogger.record('settings_applied', {
      network_path: networkPath, action_file_path: actionPath, layout_path: layoutPath,
      output_folder_path: outputFolderPath,
      min_line_reconnections: minLineReconnections, min_close_coupling: minCloseCoupling,
      min_open_coupling: minOpenCoupling, min_line_disconnections: minLineDisconnections,
      min_pst: minPst, n_prioritized_actions: nPrioritizedActions,
      lines_monitoring_path: linesMonitoringPath, monitoring_factor: monitoringFactor,
      pre_existing_overload_threshold: preExistingOverloadThreshold,
      ignore_reconnections: ignoreReconnections, pypowsybl_fast_mode: pypowsyblFastMode,
    });
    try {
      // ── Clear ALL state for a full reset (same as handleLoadConfig) ──
      setError('');
      setInfoMessage('');
      setNDiagram(null);
      setN1Diagram(null);
      setActionDiagram(null);
      setOriginalViewBox(null);
      setResult(null);
      setPendingAnalysisResult(null);
      setSelectedActionId(null);
      setSelectedActionIds(new Set());
      setManuallyAddedIds(new Set());
      setRejectedActionIds(new Set());
      setSuggestedByRecommenderIds(new Set());
      setAnalysisLoading(false);
      setSelectedOverloads(new Set());
      setMonitorDeselected(false);
      setActiveTab('n');
      setActionViewMode('network');
      setVlOverlay(null);
      setN1Loading(false);
      setActionDiagramLoading(false);
      setSelectedBranch('');
      committedBranchRef.current = '';
      setInspectQuery('');
      lastZoomState.current = { query: '', branch: '' };
      actionSyncSourceRef.current = null;
      setShowMonitoringWarning(false);

      if (!networkPath || !actionPath) {
        setSettingsBackup({
          networkPath,
          actionPath,
          layoutPath,
          outputFolderPath,
          minLineReconnections,
          minCloseCoupling,
          minOpenCoupling,
          minLineDisconnections,
          nPrioritizedActions,
          linesMonitoringPath,
          monitoringFactor,
          preExistingOverloadThreshold,
          ignoreReconnections,
          pypowsyblFastMode,
        });
        setIsSettingsOpen(false);
        return;
      }

      const configRes = await api.updateConfig({
        network_path: networkPath,
        action_file_path: actionPath,
        layout_path: layoutPath,
        min_line_reconnections: minLineReconnections,
        min_close_coupling: minCloseCoupling,
        min_open_coupling: minOpenCoupling,
        min_line_disconnections: minLineDisconnections,
        min_pst: minPst,
        n_prioritized_actions: nPrioritizedActions,
        lines_monitoring_path: linesMonitoringPath,
        monitoring_factor: monitoringFactor,
        pre_existing_overload_threshold: preExistingOverloadThreshold,
        ignore_reconnections: ignoreReconnections,
        pypowsybl_fast_mode: pypowsyblFastMode,
      });

      if (configRes && configRes.total_lines_count !== undefined) {
        setMonitoredLinesCount(configRes.monitored_lines_count);
        setTotalLinesCount(configRes.total_lines_count);
        if (configRes.monitored_lines_count < configRes.total_lines_count) {
          setShowMonitoringWarning(true);
        }
      }
      if (configRes?.action_dict_file_name) setActionDictFileName(configRes.action_dict_file_name);
      if (configRes?.action_dict_stats) setActionDictStats(configRes.action_dict_stats);


      // Fetch study-related data (branches, nominal voltages etc.)
      const [branchesList, vlRes, nomVRes] = await Promise.all([
        api.getBranches(),
        api.getVoltageLevels(),
        api.getNominalVoltages(),
      ]);

      setBranches(branchesList);
      setVoltageLevels(vlRes);
      setSelectedBranch('');

      setNominalVoltageMap(nomVRes.mapping);
      setUniqueVoltages(nomVRes.unique_kv);
      if (nomVRes.unique_kv.length > 0) {
        setVoltageRange([nomVRes.unique_kv[0], nomVRes.unique_kv[nomVRes.unique_kv.length - 1]]);
      }

      fetchBaseDiagram(vlRes.length);

      setSettingsBackup({
        networkPath,
        actionPath,
        layoutPath,
        outputFolderPath,
        minLineReconnections,
        minCloseCoupling,
        minOpenCoupling,
        minLineDisconnections,
        nPrioritizedActions,
        linesMonitoringPath,
        monitoringFactor,
        preExistingOverloadThreshold,
        ignoreReconnections,
        pypowsyblFastMode
      });
      setIsSettingsOpen(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to apply settings: ' + (e.response?.data?.detail || e.message));
    }
  }, [networkPath, actionPath, layoutPath, outputFolderPath, minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, nPrioritizedActions, minPst, linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode, fetchBaseDiagram]);

  // Load paths from localStorage on initial mount
  useEffect(() => {
    const savedNetwork = localStorage.getItem('networkPath');
    const savedAction = localStorage.getItem('actionPath');
    const savedLayout = localStorage.getItem('layoutPath');
    const savedOutput = localStorage.getItem('outputFolderPath');

    setNetworkPath(savedNetwork || '/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_20240828T0100Z_dijon_only');
    setActionPath(savedAction || '/home/marotant/dev/Expert_op4grid_recommender/data/action_space/reduced_model_actions_20240828T0100Z_new_dijon.json');
    setLayoutPath(savedLayout || '');
    setOutputFolderPath(savedOutput || '');
  }, []);

  // Persist paths to localStorage
  useEffect(() => {
    localStorage.setItem('networkPath', networkPath);
    localStorage.setItem('actionPath', actionPath);
    localStorage.setItem('layoutPath', layoutPath);
    localStorage.setItem('outputFolderPath', outputFolderPath);
  }, [networkPath, actionPath, layoutPath, outputFolderPath]);

  // ===== Contingency Change Confirmation Helpers =====
  // Check if there is any analysis state that would be lost on contingency change
  const hasAnalysisState = useCallback(() => {
    return !!(result || pendingAnalysisResult || selectedActionId || actionDiagram || manuallyAddedIds.size > 0 || selectedActionIds.size > 0 || rejectedActionIds.size > 0);
  }, [result, pendingAnalysisResult, selectedActionId, actionDiagram, manuallyAddedIds, selectedActionIds, rejectedActionIds]);

  // Clear all contingency-related analysis state (preserves network/config)
  const clearContingencyState = useCallback(() => {
    setResult(null);
    setPendingAnalysisResult(null);
    setSelectedOverloads(new Set());
    setMonitorDeselected(false);
    setSelectedActionId(null);
    setSelectedActionIds(new Set());
    setManuallyAddedIds(new Set());
    setRejectedActionIds(new Set());
    setSuggestedByRecommenderIds(new Set());
    setActionDiagram(null);
    setN1Diagram(null);
    setActiveTab('n');
    setVlOverlay(null);
    setError('');
    setInfoMessage('');
    setInspectQuery('');
    lastZoomState.current = { query: '', branch: '' };
  }, []);

  // Ref to track the branch for which N-1 was last fetched (the "committed" branch)
  const committedBranchRef = useRef('');
  // Set to true during session restore to prevent the contingency-change confirmation dialog
  const restoringSessionRef = useRef(false);

  // ===== Config Loading =====
  const handleLoadConfig = useCallback(async () => {
    interactionLogger.clear();
    interactionLogger.record('config_loaded', {
      network_path: networkPath, action_file_path: actionPath, layout_path: layoutPath,
      min_line_reconnections: minLineReconnections, min_close_coupling: minCloseCoupling,
      min_open_coupling: minOpenCoupling, min_line_disconnections: minLineDisconnections,
      min_pst: minPst, n_prioritized_actions: nPrioritizedActions,
      lines_monitoring_path: linesMonitoringPath, monitoring_factor: monitoringFactor,
      pre_existing_overload_threshold: preExistingOverloadThreshold,
      ignore_reconnections: ignoreReconnections, pypowsybl_fast_mode: pypowsyblFastMode,
    });
    setConfigLoading(true);
    // ── Clear ALL state for a full reset ──
    // Errors & messages
    setError('');
    setInfoMessage('');
    // Diagrams
    setNDiagram(null);
    setN1Diagram(null);
    setActionDiagram(null);
    setOriginalViewBox(null);
    // Analysis
    setResult(null);
    setPendingAnalysisResult(null);
    setSelectedActionId(null);
    setSelectedActionIds(new Set());
    setManuallyAddedIds(new Set());
    setRejectedActionIds(new Set());
    setSuggestedByRecommenderIds(new Set());
    setAnalysisLoading(false);
    // Analysis flow
    setSelectedOverloads(new Set());
    setMonitorDeselected(false);
    // Visualization
    setActiveTab('n');
    setActionViewMode('network');
    setVlOverlay(null);
    setN1Loading(false);
    setActionDiagramLoading(false);
    // Branch / contingency
    setSelectedBranch('');
    committedBranchRef.current = '';
    setInspectQuery('');
    // Refs
    lastZoomState.current = { query: '', branch: '' };
    actionSyncSourceRef.current = null;
    // Warnings
    setShowMonitoringWarning(false);

  const handleApplySettings = useCallback(async () => {
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
    interactionLogger.record('contingency_confirmed', {
      element: confirmDialog.pendingBranch ?? '',
      dialog_type: confirmDialog.type,
    });
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
    if (result?.pdf_url && analysisLoading) {
      diagrams.setActiveTab('overflow');
    }
  }, [result?.pdf_url, analysisLoading, diagrams]);


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
    if (n1Diagram?.lines_overloaded) {
      setSelectedOverloads(new Set(n1Diagram.lines_overloaded));
    } else {
      setSelectedOverloads(new Set());
    }
  }, [n1Diagram, analysisLoading, n1Loading]);

  const handleRunAnalysis = useCallback(async () => {
    if (!selectedBranch) return;
    clearContingencyState();
    setAnalysisLoading(true);
    setError('');
    setInfoMessage('');

    const step1CorrId = interactionLogger.record('analysis_step1_started', { element: selectedBranch });
    const step1StartTs = new Date().toISOString();

    try {
      // Step 1: Detection
      const res1 = await api.runAnalysisStep1(selectedBranch);
      interactionLogger.recordCompletion('analysis_step1_completed', step1CorrId, {
        element: selectedBranch,
        overloads_found: res1.lines_overloaded || [],
        can_proceed: res1.can_proceed,
        dc_fallback: false,
        message: res1.message || '',
      }, step1StartTs);

      if (!res1.can_proceed) {
        setError(res1.message || 'Analysis cannot proceed.');
        if (res1.message) setInfoMessage(res1.message);
        setAnalysisLoading(false);
        return;
      }

      const detected = res1.lines_overloaded || [];

      // Resolve: selected overloads focus the analysis. If monitorDeselected, also pass unselected ones.
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

      // The backend knows which ones to monitor via the monitor_deselected flag.
      // selected_overloads MUST only contain the ones we actually want to resolve.
      const toResolve = primaryOverloads;

      if (detected.length === 0) {
        setInfoMessage(res1.message || "No overloads detected.");
        setAnalysisLoading(false);
        return;
      }

      // Step 2: Resolution
      const step2CorrId = interactionLogger.record('analysis_step2_started', {
        element: selectedBranch,
        selected_overloads: toResolve,
        all_overloads: detected,
        monitor_deselected: monitorDeselected,
      });
      const step2StartTs = new Date().toISOString();
      const response2 = await fetch('http://localhost:8000/api/run-analysis-step2', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          selected_overloads: toResolve,
          all_overloads: detected,
          monitor_deselected: monitorDeselected,
        }),
      });
      if (!response2.ok) throw new Error('Analysis Resolution failed');

      const reader = response2.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
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
              setActiveTab('overflow');
            } else if (event.type === 'result') {
              // Mark all recommended actions as NOT manual
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
              // Record all IDs returned by the recommender — accumulate across re-runs
              // so that re-analysis for the same contingency still marks prior suggestions.
              setSuggestedByRecommenderIds(prev => new Set([...prev, ...Object.keys(actionsWithFlags)]));
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
        element: selectedBranch,
      }, step2StartTs);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred during analysis.';
      setError(message);
    } finally {
      setAnalysisLoading(false);
    }
  }, [selectedBranch, selectedOverloads, monitorDeselected, clearContingencyState]);

  const handleDisplayPrioritizedActions = useCallback(() => {
    if (!pendingAnalysisResult) return;
    interactionLogger.record('prioritized_actions_displayed', {
      n_actions: Object.keys(pendingAnalysisResult.actions).length,
    });
    setResult(prev => {
      // Preserve manually added / selected actions
      const manualActionsData: Record<string, ActionDetail> = {};
      if (prev?.actions) {
        for (const [id, data] of Object.entries(prev.actions)) {
          if (selectedActionIds.has(id)) {
            manualActionsData[id] = data;
          }
        }
      }

      // Merge new actions with existing ones to preserve estimation data if it was already updated
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
        ...prev,                   // keep existing fields (pdf_url, etc.)
        ...pendingAnalysisResult,  // overlay with analysis result
        actions: { ...mergedActions, ...manualActionsData },
      };
    });
    setPendingAnalysisResult(null);
  }, [pendingAnalysisResult, selectedActionIds]);

  const handleToggleOverload = useCallback((overload: string) => {
    setSelectedOverloads((prev: Set<string>) => {
      const willBeSelected = !prev.has(overload);
      interactionLogger.record('overload_toggled', { overload, selected: willBeSelected });
      const next = new Set(prev);
      if (next.has(overload)) next.delete(overload);
      else next.add(overload);
      return next;
    });
  }, []);

  // ===== Action Selection =====
  const handleActionSelect = useCallback(async (actionId: string | null) => {
    if (actionId === selectedActionId) {
      // Deselect — return to N-1 tab
      interactionLogger.record('action_deselected', { previous_action_id: selectedActionId ?? '' });
      setSelectedActionId(null);
      setActionDiagram(null);
      setActiveTab('n-1');
      return;
    }
    if (actionId !== null) {
      interactionLogger.record('action_selected', { action_id: actionId });
    }




  const handleActionFavorite = useCallback((actionId: string) => {
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

  const handleManualActionAdded = useCallback((actionId: string, detail: ActionDetail, linesOverloaded: string[]) => {
    interactionLogger.record('manual_action_simulated', {
      action_id: actionId,
      description: detail.description_unitaire,
    });
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
        // Use the simulation's overloaded lines if no prior analysis provided them
        lines_overloaded: base.lines_overloaded.length > 0 ? base.lines_overloaded : linesOverloaded,
        actions: {
          ...base.actions,
          [actionId]: { ...detail, is_manual: true },
        },
      };
    });

    setSelectedActionIds(prev => new Set(prev).add(actionId));
    setManuallyAddedIds(prev => new Set(prev).add(actionId));
    // Auto-select the newly added action (and fetch its diagram)
    handleActionSelect(actionId);
  }, [handleActionSelect]);

  const handleViewModeChange = useCallback((mode: 'network' | 'delta') => {
    interactionLogger.record('view_mode_changed', { mode });
    setActionViewMode(mode);
  }, []);

  // ===== Save Results =====
  const handleSaveResults = useCallback(async () => {
    const session = buildSessionResult({
      networkPath,
      actionPath,
      layoutPath,
      minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, minPst,
      nPrioritizedActions, linesMonitoringPath, monitoringFactor,
      preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode,
      selectedBranch, selectedOverloads, monitorDeselected,
      nOverloads: nDiagram?.lines_overloaded ?? [],
      n1Overloads: n1Diagram?.lines_overloaded ?? [],
      result,
      selectedActionIds, rejectedActionIds, manuallyAddedIds, suggestedByRecommenderIds,
      interactionLog: interactionLogger.getLog(),
    });

    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const contingencyLabel = selectedBranch ? `_${selectedBranch.replace(/[^a-zA-Z0-9_-]/g, '_')}` : '';
    const sessionName = `expertassist_session${contingencyLabel}_${ts}`;

    if (outputFolderPath) {
      // Save session folder (JSON + PDF copy) via backend
      try {
        interactionLogger.record('session_saved', {
          session_name: sessionName,
          output_folder: outputFolderPath,
        });
        const res = await api.saveSession({
          session_name: sessionName,
          json_content: JSON.stringify(session, null, 2),
          pdf_path: result?.pdf_path ?? null,
          output_folder_path: outputFolderPath,
          interaction_log: JSON.stringify(interactionLogger.getLog(), null, 2),
        });
        const pdfMsg = res.pdf_copied ? " (including PDF)" : " (PDF not found)";
        setInfoMessage(`SUCCESS: Session saved to: ${res.session_folder}${pdfMsg}`);
      } catch (err: unknown) {
        const e = err as { response?: { data?: { detail?: string } }; message?: string };
        setError('Failed to save session: ' + (e.response?.data?.detail || e.message));
      }
    } else {
      // Fallback: browser download of JSON (no output folder configured)
      const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${sessionName}.json`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }, [
    result, selectedActionIds, manuallyAddedIds, rejectedActionIds, suggestedByRecommenderIds,
    networkPath, actionPath, layoutPath, outputFolderPath, minLineReconnections, minCloseCoupling, minOpenCoupling,
    minLineDisconnections, minPst, nPrioritizedActions, linesMonitoringPath, monitoringFactor,
    preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode,
    selectedBranch, selectedOverloads, monitorDeselected,
    nDiagram, n1Diagram,
  ]);

  // ===== Reload Session =====
  const [showReloadModal, setShowReloadModal] = useState(false);
  const [sessionList, setSessionList] = useState<string[]>([]);
  const [sessionListLoading, setSessionListLoading] = useState(false);
  const [sessionRestoring, setSessionRestoring] = useState(false);

  const handleOpenReloadModal = useCallback(async () => {
    if (!outputFolderPath) {
      setError('Configure an Output Folder Path in Settings before reloading a session.');
      return;
    }
    setShowReloadModal(true);
    setSessionListLoading(true);
    try {
      const res = await api.listSessions(outputFolderPath);
      setSessionList(res.sessions);
      interactionLogger.record('session_reload_modal_opened', {
        output_folder: outputFolderPath,
        available_sessions: res.sessions,
      });
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to list sessions: ' + (e.response?.data?.detail || e.message));
      setShowReloadModal(false);
    } finally {
      setSessionListLoading(false);
    }
  }, [outputFolderPath]);

  const handleRestoreSession = useCallback(async (sessionName: string) => {
    if (!outputFolderPath) return;
    interactionLogger.record('session_reloaded', { session_name: sessionName });
    setSessionRestoring(true);
    try {
      const session: SessionResult = await api.loadSession(outputFolderPath, sessionName);

      // 1. Restore configuration paths
      const cfg = session.configuration;
      setNetworkPath(cfg.network_path);
      setActionPath(cfg.action_file_path);
      setLayoutPath(cfg.layout_path || '');
      setMinLineReconnections(cfg.min_line_reconnections);
      setMinCloseCoupling(cfg.min_close_coupling);
      setMinOpenCoupling(cfg.min_open_coupling);
      setMinLineDisconnections(cfg.min_line_disconnections);
      setMinPst(cfg.min_pst ?? 1.0);
      setNPrioritizedActions(cfg.n_prioritized_actions);
      setLinesMonitoringPath(cfg.lines_monitoring_path || '');
      setMonitoringFactor(cfg.monitoring_factor);
      setPreExistingOverloadThreshold(cfg.pre_existing_overload_threshold);
      setIgnoreReconnections(cfg.ignore_reconnections ?? false);
      setPypowsyblFastMode(cfg.pypowsybl_fast_mode ?? true);

      // 2. Send config to backend and load network
      const configRes = await api.updateConfig({
        network_path: cfg.network_path,
        action_file_path: cfg.action_file_path,
        layout_path: cfg.layout_path,
        min_line_reconnections: cfg.min_line_reconnections,
        min_close_coupling: cfg.min_close_coupling,
        min_open_coupling: cfg.min_open_coupling,
        min_line_disconnections: cfg.min_line_disconnections,
        min_pst: cfg.min_pst ?? 1.0,
        n_prioritized_actions: cfg.n_prioritized_actions,
        lines_monitoring_path: cfg.lines_monitoring_path,
        monitoring_factor: cfg.monitoring_factor,
        pre_existing_overload_threshold: cfg.pre_existing_overload_threshold,
        ignore_reconnections: cfg.ignore_reconnections,
        pypowsybl_fast_mode: cfg.pypowsybl_fast_mode,
      });

      if (configRes?.total_lines_count !== undefined) {
        setMonitoredLinesCount(configRes.monitored_lines_count);
        setTotalLinesCount(configRes.total_lines_count);
        if (configRes.monitored_lines_count < configRes.total_lines_count) {
          setShowMonitoringWarning(true);
        }
      }
      if (configRes?.action_dict_file_name) setActionDictFileName(configRes.action_dict_file_name);
      if (configRes?.action_dict_stats) setActionDictStats(configRes.action_dict_stats);

      // 3. Fetch study data
      const [branchesList, vlRes, nomVRes] = await Promise.all([
        api.getBranches(),
        api.getVoltageLevels(),
        api.getNominalVoltages(),
      ]);
      setBranches(branchesList);
      setVoltageLevels(vlRes);
      setNominalVoltageMap(nomVRes.mapping);
      setUniqueVoltages(nomVRes.unique_kv);
      if (nomVRes.unique_kv.length > 0) {
        setVoltageRange([nomVRes.unique_kv[0], nomVRes.unique_kv[nomVRes.unique_kv.length - 1]]);
      }

      // 4. Fetch base diagram
      fetchBaseDiagram(vlRes.length);

      // 5. Restore contingency
      const contingency = session.contingency;
      setMonitorDeselected(contingency.monitor_deselected);
      setSelectedOverloads(new Set(contingency.selected_overloads));

      // 6. Restore analysis result (actions without rho_after are "unloaded" — will resim on click)
      if (session.analysis) {
        const a = session.analysis;
        const restoredActions: Record<string, ActionDetail> = {};
        const restoredSelected = new Set<string>();
        const restoredRejected = new Set<string>();
        const restoredManual = new Set<string>();
        const restoredSuggested = new Set<string>();

        for (const [id, entry] of Object.entries(a.actions)) {
          // Skip estimation-only combined-pair entries — they live in combined_actions,
          // not in the action feed, and should not appear as action cards.
          if (id.includes('+') && entry.is_estimated && !entry.status.is_manually_simulated) continue;

          restoredActions[id] = {
            description_unitaire: entry.description_unitaire,
            rho_before: entry.rho_before,
            rho_after: entry.rho_after,
            max_rho: entry.max_rho,
            max_rho_line: entry.max_rho_line,
            is_rho_reduction: entry.is_rho_reduction,
            is_estimated: entry.is_estimated,
            non_convergence: entry.non_convergence,
            action_topology: entry.action_topology,
            estimated_max_rho: entry.estimated_max_rho,
            estimated_max_rho_line: entry.estimated_max_rho_line,
            is_islanded: entry.is_islanded,
            n_components: entry.n_components,
            disconnected_mw: entry.disconnected_mw,
            is_manual: entry.status.is_manually_simulated,
          };

          if (entry.status.is_selected) restoredSelected.add(id);
          if (entry.status.is_rejected) restoredRejected.add(id);
          if (entry.status.is_manually_simulated) restoredManual.add(id);
          if (entry.status.is_suggested) restoredSuggested.add(id);
        }

        // Restore combined_actions
        const restoredCombinedActions: Record<string, CombinedAction> = {};
        if (a.combined_actions) {
          for (const [id, ca] of Object.entries(a.combined_actions)) {
            restoredCombinedActions[id] = {
              action1_id: ca.action1_id,
              action2_id: ca.action2_id,
              betas: ca.betas,
              p_or_combined: [],
              max_rho: ca.max_rho,
              max_rho_line: ca.max_rho_line,
              is_rho_reduction: ca.is_rho_reduction,
              description: ca.description,
              rho_after: [],
              rho_before: [],
              estimated_max_rho: ca.estimated_max_rho,
              estimated_max_rho_line: ca.estimated_max_rho_line,
              is_islanded: ca.is_islanded,
              disconnected_mw: ca.disconnected_mw,
            };
          }
        }

        const restoredResult: AnalysisResult = {
          pdf_path: session.overflow_graph?.pdf_path ?? null,
          pdf_url: session.overflow_graph?.pdf_url ?? null,
          actions: restoredActions,
          action_scores: a.action_scores,
          lines_overloaded: session.overloads.resolved_overloads,
          combined_actions: restoredCombinedActions,
          message: a.message,
          dc_fallback: a.dc_fallback,
        };

        setResult(restoredResult);
        setSelectedActionIds(restoredSelected);
        setRejectedActionIds(restoredRejected);
        setManuallyAddedIds(restoredManual);
        setSuggestedByRecommenderIds(restoredSuggested);
      } else {
        setResult(null);
        setSelectedActionIds(new Set());
        setRejectedActionIds(new Set());
        setManuallyAddedIds(new Set());
        setSuggestedByRecommenderIds(new Set());
      }

      // 7. Set the selected branch last (triggers N-1 diagram fetch via useEffect)
      // Set the restoring flag so the N-1 useEffect skips the contingency-change dialog
      restoringSessionRef.current = true;
      committedBranchRef.current = contingency.disconnected_element;
      setSelectedBranch(contingency.disconnected_element);

      setShowReloadModal(false);
      setInfoMessage(`SUCCESS: Session "${sessionName}" restored`);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to restore session: ' + (e.response?.data?.detail || e.message));
    } finally {
      setSessionRestoring(false);
    }
  }, [outputFolderPath, fetchBaseDiagram]);

  // ===== SLD Overlay =====
  const [vlOverlay, setVlOverlay] = useState<VlOverlay | null>(null);

  const fetchSldVariant = useCallback(async (vlName: string, actionId: string | null, sldTab: SldTab) => {
    setVlOverlay(prev => prev ? { ...prev, loading: true, error: null, tab: sldTab } : null);
    try {
      let svgData: string;
      let metaData: string | null = null;
      let flowDeltas: Record<string, FlowDelta> | undefined;
      let reactiveFlowDeltas: Record<string, FlowDelta> | undefined;
      let assetDeltas: Record<string, AssetDelta> | undefined;

      if (sldTab === 'n') {
        const res = await api.getNSld(vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
      } else if (sldTab === 'n-1') {
        const res = await api.getN1Sld(selectedBranch, vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
        flowDeltas = res.flow_deltas;
        reactiveFlowDeltas = res.reactive_flow_deltas;
        assetDeltas = res.asset_deltas;
      } else {
        const res = await api.getActionVariantSld(actionId!, vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
        flowDeltas = res.flow_deltas;
        reactiveFlowDeltas = res.reactive_flow_deltas;
        assetDeltas = res.asset_deltas;
      }
      setVlOverlay(prev =>
        prev && prev.vlName === vlName && prev.tab === sldTab
          ? {
            ...prev, svg: svgData, sldMetadata: metaData, loading: false,
            flow_deltas: flowDeltas, reactive_flow_deltas: reactiveFlowDeltas, asset_deltas: assetDeltas
          }
          : prev
      );
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setVlOverlay(prev => prev && prev.tab === sldTab
        ? { ...prev, loading: false, error: e.response?.data?.detail || 'Failed to load SLD' }
        : prev
      );
    }
  }, [selectedBranch]);

  const handleVlDoubleClick = useCallback((actionId: string, vlName: string) => {
    // Determine initial SLD tab based on current active main tab and Flow/Impact mode
    let initialTab: SldTab;
    // (initialTab computed below, logged after)
    if (activeTab === 'n') {
      initialTab = 'n';
    } else if (activeTab === 'n-1') {
      initialTab = 'n-1';
    } else if (activeTab === 'action' && actionViewMode === 'delta') {
      // Impacts mode: show Action state (the variant being compared)
      initialTab = 'action';
    } else {
      // Flows mode (action or overflow fallback): show action state
      initialTab = 'action';
    }
    interactionLogger.record('sld_overlay_opened', {
      vl_name: vlName,
      action_id: actionId || null,
      initial_tab: initialTab,
    });
    setVlOverlay({ vlName, actionId, svg: null, sldMetadata: null, loading: true, error: null, tab: initialTab });
    fetchSldVariant(vlName, actionId, initialTab);
  }, [activeTab, actionViewMode, fetchSldVariant]);

  const handleOverlaySldTabChange = useCallback((sldTab: SldTab) => {
    if (!vlOverlay) return;
    interactionLogger.record('sld_overlay_tab_changed', {
      from_tab: vlOverlay.tab,
      to_tab: sldTab,
    });
    fetchSldVariant(vlOverlay.vlName, vlOverlay.actionId, sldTab);
  }, [vlOverlay, fetchSldVariant]);

  const handleOverlayClose = useCallback(() => {
    interactionLogger.record('sld_overlay_closed');
    setVlOverlay(null);
  }, []);

  // ===== Asset Click (from action card badges / rho line names) =====
  const handleAssetClick = useCallback((actionId: string, assetName: string, tab: 'action' | 'n' | 'n-1' = 'action') => {
    interactionLogger.record('asset_clicked', { asset_name: assetName, action_id: actionId, target_tab: tab });
    setInspectQuery(assetName);
    if (tab === 'n') {
      // Pre-existing overloads live in the N (pre-contingency) view
      setActiveTab('n');
    } else if (tab === 'n-1') {
      // Rho-before lines live in the N-1 (post-contingency) view
      setActiveTab('n-1');
    } else if (actionId !== selectedActionId) {
      // Select the action; zoom fires once its diagram loads
      handleActionSelect(actionId);
    } else {
      setActiveTab('action');
    }
  }, [selectedActionId, handleActionSelect]);

  // ===== Zoom Controls =====
  const handleManualZoomIn = useCallback(() => {
    interactionLogger.record('zoom_in');
    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const vb = currentPZ?.viewBox;
    if (currentPZ && vb) {
      const scale = 0.8;
      currentPZ.setViewBox({
        x: vb.x + vb.w * (1 - scale) / 2,
        y: vb.y + vb.h * (1 - scale) / 2,
        w: vb.w * scale,
        h: vb.h * scale,
      });
    }
  }, [activeTab, actionPZ, nPZ, n1PZ]);

  const handleManualZoomOut = useCallback(() => {
    interactionLogger.record('zoom_out');
    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const vb = currentPZ?.viewBox;
    if (currentPZ && vb) {
      const scale = 1.25;
      currentPZ.setViewBox({
        x: vb.x + vb.w * (1 - scale) / 2,
        y: vb.y + vb.h * (1 - scale) / 2,
        w: vb.w * scale,
        h: vb.h * scale,
      });
    }
  }, [activeTab, actionPZ, nPZ, n1PZ]);

  // ===== Reset View =====
  const handleManualReset = useCallback(() => {
    interactionLogger.record('zoom_reset');
    setInspectQuery('');

    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const currentDiagram = activeTab === 'action' ? actionDiagram : activeTab === 'n' ? nDiagram : n1Diagram;
    const viewBox = currentDiagram?.originalViewBox || originalViewBox;

    if (currentPZ && viewBox) {
      currentPZ.setViewBox(viewBox);
      lastZoomState.current = { query: '', branch: '' };
    }

    // Clear highlights
    const container = activeTab === 'action' ? actionSvgContainerRef.current
      : activeTab === 'n' ? nSvgContainerRef.current : n1SvgContainerRef.current;
    if (container) {
      container.querySelectorAll('.nad-highlight').forEach(el => el.classList.remove('nad-highlight'));
    }
  }, [activeTab, actionPZ, nPZ, n1PZ, actionDiagram, nDiagram, n1Diagram, originalViewBox]);

  // Logged wrapper for tab changes from user interaction
  const handleTabChange = useCallback((tab: TabId) => {
    interactionLogger.record('diagram_tab_changed', { from_tab: activeTab, to_tab: tab });
    setActiveTab(tab);
  }, [activeTab]);

  // Logged wrapper for voltage range changes from user interaction
  const handleVoltageRangeChange = useCallback((range: [number, number]) => {
    interactionLogger.record('voltage_range_changed', { min_kv: range[0], max_kv: range[1] });
    setVoltageRange(range);
  }, []);

  // Logged wrapper for inspect query changes from user interaction
  const handleInspectQueryChange = useCallback((query: string) => {
    interactionLogger.record('inspect_query_changed', { query });
    setInspectQuery(query);
  }, []);

  // ===== Tab Synchronization =====
  // useLayoutEffect so the target tab's viewBox is correct BEFORE the browser paints.
  useLayoutEffect(() => {
    const prevTab = prevTabRef.current;
    prevTabRef.current = activeTab;

    // Don't sync when coming from / going to overflow
    if (prevTab === 'overflow' || activeTab === 'overflow') return;

    const sourceVB = prevTab === 'n' ? nPZ.viewBox
      : prevTab === 'n-1' ? n1PZ.viewBox
        : prevTab === 'action' ? actionPZ.viewBox
          : null;
    if (!sourceVB) return;

    if (activeTab === 'n') nPZ.setViewBox(sourceVB);
    else if (activeTab === 'n-1') n1PZ.setViewBox(sourceVB);
    else if (activeTab === 'action') actionPZ.setViewBox(sourceVB);
  }, [activeTab, nPZ, n1PZ, actionPZ]);

  // Re-sync after action diagram loads
  useEffect(() => {
    if (actionDiagram && activeTab === 'action' && actionSyncSourceRef.current) {
      actionPZ.setViewBox(actionSyncSourceRef.current);
      actionSyncSourceRef.current = null;
    }
  }, [actionDiagram, activeTab, actionPZ]);

  // ===== Invalidate DOM id-map cache when SVG content changes =====
  useEffect(() => {
    if (nSvgContainerRef.current) invalidateIdMapCache(nSvgContainerRef.current);
  }, [nDiagram]);
  useEffect(() => {
    if (n1SvgContainerRef.current) invalidateIdMapCache(n1SvgContainerRef.current);
  }, [n1Diagram]);
  useEffect(() => {
    if (actionSvgContainerRef.current) invalidateIdMapCache(actionSvgContainerRef.current);
  }, [actionDiagram]);

  // ===== Metadata Indices =====
  const nMetaIndex = useMemo(() => buildMetadataIndex(nDiagram?.metadata), [nDiagram?.metadata]);
  const n1MetaIndex = useMemo(() => buildMetadataIndex(n1Diagram?.metadata), [n1Diagram?.metadata]);
  const actionMetaIndex = useMemo(() => buildMetadataIndex(actionDiagram?.metadata), [actionDiagram?.metadata]);

  // ===== Highlights =====
  // Track which tabs need highlight re-application
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
                onClick={() => setSettingsTab('paths')}
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
                onClick={() => setSettingsTab('recommender')}
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
                onClick={() => setSettingsTab('configurations')}
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
                      placeholder="e.g. /home/user/my_expertassist_config.json"
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
                onChange={e => {
                  const val = e.target.value;
                  if (branches.includes(val)) {
                    interactionLogger.record('contingency_selected', { element: val });
                  }
                  setSelectedBranch(val);
                }}
                placeholder="Search line/bus..."
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontSize: '0.85rem' }}
              />
              <datalist id="contingencies">
                {branches.map(b => <option key={b} value={b} />)}
              </datalist>
              <button
                onClick={wrappedRunAnalysis}
                disabled={!selectedBranch || analysisLoading}
                style={{
                  marginTop: '8px',
                  width: '100%',
                  padding: '8px',
                  background: analysisLoading ? '#f1c40f' : (!selectedBranch ? '#95a5a6' : '#27ae60'),
                  color: analysisLoading ? '#856404' : 'white',
                  border: 'none',
                  borderRadius: '4px',
                  cursor: (!selectedBranch || analysisLoading) ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.85rem'
                }}
              >
                {analysisLoading ? '⚙️ Running...' : '🚀 Run Analysis'}
              </button>
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
