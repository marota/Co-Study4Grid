// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { useEffect } from 'react';
import { api } from '../api';
import { cloneBaseSvg, applyPatchToClone } from '../utils/svgPatch';
import { processSvg } from '../utils/svgUtils';
import type { DiagramsState } from './useDiagrams';
import type { ConfirmDialogState } from '../components/modals/ConfirmationDialog';

interface UseN1FetchArgs {
  selectedBranch: string;
  branches: string[];
  voltageLevelsLength: number;
  diagrams: DiagramsState;
  analysisLoading: boolean;
  hasAnalysisState: () => boolean;
  clearContingencyState: () => void;
  setSelectedBranch: (v: string) => void;
  setConfirmDialog: (v: ConfirmDialogState) => void;
  setError: (v: string) => void;
}

/**
 * Drives the N-1 diagram fetch whenever the user commits a contingency
 * (or when a session reload rehydrates `selectedBranch` under an
 * analysis result that pre-exists the diagram). Owns two paths:
 *
 *   1. Fast svgPatch DOM-recycling path — clone the N-state SVG and
 *      mutate only what changed (dashed contingency line, flow labels,
 *      overload halos). Avoids a fresh ~20 MB NAD fetch on large grids.
 *      See docs/performance/history/svg-dom-recycling.md.
 *
 *   2. Full /api/n1-diagram fallback — used when the base N SVG is not
 *      yet mounted, the backend rejects the patch (`patchable: false`),
 *      the patch throws, or we're restoring a saved session (the reload
 *      contract mandates a full-fetch round-trip).
 *
 * The effect also routes through the contingency-change confirmation
 * dialog when a study is already loaded, and short-circuits when the
 * N-1 fetch for the current `selectedBranch` is already done / in
 * flight — the EXCEPT clause that keeps session-restore from being
 * silently skipped is `diagrams.restoringSessionRef.current`.
 */
export function useN1Fetch({
  selectedBranch,
  branches,
  voltageLevelsLength,
  diagrams,
  analysisLoading,
  hasAnalysisState,
  clearContingencyState,
  setSelectedBranch,
  setConfirmDialog,
  setError,
}: UseN1FetchArgs): void {
  const { n1Diagram, n1Loading, nDiagram } = diagrams;

  useEffect(() => {
    if (!selectedBranch) {
      diagrams.setN1Diagram(null);
      if (!hasAnalysisState()) {
        diagrams.committedBranchRef.current = '';
      }
      return;
    }

    if (branches.length > 0 && !branches.includes(selectedBranch)) return;

    // Short-circuit when we already have the N-1 diagram / fetch /
    // analysis for this branch — EXCEPT on session restore, where
    // `hasAnalysisState()` is already true (actions were rehydrated
    // by `useSession::handleRestoreSession`) while `n1Diagram` is
    // still null. In that case the early-return would silently skip
    // the N-1 fetch, leaving the N-1 tab blank and the N-1 overloads
    // panel empty. `restoringSessionRef.current` is the signal we
    // use to force the fetch through.
    if (selectedBranch === diagrams.committedBranchRef.current
        && !diagrams.restoringSessionRef.current
        && (n1Diagram || hasAnalysisState() || n1Loading || analysisLoading)) return;

    if (selectedBranch !== diagrams.committedBranchRef.current && hasAnalysisState() && !diagrams.restoringSessionRef.current) {
      setConfirmDialog({ type: 'contingency', pendingBranch: selectedBranch });
      setSelectedBranch(diagrams.committedBranchRef.current);
      return;
    }
    // Capture BEFORE we reset the ref so the rest of this effect can
    // distinguish "user changed contingency" from "session was just
    // restored". Without the local capture, any later branch in
    // this effect would see `restoringSessionRef.current === false`
    // and incorrectly wipe the just-restored analysis state via
    // `clearContingencyState()`.
    const isRestoring = diagrams.restoringSessionRef.current;
    diagrams.restoringSessionRef.current = false;

    diagrams.committedBranchRef.current = selectedBranch;
    if (!isRestoring) {
      clearContingencyState();
      diagrams.setN1Diagram(null);
    }

    const fetchN1 = async () => {
      diagrams.setN1Loading(true);
      // On user-initiated contingency change, switch to N-1 so the
      // fetched diagram is visible. On session restore, leave the
      // active tab alone so the user lands on whichever tab the
      // VisualizationPanel default (Action / Overflow) resolves to
      // given the restored state.
      if (!isRestoring) {
        diagrams.setActiveTab('n-1');
      }

      // Fast path — svgPatch DOM-recycling. Clone the N-state SVG and
      // mutate only what changed (the dashed contingency line, flow
      // labels, overload halos) instead of fetching a fresh ~20 MB
      // NAD. Falls back to the full /api/n1-diagram endpoint on any
      // error or when the base N DOM is not yet mounted. Session
      // reload always uses the full-fetch path to preserve the
      // reload contract. See docs/performance/history/svg-dom-recycling.md.
      const baseSvgEl = diagrams.nSvgContainerRef.current?.querySelector('svg') as SVGSVGElement | null;
      const baseMeta = diagrams.nMetaIndex;
      const canPatch = !!baseSvgEl && !!baseMeta && !isRestoring;
      if (canPatch) {
        console.log('[svgPatch] N-1 patch PATH — calling /api/n1-diagram-patch', selectedBranch);
        try {
          const patch = await api.getN1DiagramPatch(selectedBranch);
          if (patch.patchable) {
            console.log('[svgPatch] N-1 patch applied (patchable=true)', selectedBranch);
            const cloned = cloneBaseSvg(baseSvgEl!);
            applyPatchToClone(cloned, baseMeta!, patch);
            diagrams.setN1Diagram({
              svg: cloned,
              metadata: nDiagram?.metadata ?? null,
              originalViewBox: nDiagram?.originalViewBox ? { ...nDiagram.originalViewBox } : null,
              lines_overloaded: patch.lines_overloaded,
              lines_overloaded_rho: patch.lines_overloaded_rho,
              flow_deltas: patch.flow_deltas,
              reactive_flow_deltas: patch.reactive_flow_deltas,
              asset_deltas: patch.asset_deltas,
              lf_converged: patch.lf_converged,
              lf_status: patch.lf_status,
            });
            diagrams.lastZoomState.current = { query: '', branch: '' };
            diagrams.setN1Loading(false);
            return;
          }
        } catch (e) {
          console.warn('[svgPatch] N-1 patch threw — falling back to full fetch', e);
        }
      } else {
        console.log('[svgPatch] N-1 patch SKIPPED — no base N SVG/meta yet. baseSvgEl:', !!baseSvgEl, 'baseMeta:', !!baseMeta, 'restoring:', isRestoring);
      }

      try {
        const res = await api.getN1Diagram(selectedBranch);
        const { svg, viewBox } = processSvg(res.svg, voltageLevelsLength);
        diagrams.setN1Diagram({ ...res, svg, originalViewBox: viewBox });
        // Ensure auto-zoom fires after the new N-1 diagram is ready.
        // Reset lastZoomState so the auto-zoom effect sees a "branch change"
        // on the render that has both activeTab='n-1' and the new SVG in DOM.
        diagrams.lastZoomState.current = { query: '', branch: '' };
      } catch (err) {
        console.error('Failed to fetch N-1 diagram', err);
        setError(`Failed to fetch N-1 diagram for ${selectedBranch}`);
      } finally {
        diagrams.setN1Loading(false);
      }
    };
    fetchN1();
  }, [
    selectedBranch, branches, voltageLevelsLength, hasAnalysisState,
    clearContingencyState, analysisLoading, n1Diagram, n1Loading, setError,
    diagrams, nDiagram, setConfirmDialog, setSelectedBranch,
  ]);
}
