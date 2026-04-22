# Base-NAD prefetch during `/api/config`

## Context

After the parallelisation + text-format work (see
`docs/performance/history/loading-parallel.md`), the Load Study waterfall looked like
this on the v7 trace:

```
0.0 s    ─────── /api/config              14.8 s
14.8 s   ──────── /api/branches            0.8 s  ┐
14.8 s   ──────── /api/voltage-levels      0.4 s  ├─ parallel
14.8 s   ──────── /api/nominal-voltages    0.3 s  │
14.8 s   ──────── /api/network-diagram     6.4 s  ┘  (critical path)
21.2 s   ──────── client render           ~3.5 s
```

`/api/config` (14.8 s) does two things back-to-back on the server:

1. `network_service.load_network()` — pypowsybl loads the XIIDM file.
2. `recommender_service.update_config()`:
   - globals / action dictionary loading (1-3 s)
   - **`setup_environment_configs_pypowsybl()` (5-10 s)** — the grid2op
     environment init, which is the real time hog in `update_config`.

Then `/api/network-diagram` (6.4 s) re-enters pypowsybl for NAD
generation.

**The key observation**: the pypowsybl network is already loaded well
before `setup_environment_configs_pypowsybl()` starts, AND the NAD
code path uses its own independent pypowsybl instance (grid2op wraps
its own backend). So NAD generation can safely run **in parallel**
with the grid2op env setup.

## Change

Before the slow env-setup step at the end of `update_config`, we kick
off a background thread that computes the base NAD. By the time
`update_config` returns (and `/api/config` responds), the NAD is
already cached in memory. The subsequent `/api/network-diagram` XHR
becomes a near-instant cache hit.

### `RecommenderService`

Three new methods (`recommender_service.py`):

```python
def prefetch_base_nad_async(self):
    """Spawn a daemon thread that runs `self.get_network_diagram()`
    and stashes the result in `self._prefetched_base_nad`."""

def get_prefetched_base_nad(self, timeout=60):
    """Wait up to `timeout` for the prefetch to complete, then return
    the cached result (or re-raise its exception). Returns None when
    no prefetch was queued — caller should fall back to fresh compute."""

def _drain_pending_base_nad_prefetch(self):
    """Called from reset() to join a still-running worker so it cannot
    write stale SVG into the next study's cache."""
```

`prefetch_base_nad_async` is called once in `update_config`, **immediately
before** `setup_environment_configs_pypowsybl()`. It pre-warms
`self._base_network` on the main thread (so the worker never hits the
lazy-init race), then starts the daemon thread.

### `/api/network-diagram`

```diff
 @app.get("/api/network-diagram")
 def get_network_diagram(http_request: Request, format: str = Query("json")):
-    diagram = recommender_service.get_network_diagram()
+    diagram = recommender_service.get_prefetched_base_nad()
+    if diagram is None:
+        diagram = recommender_service.get_network_diagram()
     if format == "text":
         return _maybe_gzip_svg_text(diagram, http_request)
     return _maybe_gzip_json(diagram, http_request)
```

When `update_config` was called earlier in the process (the happy path,
every time the frontend loads a study), the prefetched result is ready
and returned immediately. External callers who hit the endpoint
without a prior `update_config` (e.g. integration scripts) fall through
to the fresh compute path — same behaviour as before.

### `reset()`

`RecommenderService.reset()` now drains any in-flight prefetch thread
before zeroing state. Without this, a dangling worker from the previous
study could finish after `reset()` and accidentally write its stale SVG
into the fresh study's cache — the user would see the wrong network.

## Thread-safety notes

- **`_base_network` lazy init**: pre-warmed in the main thread before
  spawning the worker (in `prefetch_base_nad_async`). The worker only
  sees a hot cache lookup.
- **pypowsybl variant switching** inside `_generate_diagram`
  (`n.set_working_variant(...)`) is non-atomic. We rely on the
  observation that the grid2op env setup running in parallel uses a
  **separate** pypowsybl Network instance (grid2op's pypowsybl backend
  does its own `pp.network.load()`). The two threads never touch the
  same network object.
- **Worker exceptions** are captured on the service and re-raised when
  the foreground caller invokes `get_prefetched_base_nad`. The
  foreground never sees a partial cache.
- **Cache staleness across studies**: `reset()` joins the worker with
  a 60 s timeout before zeroing state.

## Invariants (tested)

Unit tests in `test_recommender_service.py::TestPrefetchBaseNad`:

- `test_initial_state_has_no_prefetch` — a fresh service returns None
  from `get_prefetched_base_nad`.
- `test_prefetch_populates_cache_on_success` — after
  `prefetch_base_nad_async()`, `get_prefetched_base_nad()` returns the
  worker's result.
- `test_prefetch_surfaces_worker_exception` — worker exceptions are
  stored and re-raised on the foreground call.
- `test_prefetch_records_network_load_error_without_spawning_worker` —
  if `_get_base_network()` fails in the main thread, no worker is
  started; the error is recorded directly.
- `test_reset_drains_pending_prefetch_and_clears_state` — a dangling
  worker is joined before state is zeroed; the fresh service can
  start a new prefetch without leaking.
- `test_timeout_returns_none_without_raising` — a foreground call
  that exceeds `timeout` returns None (signalling 'fall back to
  fresh compute') instead of raising.

Endpoint tests in `test_api_endpoints.py::TestGetNetworkDiagram`:

- `test_uses_prefetched_nad_when_available` — the endpoint returns
  the prefetched SVG and does NOT call `get_network_diagram`.
- `test_falls_through_to_fresh_compute_on_prefetch_timeout` — when
  prefetch returns None, the endpoint calls `get_network_diagram`.
- `test_prefetched_path_supports_text_format` — `?format=text` works
  with the prefetched payload, same as fresh.

## Measured impact (expected, to be confirmed on v8 trace)

| Step | v7 wall-clock | v8 expected | Δ |
|---|---|---|---|
| `/api/config` (server) | 14 790 ms | ~14 790 ms (unchanged) | 0 |
| `/api/network-diagram` (server) | 6 385 ms | **~100-500 ms** (cache hit) | **−5.9 to −6.3 s** |
| `/api/network-diagram` (wire gzip) | 2.5 MB | 2.5 MB (unchanged) | 0 |
| Load Study critical path | ~21.2 s | **~15 s** | **−6 s (−28 %)** |

The overlap works because `setup_environment_configs_pypowsybl()` takes
longer (5-10 s) than NAD generation (~6 s), so the NAD is done *before*
`update_config` returns. On a very small grid where env setup is faster
than NAD, the prefetch would still be mid-flight when the endpoint is
hit — the endpoint then waits for it to finish, which is the same
wall-clock as before (no regression).

## What this does NOT change

- Pypowsybl compute time: unchanged. We're not making NAD generation
  faster, we're just overlapping it with work that was already going
  to run.
- Fresh-compute fallback: still works when `update_config` was never
  called (tests, external callers).
- `standalone_interface.html`: unchanged. It still uses the default
  `format=json` path, which hits the same prefetched cache through
  the same endpoint.
- Frontend: unchanged. The optimisation is entirely backend-internal;
  the frontend continues to call `/api/network-diagram?format=text`
  exactly as before and gets an instant response.

## Files changed

| File | Change |
|---|---|
| `expert_backend/services/recommender_service.py` | New `_prefetched_base_nad*` fields; `prefetch_base_nad_async`, `get_prefetched_base_nad`, `_drain_pending_base_nad_prefetch` methods; `update_config` kicks off the prefetch before the env-setup step; `reset` drains the worker. |
| `expert_backend/main.py` | `/api/network-diagram` consults the prefetch first; falls through to fresh compute on None. |
| `expert_backend/tests/test_recommender_service.py` | New `TestPrefetchBaseNad` class (6 tests). |
| `expert_backend/tests/test_api_endpoints.py` | `TestGetNetworkDiagram` gains 3 new tests (prefetch hit, fallback, text-format with prefetch). Existing tests updated to set `get_prefetched_base_nad.return_value = None` where relevant. |
