import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import App from './App';

// Reuse the basic mocks
vi.mock('./components/VisualizationPanel', () => ({
  default: () => <div data-testid="visualization-panel"></div>
}));
vi.mock('./components/ActionFeed', () => ({ default: () => <div /> }));
vi.mock('./components/OverloadPanel', () => ({ default: () => <div /> }));
vi.mock('./hooks/usePanZoom', () => ({ usePanZoom: () => ({ viewBox: null, setViewBox: vi.fn() }) }));

const mockApi = vi.hoisted(() => ({
  updateConfig: vi.fn().mockResolvedValue({ monitored_lines_count: 10, total_lines_count: 10 }),
  getBranches: vi.fn().mockResolvedValue({ branches: [], name_map: {} }),
  getVoltageLevels: vi.fn().mockResolvedValue({ voltage_levels: ['VL1'], name_map: {} }),
  getNominalVoltages: vi.fn().mockResolvedValue({ mapping: {}, unique_kv: [63, 225] }),
  getNetworkDiagram: vi.fn().mockResolvedValue({ svg: '<svg></svg>', metadata: null }),
  getUserConfig: vi.fn().mockResolvedValue({ network_path: '/path', action_file_path: '/path' }),
  getConfigFilePath: vi.fn().mockResolvedValue('/config'),
  saveUserConfig: vi.fn().mockResolvedValue({}),
}));

vi.mock('./api', () => ({ api: mockApi }));

describe('Datalist performance clamping', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    cleanup();
  });

  it('clamps contingency datalist options to exactly 50 items', async () => {
    const largeBranches = Array.from({ length: 150 }, (_, i) => `BRANCH_${i}`);
    mockApi.getBranches.mockResolvedValue({ branches: largeBranches, name_map: {} });

    render(<App />);
    const loadBtn = screen.getByText('🔄 Load Study');
    await act(async () => { await userEvent.click(loadBtn); });

    await waitFor(() => {
      expect(screen.getByText('🎯 Select Contingency')).toBeInTheDocument();
    }, { timeout: 5000 });

    const datalist = document.querySelector('#contingencies');
    expect(datalist).not.toBeNull();
    // Because it's clamped to max 50 items to prevent Chromium lockup
    expect(datalist!.children.length).toBe(50);
  });
});
