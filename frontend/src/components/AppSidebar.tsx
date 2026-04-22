// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React from 'react';
import SidebarSummary from './SidebarSummary';

interface AppSidebarProps {
  selectedBranch: string;
  branches: string[];
  nameMap: Record<string, string>;
  n1LinesOverloaded: string[] | undefined;
  n1LinesOverloadedRho: number[] | undefined;
  selectedOverloads: Set<string> | null | undefined;
  contingencyOptions: React.ReactNode;
  onContingencyChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  displayName: (id: string) => string;
  onContingencyZoom: (assetName: string) => void;
  onOverloadClick: (actionId: string, assetName: string, tab: 'n' | 'n-1') => void;
  children: React.ReactNode;
}

/**
 * Left-sidebar layout shell:
 *
 * - A COMPACT sticky strip at the top (<SidebarSummary>) keeps only
 *   the clickable fields of interest visible while scrolling
 *   (selected contingency → zoom active tab; N-1 overloads → jump to
 *   N-1 tab + zoom).
 * - Everything else — the full Select Contingency card with the
 *   search input, the Overloads panel with its warnings and N/N-1
 *   breakdown, and the ActionFeed — scrolls together in a single
 *   column below (rendered as `children`), saving vertical space.
 *
 * OverloadPanel and ActionFeed are passed as `children` rather than
 * wired via props to avoid duplicating their ~30-prop interfaces
 * here; App.tsx remains the composition root.
 */
export default function AppSidebar({
  selectedBranch,
  branches,
  nameMap,
  n1LinesOverloaded,
  n1LinesOverloadedRho,
  selectedOverloads,
  contingencyOptions,
  onContingencyChange,
  displayName,
  onContingencyZoom,
  onOverloadClick,
  children,
}: AppSidebarProps) {
  return (
    <div data-testid="sidebar" style={{ width: '25%', background: '#eee', borderRight: '1px solid #ccc', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
      <SidebarSummary
        selectedBranch={selectedBranch}
        n1LinesOverloaded={n1LinesOverloaded}
        n1LinesOverloadedRho={n1LinesOverloadedRho}
        selectedOverloads={selectedOverloads}
        displayName={displayName}
        onContingencyZoom={onContingencyZoom}
        onOverloadClick={onOverloadClick}
      />
      <div style={{ flex: 1, overflowY: 'auto', padding: '15px', minHeight: 0, display: 'flex', flexDirection: 'column', gap: '15px' }}>
        {branches.length > 0 && (
          <div style={{ flexShrink: 0, padding: '10px 15px', background: 'white', borderRadius: '8px', border: '1px solid #dee2e6', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
            <label style={{ fontSize: '0.8rem', fontWeight: 'bold', display: 'block', marginBottom: '5px' }}>🎯 Select Contingency</label>
            <input
              list="contingencies"
              value={selectedBranch}
              onChange={onContingencyChange}
              placeholder="Search line/bus..."
              style={{ width: '100%', padding: '7px 10px', border: '1px solid #ccc', borderRadius: '4px', boxSizing: 'border-box', fontSize: '0.85rem' }}
            />
            {selectedBranch && nameMap[selectedBranch] && (
              <div style={{ fontSize: '0.78rem', color: '#4b5563', marginTop: '3px', fontStyle: 'italic', lineHeight: 1.3 }}>
                {nameMap[selectedBranch]}
              </div>
            )}
            <datalist id="contingencies">
              {contingencyOptions}
            </datalist>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
