import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';

vi.mock('./components/VisualizationPanel', () => ({
  default: () => <div data-testid="viz" />,
}));
vi.mock('./components/ActionFeed', () => ({ default: () => <div /> }));
vi.mock('./components/OverloadPanel', () => ({ default: () => <div /> }));
vi.mock('./hooks/usePanZoom', () => ({ usePanZoom: () => ({ viewBox: null, setViewBox: vi.fn() }) }));
vi.mock('./utils/svgUtils', () => ({
  processSvg: (svg: string) => ({ svg, viewBox: { x: 0, y: 0, w: 100, h: 100 } }),
  buildMetadataIndex: () => null,
  applyOverloadedHighlights: vi.fn(),
  applyDeltaVisuals: vi.fn(),
  applyActionTargetHighlights: vi.fn(),
  applyContingencyHighlight: vi.fn(),
  getIdMap: () => new Map(),
  invalidateIdMapCache: vi.fn(),
  isCouplingAction: vi.fn(() => false),
  applyVlTitles: vi.fn(),
}));

const mockApi = vi.hoisted(() => ({
  getUserConfig: vi.fn().mockResolvedValue({
    network_path: '/old/network.xiidm',
    action_file_path: '/old/actions.json',
    layout_path: '/old/layout.json',
    output_folder_path: '/old/sessions',
    lines_monitoring_path: '',
    min_line_reconnections: 2.0,
    min_close_coupling: 3.0,
    min_open_coupling: 2.0,
    min_line_disconnections: 3.0,
    min_pst: 1.0,
    n_prioritized_actions: 10,
    monitoring_factor: 0.95,
    pre_existing_overload_threshold: 0.02,
    ignore_reconnections: false,
    pypowsybl_fast_mode: true,
    force_layout: false,
  }),
  saveUserConfig: vi.fn().mockResolvedValue({}),
  getConfigFilePath: vi.fn().mockResolvedValue('/old/config.json'),
  // KEY: mock returns a NEW config that is different from the initial.
  setConfigFilePath: vi.fn().mockResolvedValue({
    config_file_path: '/picked/new_config.json',
    config: {
      network_path: '/picked/new_network.xiidm',
      action_file_path: '/picked/new_actions.json',
      layout_path: '/picked/new_layout.json',
      output_folder_path: '/picked/new_sessions',
      lines_monitoring_path: '',
      min_line_reconnections: 2.0,
      min_close_coupling: 3.0,
      min_open_coupling: 2.0,
      min_line_disconnections: 3.0,
      min_pst: 1.0,
      n_prioritized_actions: 15,
      monitoring_factor: 0.95,
      pre_existing_overload_threshold: 0.02,
      ignore_reconnections: false,
      pypowsybl_fast_mode: true,
      force_layout: true,
    },
  }),
  pickPath: vi.fn().mockResolvedValue('/picked/new_config.json'),
  updateConfig: vi.fn().mockResolvedValue({ monitored_lines_count: 10, total_lines_count: 10 }),
  getBranches: vi.fn().mockResolvedValue({ branches: [], name_map: {} }),
  getVoltageLevels: vi.fn().mockResolvedValue({ voltage_levels: [], name_map: {} }),
  getNominalVoltages: vi.fn().mockResolvedValue({ mapping: {}, unique_kv: [] }),
  getVoltageLevelSubstations: vi.fn().mockResolvedValue({ mapping: {} }),
  getNetworkDiagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
  getN1Diagram: vi.fn(),
  runAnalysisStep1: vi.fn(),
  runAnalysisStep2Stream: vi.fn(),
  getActionVariantDiagram: vi.fn(),
  getNSld: vi.fn(),
  getN1Sld: vi.fn(),
  getActionVariantSld: vi.fn(),
}));
vi.mock('./api', () => ({ api: mockApi }));

afterEach(() => cleanup());

describe('Config upload state propagation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('updates network/action/layout/output/parameter inputs after picking a new config file', async () => {
    render(<App />);
    await waitFor(() => expect(mockApi.getUserConfig).toHaveBeenCalled());

    const settingsBtn = screen.getByTitle('Settings');
    await act(async () => { await userEvent.click(settingsBtn); });
    await waitFor(() => expect(screen.getByText('Apply')).toBeInTheDocument());

    const networkInput = screen.getByLabelText(/Network File Path/i) as HTMLInputElement;
    expect(networkInput.value).toBe('/old/network.xiidm');

    const configInput = screen.getByLabelText(/Config File Path/i) as HTMLInputElement;
    expect(configInput.value).toBe('/old/config.json');
    const configPickerBtn = configInput.parentElement!.querySelectorAll('button')[0] as HTMLButtonElement;
    await act(async () => { await userEvent.click(configPickerBtn); });

    await waitFor(() => expect(configInput.value).toBe('/picked/new_config.json'));

    expect(networkInput.value).toBe('/picked/new_network.xiidm');
    const actionInput = screen.getByLabelText(/Action Dictionary File Path/i) as HTMLInputElement;
    expect(actionInput.value).toBe('/picked/new_actions.json');
    const layoutInput = screen.getByLabelText(/Layout File Path/i) as HTMLInputElement;
    expect(layoutInput.value).toBe('/picked/new_layout.json');
    const outputInput = screen.getByPlaceholderText(/sessions/i) as HTMLInputElement;
    expect(outputInput.value).toBe('/picked/new_sessions');
  });

  it('updates inputs when user TYPES a new config path and blurs the input', async () => {
    render(<App />);
    await waitFor(() => expect(mockApi.getUserConfig).toHaveBeenCalled());

    const settingsBtn = screen.getByTitle('Settings');
    await act(async () => { await userEvent.click(settingsBtn); });
    await waitFor(() => expect(screen.getByText('Apply')).toBeInTheDocument());

    const configInput = screen.getByLabelText(/Config File Path/i) as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(configInput);
      await userEvent.type(configInput, '/picked/new_config.json');
      // Trigger onBlur explicitly
      configInput.blur();
    });

    // Wait for the blur-triggered backend roundtrip + state updates
    await waitFor(() => {
      const networkInput = screen.getByLabelText(/Network File Path/i) as HTMLInputElement;
      expect(networkInput.value).toBe('/picked/new_network.xiidm');
    });
  });

  it('config-file-input typed but never blurred: Apply still loads the new config and propagates it', async () => {
    render(<App />);
    await waitFor(() => expect(mockApi.getUserConfig).toHaveBeenCalled());

    const settingsBtn = screen.getByTitle('Settings');
    await act(async () => { await userEvent.click(settingsBtn); });
    await waitFor(() => expect(screen.getByText('Apply')).toBeInTheDocument());

    const configInput = screen.getByLabelText(/Config File Path/i) as HTMLInputElement;
    await act(async () => {
      await userEvent.clear(configInput);
      await userEvent.type(configInput, '/picked/new_config.json');
      // DO NOT blur. The user clicks Apply directly, focus moves to button.
    });

    // Click Apply — modal closes, but state should reflect the loaded config.
    const applyBtn = screen.getByText('Apply');
    await act(async () => { await userEvent.click(applyBtn); });

    // Modal closes after Apply, so we re-open to inspect state.
    await waitFor(() => expect(screen.queryByText('Apply')).not.toBeInTheDocument());
    await act(async () => { await userEvent.click(screen.getByTitle('Settings')); });
    await waitFor(() => expect(screen.getByText('Apply')).toBeInTheDocument());

    // After Apply round-trip, the modal should show the new loaded values
    // (matches the operator's symptom: "paths are not updated in the modal").
    const networkInput = screen.getByLabelText(/Network File Path/i) as HTMLInputElement;
    const actionInput = screen.getByLabelText(/Action Dictionary File Path/i) as HTMLInputElement;
    const layoutInput = screen.getByLabelText(/Layout File Path/i) as HTMLInputElement;
    expect(networkInput.value).toBe('/picked/new_network.xiidm');
    expect(actionInput.value).toBe('/picked/new_actions.json');
    expect(layoutInput.value).toBe('/picked/new_layout.json');

    // Critical: backend must have been called with the NEW network path
    // (not the old stale closure value). This asserts the absence of the
    // stale-closure bug between `await changeConfigFilePath()` and the
    // immediately-following `buildConfigRequest()` in `applySettingsImmediate`.
    expect(mockApi.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
      network_path: '/picked/new_network.xiidm',
      action_file_path: '/picked/new_actions.json',
      layout_path: '/picked/new_layout.json',
    }));
  });
});
