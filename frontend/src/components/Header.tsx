// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import type { AnalysisResult } from '../types';

type SettingsTab = 'paths' | 'recommender' | 'configurations';

interface HeaderProps {
  networkPath: string;
  setNetworkPath: (path: string) => void;
  /**
   * Called when the user "commits" a network path change — either by
   * blurring the path input after editing it, or by selecting a new
   * file via the picker. Goes through App's confirmation pipeline so
   * the user is warned before the currently-loaded study is dropped.
   */
  onCommitNetworkPath: (path: string) => void;
  configLoading: boolean;
  result: AnalysisResult | null;
  selectedBranch: string;
  sessionRestoring: boolean;
  onPickSettingsPath: (type: 'file' | 'dir', setter: (val: string) => void) => void;
  onLoadStudy: () => void;
  onSaveResults: () => void;
  onOpenReloadModal: () => void;
  onOpenSettings: (tab: SettingsTab) => void;
}

const Header: React.FC<HeaderProps> = ({
  networkPath,
  setNetworkPath,
  onCommitNetworkPath,
  configLoading,
  result,
  selectedBranch,
  sessionRestoring,
  onPickSettingsPath,
  onLoadStudy,
  onSaveResults,
  onOpenReloadModal,
  onOpenSettings,
}) => {
  const saveDisabled = !result && !selectedBranch;

  return (
    <header style={{
      background: '#2c3e50', color: 'white', padding: '8px 20px',
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      gap: '15px', flexWrap: 'wrap'
    }}>
      <h2 style={{ margin: 0, fontSize: '1.1rem', whiteSpace: 'nowrap' }}>⚡ Co-Study4Grid</h2>

      <div style={{ flex: '1 1 200px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
        <label style={{ fontSize: '0.7rem', opacity: 0.8, whiteSpace: 'nowrap' }}>Network Path</label>
        <div style={{ display: 'flex', gap: '4px' }}>
          <input
            data-testid="header-network-path-input"
            type="text"
            value={networkPath}
            onChange={e => setNetworkPath(e.target.value)}
            // Run the confirmation pipeline once the user finishes
            // editing so that switching networks while a study is
            // already loaded prompts before silently dropping the
            // in-flight work.
            onBlur={e => onCommitNetworkPath(e.target.value)}
            placeholder="load your grid xiidm file path"
            style={{
              flex: 1, minWidth: 0, padding: '5px 8px',
              border: '1px solid rgba(255,255,255,0.3)', borderRadius: '4px',
              background: 'rgba(255,255,255,0.1)', color: 'white', fontSize: '0.8rem'
            }}
          />
          <button
            // The picker also routes through onCommitNetworkPath: the
            // user just chose a new file — that's an intentional commit
            // and must trigger the confirmation dialog if it would
            // overwrite an active study.
            onClick={() => onPickSettingsPath('file', onCommitNetworkPath)}
            style={{
              padding: '4px 8px', background: 'rgba(255,255,255,0.15)',
              border: '1px solid rgba(255,255,255,0.25)', borderRadius: '4px',
              color: 'white', cursor: 'pointer', fontSize: '0.8rem'
            }}
          >
            📄
          </button>
        </div>
      </div>

      <button
        onClick={onLoadStudy}
        disabled={configLoading}
        style={{
          padding: '6px 14px',
          background: configLoading ? '#95a5a6' : '#3498db',
          color: 'white', border: 'none', borderRadius: '4px',
          cursor: configLoading ? 'not-allowed' : 'pointer',
          fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap'
        }}
      >
        {configLoading ? '⏳ Loading...' : '🔄 Load Study'}
      </button>

      <button
        onClick={onSaveResults}
        disabled={saveDisabled}
        style={{
          padding: '6px 14px',
          background: saveDisabled ? '#95a5a6' : '#8e44ad',
          color: 'white', border: 'none', borderRadius: '4px',
          cursor: saveDisabled ? 'not-allowed' : 'pointer',
          fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap'
        }}
        title="Save session results to JSON"
      >
        💾 Save Results
      </button>

      <button
        onClick={onOpenReloadModal}
        disabled={sessionRestoring}
        style={{
          padding: '6px 14px',
          background: sessionRestoring ? '#95a5a6' : '#2980b9',
          color: 'white', border: 'none', borderRadius: '4px',
          cursor: sessionRestoring ? 'not-allowed' : 'pointer',
          fontWeight: 'bold', fontSize: '0.8rem', whiteSpace: 'nowrap'
        }}
        title="Reload a previously saved session"
      >
        {sessionRestoring ? 'Restoring...' : 'Reload Session'}
      </button>

      <button
        onClick={() => onOpenSettings('paths')}
        style={{
          background: '#7f8c8d', display: 'flex', alignItems: 'center',
          justifyContent: 'center', padding: '6px 8px', fontSize: '1rem',
          color: 'white', border: 'none', borderRadius: '4px',
          cursor: 'pointer', fontWeight: 'bold'
        }}
        title="Settings"
      >
        &#9881;
      </button>
    </header>
  );
};

export default Header;
