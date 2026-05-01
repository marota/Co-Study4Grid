// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { Component, type ErrorInfo, type ReactNode } from 'react';
import { colors } from '../styles/tokens';

interface ErrorBoundaryProps {
    children: ReactNode;
    fallback?: ReactNode;
}

interface ErrorBoundaryState {
    hasError: boolean;
    error: Error | null;
    errorInfo: ErrorInfo | null;
}

/**
 * React Error Boundary that catches unhandled exceptions in the component
 * tree below it and renders a fallback UI instead of crashing the whole app
 * with a white screen.
 *
 * Usage: wrap the app root (or any subtree you want to isolate) in
 * <ErrorBoundary>...</ErrorBoundary>. Optionally pass a `fallback` prop to
 * override the default fallback UI.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = {
        hasError: false,
        error: null,
        errorInfo: null,
    };

    static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
        return { hasError: true, error };
    }

    componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
        // Log to console so developers can find the stack trace in the
        // browser devtools. In production this could also ship to a
        // telemetry backend.
        console.error('ErrorBoundary caught an error:', error, errorInfo);
        this.setState({ errorInfo });
    }

    handleReset = (): void => {
        this.setState({ hasError: false, error: null, errorInfo: null });
    };

    handleReload = (): void => {
        window.location.reload();
    };

    render(): ReactNode {
        if (this.state.hasError) {
            if (this.props.fallback !== undefined) {
                return this.props.fallback;
            }

            const { error, errorInfo } = this.state;
            return (
                <div
                    role="alert"
                    style={{
                        padding: '2rem',
                        margin: '2rem auto',
                        maxWidth: '720px',
                        fontFamily: 'system-ui, -apple-system, sans-serif',
                        background: colors.dangerSoft,
                        border: `1px solid ${colors.danger}`,
                        borderRadius: '8px',
                        color: colors.dangerText,
                    }}
                >
                    <h1 style={{ marginTop: 0, fontSize: '1.5rem' }}>
                        Something went wrong
                    </h1>
                    <p>
                        An unexpected error occurred in the application. You can try
                        recovering without losing your session, or reload the page if
                        the error persists.
                    </p>
                    {error && (
                        <details
                            style={{
                                marginTop: '1rem',
                                padding: '0.75rem',
                                background: colors.surface,
                                border: `1px solid ${colors.dangerSoft}`,
                                borderRadius: '4px',
                                whiteSpace: 'pre-wrap',
                                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                                fontSize: '0.85rem',
                            }}
                        >
                            <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                                Error details
                            </summary>
                            <div style={{ marginTop: '0.5rem' }}>
                                <strong>{error.name}:</strong> {error.message}
                            </div>
                            {error.stack && (
                                <pre style={{ marginTop: '0.5rem', overflow: 'auto' }}>
                                    {error.stack}
                                </pre>
                            )}
                            {errorInfo?.componentStack && (
                                <pre style={{ marginTop: '0.5rem', overflow: 'auto' }}>
                                    {errorInfo.componentStack}
                                </pre>
                            )}
                        </details>
                    )}
                    <div style={{ marginTop: '1.25rem', display: 'flex', gap: '0.75rem' }}>
                        <button
                            type="button"
                            onClick={this.handleReset}
                            style={{
                                padding: '0.5rem 1rem',
                                background: colors.brand,
                                color: colors.textOnBrand,
                                border: 'none',
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 600,
                            }}
                        >
                            Try again
                        </button>
                        <button
                            type="button"
                            onClick={this.handleReload}
                            style={{
                                padding: '0.5rem 1rem',
                                background: colors.surface,
                                color: colors.brand,
                                border: `1px solid ${colors.brand}`,
                                borderRadius: '4px',
                                cursor: 'pointer',
                                fontWeight: 600,
                            }}
                        >
                            Reload page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}

export default ErrorBoundary;
