# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Unit tests for the code-quality reporter.

These exercise the smell-detection AST walker with hand-rolled source
fragments so the checks stay stable even as the repo evolves. The
integration side — "running the script against the whole repo does not
raise" — is covered by `scripts/check_code_quality.py` itself.
"""
from __future__ import annotations

import ast
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from code_quality_report import _count_python_smells, build_report  # noqa: E402


def _smells(src: str) -> tuple[int, int, int]:
    return _count_python_smells(ast.parse(src))


def test_counts_bare_print_call():
    src = "def f():\n    print('hi')\n"
    prints, tb, silent = _smells(src)
    assert prints == 1 and tb == 0 and silent == 0


def test_does_not_count_print_inside_string_literal():
    # A `print(...)` embedded in a multi-line string — e.g. the tkinter
    # subprocess script in `main.py` — must not be flagged.
    src = 'def f():\n    script = """\nprint(path)\n"""\n    return script\n'
    prints, _, _ = _smells(src)
    assert prints == 0


def test_counts_traceback_print_exc():
    src = "import traceback\ndef f():\n    try: pass\n    except Exception:\n        traceback.print_exc()\n"
    _, tb, _ = _smells(src)
    assert tb == 1


def test_counts_silent_except_pass():
    src = "def f():\n    try: pass\n    except Exception:\n        pass\n"
    _, _, silent = _smells(src)
    assert silent == 1


def test_logged_except_is_not_silent():
    src = (
        "import logging\n"
        "logger = logging.getLogger(__name__)\n"
        "def f():\n"
        "    try: pass\n"
        "    except Exception as e:\n"
        "        logger.debug('suppressed: %s', e)\n"
    )
    _, _, silent = _smells(src)
    assert silent == 0


def test_bare_except_pass_also_counts():
    src = "def f():\n    try: pass\n    except:\n        pass\n"
    _, _, silent = _smells(src)
    assert silent == 1


def test_build_report_against_repo_root():
    """The whole-repo scan returns sane numbers and no exceptions."""
    report = build_report()
    assert report.backend.source_files >= 5
    assert report.backend.total_lines > 0
    assert report.frontend.source_files >= 10
    assert report.frontend.total_lines > 0
    # Gate invariants — if these regress, CI will fail on
    # `check_code_quality.py` anyway.
    assert report.backend.print_calls == 0
    assert report.backend.traceback_prints == 0
    assert report.backend.silent_excepts == 0
    assert report.frontend.any_types == 0
    assert report.frontend.ts_ignores == 0


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__]))
