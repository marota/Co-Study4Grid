// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { interactionLogger } from '../../utils/interactionLogger';
import type { SettingsState } from '../../hooks/useSettings';

interface SettingsModalProps {
  settings: SettingsState;
  onApply: () => void;
}

const SettingsModal: React.FC<SettingsModalProps> = ({ settings, onApply }) => {
  const {
    isSettingsOpen,
    settingsTab, setSettingsTab,
    networkPath, setNetworkPath,
    actionPath, setActionPath,
    layoutPath, setLayoutPath,
    outputFolderPath, setOutputFolderPath,
    configFilePath, setConfigFilePath, changeConfigFilePath,
    minLineReconnections, setMinLineReconnections,
    minCloseCoupling, setMinCloseCoupling,
    minOpenCoupling, setMinOpenCoupling,
    minLineDisconnections, setMinLineDisconnections,
    nPrioritizedActions, setNPrioritizedActions,
    minPst, setMinPst,
    minLoadShedding, setMinLoadShedding,
    minRenewableCurtailmentActions, setMinRenewableCurtailmentActions,
    ignoreReconnections, setIgnoreReconnections,
    monitoringFactor, setMonitoringFactor,
    linesMonitoringPath, setLinesMonitoringPath,
    preExistingOverloadThreshold, setPreExistingOverloadThreshold,
    pypowsyblFastMode, setPypowsyblFastMode,
    pickSettingsPath,
    handleCloseSettings,
  } = settings;

  if (!isSettingsOpen) return null;

  const tabButton = (id: 'paths' | 'recommender' | 'configurations', label: string) => (
    <button
      onClick={() => { interactionLogger.record('settings_tab_changed', { tab: id }); setSettingsTab(id); }}
      style={{
        flex: 1, padding: '10px', cursor: 'pointer', background: 'none',
        border: 'none', borderBottom: settingsTab === id ? '2px solid #3498db' : 'none',
        fontWeight: settingsTab === id ? 'bold' : 'normal',
        color: settingsTab === id ? '#3498db' : '#555'
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 3000,
      display: 'flex', justifyContent: 'center', alignItems: 'center'
    }}>
      <div
        role="dialog"
        style={{
          background: 'white', padding: '25px', borderRadius: '8px',
          width: '450px', boxShadow: '0 4px 15px rgba(0,0,0,0.2)',
          display: 'flex', flexDirection: 'column', gap: '15px', color: 'black'
        }}
      >
        {/* Tabs */}
        <div style={{ display: 'flex', borderBottom: '1px solid #eee', marginBottom: '15px' }}>
          {tabButton('paths', 'Paths')}
          {tabButton('recommender', 'Recommender')}
          {tabButton('configurations', 'Configurations')}
        </div>

        {/* Paths Tab */}
        {settingsTab === 'paths' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label htmlFor="networkPathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Network File Path (.xiidm)</label>
              <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-3px' }}>Synchronized with the banner field</div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input id="networkPathInput" type="text" value={networkPath} onChange={e => setNetworkPath(e.target.value)} placeholder="load your grid xiidm file path" style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                <button onClick={() => pickSettingsPath('file', setNetworkPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📄</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label htmlFor="actionPathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Action Dictionary File Path</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input id="actionPathInput" type="text" value={actionPath} onChange={e => setActionPath(e.target.value)} style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                <button onClick={() => pickSettingsPath('file', setActionPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📄</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label htmlFor="layoutPathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Layout File Path (.json)</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input id="layoutPathInput" type="text" value={layoutPath} onChange={e => setLayoutPath(e.target.value)} style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                <button onClick={() => pickSettingsPath('file', setLayoutPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📄</button>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Output Folder Path</label>
              <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-3px' }}>Session folders (JSON + PDF) are saved here. Leave empty to download JSON to browser.</div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input type="text" value={outputFolderPath} onChange={e => setOutputFolderPath(e.target.value)} placeholder="e.g. /home/user/sessions" style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }} />
                <button onClick={() => pickSettingsPath('dir', setOutputFolderPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📂</button>
              </div>
            </div>
            <hr style={{ border: 'none', borderTop: '1px solid #eee', margin: '5px 0' }} />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label htmlFor="configFilePathInput" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Config File Path</label>
              <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-3px' }}>
                Path to the <code>config.json</code> settings file. Change this to use a config stored outside the repository.
                The file will be created from defaults if it does not exist.
              </div>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input
                  id="configFilePathInput"
                  type="text"
                  value={configFilePath}
                  onChange={e => setConfigFilePath(e.target.value)}
                  onBlur={e => changeConfigFilePath(e.target.value).catch(() => { })}
                  placeholder="e.g. /home/user/my_costudy4grid_config.json"
                  style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
                <button
                  onClick={() => pickSettingsPath('file', (p) => changeConfigFilePath(p).catch(() => { }))}
                  style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}
                >📄</button>
              </div>
            </div>
          </div>
        )}

        {/* Recommender Tab */}
        {settingsTab === 'recommender' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {[
              { label: 'Min Line Reconnections', value: minLineReconnections, setter: setMinLineReconnections },
              { label: 'Min Close Coupling', value: minCloseCoupling, setter: setMinCloseCoupling },
              { label: 'Min Open Coupling', value: minOpenCoupling, setter: setMinOpenCoupling },
              { label: 'Min Line Disconnections', value: minLineDisconnections, setter: setMinLineDisconnections },
              { label: 'Min PST Actions', value: minPst, setter: setMinPst },
              { label: 'Min Load Shedding', value: minLoadShedding, setter: setMinLoadShedding },
              { label: 'Min Renewable Curtailment', value: minRenewableCurtailmentActions, setter: setMinRenewableCurtailmentActions },
            ].map(({ label, value, setter }) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>{label}</label>
                <input
                  type="number" step="0.1" value={value}
                  onChange={e => setter(parseFloat(e.target.value))}
                  style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>N Prioritized Actions</label>
              <input
                type="number" step="1" value={nPrioritizedActions}
                onChange={e => setNPrioritizedActions(parseInt(e.target.value, 10))}
                style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #eee' }}>
              <input
                type="checkbox" id="ignoreRec" checked={ignoreReconnections}
                onChange={e => setIgnoreReconnections(e.target.checked)}
                style={{ width: '16px', height: '16px' }}
              />
              <label htmlFor="ignoreRec" style={{ fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>Ignore Reconnections</label>
            </div>
          </div>
        )}

        {/* Configurations Tab */}
        {settingsTab === 'configurations' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label htmlFor="monitoringFactor" style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Monitoring Factor Thermal Limits</label>
              <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
                <input
                  id="monitoringFactor" type="number" step="0.01" min="0" max="2"
                  value={monitoringFactor} onChange={e => setMonitoringFactor(parseFloat(e.target.value))}
                  style={{ padding: '6px', width: '80px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
                <span style={{ fontSize: '0.85rem', color: '#666' }}>Multiplier applied to standard limits (e.g., 0.95)</span>
              </div>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Lines Monitoring File (Optional)</label>
              <div style={{ display: 'flex', gap: '5px' }}>
                <input
                  type="text" value={linesMonitoringPath}
                  onChange={e => setLinesMonitoringPath(e.target.value)}
                  placeholder="Leave empty for IGNORE_LINES_MONITORING=True"
                  style={{ flex: 1, padding: '8px', border: '1px solid #ccc', borderRadius: '4px' }}
                />
                <button onClick={() => pickSettingsPath('file', setLinesMonitoringPath)} style={{ padding: '8px', background: '#7f8c8d', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', flexShrink: 0 }}>📁</button>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontWeight: 'bold', fontSize: '0.9rem' }}>Pre-existing Overload Threshold</label>
              <input
                type="number" step="0.01" min="0" max="1" value={preExistingOverloadThreshold}
                onChange={e => setPreExistingOverloadThreshold(parseFloat(e.target.value))}
                style={{ width: '80px', padding: '5px', border: '1px solid #ccc', borderRadius: '4px' }}
              />
            </div>
            <div style={{ fontSize: '0.75rem', color: '#666', marginTop: '-10px' }}>
              Pre-existing overloads excluded from N-1 &amp; max loading unless worsened by this fraction (default 2%)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '10px', background: '#f8f9fa', borderRadius: '4px', border: '1px solid #eee' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="checkbox" id="fastMode" checked={pypowsyblFastMode}
                    onChange={e => setPypowsyblFastMode(e.target.checked)}
                    style={{ width: '16px', height: '16px' }}
                  />
                  <label htmlFor="fastMode" style={{ fontWeight: 'bold', fontSize: '0.9rem', cursor: 'pointer' }}>Pypowsybl Fast Mode</label>
                </div>
                <div style={{ fontSize: '0.75rem', color: '#666', fontStyle: 'italic', marginLeft: '26px' }}>
                  Disable voltage control in pypowsybl for faster simulations (may affect convergence)
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '10px', gap: '10px' }}>
          <button
            onClick={handleCloseSettings}
            style={{ padding: '8px 20px', background: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Close
          </button>
          <button
            onClick={onApply}
            style={{ padding: '8px 20px', background: '#3498db', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
