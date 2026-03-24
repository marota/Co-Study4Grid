import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent, cleanup, within } from '@testing-library/react';
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
      <div>
        <h3 data-testid="action-feed-header">Simulated Actions</h3>
      </div>
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

    // Now switch to BRANCH_B — should trigger dialog
    const input = screen.getByPlaceholderText('Search line/bus...');
    await userEvent.clear(input);
    await userEvent.type(input, 'BRANCH_B');

    await waitFor(() => {
      expect(screen.getByText('Change Contingency?')).toBeInTheDocument();
    }, { timeout: 3000 });
  });

  it('proceeds with contingency change after confirmation', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    const input = screen.getByPlaceholderText('Search line/bus...');
    await userEvent.clear(input);
    await userEvent.type(input, 'BRANCH_B');

    await screen.findByText('Change Contingency?');
    const confirmBtn = screen.getByText('Confirm');
    await userEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi.getN1Diagram).toHaveBeenCalledWith('BRANCH_B');
    });
    expect(screen.queryByText('Change Contingency?')).not.toBeInTheDocument();
  });

  it('cancels contingency change on dismissal', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    const input = screen.getByPlaceholderText('Search line/bus...');
    await userEvent.clear(input);
    await userEvent.type(input, 'BRANCH_B');

    await screen.findByText('Change Contingency?');
    const cancelBtn = screen.getByText('Cancel');
    await userEvent.click(cancelBtn);

    // Should NOT have called N-1 for BRANCH_B
    expect(mockApi.getN1Diagram).not.toHaveBeenCalledWith('BRANCH_B');
    // Input should revert to BRANCH_A
    expect(input).toHaveValue('BRANCH_A');
  });

  it('does not trigger dialog for partial/invalid branch text', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');
    await runAnalysis();

    const input = screen.getByPlaceholderText('Search line/bus...');
    // Type something that doesn't match a full branch
    await userEvent.clear(input);
    await userEvent.type(input, 'INVALID_NAME');

    // No dialog should appear for invalid/partial names (assuming selection only happens on full match in selectBranch-like logic)
    // Actually, App.tsx handles the branch change. 
    // If the input value doesn't match an existing branch in the list, the useEffect might not trigger.
    expect(screen.queryByText('Change Contingency?')).not.toBeInTheDocument();
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
      expect(screen.getByTestId('overload-panel')).toHaveAttribute('data-sel-ol-count', '2');
    }, { timeout: 3000 });

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
    mockApi.runAnalysisStep1.mockReturnValue(slowStep1 as Promise<{ can_proceed: boolean; lines_overloaded: string[] }>);

    await userEvent.click(screen.getByText('🚀 Run Analysis'));

    // VERIFY IMMEDIATE CLEAR in ActionFeed
    await waitFor(() => {
      expect(screen.getByTestId('action-feed')).toHaveAttribute('data-ol-count', '0');
    }, { timeout: 3000 });

    // Cleanup
    resolveStep1!({ can_proceed: true, lines_overloaded: [] });
  });

  it('preserves N-1 diagram in VisualizationPanel when running analysis (regression test)', async () => {
    await renderAndLoadStudy();
    await selectBranch('BRANCH_A');

    // Initially, N-1 diagram should be present
    await waitFor(() => {
      expect(screen.getByTestId('visualization-panel')).toHaveAttribute('data-n1-diagram-present', 'true');
    });

    // Run analysis (which used to trigger clearContingencyState and wipe the diagram)
    await runAnalysis();

    // VERIFY: N-1 diagram is STILL present in the panel
    expect(screen.getByTestId('visualization-panel')).toHaveAttribute('data-n1-diagram-present', 'true');
  });
  it('verifies sidebar has unified scrollbar and no nested overflows', async () => {
    await renderAndLoadStudy();

    // The main sidebar container has the data-testid="sidebar"
    const sidebar = await screen.findByTestId('sidebar');
    expect(sidebar).toBeInTheDocument();
    expect(sidebar).toHaveStyle({ overflowY: 'auto' });

    // Find the ActionFeed header within the sidebar
    const sidebarActionsHeader = await within(sidebar).findByTestId('action-feed-header');
    
    // ActionFeed wrapper should NOT have overflowY: auto
    const actionFeedWrapper = sidebarActionsHeader.closest('div[style*="flex-shrink: 0"]');
    expect(actionFeedWrapper).toBeInTheDocument();
    expect(actionFeedWrapper).not.toHaveStyle({ overflowY: 'auto' });

    // Internal ActionFeed root is the sibling of the header's container
    const actionFeedRoot = sidebarActionsHeader.parentElement?.parentElement;
    expect(actionFeedRoot).toBeInTheDocument();
    expect(actionFeedRoot).not.toHaveStyle({ overflowY: 'auto' });
  });
});
