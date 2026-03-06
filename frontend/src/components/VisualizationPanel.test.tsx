import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import VisualizationPanel from './VisualizationPanel';
import type { DiagramData, AnalysisResult, TabId } from '../types';

const createDefaultProps = (overrides: Record<string, unknown> = {}) => ({
    activeTab: 'n' as TabId,
    configLoading: false,
    onTabChange: vi.fn(),
    nDiagram: null as DiagramData | null,
    n1Diagram: null as DiagramData | null,
    n1Loading: false,
    actionDiagram: null as DiagramData | null,
    actionDiagramLoading: false,
    selectedActionId: null as string | null,
    result: null as AnalysisResult | null,
    analysisLoading: false,
    nSvgContainerRef: createRef<HTMLDivElement>(),
    n1SvgContainerRef: createRef<HTMLDivElement>(),
    actionSvgContainerRef: createRef<HTMLDivElement>(),
    uniqueVoltages: [] as number[],
    voltageRange: [0, 1000] as [number, number],
    onVoltageRangeChange: vi.fn(),
    actionViewMode: 'network' as 'network' | 'delta',
    onViewModeChange: vi.fn(),
    inspectQuery: '',
    onInspectQueryChange: vi.fn(),
    inspectableItems: [] as string[],
    onResetView: vi.fn(),
    onZoomIn: vi.fn(),
    onZoomOut: vi.fn(),
    hasBranches: false,
    selectedBranch: '',
    vlOverlay: null,
    onOverlayClose: vi.fn(),
    onOverlaySldTabChange: vi.fn(),
    ...overrides,
});

describe('VisualizationPanel', () => {
    it('renders the Network (N) tab', () => {
        render(<VisualizationPanel {...createDefaultProps()} />);
        expect(screen.getByText('Network (N)')).toBeInTheDocument();
    });

    it('does not render N-1 tab when no branch selected', () => {
        render(<VisualizationPanel {...createDefaultProps()} />);
        expect(screen.queryByText('Contingency (N-1)')).not.toBeInTheDocument();
    });

    it('renders N-1 tab when branch is selected', () => {
        render(<VisualizationPanel {...createDefaultProps({ selectedBranch: 'LINE_A' })} />);
        expect(screen.getByText('Contingency (N-1)')).toBeInTheDocument();
    });

    it('renders action tab when action is selected', () => {
        render(<VisualizationPanel {...createDefaultProps({ selectedActionId: 'action_1' })} />);
        expect(screen.getByText('Action: action_1')).toBeInTheDocument();
    });

    it('renders overflow tab when PDF URL is available', () => {
        const result: AnalysisResult = {
            pdf_path: '/tmp/graph.pdf',
            pdf_url: '/results/pdf/graph.pdf',
            actions: {},
            lines_overloaded: [],
            message: 'Done',
            dc_fallback: false,
        };
        render(<VisualizationPanel {...createDefaultProps({ result })} />);
        expect(screen.getByText('Overflow Analysis')).toBeInTheDocument();
    });

    it('calls onTabChange when N-1 tab is clicked', async () => {
        const user = userEvent.setup();
        const onTabChange = vi.fn();
        render(<VisualizationPanel {...createDefaultProps({ selectedBranch: 'LINE_A', onTabChange })} />);

        await user.click(screen.getByText('Contingency (N-1)'));
        expect(onTabChange).toHaveBeenCalledWith('n-1');
    });

    it('shows placeholder when no diagram loaded', () => {
        render(<VisualizationPanel {...createDefaultProps()} />);
        expect(screen.getByText('Load configuration to see diagram')).toBeInTheDocument();
    });

    it('shows N-1 loading message', () => {
        render(<VisualizationPanel {...createDefaultProps({
            activeTab: 'n-1',
            selectedBranch: 'LINE_A',
            n1Loading: true,
        })} />);
        expect(screen.getByText('Generating N-1 Diagram...')).toBeInTheDocument();
    });

    it('shows action loading message', () => {
        render(<VisualizationPanel {...createDefaultProps({
            activeTab: 'action',
            selectedActionId: 'act_1',
            actionDiagramLoading: true,
        })} />);
        expect(screen.getByText('Generating Action Variant Diagram...')).toBeInTheDocument();
    });

    it('renders zoom controls when not on overflow tab', () => {
        render(<VisualizationPanel {...createDefaultProps()} />);
        expect(screen.getByTitle('Zoom In')).toBeInTheDocument();
        expect(screen.getByTitle('Zoom Out')).toBeInTheDocument();
    });

    it('calls zoom handlers', async () => {
        const user = userEvent.setup();
        const onZoomIn = vi.fn();
        const onZoomOut = vi.fn();
        const onResetView = vi.fn();
        render(<VisualizationPanel {...createDefaultProps({ onZoomIn, onZoomOut, onResetView })} />);

        await user.click(screen.getByTitle('Zoom In'));
        expect(onZoomIn).toHaveBeenCalled();

        await user.click(screen.getByTitle('Zoom Out'));
        expect(onZoomOut).toHaveBeenCalled();
    });

    it('shows view mode toggle when diagram is loaded', () => {
        const nDiagram: DiagramData = {
            svg: '<svg>test</svg>',
            metadata: null,
        };
        render(<VisualizationPanel {...createDefaultProps({ nDiagram })} />);
        expect(screen.getByText('Flows')).toBeInTheDocument();
        expect(screen.getByText('Impacts')).toBeInTheDocument();
    });

    it('calls onViewModeChange when toggle clicked', async () => {
        const user = userEvent.setup();
        const onViewModeChange = vi.fn();
        const nDiagram: DiagramData = {
            svg: '<svg>test</svg>',
            metadata: null,
        };
        render(<VisualizationPanel {...createDefaultProps({ nDiagram, onViewModeChange })} />);

        await user.click(screen.getByText('Impacts'));
        expect(onViewModeChange).toHaveBeenCalledWith('delta');
    });

    it('shows convergence warning for N-1 when AC did not converge', () => {
        const n1Diagram: DiagramData = {
            svg: '<svg>n1</svg>',
            metadata: null,
            lf_converged: false,
            lf_status: 'MAX_ITERATION_REACHED',
        };
        render(<VisualizationPanel {...createDefaultProps({
            activeTab: 'n-1',
            selectedBranch: 'LINE_A',
            n1Diagram,
        })} />);
        expect(screen.getByText(/MAX_ITERATION_REACHED/)).toBeInTheDocument();
    });

    it('renders inspect input when branches exist', () => {
        render(<VisualizationPanel {...createDefaultProps({ hasBranches: true })} />);
        expect(screen.getByPlaceholderText(/Inspect/)).toBeInTheDocument();
    });

    it('does not render inspect input when no branches', () => {
        render(<VisualizationPanel {...createDefaultProps({ hasBranches: false })} />);
        expect(screen.queryByPlaceholderText(/Inspect/)).not.toBeInTheDocument();
    });

    it('shows analysis loading text in overflow tab', () => {
        render(<VisualizationPanel {...createDefaultProps({
            activeTab: 'overflow',
            analysisLoading: true,
        })} />);
        expect(screen.getByText('Processing Analysis...')).toBeInTheDocument();
    });

    describe('SLD Overlay Delta Class Cleanup', () => {
        it('clears sld-delta-text-* classes from the rendered SVG', () => {
            const svgContent = '<svg><text id="test-text" class="sld-delta-text-positive some-other-class">100</text></svg>';
            const vlOverlay = {
                vlName: 'test-node',
                actionId: null,
                svg: svgContent,
                sldMetadata: null, // Bypasses applyDeltaVisuals, leaving only the cleanup effect
                loading: false,
                error: null,
                tab: 'n' as TabId,
            };

            const props = createDefaultProps({
                vlOverlay,
                actionViewMode: 'network', // Doesn't matter which mode, cleanup runs first always
                activeTab: 'n',
            });

            const { container } = render(<VisualizationPanel {...props} />);
            
            const textEl = container.querySelector('#test-text');
            expect(textEl).toBeInTheDocument();
            
            // The cleanup effect strips out sld-delta-text-* classes immediately on mount or update
            expect(textEl).not.toHaveClass('sld-delta-text-positive');
            // But it preserves unrelated classes
            expect(textEl).toHaveClass('some-other-class');
        });
    });
});
