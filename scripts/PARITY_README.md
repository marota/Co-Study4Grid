# Parity conformity checks

Scripts in this directory verify that `standalone_interface.html`
faithfully mirrors the React frontend in `frontend/`. The React app
is the source of truth; when the two diverge, the standalone is
brought up — not the other way around.

See the root `CLAUDE.md` § "Standalone Interface Parity Audit" for
the gap list these scripts feed; `docs/features/interaction-logging.md` is
the canonical replay-contract spec they check against.

## Layers

| Layer | Script | Runs in | Gates CI | What it catches |
|---|---|---|---|---|
| **1. Static inventory** | `check_standalone_parity.py` | <5 s, no backend | yes | Event-type coverage, `details` schema drift (three-way diff vs spec), missing API paths, `SettingsState` fields |
| **2. Session fidelity** | `check_session_fidelity.py` | <2 s, no backend | yes | Fields saved to `session.json` that are silently dropped on reload (e.g. the PR #83 `lines_overloaded_after` regression) |
| **3a. Gesture sequence** (static proxy) | `check_gesture_sequence.py` | <2 s, no backend | yes | Canonical 15-step gesture sequence: each gesture's handler emits the required event types in the documented order. Covers the full loop through Display Prioritized → Overview → pin-click → pin-double-click → detach → deselect. |
| **3b. Behavioural E2E** (runtime) | `parity_e2e/e2e_parity.spec.ts` | 60–90 s, needs Playwright browser | nightly / on-label | Same gesture sequence driven through real DOM against BOTH UIs; diffs resulting `interaction_log.json` + `session.json` at runtime |
| **4. User-observable invariants** (static) | `check_invariants.py` + `frontend/src/utils/userObservableInvariants.test.ts` | <2 s Python + ~1 s Vitest, no backend | yes | Six bug classes Layers 1-3 can't catch by construction: visual thresholds (severity palette ↔ `monitoringFactor`), conditional rendering (dashed curves only for simulated pairs), field semantics (topology target precedes `max_rho_line`), auto-effects (tab auto-switch, deselect-stay), loading-state release timing, memoisation / performance guards |

Layers 1, 2, and 3a need only Python and finish in under 10 s total
— wire them into a GitHub Action on every PR. Layer 3b needs a
browser installed via `npx playwright install` and is designed for
nightly CI or on-label runs (see cost discussion below).

### Why both a 3a and a 3b

Layer-3b (real Playwright) is the strongest check — it exercises
both UIs through actual DOM events and captures the runtime
interaction log. But it requires a browser download that isn't
always available (sandboxed CI, restricted network environments)
and takes ~90 s per run.

Layer-3a (static) walks the source of both codebases, locates the
handler body for each canonical gesture, and verifies the expected
`interactionLogger.record(...)` / `recordCompletion(...)` calls
appear in the right order. It can't catch runtime ordering races
— if two code paths within one handler fire events in different
orders depending on state, 3a sees both paths and signals pass.
That's a genuine limitation, but it's strictly cheaper than 3b and
it catches the most common regression class: "gesture G should
emit event E but no code path emits E from its handler", in a
sequence-aware way that Layer-1's set-based diff misses.

Keep both: 3a is the always-on fast proxy, 3b is the nightly
authoritative check.

## Running the checks

```bash
# Layer 1 — static parity (events, API paths, settings, spec diff)
python scripts/check_standalone_parity.py                # human text
python scripts/check_standalone_parity.py --json         # machine
python scripts/check_standalone_parity.py --emit-markdown  # paste into CLAUDE.md

# Layer 2 — session-reload fidelity (save-vs-restore symmetry)
python scripts/check_session_fidelity.py                 # human text
python scripts/check_session_fidelity.py --json          # machine

# Layer 3a — gesture-sequence static proxy
python scripts/check_gesture_sequence.py                 # human text
python scripts/check_gesture_sequence.py --json          # machine

# Layer 4 — user-observable invariants (static Python)
python scripts/check_invariants.py                       # human text
python scripts/check_invariants.py --json                # machine

# Layer 4 — runtime Vitest companion (React-side behaviour)
cd frontend && npx vitest run src/utils/userObservableInvariants.test.ts

# Layer 3b — behavioural E2E with Playwright
cd scripts/parity_e2e
npm install
npx playwright install chromium     # one-off browser download
cd ../../frontend && npm run build  # prereq: React /dist produced
cd ../scripts/parity_e2e
npx playwright test
```

Each script exits 1 on any FAIL; suitable as a CI gate. They share
no state; run them in any order.

### Keeping `CLAUDE.md` in sync

The "Machine-grounded findings" section of the root `CLAUDE.md` is
meant to be regenerated, not hand-edited:

```bash
python scripts/check_standalone_parity.py --emit-markdown \
  > /tmp/parity.md
# ...paste /tmp/parity.md into the designated section of CLAUDE.md.
```

(Automating this with a pre-commit hook is a possible follow-up.)

## Spec encoder

`check_standalone_parity.py` contains a `SPEC_DETAILS` dict that
encodes the replay contract from `docs/features/interaction-logging.md §
Replay Contract`. Each InteractionType maps to `(required_keys,
optional_keys)`. When the spec changes, update this table in the
same PR — the script's three-way diff (spec vs FE, spec vs SA)
relies on it to attribute each finding to the side that owns the
fix.

## Layer-3b design notes

The spec in `parity_e2e/e2e_parity.spec.ts` drives the canonical
11-step gesture sequence against both UIs. It is written to be
**backend-free** — all `/api/*` calls are intercepted by
`page.route()` and fulfilled with canned JSON. That means the run
only needs:

1. A built React app (`frontend/dist/`) served via `vite preview`
   (`playwright.config.ts` does this automatically).
2. `standalone_interface.html` loaded via `file://`.
3. A Playwright-compatible browser (Chromium).

The spec captures three artefacts from each run:

- Ordered list of `interactionLogger.record(...)` events.
- `details` keys per event (order-insensitive).
- `session.json` field paths (the payload the Save Results button
  POSTs to `/api/save-session`).

It asserts equality across all three between the React run and the
standalone run. Divergence → test fail with a per-event diff.

### Why Layer 3b is not on every PR

- **Cost**: ~90 s including browser launch + both UI runs on
  a small grid.
- **Flakiness**: ordering races between async XHRs and React
  re-renders are real; timeouts need tuning per gesture.
- **Maintenance**: Playwright selectors drift faster than Python
  regex patterns as the UI changes.

Recommended cadence: run 1, 2, 3a per-PR (fast, deterministic);
run 3b nightly or behind an `e2e` label on PRs that touch
`standalone_interface.html`, `frontend/src/hooks/useAnalysis.ts`,
`frontend/src/utils/sessionUtils.ts`, or
`frontend/src/utils/interactionLogger.ts`.
