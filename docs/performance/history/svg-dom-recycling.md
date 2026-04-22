# SVG DOM recycling — skip the NAD regeneration for N-1 and Action tabs

## Context

The pypowsybl NAD SVG for the `bare_env_20240828T0100Z` reference
grid weighs ~12 MB (the PyPSA-EUR France 400 kV grid reaches
20–28 MB). Every time the user selects a new contingency or switches
to a different action card the backend calls
`get_network_area_diagram(...)` from scratch and ships the whole SVG
back, even though:

- The network layout is pinned via `fixed_positions` from
  `grid_layout.json` — **node coordinates are byte-identical** across
  N, N-1 and action variants.
- The SVG element IDs are deterministic from equipment IDs (`nad-l-*`,
  `nad-t-*`, `nad-vl-*`, `nad-ei-*`) — **every non-disconnected edge
  is at the same DOM position** across the three states.
- N → N-1 disconnects exactly one line and updates flow labels.
- N-1 → Action (non-topology-changing: PST tap, redispatch) only
  updates flow labels.

Two new SVG-less endpoints capture just what actually changes. The
frontend clones the already-parsed N-state SVGSVGElement, marks the
contingency line as dashed (matching native NAD), overwrites the
edge-info flow labels with the target-state absolute values, and
re-uses the metadata index — no parse, no re-layout, no re-transfer
of the ~12 MB SVG body.

## Backend

Two methods in `expert_backend/services/diagram_mixin.py` that skip
the `_generate_diagram(...)` call entirely:

- `get_n1_diagram_patch(disconnected_element)` → always `patchable:true`.
- `get_action_variant_diagram_patch(action_id)` →
  - `patchable: true` with `vl_subtrees` populated when an action
    changes bus counts at one or more voltage levels (node merging,
    node splitting, coupling toggles). For each affected VL the
    backend runs a focused
    `get_network_area_diagram(voltage_level_ids=[vl], depth=1)`
    against the action variant — rendered with the same
    `fixed_positions` — and extracts both:
      * the `<g id="nad-vl-*">` subtree for the VL's redrawn
        concentric multi-circle node, and
      * a `<g id="nad-l-*">` / `<g id="nad-t-*">` subtree for every
        branch terminating at that VL, so the branch's piercing
        geometry (which internal bus it connects to, and where it
        crosses outer rings) matches the new bus count.
    Each fragment carries its sub-diagram svgId so the frontend can
    rewrite to the main-diagram svgId on splice (pypowsybl assigns
    positional svgIds per diagram — `nad-vl-0` in a focused sub
    vs. `nad-vl-42` in the main NAD — so the client must rewrite to
    keep halo / delta / overload lookups working).
  - `patchable: false, reason: "vl_topology_changed"` only as a
    graceful-fallback safety net when the focused-NAD extraction
    fails or returns a partial set; the frontend then calls
    `/api/action-variant-diagram`.
  - `patchable: true` with empty `vl_subtrees` for PST / redispatch
    / disco / reco actions that don't shift bus counts.

Topology detection (pre-flows, bail-out fast) compares **bus count
per voltage level** between the action variant and the N-1 variant.
That is the exact granularity at which the pypowsybl NAD redraws a
VL node's concentric multi-circle layout: node-merging / node-splitting
/ coupling toggles shift bus counts, whereas pure line-breaker toggles
(`disco_*`, `reco_*`) don't touch bus counts at all. Using bus counts
alone keeps `disco_*` / `reco_*` patchable — they flip into / out of
the `disconnected_edges` list and render via the dashed CSS class
client-side.

All existing vectorised helpers are reused without modification:
`_get_network_flows`, `_get_asset_flows`, `_compute_deltas`,
`_compute_asset_deltas`, `_get_overloaded_lines`, plus the LF-status
cache per variant from
`docs/performance/history/n1-diagram-fast-path.md`.

HTTP surface in `expert_backend/main.py`:

| Route | Payload |
|---|---|
| `POST /api/n1-diagram-patch`             | `DiagramPatch` |
| `POST /api/action-variant-diagram-patch` | `DiagramPatch` |

Both responses go through `_maybe_gzip_json` like the full-SVG
endpoints.

## Patch payload schema

```jsonc
{
  "patchable": true,
  "contingency_id": "ARGIAL71CANTE",     // n1 patch only
  "action_id": "PST_42",                 // action patch only
  "lf_converged": true,
  "lf_status": "CONVERGED",
  "non_convergence": null,

  "disconnected_edges": ["ARGIAL71CANTE"], // rendered dashed in clone

  "absolute_flows": {                    // overwrite edgeInfo1/edgeInfo2
    "p1": { "<line_id>": 123.4, ... },
    "p2": { ... }, "q1": { ... }, "q2": { ... },
    "vl1": { ... }, "vl2": { ... }
  },

  "lines_overloaded":      ["..."],
  "lines_overloaded_rho":  [1.05, ...],
  "flow_deltas":           { "<line_id>": {"delta": ..., "category": ..., "flip_arrow": ...}, ... },
  "reactive_flow_deltas":  { ... },
  "asset_deltas":          { "<asset_id>": {"delta_p": ..., "delta_q": ..., "category": ...}, ... },

  "meta": { "base_state": "N", "elapsed_ms": 412 }
}
```

On `patchable: false`, the payload carries only `{patchable, reason,
action_id, lf_converged, lf_status, non_convergence}` — the caller
falls back to the full endpoint.

## Frontend

- `frontend/src/utils/svgPatch.ts` — two primitives:
  - `cloneBaseSvg(base)` — deep clone so the N tab stays pristine.
  - `applyPatchToClone(clone, metaIndex, patch)` — in-place mutation
    that (1) restores any prior patch backup, (2) adds
    `.nad-disconnected` to contingency edges, (3) overwrites each
    `edgeInfo1`/`edgeInfo2` text node with the target-state absolute
    flow value, backing up the original in `data-patched-flow` (a
    distinct attribute from the `data-original-text` owned by
    `applyDeltaVisuals`, so delta mode and patch mutations coexist).

- `frontend/src/types.ts` — new `DiagramPatch` type. `DiagramData.svg`
  widened to `string | SVGSVGElement` so the cloned element can flow
  through `MemoizedSvgContainer` (which already accepts both via
  `replaceChildren` / `innerHTML`).

- `frontend/src/hooks/useDiagrams.ts` — `handleActionSelect` tries
  `getActionVariantDiagramPatch` first; on `patchable:false` or
  any error, falls back to `getActionVariantDiagram`. Session reload
  skips the patch path entirely (preserves the
  `docs/features/save-results.md` contract).

- `frontend/src/App.tsx` — the N-1 fetch effect does the same for
  `getN1DiagramPatch` vs `getN1Diagram`.

- `frontend/src/App.css` — new `.nad-disconnected` rule applies
  `stroke-dasharray: 80 40` with `vector-effect: non-scaling-stroke`
  (same guard as the other `.nad-*` rules — see
  `docs/performance/rendering-optimization-plan.md`) so the dash
  stays legible at all zoom tiers.

- `frontend/src/components/ActionOverviewDiagram.tsx` — updated to
  accept a pre-parsed `SVGSVGElement` in `n1Diagram.svg` (clones it
  instead of re-parsing a string).

## Fallback matrix

| Situation | Path |
|---|---|
| Normal N-1 selection with N diagram loaded | **patch** (`/api/n1-diagram-patch`) |
| N-1 selection during session reload        | full (`/api/n1-diagram`) — preserves save/load contract |
| N-1 selection before N SVG is mounted      | full fallback |
| PST / redispatch action                    | **patch** (`/api/action-variant-diagram-patch`) |
| Line disconnect / reconnect (`disco_*` / `reco_*`) | **patch** (toggles the `nad-disconnected` class; no full fetch) |
| Node merging / splitting / coupling toggle | **patch with VL-subtree splice** — backend renders a pypowsybl-native focused NAD per affected VL, client splices each `<g id="nad-vl-*">` in |
| VL-subtree extraction error (partial or raising) | full fallback (`patchable: false, reason: "vl_topology_changed"`) |
| Patch endpoint throws                      | full fallback |

## Measured savings

Reference: `bare_env_20240828T0100Z` (~10 k branches, ~12 MB SVG),
contingency `ARGIAL71CANTE`, benchmark
`benchmarks/bench_n1_diagram_patch.py`. Warm-median of 3 runs. Raw
numbers persisted in `profiling_patch_results.json`.

| Endpoint | Cold | Warm (median) | Payload (uncompressed) |
|---|---|---|---|
| `/api/n1-diagram` (full)         | 3.01 s | 2.39 s | 27.1 MB |
| `/api/n1-diagram-patch` (new)    | 0.49 s | 0.50 s |  5.5 MB |
| **Δ**                            | **−2.52 s (−83.8 %)** | **−1.89 s (−79.1 %)** | **20.3 % of full** |

Where the savings come from:
- Skip `_generate_diagram` entirely → **~2 s** removed from the
  critical path (pypowsybl NAD + SVG serialisation).
- SVG body drops from 12.85 MB to 0 (patch has no SVG).
- Flow-delta computation + overload scan stay the same
  (already vectorised — see
  `docs/performance/history/n1-diagram-fast-path.md`).

The remaining ~500 ms warm is dominated by `_get_network_flows` and
`_get_asset_flows` (the two halves of the deltas), which are needed
for the client patch to overwrite every edge-info label. These are
already vectorised at their own bottom-line budget.

The patch payload is ~5.5 MB uncompressed because it carries the
full `absolute_flows` dicts (p1/p2/q1/q2 × ~11 k branches). Gzip
compresses this ~4–5× like the existing per-endpoint helper already
does for full diagrams; the on-wire saving is proportional.

On the client side the frontend additionally avoids:
- One `DOMParser.parseFromString` pass over the 12 MB SVG string
  (~250–500 ms on large grids).
- A full re-layout of the React-rendered container.
- Re-running `buildMetadataIndex` (the metaIndex is reused from the
  base N diagram — layout & IDs are identical).

## Rollout

Stage 1 (backend only) and Stage 2 (frontend wiring) ship together
since the frontend falls back gracefully when the patch endpoint
returns `patchable: false` or errors — no flag needed. Legacy
full-SVG endpoints stay available forever as fallback; they are
still used by:
- session reload,
- topology-changing actions,
- any future focused-diagram consumer (the `/api/focused-diagram`
  routes are dormant in the live React frontend but kept on the
  backend).

## Tests

Backend (`expert_backend/tests/test_api_endpoints.py`):
- `TestGetN1DiagramPatch` — patchable payload shape, SVG absence,
  parity of non-SVG fields with `/api/n1-diagram`.
- `TestGetActionVariantDiagramPatch` — `patchable: false` branches
  for `vl_topology_changed` (only remaining non-patchable reason);
  422 / 400 error paths. Also asserts that `disco_*` / `reco_*`
  actions return `patchable: true` with the relevant branch ID in
  (or absent from) `disconnected_edges`.

Frontend:
- `frontend/src/utils/svgPatch.test.ts` — clone isolation,
  disconnected-edge marking, absolute-flow label overwrite with
  `data-patched-flow` backup, idempotent re-application,
  `patchable: false` no-op.
- `frontend/src/hooks/useDiagrams.test.ts` — fallback-when-no-base
  path in `handleActionSelect`.

Parity guards: `scripts/check_standalone_parity.py`,
`scripts/check_session_fidelity.py`,
`scripts/check_invariants.py`, and the Playwright
`scripts/parity_e2e/e2e_parity.spec.ts` all pass unchanged.
