# Code Quality & Maintainability Analysis

**Date:** 2026-04-11
**Last updated:** 2026-04-20
**Scope:** Full repository diagnostic — backend, frontend, repo structure, security, testing

> **Continuous reporting (new 2026-04-20):**
> - `python scripts/code_quality_report.py` — metrics dump (JSON + Markdown)
> - `python scripts/check_code_quality.py` — CI gate (non-zero exit on regression)
> - Unit-tested in `scripts/test_code_quality_report.py` (7 tests, part of the pytest suite)
> - Runs in CI: `.github/workflows/code-quality.yml` + `.circleci/config.yml`
>   (jobs `gate` / `code-quality`). Also uploads a report artifact.
> - See [CONTRIBUTING.md](../../CONTRIBUTING.md#code-quality-checks)
>   for local usage and thresholds.

---

## Executive Summary

| Dimension | Grade | Status | Notes |
|-----------|-------|--------|-------|
| **TypeScript correctness** | **A** | — | Zero compiler errors, zero lint warnings, strict mode |
| **Test suite** | **A+** | **Improved** | 560+ frontend tests, 42 backend test files, 7 quality-reporter tests |
| **Documentation** | **A** | — | CLAUDE.md refreshed, `CONTRIBUTING.md` added, 17 docs/ |
| **Frontend architecture** | **B+** | **Improved** | Oversized components split into focused subcomponents |
| **Backend architecture** | **B+** | **Fixed** | Split into 5 focused modules (was one 3,151-line monolith) |
| **Security posture** | **B+** | **Fixed** | Path traversal patched; CORS now honours `CORS_ALLOWED_ORIGINS` env var |
| **Type safety (Python)** | **C** | **Improving** | Core utilities typed; route handlers still missing return annotations |
| **Error handling (Python)** | **A-** | **Fixed** | `logger.exception()` replaces all `traceback.print_exc()` in backend sources |
| **Continuous quality reporting** | **A** | **New** | Gate script + unit tests + CI job + ruff (F/E9 rules) |

---

## 1. What's Working Well

### Frontend Tooling

- `tsc --noEmit` passes with **zero errors** under `strict: true`
- ESLint passes with **zero warnings**
- All **560 unit tests pass** across 35 test files (Vitest + React Testing Library)
- No `any` types in source code, no `@ts-ignore`
- Well-structured custom hooks: `useSettings`, `useAnalysis`, `useDiagrams`, `useSldOverlay`, `useSession`, `usePanZoom`

### Documentation

- CLAUDE.md (250+ lines) provides comprehensive project context
- 17 architecture/design docs in `docs/`
- Consistent copyright headers (MPL-2.0)

### Git Hygiene

- Conventional commit prefixes (`feat:`, `fix:`, `debug:`, `test:`)
- PR-based workflow with descriptive merge commits
- Dual CI: CircleCI + GitHub Actions running pytest, Vitest, and ESLint

### Backend Test Coverage

- 39 test files in `expert_backend/tests/`
- Covers sanitization, overload filtering, combined actions, PST tap actions, regression scenarios

---

## 2. Critical Issues — All Resolved

### 2.1 ~~Security: Path Traversal Vulnerabilities~~ ✅ FIXED

Added `_validate_path_within()` helper to `main.py` that resolves paths and ensures they don't escape the allowed directory. Applied to `save_session` and `load_session` endpoints. PDF copy source restricted to `Overflow_Graph/` directory.

### 2.2 ~~Security: Wildcard CORS~~ ✅ FIXED

CORS origins now configurable via `CORS_ALLOWED_ORIGINS` environment variable (comma-separated). `allow_credentials` disabled when using wildcard. Removed dead `GZipMiddleware` import.

### 2.3 ~~Backend God Object: `recommender_service.py` (3,151 lines)~~ ✅ FIXED

Split into focused mixin modules:

| File | Lines | Responsibility |
|------|-------|----------------|
| `recommender_service.py` | **410** | Core orchestrator, config, network lifecycle |
| `diagram_mixin.py` | **833** | NAD/SLD generation, flow deltas, overload detection |
| `analysis_mixin.py` | **1,030** | Contingency analysis, action enrichment, MW computation |
| `simulation_mixin.py` | **984** | Manual action simulation, superposition |
| `sanitize.py` | **40** | JSON serialization utility |

All imports re-exported for backward compatibility. `RecommenderService` inherits from `DiagramMixin`, `AnalysisMixin`, `SimulationMixin`.

### 2.4 ~~Silent Exception Swallowing~~ ✅ FIXED

Replaced **15 bare `except Exception: pass`** patterns with `except Exception as e: logger.debug("Suppressed exception: %s", e)`.

### 2.5 ~~Debug Prints Instead of Logging~~ ✅ FIXED

Replaced **80+ bare `print()` calls** with Python `logging` module calls at appropriate levels (`logger.info`, `logger.warning`, `logger.debug`). Added `import logging` and `logger = logging.getLogger(__name__)` to all service modules.

---

## 3. High-Priority Issues

### 3.1 ~~Frontend: Oversized Components~~ ✅ FIXED

Split the four worst offenders into focused subcomponents:

| Original File | Before | After | Extracted Components |
|------|-------|-------|-------|
| `ActionFeed.tsx` | **1,406** | **796** | `ActionCard.tsx` (370), `ActionSearchDropdown.tsx` (486) |
| `VisualizationPanel.tsx` | **1,285** | **554** | `SldOverlay.tsx` (705), `MemoizedSvgContainer.tsx` (48) |
| `CombinedActionsModal.tsx` | **777** | **397** | `ComputedPairsTable.tsx` (145), `ExplorePairsTab.tsx` (380) |
| `useDiagrams.ts` | **767** | **693** | `useSldOverlay.ts` (107) |
| `App.tsx` | **758** | **758** | Orchestration hub — acceptable at boundary |

**ActionFeed.tsx** (−43%): `renderActionList` (280 lines of per-card rendering) extracted to `ActionCard`. The search dropdown with its score table, type filters, and search results (350+ lines) extracted to `ActionSearchDropdown`.

**VisualizationPanel.tsx** (−57%): The 680-line inline `SldOverlay` component (SLD delta coloring, highlight clones, pan/zoom) moved to its own file. `MemoizedSvgContainer` (SVG DOM injection wrapper) also extracted.

**CombinedActionsModal.tsx** (−49%): Computed pairs table and explore pairs tab (with selection chips, filter buttons, grouped table, and comparison card) each extracted to dedicated components.

**useDiagrams.ts** (−10%): SLD overlay state management (`fetchSldVariant`, `handleVlDoubleClick`, `handleOverlaySldTabChange`, `handleOverlayClose`) extracted to `useSldOverlay` hook.

**Test coverage for all extracted components:** 7 new test files added (106 tests), covering every extracted component and hook:

| Test File | Tests | Coverage |
|-----------|-------|---------|
| `ActionCard.test.tsx` | 25 | Severity badges, VIEWING state, star/reject, LS/RC/PST re-simulation, MW/tap inputs |
| `ActionSearchDropdown.test.tsx` | 14 | Type filters, search input, scored actions table, manual ID, loading/error states |
| `ComputedPairsTable.test.tsx` | 13 | Pair rendering, simulate/re-simulate, empty state, islanding, color coding |
| `ExplorePairsTab.test.tsx` | 21 | Selection chips, filter buttons, estimate/simulate workflow, comparison card, errors |
| `MemoizedSvgContainer.test.tsx` | 6 | String + SVGSVGElement injection, tab-specific IDs, display prop, perf logging |
| `SldOverlay.test.tsx` | 14 | Header, close/tab callbacks, mode indicator, loading/error, conditional tabs |
| `useSldOverlay.test.ts` | 13 | Hook init, vlOverlay state, fetchSldVariant success/error, interaction logging |

### 3.2 ~~Missing React Error Boundary~~ ✅ FIXED

Added `ErrorBoundary` class component at `frontend/src/components/ErrorBoundary.tsx` and wired it into `main.tsx` wrapping `<App />` inside `<StrictMode>`. The boundary:

- Catches render/lifecycle errors via `getDerivedStateFromError` + `componentDidCatch`
- Logs the error and React component stack to `console.error`
- Renders a styled fallback UI (`role="alert"`) with the error name/message, a collapsible `<details>` block containing the full stack trace, and two recovery actions:
  - **Try again** — resets boundary state (re-mounts the child tree)
  - **Reload page** — calls `window.location.reload()`
- Accepts an optional `fallback` prop to override the default UI

Covered by 7 new unit tests in `ErrorBoundary.test.tsx` (happy path, default fallback, custom fallback, console logging, reset, reload, details block). Total frontend test count is now 578 (was 571).

### 3.3 Python Type Hint Coverage — **Partially Fixed**

- `sanitize.py:sanitize_for_json` — typed as `Any → Any` (2026-04-20).
- FastAPI route handlers still return implicit `dict` — the return annotations
  are a good candidate for the next pass (would improve the auto-generated OpenAPI).

**Recommendation:** Add return type annotations to all FastAPI route handlers (also enables better auto-generated OpenAPI docs).

### 3.4 Weak TypeScript Typing Patterns

65 occurrences of `Record<string, unknown>` and `as unknown as` double-casts across the frontend, indicating the API response types aren't fully modeled:

- `ActionFeed.tsx`: 7 occurrences
- `api.ts`, `useDiagrams.ts`, `useSession.ts`: scattered throughout

These bypass TypeScript's type checking at integration boundaries.

**Recommendation:** Define typed API response interfaces in `types.ts` to replace `Record<string, unknown>` casts.

### 3.5 Accessibility Gaps

- No `aria-label` on icon/emoji buttons (ActionFeed, Header, OverloadPanel)
- No `aria-selected`/`aria-controls` on tab buttons (SettingsModal)
- No focus trapping in modals
- No semantic list markup (`<ul>`/`<li>`) for action lists
- No screen reader announcements for async operations

**Recommendation:** Audit against WCAG 2.1 AA; add aria attributes, semantic HTML, and focus management to modals.

---

## 4. Medium-Priority Issues

### 4.1 Standalone HTML Maintenance Burden

`standalone_interface.html` is **7,178 lines** — a complete duplicate of the React frontend in a single file. Every UI change must be manually mirrored. This is a significant ongoing maintenance cost and drift risk.

**Recommendation:** Consider deprecating or auto-generating from the React build.

### 4.2 Inconsistent API Response Formats

- Some endpoints: `{"status": "success", ...}`
- Others: direct data `{"branches": [...]}`
- Streaming endpoints: custom NDJSON error format
- Error responses: `HTTPException(detail=str(e))` leaks internal stack details

**Recommendation:** Standardize on a response envelope format and error schema across all endpoints.

### 4.3 ~~Hardcoded Configuration~~ Partially Fixed

CORS origins now configurable via `CORS_ALLOWED_ORIGINS` env var
(implemented at `main.py:174-184`; `.env.example` added 2026-04-20 as
a template). Remaining:

| Value | Location | Should Be |
|-------|----------|-----------|
| Port 8000, host 0.0.0.0 | `main.py` | Environment variable |
| `"Overflow_Graph"` directory | 5 locations in main.py | Config constant |
| Worsening thresholds | `recommender_service.py` | Config parameter |

**Recommendation:** Parameterize remaining values via environment variables or a central config object.

### 4.4 ~~Unused Dependencies~~ ✅ FIXED

`framer-motion` and `lucide-react` were removed from
`frontend/package.json` on 2026-04-20 — neither was imported in any
source file. The stale `GZipMiddleware` import in `main.py` was also
removed in the same pass.

### 4.5 ~~Incomplete Function~~ ✅ FIXED

`network_service.py:get_load_voltage_levels_bulk()` fell through to the
next function without a loop body. Implemented on 2026-04-20 to populate
`result` from `loads.loc[lid]['voltage_level_id']` — matching the sister
`get_generator_types_bulk()` pattern.

### 4.6 Code Duplication in Backend

- Voltage-level resolution logic repeated 4 times across `network_service.py`
- Action detail computation (`_compute_load_shedding_details`, `_compute_curtailment_details`, `_compute_pst_details`) share near-identical structure
- Try/except blocks for element voltage-level access repeated 5+ times

**Recommendation:** Extract shared patterns into helper functions.

### 4.7 ~~Frontend: Swallowed Errors in Async Code~~ ✅ FIXED

- `SettingsModal.tsx` — empty `.catch(() => { })` replaced with
  `.catch(err => console.error(...))` on the two config-file-path
  handlers (2026-04-20).
- `useSettings.ts:174,220` — already logs a warning via `console.warn`;
  the 2026-04-13 audit predated that change.
- `lines.pop()!` in NDJSON stream readers is safe: `String.split('\n')`
  always returns at least one element, so the non-null assertion does
  not mask a bug. No change needed.

---

## 5. Low-Priority / Housekeeping

| Item | Status |
|------|--------|
| Empty doc file `docs/proposals/rendering-lod-strategies.md` | ✅ Filled in (9.2 KB of consolidated LoD history) |
| Stale lockfile `.~lock.Cases_Defauts_10032026.odt#` | ✅ No longer present |
| Redundant CI (CircleCI + GitHub Actions) | Both kept for belt-and-braces; the new `code-quality` job runs in each |
| No `.env.example` | ✅ Added 2026-04-20 (CORS_ALLOWED_ORIGINS, PYPOWSYBL_FAST_MODE, LOG_LEVEL) |
| No Dockerfile | Still open |
| CLAUDE.md drift (missing root `test_*.py`) | ✅ Refreshed 2026-04-20 — now documents `scripts/` and the code-quality gate |
| Missing `.editorconfig` | ✅ Added 2026-04-20 |
| Missing `CONTRIBUTING.md` | ✅ Added 2026-04-20 (setup, tests, quality gate, commit conventions) |

---

## 6. Metrics Summary

Numbers below are produced by `scripts/code_quality_report.py` against
the current HEAD. Re-generate via
`python scripts/code_quality_report.py --markdown reports/code-quality.md`.

```
Backend (expert_backend/)
  Source files (non-test):     9 (added simulation_helpers.py)
  Total lines:                 5,491
  Largest module:              analysis_mixin.py (1,116 lines)
  Top 3 longest functions:
    run_analysis               169 lines
    update_config              166 lines
    simulate_manual_action     146 lines  (was 599 — split via helpers)
                               compute_superposition → 108 lines (was 285)
  print() calls in source:     0  (was 80+)
  traceback.print_exc() calls: 0  (was distributed across mixins)
  Silent except: pass:         0  (was 80+)
  Test files:                  41 (+ test_simulation_helpers.py with 66 tests)

Frontend (frontend/src/)
  Source files (non-test):     37
  Total lines:                 14,872
  Largest component:           utils/svgUtils.ts (1,807 lines — util, exempt)
  Test files:                  43
  Tests passing:               ≥ 578 (unchanged — still 7 new ErrorBoundary tests)
  TypeScript errors:           0
  Lint warnings:               0
  `any` types in source:       0
  `@ts-ignore` directives:     0
  `as unknown as` casts:       15
  `Record<string, unknown>`:   37 occurrences

Repository
  Standalone HTML (legacy):    ~7,100 lines (frozen snapshot only)
  Standalone HTML (built):     auto-generated from frontend/src/
  Documentation files:         17 in docs/
  CI pipelines:                3 jobs on each (test-backend, test-frontend,
                               code-quality) across CircleCI + GH Actions
```

## 6b. Continuous-Quality Tooling (new 2026-04-20)

Three shipped surfaces keep the metrics above honest over time:

1. **`scripts/code_quality_report.py`** — AST-walks the backend and
   globs the frontend source tree to emit a JSON + Markdown report.
   Uses `ast.parse` for backend counts so strings / docstrings with
   `print(` inside them are not flagged (exactly the case of the
   tkinter subprocess script in `main.py`).

2. **`scripts/check_code_quality.py`** — the PR gate. Encodes the
   current reductions as hard ceilings:

   | Metric | Ceiling |
   |--------|---------|
   | `print(` calls in backend sources | 0 |
   | `traceback.print_exc()` calls in backend | 0 |
   | `except Exception: pass` (silent) | 0 |
   | Backend module LoC | 1,200 |
   | Frontend component LoC (non-App, non-util) | 1,500 |
   | Frontend util LoC (`frontend/src/utils/*`) | 2,000 |
   | `any` in frontend source | 0 |
   | `@ts-ignore` in frontend source | 0 |

   Ceilings are intentionally tight — lowering them is how we lock in
   future improvements; raising them requires a documented reason.

3. **Ruff** — light pyflakes + syntax ruleset (`E9`, `F`) configured
   in `pyproject.toml`. Catches undefined names (found a latent
   `RecommenderService` self-reference in `simulation_mixin.py` on
   the first run — now fixed) and unused imports. Stylistic rules
   (`W`, `B`, `UP`) are deliberately off today; they can be opted in
   per-file as we clean up.

**CI wiring:**
- `.github/workflows/code-quality.yml` — runs `ruff`, the gate, the
  reporter unit tests, and uploads `reports/` as an artifact.
- `.circleci/config.yml` — mirrors the above under a `code-quality`
  job added to the `test-workflow` workflow.
- `pytest.ini` — includes `scripts/test_code_quality_report.py` so
  the gate logic has its own unit-test coverage (7 tests).

---

## 7. Prioritized Recommendations

### ~~Immediate (High Risk)~~ ✅ ALL DONE

1. ~~**Fix path traversal**~~ ✅ `_validate_path_within()` added to session save/load; PDF copy restricted
2. ~~**Refactor `recommender_service.py`**~~ ✅ Split into 5 modules via mixin architecture
3. ~~**Replace silent exceptions**~~ ✅ 80+ print→logger, 15 bare except→logged
4. ~~**Add a React Error Boundary**~~ ✅ `ErrorBoundary` wraps `<App />` in `main.tsx` with styled fallback + recovery buttons

### Short-Term (High Value)

5. ~~**Split `ActionFeed.tsx`** into subcomponents~~ ✅ Extracted `ActionCard`, `ActionSearchDropdown`; also split `VisualizationPanel` (→ `SldOverlay`, `MemoizedSvgContainer`), `CombinedActionsModal` (→ `ComputedPairsTable`, `ExplorePairsTab`), and `useDiagrams` (→ `useSldOverlay`)
6. **Add return type annotations** to all FastAPI route handlers
7. **Define typed API response interfaces** in `types.ts` to eliminate `Record<string, unknown>` casts (37 remaining; down from 65)
8. ~~**Remove unused deps**~~ ✅ Completed 2026-04-20: `framer-motion` and `lucide-react` dropped; `GZipMiddleware` import cleaned.

### Medium-Term (Improvement)

9. ~~**Parameterize hardcoded values**~~ Partially done: CORS origins configurable; port/host still hardcoded; `.env.example` template added 2026-04-20
10. **Standardize API response formats** across all endpoints
11. **Add accessibility attributes** (aria-labels, semantic HTML, focus trapping)
12. ~~**Consolidate CI** to a single pipeline~~ Decision reversed: both pipelines kept intentionally (cross-platform coverage). Each runs the new `code-quality` job.

### Long-Term (Strategic)

13. ~~**Deprecate or auto-generate `standalone_interface.html`**~~ ✅ Shipped as the 0.6.0 release (see `build:standalone` and the `dist-standalone` bundle). Legacy file frozen as `standalone_interface_legacy.html`.
14. **Add Python dependency lockfile** (Poetry or uv) for reproducible builds
15. **Add accessibility testing** (jest-axe or similar)

---

## 8. Bugs Found & Fixed During This Audit

Beyond the planned quality improvements, the audit uncovered and fixed several production bugs:

### 8.1 Second Contingency Crash (`content=None`) ✅ FIXED

Auto-generated `disco_` actions had no `content` field. The library's rule validator crashed on `content.get("set_bus", {})` during the second contingency analysis. Also fixed: `simulate_manual_action` merge logic used truthiness check (`if content:`) instead of `is not None`, preventing empty dicts from replacing stale `None`.

### 8.2 N-1 Auto-Zoom Lost on Second Contingency ✅ FIXED

`clearContingencyState()` reset `activeTab` to `'n'`, causing the auto-zoom guard (`branchChanged && activeTab === 'n'`) to skip zoom. Fixed in both `standalone_interface.html` and `App.tsx` — tab reset now only in `resetAllState` (full network reload).

### 8.3 `min_renewable_curtailment_actions` Not Saved ✅ FIXED

The standalone's user-config persist effect was missing `min_renewable_curtailment_actions` from the POST body. Also added the field to `config.default.json`. Added 17 regression tests verifying config save parity.

### 8.4 `PYPOWSYBL_FAST_MODE` Silently Overridden in Tests ✅ FIXED

The `conftest.py` `reset_config` fixture unconditionally re-applied `PYPOWSYBL_FAST_MODE=True`, overriding test modules' intentional `False` setting. This caused AC load flow to produce wrong reactive power values for PST combined actions (~110% instead of ~94%).

### 8.5 `RecommenderService._build_action_entry_from_topology` NameError ✅ FIXED

`simulation_mixin.py` called `RecommenderService._build_action_entry_from_topology(...)` without importing `RecommenderService`. The best-effort topology-reconstruction branch would have raised `NameError` at runtime if ever taken. Surfaced by the new ruff `F821` rule on 2026-04-20; fixed by switching to `self._build_action_entry_from_topology(...)` (the staticmethod lives on `SimulationMixin`, which `self` already is).

### 8.6 `get_load_voltage_levels_bulk` Incomplete ✅ FIXED

`network_service.py:get_load_voltage_levels_bulk()` fell through to the next function definition with an unclosed loop body. Implemented 2026-04-20 by mirroring the pattern of `get_generator_types_bulk()`.

---

## 9. Delta — 2026-04-20

One-pass sweep to land continuous reporting and close remaining
housekeeping issues. Scope:

- **Added**: `scripts/code_quality_report.py` (AST-based metrics
  dump, JSON + Markdown output) and `scripts/check_code_quality.py`
  (CI gate with per-metric thresholds).
- **Added**: `scripts/test_code_quality_report.py` — 7 unit tests
  covering the AST smell-walker (print in string literals not
  flagged, logged except not silent, etc.). Collected by
  `pytest.ini`.
- **Added**: ruff configuration in `pyproject.toml` (F, E9) +
  per-file ignores for tests/scripts; optional `[quality]` extra
  that pulls `ruff` + `radon`.
- **Added**: `.github/workflows/code-quality.yml` +
  `code-quality` CircleCI job — runs ruff, the gate, the reporter
  unit tests, and uploads `reports/` as a CI artifact.
- **Added**: `CONTRIBUTING.md`, `.editorconfig`, `.env.example` —
  all referenced from `CLAUDE.md`.
- **Fixed bugs surfaced by the new tooling**:
  - `RecommenderService._build_action_entry_from_topology(...)`
    self-reference (F821) in `simulation_mixin.py`.
  - `get_load_voltage_levels_bulk()` empty-body bug.
  - Redundant shadowed imports (`io`, `threading`, `time`, and
    `run_analysis_step2`) in `analysis_mixin.py` / `diagram_mixin.py`.
  - 9 auto-fixed `F541` (f-strings without placeholders).
  - Stray `.catch(() => {})` in `SettingsModal.tsx` replaced with
    `console.error` logging.
  - `traceback.print_exc()` in `analysis_mixin.py` converted to
    `logger.exception(...)`; stray `except Exception: pass` swapped
    for a logged suppression.
- **Removed**: unused frontend dependencies (`framer-motion`,
  `lucide-react`) and the unused `GZipMiddleware` import.
- **Refreshed**: root `CLAUDE.md` — removed references to
  root-level `test_*.py` scripts that no longer exist, added the
  `code-quality` workflow to the Notes section, and pointed at
  `CONTRIBUTING.md`.

Expected CI behaviour after the sweep: the new `code-quality` job is
green at current HEAD, and any regression (new `print(`, new module
crossing the ceiling, new `any` in frontend source, &c.) fails the
job with a prescriptive message.

---

## 10. Delta — 2026-04-20 (follow-up: function decomposition)

Second pass targeted at the two longest functions flagged in §6 by the
continuous reporter:

| Function | Before | After | Lever |
|----------|--------|-------|-------|
| `simulate_manual_action` | 599 | **146** | 12 private helpers + 11 helpers in new `simulation_helpers.py` |
| `compute_superposition` | 285 | **108** | 5 private helpers (pair-simulate / identify-with-PST-fallback / care-mask / metrics / diagnostics) |

The new stateless module `expert_backend/services/simulation_helpers.py`
(403 LoC) owns the pieces that don't need `self`:
`canonicalize_action_id`, `compute_reduction_setpoint`,
`parse_pst_tap_id` + `clamp_tap`, `classify_action_content`,
`is_pst_action` + `pst_fallback_line_idxs`, `build_care_mask`,
`resolve_lines_overloaded`, `compute_action_metrics`,
`extract_action_topology`, `serialize_action_result`,
`normalise_non_convergence`, `build_combined_description`, and
`compute_combined_rho`.

Coverage: 66 focused unit tests in
`expert_backend/tests/test_simulation_helpers.py` — one test class per
helper, exercising edge cases that previously lived as implicit
branches inside the god-method (islanding, PST-tap-only topologies,
heuristic power-reduction fallback, pre-existing overload exclusion,
combined-pair description building, sign-preserving rho superposition).

Test surface: the 130 existing simulation + superposition tests
continue to pass (same mocks, same call order). The extraction is
behaviour-preserving — helpers were pulled from the method body
verbatim wherever possible.

Next candidates (see §6 metrics): `run_analysis` (169 lines),
`update_config` (166 lines), `_enrich_actions` (125 lines).

