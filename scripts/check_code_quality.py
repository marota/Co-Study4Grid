#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Gate pull requests on code-quality thresholds.

Exits non-zero when any threshold is violated. The numbers encode the
reductions won in `docs/architecture/code-quality-analysis.md` and are
intentionally a ceiling, not a target — lowering them is welcome,
raising them is a regression.

Thresholds (see also CONTRIBUTING.md):

| Metric                                     | Max |
|--------------------------------------------|-----|
| `print(` calls in backend sources          |  0  |
| `traceback.print_exc()` calls in backend   |  0  |
| Bare `except Exception: pass` patterns     |  0  |
| Backend module size (lines)                | 1200|
| Frontend component size (lines)            | 1500|
| `any` type annotations in frontend source  |  0  |
| `@ts-ignore` directives in frontend source |  0  |

`App.tsx` is exempt from the frontend size ceiling — it is the state
orchestration hub by design.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from code_quality_report import build_report  # type: ignore[import-not-found]

BACKEND_MODULE_MAX = 1200
FRONTEND_COMPONENT_MAX = 1500
FRONTEND_UTIL_MAX = 2000
# Files exempt from the component-size ceiling. `App.tsx` is the state
# orchestration hub by design; `utils/svgUtils.ts` is a stable shared
# util library (SVG helpers, highlight ops, metadata parsing) and is
# already partitioned by section comments — splitting it would create
# more friction than it resolves. It remains gated by `FRONTEND_UTIL_MAX`.
FRONTEND_SIZE_EXEMPTIONS = {"frontend/src/App.tsx"}
FRONTEND_UTIL_PREFIX = "frontend/src/utils/"


def main() -> int:
    report = build_report()
    errors: list[str] = []

    be = report.backend
    if be.print_calls:
        errors.append(f"backend: {be.print_calls} `print(` calls — use `logging`")
    if be.traceback_prints:
        errors.append(
            f"backend: {be.traceback_prints} `traceback.print_exc()` calls — "
            "use `logger.exception(...)`"
        )
    if be.silent_excepts:
        errors.append(
            f"backend: {be.silent_excepts} silent `except Exception: pass` blocks — "
            "log the exception"
        )
    for mod in be.modules:
        if mod.lines > BACKEND_MODULE_MAX:
            errors.append(
                f"backend: `{mod.path}` is {mod.lines} lines "
                f"(ceiling {BACKEND_MODULE_MAX}) — split into focused modules"
            )

    fe = report.frontend
    if fe.any_types:
        errors.append(
            f"frontend: {fe.any_types} `any` type annotations — model the shape in `types.ts`"
        )
    if fe.ts_ignores:
        errors.append(f"frontend: {fe.ts_ignores} `@ts-ignore` directives")
    for comp in fe.components:
        if comp.path in FRONTEND_SIZE_EXEMPTIONS:
            continue
        is_util = comp.path.startswith(FRONTEND_UTIL_PREFIX)
        ceiling = FRONTEND_UTIL_MAX if is_util else FRONTEND_COMPONENT_MAX
        if comp.lines > ceiling:
            suggestion = (
                "split into focused modules"
                if is_util
                else "extract sub-components"
            )
            errors.append(
                f"frontend: `{comp.path}` is {comp.lines} lines "
                f"(ceiling {ceiling}) — {suggestion}"
            )

    if errors:
        print("Code-quality gate FAILED:")
        for err in errors:
            print(f"  - {err}")
        print(
            "\nRun `python scripts/code_quality_report.py` for the full report, "
            "and see docs/architecture/code-quality-analysis.md for context."
        )
        return 1

    print("Code-quality gate OK.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
