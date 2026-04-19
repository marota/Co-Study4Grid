# Parity conformity checks

Scripts in this directory verify that `standalone_interface.html`
faithfully mirrors the React frontend in `frontend/`. The React app
is the source of truth; when the two diverge, the standalone is
brought up — not the other way around.

See the root `CLAUDE.md` § "Standalone Interface Parity Audit" for
the gap list these scripts feed; `docs/interaction-logging.md` is
the canonical replay-contract spec they check against.

## Three layers

The checks are split into three layers by cost and concern:

| Layer | Script | Runs in | Gates CI | What it catches |
|---|---|---|---|---|
| **1. Static inventory** | `check_standalone_parity.py` | <5 s, no backend | yes | Event-type coverage, `details` schema drift (three-way diff vs spec), missing API paths, `SettingsState` fields |
| **2. Session fidelity** | `check_session_fidelity.py` | <2 s, no backend | yes | Fields saved to `session.json` that are silently dropped on reload (e.g. PR #83's `lines_overloaded_after`) |
| **3. Behavioural E2E** | `e2e_parity.spec.ts` (planned) | 60–90 s, backend + Playwright | nightly / on-label | Identical gesture sequence against both UIs, diff of resulting `interaction_log.json` / `session.json` |

Layers 1 and 2 are implemented today and exit non-zero on any
FAIL-level finding — wire them into a GitHub Action on every PR.
Layer 3 is a sketch, not an implementation; see the design section
below.

## Running Layer 1 & 2

```bash
# Layer 1 — static parity (events, API paths, settings, spec diff)
python scripts/check_standalone_parity.py               # human text
python scripts/check_standalone_parity.py --json        # machine
python scripts/check_standalone_parity.py --emit-markdown  # paste into CLAUDE.md

# Layer 2 — session-reload fidelity (save-vs-restore symmetry)
python scripts/check_session_fidelity.py                # human text
python scripts/check_session_fidelity.py --json         # machine
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
encodes the replay contract from `docs/interaction-logging.md §
Replay Contract`. Each InteractionType maps to `(required_keys,
optional_keys)`. When the spec changes, update this table in the
same PR — the script's three-way diff (spec vs FE, spec vs SA)
relies on it to attribute each finding to the side that owns the
fix.

## Layer 3 design (not implemented)

Behavioural E2E parity is the strongest possible check — it runs an
identical user-gesture script against both codebases and diffs the
resulting artefacts. It requires:

1. A live FastAPI backend (`uvicorn expert_backend.main:app`).
2. Two servable UIs:
   - React dev server (`cd frontend && npm run dev`).
   - Standalone HTML served via `python -m http.server` (or equivalent)
     so `fetch` can hit `127.0.0.1:8000`.
3. Playwright installed (`npm install -D @playwright/test`).
4. A known grid fixture (e.g. `data/bare_env_small_grid_test`) so
   the gesture script has stable targets.

### Gesture script

The canonical session a Layer-3 spec drives:

```
1. Load Study (small_grid_test)
2. Select contingency LINE_A
3. Run step1 (detect overloads)
4. Toggle one overload off
5. Run step2 (resolve)
6. Star action disco_3
7. Reject action reco_1
8. Simulate a manual action
9. Re-simulate it with edited target_mw
10. Open SLD on VL_X
11. Switch SLD sub-tab to action
12. Save session → folder
```

Both runs produce a `session.json` + `interaction_log.json`. The
spec then asserts:

- **Identical event sequence** (order-sensitive `type` values).
  Divergence here means one UI emits an event the other doesn't.
- **Identical `details` keys per event** (order-insensitive).
  Divergence catches schema drift that Layer-1's regex missed.
- **Identical `session.json` shape** (not values — timestamps and
  durations will differ). Divergence catches save-side omissions
  that Layer-2's grep missed.

### Implementation sketch

```typescript
// scripts/e2e_parity.spec.ts  (planned)
import { test, expect } from '@playwright/test';
import { runCanonicalSession } from './e2e_helpers';
import { deepDiff } from './e2e_diff';

test('frontend and standalone produce identical session artefacts', async ({ browser }) => {
  const reactArtefacts = await runCanonicalSession(browser, 'http://localhost:5173');
  const standaloneArtefacts = await runCanonicalSession(browser, 'file:///.../standalone_interface.html');

  // Drop noise (timestamps, UUIDs, durations) before comparing.
  const fe = normalise(reactArtefacts);
  const sa = normalise(standaloneArtefacts);

  expect(deepDiff(fe.eventSequence, sa.eventSequence)).toEqual([]);
  expect(deepDiff(fe.detailsKeysPerEvent, sa.detailsKeysPerEvent)).toEqual([]);
  expect(deepDiff(fe.sessionShape, sa.sessionShape)).toEqual([]);
});
```

### Why Layer 3 is deferred

- **Cost**: needs the backend + pypowsybl + a fixture grid. Not every
  CI environment has that wired.
- **Flakiness budget**: NAD regeneration on large grids is ~5-6 s
  per call; with ~12 gestures per run and two UIs, wall-clock is
  ~2 minutes per PR — too slow for per-commit gating.
- **Maintenance**: Playwright specs drift faster than Python scripts
  as UI selectors change.

The recommended path is to gate Layers 1 + 2 per-PR and run Layer 3
nightly or behind an `e2e` label. A Playwright spec is the right
long-term home; in the short term, Layer 1 + 2 catch the most
common regression classes (schema drift, silent save/restore
asymmetries) with no runtime cost.
