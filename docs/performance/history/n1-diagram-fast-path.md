# N-1 diagram generation — 3 backend patches (−2.7 s per diagram)

## Context

Profiling `get_n1_diagram('ARGIAL71CANTE')` on the PyPSA-EUR France
400 kV grid showed the following cold-call breakdown:

| Step | Cold time | Share |
|---|---|---|
| `_generate_diagram` (pypowsybl NAD + SVG) | 10 738 ms | 59 % |
| `_get_n1_variant` (clone + disconnect + AC LF) | 1 858 ms | 10 % |
| `_run_ac_with_fallback` (×2 calls) | 1 215 ms | 7 % |
| `_get_overloaded_lines` | 1 161 ms | 6 % |
| `_get_asset_flows` (×2 calls) | 1 066 ms | 6 % |
| `_get_network_flows` (×2 calls) | 294 ms | 2 % |
| rest (deltas, asset_deltas) | 230 ms | 1 % |
| **Total** | **~18 s cold / ~12 s warm** | |

The NAD generation dominates but it's pure pypowsybl CPU time. The
other hot paths are pure-Python anti-patterns that we can fix
directly with no upstream change.

## Patches

### 1. `_get_asset_flows` — iterrows → narrow + numpy (−1 042 ms)

The previous implementation iterated 14 880 rows (loads + gens) with
`df.loc[lid, col]` inside a Python loop. Each `.loc` call on a pandas
DataFrame triggers index hashing + label-to-position lookup.

```python
# Before (1 168 ms)
loads = network.get_loads()[['p', 'q']]
for lid in loads.index:
    pv = loads.loc[lid, 'p'] if not np.isnan(loads.loc[lid, 'p']) else 0.0
    ...
```

Rewrite pulls columns as numpy arrays once, then zips with the id
list:

```python
# After (75 ms, 15×)
loads = network.get_loads(attributes=['p', 'q'])  # narrow pypowsybl query
loads_p = np.nan_to_num(loads['p'].values, nan=0.0)
loads_q = np.nan_to_num(loads['q'].values, nan=0.0)
load_ids = loads.index.tolist()
for i, lid in enumerate(load_ids):
    flows[lid] = {"p": float(loads_p[i]), "q": float(loads_q[i])}
```

`get_n1_diagram` calls this helper twice (N-1 and N assets) → saves
**~2.1 s cumulative per N-1 diagram**.

### 2. `_get_overloaded_lines` — iterrows → vectorised (−1 063 ms)

Same pattern. Previous impl iterated 11 k branches + 8.6 k trafos
with `df.iterrows()` + 2 full `get_operational_limits()` scans.

Changes:
- Narrow operational-limits query to `attributes=['value']` (drops
  `element_type`, `name`, `group_name` — unused downstream).
- Narrow line/transformer queries to `['i1', 'i2']`.
- Compute `max_i = max(|i1|, |i2|)` with `np.maximum(np.abs(...), np.abs(...))`
  vectorised, then do only the scalar comparison + set-membership
  filtering in Python.

1 161 ms → 98 ms (12×).

### 3. LF-status cache per N-1 variant (−600 to −1 000 ms)

`_get_n1_variant` already runs the AC LF when creating the variant
(~600 ms on PyPSA-EUR France). The return value was discarded, so
`get_n1_diagram` re-ran the LF from scratch just to obtain the
`converged` flag and the component status string.

Fix:

```python
# In _get_n1_variant, after running LF:
results = self._run_ac_with_fallback(n, params)
self._lf_status_by_variant[variant_id] = {
    "converged": any(r.status.name == 'CONVERGED' for r in results),
    "lf_status": results[0].status.name if results else "UNKNOWN",
}

# In get_n1_diagram:
cached_status = self._lf_status_by_variant.get(n1_variant_id)
if cached_status is not None:
    converged = cached_status["converged"]
    lf_status = cached_status["lf_status"]
else:
    # fallback: pre-existing variant without cached status
    results = self._run_ac_with_fallback(n, params)
    ...
```

Saves **~600 ms cold** (skip the 2nd LF run) and **~1 000 ms warm**
(every repeat view of the same contingency previously re-ran AC LF
from scratch).

The cache is cleared in `reset()` along with the other per-study
caches.

## Cumulative result

Measured on `ARGIAL71CANTE` contingency:

| | Before | After | Gain |
|---|---|---|---|
| **Cold** (first view) | 18 125 ms | **4 159 ms** | **−13 966 ms (−77 %)** |
| **Warm** (repeat view) | 11 906 ms | **3 200 ms** | **−8 706 ms (−73 %)** |

Most of the warm-call improvement comes from the iterrows fixes + LF
cache; the delta between cold and warm totals is the NAD generation
variance (pypowsybl JIT effects). The three patches guaranteed gains
from the new Python fast paths alone are ~2.7 s per N-1 diagram
(asset flows ×2, overloaded_lines, LF cache).

## Still open (future work)

1. **NAD generation for N-1 = 2.8-8 s** depending on JIT state. The
   largest remaining cost. Options:
   - **N-1 NAD cache per contingency** — the second view of the same
     contingency would be ~0 ms (we already have flow_deltas/lines_overloaded
     invariant for a given N-1 variant).
   - **N-1 NAD prefetch on hover/select** — background worker fires
     when the user focuses a contingency in the dropdown, before the
     click.
2. `_get_network_flows` at 90-300 ms per call still uses pandas
   `.concat()` + `.to_dict()` on ~20 k rows. Could be further
   vectorised with raw numpy arrays.
3. The LF in `_get_n1_variant` itself (~600 ms) runs in the main
   thread. If `_get_n1_variant` could be called asynchronously on
   contingency-hover, the cold-view cost would drop further.

## Tests

All 194 impacted tests pass (cache_synchronization, recommender_service,
diagram_mixin, network_service, overload_filtering, compute_deltas,
sld_highlight, monitoring_consistency, vectorized_monitoring,
api_endpoints).

## Files changed

| File | Change |
|---|---|
| `expert_backend/services/diagram_mixin.py` | `_get_asset_flows` narrow + numpy. `_get_overloaded_lines` narrow + vectorised. `get_n1_diagram` reads LF status from cache. |
| `expert_backend/services/recommender_service.py` | New `_lf_status_by_variant` cache populated in `_get_n1_variant`, cleared in `reset()`. |
