// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { colors, radius, space } from '../styles/tokens';

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
          background: colors.danger, color: colors.textOnBrand,
          padding: `${space[3]} ${space[5]}`, borderRadius: radius.sm,
          boxShadow: '0 2px 10px rgba(0,0,0,0.2)', zIndex: 1000,
        }}>
          {error}
        </div>
      )}
      {infoMessage && (
        <div style={{
          position: 'fixed', bottom: 20, left: 20,
          background: infoMessage.startsWith('SUCCESS') ? colors.success : colors.brand,
          color: colors.textOnBrand,
          padding: `${space[3]} ${space[6]}`, borderRadius: radius.sm,
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
