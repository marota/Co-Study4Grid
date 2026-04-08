// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

export type ConfirmDialogState = {
  type: 'contingency' | 'loadStudy';
  pendingBranch?: string;
} | null;

interface ConfirmationDialogProps {
  confirmDialog: ConfirmDialogState;
  onCancel: () => void;
  onConfirm: () => void;
}

const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  confirmDialog,
  onCancel,
  onConfirm,
}) => {
  if (!confirmDialog) return null;

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 4000,
      display: 'flex', justifyContent: 'center', alignItems: 'center'
    }}>
      <div style={{
        background: 'white', padding: '25px', borderRadius: '10px',
        boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        maxWidth: '450px', width: '90%', textAlign: 'center'
      }}>
        <div style={{ fontSize: '2rem', marginBottom: '12px' }}>&#9888;</div>
        <h3 style={{ margin: '0 0 12px', color: '#2c3e50', fontSize: '1.1rem' }}>
          {confirmDialog.type === 'contingency' ? 'Change Contingency?' : 'Reload Study?'}
        </h3>
        <p style={{ margin: '0 0 20px', color: '#555', fontSize: '0.9rem', lineHeight: '1.5' }}>
          All previous analysis results, manual simulations, action selections, and diagrams will be cleared.
          {confirmDialog.type === 'contingency'
            ? ' The network state will be preserved.'
            : ' The network will be reloaded from scratch.'}
        </p>
        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 20px', background: '#95a5a6', color: 'white',
              border: 'none', borderRadius: '5px', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '0.85rem'
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            style={{
              padding: '8px 20px', background: '#e67e22', color: 'white',
              border: 'none', borderRadius: '5px', cursor: 'pointer',
              fontWeight: 'bold', fontSize: '0.85rem'
            }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationDialog;
