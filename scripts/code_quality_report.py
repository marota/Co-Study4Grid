#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Aggregate code-quality metrics for Co-Study4Grid.

Runs entirely offline against the repo source tree:

    python scripts/code_quality_report.py                      # stdout JSON
    python scripts/code_quality_report.py --markdown REPORT.md # also emit markdown
    python scripts/code_quality_report.py --output report.json

The report is the ground truth for the "Metrics Summary" table in
`docs/architecture/code-quality-analysis.md` and feeds the PR gate in
`scripts/check_code_quality.py`.

Metrics:
- Per-module backend LoC + largest file + per-function length (top-N)
- Per-component frontend LoC + largest file
- Count of `print(` / `traceback.print_exc` / bare `except Exception: pass`
- Count of `any`-typed fields / `@ts-ignore` / `as unknown as` / `Record<string, unknown>`
  in frontend source
- Test-file counts for backend + frontend
"""
from __future__ import annotations

import argparse
import ast
import json
import re
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOTS = [
    REPO_ROOT / "expert_backend" / "main.py",
    REPO_ROOT / "expert_backend" / "services",
]
BACKEND_TEST_ROOT = REPO_ROOT / "expert_backend" / "tests"
FRONTEND_SRC_ROOT = REPO_ROOT / "frontend" / "src"

# Frontend regex patterns — TS/TSX parsing is out of scope so we
# scan source text directly. Python smells are parsed through `ast`
# (see `_count_python_smells`) to avoid false positives from string
# literals and comments.
ANY_TYPE_RE = re.compile(r":\s*any\b|<\s*any\s*>|\bany\[\]")
TS_IGNORE_RE = re.compile(r"@ts-ignore")
AS_UNKNOWN_RE = re.compile(r"as\s+unknown\s+as\b")
RECORD_STR_UNK_RE = re.compile(r"Record<string,\s*unknown>")


def _count_python_smells(tree: ast.AST) -> tuple[int, int, int]:
    """Return (print_calls, traceback_print_exc_calls, silent_except_blocks)."""
    prints = tracebacks = silent = 0
    for node in ast.walk(tree):
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id == "print":
                prints += 1
            elif (
                isinstance(func, ast.Attribute)
                and func.attr == "print_exc"
                and isinstance(func.value, ast.Name)
                and func.value.id == "traceback"
            ):
                tracebacks += 1
        elif isinstance(node, ast.ExceptHandler):
            exc_type = node.type
            is_broad = (
                exc_type is None
                or (isinstance(exc_type, ast.Name) and exc_type.id == "Exception")
            )
            body = node.body
            if (
                is_broad
                and len(body) == 1
                and isinstance(body[0], ast.Pass)
            ):
                silent += 1
    return prints, tracebacks, silent


def count_lines(path: Path) -> int:
    try:
        return sum(1 for _ in path.open("r", encoding="utf-8"))
    except OSError:
        return 0


@dataclass
class FileMetric:
    path: str
    lines: int


@dataclass
class FunctionMetric:
    file: str
    name: str
    lines: int


@dataclass
class BackendReport:
    modules: list[FileMetric] = field(default_factory=list)
    largest_module: FileMetric | None = None
    longest_functions: list[FunctionMetric] = field(default_factory=list)
    total_lines: int = 0
    print_calls: int = 0
    traceback_prints: int = 0
    silent_excepts: int = 0
    test_files: int = 0
    source_files: int = 0


@dataclass
class FrontendReport:
    components: list[FileMetric] = field(default_factory=list)
    largest_component: FileMetric | None = None
    total_lines: int = 0
    any_types: int = 0
    ts_ignores: int = 0
    weak_casts: int = 0
    record_str_unknown: int = 0
    test_files: int = 0
    source_files: int = 0


@dataclass
class QualityReport:
    backend: BackendReport = field(default_factory=BackendReport)
    frontend: FrontendReport = field(default_factory=FrontendReport)


def iter_backend_modules() -> list[Path]:
    files: list[Path] = []
    for root in BACKEND_ROOTS:
        if root.is_file():
            files.append(root)
        elif root.is_dir():
            files.extend(p for p in root.rglob("*.py") if "__pycache__" not in p.parts)
    return sorted(files)


def iter_frontend_sources() -> list[Path]:
    if not FRONTEND_SRC_ROOT.is_dir():
        return []
    files = []
    for p in FRONTEND_SRC_ROOT.rglob("*"):
        if p.suffix not in {".ts", ".tsx"}:
            continue
        if ".test." in p.name:
            continue
        files.append(p)
    return sorted(files)


def iter_frontend_tests() -> list[Path]:
    if not FRONTEND_SRC_ROOT.is_dir():
        return []
    return sorted(p for p in FRONTEND_SRC_ROOT.rglob("*") if ".test." in p.name)


def extract_longest_functions(path: Path, top_n: int = 5) -> list[FunctionMetric]:
    try:
        src = path.read_text(encoding="utf-8")
    except OSError:
        return []
    try:
        tree = ast.parse(src, filename=str(path))
    except SyntaxError:
        return []
    out: list[FunctionMetric] = []
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            start = node.lineno
            end = getattr(node, "end_lineno", start) or start
            length = max(0, end - start + 1)
            out.append(
                FunctionMetric(
                    file=str(path.relative_to(REPO_ROOT)),
                    name=node.name,
                    lines=length,
                )
            )
    out.sort(key=lambda m: m.lines, reverse=True)
    return out[:top_n]


def scan_backend() -> BackendReport:
    rep = BackendReport()
    longest: list[FunctionMetric] = []
    for path in iter_backend_modules():
        rel = str(path.relative_to(REPO_ROOT))
        lines = count_lines(path)
        rep.modules.append(FileMetric(path=rel, lines=lines))
        rep.total_lines += lines
        rep.source_files += 1

        try:
            src = path.read_text(encoding="utf-8")
        except OSError:
            continue
        try:
            tree = ast.parse(src, filename=str(path))
        except SyntaxError:
            continue
        prints, tracebacks, silent = _count_python_smells(tree)
        rep.print_calls += prints
        rep.traceback_prints += tracebacks
        rep.silent_excepts += silent

        longest.extend(extract_longest_functions(path, top_n=3))

    rep.modules.sort(key=lambda m: m.lines, reverse=True)
    if rep.modules:
        rep.largest_module = rep.modules[0]
    longest.sort(key=lambda m: m.lines, reverse=True)
    rep.longest_functions = longest[:5]

    if BACKEND_TEST_ROOT.is_dir():
        rep.test_files = sum(
            1 for p in BACKEND_TEST_ROOT.rglob("test_*.py") if "__pycache__" not in p.parts
        )
    return rep


def scan_frontend() -> FrontendReport:
    rep = FrontendReport()
    for path in iter_frontend_sources():
        rel = str(path.relative_to(REPO_ROOT))
        lines = count_lines(path)
        rep.components.append(FileMetric(path=rel, lines=lines))
        rep.total_lines += lines
        rep.source_files += 1

        try:
            src = path.read_text(encoding="utf-8")
        except OSError:
            continue
        rep.any_types += len(ANY_TYPE_RE.findall(src))
        rep.ts_ignores += len(TS_IGNORE_RE.findall(src))
        rep.weak_casts += len(AS_UNKNOWN_RE.findall(src))
        rep.record_str_unknown += len(RECORD_STR_UNK_RE.findall(src))

    rep.components.sort(key=lambda m: m.lines, reverse=True)
    if rep.components:
        rep.largest_component = rep.components[0]
    rep.test_files = len(iter_frontend_tests())
    return rep


def build_report() -> QualityReport:
    return QualityReport(backend=scan_backend(), frontend=scan_frontend())


def to_markdown(report: QualityReport) -> str:
    be = report.backend
    fe = report.frontend
    lines = [
        "# Code-Quality Report",
        "",
        "_Auto-generated by `scripts/code_quality_report.py`. Do not edit by hand._",
        "",
        "## Backend (`expert_backend/`)",
        "",
        f"- Source files (non-test): **{be.source_files}**",
        f"- Total lines: **{be.total_lines}**",
    ]
    if be.largest_module:
        lines.append(
            f"- Largest module: `{be.largest_module.path}` ({be.largest_module.lines} lines)"
        )
    lines.extend(
        [
            f"- Test files: **{be.test_files}**",
            f"- `print(` calls in source: **{be.print_calls}**",
            f"- `traceback.print_exc()` calls: **{be.traceback_prints}**",
            f"- Bare `except Exception: pass` patterns: **{be.silent_excepts}**",
            "",
            "### Top-5 longest functions",
            "",
            "| File | Function | Lines |",
            "|------|----------|-------|",
        ]
    )
    for fn in be.longest_functions:
        lines.append(f"| `{fn.file}` | `{fn.name}` | {fn.lines} |")
    lines.extend(
        [
            "",
            "## Frontend (`frontend/src/`)",
            "",
            f"- Source files (non-test): **{fe.source_files}**",
            f"- Total lines: **{fe.total_lines}**",
        ]
    )
    if fe.largest_component:
        lines.append(
            f"- Largest component: `{fe.largest_component.path}` "
            f"({fe.largest_component.lines} lines)"
        )
    lines.extend(
        [
            f"- Test files: **{fe.test_files}**",
            f"- `any` type annotations: **{fe.any_types}**",
            f"- `@ts-ignore` directives: **{fe.ts_ignores}**",
            f"- `as unknown as` casts: **{fe.weak_casts}**",
            f"- `Record<string, unknown>` usages: **{fe.record_str_unknown}**",
            "",
        ]
    )
    return "\n".join(lines)


def _report_to_jsonable(report: QualityReport) -> dict:
    return {
        "backend": asdict(report.backend),
        "frontend": asdict(report.frontend),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, help="Write JSON report to this path")
    parser.add_argument(
        "--markdown",
        type=Path,
        help="Also write a human-readable Markdown report to this path",
    )
    parser.add_argument(
        "--summary",
        action="store_true",
        help="Print a one-line summary to stdout instead of the full JSON",
    )
    args = parser.parse_args(argv)

    report = build_report()
    payload = _report_to_jsonable(report)

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    if args.markdown:
        args.markdown.parent.mkdir(parents=True, exist_ok=True)
        args.markdown.write_text(to_markdown(report), encoding="utf-8")

    if args.summary:
        be = report.backend
        fe = report.frontend
        print(
            f"backend: {be.source_files} files, {be.total_lines} LoC, "
            f"largest={be.largest_module.lines if be.largest_module else 0} | "
            f"frontend: {fe.source_files} files, {fe.total_lines} LoC, "
            f"largest={fe.largest_component.lines if fe.largest_component else 0}"
        )
    elif not args.output:
        print(json.dumps(payload, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
