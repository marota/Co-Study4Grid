import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';

// ===== Mocks =====

// Mock child components to avoid their complexity
vi.mock('./components/VisualizationPanel', () => {
  interface MockProps {
    nDiagram: Record<string, unknown> | null;
    n1Diagram: Record<string, unknown> | null;
    configLoading: boolean;
    layoutPath: string;
    networkPath: string;
    onOpenSettings: (tab: string) => void;
  }
  const MockVisualizationPanel = (props: MockProps) => {
    const { nDiagram, n1Diagram, configLoading, layoutPath, networkPath, onOpenSettings } = props;
    const [warningDismissed, setWarningDismissed] = React.useState(false);
    const hasAnyDiagram = !!nDiagram?.svg || !!n1Diagram?.svg;
    const showPathWarning = !warningDismissed && !hasAnyDiagram;

    return (
      <div
        data-testid="visualization-panel"
        data-n1-diagram-present={!!n1Diagram}
      >
        {!hasAnyDiagram && !configLoading && showPathWarning && (
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
  isCouplingAction: vi.fn(() => false),
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

afterEach(() => {
  cleanup();
});

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
