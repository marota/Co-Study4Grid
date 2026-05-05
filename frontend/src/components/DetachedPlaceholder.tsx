// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import React from 'react';
import type { TabId } from '../types';
import { colors } from '../styles/tokens';

/**
 * In-place stand-in shown inside `VisualizationPanel` when a tab has
 * been detached into a separate browser window. Surfaces the tab
 * label, a "Focus window" shortcut and a "Reattach" action so the
 * operator can recover from a hidden popup or pull the tab back into
 * the main window.
 */
const DetachedPlaceholder: React.FC<{
    tabId: TabId;
    label: string;
    accentColor: string;
    onFocusDetachedTab: (tab: TabId) => void;
    onReattachTab: (tab: TabId) => void;
}> = ({ tabId, label, accentColor, onFocusDetachedTab, onReattachTab }) => (
    <div style={{
        position: 'absolute', inset: 0,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        gap: '12px', background: colors.surfaceMuted, color: colors.textSecondary, fontSize: '13px',
    }}>
        <div style={{ fontSize: '32px', color: accentColor }}>{'\u21D7'}</div>
        <div style={{ fontWeight: 600 }}>"{label}" is open in a separate window</div>
        <div style={{ display: 'flex', gap: '8px' }}>
            <button
                onClick={() => onFocusDetachedTab(tabId)}
                style={{
                    border: `1px solid ${accentColor}`, background: 'white', color: accentColor,
                    borderRadius: '4px', padding: '6px 14px', fontSize: '12px',
                    fontWeight: 600, cursor: 'pointer',
                }}
            >
                Focus window
            </button>
            <button
                onClick={() => onReattachTab(tabId)}
                style={{
                    border: `1px solid ${colors.border}`, background: colors.surfaceMuted, color: colors.textSecondary,
                    borderRadius: '4px', padding: '6px 14px', fontSize: '12px',
                    fontWeight: 600, cursor: 'pointer',
                }}
            >
                Reattach
            </button>
        </div>
    </div>
);

export default DetachedPlaceholder;
