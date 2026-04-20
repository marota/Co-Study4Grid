# Standalone Interface Parity Audit

> **Location history:** this document was originally the
> "Standalone Interface Parity Audit" section in the root
> `CLAUDE.md`. It was extracted to `frontend/PARITY_AUDIT.md` on
> 2026-04-20 for two reasons: (1) the audit lives next to the
> React source tree it audits against and (2) the root CLAUDE.md
> was dominated by this content (~680 of 950 lines). Referenced
> from both `CLAUDE.md` (root) and `frontend/CLAUDE.md`.

> **Status as of 2026-04-20:** the hand-maintained
> `standalone_interface.html` was decommissioned and renamed to
> `standalone_interface_legacy.html` — committed as a frozen
> snapshot of its last version (do NOT edit further). The
> canonical single-file distribution is now
> `frontend/dist-standalone/standalone.html` produced by
> `npm run build:standalone`. The audit sections below still
> reference `standalone_interface.html` by name for continuity
> with the git history; when the parity scripts target the
> legacy file they read `standalone_interface_legacy.html`.


`standalone_interface.html` is a self-contained single-file mirror of the
React UI (~7300 lines of inline HTML + JS + CSS; no React imports, no
build step). It must remain **functionally equivalent** to the canonical
React app in `frontend/` — the audit below enumerates the current gap as
of 2026-04-19. Use this section as the work list when updating the
standalone interface.

The React frontend is the **source of truth**. When the two diverge, the
standalone must be brought up, not the other way around.

### Frontend Feature Inventory

Grouped by domain. Each item lists the primary React source file(s)
(see `frontend/CLAUDE.md` for directory structure).

#### Header & Study Loading
- **Load Study button** — `components/Header.tsx`, wired in `App.tsx::handleLoadConfig`
- **Save Results button** — `components/Header.tsx`, `hooks/useSession.ts::handleSaveResults`
- **Reload Session button** — `components/Header.tsx`, `hooks/useSession.ts::handleOpenReloadModal`
- **Settings button** — `components/Header.tsx`, opens `SettingsModal`
- **Network path input** (banner) — synchronised with the Paths-tab field in settings
- **Logo** (⚡ Co-Study4Grid) — `components/Header.tsx`

#### Settings Modal (3 tabs)
- **Paths tab** — network, action dict, layout, output folder, config-file paths; native pickers — `components/modals/SettingsModal.tsx`
- **Recommender tab** — min line reconnections/disconnections, min close/open coupling, min PST, min load shedding, min renewable curtailment, N prioritized actions, ignore-reconnections checkbox
- **Configurations tab** — monitoring factor, lines monitoring file path + counts, pre-existing overload threshold, pypowsybl fast mode
- **Config-file path management** — load/save the user config JSON, `changeConfigFilePath` — `hooks/useSettings.ts`
- **Monitored / total lines count** displayed on Configurations tab
- **Action dict stats** (reco / disco / pst / open_coupling / close_coupling / total) — surfaced from the `/api/config` response

#### Contingency Selection
- **Branch datalist dropdown** with type-ahead filter — `App.tsx` + Header integration
- **Human-readable name resolution** (`nameMap: ID → display name`) — `App.tsx::displayName`
- **Confirmation dialog** on contingency change when analysis state exists — `components/modals/ConfirmationDialog.tsx`, `App.tsx`
- **Sticky summary** showing selected contingency + N-1 overloads with zoom buttons — `components/ActionFeed.tsx`

#### Two-Step Analysis Flow
- **Step 1**: detect N-1 overloads — `hooks/useAnalysis.ts`, `/api/run-analysis-step1`
- **Overload selection panel** — multi-select checkboxes on detected overloads — `components/OverloadPanel.tsx`
- **`monitor_deselected` toggle** — widen analysis scope to deselected overloads — `components/OverloadPanel.tsx`
- **Step 2 streaming run** — NDJSON with early `pdf` event then `result` event — `hooks/useAnalysis.ts`, `/api/run-analysis-step2`

#### Action Feed (sidebar)
- **Action cards** — one per action, colour-coded by bucket — `components/ActionCard.tsx`, `components/ActionFeed.tsx`
- **Search / filter dropdown** — by ID, description, type filters (disco/reco/pst/ls/rc/…) — `components/ActionSearchDropdown.tsx`
- **Three buckets**: Suggested (recommender output), Selected (starred), Rejected — `hooks/useActions.ts`
- **Star / un-star** — `handleActionFavorite` — `hooks/useActions.ts`
- **Reject / un-reject** — `handleActionReject` — `hooks/useActions.ts`
- **Badges**: max-rho-line, load shedding count, renewable curtailment count, PST tap range, DC fallback — `components/ActionCard.tsx`
- **Scroll-to-selected** — `App.tsx::scrollToActionRef`
- **Load shedding details popup** — list of (load, MW) — `components/ActionCard.tsx`
- **Curtailment details popup** — list of (generator, MW curtailed) — `components/ActionCard.tsx`
- **PST details popup** — PST name → tap position, range — `components/ActionCard.tsx`
- **Manual action add** — search dropdown + "Add Manual Action" button — `components/ActionFeed.tsx`

#### Action-Variant Diagrams
- **Fetch on action select** — `hooks/useDiagrams.ts`, `/api/action-variant-diagram`
- **Network / Delta mode toggle** — `components/VisualizationPanel.tsx`
- **Focused action-variant diagram** — per-VL sub-diagram in post-action state — `/api/action-variant-focused-diagram`
- **Action-variant SLD** — triggered by VL double-click on action tab — `/api/action-variant-sld`

#### Visualization Panel
- **SVG render** with `react-zoom-pan-pinch` — `components/VisualizationPanel.tsx`, `hooks/usePanZoom.ts`
- **Zoom controls** — manual zoom in/out/reset — per-tab `usePanZoom` instance
- **Tabs**: N / N-1 / Action / Overflow (PDF) — `components/VisualizationPanel.tsx`
- **Inspect query (zoom-to-element)** — `usePanZoom.ts::zoomToElement`, `App.tsx::inspectQuery`
- **Voltage range filter** — slider hiding elements outside the selected kV band — `hooks/useDiagrams.ts::voltageRange`
- **Dynamic SVG scaling for large grids** (≥ 500 VLs) — `utils/svgUtils.ts::boostSvgForLargeGrid`
- **Asset click zoom + highlight** — `App.tsx::handleAssetClick`
- **Contingency highlight** — `utils/svgUtils.ts::applyContingencyHighlight` (uses `vector-effect`)
- **Overload highlights** — `utils/overloadHighlights.ts::computeN1OverloadHighlights`
- **Delta highlights** — `utils/svgUtils.ts::applyDeltaVisuals`
- **Zoom-tier LOD** — per-tier CSS classes hide text-heavy elements at overview zoom — `App.css`

#### Combined Actions Modal
- **Pair selection** (checkbox, max 2) — `components/CombinedActionsModal.tsx`
- **Superposition computation** (estimate max rho without simulation) — `/api/compute-superposition`
- **`ComputedPairsTable`** component for pre-computed pairs — `components/ComputedPairsTable.tsx`
- **`ExplorePairsTab`** component for all scored actions — `components/ExplorePairsTab.tsx`
- **Simulate combined** — full simulation of the pair — `/api/simulate-manual-action`

#### Action Overview Diagram
- **N-1 NAD with pin overlay** — one pin per prioritized action — `components/ActionOverviewDiagram.tsx`
- **`ActionCardPopover` preview** — hover pin → floating action summary — `components/ActionCardPopover.tsx`
- **Pin double-click navigation** — scroll sidebar to the action without selecting
- **Independent pan/zoom** — dedicated `usePanZoom` instance for the overview map

#### SLD Overlay
- **VL double-click → SLD popup** — `hooks/useSldOverlay.ts`, `App.tsx::handleVlDoubleClick`
- **N / N-1 / Action tabs** on the SLD — `components/SldOverlay.tsx`
- **Switch change visualisation** — changed breakers/switches highlighted — `components/SldOverlay.tsx`
- **Delta flow mode** — P/Q flow changes with direction arrows
- **SLD pan/zoom** — wheel zoom + drag
- **Auto-center on load** — fit-to-viewport

#### Detached + Tied Tabs
- **Detach tab into popup window** — `hooks/useDetachedTabs.ts`, `components/DetachableTabHost.tsx`
- **Tied viewBox sync** — one-way mirror from detached to main — `hooks/useTiedTabsSync.ts`
- **Focus detached tab** from the main window — `useDetachedTabs.ts::focus`

#### Session Save / Load
- **Save snapshot** to folder (or browser download) — `hooks/useSession.ts::handleSaveResults`, `/api/save-session`
- **List-sessions modal** — `components/modals/ReloadSessionModal.tsx`, `/api/list-sessions`
- **Restore session** — configuration + contingency + analysis state — `/api/load-session`
- **`restore-analysis-context`** — rehydrate `selectedOverloads`, monitored lines, computed pairs — `/api/restore-analysis-context` (wired on both sides as of 2026-04-20: `standalone_interface.html:3857` AND `frontend/src/hooks/useSession.ts::handleRestoreSession`; `sessionUtils.ts` now persists `lines_we_care_about` + `computed_pairs` in `session.json` so the monitored-line set survives a React-saved reload.)

#### Interaction Logger
- **Typed event recording** — `utils/interactionLogger.ts`, `types.ts::InteractionType` union
- **Correlation IDs** for async start/completion pairs
- **Replay-ready details** — each event carries every input needed to replay the gesture
- **Saved alongside session** as `interaction_log.json`

#### Confirmation Dialogs (shared component)
- **Contingency change** — warns if analysis state exists
- **Load Study** — warns before resetting
- **Apply Settings** — warns before resetting
- All three use `components/modals/ConfirmationDialog.tsx`

#### Error Handling
- **`ErrorBoundary`** — catches render errors — `components/ErrorBoundary.tsx`
- **Error toasts** — `App.tsx::setError`
- **Info messages** — `App.tsx::setInfoMessage`
- **Monitoring warning** — yellow banner when lines are unmonitored — `components/OverloadPanel.tsx`

#### Performance Optimizations
- **`format=text` diagram fetch** — skip `JSON.parse` on ~25 MB SVG strings — `api.ts::getNetworkDiagram`
- **Parallel boot XHRs** — branches + VLs + nominal voltages + N diagram in a single `Promise.all` — `App.tsx`
- **`getIdMap` WeakMap cache** — avoid re-scanning `[id]` on every highlight pass — `utils/svgUtils.ts`
- **NAD prefetch consumption** — backend pre-computes base NAD during `/api/config`; frontend consumes it near-instantly
- **`MemoizedSvgContainer`** — `React.memo` wrapper — `components/MemoizedSvgContainer.tsx`
- **Zoom-tier LOD** — hide text-heavy elements at overview zoom

### Standalone HTML Mirror Status

Legend: ✅ mirrored · ⚠️ partial (gap noted) · ❌ missing

| Feature group | Item | Status | Gap / note |
|---|---|---|---|
| **Header** | Load Study, Save, Reload, Settings buttons | ✅ | — |
| **Header** | Network path input, logo | ✅ | — |
| **Settings** | Paths tab (all 5 fields + pickers) | ✅ | — |
| **Settings** | Recommender tab (all sliders + ignore-reconnections) | ✅ | — |
| **Settings** | Configurations tab (monitoring factor, lines file, threshold, fast mode) | ✅ | — |
| **Settings** | Config-file path management | ✅ | — |
| **Settings** | Action dict stats display | ✅ | — |
| **Settings** | `settings_tab_changed` interaction log | ✅ | Emitted on every Paths/Recommender/Configurations tab click |
| **Settings** | `path_picked` interaction log | ✅ | Emitted from the native file/dir picker |
| **Contingency** | Datalist dropdown | ⚠️ | Shows IDs only — no human-readable name resolution in the options |
| **Contingency** | Confirmation dialog on change | ✅ | Uses `window.confirm()` |
| **Contingency** | Sticky summary strip | ✅ | — |
| **Analysis** | Step 1 detect | ✅ | — |
| **Analysis** | Overload selection panel | ✅ | — |
| **Analysis** | `monitor_deselected` toggle | ✅ | — |
| **Analysis** | Step 2 streaming (pdf + result events) | ✅ | — |
| **ActionFeed** | Cards, search, 3 buckets | ✅ | — |
| **ActionFeed** | Star / reject / manual-add | ✅ | — |
| **ActionFeed** | Max-rho / LS / RC / PST badges | ✅ | — |
| **ActionFeed** | DC-fallback badge | ⚠️ | `non_convergence` tracked but not surfaced in the filter dropdown |
| **ActionFeed** | Scroll-to-selected | ✅ | — |
| **ActionFeed** | Load-shedding details popup | ✅ | Stale-audit correction (2026-04-20): legacy renders the per-load breakdown + editable MW input + Re-simulate button inline on the card at `standalone:6920-6945`, matching React's `ActionCard.tsx:263-291`. Not a popover in React either — the audit's "popup" label was a misnomer; both sides render the breakdown in-card. |
| **ActionFeed** | Curtailment details popup | ✅ | Stale-audit correction: identical to LS above. Legacy `standalone:6946-6975` mirrors React `ActionCard.tsx:292-320`. Inline edit + re-simulate. |
| **ActionFeed** | PST details popup | ✅ | Stale-audit correction: both sides render the PST tap + range inline on the card (React `ActionCard.tsx:321-350`; legacy inline). No separate popover on either side. |
| **ActionFeed** | Re-simulate (MW + tap) interaction log | ✅ | Now emits `action_mw_resimulated` / `pst_tap_resimulated` |
| **ActionVariant** | Fetch on select | ✅ | — |
| **ActionVariant** | Network / Delta mode toggle | ✅ | — |
| **ActionVariant** | N / N-1 / Action tabs | ✅ | — |
| **ActionVariant** | SLD on VL double-click | ✅ | — |
| **Visualization** | SVG render | ✅ | — |
| **Visualization** | Pan / zoom | ⚠️ | Inline viewBox math — not `react-zoom-pan-pinch`; no inertia / gesture smoothing |
| **Visualization** | Zoom in / out / reset buttons | ✅ | — |
| **Visualization** | N / N-1 / Action / Overflow tabs | ✅ | — |
| **Visualization** | Inspect-query zoom | ⚠️ | Basic viewBox math; not the polished `usePanZoom` behaviour |
| **Visualization** | `inspect_query_changed` interaction log | ✅ | — |
| **Visualization** | Voltage range filter | ✅ | — |
| **Visualization** | `boostSvgForLargeGrid` scaling | ✅ | — |
| **Visualization** | Asset click zoom | ✅ | — |
| **Visualization** | Contingency highlight | ✅ | Stale-audit correction (2026-04-20): both sides use the SAME technique — a clone appended to the `nad-background-layer` carrying the `nad-highlight-clone` CSS class, which itself applies `vector-effect: non-scaling-stroke`. Legacy at `standalone_interface.html:1415-1468` mirrors React `utils/svgUtils.ts::applyContingencyHighlight:531-586` line-for-line. |
| **Visualization** | Overload / delta highlights | ✅ | — |
| **Visualization** | Zoom-tier LOD (hide labels at overview) | ✅ | Stale-audit correction (2026-04-20): legacy wires `computeZoomTier(current, original)` + `container.setAttribute('data-zoom-tier', tier)` at `standalone:810-830`, matched by the CSS hiding rules at `standalone:183-194`. Behaviourally equivalent to the React side (`usePanZoom.ts` + `App.css`). |
| **Perf** | Zoom-tier LOD | ✅ | See row above — was stale `❌`. |
| **Combined Actions** | Pair checkbox selection | ✅ | — |
| **Combined Actions** | Superposition compute | ✅ | — |
| **Combined Actions** | ComputedPairsTable | ✅ | Extracted 2026-04-20 as a module-level component at `standalone_interface.html:2369` (124 lines, 5 props). Mirrors React's `components/ComputedPairsTable.tsx`. Props threaded through explicitly — no closure over App-local state. |
| **Combined Actions** | ExplorePairsTab | ✅ | Extracted 2026-04-20 at `standalone_interface.html:2493` (234 lines, 16 props). Mirrors React's `components/ExplorePairsTab.tsx`. |
| **Combined Actions** | Simulate combined | ✅ | — |
| **Action Overview** | N-1 NAD with pin overlay | ✅ | Minimal port — one pin per prioritized action at the midpoint of its `max_rho_line`; no multi-pin fan-out, no combined-action curves. All 9 `overview_*` events fire at the documented gesture points. |
| **Action Overview** | ActionCardPopover on pin hover | ⚠️ | Minimal popover (id / description / max ρ / "View action" button). Not the full ActionCard component — no favorite/reject buttons inside the popover. |
| **Action Overview** | Pin double-click nav | ✅ | 250 ms debounce so single-click opens popover, double-click calls `handleActionSelect` |
| **Action Overview** | Independent zoom controls | ⚠️ | `+ / − / Fit` buttons emit `overview_zoom_*` events; they don't manipulate viewBox separately from the main action-tab pan/zoom. Good enough for replay, less polished than React's dedicated instance. |
| **Action Overview** | Inspect search | ✅ | Text input emits `overview_inspect_changed { query, action: 'focus'\|'cleared' }` |
| **SLD** | VL double-click popup | ✅ | — |
| **SLD** | N / N-1 / Action tabs | ✅ | — |
| **SLD** | Switch change highlight | ✅ | — |
| **SLD** | Delta flow mode | ✅ | — |
| **SLD** | Pan / zoom | ✅ | — |
| **SLD** | Auto-center on load | ✅ | — |
| **Detached tabs** | Pop into separate window | ⚠️ | Minimal port via `window.open()`. The popup gets a SNAPSHOT of the current SVG + a wheel/drag pan-zoom + Reattach / Tie buttons in its header. Accepted limitations vs. React: the popup doesn't live-update when main state changes (e.g. selecting a new action) and there's no React portal, so no shared component tree. All 4 events (`tab_detached`/`tab_reattached`/`tab_tied`/`tab_untied`) fire at the documented gesture points. |
| **Detached tabs** | Tied viewBox sync | ⚠️ | `window.postMessage`-based one-way mirror from popup → main when the popup tab is tied. `isSyncingRef` guard skips the immediate re-fire. |
| **Detached tabs** | Focus-from-main | ✅ | Clicking a tab header when the tab is already detached calls `focus()` on the popup rather than switching the main active tab. |
| **Session** | Save to folder | ✅ | — |
| **Session** | Browser download fallback | ✅ | — |
| **Session** | List-sessions modal | ✅ | — |
| **Session** | Restore configuration + contingency + analysis state | ✅ | Both restore client state AND re-push `lines_we_care_about` + `computed_pairs` to the backend via `/api/restore-analysis-context`. React wiring landed 2026-04-20 in `useSession::handleRestoreSession` + `sessionUtils.ts`; guarded by regression tests `useSession.test.ts::re-pushes lines_we_care_about` and `sessionUtils.test.ts::persists lines_we_care_about`. |
| **Session** | Restore interaction log | ✅ | — |
| **Interaction log** | Event-type coverage | ✅ | 51/51 gestures emitted by the frontend are now emitted by the standalone (the full `InteractionType` union minus 4 test-only helpers that neither codebase emits). |
| **Interaction log** | `details` schema conformance | ✅ | All emitted standalone events are spec-conformant; historical `min_kv/max_kv`, `target_tab`, `from_tab/to_tab`, `missing tab/scope` drifts all resolved |
| **Interaction log** | `recordCompletion` pairs | ⚠️ | Only `analysis_step{1,2}_completed` emitted — shared gap against the spec (fix needed on both sides) |
| **Interaction log** | Replay-ready details | ✅ | — |
| **Interaction log** | Saved with session | ✅ | — |
| **Confirmation** | Contingency change | ✅ | `window.confirm()` + emits `contingency_confirmed { type: 'contingency', pending_branch }` |
| **Confirmation** | Load Study | ✅ | `window.confirm()` + emits `contingency_confirmed { type: 'loadStudy' }` |
| **Confirmation** | Apply Settings | ✅ | `window.confirm()` + emits `contingency_confirmed { type: 'applySettings' }` |
| **Errors** | ErrorBoundary | ❌ | No catastrophic-render guard — only error-state message display |
| **Errors** | Error / info / monitoring-warning messages | ✅ | — |
| **Perf** | `format=text` diagram fetch | ✅ | Stale-audit correction (2026-04-20): legacy `standalone:3447` calls `fetch(..."/api/network-diagram?format=text"...)` — same raw-SVG-body optimisation as React `api.ts:69-92`. |
| **Perf** | Parallel boot XHRs | ✅ | `Promise.all([branches, VLs, nominal voltages])` |
| **Perf** | `getIdMap` WeakMap cache | ✅ | — |
| **Perf** | MemoizedSvgContainer | ❌ | No memoisation wrapper — inline SVG render |

### Parity Gap Priority

#### Top-priority gaps (biggest user impact — do first)
1. ~~**Action Overview Diagram + pin navigation**~~ — **DONE** (minimal port). Pins on the N-1 NAD, single-click popover, double-click navigation, zoom + inspect controls all wired, all 9 `overview_*` events fire. Follow-up polish: multi-pin fan-out on shared anchors, combined-action curves, full ActionCard in the popover.
2. ~~**Detached + tied tabs**~~ — **DONE** (minimal port). `window.open`-based popups with SVG snapshot + pan/zoom + postMessage-based tied viewBox mirror. Accepted limitations: popup content is a snapshot (doesn't live-update on main state changes) and there's no React portal. All 4 `tab_*` events fire. Follow-up polish: portal-style live updates, shared inspect-search inside popups.
3. **Pan/zoom migration to `react-zoom-pan-pinch`** — standalone uses raw viewBox math with no inertia or gesture smoothing. On large grids this is the single biggest UX regression versus the React app. **Deferred** — multi-hundred-line rewrite of `standalone:800-900` pan/zoom service; tracked as Phase-3 follow-up to the auto-generation work.
4. ~~**Zoom-tier LOD**~~ — **STALE AUDIT CLAIM (2026-04-20)**. Legacy has it wired at `standalone:810-830` + CSS at `:183-194`. No gap. Table row flipped to ✅.
5. ~~**Load-shedding / curtailment / PST details popups**~~ — **STALE AUDIT CLAIM**. Both sides render the per-item breakdown inline on the card with editable MW input + Re-simulate button. No user-visible gap. Table rows flipped to ✅.
6. ~~**Contingency highlight rendering**~~ — **STALE AUDIT CLAIM**. Both sides use the identical clone-in-background-layer approach with `vector-effect: non-scaling-stroke` on the `.nad-highlight-clone` class. No gap.
7. **Name-resolution in datalist** — **REAL GAP**. Surfacing `nameMap[id]` in the dropdown options. Very low effort, high frequent-use payoff on grids with 1000+ branches.
8. ~~**Confirmation dialog before Apply Settings**~~ — **STALE AUDIT CLAIM**. Legacy has it at `standalone:2541-2543`, emitting `contingency_confirmed { type: 'applySettings' }`. Table row confirms ✅.
9. **Interaction log correlation IDs on all async flows** — **SHARED GAP**. Both frontend and standalone emit exactly 2 `recordCompletion` pairs (step1 + step2); the replay contract lists ~8 other async wait-points (`action_selected`, `manual_action_simulated`, `combine_pair_simulated`, `settings_applied`, `session_reloaded`, `tab_detached/reattached`, `action_mw_resimulated`, `pst_tap_resimulated`) that would benefit from pairs. Not a legacy-vs-react divergence; not addressed in this pass to preserve parity.
10. ~~**Extracting inline `ComputedPairsTable` and `ExplorePairsTab`**~~ — **DONE** 2026-04-20 (commit `63612d4`). Both hoisted to module-level components at `standalone_interface.html:2369` (`ComputedPairsTable`, 5 props) and `:2493` (`ExplorePairsTab`, 16 props), sitting alongside the other already-extracted `ActionOverviewDiagram` + `MemoizedSvgContainer` modules. `App()` is now ~370 lines shorter.

#### Deferrable gaps (cosmetic / marginal)
1. **ErrorBoundary** — catastrophic-render guard. Rare in practice.
2. **MemoizedSvgContainer** — `React.memo` equivalent; marginal perf.
3. **`format=text` diagram fetch wiring** — confirm the standalone uses the `format=text` variant for large SVGs (saves ~500 ms of `JSON.parse`).
4. **DC-fallback badge in the filter dropdown** — `non_convergence` is tracked but not filterable by users.
5. **SVG prefetch of alternate variants** — pre-fetch N-1 SLD while viewing the N action variant. On-demand load is acceptable.

#### Features in the standalone that are no longer in React
None identified. The standalone is strictly a subset of the React app — there is no obsolete code path to remove. If a feature is removed from `frontend/`, delete it from `standalone_interface.html` in the same commit.

### Machine-grounded findings

The feature table above is human-curated. Two static conformity
scripts produce the machine-authoritative tables below; regenerate
them via `python scripts/check_standalone_parity.py --emit-markdown`
and `python scripts/check_session_fidelity.py --json`. See
`scripts/PARITY_README.md` for the three-layer design
(static / session-fidelity / E2E) and how to wire the first two
into CI.

#### Layer 1 — Static parity (`scripts/check_standalone_parity.py`)

_Generated from the parity script on 2026-04-19._
`InteractionType` union: **55** types. Frontend emits **51**,
standalone emits **51**. Full event-type coverage — zero missing
gestures, zero FE-vs-spec drifts, zero SA-vs-spec drifts, zero
missing API paths. **Layer 1 exits 0.**

The one symmetric-difference (`inspect_query_changed`: FE has
`{query, target_tab}`, SA has `{query}`) is spec-conformant on
both sides — `target_tab` is marked optional in the replay
contract and is only populated when the inspect field is
triggered from a detached-tab overlay. The standalone's minimal
detach port doesn't render an inspect input inside popups, so
the optional key is never set. Script's `_check_benign_diff`
helper filters this out.

The 4 InteractionType values neither codebase emits are
`settings_cancelled`, `action_unfavorited`, `action_unrejected`,
and `contingency_selected`-completion — all are declared in
`types.ts` for future-proofing but no current gesture triggers
them. Not a parity gap (both sides agree).

##### Details-key drift between frontend and standalone (1)

Down from 11. The remaining diff is spec-conformant on both sides
(the frontend's extra key is optional per the contract):

| Event | Frontend | Standalone | Note |
|---|---|---|---|
| `inspect_query_changed` | `{query, target_tab}` | `{query}` | `target_tab` is optional per spec — only populated when the inspect field is triggered from a detached-tab overlay (which the standalone doesn't support). Not a bug. |

##### Spec conformance (FE-vs-spec, SA-vs-spec)

- Frontend drifts: **0** (was 4 earlier in this branch; all resolved).
- Standalone drifts: **0** (was 14 earlier in this branch; all resolved by this commit's SA-drift fixes — `asset_clicked`, `diagram_tab_changed`, `sld_overlay_tab_changed`, `view_mode_changed`, `voltage_range_changed`, `zoom_in/out/reset`, `config_loaded`, `prioritized_actions_displayed`, and the harmless extras on `manual_action_simulated`, `session_saved`, `sld_overlay_opened`, `session_reload_modal_opened`).

##### Historical fixes on the React side (6 events resolved)

All six spec drifts that existed earlier in this branch are now
fixed, each with a regression test. The Python parity script +
Vitest `specConformance.test.ts` guard against re-introduction:

| Event | Fix | Regression test |
|---|---|---|
| `action_deselected` | `{action_id}` → `{previous_action_id}` | `hooks/useDiagrams.test.ts` |
| `analysis_step2_started` | added `element` + `all_overloads` | `hooks/useAnalysis.test.ts` |
| `overload_toggled` | added `selected` (post-toggle state) | `hooks/useAnalysis.test.ts` |
| `prioritized_actions_displayed` | `actions_count` → `n_actions` | `hooks/useAnalysis.test.ts` |
| `analysis_step2_completed` | `actions_count` → `n_actions` | `hooks/useAnalysis.test.ts` |
| `view_mode_changed` (hook path) | Removed hook-internal emission (App.tsx owns full-spec) | `hooks/useDiagrams.test.ts` |

The fifth one was surfaced by the Vitest spec-conformance test, not
the Python script — the script's set-based union across call sites
was masking it behind `App.tsx`'s full-shape emission. The
spec-conformance test walks all call sites individually and catches
per-site drift.

##### Historical fixes on the standalone side (14 events resolved)

All fourteen SA spec drifts that existed earlier in this branch are
now fixed:

| Event | Fix |
|---|---|
| `asset_clicked` | `target_tab` → `tab` |
| `diagram_tab_changed` | `{from_tab, to_tab}` → `{tab}` (destination) |
| `sld_overlay_tab_changed` | `{from_tab, to_tab}` → `{tab, vl_name}` |
| `view_mode_changed` | Added `tab: 'action'` + `scope: 'main'` |
| `voltage_range_changed` | `{min_kv, max_kv}` → `{min, max}` |
| `zoom_in` / `zoom_out` / `zoom_reset` | Added `tab: activeTab` |
| `config_loaded` | Added `output_folder_path` (was missing) |
| `prioritized_actions_displayed` | Added `n_actions` (was `{}`) |
| `manual_action_simulated` | Dropped empty `description: ''` extra |
| `session_saved` | Dropped `session_name` extra |
| `sld_overlay_opened` | Dropped `initial_tab` extra |
| `session_reload_modal_opened` | Dropped `{available_sessions, output_folder}` extras |

##### Standalone drifts from the replay-contract spec (14 events)

| Event | Spec required | Standalone emits | Missing | Standalone source |
|---|---|---|---|---|
| `asset_clicked` | `{action_id, asset_name, tab}` | `{action_id, asset_name, target_tab}` | `tab` | `standalone:3034,3056` |
| `config_loaded` | `{...17 settings + output_folder_path}` | 16 fields — missing `output_folder_path` | `output_folder_path` | `standalone:2054` |
| `diagram_tab_changed` | `{tab}` | `{from_tab, to_tab}` | `tab` | `standalone:6675` |
| `manual_action_simulated` | `{action_id}` | `{action_id, description}` | — (extra `description`, harmless) | `standalone:3823` |
| `prioritized_actions_displayed` | `{n_actions}` | `{}` | `n_actions` | `standalone:2834` |
| `session_reload_modal_opened` | `{}` | `{available_sessions, output_folder}` | — (extras, harmless) | `standalone:2477` |
| `session_saved` | `{output_folder}` | `{output_folder, session_name}` | — (extra `session_name`, harmless) | `standalone:2433` |
| `sld_overlay_opened` | `{action_id, vl_name}` | `{action_id, initial_tab, vl_name}` | — (extra `initial_tab`, harmless) | `standalone:3076` |
| `sld_overlay_tab_changed` | `{tab, vl_name}` | `{from_tab, to_tab}` | `tab, vl_name` | `standalone:5148` |
| `view_mode_changed` | `{mode, tab, scope}` | `{mode}` | `scope, tab` | `standalone:6762,6773` |
| `voltage_range_changed` | `{max, min}` | `{max_kv, min_kv}` | `max, min` | `standalone:5070,5083` |
| `zoom_in` | `{tab}` | `{}` | `tab` | `standalone:2148` |
| `zoom_out` | `{tab}` | `{}` | `tab` | `standalone:2163` |
| `zoom_reset` | `{tab}` | `{}` | `tab` | `standalone:2178` |

##### API paths referenced by the frontend but not by the standalone (0)

All API paths the React frontend exercises are now referenced in
the standalone. `/api/simulate-and-variant-diagram` was wired in
this commit as the primary path for the "simulate-then-fetch-
diagram" fallback: the standalone now consumes the NDJSON stream
(`metrics` event, then `diagram` event) and falls back to the
sequential `/api/simulate-manual-action` + `/api/action-variant-diagram`
pair if the stream fails — matching the React app's behaviour and
the per-event sidebar-first UX on slow NAD regenerations.

##### `recordCompletion` coverage

Both codebases emit the same two `*_completed` events:
`analysis_step1_completed` and `analysis_step2_completed`. The
replay spec lists more async wait-points that would benefit from
completion events (`action_selected`, `manual_action_simulated`,
`action_mw_resimulated`, `pst_tap_resimulated`,
`combine_pair_simulated`, `settings_applied`, `session_reloaded`,
`tab_detached` / `tab_reattached`) — this is a shared gap against
the spec, not a parity gap between the two codebases.

#### Layer 2 — Session-reload fidelity (`scripts/check_session_fidelity.py`)

_Generated from the fidelity script on 2026-04-19._ 30 curated
fields checked; 25/30 round-trip on React, 28/30 on standalone.

##### Fields the React frontend RESTORES but never SAVES

**0 fields — resolved** in this branch. The table below is the
historical record:

| Field | Fix | Regression test |
|---|---|---|
| `lines_overloaded_after` | Added to `SavedActionEntry` object literal in `sessionUtils.ts` | `utils/sessionUtils.test.ts::persists lines_overloaded_after so it survives save → reload (regression)` |

##### Fields absent from the standalone entirely

**0 fields — resolved.** `n_overloads_rho` and `n1_overloads_rho`
are now persisted by the standalone's session-save path
(`buildSessionSnapshot`) under the same save-only-OK convention as
React. Replay agents and offline inspection tools can now read
the sticky-header rho percentages from both codebases' session
dumps. The standalone now round-trips **30/30** curated fields
(React round-trips 26/30; the remaining 4 are intentional
re-derivation on reload per the React-side design — saved for
inspection, re-derived from a fresh N-1 diagram on reload).

#### Layer 3a — Gesture-sequence static proxy (`scripts/check_gesture_sequence.py`)

_Generated from the gesture-sequence script on 2026-04-19._
Canonical 11-step gesture sequence: **22/22** gesture-side parity
checks pass. For each gesture the script resolves the handler body
in both codebases and verifies the expected ordered list of
`interactionLogger.record(...)` + `recordCompletion(...)` calls is
present. Complements Layers 1 + 2 with sequence-awareness.

Limitations worth being aware of when a `22/22` pass lands:

- The walker sees **all** event-emission code paths in a handler,
  not just the one taken at runtime. `handleActionSelect` has both
  `action_selected` and `action_deselected` call sites (early-return
  on toggle), and Layer 3a reports both — a real Playwright run
  would fire only one per click.
- The walker cannot catch async ordering races (e.g. two XHRs that
  complete in non-deterministic order and emit events out-of-spec).
- Layer 3a does not check `details`-key shapes — that's Layer 1's
  job. Likewise it doesn't touch `session.json` shape — that's
  Layer 2. A passing 3a therefore does NOT mean parity overall.

#### Layer 3b — Behavioural E2E (`scripts/parity_e2e/e2e_parity.spec.ts`)

Real Playwright spec driving both UIs through the canonical gesture
sequence with a mocked backend (all `/api/*` calls fulfilled via
`page.route()`, so pypowsybl / expert_op4grid_recommender are NOT
required). The spec captures:

- Ordered list of `interactionLogger` events per run.
- `details` keys per event.
- `session.json` field paths.

And asserts three-way equality: React events == standalone events,
React keys == standalone keys, React session shape == standalone
session shape.

Runs in ~90 s including browser launch. Designed for **nightly
CI** or **on-label PR** runs, not per-commit (see the cost
discussion in `scripts/PARITY_README.md`). Not executed in the
sandbox this audit was generated from because Playwright's browser
download is blocked — the spec itself is committed and ready to
run in any standard CI environment with one-off setup:

```bash
cd scripts/parity_e2e
npm install
npx playwright install chromium
cd ../../frontend && npm run build
cd ../scripts/parity_e2e
npx playwright test
```

### Running the conformity checks

```bash
# Layer 1 — static parity (events, API paths, settings, spec diff)
python scripts/check_standalone_parity.py                # human text
python scripts/check_standalone_parity.py --emit-markdown  # regenerate tables above
python scripts/check_standalone_parity.py --json         # CI-friendly

# Layer 2 — session-reload fidelity (save-vs-restore symmetry)
python scripts/check_session_fidelity.py                 # human text
python scripts/check_session_fidelity.py --json          # CI-friendly

# Layer 3a — gesture-sequence static proxy (15-step canonical)
python scripts/check_gesture_sequence.py                 # human text
python scripts/check_gesture_sequence.py --json          # CI-friendly

# Layer 4 — user-observable invariants (static Python)
python scripts/check_invariants.py                       # human text
python scripts/check_invariants.py --json                # CI-friendly

# Layer 4 — runtime Vitest companion (part of `cd frontend && npm test`)
#   Lives at frontend/src/utils/userObservableInvariants.test.ts

# Layer 3b — behavioural E2E (needs a Playwright browser; see
# scripts/PARITY_README.md for the one-off setup)
cd scripts/parity_e2e && npx playwright test
```

All five exit non-zero on any FAIL finding.

### CI wiring

`.github/workflows/parity.yml` runs the checks automatically:

- **Layers 1 + 2 + 3a** — every push to `main` + every PR. Pure
  Python, no backend, no browser. Finishes in <30 s.
- **Layer 3b** — nightly (cron `30 2 * * *`) + whenever a PR
  carries the `e2e` label. Builds the React app, installs
  Chromium, runs the full Playwright spec. ~6 min on a fresh
  runner, ~2 min with cache.

The workflow also appends Layer 1's `--emit-markdown` output to
the GitHub Actions step summary on every run, so per-PR comments
show exactly which events drifted from the spec without waiting
for reviewer triage. A Markdown step-summary example:

```
| Event | Spec required | Frontend emits | Missing |
|---|---|---|---|
| action_deselected | {previous_action_id} | {action_id} | previous_action_id |
```

The matching Vitest **spec-conformance** test
(`frontend/src/utils/specConformance.test.ts`) runs as part of the
regular frontend suite — `npm run test`. It walks every
`interactionLogger.record` call site in the React source and
verifies the `details` keys per event match the replay contract.
This is the pre-PR gate; the Layer-1 parity script is the PR-gate
fallback that also checks the standalone HTML.

### Honest gap report — what the parity scripts CANNOT catch

After three rounds of user-discovered standalone bugs that the
green parity reports failed to flag, here's the honest scorecard.
The four layers we ship today each guard a specific surface; none
of them inspect actual rendered DOM, which is where most
user-observable regressions live.

| Bug class | Example bugs missed | Why scripts missed it |
|---|---|---|
| **Visual threshold values** | Pin severity used hardcoded 0.9 / 1.0 cutoffs instead of `monitoringFactor` ± 0.05; Overview backdrop dimmed at 0.55 → edges invisible | No script reads CSS / fill / stroke values |
| **Conditional rendering** | Dashed combined-pair lines drawn for `is_estimated: true` entries (no simulation has run yet); Overview pin layer not in detached popup | Scripts inspect call-site syntax, not "when does this branch render" |
| **Field-semantic interpretation** | `max_rho_line` used as primary pin anchor instead of action's topology target; `is_estimated` not respected when filtering combined pairs | Scripts check shape, not which field a UI consumer should treat as authoritative |
| **Auto-effects ordering** | Tab didn't auto-switch to Action when Display Prioritized clicked; auto-zoom didn't fire after action selection; deselect snapped to N-1 instead of staying on Action | Scripts confirm an event fires; they don't check the side-effects (`setActiveTab`, `setViewBox`) that follow |
| **Loading-state hygiene** | Combine-modal Simulate button stuck in spinner state until variant diagram completed (5–6 s after the result was ready) | No script inspects loading flags / button disabled state |
| **Rendering performance** | Overview SVG re-cloned on every re-render (200–500 ms each); base NAD fetched serially after metadata | No script measures critical-path latency |

What the four layers DO catch:

| Layer | Scope |
|---|---|
| Layer 1 (`check_standalone_parity.py`) | Event-type coverage; `details` key shape; `InteractionType` union membership; API path coverage; `SettingsState` field coverage |
| Layer 2 (`check_session_fidelity.py`) | Session.json field round-trip (save vs restore); save-only-OK fields |
| Layer 3a (`check_gesture_sequence.py`) | Per-gesture ordered list of `record(...)` / `recordCompletion(...)` calls; sequence-aware but path-blind |
| Layer 3b (`parity_e2e/e2e_parity.spec.ts`) | Real browser run of the 11-gesture canonical session; same-event sequence + same-`details` keys + same-`session.json` shape between React + standalone |

Layer 3b is the only one positioned to catch most of the missed
classes — but only IF its gesture script exercises them. It
currently runs an 11-gesture canonical flow that doesn't visit
Display Prioritized → Action Overview → pin click. Extending the
script is the highest-leverage next move.

#### Proposed Layer 4 — User-observable invariants

Things scripts SHOULD check that none of L1–L3 do today:

1. **Pin severity ↔ rho ↔ monitoringFactor** — render the
   ActionOverviewDiagram with synthetic actions at rho =
   `mf - 0.06`, `mf - 0.04`, `mf + 0.01` and assert pins come out
   green / orange / red.
2. **Conditional render gates** — for each "this is shown when
   X" UI, snapshot the canonical states and check the right
   element exists / is hidden.
3. **Loading-state release** — drive a simulate, mock a slow
   diagram fetch, assert button releases when the metrics arrive,
   not when the diagram does.
4. **Auto-effects after gesture** — after `prioritized_actions_displayed`,
   assert `activeTab === 'action'` and the Overview is rendered.
   After `action_selected` with simulated diagram available,
   assert auto-zoom set viewBox onto `max_rho_line`.

These all need browser-level execution (jsdom + RTL or Playwright);
none can be done with a pure-Python regex pass. Realistic path:
add them as Vitest specs that mount the React component tree (the
React side guards itself), and as Playwright assertions in the
existing Layer 3b spec for the standalone side.

In the meantime: anyone editing the standalone Overview / detach
/ severity logic should manually run through the four bug classes
above before sending a PR. The CLAUDE.md mirror-status table is
updated reactively from user reports — it is not a complete
invariant.

### How to use this audit

When updating `standalone_interface.html`:

1. Run `scripts/check_standalone_parity.py` first. Every FAIL line is
   a specific, actionable item with file:line anchors on both sides.
2. For each "event type missing in standalone" finding: open the
   React source file listed, understand the gesture, and add an
   equivalent `interactionLogger.record('<type>', { ... })` at the
   matching spot in the standalone.
3. For each "details-key drift" finding: check which side the spec
   (`docs/interaction-logging.md`) sides with, then fix that side.
4. When a new endpoint is added to the backend (`expert_backend/main.py`)
   and surfaced in `frontend/src/api.ts`, mirror it in the standalone's
   inline API wrapper **in the same PR** — the script's API-path
   check will catch any miss.
5. When adding a new setting field: add it to the `SettingsState`
   interface AND to the standalone's `useState` set with a
   convention-compatible name (the script normalises camelCase ↔
   snake_case automatically).
6. Run the standalone locally by opening it in a browser with the
   FastAPI backend running. Confirm the gesture, diagram, and
   interaction-log output match the React app side by side. The
   script catches shape drift but not behavioural drift — a future
   Layer-3 Playwright spec is the next step (see the conformity-script
   design in the session transcript).

Last audited: 2026-04-20 (branch
`claude/auto-generate-standalone-interface-Hhogk`).
Numbers above regenerated by
`scripts/check_standalone_parity.py` on the same branch.

#### 2026-04-20 delta vs the previous audit

Two findings surfaced while cross-checking the audit against the
merged-today `claude/fix-grid-layout-reset-8TYEV` branch and while
running the parity layers against a first auto-generated standalone
(`frontend/dist-standalone/standalone.html`, produced by
`npm run build:standalone`). Neither is a new drift — both were
masked by the existing script's extractor assumptions.

1. **One-way API drift: `/api/restore-analysis-context`** — **RESOLVED**
   2026-04-20 in the same branch. The standalone calls this endpoint
   from `standalone_interface.html:3857` during session reload to push
   the saved `lines_we_care_about` back into the backend so subsequent
   simulate-action calls use the same monitored-line set as the
   original study. Before the fix, the React frontend never called
   this endpoint (`rg -n lines_we_care_about frontend/src` → 0 hits)
   and `frontend/src/utils/sessionUtils.ts` did not save
   `lines_we_care_about` in `session.json` either, so reloading a
   React-saved session and then running a new simulation fell back to
   the backend's default monitored-line policy — a silent behavioural
   gap on the React side that none of the 4 parity layers flagged.
   `scripts/check_standalone_parity.py` missed this because its
   `missing_api_paths` check is frontend→standalone only; it does not
   flag standalone-exclusive API paths. The fix:
   - `frontend/src/api.ts` → added `api.restoreAnalysisContext(...)`
   - `frontend/src/types.ts` → `AnalysisResult` + `SessionResult.analysis`
     gained `lines_we_care_about` and `computed_pairs`
   - `frontend/src/utils/sessionUtils.ts` → persists both fields in
     `session.json` (save-side parity with the standalone)
   - `frontend/src/hooks/useSession.ts::handleRestoreSession` → calls
     `api.restoreAnalysisContext(...)` right after the base-diagram
     `Promise.all`, wrapped in try/catch so the reload still completes
     if the push fails
   - Regression tests: `sessionUtils.test.ts::persists lines_we_care_about`,
     `sessionUtils.test.ts::persists computed_pairs`,
     `useSession.test.ts::re-pushes lines_we_care_about`, plus a legacy-
     session no-op test and a backend-offline-failure test
   - `frontend/src/api.test.ts` → unit test for the new axios method
   Follow-up still open: add a reverse check
   (`missing_api_paths_sa_only`) to `check_standalone_parity.py` so
   future standalone-only API paths surface automatically.

2. **Auto-generated-standalone viability: confirmed** — Phase 1 of
   the auto-generation plan (build a single-file React bundle via
   `vite-plugin-singlefile`) produced a 466 kB gzip-138 kB artifact
   that passes the 11-gesture static proxy, the 10-invariant
   Layer-4 check and the 30-field session-fidelity check against
   the same React source tree. Two Layer-1 spec-drift findings on
   the auto-generated output (`config_loaded`, `settings_applied`)
   are **false positives** of the regex-based extractor: React
   passes those details through `buildConfigInteractionDetails()`
   (a bare identifier), and the script's own comment at
   `check_standalone_parity.py:540-547` already documents it
   treats such sites as "deferred" rather than as drift. A single
   Layer-3a false positive (`analysis_step2_completed` not detected
   on `handleRunAnalysis` in the bundle) traces to the gesture
   walker's `_find_handler_range` anchor not recognising Vite's
   namespaced `reactExports.useCallback(` pattern. Summary: the
   auto-generated bundle is parity-clean with the React source it
   compiled from; the remaining failures are script-extractor
   limitations that did not apply to the hand-maintained standalone
   (where the record calls were literal, un-namespaced inline
   `interactionLogger.record(...)` / `useCallback(...)`).

The two scripts' `COSTUDY4GRID_STANDALONE_PATH` environment
variable (added 2026-04-20) lets callers re-target the audit at
any standalone artifact — useful for running the same checks
against both `standalone_interface.html` and
`frontend/dist-standalone/standalone.html` during the Phase-1
migration.
