import { useState, useEffect, useLayoutEffect, useCallback, useMemo, useRef } from 'react';
import './App.css';
import VisualizationPanel from './components/VisualizationPanel';
import ActionFeed from './components/ActionFeed';
import OverloadPanel from './components/OverloadPanel';
import { api } from './api';
import { usePanZoom } from './hooks/usePanZoom';
import {
  processSvg, buildMetadataIndex, applyOverloadedHighlights,
  applyDeltaVisuals, applyActionTargetHighlights, applyContingencyHighlight
} from './utils/svgUtils';
import type { ActionDetail, AnalysisResult, DiagramData, ViewBox, MetadataIndex, TabId, SettingsBackup, VlOverlay, SldTab } from './types';

function App() {
  // ===== Configuration State =====
  const [networkPath, setNetworkPath] = useState(
    localStorage.getItem('networkPath') || '/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_20240828T0100Z_dijon_only'
  );
  const [actionPath, setActionPath] = useState(
    localStorage.getItem('actionPath') || '/home/marotant/dev/Expert_op4grid_recommender/data/action_space/reduced_model_actions_20240828T0100Z_new_dijon.json'
  );
  const [branches, setBranches] = useState<string[]>([]);
  const [voltageLevels, setVoltageLevels] = useState<string[]>([]);
  const [selectedBranch, setSelectedBranch] = useState('');
  const [configLoading, setConfigLoading] = useState(false);
  const [error, setError] = useState('');

  // Settings State
  const [minLineReconnections, setMinLineReconnections] = useState<number>(2.0);
  const [minCloseCoupling, setMinCloseCoupling] = useState<number>(3.0);
  const [minOpenCoupling, setMinOpenCoupling] = useState<number>(2.0);
  const [minLineDisconnections, setMinLineDisconnections] = useState<number>(3.0);
  const [nPrioritizedActions, setNPrioritizedActions] = useState<number>(10);
  const [linesMonitoringPath, setLinesMonitoringPath] = useState<string>('');
  const [monitoringFactor, setMonitoringFactor] = useState<number>(0.95);
  const [preExistingOverloadThreshold, setPreExistingOverloadThreshold] = useState<number>(0.02);
  const [ignoreReconnections, setIgnoreReconnections] = useState<boolean>(false);
  const [pypowsyblFastMode, setPypowsyblFastMode] = useState<boolean>(true);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'recommender' | 'configurations'>('recommender');
  const [settingsBackup, setSettingsBackup] = useState<SettingsBackup | null>(null);

  const handleOpenSettings = useCallback(() => {
    setSettingsBackup({
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
    setIsSettingsOpen(true);
  }, [minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, nPrioritizedActions, linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode]);

  const handleCloseSettings = useCallback(() => {
    if (settingsBackup) {
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
    try {
      await api.updateConfig({
        network_path: networkPath,
        action_file_path: actionPath,
        min_line_reconnections: minLineReconnections,
        min_close_coupling: minCloseCoupling,
        min_open_coupling: minOpenCoupling,
        min_line_disconnections: minLineDisconnections,
        n_prioritized_actions: nPrioritizedActions,
        lines_monitoring_path: linesMonitoringPath,
        monitoring_factor: monitoringFactor,
        pre_existing_overload_threshold: preExistingOverloadThreshold,
        ignore_reconnections: ignoreReconnections,
        pypowsybl_fast_mode: pypowsyblFastMode,
      });
      setSettingsBackup({
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
      setInfoMessage('Settings applied successfully.');
      setIsSettingsOpen(false);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to apply settings: ' + (e.response?.data?.detail || e.message));
    }
  }, [networkPath, actionPath, minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, nPrioritizedActions, linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode]);

  const pickSettingsPath = async (type: 'file' | 'dir', setter: (path: string) => void) => {
    try {
      const path = await api.pickPath(type);
      if (path) setter(path);
    } catch {
      console.error('Failed to open file picker');
    }
  };

  // Nominal voltage filter state
  const [nominalVoltageMap, setNominalVoltageMap] = useState<Record<string, number>>({});
  const [uniqueVoltages, setUniqueVoltages] = useState<number[]>([]);
  const [voltageRange, setVoltageRange] = useState<[number, number]>([0, 400]);

  // ===== Analysis State =====
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [pendingAnalysisResult, setPendingAnalysisResult] = useState<AnalysisResult | null>(null);
  const [selectedActionIds, setSelectedActionIds] = useState<Set<string>>(new Set());
  const [manuallyAddedIds, setManuallyAddedIds] = useState<Set<string>>(new Set());
  const [rejectedActionIds, setRejectedActionIds] = useState<Set<string>>(new Set());
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [infoMessage, setInfoMessage] = useState('');

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

  // Persist paths to localStorage
  useEffect(() => { localStorage.setItem('networkPath', networkPath); }, [networkPath]);
  useEffect(() => { localStorage.setItem('actionPath', actionPath); }, [actionPath]);

  // ===== Config Loading =====
  const handleLoadConfig = useCallback(async () => {
    setConfigLoading(true);
    setError('');
    setInfoMessage('');
    setNDiagram(null);
    setN1Diagram(null);
    setResult(null);
    setPendingAnalysisResult(null);
    setSelectedActionId(null);
    setSelectedActionIds(new Set());
    setRejectedActionIds(new Set());
    setActionDiagram(null);
    setActiveTab('n');
    lastZoomState.current = { query: '', branch: '' };

    try {
      await api.updateConfig({
        network_path: networkPath,
        action_file_path: actionPath,
        min_line_reconnections: minLineReconnections,
        min_close_coupling: minCloseCoupling,
        min_open_coupling: minOpenCoupling,
        min_line_disconnections: minLineDisconnections,
        n_prioritized_actions: nPrioritizedActions,
        lines_monitoring_path: linesMonitoringPath,
        monitoring_factor: monitoringFactor,
        pre_existing_overload_threshold: preExistingOverloadThreshold,
        ignore_reconnections: ignoreReconnections,
        pypowsybl_fast_mode: pypowsyblFastMode,
      });

      const [branchesList, vlRes, nomVRes] = await Promise.all([
        api.getBranches(),
        api.getVoltageLevels(),
        api.getNominalVoltages(),
      ]);

      setBranches(branchesList);
      setVoltageLevels(vlRes);
      setSelectedBranch('');

      // Set up nominal voltage filter
      setNominalVoltageMap(nomVRes.mapping);
      setUniqueVoltages(nomVRes.unique_kv);
      if (nomVRes.unique_kv.length > 0) {
        setVoltageRange([nomVRes.unique_kv[0], nomVRes.unique_kv[nomVRes.unique_kv.length - 1]]);
      }

      // Fetch base diagram
      fetchBaseDiagram(vlRes.length);
    } catch (err: unknown) {
      const e = err as { response?: { data?: { detail?: string } }; message?: string };
      setError('Failed to load config: ' + (e.response?.data?.detail || e.message));
    } finally {
      setConfigLoading(false);
    }
  }, [networkPath, actionPath, minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, nPrioritizedActions, monitoringFactor, linesMonitoringPath, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode]);

  const fetchBaseDiagram = async (vlCount: number) => {
    try {
      const res = await api.getNetworkDiagram();
      const { svg, viewBox } = processSvg(res.svg, vlCount || 0);
      if (viewBox) setOriginalViewBox(viewBox);
      setNDiagram({ ...res, svg, originalViewBox: viewBox });
    } catch (err) {
      console.error('Failed to fetch diagram:', err);
    }
  };

  // ===== N-1 Diagram Fetching =====
  useEffect(() => {
    if (!selectedBranch) {
      setN1Diagram(null);
      return;
    }
    if (branches.length > 0 && !branches.includes(selectedBranch)) {
      return;
    }

    const fetchN1 = async () => {
      setN1Loading(true);
      setActiveTab('n-1');
      try {
        const res = await api.getN1Diagram(selectedBranch);
        const { svg, viewBox } = processSvg(res.svg, voltageLevels.length);
        setN1Diagram({ ...res, svg, originalViewBox: viewBox });
      } catch (err) {
        console.error('Failed to fetch N-1 diagram', err);
        setError(`Failed to fetch N-1 diagram for ${selectedBranch}`);
      } finally {
        setN1Loading(false);
      }
    };
    fetchN1();
  }, [selectedBranch, branches, voltageLevels.length]);

  // ===== Analysis =====
  const handleRunAnalysis = useCallback(async () => {
    if (!selectedBranch) return;
    setAnalysisLoading(true);
    setError('');
    setInfoMessage('');
    setSelectedActionId(null);
    setActionDiagram(null);
    setPendingAnalysisResult(null);
    setActiveTab('overflow');

    try {
      const response = await fetch('http://localhost:8000/api/run-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ disconnected_element: selectedBranch }),
      });
      if (!response.ok) throw new Error('Analysis failed');
      const reader = response.body!.getReader();
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
            if (event.type === 'pdf') setResult(p => ({ ...p!, pdf_url: event.pdf_url } as AnalysisResult));
            else if (event.type === 'result') {
              // Store analysis result as pending — don't merge yet
              setPendingAnalysisResult(event);
              if (event.message) setInfoMessage(event.message);
            }
            else if (event.type === 'error') setError('Analysis failed: ' + event.message);
          } catch (e) {
            console.error('Stream error:', e);
          }
        }
      }
    } catch (err: unknown) {
      setError('Analysis failed: ' + (err as Error).message);
    } finally {
      setAnalysisLoading(false);
    }
  }, [selectedBranch]);

  const handleDisplayPrioritizedActions = useCallback(() => {
    if (!pendingAnalysisResult) return;
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
      return {
        ...pendingAnalysisResult,
        actions: { ...pendingAnalysisResult.actions, ...manualActionsData },
      };
    });
    setPendingAnalysisResult(null);
  }, [pendingAnalysisResult, selectedActionIds]);

  // ===== Action Selection =====
  const handleActionSelect = useCallback(async (actionId: string | null) => {
    if (actionId === selectedActionId) {
      // Deselect — return to N-1 tab
      setSelectedActionId(null);
      setActionDiagram(null);
      setActiveTab('n-1');
      return;
    }

    // Capture current viewBox for sync after diagram loads
    actionSyncSourceRef.current =
      (activeTabRef.current === 'action' ? actionPZ.viewBox : null)
      || n1PZ.viewBox || nPZ.viewBox;

    setSelectedActionId(actionId);
    setActionDiagram(null);
    if (actionId === null) return;

    setActionDiagramLoading(true);
    setActiveTab('action');
    try {
      const res = await api.getActionVariantDiagram(actionId);
      const { svg, viewBox } = processSvg(res.svg, voltageLevels.length);
      setActionDiagram({ ...res, svg, originalViewBox: viewBox });
    } catch (err) {
      console.error('Failed to fetch action variant diagram:', err);
      setError('Failed to fetch action variant diagram for ' + actionId);
    } finally {
      setActionDiagramLoading(false);
    }
  }, [selectedActionId, actionPZ.viewBox, n1PZ.viewBox, nPZ.viewBox, voltageLevels.length]);

  const handleActionFavorite = useCallback((actionId: string) => {
    setSelectedActionIds(prev => {
      const next = new Set(prev);
      next.add(actionId);
      return next;
    });
    setRejectedActionIds(prev => {
      const next = new Set(prev);
      next.delete(actionId);
      return next;
    });
  }, []);

  const handleActionReject = useCallback((actionId: string) => {
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
          [actionId]: detail,
        },
      };
    });

    setSelectedActionIds(prev => new Set(prev).add(actionId));
    setManuallyAddedIds(prev => new Set(prev).add(actionId));
    // Auto-select the newly added action (and fetch its diagram)
    handleActionSelect(actionId);
  }, [handleActionSelect]);

  const handleViewModeChange = useCallback((mode: 'network' | 'delta') => {
    setActionViewMode(mode);
  }, []);

  // ===== SLD Overlay =====
  const [vlOverlay, setVlOverlay] = useState<VlOverlay | null>(null);

  const fetchSldVariant = useCallback(async (vlName: string, actionId: string | null, sldTab: SldTab) => {
    setVlOverlay(prev => prev ? { ...prev, loading: true, error: null, tab: sldTab } : null);
    try {
      let svgData: string;
      let metaData: string | null = null;
      if (sldTab === 'n') {
        const res = await api.getNSld(vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
      } else if (sldTab === 'n-1') {
        const res = await api.getN1Sld(selectedBranch, vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
      } else {
        const res = await api.getActionVariantSld(actionId!, vlName);
        svgData = res.svg;
        metaData = res.sld_metadata ?? null;
      }
      setVlOverlay(prev =>
        prev && prev.vlName === vlName && prev.tab === sldTab
          ? { ...prev, svg: svgData, sldMetadata: metaData, loading: false }
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
    setVlOverlay({ vlName, actionId, svg: null, sldMetadata: null, loading: true, error: null, tab: initialTab });
    fetchSldVariant(vlName, actionId, initialTab);
  }, [activeTab, actionViewMode, fetchSldVariant]);

  const handleOverlaySldTabChange = useCallback((sldTab: SldTab) => {
    if (!vlOverlay) return;
    fetchSldVariant(vlOverlay.vlName, vlOverlay.actionId, sldTab);
  }, [vlOverlay, fetchSldVariant]);

  const handleOverlayClose = useCallback(() => {
    setVlOverlay(null);
  }, []);

  // ===== Asset Click (from action card badges / rho line names) =====
  const handleAssetClick = useCallback((actionId: string, assetName: string, tab: 'action' | 'n' | 'n-1' = 'action') => {
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

  // ===== Tab Synchronization =====
  useEffect(() => {
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

  // ===== Metadata Indices =====
  const nMetaIndex = useMemo(() => buildMetadataIndex(nDiagram?.metadata), [nDiagram?.metadata]);
  const n1MetaIndex = useMemo(() => buildMetadataIndex(n1Diagram?.metadata), [n1Diagram?.metadata]);
  const actionMetaIndex = useMemo(() => buildMetadataIndex(actionDiagram?.metadata), [actionDiagram?.metadata]);

  // ===== Highlights =====
  useEffect(() => {
    const overloadedLines = result?.lines_overloaded || [];

    // N-1 Tab Logic
    if (activeTab === 'n-1') {
      if (n1SvgContainerRef.current) {
        if (actionViewMode !== 'delta' && n1MetaIndex && overloadedLines.length > 0) {
          applyOverloadedHighlights(n1SvgContainerRef.current, n1MetaIndex, overloadedLines);
        }
        applyDeltaVisuals(n1SvgContainerRef.current, n1Diagram, n1MetaIndex, actionViewMode === 'delta');
        applyContingencyHighlight(n1SvgContainerRef.current, n1MetaIndex, selectedBranch);
      }
    } // Action Tab Logic
    if (activeTab === 'action') {
      applyDeltaVisuals(actionSvgContainerRef.current, actionDiagram, actionMetaIndex, actionViewMode === 'delta');

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
          if (actionSvgContainerRef.current && actionMetaIndex) {
            applyOverloadedHighlights(actionSvgContainerRef.current, actionMetaIndex, stillOverloaded);
          }
        }

        // Always highlight action targets (Yellow halo)
        if (actionSvgContainerRef.current) {
          applyActionTargetHighlights(actionSvgContainerRef.current, actionMetaIndex, actionDetail, selectedActionId);
        }
      } else {
        if (actionSvgContainerRef.current) {
          applyActionTargetHighlights(actionSvgContainerRef.current, null, null, null);
        }
      }
    }
  }, [nDiagram, n1Diagram, actionDiagram, nMetaIndex, n1MetaIndex, actionMetaIndex, result, selectedActionId, actionViewMode, activeTab, selectedBranch]);

  // ===== Voltage Range Filter =====
  useEffect(() => {
    if (uniqueVoltages.length === 0 || Object.keys(nominalVoltageMap).length === 0) return;

    const [minKv, maxKv] = voltageRange;
    const isInRange = (vlId: string) => {
      const kv = nominalVoltageMap[vlId];
      return kv != null && kv >= minKv && kv <= maxKv;
    };

    const applyFilter = (container: HTMLElement | null, metaIndex: MetadataIndex | null) => {
      if (!container || !metaIndex) return;
      const { nodesByEquipmentId, nodesBySvgId, edgesByEquipmentId } = metaIndex;

      const idMap = new Map<string, HTMLElement>();
      container.querySelectorAll('[id]').forEach(el => idMap.set(el.id, el as HTMLElement));

      for (const [vlId, node] of nodesByEquipmentId) {
        const visible = isInRange(vlId);
        const show = visible ? '' : 'none';
        const el = idMap.get(node.svgId);
        if (el) el.style.display = show;
        if (node.legendSvgId) {
          const leg = idMap.get(node.legendSvgId as string);
          if (leg) leg.style.display = show;
        }
        if (node.legendEdgeSvgId) {
          const legE = idMap.get(node.legendEdgeSvgId as string);
          if (legE) legE.style.display = show;
        }
      }

      for (const [, edge] of edgesByEquipmentId) {
        const node1 = nodesBySvgId.get(edge.node1);
        const node2 = nodesBySvgId.get(edge.node2);
        const vl1InRange = node1 ? isInRange(node1.equipmentId) : true;
        const vl2InRange = node2 ? isInRange(node2.equipmentId) : true;
        const edgeVisible = vl1InRange || vl2InRange;
        const show = edgeVisible ? '' : 'none';

        const el = idMap.get(edge.svgId);
        if (el) el.style.display = show;
        if (edge.edgeInfo1?.svgId) {
          const ei = idMap.get(edge.edgeInfo1.svgId);
          if (ei) ei.style.display = show;
        }
        if (edge.edgeInfo2?.svgId) {
          const ei = idMap.get(edge.edgeInfo2.svgId);
          if (ei) ei.style.display = show;
        }
      }
    };

    applyFilter(nSvgContainerRef.current, nMetaIndex);
    applyFilter(n1SvgContainerRef.current, n1MetaIndex);
    applyFilter(actionSvgContainerRef.current, actionMetaIndex);
  }, [voltageRange, nDiagram, n1Diagram, actionDiagram, nMetaIndex, n1MetaIndex, actionMetaIndex, nominalVoltageMap, uniqueVoltages]);

  // ===== Zoom to Element =====
  const zoomToElement = useCallback((targetId: string) => {
    const currentPZ = activeTab === 'action' ? actionPZ : activeTab === 'n' ? nPZ : n1PZ;
    const container = activeTab === 'action' ? actionSvgContainerRef.current
      : activeTab === 'n' ? nSvgContainerRef.current : n1SvgContainerRef.current;
    const index = activeTab === 'action' ? actionMetaIndex : activeTab === 'n' ? nMetaIndex : n1MetaIndex;
    if (!currentPZ || !container || !index) return;

    try {
      const { nodesByEquipmentId, nodesBySvgId, edgesByEquipmentId, edgesByNode } = index;
      const points: { x: number; y: number }[] = [];

      const addNodePointsBySvgId = (svgId: string) => {
        const n = nodesBySvgId.get(svgId);
        if (n) points.push({ x: n.x, y: n.y });
        return n;
      };

      let targetNode = nodesByEquipmentId.get(targetId);
      let targetEdge = edgesByEquipmentId.get(targetId);
      let targetSvgId: string | undefined;

      // Fallback: strip prefix before "." (e.g. GEN.PY762 → PY762) and try as VL node
      if (!targetNode && !targetEdge) {
        const dotIdx = targetId.indexOf('.');
        if (dotIdx >= 0) {
          const suffix = targetId.substring(dotIdx + 1);
          targetNode = nodesByEquipmentId.get(suffix) ?? undefined;
          if (!targetNode) targetEdge = edgesByEquipmentId.get(suffix) ?? undefined;
        }
      }

      if (targetNode) {
        targetSvgId = targetNode.svgId;
        points.push({ x: targetNode.x, y: targetNode.y });
        (edgesByNode.get(targetNode.svgId) || []).forEach(e => {
          addNodePointsBySvgId(e.node1);
          addNodePointsBySvgId(e.node2);
        });
      } else if (targetEdge) {
        targetSvgId = targetEdge.svgId;
        const n1 = addNodePointsBySvgId(targetEdge.node1);
        const n2 = addNodePointsBySvgId(targetEdge.node2);
        if (n1) (edgesByNode.get(n1.svgId) || []).forEach(e => { addNodePointsBySvgId(e.node1); addNodePointsBySvgId(e.node2); });
        if (n2) (edgesByNode.get(n2.svgId) || []).forEach(e => { addNodePointsBySvgId(e.node1); addNodePointsBySvgId(e.node2); });
      }

      if (points.length > 0) {
        const minX = Math.min(...points.map(p => p.x));
        const maxX = Math.max(...points.map(p => p.x));
        const minY = Math.min(...points.map(p => p.y));
        const maxY = Math.max(...points.map(p => p.y));

        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const boxW = Math.max(maxX - minX, 50);
        const boxH = Math.max(maxY - minY, 50);

        const padding = 1.8;
        const screenW = container.getBoundingClientRect().width;
        const screenH = container.getBoundingClientRect().height;
        const screenAR = screenW / screenH;

        let targetW = boxW * padding;
        let targetH = boxH * padding;

        if (targetW / targetH > screenAR) {
          targetH = targetW / screenAR;
        } else {
          targetW = targetH * screenAR;
        }

        const targetX = centerX - targetW / 2;
        const targetY = centerY - targetH / 2;

        currentPZ.setViewBox({ x: targetX, y: targetY, w: targetW, h: targetH });

        // Highlight the target element
        container.querySelectorAll('.nad-highlight').forEach(el => el.classList.remove('nad-highlight'));
        if (targetSvgId) {
          const el = container.querySelector(`[id="${targetSvgId}"]`);
          if (el) el.classList.add('nad-highlight');
        }
      }
    } catch (e) {
      console.error('Zoom failed:', e);
    }
  }, [activeTab, actionPZ, nPZ, n1PZ, actionMetaIndex, nMetaIndex, n1MetaIndex]);

  // Auto-zoom to selected element
  useEffect(() => {
    if (activeTab === 'overflow') return;

    const queryChanged = inspectQuery !== lastZoomState.current.query;
    const branchChanged = !inspectQuery && selectedBranch !== lastZoomState.current.branch;

    if (!queryChanged && !branchChanged) return;

    const targetId = inspectQuery || selectedBranch;

    // Cleared inspect -> reset view
    if (!targetId && queryChanged) {
      lastZoomState.current = { query: inspectQuery, branch: selectedBranch };
      handleManualReset();
      return;
    }

    if (!targetId) return;

    // Branch changes should zoom on the N-1 tab, not N
    if (branchChanged && activeTab === 'n') return;

    // Only consume the zoom intent when the container has SVG content
    const container = activeTab === 'action' ? actionSvgContainerRef.current
      : activeTab === 'n' ? nSvgContainerRef.current : n1SvgContainerRef.current;
    if (!container || !container.querySelector('svg')) return;

    lastZoomState.current = { query: inspectQuery, branch: selectedBranch };
    zoomToElement(targetId);
  }, [activeTab, nDiagram, n1Diagram, actionDiagram, inspectQuery, selectedBranch, zoomToElement, handleManualReset]);

  // Inspectable items list
  const inspectableItems = useMemo(() =>
    [...branches, ...voltageLevels].sort(),
    [branches, voltageLevels]
  );

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
              style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: '0.8rem' }}
            />
            <button
              onClick={() => pickSettingsPath('dir', setNetworkPath)}
              style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px', color: 'white', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              📂
            </button>
          </div>
        </div>

        <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
          <label style={{ fontSize: '0.7rem', opacity: 0.8, whiteSpace: 'nowrap' }}>Action File Path</label>
          <div style={{ display: 'flex', gap: '4px' }}>
            <input
              type="text" value={actionPath} onChange={e => setActionPath(e.target.value)}
              style={{ flex: 1, minWidth: 0, padding: '5px 8px', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px', background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: '0.8rem' }}
            />
            <button
              onClick={() => pickSettingsPath('file', setActionPath)}
              style={{ padding: '4px 8px', background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px', color: 'white', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              📄
            </button>
          </div>
        </div>

        <button
          onClick={handleLoadConfig} disabled={configLoading}
          style={{ padding: '6px 14px', background: configLoading ? '#95a5a6' : '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: configLoading ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap' }}
        >
          {configLoading ? '⏳ Loading...' : '🔄 Load Study'}
        </button>

        <button
          onClick={handleOpenSettings}
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
          <div style={{
            background: 'white', padding: '25px', borderRadius: '8px',
            width: '450px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
            display: 'flex', flexDirection: 'column', gap: '15px', color: 'black'
          }}>
            <div style={{ display: 'flex', borderBottom: '1px solid #eee', marginBottom: '15px' }}>
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
                  <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>N Prioritized Actions</label>
                  <input type="number" step="1" value={nPrioritizedActions} onChange={e => setNPrioritizedActions(parseInt(e.target.value, 10))} style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }} />
                </div>
              </div>
            )}

            {settingsTab === 'configurations' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <input type="checkbox" id="ignoreRec" checked={ignoreReconnections} onChange={e => setIgnoreReconnections(e.target.checked)} style={{ width: '16px', height: '16px' }} />
                    <label htmlFor="ignoreRec" style={{ fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>Ignore Reconnections</label>
                  </div>
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

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ width: '25%', background: '#eee', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column', padding: '15px', gap: '15px' }}>
          {/* Target Contingency selector */}
          {branches.length > 0 && (
            <div style={{ padding: '10px 15px', background: 'white', borderRadius: '8px', border: '1px solid #dee2e6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🎯 Select Contingency</label>
              <input
                list="contingencies"
                value={selectedBranch}
                onChange={e => setSelectedBranch(e.target.value)}
                placeholder="Search line/bus..."
                style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontSize: '0.85rem' }}
              />
              <datalist id="contingencies">
                {branches.map(b => <option key={b} value={b} />)}
              </datalist>
              <button
                onClick={handleRunAnalysis}
                disabled={!selectedBranch || analysisLoading}
                style={{ marginTop: '8px', width: '100%', padding: '8px', background: (!selectedBranch || analysisLoading) ? '#95a5a6' : '#27ae60', color: 'white', border: 'none', borderRadius: '4px', cursor: (!selectedBranch || analysisLoading) ? 'not-allowed' : 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}
              >
                {analysisLoading ? '⚙️ Running...' : '🚀 Run Analysis'}
              </button>
            </div>
          )}

          <div style={{ flexShrink: 0 }}>
            <OverloadPanel
              nOverloads={nDiagram?.lines_overloaded || []}
              n1Overloads={n1Diagram?.lines_overloaded || []}
              onAssetClick={handleAssetClick as (actionId: string, assetName: string, tab?: 'n' | 'n-1') => void}
            />
          </div>
          <div style={{ flex: 1, overflowY: 'auto' }}>
            <ActionFeed
              actions={result?.actions || {}}
              actionScores={result?.action_scores}
              linesOverloaded={result?.lines_overloaded || []}
              selectedActionId={selectedActionId}
              selectedActionIds={selectedActionIds}
              rejectedActionIds={rejectedActionIds}
              manuallyAddedIds={manuallyAddedIds}
              pendingAnalysisResult={pendingAnalysisResult}
              onActionSelect={handleActionSelect}
              onActionFavorite={handleActionFavorite}
              onActionReject={handleActionReject}
              onAssetClick={handleAssetClick}
              nodesByEquipmentId={nMetaIndex?.nodesByEquipmentId ?? null}
              edgesByEquipmentId={nMetaIndex?.edgesByEquipmentId ?? null}
              disconnectedElement={selectedBranch || null}
              onManualActionAdded={handleManualActionAdded}
              onDisplayPrioritizedActions={handleDisplayPrioritizedActions}
              analysisLoading={analysisLoading}
              monitoringFactor={monitoringFactor}
              onVlDoubleClick={handleVlDoubleClick}
            />
          </div>
        </div>
        <div style={{ flex: 1, background: 'white', display: 'flex', flexDirection: 'column' }}>
          <VisualizationPanel
            activeTab={activeTab}
            onTabChange={setActiveTab}
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
            onVoltageRangeChange={setVoltageRange}
            actionViewMode={actionViewMode}
            onViewModeChange={handleViewModeChange}
            inspectQuery={inspectQuery}
            onInspectQueryChange={setInspectQuery}
            inspectableItems={inspectableItems}
            onResetView={handleManualReset}
            onZoomIn={handleManualZoomIn}
            onZoomOut={handleManualZoomOut}
            hasBranches={branches.length > 0}
            selectedBranch={selectedBranch}
            vlOverlay={vlOverlay}
            onOverlayClose={handleOverlayClose}
            onOverlaySldTabChange={handleOverlaySldTabChange}
          />
        </div>
      </div>
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
          background: '#3498db', color: 'white',
          padding: '10px 20px', borderRadius: '4px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)', zIndex: 1000,
        }}>
          {infoMessage}
        </div>
      )}
    </div>
  );
}

export default App;
