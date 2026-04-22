// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

interface StatusToastsProps {
  error: string;
  infoMessage: string;
}

/**
 * Fixed-position status banners shown in the bottom corners of the
 * window. The error banner is red and pinned bottom-right; the info
 * banner is green (on SUCCESS-prefixed messages) or blue and pinned
 * bottom-left.
 */
export default function StatusToasts({ error, infoMessage }: StatusToastsProps) {
  return (
    <>
      {error && (
        <div style={{
          position: 'fixed', bottom: 20, right: 20,
          background: '#e74c3c', color: 'white',
          padding: '10px 20px', borderRadius: '4px',
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)', zIndex: 1000,
        }}>
          {error}
        </div>
      )}
      {infoMessage && (
        <div style={{
          position: 'fixed', bottom: 20, left: 20,
          background: infoMessage.startsWith('SUCCESS') ? '#27ae60' : '#3498db',
          color: 'white',
          padding: '12px 24px', borderRadius: '4px',
          boxShadow: '0 4px 15px rgba(0,0,0,0.3)', zIndex: 1000,
          fontWeight: 'bold',
          border: '1px solid rgba(255,255,255,0.2)'
        }}>
          {infoMessage}
        </div>
      )}
    </>
  );
}
