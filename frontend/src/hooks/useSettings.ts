import { useState, useEffect, useCallback } from 'react';
import { api } from '../api';
import type { SettingsBackup } from '../types';

export interface SettingsState {
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
  // Paths
  const [networkPath, setNetworkPath] = useState('');
  const [actionPath, setActionPath] = useState('');
  const [layoutPath, setLayoutPath] = useState('');
  const [outputFolderPath, setOutputFolderPath] = useState('');

  // Recommender
  const [minLineReconnections, setMinLineReconnections] = useState(2.0);
  const [minCloseCoupling, setMinCloseCoupling] = useState(3.0);
  const [minOpenCoupling, setMinOpenCoupling] = useState(2.0);
  const [minLineDisconnections, setMinLineDisconnections] = useState(3.0);
  const [nPrioritizedActions, setNPrioritizedActions] = useState(10);
  const [minPst, setMinPst] = useState(1.0);
  const [ignoreReconnections, setIgnoreReconnections] = useState(false);

  // Monitoring
  const [linesMonitoringPath, setLinesMonitoringPath] = useState('');
  const [monitoredLinesCount, setMonitoredLinesCount] = useState(0);
  const [totalLinesCount, setTotalLinesCount] = useState(0);
  const [showMonitoringWarning, setShowMonitoringWarning] = useState(false);
  const [monitoringFactor, setMonitoringFactor] = useState(0.95);
  const [preExistingOverloadThreshold, setPreExistingOverloadThreshold] = useState(0.02);
  const [pypowsyblFastMode, setPypowsyblFastMode] = useState(true);

  // Action dict info
  const [actionDictFileName, setActionDictFileName] = useState<string | null>(null);
  const [actionDictStats, setActionDictStats] = useState<{ reco: number; disco: number; pst: number; open_coupling: number; close_coupling: number; total: number } | null>(null);

  // Settings modal
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsTab, setSettingsTab] = useState<'recommender' | 'configurations' | 'paths'>('paths');
  const [settingsBackup, setSettingsBackup] = useState<SettingsBackup | null>(null);

  // Load paths from localStorage on initial mount
  useEffect(() => {
    const savedNetwork = localStorage.getItem('networkPath');
    const savedAction = localStorage.getItem('actionPath');
    const savedLayout = localStorage.getItem('layoutPath');
    const savedOutput = localStorage.getItem('outputFolderPath');

    /* eslint-disable react-hooks/set-state-in-effect */
    setNetworkPath(savedNetwork || '/home/marotant/dev/Expert_op4grid_recommender/data/bare_env_20240828T0100Z_dijon_only');
    setActionPath(savedAction || '/home/marotant/dev/Expert_op4grid_recommender/data/action_space/reduced_model_actions_20240828T0100Z_new_dijon.json');
    setLayoutPath(savedLayout || '');
    setOutputFolderPath(savedOutput || '');
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // Persist paths to localStorage
  useEffect(() => {
    localStorage.setItem('networkPath', networkPath);
    localStorage.setItem('actionPath', actionPath);
    localStorage.setItem('layoutPath', layoutPath);
    localStorage.setItem('outputFolderPath', outputFolderPath);
  }, [networkPath, actionPath, layoutPath, outputFolderPath]);

  const pickSettingsPath = useCallback(async (type: 'file' | 'dir', setter: (path: string) => void) => {
    try {
      const path = await api.pickPath(type);
      if (path) setter(path);
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
    nPrioritizedActions,
    linesMonitoringPath,
    monitoringFactor,
    preExistingOverloadThreshold,
    ignoreReconnections,
    pypowsyblFastMode,
  }), [networkPath, actionPath, layoutPath, outputFolderPath, minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, nPrioritizedActions, linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode]);

  const handleOpenSettings = useCallback((tab: 'recommender' | 'configurations' | 'paths' = 'paths') => {
    setSettingsBackup(createCurrentBackup());
    setSettingsTab(tab);
    setIsSettingsOpen(true);
  }, [createCurrentBackup]);

  const handleCloseSettings = useCallback(() => {
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

  const buildConfigRequest = useCallback(() => ({
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
  }), [networkPath, actionPath, layoutPath, minLineReconnections, minCloseCoupling, minOpenCoupling, minLineDisconnections, minPst, nPrioritizedActions, linesMonitoringPath, monitoringFactor, preExistingOverloadThreshold, ignoreReconnections, pypowsyblFastMode]);

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

  return {
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
  };
}
