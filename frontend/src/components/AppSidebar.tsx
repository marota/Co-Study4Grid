// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React from 'react';
import SidebarSummary from './SidebarSummary';
import { type Notice } from './NoticesPanel';
import { colors, radius, space } from '../styles/tokens';

interface AppSidebarProps {
  /** Currently APPLIED contingency (list of element IDs disconnected). */
  selectedContingency: string[];
  /** Pending list the user is composing — committed via Apply button. */
  pendingContingency: string[];
  /** Free-text input value for the contingency picker. */
  contingencyInput: string;
  branches: string[];
  nameMap: Record<string, string>;
  n1LinesOverloaded: string[] | undefined;
  n1LinesOverloadedRho: number[] | undefined;
  selectedOverloads: Set<string> | null | undefined;
  contingencyOptions: React.ReactNode;
  onContingencyChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** Add the typed-in (or picked) element to ``pendingContingency``. */
  onContingencyAddElement: (id?: string) => void;
  /** Drop an element from ``pendingContingency``. */
  onContingencyRemoveElement: (id: string) => void;
  /** Commit ``pendingContingency`` as the applied contingency. */
  onContingencyApply: () => void;
  /** Discard the entire pending list and the applied contingency. */
  onContingencyClear: () => void;
  displayName: (id: string) => string;
  onContingencyZoom: (assetName: string) => void;
  onOverloadClick: (actionId: string, assetName: string, tab: 'n' | 'contingency') => void;
  /** Background notices surfaced in the tiered warning system (the
   *  tier-warning-system PR — `docs/proposals/ui-design-critique.md` recommendation #4).
   *  When the array is empty the pill self-hides. */
  notices?: Notice[];
  children: React.ReactNode;
}

/**
 * Left-sidebar layout shell:
 *
 * - A COMPACT sticky strip at the top (<SidebarSummary>) keeps only
 *   the clickable fields of interest visible while scrolling
 *   (selected contingency → zoom active tab; contingency overloads →
 *   jump to the contingency tab + zoom).
 * - Everything else — the full Select Contingency card with the
 *   multi-element picker + Apply button, the Overloads panel with its
 *   warnings and N / contingency breakdown, and the ActionFeed —
 *   scrolls together in a single column below (rendered as
 *   ``children``), saving vertical space.
 *
 * The Select Contingency card supports N-1 AND N-K studies: the user
 * adds elements one at a time (via the Add button or by hitting
 * Enter) and confirms the full list with the Apply button. Pressing
 * Apply commits the pending list to the actual ``selectedContingency``
 * which then drives the diagram fetch and analysis.
 */
export default function AppSidebar({
  selectedContingency,
  pendingContingency,
  contingencyInput,
  branches,
  nameMap,
  n1LinesOverloaded,
  n1LinesOverloadedRho,
  selectedOverloads,
  contingencyOptions,
  onContingencyChange,
  onContingencyAddElement,
  onContingencyRemoveElement,
  onContingencyApply,
  onContingencyClear,
  displayName,
  onContingencyZoom,
  onOverloadClick,
  notices,
  children,
}: AppSidebarProps) {
  // Pending differs from applied → user has unconfirmed edits to the
  // contingency that won't take effect until they hit Apply.
  const samePendingApplied =
    pendingContingency.length === selectedContingency.length &&
    pendingContingency.every((e, i) => e === selectedContingency[i]);
  const dirty = !samePendingApplied;
  const canAdd = contingencyInput.trim().length > 0;
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (canAdd) onContingencyAddElement();
    }
  };
  return (
    <div data-testid="sidebar" style={{ width: '25%', background: colors.borderSubtle, borderRight: `1px solid ${colors.border}`, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SidebarSummary
        selectedContingency={selectedContingency}
        n1LinesOverloaded={n1LinesOverloaded}
        n1LinesOverloadedRho={n1LinesOverloadedRho}
        selectedOverloads={selectedOverloads}
        displayName={displayName}
        onContingencyZoom={onContingencyZoom}
        onOverloadClick={onOverloadClick}
        notices={notices}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: space[4], minHeight: 0, display: 'flex', flexDirection: 'column', gap: space[4] }}>
        {branches.length > 0 && (
          <div style={{ flexShrink: 0, padding: `${space[3]} ${space[4]}`, background: colors.surface, borderRadius: radius.lg, border: `1px solid ${colors.border}`, boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🎯 Select Contingency</label>
            <div style={{ display: 'flex', gap: space[1] }}>
              <input
                data-testid="contingency-input"
                list="contingencies"
                value={contingencyInput}
                onChange={onContingencyChange}
                onKeyDown={onKeyDown}
                placeholder="Search line/bus, then Add…"
                style={{ flex: 1, padding: '7px 10px', border: `1px solid ${colors.border}`, borderRadius: radius.sm, boxSizing: 'border-box', fontSize: '0.85rem' }}
              />
              <button
                type="button"
                onClick={() => onContingencyAddElement()}
                disabled={!canAdd}
                title="Add this element to the contingency"
                style={{
                  padding: `0 ${space[3]}`,
                  background: canAdd ? colors.brand : colors.disabled,
                  color: colors.textOnBrand,
                  border: 'none',
                  borderRadius: radius.sm,
                  cursor: canAdd ? 'pointer' : 'not-allowed',
                  fontWeight: 'bold',
                  fontSize: '0.8rem',
                }}
              >
                + Add
              </button>
            </div>
            {contingencyInput && nameMap[contingencyInput] && (
              <div style={{ fontSize: '0.78rem', color: colors.textSecondary, marginTop: '3px', fontStyle: 'italic', lineHeight: 1.3 }}>
                {nameMap[contingencyInput]}
              </div>
            )}
            <datalist id="contingencies">
              {contingencyOptions}
            </datalist>

            {pendingContingency.length > 0 && (
              <div data-testid="pending-contingency-chips" style={{ marginTop: space[2], display: 'flex', flexWrap: 'wrap', gap: space[1] }}>
                {pendingContingency.map(id => (
                  <span
                    key={id}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: space[1],
                      padding: `${space.half} ${space[2]}`,
                      background: colors.borderSubtle,
                      border: `1px solid ${colors.border}`,
                      borderRadius: radius.sm,
                      fontSize: '0.78rem',
                    }}
                    title={nameMap[id] || id}
                  >
                    {displayName(id)}
                    <button
                      type="button"
                      onClick={() => onContingencyRemoveElement(id)}
                      title={`Remove ${id}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        padding: 0,
                        fontSize: '0.85rem',
                        lineHeight: 1,
                        color: colors.textSecondary,
                      }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}

            <div style={{ marginTop: space[2], display: 'flex', gap: space[1], alignItems: 'center' }}>
              <button
                type="button"
                onClick={onContingencyApply}
                disabled={pendingContingency.length === 0 || !dirty}
                title={
                  pendingContingency.length === 0
                    ? 'Add at least one element first'
                    : dirty
                      ? `Apply contingency (${pendingContingency.length} element${pendingContingency.length > 1 ? 's' : ''})`
                      : 'Already applied'
                }
                style={{
                  padding: `${space[1]} ${space[3]}`,
                  background: pendingContingency.length === 0 || !dirty ? colors.disabled : colors.accent,
                  color: colors.textOnBrand,
                  border: 'none',
                  borderRadius: radius.sm,
                  cursor: pendingContingency.length === 0 || !dirty ? 'not-allowed' : 'pointer',
                  fontWeight: 'bold',
                  fontSize: '0.78rem',
                }}
              >
                ✓ Apply contingency
              </button>
              {(pendingContingency.length > 0 || selectedContingency.length > 0) && (
                <button
                  type="button"
                  onClick={onContingencyClear}
                  title="Clear the pending list and the applied contingency"
                  style={{
                    padding: `${space[1]} ${space[2]}`,
                    background: 'transparent',
                    color: colors.textSecondary,
                    border: `1px solid ${colors.border}`,
                    borderRadius: radius.sm,
                    cursor: 'pointer',
                    fontSize: '0.75rem',
                  }}
                >
                  Clear
                </button>
              )}
              {dirty && pendingContingency.length > 0 && (
                <span style={{ fontSize: '0.7rem', color: colors.textSecondary, fontStyle: 'italic' }}>
                  {selectedContingency.length === 0 ? 'not applied' : 'unsaved changes'}
                </span>
              )}
            </div>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
