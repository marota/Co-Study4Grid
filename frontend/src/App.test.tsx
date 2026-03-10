import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

// ===== Mocks =====

// Mock child components to avoid their complexity
vi.mock('./components/VisualizationPanel', () => ({
  default: () => <div data-testid="visualization-panel" />,
}));
vi.mock('./components/ActionFeed', () => ({
  default: () => <div data-testid="action-feed" />,
}));
vi.mock('./components/OverloadPanel', () => ({
  default: () => <div data-testid="overload-panel" />,
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
  await act(async () => {
    await userEvent.click(loadBtn);
  });

  // Wait for branches to be loaded (the datalist input appears)
  await waitFor(() => {
    expect(screen.getByPlaceholderText('Search line/bus...')).toBeInTheDocument();
  });
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
  // Mock fetch for step2 streaming response
  const mockResponse = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(
        JSON.stringify({ type: 'result', actions: { ACT1: { is_manual: false, rho_before: [1.02], rho_after: [0.95] } }, lines_overloaded: ['LINE_OL1'], message: 'done', dc_fallback: false }) + '\n'
      ));
      controller.close();
    },
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
    ok: true,
    body: mockResponse,
  }));

  const runBtn = screen.getByText('🚀 Run Analysis');
  await act(async () => {
    await userEvent.click(runBtn);
  });

  await waitFor(() => {
    expect(screen.queryByText('⚙️ Running...')).not.toBeInTheDocument();
  });
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
