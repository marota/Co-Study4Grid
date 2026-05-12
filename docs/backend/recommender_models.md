# Pluggable Recommendation Models

Co-Study4Grid ships with a small registry of recommendation models and
binds them through the FastAPI backend and the React frontend. The
library-side contract (`RecommenderModel` ABC, `RecommenderInputs` /
`RecommenderOutput` DTOs, reusable reassessment phase) lives in
[`marota/expert_op4grid_recommender`](https://github.com/marota/expert_op4grid_recommender/blob/main/docs/recommender_models.md).

This document is the **app-side reference**: registry, built-in random
examples, the three-layer filter chain, backend / frontend wiring, and
the step-by-step guide for shipping a new model. See also the broader
[backend overview](README.md).

---

## 1. The registry

Lives in `expert_backend/recommenders/registry.py`. Tiny by design:

```python
from expert_backend.recommenders.registry import (
    DEFAULT_MODEL,        # "expert"
    register,             # decorator / function: add a model class
    unregister,           # remove a model by name
    build_recommender,    # instantiate by name (falls back to DEFAULT_MODEL on empty / None)
    get_model_class,      # lookup; returns None on miss
    list_models,          # JSON-ready descriptors for the UI
)
```

Three models are registered at startup (`expert_backend/recommenders/__init__.py`):

| name             | label                              | requires_overflow_graph | params_spec                                                              |
|------------------|------------------------------------|-------------------------|--------------------------------------------------------------------------|
| `expert`         | Expert system                      | `True`                  | Every legacy knob (`n_prioritized_actions`, `min_line_*`, `ignore_reconnections`, ...). |
| `random`         | Random                             | `False`                 | Just `n_prioritized_actions`.                                            |
| `random_overflow`| Random (post overflow analysis)    | `True`                  | Just `n_prioritized_actions`.                                            |

Third-party packages can extend the registry by decorating their
`RecommenderModel` subclass with `@register` at import time. The
library (`expert_op4grid_recommender`) only owns the contract; the
registry sits here so this app stays in control of which models are
offered to operators.

---

## 2. Built-in random models

Intended as **canonical examples** of how to plug a model in, plus
baselines against the expert system.

### `RandomRecommender` (`requires_overflow_graph=False`)

File: `expert_backend/recommenders/random_basic.py`.

Samples uniformly from the operator's action dictionary, augmented at
runtime with simple reconnection / load-shedding / curtailment actions
derived from the post-fault observation (see `synthetic_actions.py`).
Skips the expensive step-2 overflow-graph build by default.

### `RandomOverflowRecommender` (`requires_overflow_graph=True`)

File: `expert_backend/recommenders/random_overflow.py`.

Samples uniformly from actions inside the **reduced action space the
expert sees**: actions retained by the expert rule filter AND touching
the overflow-graph paths AND existing on the loaded network. Three
filter layers stacked before sampling — see next section.

Returns `{}` (not a fallback to the full dict) when any layer empties
the pool: that's the correct semantic for "no overflow-relevant
actions for this contingency".

---

## 3. The three-layer filter chain

Applied by `RandomOverflowRecommender` before sampling. The expert
pipeline gets layers 1 and 2 implicitly via `ActionDiscoverer`'s
per-type mixins.

### Layer 1 — Expert rule filter

- **Where**: `_run_expert_action_filter(context)` in the library, invoked
  by `run_analysis_step2_discovery` whenever the overflow graph is
  available in the context (= the chosen model required it OR the
  operator opted in via `compute_overflow_graph=True`).
- **What**: runs path analysis + `ActionRuleValidator.categorize_actions`,
  which removes broadly invalid actions (wrong shape, lines already
  open, missing devices, ...).
- **Output**: writes `context["filtered_candidate_actions"]`, forwarded
  to the recommender via `inputs.filtered_candidate_actions`.
- **Idempotent** — free no-op when already populated. The expert model
  invokes it internally too.
- **Note**: this filter does NOT restrict to overflow-relevant actions
  — that targeting is layer 2.

### Layer 2 — Overflow-graph path filter

- **Where**: `expert_backend/recommenders/overflow_path_filter.py`
  (`restrict_to_overflow_paths`).
- **What**: extracts the same path lists the expert orchestrator uses
  from `g_distribution_graph`:
  - dispatch path lines + constrained path lines → `relevant_lines`,
  - dispatch loop nodes + blue path nodes + hub substations → `relevant_subs`.
  Keeps an action when ANY of these references matches:
  1. `entry["VoltageLevelId"]` (or `voltage_level_id`) in `relevant_subs`,
  2. `content.set_bus.lines_or_id` / `lines_ex_id` / `pst_tap` keys
     in `relevant_lines`,
  3. action-id suffix for `disco_<LINE>` / `reco_<LINE>` entries,
  4. any `_`-split segment in `relevant_subs` (UUID-prefixed coupling
     shape `<uuid>_<VL>_..._coupling`).
- **Robustness**: `_resolve_node_to_name` handles both shapes the
  distribution graph returns — integer indices into `obs.name_sub`
  (legacy build) and substation-name strings (current build, including
  `numpy.str_`). Conservative on extraction failure (returns the input
  list unchanged so a buggy graph never silently empties the pool).

### Layer 3 — Network existence filter

- **Where**: `expert_backend/recommenders/network_existence.py`
  (`filter_to_existing_network_elements`).
- **What**: drops actions whose `VoltageLevelId` or `set_bus.lines_*_id`
  references an element that doesn't exist on the loaded pypowsybl
  network. Catches the case where a dict shipped for a larger grid is
  used against a smaller subset (the original AUBE P4 / small_grid bug).
- **Robustness**: returns the input list unchanged when the network
  introspection itself fails — never silently empties the pool.

### Layer ordering rationale

```
  dict_action (potentially 24k entries)
     |
     v
  Layer 1: ActionRuleValidator       → ~few hundred candidates
     |
     v
  Layer 2: overflow_path_filter      → ~few dozen candidates on paths
     |
     v
  Layer 3: network_existence_filter  → candidates known to the grid
     |
     v
  env.action_space(content)          → final pool, drop on materialise error
     |
     v
  random.sample(pool, min(n, len(pool)))
```

Each layer is **conservative on internal failure** (returns input
unchanged) so a bug in any single filter cannot silently empty the
pool. Layers can be independently disabled by mocking the inputs they
read.

---

## 4. Backend wiring

### `ConfigRequest` extension

`expert_backend/main.py` adds two fields to the existing config:

```python
class ConfigRequest(BaseModel):
    # ... existing fields ...
    model: str = "expert"
    compute_overflow_graph: bool = True
```

Defaults match the legacy expert behaviour, so existing clients keep
working.

### `GET /api/models`

Lists every registered model with its `label`,
`requires_overflow_graph`, `is_default` flag, and `params` (the
`params_spec` descriptors). The frontend reads this once on mount to
populate the dropdown and render only the parameter inputs the active
model actually consumes.

### `RecommenderService` integration

Three concerns, kept in `expert_backend/recommenders/_service_integration.py`
to avoid touching the (large) `recommender_service.py` / `analysis_mixin.py`
files:

1. **State + getters** via `ModelSelectionMixin` —
   `_recommender_model_name` and `_compute_overflow_graph` (with
   defaults `"expert"` and `True`). Public getters
   `get_active_model_name()` and `get_compute_overflow_graph()` are
   echoed back by `/api/config`.
2. **`update_config` wrap** — captures the two new ConfigRequest
   fields every time the operator applies settings.
3. **`run_analysis_step2` replacement** — model-aware generator that:
   - builds the recommender from the registry,
   - conditionally skips the overflow-graph step
     (`needs_graph = requires_overflow_graph OR get_compute_overflow_graph()`
     — a model that requires the graph can never be skipped, even via
     direct API call),
   - threads the recommender all the way through to
     `run_analysis_step2_discovery`,
   - echoes `active_model` and `compute_overflow_graph` on the
     `result` event so the frontend can persist them in the saved
     session (`analysis.active_model`).

The patches are applied as a side-effect of importing
`expert_backend.recommenders`. `expert_backend/main.py` only needs
that single import to enable everything.

---

## 5. Frontend wiring

### `useSettings` hook

`frontend/src/hooks/useSettings.ts`:

- New state: `recommenderModel: string` (default `"expert"`),
  `computeOverflowGraph: boolean` (default `true`).
- `availableModels: ModelDescriptor[]` fetched on mount via
  `api.getModels()`.
- `useEffect` forces `computeOverflowGraph = true` whenever the active
  model declares `requires_overflow_graph = true`. Keeps persisted
  user config in sync with what the backend will actually run.
- `buildConfigRequest()` carries `model` and `compute_overflow_graph`
  through every `/api/config` call.

### `SettingsModal` — Recommender tab

`frontend/src/components/modals/SettingsModal.tsx`:

- Top of the tab: a model dropdown populated from `availableModels`.
- Below the dropdown: the `Compute Overflow Graph (step 1)` checkbox
  with three states:
  - **Locked + checked** with the suffix "required by this model"
    when `activeModel.requires_overflow_graph` is true.
  - **Editable** with the suffix "optional for this model" when
    the model doesn't require the graph (useful when the operator
    still wants to inspect the overflow analysis tab alongside a
    graph-agnostic recommender).
  - Hidden entirely while `availableModels` is loading (then falls
    back to showing all the legacy expert fields).
- Below the toggle: the recommender parameters. Each expert-specific
  input is rendered only when the active model declares it in
  `params_spec`. So `Random` only shows `N Prioritized Actions`;
  `Expert` shows the full legacy list.

### `ActionCard` — VL chip

`frontend/src/components/ActionCard.tsx`:

`renderBadges()` reads `details.action_topology.voltage_level_id` as
the **highest-priority signal** for nodal / coupling / switch-based
actions (pypowsybl UUID-prefixed `..._VL_..._coupling`). The chip is
clickable (zoom to VL) and double-clickable (open SLD) — matching the
behaviour of the existing load-shedding / curtailment VL chips. The
backend surfaces this field from `dict_action[id]["VoltageLevelId"]`
via `extract_action_topology`.

---

## 6. How to add a new recommendation model

Three files; nothing else needs to change in the app.

### Step 1 — Write the model class

Anywhere in your package (or a new file under
`expert_backend/recommenders/`). The class follows the library
contract:

```python
from expert_op4grid_recommender.models.base import (
    RecommenderModel, RecommenderInputs, RecommenderOutput, ParamSpec,
)

class MyMLPolicy(RecommenderModel):
    name = "ml_policy"
    label = "ML policy v3"
    requires_overflow_graph = True   # we want the overflow analysis features

    @classmethod
    def params_spec(cls):
        return [
            ParamSpec("n_prioritized_actions", "N Actions", "int",
                     default=5, min=1, max=20),
            ParamSpec("temperature", "Sampling temperature", "float",
                     default=0.7, min=0.0, max=2.0),
        ]

    def recommend(self, inputs: RecommenderInputs, params: dict) -> RecommenderOutput:
        # Use any combination of:
        #   inputs.obs / inputs.network                (N state)
        #   inputs.obs_defaut / inputs.network_defaut  (N-K state)
        #   inputs.lines_overloaded_names / _ids / _rho
        #   inputs.dict_action
        #   inputs.filtered_candidate_actions  (your model gets the same reduced
        #                                       action space the expert sees)
        #   inputs.distribution_graph / hubs   (overflow path info)
        #   inputs.env  (to materialise actions via env.action_space(content))
        my_picks = pick_actions_with_ml(...)
        return RecommenderOutput(prioritized_actions=my_picks)
```

### Step 2 — Register it

Decorate with `@register` (or call it as a function) at import time:

```python
from expert_backend.recommenders.registry import register

@register
class MyMLPolicy(RecommenderModel):
    ...
```

For models shipped as a third-party package: import the registry from
that package, decorate your class. The registration runs on import,
so your package needs to be imported by the backend before
`/api/models` is queried (typical pattern: import it from
`expert_backend/recommenders/__init__.py` or from your own startup
hook).

### Step 3 — No further wiring needed

The frontend picks up the new model automatically:

- `GET /api/models` includes it,
- the Settings → Recommender dropdown lists it,
- the parameter inputs are rendered dynamically from `params_spec()`,
- the `Compute Overflow Graph` toggle is locked/checked or editable
  based on `requires_overflow_graph`,
- the analysis pipeline calls your `recommend()` via
  `run_analysis_step2_discovery`,
- saved sessions persist the active model under
  `analysis.active_model` (see
  [`docs/features/save-results.md`](../features/save-results.md)).

If your model needs the same reduced action space as the expert
(`filtered_candidate_actions`), declare `requires_overflow_graph=True`
and the pipeline runs the expert rule filter for you. For models
that need the path-relevant subset, additionally apply
`restrict_to_overflow_paths` (and optionally
`filter_to_existing_network_elements`) inside `recommend()` — see
`RandomOverflowRecommender` for the canonical pattern.

---

## 7. Testing

App-side tests live in `tests/`. Mock-based; no live pypowsybl /
grid2op needed.

- `test_recommenders_registry.py` — register / unregister, build
  with empty / None, fallback to default, `list_models()` shape and
  per-model flags, canonical three models.
- `test_random_recommenders.py` — metadata, sampling cardinality, the
  three-layer filter chain for RandomOverflow, None-vs-`[]` fallback
  semantics for `filtered_candidate_actions`, drop-on-unknown-VL
  regression (AUBE P4 case).
- `test_overflow_path_filter.py` — `_resolve_node_to_name` covering
  int / numpy.int64 / str / numpy.str_ / bytes, the `numpy.str_`
  regression for the legacy `idx < n_subs` crash, end-to-end with
  numpy nodes.
- `test_network_existence.py` — `filter_to_existing_network_elements`,
  short-circuit on first unknown line, conservative fallback on
  introspection failure, transformer ids accepted as branches.
- `test_action_enrichment.py` — `extract_action_topology` covering
  numpy-array attribute tolerance, four-way set_bus backfill,
  `voltage_level_id` surfacing (upper- and lower-case), switches
  fallback, combined pypowsybl switch-based shape.
- `test_model_selection_mixin.py` — default state, `_apply_model_settings`
  with explicit / empty / whitespace / non-string values, missing
  attrs use defaults.
- `test_service_integration.py` — side-effects of importing
  `expert_backend.recommenders`: mixin attached, `update_config` /
  `reset` wrapped, `run_analysis_step2` replaced, unknown model
  emits an error event.
- `test_models_api.py` — `ConfigRequest` defaults / accepts custom
  model / round-trips through JSON; `GET /api/models` shape and
  canonical content.

Run the suite: `pytest tests/` from the repo root.

---

## 8. Troubleshooting

### "RandomOverflowRecommender: filtered_candidate_actions is None"

The expert rule filter is supposed to populate it. If the warning
fires, either:
- the step-2 graph wasn't built (check the `Compute Overflow Graph`
  toggle in the Settings → Recommender tab — should be locked-on
  for `random_overflow`), or
- `g_distribution_graph` isn't in the context (look for an earlier
  warning from `run_analysis_step2_graph`).

### Pins clustered on the overload, all showing the same %

Diagnosis: the `resolveActionAnchor` in
`frontend/src/utils/svg/actionPinData.ts` is falling back to
`max_rho_line`. Root causes (in priority order):
1. `action_topology.voltage_level_id` is missing from the backend
   payload → check `extract_action_topology` is surfacing the
   `VoltageLevelId` key from `dict_action`.
2. Action targets reference elements outside the SVG metadata index
   (NAD doesn't cover them) → expected for filtered topologies; the
   action should still be filtered out by
   `filter_to_existing_network_elements`.

### Suggestions spread across the whole grid for `random_overflow`

Check the backend logs for `overflow-path-filter: could not extract
path targets` — a `numpy.str_` regression used to disable the filter
silently. Fixed in `overflow_path_filter._resolve_node_to_name`.
If the message still appears, file a bug with the exception details.

### "Compute Overflow Graph" toggle does nothing for the active model

Intended behaviour for models with `requires_overflow_graph=True` —
the checkbox is locked-on with the "required by this model" suffix.
The backend enforces the same guarantee
(`needs_graph = requires_overflow_graph OR get_compute_overflow_graph()`)
so direct API calls cannot bypass it.

---

## Related docs

- [Backend overview](README.md) (this folder).
- [Save Results](../features/save-results.md) — session JSON shape
  including `analysis.active_model` and `configuration.model`.
- [Interaction Logging](../features/interaction-logging.md) —
  `config_loaded` / `settings_applied` details include the recommender
  selection.
- Library-side contract:
  [`marota/expert_op4grid_recommender` — docs/recommender_models.md](https://github.com/marota/expert_op4grid_recommender/blob/main/docs/recommender_models.md).
- Performance history (overflow-graph caching, NAD prefetch, SVG DOM
  recycling): `docs/performance/history/`.
