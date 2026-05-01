// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

// Token consumers for inline styles. Mirrors `tokens.css`. Values are
// `var(--…)` strings so the resolved color/size lives in one place
// (the CSS custom property) — TypeScript is just a typed accessor.
//
// Use this in components that build `style={{ … }}` objects:
//   import { colors, space, text, radius } from '../styles/tokens';
//   <div style={{ background: colors.surface, padding: space[3] }} />
//
// CSS files keep using `var(--color-brand)` directly.

export const colors = {
  surface: 'var(--color-surface)',
  surfaceMuted: 'var(--color-surface-muted)',
  surfaceRaised: 'var(--color-surface-raised)',

  border: 'var(--color-border)',
  borderSubtle: 'var(--color-border-subtle)',
  borderStrong: 'var(--color-border-strong)',

  textPrimary: 'var(--color-text-primary)',
  textSecondary: 'var(--color-text-secondary)',
  textTertiary: 'var(--color-text-tertiary)',
  textOnBrand: 'var(--color-text-on-brand)',

  brand: 'var(--color-brand)',
  brandStrong: 'var(--color-brand-strong)',
  brandSoft: 'var(--color-brand-soft)',
  brandMid: 'var(--color-brand-mid)',

  success: 'var(--color-success)',
  successStrong: 'var(--color-success-strong)',
  successSoft: 'var(--color-success-soft)',
  successText: 'var(--color-success-text)',

  warning: 'var(--color-warning)',
  warningStrong: 'var(--color-warning-strong)',
  warningSoft: 'var(--color-warning-soft)',
  warningBorder: 'var(--color-warning-border)',
  warningText: 'var(--color-warning-text)',

  danger: 'var(--color-danger)',
  dangerStrong: 'var(--color-danger-strong)',
  dangerSoft: 'var(--color-danger-soft)',
  dangerText: 'var(--color-danger-text)',

  accent: 'var(--color-accent)',
  chrome: 'var(--color-chrome)',
  chromeSoft: 'var(--color-chrome-soft)',
  disabled: 'var(--color-disabled)',
} as const;

export const space = {
  0: 'var(--space-0)',
  half: 'var(--space-half)',
  1: 'var(--space-1)',
  2: 'var(--space-2)',
  3: 'var(--space-3)',
  4: 'var(--space-4)',
  5: 'var(--space-5)',
  6: 'var(--space-6)',
  7: 'var(--space-7)',
} as const;

export const text = {
  xs: 'var(--text-xs)',
  sm: 'var(--text-sm)',
  md: 'var(--text-md)',
  lg: 'var(--text-lg)',
  xl: 'var(--text-xl)',
  xxl: 'var(--text-xxl)',
} as const;

export const radius = {
  sm: 'var(--radius-sm)',
  md: 'var(--radius-md)',
  lg: 'var(--radius-lg)',
} as const;
