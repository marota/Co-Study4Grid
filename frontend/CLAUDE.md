# CLAUDE.md — `frontend/`

React 19 + TypeScript 5.9 + Vite 7 single-page app for Co-Study4Grid.
Talks to the FastAPI backend at `http://127.0.0.1:8000` (hardcoded in
`src/api.ts`). Renders pypowsybl NAD/SLD diagrams with pan/zoom and
runs the two-step contingency analysis workflow.

For the project-wide overview see the root `CLAUDE.md`. For backend
internals see `expert_backend/CLAUDE.md`. Test conventions for
Vitest are listed in `expert_backend/tests/CLAUDE.md` (the frontend
section).

## Layout

```
frontend/
├── README.md
├── index.html                # Vite HTML entry point
├── package.json              # React 19, Vite 7, vitest, axios, react-select,
│                             # react-zoom-pan-pinch, framer-motion, lucide-react
├── vite.config.ts            # Vite + Vitest plugin (jsdom env)
├── eslint.config.js          # Flat config (v9+) — typescript-eslint,
│                             # react-hooks, react-refresh
├── tsconfig.json             # Root project refs
├── tsconfig.app.json         # App config (strict TS, noUnusedLocals/Params,
│                             # noFallthroughCasesInSwitch)
├── tsconfig.node.json        # Vite/config TypeScript config
├── public/
└── src/
    ├── main.tsx              # React entry (StrictMode)
    ├── App.tsx               # State orchestration hub (~1000 lines)
    ├── App.*.test.tsx        # App-level integration tests by domain
    ├── App.css / index.css   # Global + app styles
    ├── api.ts                # Axios HTTP client (single object literal)
    ├── api.test.ts
    ├── types.ts              # All TypeScript interfaces (one file)
    ├── test/setup.ts         # Vitest global setup (jest-dom matchers)
    ├── hooks/                # Custom hooks owning a slice of state
    │   ├── useSettings.ts        # All settings + setters → SettingsState
    │   ├── useActions.ts         # Action selection / favorite / reject
    │   ├── useAnalysis.ts        # Two-step analysis flow (step1/step2)
    │   ├── useDiagrams.ts        # NAD fetching + tab management
    │   ├── usePanZoom.ts         # ViewBox state, zoom-to-element
    │   ├── useSldOverlay.ts      # Single-Line-Diagram overlay
    │   ├── useSession.ts         # Session save / restore
    │   ├── useDetachedTabs.ts    # Detached visualization windows
    │   └── useTiedTabsSync.ts    # Mirror viewBox between detached + main
    ├── components/           # Presentational components (no API calls)
    │   ├── Header.tsx, ActionFeed.tsx, OverloadPanel.tsx,
    │   ├── VisualizationPanel.tsx, ActionCard.tsx, ActionCardPopover.tsx,
    │   ├── ActionOverviewDiagram.tsx, ActionSearchDropdown.tsx,
    │   ├── CombinedActionsModal.tsx, ComputedPairsTable.tsx,
    │   ├── DetachableTabHost.tsx, ErrorBoundary.tsx, ExplorePairsTab.tsx,
    │   ├── MemoizedSvgContainer.tsx, SldOverlay.tsx
    │   └── modals/
    │       ├── SettingsModal.tsx          # 3-tab settings dialog
    │       ├── ReloadSessionModal.tsx     # Session reload list
    │       └── ConfirmationDialog.tsx     # Shared confirmation (contingency / reload)
    └── utils/                # Pure helpers (no React, no axios)
        ├── svgUtils.ts                # SVG processing, highlights, metadata
        ├── overloadHighlights.ts      # N-1 overload classification
        ├── popoverPlacement.ts        # Pin-popover positioning
        ├── sessionUtils.ts            # buildSessionResult snapshot
        ├── interactionLogger.ts       # Singleton replay-ready event log
        ├── mergeAnalysisResult.ts     # Merge step1 + step2 fields
        └── *.test.ts                  # Co-located unit tests
```

## Architecture in one paragraph

`App.tsx` is the **state orchestration hub** — it instantiates the
custom hooks (`useSettings`, `useActions`, `useAnalysis`,
`useDiagrams`, `useSession`, `useDetachedTabs`, `useTiedTabsSync`),
wires them together, and routes state into presentational components.
It MUST NOT contain large inline JSX blocks — when adding UI sections,
create a new component under `components/` or `components/modals/`
and pass props down. Hooks own state by domain (e.g. `useActions`
owns `selectedActionIds` / `manuallyAddedIds` / `rejectedActionIds`)
and expose typed setters + handlers. Cross-hook logic
(`handleApplySettings`, `resetAllState`, `wrappedRunAnalysis`) lives
in `App.tsx` because it needs multiple hook instances at once.

## Hook conventions

- Each hook returns a typed `*State` interface — e.g.
  `useSettings(): SettingsState`. The interface includes both values
  AND setters AND derived handlers (e.g. `pickSettingsPath`).
- Pass the entire state object wholesale into deeply-nested modals
  to avoid prop-drilling 30+ individual props (see how
  `<SettingsModal settings={settings} />` consumes the whole
  `SettingsState`).
- Refs intended to survive renders (e.g.
  `committedBranchRef`, `restoringSessionRef`,
  `actionSyncSourceRef`) live on the hook that owns them and are
  re-exported through the `*State` interface — not on `App.tsx`.
- Adding a new setting requires three places:
  1. `hooks/useSettings.ts` — field on `SettingsState` + a `useState`
     pair in `useSettings()`.
  2. `components/modals/SettingsModal.tsx` — input wired to the
     setter.
  3. ~~Manual mirror in `standalone_interface.html`~~ — no longer
     required. The legacy file has been decommissioned; the
     auto-generated `frontend/dist-standalone/standalone.html`
     inherits the field on the next `npm run build:standalone`.

## Data flow (happy path)

1. **Boot**: `App.tsx` first effect calls `api.getUserConfig()` →
   hydrates `useSettings` from `config.json`. The settings modal
   opens automatically if `networkPath` / `actionPath` are missing.
2. **Apply settings / Load study**: `applySettingsImmediate` calls
   `resetAllState()` → `api.updateConfig(buildConfigRequest())` →
   parallel `Promise.all` of `getBranches` + `getVoltageLevels` +
   `getNominalVoltages` + `getNetworkDiagram` (the slow NAD overlaps
   with the fast metadata calls — see
   `docs/performance/history/loading-parallel.md`).
3. **Select contingency**: typing in the contingency input fires the
   N-1 useEffect when the value matches a valid branch. If analysis
   state already exists, a confirmation dialog appears
   (`hasAnalysisState()` / `committedBranchRef.current`). On
   confirm, fetches `/api/n1-diagram` and stores it on
   `diagrams.n1Diagram`.
4. **Run analysis**: two-step flow. `runAnalysisStep1` returns the
   list of overloads; user selects which to resolve;
   `runAnalysisStep2Stream` streams a `pdf` event then a `result`
   event with prioritized actions.
5. **Action interactions**: star/reject/manually-add/re-simulate.
   Selecting an action triggers `/api/action-variant-diagram` →
   stored as `diagrams.actionDiagram`.
6. **Session save**: `buildSessionResult()` in
   `utils/sessionUtils.ts` serializes EVERYTHING (paths, settings,
   contingency, action statuses, combined pairs, interaction log).
   `api.saveSession()` writes to disk. See `docs/features/save-results.md`.

## State reset & confirmation dialogs

`resetAllState()` (`App.tsx:310-324`) clears every per-study piece of
React state. It is called on Apply Settings AND on Load Study. The
backend mirrors this with `recommender_service.reset()` —
`docs/features/state-reset-and-confirmation-dialogs.md` is the contract for
both sides. Adding a new piece of analysis state? Reset it here
AND make sure the backend mixin clears whatever cache shadows it.

Confirmation dialog flow lives in `App.tsx`:
- `confirmDialog` state: `{ type: 'contingency' | 'loadStudy' |
  'applySettings', pendingBranch?: string } | null`.
- `<ConfirmationDialog />` is the shared modal — used for all three
  contingency-loss-warning gestures.

## SVG handling

The frontend deals with multi-MB pypowsybl SVG payloads. Three
performance levers are applied today:

- **`api.getNetworkDiagram` uses `format=text`** (`api.ts:69-92`):
  fetches a JSON-header + raw-SVG-body response so the browser
  doesn't `JSON.parse` a 25 MB string. Saves ~500 ms on large grids.
- **`getIdMap(container)`** (`utils/svgUtils.ts:13-22`): cached
  `WeakMap<HTMLElement, Map<id, Element>>` so highlight passes don't
  re-scan `[id]` selectors. Invalidate via `invalidateIdMapCache`
  whenever the SVG content changes.
- **`boostSvgForLargeGrid`**: dynamic font/node-radius scaling for
  grids ≥ 500 voltage levels so labels stay readable at high zoom.

The visualization is rendered inside `react-zoom-pan-pinch`. Zoom
state is owned by `usePanZoom` per tab (`nPZ`, `n1PZ`, `actionPZ`,
plus `overviewPz` for the Action overview map). The
`useTiedTabsSync` hook mirrors viewBox changes from the active tab
to any "tied" detached tab.

## Detached tabs

`useDetachedTabs` opens diagram tabs in popup windows
(`window.open`). When popups are blocked, the error surfaces via
`onPopupBlocked` callback. The detached tab gets its own
`react-zoom-pan-pinch` instance; `useTiedTabsSync` keeps the
viewBoxes in sync. See `docs/features/detachable-viz-tabs.md`.

## Interaction logging

Every meaningful user gesture is recorded by the
`interactionLogger` singleton in `utils/interactionLogger.ts`.
Entries have a sequence number, ISO timestamp, typed `type` (see
the long `InteractionType` union in `types.ts`), free-form
`details`, optional `correlation_id`, and optional `duration_ms`
for async operations.

The log is replay-ready: each event must carry ALL inputs the
agent would need to redo the gesture (paths, threshold values,
selected branch, …). Saved as `interaction_log.json` alongside
`session.json` on session save. See `docs/features/interaction-logging.md`.

When adding a new gesture:
1. Add a new variant to the `InteractionType` union in
   `types.ts`.
2. Call `interactionLogger.record('your_event_type', { ... })` at
   the gesture site.
3. For async (start/complete) pairs, capture the correlation_id
   from `record()` and pass it to `recordCompletion()`.

## Testing (Vitest + React Testing Library)

```bash
cd frontend
npm run test         # one-shot
npm run test:watch   # watch mode
```

- Tests live next to source files as `*.test.ts` / `*.test.tsx`.
- `src/test/setup.ts` registers `@testing-library/jest-dom` matchers.
- jsdom is the test environment (vite.config.ts).
- Heavy mocking: `vi.mock('../api')`, `vi.mock('../utils/svgUtils')`.
  No backend round-trips in component tests.
- App-level integration tests are split by domain:
  `App.contingency.test.tsx`, `App.session.test.tsx`,
  `App.settings.test.tsx`, `App.stateManagement.test.tsx`,
  `App.datalist.test.tsx`, `App.import.test.tsx`.
- Pattern for new component tests: build `defaultProps`, override
  the fields under test, `render(<X {...props} />)`, query the DOM
  via `screen`, assert.

## Adding a new backend endpoint to the frontend

1. Add the axios method to `api.ts` (mirror the URL exactly).
2. Add response types to `types.ts` if they're new.
3. Call from the right hook (settings → `useSettings`, analysis →
   `useAnalysis`, diagrams → `useDiagrams`, session → `useSession`).
4. Wire any new state through to presentational components via
   typed props.
5. ~~Mirror the call in `standalone_interface.html`~~ — no longer
   required. The auto-generated `frontend/dist-standalone/standalone.html`
   inherits the new endpoint automatically after `npm run build:standalone`.

## Code style

- **Strict TypeScript**: `strict: true`, `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch`. `any` only
  with a comment explaining why.
- **Functional components + hooks**. No external state
  management library — context only when prop-drilling becomes
  unbearable.
- **Inline `style` objects** are the convention here (no CSS modules
  or utility-class framework). Match the surrounding component.
- **Memoize at the right level**: `useCallback` for handlers passed
  as props, `useMemo` for derived data passed to large children.
  Don't memoize cheap inline objects on small leaf components.
- **No comments explaining what** — well-named identifiers do that.
  Comment WHY only when the answer is non-obvious (subtle race,
  pypowsybl quirk, performance trade-off, browser bug).
- **Lint**: `npm run lint` is `eslint .` against the flat config in
  `eslint.config.js`. Run before committing.

## Build & dev

```bash
cd frontend
npm install
npm run dev      # Vite dev server with HMR (default port 5173)
npm run build    # tsc -b + vite build → dist/
npm run preview  # Preview the production build
```

`api.ts` hardcodes `http://127.0.0.1:8000` — start
`uvicorn expert_backend.main:app --port 8000` first.

## File-size rule of thumb

If a component crosses ~600 lines, look for an extractable concern:
a sub-component, a hook, or a helper in `utils/`. `App.tsx` is the
single intentional exception — it's a state orchestration hub by
design, but even it should not grow large inline JSX blocks.

## Standalone bundle (auto-generated)

The single-file HTML distribution is now auto-generated from this
React source tree by `npm run build:standalone` in `frontend/` (see
`frontend/vite.config.standalone.ts`). Output:
`frontend/dist-standalone/standalone.html` — a ~1 MB single file
with React + CSS inlined, favicon inlined as a data URI, no
external network dependencies. This artifact replaces the former
hand-maintained `standalone_interface.html` (renamed to
`standalone_interface_legacy.html` at the project root, committed
as a frozen snapshot of its last version — do NOT edit further).

Consequence for day-to-day dev: **no manual mirroring is required**
when you add a component, setting, endpoint, or gesture. Land the
change in `frontend/src/`, run the tests, and the standalone
inherits it on the next build.

## Parity audit

The working record of the standalone-vs-React parity effort —
feature inventory, mirror-status table, Layer 1–4 conformity
findings, gap-priority list, regression-guard matrix and deltas
— lives in [`frontend/PARITY_AUDIT.md`](./PARITY_AUDIT.md) (split
out of the root `CLAUDE.md` on 2026-04-20). Regenerate the
machine-authored tables with:

```bash
python scripts/check_standalone_parity.py --emit-markdown
python scripts/check_session_fidelity.py --json
python scripts/check_gesture_sequence.py --json
python scripts/check_invariants.py --json
```

All four scripts accept `COSTUDY4GRID_STANDALONE_PATH=<path>` to
re-target any artifact, and default to `dist-standalone/standalone.html`
with a fallback to the legacy file when the auto-gen is not built.

## How to make a UI change today

1. Edit the React source in `src/` — components, hooks, styles.
2. Run `npm run test` — the Vitest suite covers session
   save/reload, SLD highlights, action card re-simulation,
   settings logging, datalist clamping, and ~930 other specs.
3. Run `npm run build:standalone` — produces the single-file
   `dist-standalone/standalone.html` artifact. This is what ships
   as the standalone distribution.
4. Optionally run the parity scripts in `scripts/` if the change
   touches an interaction gesture, a settings field, an API
   endpoint, or a session-JSON field — those are the four
   contract surfaces each layer guards.

No manual mirror in any separate HTML file. The React source is
the single source of truth.
