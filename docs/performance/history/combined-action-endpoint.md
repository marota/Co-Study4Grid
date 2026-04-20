# Combined manual-action endpoint (streamed NDJSON)

## Context

When the user clicks an action card that is NOT in the recommender's
prioritised-action list (typical scenarios: a manually-picked action, an
action from a reloaded session, a combined action built from the
`++ Combine` UI), the frontend fallback path previously fired two
**sequential** HTTP calls:

```
POST /api/simulate-manual-action   — grid2op simulate, ~3-4 s
POST /api/action-variant-diagram   — pypowsybl NAD regeneration, ~5-7 s on large grids
```

Two side-effects of this layout:

1. **One extra round-trip per click** — the UI waits for the simulation
   response to land before firing the diagram request.
2. **The sidebar action card (rho-before / rho-after / max-rho chip)
   cannot update until both calls complete.** Even though the
   simulation is a prerequisite for the diagram and NOT the diagram
   itself, the user sees the card stay "stale" for the full ~8 s.

## What shipped

A new streaming endpoint:

```
POST /api/simulate-and-variant-diagram
Content-Type: application/x-ndjson

{ "type": "metrics", <all simulate_manual_action fields> }\n
{ "type": "diagram", <all get_action_variant_diagram fields> }\n
```

On error at either step a single `{"type":"error","message":...}` event
is emitted and the stream closes.

The endpoint is a thin wrapper around the two existing service methods
— no new business logic. `simulate_manual_action` stores the resulting
observation in `RecommenderService._last_result`, which
`get_action_variant_diagram` then reads to pick the post-action variant.
The two methods are called **sequentially on the server**, so this
change does NOT save pypowsybl compute; the win is:

- **One fewer HTTP round-trip** per manual-action click (~100-500 ms
  off-box, ~10-50 ms on localhost).
- **Earlier sidebar update**: the `metrics` event is flushed to the
  wire the instant grid2op returns, so the action card's rho numbers
  appear ~5 s before the SVG does on large grids.

## Invariants (tested)

- `POST /api/simulate-and-variant-diagram` serves `application/x-ndjson`.
- It is NEVER wrapped by `_maybe_gzip_json` or a global `GZipMiddleware`
  — same reason `/api/run-analysis-step2` isn't: buffering NDJSON in
  gzip defeats the early-event delivery that is the point of the
  endpoint. A dedicated test (`test_ignores_accept_encoding_gzip`)
  confirms the response does not carry `Content-Encoding: gzip` even
  when the client sends `Accept-Encoding: gzip`.
- Events arrive in order (`metrics` first, `diagram` second). If the
  diagram step fails after the metrics step succeeds, the metrics event
  is still flushed so the UI can at least update the sidebar.
- All optional simulation parameters are forwarded: `action_content`,
  `lines_overloaded`, `target_mw`, `target_tap`, plus the `mode` field
  for the diagram step.

## Frontend integration

`api.ts` gets a new `simulateAndVariantDiagramStream` helper that
mirrors the existing `runAnalysisStep2Stream` pattern (fetch with
NDJSON response, caller reads with `TextDecoder` + `split('\n')`).

The streamed endpoint is consumed from **two** call sites:

### 1. `useDiagrams.handleActionSelect` fallback (initial commit `38614e1`)

Two-tier strategy:

1. **Fast path** — try `getActionVariantDiagram(actionId)` first. If
   the action is in `_last_result["prioritized_actions"]` (i.e. the
   recommender already computed it), this returns the diagram in a
   single call with no simulate work.
2. **Fallback** — on 4xx from the fast path, fire the new streaming
   endpoint. The metrics event updates `result.actions[actionId]`
   (rho fields, description, convergence flags, islanding info) as
   soon as simulation completes; the diagram event updates the active
   tab's SVG when the NAD is ready.

### 2. `ActionFeed` Add-action / re-simulate handlers (follow-up)

The v6 trace showed a second common entry point: the user types/picks
a manual action in the `+ Manual Selection` dropdown. Here the
original flow was:

- Add the action → `api.simulateManualAction` fires (3 s) → card shows rho
- User clicks the card → `getActionVariantDiagram` fires (5 s) → SVG shows

Two sequential user gestures, two sequential XHRs. On `ec51ecd` this
flow didn't benefit from the new combined endpoint because `useDiagrams`
only hits it in the fallback branch, and the fast path succeeded once
simulate had stored the observation.

The follow-up change wires a **diagram pre-fetch cache** in `useDiagrams`:

- `useDiagrams` exposes `primeActionDiagram(actionId, diagram, vlLength)`
  and an internal `Map<actionId, DiagramData>` ref that is cleared
  whenever `selectedBranch` changes.
- `ActionFeed` receives the primer and `voltageLevelsLength` as optional
  props. When both are wired, its three simulate-firing handlers
  (Add, target-MW re-sim, PST-tap re-sim) stream the combined endpoint
  instead of firing `simulateManualAction`:
  - `metrics` event → used as before to populate the sidebar card
  - `diagram` event → handed to the primer callback, processed with
    `processSvg`, cached
- `useDiagrams.handleActionSelect` checks the cache before its fast
  path; on hit, it paints the SVG instantly with no XHR and no server
  pypowsybl work.

Result: the click-after-add now lands on a **cache hit** if the user
waited long enough for the server diagram event to arrive. On large
grids this is ~5 s of wait after simulate completed; if the user takes
at least that long to read the card before clicking, the click is
effectively free.

The legacy single-shot `api.simulateManualAction` is **kept** as the
fallback when `onActionDiagramPrimed` is not wired (older tests and
potential other call sites). `CombinedActionsModal` still uses it
directly — combined-pair simulation is a separate UX surface with its
own modal; out of scope for this change.

## Files changed

| File | Change |
|---|---|
| `expert_backend/main.py` | New `SimulateAndVariantDiagramRequest` model + `POST /api/simulate-and-variant-diagram` endpoint (StreamingResponse). |
| `frontend/src/api.ts` | New `simulateAndVariantDiagramStream` helper. |
| `frontend/src/hooks/useDiagrams.ts` | Fallback branch in `handleActionSelect` replaced with NDJSON stream reader; new `actionDiagramCacheRef` + `primeActionDiagram` callback; `handleActionSelect` now checks cache before the fast path; cache auto-clears on `selectedBranch` change. |
| `frontend/src/hooks/useDiagrams.test.ts` | Mock api now includes `simulateAndVariantDiagramStream`. |
| `frontend/src/components/ActionFeed.tsx` | New optional props `onActionDiagramPrimed` + `voltageLevelsLength`. Three simulate-firing handlers (Add / target-MW / PST-tap) now stream the combined endpoint when the primer is wired; legacy `simulateManualAction` call kept as fallback with exact original arity. |
| `frontend/src/components/ActionFeed.test.tsx` | Two new tests: streamed path fires combined endpoint + primes cache; fallback preserved when primer not wired. |
| `frontend/src/App.tsx` | Wires `diagrams.primeActionDiagram` and `voltageLevels.length` into `<ActionFeed>`. |
| `expert_backend/tests/test_api_endpoints.py` | `TestSimulateAndVariantDiagramStream` (5 tests). |

## Measured impact

Baseline (v6 traces, current branch tip before this follow-up):

| XHR on Add → click sequence | v6 wall-clock |
|---|---|
| `/api/simulate-manual-action` | 3 387 ms |
| `/api/action-variant-diagram` | 5 515 ms |
| **Total, two XHRs sequential** | **~8.9 s** |

After the pre-fetch change (expected, not yet traced):

| User timing | Click-to-diagram wait |
|---|---|
| User clicks IMMEDIATELY after Add completes (0 ms think time) | Still ~5.5 s — stream is mid-flight, handleActionSelect falls through to fast path and a second `getActionVariantDiagram` may race the stream's diagram event (server generates twice). Functionally correct, not faster. |
| User clicks 5 s AFTER Add completes (typical pause to read card) | ~0 ms — cache hit, SVG paints instantly. |
| User never clicks the card | Wasted server work: one NAD generated for nothing. |

The middle case is the realistic operator workflow and saves the full
~5 s of post-action NAD regeneration on the click. Server compute for
the Add itself is unchanged (grid2op + pypowsybl both still run; we
just stream them in one HTTP response instead of two).

For the fallback-path (session reload, or any click where
`getActionVariantDiagram` 404's), the `38614e1` commit already saves
one round-trip + streams metrics early. The cache-priming commit is
additive: same endpoint, wider set of callers.

## What this does NOT change

- **Fast path** (action is in the prioritised list): still a single
  `getActionVariantDiagram` call. No behavioural change.
- **Server-side pypowsybl and grid2op work**: unchanged.
- **Network wire bytes**: same as the sum of the two old calls (SVG is
  still the bulk). Per-endpoint gzip on `/api/action-variant-diagram`
  compresses the SVG body today; the new streaming endpoint's diagram
  event is NOT gzipped on-wire because gzip-ing an NDJSON stream would
  defeat the early-event delivery that is the point of the change.
  That's the accepted tradeoff for this codepath.
