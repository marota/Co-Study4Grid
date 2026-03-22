import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

// ===== Mocks =====

// Mock child components to avoid their complexity
vi.mock('./components/VisualizationPanel', () => {
  const MockVisualizationPanel = ({ nDiagram, configLoading, networkPath, layoutPath, onOpenSettings }: {
    nDiagram: { svg: string } | null;
    configLoading: boolean;
    networkPath: string;
    layoutPath: string;
    onOpenSettings: (tab: string) => void;
  }) => {
    const [warningDismissed, setWarningDismissed] = React.useState(false);
    const hasAnyDiagram = !!nDiagram?.svg;
    const showPathWarning = !warningDismissed && !hasAnyDiagram;

    return (
      <div data-testid="visualization-panel">
        {!nDiagram?.svg && !configLoading && showPathWarning && (
          <div>
            <div>Configuration Paths</div>
            <button onClick={() => setWarningDismissed(true)}>✕</button>
            <div>Layout Path: {layoutPath}</div>
            <div>Output Folder: {networkPath ? (networkPath.includes('/') ? networkPath.substring(0, networkPath.lastIndexOf('/')) : networkPath) : 'Not set'}</div>
            <button onClick={() => onOpenSettings('paths')}>Change in settings</button>
          </div>
        )}
      </div>
    );
  };
  return { default: MockVisualizationPanel };
});
vi.mock('./components/ActionFeed', () => ({
  default: (props: { linesOverloaded: string[]; pendingAnalysisResult: object | null; analysisLoading: boolean; onDisplayPrioritizedActions: () => void }) => (
    <div
      data-testid="action-feed"
      data-ol-count={props.linesOverloaded?.length || 0}
      data-pending={!!props.pendingAnalysisResult}
      data-loading={!!props.analysisLoading}
    >
      {props.pendingAnalysisResult && (
        <button onClick={props.onDisplayPrioritizedActions}>Display prioritized actions</button>
      )}
    </div>
  ),
}));
vi.mock('./components/OverloadPanel', () => ({
  default: (props: { n1Overloads: string[]; selectedOverloads: Set<string> }) => (
    <div
      data-testid="overload-panel"
      data-n1-ol-count={props.n1Overloads?.length || 0}
      data-sel-ol-count={props.selectedOverloads?.size || 0}
    />
  ),
}));

// Mock hooks
vi.mock('./hooks/usePanZoom', () => ({
  usePanZoom: () => ({ viewBox: null, setViewBox: vi.fn() }),
}));

// Mock SVG utilities
vi.mock('./utils/svgUtils', () => ({
  buildMetadataIndex: () => null,
  applyOverloadedHighlights: vi.fn(),
  applyDeltaVisuals: vi.fn(),
  applyActionTargetHighlights: vi.fn(),
  applyContingencyHighlight: vi.fn(),
  getIdMap: () => new Map(),
  invalidateIdMapCache: vi.fn(),
}));

vi.mock('./utils/svgWorkerClient', () => ({
  processSvgAsync: vi.fn().mockResolvedValue({ svg: '<svg></svg>', viewBox: { x: 0, y: 0, w: 100, h: 100 } }),
}));

// Mock API — use vi.hoisted to define mock before vi.mock hoists
const mockApi = vi.hoisted(() => ({
  updateConfig: vi.fn().mockResolvedValue({ monitored_lines_count: 10, total_lines_count: 10 }),
  getBranches: vi.fn().mockResolvedValue(['BRANCH_A', 'BRANCH_B', 'BRANCH_C']),
  getVoltageLevels: vi.fn().mockResolvedValue(['VL1', 'VL2']),
  getNominalVoltages: vi.fn().mockResolvedValue({ mapping: {}, unique_kv: [63, 225] }),
  getNetworkDiagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
  getN1Diagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null, lines_overloaded: [] }),
  pickPath: vi.fn(),
  runAnalysisStep1: vi.fn().mockResolvedValue({ can_proceed: true, lines_overloaded: ['LINE_OL1'] }),
  runAnalysisStep2Stream: vi.fn(),
  getActionVariantDiagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
  getNSld: vi.fn(),
  getN1Sld: vi.fn(),
  getActionVariantSld: vi.fn(),
}));

vi.mock('./api', () => ({
  api: mockApi,
}));

// Helper: render App, load config, wait for branches to appear
async function renderAndLoadStudy() {
  render(<App />);

  // Click Load Study
  const loadBtn = screen.getByText('🔄 Load Study');
  await userEvent.click(loadBtn);

  // Wait for branches to be loaded (which means handleLoadConfig is done)
  await waitFor(() => {
    expect(screen.getByText('🎯 Select Contingency')).toBeInTheDocument();
  }, { timeout: 5000 });
}

// Helper: select a valid branch by typing the full name
async function selectBranch(branchName: string) {
  const input = screen.getByPlaceholderText('Search line/bus...');
  await act(async () => {
    await userEvent.clear(input);
    await userEvent.type(input, branchName);
  });
  // Wait for N-1 diagram fetch to complete
  await waitFor(() => {
    expect(mockApi.getN1Diagram).toHaveBeenCalledWith(branchName);
  });
}

// Helper: run analysis to create analysis state
async function runAnalysis() {
  // Mock runAnalysisStep2Stream to return a streaming Response
  const mockStream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        JSON.stringify({ type: 'result', actions: { ACT1: { is_manual: false, rho_before: [1.02], rho_after: [0.95] } }, lines_overloaded: ['LINE_OL1'], message: 'done', dc_fallback: false }) + '\n'
      ));
      controller.close();
    },
  });
  mockApi.runAnalysisStep2Stream.mockResolvedValue({
    ok: true,
    body: mockStream,
  });

  const runBtn = screen.getByText('🚀 Run Analysis');
  await act(async () => {
    await userEvent.click(runBtn);
  });

  await waitFor(() => {
    const running = screen.queryByText('⚙️ Running...');
    if (running) throw new Error('Still running...');
  }, { timeout: 5000 });

  // Click Display Actions if present
  const displayBtn = await screen.findByText(/Display.*prioritized actions/, {}, { timeout: 3000 });
  await userEvent.click(displayBtn);
}

describe('Contingency Change Confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    // Reset fetch stub
    vi.unstubAllGlobals();
  });

  it('does NOT show confirmation dialog when no analysis state exists', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    // Now switch to BRANCH_B — no analysis has been run, so no dialog
    mockApi.getN1Diagram.mockClear();
    const input = screen.getByPlaceholderText('Search line/bus...');
    await act(async () => {
      await userEvent.clear(input);
      await userEvent.type(input, 'BRANCH_B');
    });

    await waitFor(() => {
      expect(mockApi.getN1Diagram).toHaveBeenCalledWith('BRANCH_B');
    });

    // No dialog should appear
    expect(screen.queryByText('Change Contingency?')).not.toBeInTheDocument();
  });

  it('shows confirmation dialog when switching branch after running analysis', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    // Now try to switch to BRANCH_B
    mockApi.getN1Diagram.mockClear();
    const input = screen.getByPlaceholderText('Search line/bus...');
    await act(async () => {
      await userEvent.clear(input);
      await userEvent.type(input, 'BRANCH_B');
    });

    // Dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Change Contingency?')).toBeInTheDocument();
    });
    expect(screen.getByText(/All previous analysis results/)).toBeInTheDocument();
    expect(screen.getByText(/The network state will be preserved/)).toBeInTheDocument();

    // N-1 diagram should NOT have been fetched for BRANCH_B yet
    expect(mockApi.getN1Diagram).not.toHaveBeenCalledWith('BRANCH_B');
  });

  it('clears state and switches branch when user confirms', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    // Switch to BRANCH_B
    mockApi.getN1Diagram.mockClear();
    const input = screen.getByPlaceholderText('Search line/bus...');
    await act(async () => {
      await userEvent.clear(input);
      await userEvent.type(input, 'BRANCH_B');
    });

    await waitFor(() => {
      expect(screen.getByText('Change Contingency?')).toBeInTheDocument();
    });

    // Click Confirm
    await act(async () => {
      await userEvent.click(screen.getByText('Confirm'));
    });

    // Dialog should close
    expect(screen.queryByText('Change Contingency?')).not.toBeInTheDocument();

    // N-1 should be fetched for the new branch
    await waitFor(() => {
      expect(mockApi.getN1Diagram).toHaveBeenCalledWith('BRANCH_B');
    });
  });

  it('reverts to old branch and keeps state when user cancels', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    // Switch to BRANCH_B
    mockApi.getN1Diagram.mockClear();
    const input = screen.getByPlaceholderText('Search line/bus...');
    await act(async () => {
      await userEvent.clear(input);
      await userEvent.type(input, 'BRANCH_B');
    });

    await waitFor(() => {
      expect(screen.getByText('Change Contingency?')).toBeInTheDocument();
    });

    // Click Cancel
    await act(async () => {
      await userEvent.click(screen.getByText('Cancel'));
    });

    // Dialog should close
    expect(screen.queryByText('Change Contingency?')).not.toBeInTheDocument();

    // N-1 should NOT have been fetched for BRANCH_B
    expect(mockApi.getN1Diagram).not.toHaveBeenCalledWith('BRANCH_B');

    // Input should revert to BRANCH_A
    expect(input).toHaveValue('BRANCH_A');
  });

  it('does not trigger dialog for partial/invalid branch text', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    // Type partial text that doesn't match any branch
    mockApi.getN1Diagram.mockClear();
    const input = screen.getByPlaceholderText('Search line/bus...');
    await act(async () => {
      await userEvent.clear(input);
      await userEvent.type(input, 'BRAN');
    });

    // No dialog — partial text is not a valid branch
    expect(screen.queryByText('Change Contingency?')).not.toBeInTheDocument();
    // N-1 should not be fetched for invalid branch
    expect(mockApi.getN1Diagram).not.toHaveBeenCalled();
  });
});

describe('Load Study Confirmation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('loads study directly when no analysis state exists', async () => {
    render(<App />);

    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    // No dialog, just loads
    expect(screen.queryByText('Reload Study?')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });
  });

  it('shows confirmation dialog when clicking Load Study after running analysis', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    mockApi.updateConfig.mockClear();

    // Click Load Study again
    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    // Dialog should appear
    await waitFor(() => {
      expect(screen.getByText('Reload Study?')).toBeInTheDocument();
    });
    expect(screen.getByText(/The network will be reloaded from scratch/)).toBeInTheDocument();

    // Config should NOT have been called yet
    expect(mockApi.updateConfig).not.toHaveBeenCalled();
  });

  it('reloads study when user confirms Load Study dialog', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    mockApi.updateConfig.mockClear();

    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Reload Study?')).toBeInTheDocument();
    });

    // Click Confirm
    await act(async () => {
      await userEvent.click(screen.getByText('Confirm'));
    });

    // Dialog should close and config should be called
    expect(screen.queryByText('Reload Study?')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });
  });

  it('keeps state when user cancels Load Study dialog', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    mockApi.updateConfig.mockClear();

    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Reload Study?')).toBeInTheDocument();
    });

    // Click Cancel
    await act(async () => {
      await userEvent.click(screen.getByText('Cancel'));
    });

    // Dialog should close, config should NOT be called
    expect(screen.queryByText('Reload Study?')).not.toBeInTheDocument();
    expect(mockApi.updateConfig).not.toHaveBeenCalled();
  });
});

describe('Full State Reset on Load Study', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('clears branch selection after Load Study with no prior analysis state', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('BRANCH_A');

    mockApi.updateConfig.mockClear();
    mockApi.getBranches.mockClear();

    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    // No dialog — no analysis state
    expect(screen.queryByText('Reload Study?')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockApi.getBranches).toHaveBeenCalled();
    });

    // Branch input should be cleared
    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('');
  });

  it('clears branch selection after confirming Load Study with analysis state', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('BRANCH_A');

    mockApi.updateConfig.mockClear();
    mockApi.getBranches.mockClear();

    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Reload Study?')).toBeInTheDocument();
    });

    await act(async () => {
      await userEvent.click(screen.getByText('Confirm'));
    });

    expect(screen.queryByText('Reload Study?')).not.toBeInTheDocument();

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(mockApi.getBranches).toHaveBeenCalled();
    });

    // Branch input must be cleared after reset
    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('');
  });

  it('re-fetches branches after Load Study reset', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    mockApi.getBranches.mockClear();

    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    await waitFor(() => {
      expect(mockApi.getBranches).toHaveBeenCalled();
    });
  });

  it('preserves configuration paths across Load Study reset', async () => {
    await renderAndLoadStudy();

    const firstCallArgs = mockApi.updateConfig.mock.calls[0][0];
    expect(firstCallArgs.network_path).toBeTruthy();
    expect(firstCallArgs.action_file_path).toBeTruthy();

    mockApi.updateConfig.mockClear();

    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => {
      await userEvent.click(loadBtn);
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });

    const secondCallArgs = mockApi.updateConfig.mock.calls[0][0];
    expect(secondCallArgs.network_path).toBe(firstCallArgs.network_path);
    expect(secondCallArgs.action_file_path).toBe(firstCallArgs.action_file_path);
  });
});

describe('Full State Reset on Apply Settings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  async function openSettings() {
    const settingsBtn = screen.getByTitle('Settings');
    await act(async () => {
      await userEvent.click(settingsBtn);
    });
    await waitFor(() => {
      expect(screen.getByText('Apply')).toBeInTheDocument();
    });
  }

  it('clears branch selection after Apply Settings', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('BRANCH_A');

    mockApi.updateConfig.mockClear();

    await openSettings();

    await act(async () => {
      await userEvent.click(screen.getByText('Apply'));
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });

    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('');
    expect(screen.queryByText('Apply')).not.toBeInTheDocument();
  });

  it('clears branch and analysis state after Apply Settings with analysis state', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('BRANCH_A');

    mockApi.updateConfig.mockClear();

    await openSettings();

    await act(async () => {
      await userEvent.click(screen.getByText('Apply'));
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });

    expect(screen.getByPlaceholderText('Search line/bus...')).toHaveValue('');
    expect(screen.queryByText('Apply')).not.toBeInTheDocument();
  });

  it('closes settings modal after Apply Settings', async () => {
    await renderAndLoadStudy();
    await openSettings();

    expect(screen.getByText('Apply')).toBeInTheDocument();

    await act(async () => {
      await userEvent.click(screen.getByText('Apply'));
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });

    expect(screen.queryByText('Apply')).not.toBeInTheDocument();
  });

  it('calls updateConfig with current settings values after Apply Settings', async () => {
    await renderAndLoadStudy();

    mockApi.updateConfig.mockClear();

    await openSettings();

    await act(async () => {
      await userEvent.click(screen.getByText('Apply'));
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });

    const callArgs = mockApi.updateConfig.mock.calls[0][0];
    expect(callArgs).toHaveProperty('min_line_reconnections');
    expect(callArgs).toHaveProperty('monitoring_factor');
    expect(callArgs).toHaveProperty('n_prioritized_actions');
  });

  it('re-fetches branches after Apply Settings', async () => {
    await renderAndLoadStudy();

    mockApi.getBranches.mockClear();
    mockApi.updateConfig.mockClear();

    await openSettings();

    await act(async () => {
      await userEvent.click(screen.getByText('Apply'));
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });

    // Apply Settings DOES now re-fetch branches (matching Load Study behavior)
    expect(mockApi.getBranches).toHaveBeenCalled();
  });
});

describe('Save Results button', () => {
  beforeEach(() => {
    vi.restoreAllMocks();  // restores spied-on originals before each test
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:mock-url');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => { });
  });

  it('is present in the header after study load', async () => {
    await renderAndLoadStudy();
    expect(screen.getByTitle('Save session results to JSON')).toBeInTheDocument();
  });

  it('is disabled when no branch has been selected', async () => {
    await renderAndLoadStudy();
    const saveBtn = screen.getByTitle('Save session results to JSON');
    expect(saveBtn).toBeDisabled();
  });

  it('is enabled after selecting a valid branch', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    const saveBtn = screen.getByTitle('Save session results to JSON');
    expect(saveBtn).not.toBeDisabled();
  });

  it('triggers a JSON download when clicked after branch selection', async () => {
    const createObjectURL = vi.spyOn(URL, 'createObjectURL');
    // Spy on anchor click to capture download without browser navigation
    const originalCreateElement = document.createElement.bind(document);
    const anchorClicks: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = originalCreateElement(tag as keyof HTMLElementTagNameMap);
      if (tag === 'a') {
        vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => {
          anchorClicks.push(el as HTMLAnchorElement);
        });
      }
      return el;
    });

    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    const saveBtn = screen.getByTitle('Save session results to JSON');
    await act(async () => {
      await userEvent.click(saveBtn);
    });

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(anchorClicks).toHaveLength(1);
    const anchor = anchorClicks[0];
    expect(anchor.download).toMatch(/^expertassist_session_BRANCH_A_/);
    expect(anchor.download).toMatch(/\.json$/);
  });

  it('JSON download contains configuration, contingency, and overloads sections', async () => {
    let capturedBlob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return 'blob:mock-url';
    });
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag as keyof HTMLElementTagNameMap);
      if (tag === 'a') vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => { });
      return el;
    });

    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    const saveBtn = screen.getByTitle('Save session results to JSON');
    await act(async () => {
      await userEvent.click(saveBtn);
    });

    expect(capturedBlob).toBeDefined();
    const text = await capturedBlob!.text();
    const session = JSON.parse(text);

    expect(session).toHaveProperty('saved_at');
    expect(session).toHaveProperty('configuration');
    expect(session.configuration).toHaveProperty('network_path');
    expect(session.configuration).toHaveProperty('layout_path');
    expect(session.configuration).toHaveProperty('monitoring_factor');
    expect(session).toHaveProperty('contingency');
    expect(session.contingency.disconnected_element).toBe('BRANCH_A');
    expect(session).toHaveProperty('overloads');
    expect(session).toHaveProperty('analysis');
  });

  it('JSON analysis is null when no analysis has been run', async () => {
    let capturedBlob: Blob | undefined;
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
      capturedBlob = blob as Blob;
      return 'blob:mock-url';
    });
    const origCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag) => {
      const el = origCreate(tag as keyof HTMLElementTagNameMap);
      if (tag === 'a') vi.spyOn(el as HTMLAnchorElement, 'click').mockImplementation(() => { });
      return el;
    });

    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    const saveBtn = screen.getByTitle('Save session results to JSON');
    await act(async () => {
      await userEvent.click(saveBtn);
    });

    const session = JSON.parse(await capturedBlob!.text());
    expect(session.analysis).toBeNull();
  });
});

describe('Settings Modal Enhancements', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  async function openSettings() {
    render(<App />);
    const settingsBtn = screen.getByTitle('Settings');
    await act(async () => {
      await userEvent.click(settingsBtn);
    });
    await waitFor(() => {
      expect(screen.getByText('Apply')).toBeInTheDocument();
    });
  }

  it('defaults to the Paths tab when opened', async () => {
    await openSettings();
    // The Paths tab should be active. We can check for a path-specific input.
    expect(screen.getByLabelText(/Network File Path/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Layout File Path/i)).toBeInTheDocument();
  });

  it('auto-closes and fetches study data on Apply', async () => {
    await openSettings();

    mockApi.updateConfig.mockClear();
    mockApi.getBranches.mockClear();
    mockApi.getVoltageLevels.mockClear();

    const applyBtn = screen.getByText('Apply');
    await act(async () => {
      await userEvent.click(applyBtn);
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalled();
    });

    // Verification of auto-close
    await waitFor(() => {
      expect(screen.queryByText('Apply')).not.toBeInTheDocument();
    });

    // Verification of study data fetching
    await waitFor(() => {
      expect(mockApi.getBranches).toHaveBeenCalled();
      expect(mockApi.getVoltageLevels).toHaveBeenCalled();
      expect(mockApi.getNominalVoltages).toHaveBeenCalled();
      expect(mockApi.getNetworkDiagram).toHaveBeenCalled();
    });
  });

  it('updates configuration with new network and layout paths', async () => {
    await openSettings();

    const networkInput = screen.getByLabelText(/Network File Path/i);
    const layoutInput = screen.getByLabelText(/Layout File Path/i);

    await userEvent.clear(networkInput);
    await userEvent.type(networkInput, '/path/to/network.xiidm');
    await userEvent.clear(layoutInput);
    await userEvent.type(layoutInput, '/path/to/layout.json');

    mockApi.updateConfig.mockResolvedValue({
      monitored_lines_count: 5,
      total_lines_count: 5
    });

    const applyBtn = screen.getByText('Apply');
    await act(async () => {
      await userEvent.click(applyBtn);
    });

    await waitFor(() => {
      expect(mockApi.updateConfig).toHaveBeenCalledWith(expect.objectContaining({
        network_path: '/path/to/network.xiidm',
        layout_path: '/path/to/layout.json'
      }));
    });
  });

  it('shows path warning when no network is loaded and allows dismissal', async () => {
    // Initial render should show the warning since no diagram is loaded
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Configuration Paths/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Layout Path:/i)).toBeInTheDocument();
    expect(screen.getByText(/Output Folder:/i)).toBeInTheDocument();

    // Dismiss the warning
    const closeBtn = screen.getByText('✕');
    await userEvent.click(closeBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Configuration Paths/i)).not.toBeInTheDocument();
    });
  });

  it('hides path warning when a network diagram is loaded', async () => {
    render(<App />);

    // Warning should be present initially
    await waitFor(() => {
      expect(screen.getByText(/Configuration Paths/i)).toBeInTheDocument();
    });

    // Simulate loading a study which will set nDiagram
    const settingsBtn = screen.getByTitle('Settings');
    await userEvent.click(settingsBtn);

    const applyBtn = screen.getByText('Apply');
    await userEvent.click(applyBtn);

    // After apply, the warning should disappear because a diagram (nDiagram) will be "loaded" 
    // (mocked in our tests)
    await waitFor(() => {
      expect(screen.queryByText(/Configuration Paths/i)).not.toBeInTheDocument();
    });
  });

  it('opens settings on Paths tab when "Change in settings" is clicked in warning banner', async () => {
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Configuration Paths/i)).toBeInTheDocument();
    });

    const changeLink = screen.getByText(/Change in settings/i);
    await userEvent.click(changeLink);

    // Should open settings modal
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    // Should be on Paths tab (default for settings modal anyway, but let's be sure)
    expect(screen.getByLabelText(/Network File Path/i)).toBeInTheDocument();
  });

  it('correctly derives and displays output folder from network path in warning banner', async () => {
    // We need to render App with a specific network path
    // But networkPath is state initialized from localStorage or empty
    // Let's just check the existing banner in the initial render if we can mock the initial state
    // Or just check if the warning banner (which we already test) shows the derived path

    // In our tests, we can clear localStorage and then render
    localStorage.setItem('networkPath', '/home/user/data/grid.xiidm');
    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Configuration Paths/i)).toBeInTheDocument();
    });

    // The output folder should be /home/user/data
    expect(screen.getByText(/Output Folder:/i)).toHaveTextContent('/home/user/data');
  });

  it('displays correct icons and placeholders in settings modal', async () => {
    await openSettings();

    const networkInput = screen.getByLabelText(/Network File Path/i);
    expect(networkInput).toHaveAttribute('placeholder', 'load your grid xiidm file path');

    // Check icons (they are emojis in buttons)
    // Network button icon
    const networkBtn = networkInput.parentElement?.querySelector('button');
    expect(networkBtn?.textContent).toBe('📄');

    // Layout button icon
    const layoutInput = screen.getByLabelText(/Layout File Path/i);
    const layoutBtn = layoutInput.parentElement?.querySelector('button');
    expect(layoutBtn?.textContent).toBe('📄');

    // Action button icon (was already 📄 but good to check)
    const actionInput = screen.getByLabelText(/Action Dictionary File Path/i);
    const actionBtn = actionInput.parentElement?.querySelector('button');
    expect(actionBtn?.textContent).toBe('📄');

    // Output folder icon (should be 📂)
    const outputInput = screen.getByPlaceholderText('e.g. /home/user/sessions');
    const outputBtn = outputInput.parentElement?.querySelector('button');
    expect(outputBtn?.textContent).toBe('📂');
  });

  it('displays file icon for network path in main banner', async () => {
    render(<App />);
    // In main banner (header)
    const labels = screen.getAllByText(/Network Path/i);
    // Find the one in the header
    const headerBannerLabel = labels.find(l => {
      const parent = l.parentElement;
      return parent && parent.style.flex.startsWith('1 1 200px');
    });
    const bannerBtn = headerBannerLabel?.parentElement?.querySelector('button');
    expect(bannerBtn?.textContent).toBe('📄');

    const bannerInput = headerBannerLabel?.parentElement?.querySelector('input');
    expect(bannerInput).toHaveAttribute('placeholder', 'load your grid xiidm file path');
  });

  describe('Processing State UI', () => {
    it('shows yellow "Running..." button during analysis', async () => {
      render(<App />);
      await loadStudy(); // Custom helper or inline:

      // Select branch
      const branchInput = screen.getByPlaceholderText('Search line/bus...');
      await userEvent.type(branchInput, 'BRANCH_A');
      await waitFor(() => expect(mockApi.getN1Diagram).toHaveBeenCalledWith('BRANCH_A'));

      // Setup streaming mock for step2 (keep stream open to simulate "Running" state)
      const mockStream = new ReadableStream({
        start() {
          // Keep it open to simulate "Running" state
        },
      });
      mockApi.runAnalysisStep2Stream.mockResolvedValue({
        ok: true,
        body: mockStream,
      });

      const runBtn = screen.getByText('🚀 Run Analysis');
      await userEvent.click(runBtn);

      // Button should change to "⚙️ Running..." and turn yellow
      const runningBtn = await screen.findByText('⚙️ Running...');
      expect(runningBtn).toBeInTheDocument();
      expect(runningBtn.style.background).toBe('rgb(241, 196, 15)'); // #f1c40f
      expect(runningBtn.style.color).toBe('rgb(133, 100, 4)'); // #856404
    });
  });
});

describe('Overload Clearing Logic', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    Object.values(mockApi).forEach(m => {
      if (vi.isMockFunction(m)) m.mockReset();
    });
    // Restore defaults after reset
    mockApi.updateConfig.mockResolvedValue({ monitored_lines_count: 10, total_lines_count: 10 });
    mockApi.getBranches.mockResolvedValue(['BRANCH_A', 'BRANCH_B', 'BRANCH_C']);
    mockApi.getVoltageLevels.mockResolvedValue(['VL1', 'VL2']);
    mockApi.getNominalVoltages.mockResolvedValue({ mapping: {}, unique_kv: [63, 225] });
    mockApi.getNetworkDiagram.mockResolvedValue({ svg: '<svg></svg>', metadata: null });
    mockApi.getN1Diagram.mockResolvedValue({ svg: '<svg></svg>', metadata: null, lines_overloaded: [] });
    mockApi.runAnalysisStep1.mockResolvedValue({ can_proceed: true, lines_overloaded: ['LINE_OL1'] });
    mockApi.getActionVariantDiagram.mockResolvedValue({ svg: '<svg></svg>', metadata: null });

    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it('clears overloads from UI components immediately upon contingency change confirmation', async () => {
    await renderAndLoadStudy();

    // 1. Select BRANCH_A with overloads
    mockApi.getN1Diagram.mockResolvedValueOnce({
      svg: '<svg></svg>',
      lines_overloaded: ['OL_1', 'OL_2']
    });
    const input = screen.getByPlaceholderText('Search line/bus...');
    fireEvent.change(input, { target: { value: 'BRANCH_A' } });

    await waitFor(() => {
      expect(screen.getByTestId('overload-panel')).toHaveAttribute('data-n1-ol-count', '2');
    }, { timeout: 3000 });

    expect(screen.getByTestId('overload-panel')).toHaveAttribute('data-sel-ol-count', '2');

    // Run analysis to create state
    await runAnalysis();

    // 2. Select BRANCH_B (triggers confirmation dialog)
    await userEvent.clear(input);
    await userEvent.type(input, 'BRANCH_B');

    await waitFor(() => {
      expect(screen.getByText('Change Contingency?')).toBeInTheDocument();
    }, { timeout: 3000 });

    // 3. Confirm change
    fireEvent.click(screen.getByText('Confirm'));

    // 4. VERIFY IMMEDIATE CLEAR
    await waitFor(() => {
      expect(screen.getByTestId('overload-panel')).toHaveAttribute('data-n1-ol-count', '0');
      expect(screen.getByTestId('overload-panel')).toHaveAttribute('data-sel-ol-count', '0');
    });
  });

  it('clears ActionFeed overloads immediately when starting a new analysis', async () => {
    await renderAndLoadStudy();

    // Ensure analysis finds overloads
    mockApi.runAnalysisStep1.mockResolvedValue({ can_proceed: true, lines_overloaded: ['OL_1'] });

    await selectBranch('BRANCH_A');
    await runAnalysis();

    // Verify initial overloads in feed
    await waitFor(() => {
      expect(screen.getByTestId('action-feed')).toHaveAttribute('data-ol-count', '1');
    }, { timeout: 3000 });

    // Start new analysis. Slow it down to catch the 0 state.
    let resolveStep1: (val: { can_proceed: boolean; lines_overloaded: string[] }) => void;
    const slowStep1 = new Promise<{ can_proceed: boolean; lines_overloaded: string[] }>(resolve => { resolveStep1 = resolve; });
    mockApi.runAnalysisStep1.mockReturnValue(slowStep1);

    await userEvent.click(screen.getByText('🚀 Run Analysis'));

    // VERIFY IMMEDIATE CLEAR in ActionFeed
    await waitFor(() => {
      expect(screen.getByTestId('action-feed')).toHaveAttribute('data-ol-count', '0');
    }, { timeout: 3000 });

    // Cleanup
    resolveStep1!({ can_proceed: true, lines_overloaded: [] });
  });
});

async function loadStudy() {
  const loadBtn = screen.getByText('🔄 Load Study');
  await userEvent.click(loadBtn);
  await waitFor(() => {
    expect(screen.getByPlaceholderText('Search line/bus...')).toBeInTheDocument();
  });
}
