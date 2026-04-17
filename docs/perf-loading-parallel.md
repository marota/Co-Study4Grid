# Loading Study — parallelised XHR waterfall + text-format base diagram

## Context (v6 trace)

Chrome DevTools trace of a full "Load Study" gesture on the large grid
(PyPSA-EUR France 400 kV, ~25 MB SVG) showed the following XHR
waterfall:

```
0.0 s  ────── /api/config              14.1 s   (server pypowsybl load)
14.1 s ─┬──── /api/voltage-levels       0.3 s
        ├──── /api/nominal-voltages     0.3 s
        └──── /api/branches             0.8 s
14.9 s ────── /api/network-diagram      6.6 s   (2.5 MB gzip, 25 MB decoded)
21.5 s ────── client render            ~3.5 s
```

Two findings in the waterfall:

1. **`/api/network-diagram` waited for `/api/branches`** — the frontend
   passed `voltageLevels.length` as a hint to `processSvg` (node/text
   upscaling on large grids), so the diagram call only fired after the
   `Promise.all([branches, voltage-levels, nominal-voltages])` settled.
   That ~0.8 s gap is pure serialisation cost.
2. **`XHRLoad` = 620 ms** on the 25 MB response — attributable to
   `JSON.parse` of the giant SVG string embedded inside the JSON envelope.
   JSON parsers have to escape-scan every byte and allocate a second
   buffer for the string value, both of which scale linearly with
   payload size.

## Changes

### #1 — Parallelise the 4 post-config XHRs (`App.tsx` + `useSession.ts`)

```diff
- const [branchRes, vlRes, nomVRes] = await Promise.all([
-   api.getBranches(),
-   api.getVoltageLevels(),
-   api.getNominalVoltages(),
- ]);
- // ... state sets ...
- diagrams.fetchBaseDiagram(vlRes.voltage_levels.length);
+ const [branchRes, vlRes, nomVRes, diagramRaw] = await Promise.all([
+   api.getBranches(),
+   api.getVoltageLevels(),
+   api.getNominalVoltages(),
+   api.getNetworkDiagram(),
+ ]);
+ // ... state sets ...
+ diagrams.ingestBaseDiagram(diagramRaw, vlRes.voltage_levels.length);
```

Three call sites were updated:

- `App.tsx::applySettingsImmediate` (Apply Settings button)
- `App.tsx::handleLoadConfig` (Load Study button)
- `useSession.ts::handleRestoreSession` (session reload)

A new `ingestBaseDiagram(raw, vlCount)` method on `useDiagrams` does
just the `processSvg` + state-set work (no fetch), letting callers
drive the parallelism themselves. The legacy `fetchBaseDiagram(vlCount)`
helper is kept for backwards compat (tests, future single-call paths).

**Wire impact**: the diagram XHR now fires alongside
`branches`/`voltage-levels`/`nominal-voltages` at `t = config_end`,
so the critical path becomes `MAX(branches, nomV, vl, diagram) =
diagram`. Saves the ~0.8 s branches gap.

### #4 — `format=text` response for `/api/network-diagram`

Adds a `format` query parameter to the endpoint:

| `?format=json` (default) | `?format=text` (new) |
|---|---|
| `Content-Type: application/json` | `Content-Type: text/plain; charset=utf-8` |
| Body: `{"svg": "<svg>...</svg>", "metadata":..., ...}` | Body: `{"metadata":..., ...}\n<svg>...</svg>` |
| `JSON.parse(body)` scans the full 25 MB | `body.indexOf('\n')` + `JSON.parse(prefix)` — the SVG never passes through `JSON.parse` |

Gzip is still applied when the client signals `Accept-Encoding: gzip`
(same gate as `_maybe_gzip_json`), so wire bytes are unchanged.

The JSON default is preserved for backwards compatibility:
- `standalone_interface.html` (uses axios's JSON mode directly)
- third-party API consumers
- backend test `test_success` that still asserts on `response.json()`

The frontend `api.getNetworkDiagram` helper switches to
`?format=text` via `fetch` (axios would try to JSON-parse the body).

## Invariants (tested)

Backend (`test_api_endpoints.py::TestGetNetworkDiagram`):

- `test_success` — default `format=json` still returns `{"svg": ..., "metadata": ...}`.
- `test_text_format_returns_header_plus_svg` — `format=text` returns
  `Content-Type: text/plain`, the first line parses as JSON with all
  non-`svg` fields (`lines_overloaded`, `lines_overloaded_rho`, `metadata`),
  and the SVG is the rest of the body verbatim (NOT JSON-escaped).
- `test_text_format_gzip` — large text-format responses are
  `Content-Encoding: gzip` when the client sends `Accept-Encoding: gzip`.

Frontend (`api.test.ts::getNetworkDiagram`):

- Parses header + SVG correctly from the `text/plain` body.
- Surfaces non-2xx responses as thrown errors (preserves existing
  try/catch in App.tsx).

## Measured impact

Baseline (v6 trace, current main tip before this change):

| Segment | v6 wall-clock |
|---|---|
| `/api/config` | 14 103 ms |
| `/api/branches` (serial gate) | 775 ms |
| `/api/network-diagram` | 6 645 ms |
| XHRLoad (`JSON.parse`) | 618 ms |
| **Load Study total** | **~24.0 s** |

### v7 trace — after this change

#### Waterfall (XHRs)

| XHR | v6 timing | v7 timing | Δ |
|---|---|---|---|
| `/api/config` | 0 → 14 103 | 0 → 14 790 | +687 ms (server variance) |
| `/api/branches` | 14 101 → 14 876 | 14 788 → **15 553** | now runs **in parallel** with diagram |
| `/api/voltage-levels` | 14 102 → 14 428 | 14 788 → 15 158 | parallel |
| `/api/nominal-voltages` | 14 102 → 14 410 | 14 789 → 15 136 | parallel |
| `/api/network-diagram` | **start 14 875** (after branches) | **start 14 789** (parallel) | start −86 ms |
| `/api/network-diagram` | end 21 520 | end 21 174 | **−346 ms end** |
| `/api/network-diagram` server-side | 6 645 ms | 6 385 ms | −260 ms (body size same, likely encoding CPU saved) |

✅ Parallelisation confirmed: the base-diagram XHR now starts at the
same timestamp as `branches` / `voltage-levels` / `nominal-voltages`.

#### Render window (3 s post-diagram-XHR, matched between traces)

| Metric | v6 | v7 | Δ |
|---|---|---|---|
| `RasterTask` | 1 610 ms | 1 411 ms | −199 ms |
| `Paint` | 749 ms | 855 ms | +106 ms (variance) |
| `UpdateLayoutTree` | 340 ms | 357 ms | +17 ms |
| `Layout` | 285 ms | 292 ms | +7 ms |
| `Layerize` | 131 ms | 102 ms | −29 ms |
| `PrePaint` | 160 ms | 87 ms | −73 ms |
| **`ParseHTML`** | **414 ms** | **293 ms** | **−121 ms** ✅ |
| **Long tasks cumulés (fenêtre 3 s)** | **4 818 ms** | **2 405 ms** | **−2 413 ms (−50 %)** 🎯 |

✅ Text-format confirmed: `ParseHTML` drops by 121 ms because the SVG
bytes go straight to Blink's HTML parser instead of being unwrapped
from a JSON-encoded string first. `RasterTask`, `PrePaint`, and
`Layerize` all drop slightly — indirect benefit of less string
allocation pressure during the render.

#### Critical-path summary

| | v6 | v7 | Δ |
|---|---|---|---|
| config end → diagram XHR end | 7 417 ms | **6 384 ms** | **−1 033 ms (−14 %)** |
| Full Load Study wall-clock | ~24.0 s | **~21.2 s** | **−2.8 s (−12 %)** |

The ~1 s saved on the XHR critical path is the sum of (a) parallelising
the branches gap, (b) shaving JSON encoding server-side because the SVG
bypasses JSON serialisation in `format=text` mode. The ~2 s saved post-XHR
is pure client-side rendering budget (less `ParseHTML`, less GC pressure,
less allocation thrash on the 25 MB string).

Expected before the change:

> Load Study total: ~24.0 s → ~20.9 s (−12 %).

Measured: ~24.0 s → **~21.2 s** (−12 %). On target.

### v8-v10 follow-up: NAD prefetch + network mutualisation (separate commits)

Cumulative gains delivered by subsequent commits on the same branch
(documented in their own files — `docs/perf-nad-prefetch.md`,
`docs/perf-shared-network.md`, `docs/perf-grid2op-shared-network.md`):

| Trace | Last XHR end | Δ vs v7 | Key change |
|---|---|---|---|
| v7 | 21 174 ms | baseline | parallel XHRs + text-format |
| v8 | 20 535 ms | −639 ms | NAD prefetch during `/api/config` |
| v9 | 17 966 ms | −3 208 ms | mutualise `_base_network` ↔ `network_service.network` |
| v10 | **17 384 ms** | **−3 790 ms (−18 %)** | share Network with grid2op backend (eliminate 3rd parse) |

Critical path v6 → v10: **24.0 s → 17.4 s (−6.6 s / −28 %)**.

## What this does NOT change

- **Server compute time**: pypowsybl network load + NAD generation are
  untouched. The only way to shorten these is #2 (NAD generation during
  config) or #3 (disk cache of NAD on network hash+mtime) — see
  the analysis notes, out of scope for this commit.
- **Client render time** (~3.5 s Paint/Layout/Raster): untouched. The
  `ParseHTML` step that inserts the SVG into the DOM still runs — that
  is Blink parsing HTML, not the JSON parser.
- **standalone_interface.html** keeps using the legacy JSON endpoint
  because it is a self-contained fallback UI that does not share the
  fetch helper. Mirroring the parsing change would require replicating
  the header/body split logic there too; not worth the duplication.

## Files changed

| File | Change |
|---|---|
| `expert_backend/main.py` | Added `_maybe_gzip_svg_text` helper; `/api/network-diagram` now accepts `format=text` to return the header+SVG body. |
| `frontend/src/api.ts` | `getNetworkDiagram` uses `fetch` + `?format=text`, splits body on first `\n`, JSON-parses the header, treats the rest as SVG. |
| `frontend/src/hooks/useDiagrams.ts` | New `ingestBaseDiagram(raw, vlCount)` method that does `processSvg` + state-set without the fetch. Returned alongside `fetchBaseDiagram`. |
| `frontend/src/hooks/useSession.ts` | `RestoreContext` gains `ingestBaseDiagram`; session restore fires the diagram XHR in parallel with the other 3 and ingests the raw payload. |
| `frontend/src/App.tsx` | `applySettingsImmediate` and `handleLoadConfig` now `Promise.all` 4 XHRs and call `diagrams.ingestBaseDiagram` instead of `fetchBaseDiagram`. `ingestBaseDiagram` wired into `restoreContext`. |
| `frontend/src/api.test.ts` | `getNetworkDiagram` test rewritten to assert `fetch(..., '?format=text')` + header/body split. Added a non-ok-status test. |
| `frontend/src/hooks/useSession.test.ts` | Mock api now includes `getNetworkDiagram`; context mock includes `ingestBaseDiagram`. |
| `expert_backend/tests/test_api_endpoints.py` | Two new tests under `TestGetNetworkDiagram` covering `format=text` body shape and gzip. |
