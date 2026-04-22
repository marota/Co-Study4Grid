# Per-endpoint gzip on large SVG responses (Step 2)

## Context

After step 1 (`docs/performance/history/svg-tab-unmount.md`), the remaining floor on the
manual-action / N-1 paths is dominated by:

1. The server-side pypowsybl load-flow + NAD generation (unchanged here).
2. **Transferring ~28 MB of JSON-wrapped SVG** per diagram endpoint, entirely
   uncompressed — the trace headers showed
   `content-length: 28 430 383`, `content-encoding: none` on
   `/api/n1-diagram`.

SVG / JSON compresses ~10× with gzip (deeply repetitive XML namespace
declarations, path data, style strings). Enabling compression on these
endpoints alone removes ~25 MB of wire transfer per diagram call.

## Why not `GZipMiddleware` (again)

There was a previous attempt to enable compression globally:

```
commit 8c15de7  perf: fix NaN rendering and add gzip compression for large SVGs
commit 26bc49d  perf: fix overflow graph rendering delay and standalone UI tab switching
                — rolled back `app.add_middleware(GZipMiddleware, ...)`
```

The rollback commit's title tells the story:
**"fix overflow graph rendering delay"**. Starlette's `GZipMiddleware`
wraps every response, including the `StreamingResponse` returned by
`/api/run-analysis(-step2)`. Those endpoints emit NDJSON events one per
line, and the frontend relies on receiving the first `{"type":"pdf",...}`
event **before** the full `{"type":"result",...}` one so it can render the
Overflow PDF while the action enrichment finishes streaming. With
`GZipMiddleware` enabled, event lines were buffered inside the deflate
window until a gzip flush — the PDF event no longer arrived early, and
the "Overflow graph" tab appeared to hang until the whole analysis ended.
Additionally, the standalone UI's own NDJSON stream consumer was broken
by the same buffering.

Scoping compression to individual non-streaming endpoints sidesteps that.
The global middleware import is left in place (dead code for now), but
the middleware is not registered.

## What ships in this change

A small helper in `expert_backend/main.py`:

```python
_GZIP_MIN_BYTES = 10_000
_GZIP_LEVEL = 5

def _maybe_gzip_json(payload, request: Request) -> Response:
    data = jsonable_encoder(payload)
    body = json_module.dumps(data, separators=(",", ":"),
                             ensure_ascii=False).encode("utf-8")
    accept = request.headers.get("accept-encoding", "")
    if len(body) < _GZIP_MIN_BYTES or "gzip" not in accept.lower():
        return Response(content=body, media_type="application/json",
                        headers={"Vary": "Accept-Encoding"})
    compressed = gzip.compress(body, compresslevel=_GZIP_LEVEL)
    return Response(content=compressed, media_type="application/json",
                    headers={"Content-Encoding": "gzip",
                             "Vary": "Accept-Encoding"})
```

Design choices:

- **`Accept-Encoding`-aware** — if the client doesn't send `gzip` the
  helper returns plain JSON. Existing TestClient-based integration tests
  don't send `Accept-Encoding: gzip` by default, so they exercise the
  unchanged wire format. Real browsers always send gzip, so production
  hits the fast path.
- **`minimum_size = 10 kB`** — compression is a pure cost for small
  payloads (a few hundred bytes of config JSON); we only pay it when
  it pays back.
- **`compresslevel = 5`** — on the 28 MB N-1 payload this is ~same ratio
  as level 9 but ~3× faster on the server. Measured locally, compressing
  a representative French 400 kV N-1 diagram: 28 MB → ~2.5 MB in ~120 ms
  at level 5 vs ~370 ms at level 9.
- **`Vary: Accept-Encoding`** — correct for any caching layer (proxies,
  CDNs) so they don't serve a gzipped body to an identity-only client or
  vice-versa.

## Endpoints wrapped

All three large-SVG endpoints from the traces, plus the related SLD /
focused / actions endpoints that share the same payload shape:

| Endpoint | Purpose | Typical decoded size |
|---|---|---|
| `GET  /api/network-diagram` | N-state NAD | ~24 MB |
| `POST /api/n1-diagram` | N-1 NAD | ~28 MB |
| `POST /api/action-variant-diagram` | post-action NAD | ~27 MB |
| `POST /api/focused-diagram` | VL-scoped NAD | ~200–2000 kB |
| `POST /api/action-variant-focused-diagram` | VL-scoped post-action NAD | ~200–2000 kB |
| `POST /api/n-sld` | N-state SLD | ~50–300 kB |
| `POST /api/n1-sld` | N-1 SLD | ~50–300 kB |
| `POST /api/action-variant-sld` | post-action SLD | ~50–300 kB |
| `GET  /api/actions` | action-id + description list | ~2.7 MB |

Each endpoint's handler gained an `http_request: Request` parameter and
returns `_maybe_gzip_json(payload, http_request)` instead of the bare
dict. No payload shape changes.

## Endpoints intentionally NOT wrapped

- **`POST /api/run-analysis`** and **`POST /api/run-analysis-step2`** —
  these return `StreamingResponse(application/x-ndjson)` and MUST keep
  flushing one event per line. They are left on FastAPI's default
  response path; the helper is only invoked from non-streaming endpoints.
- **`/results/pdf/*`** (PDF download via `StaticFiles`) — PDFs are
  already compressed internally; gzipping them is pure CPU waste.
- Small JSON endpoints (config, branches, voltage levels, pick-path,
  etc.) — they never cross the 10 kB threshold, so even if wrapped they
  wouldn't trigger compression. Leaving them on FastAPI's default flow
  keeps the diff surgical.

## Tests

A new `TestDiagramGzipCompression` class in
`expert_backend/tests/test_api_endpoints.py` locks in the behaviour:

- gzip-wrapped path returns `Content-Encoding: gzip` on the three big
  endpoints when the client sends `Accept-Encoding: gzip`.
- identity path returns no `Content-Encoding: gzip` when the client
  advertises `Accept-Encoding: identity`.
- small payloads (below `_GZIP_MIN_BYTES`) are never gzipped even when
  gzip is accepted.
- **`/api/run-analysis-step2`** stays on `application/x-ndjson` with no
  `Content-Encoding: gzip` even when the client asks for gzip, and its
  two NDJSON events are delivered in order (pdf first, result second).

This last test is the regression guard against the prior
global-middleware failure mode.

## Measured impact (v3 traces)

Same PyPSA-EUR France 400 kV scenario / same contingency / same manual
action as the earlier traces. All numbers are on-wire or main-thread on
the client.

### Compression ratios observed

| Endpoint | v1/v2 decoded | v3 encoded | Ratio | `Content-Encoding` |
|---|---|---|---|---|
| `/api/network-diagram` | 24 836 KB | **2 555 KB** | **9.7 ×** | `gzip` |
| `/api/n1-diagram` | 27 764 KB | **2 789 KB** | **10.0 ×** | `gzip` |
| `/api/action-variant-diagram` | 27 764 KB | **2 790 KB** | **10.0 ×** | `gzip` |
| `/api/actions` | 2 756 KB | **349 KB** | **7.9 ×** | `gzip` |

### Load study (v2 → v3 delta is attributable to step 2 alone)

| Metric | v2 | v3 | Δ |
|---|---|---|---|
| Long tasks total | 7 138 ms | **6 125 ms** | **-14 %** |
| Max Layout | 288 ms | 260 ms | -10 % |
| Paint total | 1 670 ms | **1 139 ms** | **-32 %** |
| Commit max | 43 ms | 36 ms | -16 % |
| XHR `/api/network-diagram` | 7 167 ms | 7 451 ms | +4 % (server compress CPU) |

Step 2 is the **first** change to improve load study — step 1 couldn't
because only one SVG is ever loaded at that point.

### N-1 contingency (v2 → v3)

| Metric | v2 | v3 | Δ |
|---|---|---|---|
| Long tasks total | 11 591 ms | **9 404 ms** | **-19 % (-2.2 s)** |
| Max Layout (`totalObjects`) | 248 ms (204 k) | 303 ms (204 k) | stable |
| Paint total | 4 176 ms | **2 588 ms** | **-38 %** |
| **Commit max** | **1 562 ms** | **46 ms** | **-97 %** |
| XHR `/api/n1-diagram` | 6 337 ms | 6 528 ms | +3 % (noise) |

The 1.56 s Commit regression from step 1 is **gone**. Counter-intuitive
at first glance (step 2 is a server change), but the explanation is
straightforward: the one-time layer-promotion Commit in v2 was paying
the cost of handling a 27 MB JSON string in memory at the exact moment
the browser also had to composite a brand-new 200 k-node layer. With
the body compressed to 2.8 MB on the wire, peak memory pressure during
that Commit dropped enough that the compositor no longer stalls.

### Manual action simulation (v2 → v3)

| Metric | v2 | v3 | Δ |
|---|---|---|---|
| Long tasks total | 16 010 ms | **13 957 ms** | **-13 % (-2.0 s)** |
| Max Layout (`totalObjects`) | 233 ms (204 k) | 239 ms (204 k) | stable |
| Paint total | 7 917 ms | **5 335 ms** | **-33 %** |
| Commit max | 72 ms | 111 ms | +54 ms (within noise) |
| XHR `/api/action-variant-diagram` | 5 210 ms | **4 933 ms** | **-5 %** |
| XHR `/api/actions` | 353 ms | 379 ms | stable |

### Cumulative across v1 → v3

| Scenario | v1 baseline | v3 (step 1+2) | Absolute saved | % |
|---|---|---|---|---|
| Load study | 6 782 ms | 6 125 ms | **-0.7 s** | -10 % |
| N-1 contingency | 15 984 ms | 9 404 ms | **-6.6 s** | **-41 %** |
| Manual action | 24 938 ms | 13 957 ms | **-10.9 s** | **-44 %** |

Manual-action — the most frequent interaction and previously the worst
offender — is now ~44 % faster on the main thread.

### Verified invariants

- `Content-Encoding: gzip` on all 4 targeted endpoints.
- `/api/run-analysis-step2` still serves `application/x-ndjson` with
  no `Content-Encoding: gzip`, and the `{"type":"pdf"}` event still
  arrives ahead of the `{"type":"result"}` event. The rollback-cause
  from commit `26bc49d` does not recur.

## Remaining ceiling

Paint is still ~5.3 s on action, ~2.6 s on N-1. This is bounded by the
~200 k-node SVG that's in the active tab.

## Why "step 4 — server-side SVG slimming" was attempted, measured, and reverted

An attempt was made to attack that floor by rewriting the SVG string
before it was sent:

1. **Fold the ~10 k inline `style="text-anchor:end"` attributes** into a
   single `.nad-te` CSS class rule injected into the existing `<style>`
   block. Tried in commit `3cceab6`. v4 traces measured the result:

   | Scenario | Paint total v3 | Paint total v4 | Δ |
   |---|---|---|---|
   | N-1 | 2 588 ms | 4 140 ms | **+60 %** |
   | Manual action | 5 335 ms | 10 201 ms | **+91 %** |

   Root cause: replacing 10 000+ local inline styles with a single
   CSS-class rule forced Blink into full selector matching — every
   text element tested against every rule in the `<style>` block on
   every style recalc. That cost (scaling as `elements × rules`)
   dominated Paint. The wire-byte win was ~10 KB on a 2.8 MB gzipped
   payload — dwarfed by the browser-side cost. Reverted in `ec51ecd`.

2. **Strip trailing zeros from decimal fractions** (`321345.0` → `321345`).
   Kept after the fold revert. v5 traces measured:

   | Scenario | Paint total v3 | Paint total v5 | Δ |
   |---|---|---|---|
   | N-1 | 2 588 ms | 3 937 ms | +52 % |
   | Manual action | 5 335 ms | 9 382 ms | +76 % |
   | Load study | 1 139 ms | 1 602 ms | +41 % |

   v5 was modestly better than v4 but did NOT recover to v3 levels.
   Even loading — where neither slim transform has any meaningful effect
   — was 41 % worse on Paint. This ruled out a clean causal link, but
   also meant the step couldn't be defended as a measured improvement.

   Wire-byte win: **27 KB out of 2.8 MB gzipped (< 1 %)**. Not worth
   holding onto given the measurement noise / possible unmeasured cost.
   Reverted after the v5 traces confirmed it wasn't pulling its weight.

### Lessons learned

- **Always measure on the full client-side pipeline, not just payload
  size**. The fold's byte savings were real; the Paint cost was only
  visible after profiling. The trailing-zero strip had tiny byte savings
  and no clear client-side benefit either.
- **Gzip already captures most of the repetition** — any server-side
  rewrite that targets "repeated patterns" is competing with deflate on
  a level where deflate usually wins.
- **Chrome Perf traces have meaningful run-to-run variance** (~10-30 %
  on Paint totals). Three-way diffs (v1 baseline / vX intermediate /
  latest) are more reliable than single before/after snapshots.

## What shipped on this branch

| Step | What | Measured impact |
|---|---|---|
| 1 | `display:none` inactive SVG tabs (`274ae09`) | N-1 -27 %, Action -36 % long-task time |
| 2 | Per-endpoint gzip on 9 SVG/JSON endpoints (`01f0587`) | Load study -14 %, N-1 -19 %, Action -13 % additional long-task time |
| 4 | Server-side SVG slimming — **reverted** | Not shipped. See section above for why. |

**Cumulative measured effect (v1 → v3, steps 1+2 only)**:

| Scenario | Long tasks v1 | Long tasks v3 | Δ |
|---|---|---|---|
| Load study | 6 782 ms | 6 125 ms | **-10 %** |
| N-1 contingency | 15 984 ms | 9 404 ms | **-41 %** |
| Manual action | 24 938 ms | 13 957 ms | **-44 %** |

The manual-action path, previously the worst offender, is the biggest
winner at ~44 % faster main-thread work. These are the numbers the
branch currently delivers.
