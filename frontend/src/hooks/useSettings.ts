import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { api } from '../api';
import type { UserConfig } from '../api';
import type { SettingsBackup } from '../types';
import { interactionLogger } from '../utils/interactionLogger';

export interface SettingsState {
  // Config file path
  configFilePath: string;
  setConfigFilePath: (v: string) => void;
  lastActiveConfigFilePath: string;
  changeConfigFilePath: (newPath: string) => Promise<void>;

  // Paths
  networkPath: string;
  setNetworkPath: (v: string) => void;
  actionPath: string;
  setActionPath: (v: string) => void;
  layoutPath: string;
  setLayoutPath: (v: string) => void;
  outputFolderPath: string;
  setOutputFolderPath: (v: string) => void;

  // Recommender
  minLineReconnections: number;
  setMinLineReconnections: (v: number) => void;
  minCloseCoupling: number;
  setMinCloseCoupling: (v: number) => void;
  minOpenCoupling: number;
  setMinOpenCoupling: (v: number) => void;
  minLineDisconnections: number;
  setMinLineDisconnections: (v: number) => void;
  nPrioritizedActions: number;
  setNPrioritizedActions: (v: number) => void;
  minPst: number;
  setMinPst: (v: number) => void;
  minLoadShedding: number;
  setMinLoadShedding: (v: number) => void;
  ignoreReconnections: boolean;
  setIgnoreReconnections: (v: boolean) => void;

  // Monitoring
  linesMonitoringPath: string;
  setLinesMonitoringPath: (v: string) => void;
  monitoredLinesCount: number;
  setMonitoredLinesCount: (v: number) => void;
  totalLinesCount: number;
  setTotalLinesCount: (v: number) => void;
  showMonitoringWarning: boolean;
  setShowMonitoringWarning: (v: boolean) => void;
  monitoringFactor: number;
  setMonitoringFactor: (v: number) => void;
  preExistingOverloadThreshold: number;
  setPreExistingOverloadThreshold: (v: number) => void;
  pypowsyblFastMode: boolean;
  setPypowsyblFastMode: (v: boolean) => void;

  // Action dict info
  actionDictFileName: string | null;
  setActionDictFileName: (v: string | null) => void;
  actionDictStats: { reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number } | null;
  setActionDictStats: (v: { reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number } | null) => void;

  // Settings modal
  isSettingsOpen: boolean;
  setIsSettingsOpen: (v: boolean) => void;
  settingsTab: 'recommender' | 'configurations' | 'paths';
  setSettingsTab: (v: 'recommender' | 'configurations' | 'paths') => void;
  settingsBackup: SettingsBackup | null;
  setSettingsBackup: (v: SettingsBackup | null) => void;

  // Helpers
  pickSettingsPath: (type: 'file' | 'dir', setter: (path: string) => void) => Promise<void>;
  handleOpenSettings: (tab?: 'recommender' | 'configurations' | 'paths') => void;
  handleCloseSettings: () => void;
  buildConfigRequest: () => {
    network_path: string;
    action_file_path: string;
    layout_path: string;
    min_line_reconnections: number;
    min_close_coupling: number;
    min_open_coupling: number;
    min_line_disconnections: number;
    min_pst: number;
    min_load_shedding: number;
    n_prioritized_actions: number;
    lines_monitoring_path: string;
    monitoring_factor: number;
    pre_existing_overload_threshold: number;
    ignore_reconnections: boolean;
    pypowsybl_fast_mode: boolean;
  };
  applyConfigResponse: (configRes: Record<string, unknown>) => void;
  createCurrentBackup: () => SettingsBackup;
}

export function useSettings(): SettingsState {
  const [configFilePath, setConfigFilePath] = useState('');
  const lastConfigFilePathRef = useRef('');

  const [networkPath, setNetworkPath] = useState(localStorage.getItem('networkPath') || '');
  const [actionPath, setActionPath] = useState(localStorage.getItem('actionPath') || '');
  const [layoutPath, setLayoutPath] = useState(localStorage.getItem('layoutPath') || '');
  const [outputFolderPath, setOutputFolderPath] = useState(localStorage.getItem('outputFolderPath') || '');

  const [minLineReconnections, setMinLineReconnections] = useState(2.0);
  const [minCloseCoupling, setMinCloseCoupling] = useState(3.0);
  const [minOpenCoupling, setMinOpenCoupling] = useState(2.0);
  const [minLineDisconnections, setMinLineDisconnections] = useState(3.0);
  const [nPrioritizedActions, setNPrioritizedActions] = useState(10);
  const [minPst, setMinPst] = useState(1.0);
  const [minLoadShedding, setMinLoadShedding] = useState(0.0);
  const [ignoreReconnections, setIgnoreReconnections] = useState(false);

  const [linesMonitoringPath, setLinesMonitoringPath] = useState('');
  const [monitoredLinesCount, setMonitoredLinesCount] = useState(0);
  const [totalLinesCount, setTotalLinesCount] = useState(0);
  const [showMonitoringWarning, setShowMonitoringWarning] = useState(false);
  const [monitoringFactor, setMonitoringFactor] = useState(0.95);
  const [preExistingOverloadThreshold, setPreExistingOverloadThreshold] = useState(0.02);
  const [pypowsyblFastMode, setPypowsyblFastMode] = useState(true);

  const [actionDictFileName, setActionDictFileName] = useState<string | null>(null);
  const [actionDictStats, setActionDictStats] = useState<{ reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number } | null>(null);

  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'recommender' | 'configurations' | 'paths'>('paths');
  const [settingsBackup, setSettingsBackup] = useState<SettingsBackup | null>(null);

  // Track whether initial config load from backend is complete
  const configLoadedRef = useRef(false);

  // Helper to apply a loaded UserConfig object to all state fields
  const applyLoadedConfig = useCallback((cfg: UserConfig) => {
    if (cfg.network_path !== undefined) setNetworkPath(cfg.network_path);
    if (cfg.action_file_path !== undefined) setActionPath(cfg.action_file_path);
    if (cfg.layout_path !== undefined) setLayoutPath(cfg.layout_path);
    if (cfg.output_folder_path !== undefined) setOutputFolderPath(cfg.output_folder_path);
    if (cfg.lines_monitoring_path !== undefined) setLinesMonitoringPath(cfg.lines_monitoring_path);
    if (cfg.min_line_reconnections !== undefined) setMinLineReconnections(cfg.min_line_reconnections);
    if (cfg.min_close_coupling !== undefined) setMinCloseCoupling(cfg.min_close_coupling);
    if (cfg.min_open_coupling !== undefined) setMinOpenCoupling(cfg.min_open_coupling);
    if (cfg.min_line_disconnections !== undefined) setMinLineDisconnections(cfg.min_line_disconnections);
    if (cfg.min_pst !== undefined) setMinPst(cfg.min_pst);
    if (cfg.min_load_shedding !== undefined) setMinLoadShedding(cfg.min_load_shedding);
    if (cfg.n_prioritized_actions !== undefined) setNPrioritizedActions(cfg.n_prioritized_actions);
    if (cfg.monitoring_factor !== undefined) setMonitoringFactor(cfg.monitoring_factor);
    if (cfg.pre_existing_overload_threshold !== undefined) setPreExistingOverloadThreshold(cfg.pre_existing_overload_threshold);
    if (cfg.ignore_reconnections !== undefined) setIgnoreReconnections(cfg.ignore_reconnections);
    if (cfg.pypowsybl_fast_mode !== undefined) setPypowsyblFastMode(cfg.pypowsybl_fast_mode);
  }, []);

  // Load persisted config from backend on mount
  useEffect(() => {
    Promise.all([api.getUserConfig(), api.getConfigFilePath()])
      .then(([cfg, cfgPath]) => {
        applyLoadedConfig(cfg);
        setConfigFilePath(cfgPath);
        lastConfigFilePathRef.current = cfgPath;
        configLoadedRef.current = true;
      })
      .catch(() => {
        console.warn('Failed to load user config from backend, using defaults');
        configLoadedRef.current = true;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const changeConfigFilePath = useCallback(async (newPath: string) => {
    const result = await api.setConfigFilePath(newPath);
    setConfigFilePath(result.config_file_path);
    lastConfigFilePathRef.current = result.config_file_path;
    // Temporarily block auto-save so applying new config doesn't immediately overwrite
    configLoadedRef.current = false;
    applyLoadedConfig(result.config);
    configLoadedRef.current = true;
  }, [applyLoadedConfig]);

  // Persist settings to backend config file whenever they change
  useEffect(() => {
    if (!configLoadedRef.current) return; // skip until initial load is done
    const configToSave: UserConfig = {
      network_path: networkPath,
      action_file_path: actionPath,
      layout_path: layoutPath,
      output_folder_path: outputFolderPath,
      lines_monitoring_path: linesMonitoringPath,
      min_line_reconnections: minLineReconnections,
      min_close_coupling: minCloseCoupling,
      min_open_coupling: minOpenCoupling,
      min_line_disconnections: minLineDisconnections,
      min_pst: minPst,
      min_load_shedding: minLoadShedding,
      n_prioritized_actions: nPrioritizedActions,
      monitoring_factor: monitoringFactor,
      pre_existing_overload_threshold: preExistingOverloadThreshold,
      ignore_reconnections: ignoreReconnections,
      pypowsybl_fast_mode: pypowsyblFastMode,
    };

    // Sync to localStorage for instant UI availability on next reload/test
    localStorage.setItem('networkPath', networkPath);
    localStorage.setItem('actionPath', actionPath);
    localStorage.setItem('layoutPath', layoutPath);
    localStorage.setItem('outputFolderPath', outputFolderPath);

    api.saveUserConfig(configToSave).catch(() => {
      console.warn('Failed to persist user config to backend');
    });
  }, [networkPath, actionPath, layoutPath, outputFolderPath, linesMonitoringPath,
    minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections,
    minPst, minLoadShedding, nPrioritizedActions, monitoringFactor, preExistingOverloadThreshold,
    ignoreReconnections, pypowsyblFastMode]);

  const pickSettingsPath = useCallback(async (type: 'file' | 'dir', setter: (path: string) => void) => {
    try {
      const path = await api.pickPath(type);
      if (path) {
        interactionLogger.record('path_picked', { type, path });
        setter(path);
      }
    } catch {
      console.error('Failed to open file picker');
    }
  }, []);

  const createCurrentBackup = useCallback((): SettingsBackup => ({
    networkPath,
    actionPath,
    layoutPath,
    outputFolderPath,
    minLineReconnections,
    minCloseCoupling,
    minOpenCoupling,
    minLineDisconnections,
    minLoadShedding,
    nPrioritizedActions,
    linesMonitoringPath,
    monitoringFactor,
    preExistingOverloadThreshold,
    ignoreReconnections,
    pypowsyblFastMode,
  }), [networkPath, actionPath, layoutPath, outputFolderPath, minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, minLoadShedding, nPrioritizedActions, linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode]);

  const handleOpenSettings = useCallback((tab: 'recommender' | 'configurations' | 'paths' = 'paths') => {
    interactionLogger.record('settings_opened', { tab });
    setSettingsBackup(createCurrentBackup());
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  }, [createCurrentBackup]);

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
      setMinLoadShedding(settingsBackup.minLoadShedding ?? 0.0);
      setNPrioritizedActions(settingsBackup.nPrioritizedActions);
      setLinesMonitoringPath(settingsBackup.linesMonitoringPath);
      setMonitoringFactor(settingsBackup.monitoringFactor);
      setPreExistingOverloadThreshold(settingsBackup.preExistingOverloadThreshold);
      setIgnoreReconnections(settingsBackup.ignoreReconnections ?? false);
      setPypowsyblFastMode(settingsBackup.pypowsyblFastMode ?? true);
    }
    setIsSettingsOpen(false);
  }, [settingsBackup]);

  const buildConfigRequest = useCallback(() => ({
    network_path: networkPath,
    action_file_path: actionPath,
    layout_path: layoutPath,
    min_line_reconnections: minLineReconnections,
    min_close_coupling: minCloseCoupling,
    min_open_coupling: minOpenCoupling,
    min_line_disconnections: minLineDisconnections,
    min_pst: minPst,
    min_load_shedding: minLoadShedding,
    n_prioritized_actions: nPrioritizedActions,
    lines_monitoring_path: linesMonitoringPath,
    monitoring_factor: monitoringFactor,
    pre_existing_overload_threshold: preExistingOverloadThreshold,
    ignore_reconnections: ignoreReconnections,
    pypowsybl_fast_mode: pypowsyblFastMode,
  }), [networkPath, actionPath, layoutPath, minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, minPst, minLoadShedding, nPrioritizedActions, linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode]);

  const applyConfigResponse = useCallback((configRes: Record<string, unknown>) => {
    if (configRes && configRes.total_lines_count !== undefined) {
      setMonitoredLinesCount(configRes.monitored_lines_count as number);
      setTotalLinesCount(configRes.total_lines_count as number);
      if ((configRes.monitored_lines_count as number) < (configRes.total_lines_count as number)) {
        setShowMonitoringWarning(true);
      }
    }
    if (configRes?.action_dict_file_name) setActionDictFileName(configRes.action_dict_file_name as string);
    if (configRes?.action_dict_stats) setActionDictStats(configRes.action_dict_stats as { reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number });
  }, []);

  return useMemo(() => ({
    configFilePath, setConfigFilePath, changeConfigFilePath, lastActiveConfigFilePath: lastConfigFilePathRef.current,
    networkPath, setNetworkPath,
    actionPath, setActionPath,
    layoutPath, setLayoutPath,
    outputFolderPath, setOutputFolderPath,
    minLineReconnections, setMinLineReconnections,
    minCloseCoupling, setMinCloseCoupling,
    minOpenCoupling, setMinOpenCoupling,
    minLineDisconnections, setMinLineDisconnections,
    nPrioritizedActions, setNPrioritizedActions,
    minPst, setMinPst,
    minLoadShedding, setMinLoadShedding,
    ignoreReconnections, setIgnoreReconnections,
    linesMonitoringPath, setLinesMonitoringPath,
    monitoredLinesCount, setMonitoredLinesCount,
    totalLinesCount, setTotalLinesCount,
    showMonitoringWarning, setShowMonitoringWarning,
    monitoringFactor, setMonitoringFactor,
    preExistingOverloadThreshold, setPreExistingOverloadThreshold,
    pypowsyblFastMode, setPypowsyblFastMode,
    actionDictFileName, setActionDictFileName,
    actionDictStats, setActionDictStats,
    isSettingsOpen, setIsSettingsOpen,
    settingsTab, setSettingsTab,
    settingsBackup, setSettingsBackup,
    pickSettingsPath,
    handleOpenSettings,
    handleCloseSettings,
    buildConfigRequest,
    applyConfigResponse,
    createCurrentBackup,
  }), [
    networkPath, actionPath, layoutPath, outputFolderPath,
    minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections,
    nPrioritizedActions, minPst, minLoadShedding, ignoreReconnections,
    linesMonitoringPath, monitoredLinesCount, totalLinesCount, showMonitoringWarning, monitoringFactor, preExistingOverloadThreshold, pypowsyblFastMode,
    actionDictFileName, actionDictStats,
    isSettingsOpen, settingsTab, settingsBackup,
    configFilePath, changeConfigFilePath,
    pickSettingsPath, handleOpenSettings, handleCloseSettings, buildConfigRequest, applyConfigResponse, createCurrentBackup
  ]);
}
