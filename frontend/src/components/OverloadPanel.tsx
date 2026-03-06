import React from 'react';

interface OverloadPanelProps {
    nOverloads: string[];
    n1Overloads: string[];
    onAssetClick: (actionId: string, assetName: string, tab?: 'n' | 'n-1') => void;
    showMonitoringWarning?: boolean;
    monitoredLinesCount?: number;
    totalLinesCount?: number;
    monitoringFactor?: number;
    preExistingOverloadThreshold?: number;
    onDismissWarning?: () => void;
    onOpenSettings?: () => void;
}

const OverloadPanel: React.FC<OverloadPanelProps> = ({
    nOverloads,
    n1Overloads,
    onAssetClick,
    showMonitoringWarning,
    monitoredLinesCount,
    totalLinesCount,
    monitoringFactor,
    preExistingOverloadThreshold,
    onDismissWarning,
    onOpenSettings,
}) => {
    const clickableLinkStyle: React.CSSProperties = {
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        padding: 0,
        fontSize: 'inherit',
        color: '#1e40af',
        fontWeight: 600,
        textDecoration: 'underline dotted',
    };

    const renderLinks = (lines: string[], tab: 'n' | 'n-1') => {
        if (!lines || lines.length === 0) return <span style={{ color: '#888', fontStyle: 'italic' }}>None</span>;
        return lines.map((lineName, i) => (
            <React.Fragment key={i}>
                {i > 0 && ', '}
                <button
                    style={clickableLinkStyle}
                    title={`Zoom to ${lineName}`}
                    onClick={(e) => { e.stopPropagation(); onAssetClick('', lineName, tab); }}
                >
                    {lineName}
                </button>
            </React.Fragment>
        ));
    };

    return (
        <div style={{
            background: 'white',
            borderBottom: '1px solid #ccc',
            padding: '10px 15px',
            boxShadow: '0 2px 4px rgba(0,0,0,0.05)',
            zIndex: 10
        }}>
            <h3 style={{ margin: '0 0 8px 0', fontSize: '15px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#e74c3c' }}>⚠️</span> Overloads
            </h3>

            {showMonitoringWarning && totalLinesCount && totalLinesCount > 0 && (
                <div style={{
                    marginBottom: '10px',
                    padding: '8px 12px',
                    background: '#fff3cd',
                    border: '1px solid #ffeeba',
                    borderRadius: '4px',
                    color: '#856404',
                    fontSize: '0.8rem',
                    position: 'relative'
                }}>
                    ⚠️ <strong>{monitoredLinesCount}</strong> out of <strong>{totalLinesCount}</strong> lines monitored ({totalLinesCount - (monitoredLinesCount || 0)} without permanent limits). Monitoring factor: {Math.round((monitoringFactor || 0.95) * 100)}%. {Math.round((preExistingOverloadThreshold || 0.02) * 100)}% loading increase threshold for considering worsened overload in N.
                    <button
                        onClick={onOpenSettings}
                        style={{ background: 'none', border: 'none', color: '#0056b3', textDecoration: 'underline', cursor: 'pointer', padding: '0 0 0 5px', fontSize: 'inherit' }}
                    >
                        Change in settings
                    </button>
                    {onDismissWarning && (
                        <button
                            onClick={onDismissWarning}
                            style={{ float: 'right', background: 'none', border: 'none', fontSize: '16px', lineHeight: 1, color: '#856404', cursor: 'pointer' }}
                            title="Dismiss"
                        >
                            &times;
                        </button>
                    )}
                </div>
            )}

            <div style={{ fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '8px',
                    padding: '6px',
                    background: nOverloads.length > 0 ? '#fff3cd' : 'transparent',
                    borderLeft: nOverloads.length > 0 ? '3px solid #ffc107' : '3px solid transparent',
                    borderBottom: '1px solid #eee'
                }}>
                    <strong style={{ whiteSpace: 'nowrap' }}>N Overloads:</strong>
                    <div style={{ display: 'inline', wordBreak: 'break-word' }}>
                        {renderLinks(nOverloads, 'n')}
                    </div>
                </div>

                <div style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: '8px',
                    padding: '6px',
                    background: n1Overloads.length > 0 ? '#f8d7da' : 'transparent',
                    borderLeft: n1Overloads.length > 0 ? '3px solid #dc3545' : '3px solid transparent',
                    borderBottom: '1px solid #eee'
                }}>
                    <strong style={{ whiteSpace: 'nowrap' }}>N-1 Overloads:</strong>
                    <div style={{ display: 'inline', wordBreak: 'break-word' }}>
                        {renderLinks(n1Overloads, 'n-1')}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default OverloadPanel;
