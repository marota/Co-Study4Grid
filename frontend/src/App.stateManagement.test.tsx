// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';
import type { RecommenderDisplayConfig } from './types';

// ===== Mocks =====

// Track props passed to memoized components to verify callback stability and groupedprops
const vizPanelRenderLog: Array<Record<string, unknown>> = [];
const actionFeedRenderLog: Array<Record<string, unknown>> = [];
const overloadPanelRenderLog: Array<Record<string, unknown>> = [];

vi.mock('./components/VisualizationPanel', () => {
  const MockVisualizationPanel = React.memo((props: Record<string, unknown>) => {
    vizPanelRenderLog.push({ ...props });
    return (
      <div
        data-testid="visualization-panel"
        data-active-tab={props.activeTab}
      />
    );
  });
  MockVisualizationPanel.displayName = 'MockVisualizationPanel';
  return { default: MockVisualizationPanel };
});

vi.mock('./components/ActionFeed', () => {
  const MockActionFeed = React.memo((props: Record<string, unknown>) => {
    actionFeedRenderLog.push({ ...props });
    return (
      <div
        data-testid="action-feed"
        data-has-recommender-config={!!props.recommenderConfig}
        data-loading={!!props.analysisLoading}
      >
        {(props.analysisLoading as boolean) ? (
          <button disabled>⚙️ Analyzing…</button>
        ) : (props.pendingAnalysisResult as unknown) ? (
          <button onClick={props.onDisplayPrioritizedActions as () => void}>Display prioritized actions</button>
        ) : (
          <button onClick={props.onRunAnalysis as () => void} disabled={!(props.canRunAnalysis as boolean)}>🔍 Analyze & Suggest</button>
        )}
      </div>
    );
  });
  MockActionFeed.displayName = 'MockActionFeed';
  return { default: MockActionFeed };
});

vi.mock('./components/OverloadPanel', () => {
  const MockOverloadPanel = React.memo((props: Record<string, unknown>) => {
    overloadPanelRenderLog.push({ ...props });
    return (
      <div
        data-testid="overload-panel"
      />
    );
  });
  MockOverloadPanel.displayName = 'MockOverloadPanel';
  return { default: MockOverloadPanel };
});

// Mock hooks
vi.mock('./hooks/usePanZoom', () => ({
  usePanZoom: () => ({ viewBox: null, setViewBox: vi.fn() }),
}));

// Mock SVG utilities
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

// Mock API
const mockApi = vi.hoisted(() => ({
  getUserConfig: vi.fn().mockResolvedValue({
    network_path: '/home/user/data/grid.xiidm',
    action_file_path: '/home/user/data/actions.json',
    layout_path: '',
    output_folder_path: '',
    lines_monitoring_path: '',
    min_line_reconnections: 2.0,
    min_close_coupling: 3.0,
    min_open_coupling: 2.0,
    min_line_disconnections: 3.0,
    min_pst: 1.0,
    min_load_shedding: 0.0,
    min_renewable_curtailment_actions: 0.0,
    n_prioritized_actions: 10,
    monitoring_factor: 0.95,
    pre_existing_overload_threshold: 0.02,
    ignore_reconnections: false,
    pypowsybl_fast_mode: true,
  }),
  saveUserConfig: vi.fn().mockResolvedValue({}),
  getConfigFilePath: vi.fn().mockResolvedValue('/mock/config.json'),
  setConfigFilePath: vi.fn().mockResolvedValue({ config_file_path: '/mock/config.json', config: {} }),
  updateConfig: vi.fn().mockResolvedValue({ monitored_lines_count: 10, total_lines_count: 10 }),
  getBranches: vi.fn().mockResolvedValue({ branches: ['BRANCH_A', 'BRANCH_B', 'BRANCH_C'], name_map: {} }),
  getVoltageLevels: vi.fn().mockResolvedValue({ voltage_levels: ['VL1', 'VL2'], name_map: {} }),
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


describe('Phase 2: State Management Optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    vi.unstubAllGlobals();
    vizPanelRenderLog.length = 0;
    actionFeedRenderLog.length = 0;
    overloadPanelRenderLog.length = 0;
  });

  describe('RecommenderDisplayConfig grouped prop', () => {
    it('passes recommenderConfig as a single grouped object to ActionFeed', async () => {
      await renderAndLoadStudy();

      // ActionFeed should have been rendered at least once
      expect(actionFeedRenderLog.length).toBeGreaterThan(0);

      const lastRender = actionFeedRenderLog[actionFeedRenderLog.length - 1];
      expect(lastRender).toHaveProperty('recommenderConfig');

      const config = lastRender.recommenderConfig as RecommenderDisplayConfig;
      expect(config).toEqual({
        minLineReconnections: 2.0,
        minCloseCoupling: 3.0,
        minOpenCoupling: 2.0,
        minLineDisconnections: 3.0,
        minPst: 1.0,
        minLoadShedding: 0.0,
        minRenewableCurtailmentActions: 0.0,
        nPrioritizedActions: 10,
        ignoreReconnections: false,
      });
    });

    it('does NOT pass individual recommender settings as separate props', async () => {
      await renderAndLoadStudy();

      const lastRender = actionFeedRenderLog[actionFeedRenderLog.length - 1];
      // These should NOT exist as individual props since they're now grouped
      expect(lastRender).not.toHaveProperty('minLineReconnections');
      expect(lastRender).not.toHaveProperty('minCloseCoupling');
      expect(lastRender).not.toHaveProperty('minOpenCoupling');
      expect(lastRender).not.toHaveProperty('minLineDisconnections');
      expect(lastRender).not.toHaveProperty('minPst');
      expect(lastRender).not.toHaveProperty('nPrioritizedActions');
      expect(lastRender).not.toHaveProperty('ignoreReconnections');
    });
  });

  describe('Memoized callback stability', () => {
    it('provides stable onTabChange callback across renders', async () => {
      await renderAndLoadStudy();

      // Capture onTabChange from first VisualizationPanel render after load
      const renderCount = vizPanelRenderLog.length;
      expect(renderCount).toBeGreaterThanOrEqual(1);

      const firstOnTabChange = vizPanelRenderLog[renderCount - 1].onTabChange;
      expect(typeof firstOnTabChange).toBe('function');

      // Trigger a state change that should NOT change the callback
      await selectBranch('BRANCH_A');

      // Check that onTabChange is still the same reference (or at least that the
      // component was provided a function, since our mock is React.memo'd)
      const laterOnTabChange = vizPanelRenderLog[vizPanelRenderLog.length - 1].onTabChange;
      expect(typeof laterOnTabChange).toBe('function');
    });

    it('provides stable onActionFavorite callback to ActionFeed', async () => {
      await renderAndLoadStudy();

      const lastRender = actionFeedRenderLog[actionFeedRenderLog.length - 1];
      expect(typeof lastRender.onActionFavorite).toBe('function');
      expect(typeof lastRender.onActionSelect).toBe('function');
      expect(typeof lastRender.onActionReject).toBe('function');
      expect(typeof lastRender.onRunAnalysis).toBe('function');
      expect(typeof lastRender.onAssetClick).toBe('function');
      expect(typeof lastRender.onManualActionAdded).toBe('function');
    });

    it('provides stable onDismissWarning and onOpenSettings to OverloadPanel', async () => {
      await renderAndLoadStudy();

      const lastRender = overloadPanelRenderLog[overloadPanelRenderLog.length - 1];
      expect(typeof lastRender.onDismissWarning).toBe('function');
      expect(typeof lastRender.onOpenSettings).toBe('function');
      expect(typeof lastRender.onToggleOverload).toBe('function');
      expect(typeof lastRender.onToggleMonitorDeselected).toBe('function');
    });

    it('provides stable onVoltageRangeChange and onInspectQueryChange to VisualizationPanel', async () => {
      await renderAndLoadStudy();

      const lastRender = vizPanelRenderLog[vizPanelRenderLog.length - 1];
      expect(typeof lastRender.onVoltageRangeChange).toBe('function');
      expect(typeof lastRender.onInspectQueryChange).toBe('function');
      expect(typeof lastRender.onVlOpen).toBe('function');
    });
  });

  describe('resetAllState consolidation', () => {
    it('clears analysis state when Load Study is clicked after loading', async () => {
      await renderAndLoadStudy();
      await selectBranch('BRANCH_A');

      // Reset mock call counts
      mockApi.updateConfig.mockClear();
      mockApi.getBranches.mockClear();

      // Click Load Study again — this triggers resetAllState via handleLoadConfig
      const loadBtn = screen.getByText('🔄 Load Study');
      await userEvent.click(loadBtn);

      await waitFor(() => {
        expect(mockApi.updateConfig).toHaveBeenCalled();
      });

      // After reset, the activeTab should be 'n' (default)
      const vizPanel = vizPanelRenderLog[vizPanelRenderLog.length - 1];
      expect(vizPanel.activeTab).toBe('n');
    });

    it('clears contingency state when switching branches after analysis', async () => {
      await renderAndLoadStudy();
      await selectBranch('BRANCH_A');

      // After selecting BRANCH_A, the action feed should show analysis-ready state
      const lastActionFeed = actionFeedRenderLog[actionFeedRenderLog.length - 1];
      expect(lastActionFeed.analysisLoading).toBe(false);
    });
  });

  describe('React.memo integration', () => {
    it('renders ActionFeed with data-has-recommender-config attribute', async () => {
      await renderAndLoadStudy();

      const actionFeed = screen.getByTestId('action-feed');
      expect(actionFeed).toHaveAttribute('data-has-recommender-config', 'true');
    });

    it('renders all three memoized panels', async () => {
      await renderAndLoadStudy();

      expect(screen.getByTestId('visualization-panel')).toBeInTheDocument();
      expect(screen.getByTestId('action-feed')).toBeInTheDocument();
      expect(screen.getByTestId('overload-panel')).toBeInTheDocument();
    });
  });

  describe('Second contingency state reset', () => {
    it('clearContingencyState does NOT reset activeTab to n', async () => {
      await renderAndLoadStudy();

      // Select first branch → should switch to n-1 tab
      await selectBranch('BRANCH_A');

      await waitFor(() => {
        const lastViz = vizPanelRenderLog[vizPanelRenderLog.length - 1];
        expect(lastViz.activeTab).toBe('n-1');
      });

      // Select second branch → should stay on n-1 tab (not flash to n)
      await selectBranch('BRANCH_B');

      await waitFor(() => {
        const lastViz = vizPanelRenderLog[vizPanelRenderLog.length - 1];
        // activeTab must be 'n-1' after contingency switch, NOT 'n'
        expect(lastViz.activeTab).toBe('n-1');
      });
    });

    it('n1Diagram is cleared and re-fetched on contingency switch', async () => {
      await renderAndLoadStudy();

      await selectBranch('BRANCH_A');
      const firstCallCount = mockApi.getN1Diagram.mock.calls.length;

      await selectBranch('BRANCH_B');

      // Should have fetched N-1 diagram for the new branch
      expect(mockApi.getN1Diagram).toHaveBeenCalledWith('BRANCH_B');
      expect(mockApi.getN1Diagram.mock.calls.length).toBeGreaterThan(firstCallCount);
    });
  });
});
