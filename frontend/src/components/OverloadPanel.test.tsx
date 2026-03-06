import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OverloadPanel from './OverloadPanel';

describe('OverloadPanel', () => {
    const defaultProps = {
        nOverloads: [] as string[],
        n1Overloads: [] as string[],
        onAssetClick: vi.fn(),
    };

    it('renders the Overloads heading', () => {
        render(<OverloadPanel {...defaultProps} />);
        expect(screen.getByText('Overloads')).toBeInTheDocument();
    });

    it('shows "None" when no overloads', () => {
        render(<OverloadPanel {...defaultProps} />);
        const noneElements = screen.getAllByText('None');
        expect(noneElements).toHaveLength(2);
    });

    it('renders N overload links', () => {
        render(
            <OverloadPanel
                {...defaultProps}
                nOverloads={['LINE_A', 'LINE_B']}
            />
        );
        expect(screen.getByText('LINE_A')).toBeInTheDocument();
        expect(screen.getByText('LINE_B')).toBeInTheDocument();
    });

    it('renders N-1 overload links', () => {
        render(
            <OverloadPanel
                {...defaultProps}
                n1Overloads={['TRAFO_1']}
            />
        );
        expect(screen.getByText('TRAFO_1')).toBeInTheDocument();
    });

    it('calls onAssetClick with correct tab for N overloads', async () => {
        const user = userEvent.setup();
        const onAssetClick = vi.fn();
        render(
            <OverloadPanel
                {...defaultProps}
                nOverloads={['LINE_A']}
                onAssetClick={onAssetClick}
            />
        );

        await user.click(screen.getByText('LINE_A'));
        expect(onAssetClick).toHaveBeenCalledWith('', 'LINE_A', 'n');
    });

    it('calls onAssetClick with correct tab for N-1 overloads', async () => {
        const user = userEvent.setup();
        const onAssetClick = vi.fn();
        render(
            <OverloadPanel
                {...defaultProps}
                n1Overloads={['LINE_B']}
                onAssetClick={onAssetClick}
            />
        );

        await user.click(screen.getByText('LINE_B'));
        expect(onAssetClick).toHaveBeenCalledWith('', 'LINE_B', 'n-1');
    });

    it('renders both N and N-1 overloads simultaneously', () => {
        render(
            <OverloadPanel
                {...defaultProps}
                nOverloads={['LINE_A']}
                n1Overloads={['LINE_B', 'LINE_C']}
            />
        );
        expect(screen.getByText('LINE_A')).toBeInTheDocument();
        expect(screen.getByText('LINE_B')).toBeInTheDocument();
        expect(screen.getByText('LINE_C')).toBeInTheDocument();
    });

    it('renders section labels', () => {
        render(<OverloadPanel {...defaultProps} />);
        expect(screen.getByText('N Overloads:')).toBeInTheDocument();
        expect(screen.getByText('N-1 Overloads:')).toBeInTheDocument();
    });

    describe('Monitoring Warning', () => {
        it('renders warning banner when showMonitoringWarning is true and totalLinesCount > 0', () => {
            render(
                <OverloadPanel
                    {...defaultProps}
                    showMonitoringWarning={true}
                    monitoredLinesCount={130}
                    totalLinesCount={150}
                    monitoringFactor={0.95}
                    preExistingOverloadThreshold={0.02}
                />
            );
            expect(screen.getByText(/lines monitored/i)).toBeInTheDocument();
            expect(screen.getByText('130')).toBeInTheDocument();
            expect(screen.getByText('150')).toBeInTheDocument();
            expect(screen.getByText(/20.*without permanent limits/i)).toBeInTheDocument();
        });

        it('does not render warning banner when showMonitoringWarning is false', () => {
            render(
                <OverloadPanel
                    {...defaultProps}
                    showMonitoringWarning={false}
                    monitoredLinesCount={130}
                    totalLinesCount={150}
                />
            );
            expect(screen.queryByText(/out of/i)).not.toBeInTheDocument();
        });

        it('does not render warning banner when totalLinesCount is 0', () => {
            render(
                <OverloadPanel
                    {...defaultProps}
                    showMonitoringWarning={true}
                    monitoredLinesCount={0}
                    totalLinesCount={0}
                />
            );
            expect(screen.queryByText(/out of/i)).not.toBeInTheDocument();
        });

        it('calls onOpenSettings when "Change in settings" is clicked', async () => {
            const user = userEvent.setup();
            const onOpenSettings = vi.fn();
            render(
                <OverloadPanel
                    {...defaultProps}
                    showMonitoringWarning={true}
                    totalLinesCount={10}
                    onOpenSettings={onOpenSettings}
                />
            );
            
            await user.click(screen.getByText('Change in settings'));
            expect(onOpenSettings).toHaveBeenCalled();
        });

        it('calls onDismissWarning when dismiss button is clicked', async () => {
            const user = userEvent.setup();
            const onDismissWarning = vi.fn();
            render(
                <OverloadPanel
                    {...defaultProps}
                    showMonitoringWarning={true}
                    totalLinesCount={10}
                    onDismissWarning={onDismissWarning}
                />
            );
            
            await user.click(screen.getByTitle('Dismiss'));
            expect(onDismissWarning).toHaveBeenCalled();
        });
    });
});
