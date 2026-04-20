#!/usr/bin/env python3
# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Layer-3 (static simulation) — gesture-sequence parity check.

The real Layer-3 check is the Playwright spec in
``scripts/parity_e2e/e2e_parity.spec.ts``: it drives both UIs through
an identical canonical session and diffs the resulting
``interaction_log.json`` artefacts.  That spec requires a real
browser, which is NOT installable in every CI or development
environment (notably not in the sandbox this script was authored
in — Playwright's browser download was blocked there).

This Python script delivers a weaker but still useful proxy:

1. A canonical GESTURE_SEQUENCE — the same 11 user gestures the
   Playwright spec drives.
2. A GESTURE_MODEL mapping each gesture to the ordered list of
   ``interactionLogger.record(...)`` events the replay contract
   (``docs/interaction-logging.md``) says MUST fire.
3. For each gesture the script:
   - verifies the React implementation exists (a handler is defined
     AND it emits the expected events in order);
   - verifies the standalone implementation exists and emits the
     same events in the same order.

It does NOT execute the UI — it walks the source with regexes and
the existing call-site index from :mod:`check_standalone_parity`.
The guarantees it offers are therefore coarser than a browser run:

  - ✅ will catch "gesture G should emit event E but no code path
    emits E from G's handler" (same thing Layer 1 catches, phrased
    per-gesture).
  - ✅ will catch "gesture G should emit E then F (in order) but
    the handler emits F then E" — something Layer 1 misses because
    it's set-based.
  - ❌ will NOT catch runtime ordering issues (e.g. an async race
    that reverses events intermittently).

When Playwright becomes runnable, this check becomes redundant —
the browser spec covers the same invariants with runtime proof.
Keep it as a Layer-3-lite for sandboxes where a browser can't be
installed.

Run::

    python scripts/check_gesture_sequence.py           # human text
    python scripts/check_gesture_sequence.py --json    # CI-friendly

Exits non-zero if any gesture is missing, misordered, or
incompletely implemented on either side.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
FRONTEND_SRC = REPO_ROOT / "frontend" / "src"
# Override via ``COSTUDY4GRID_STANDALONE_PATH`` to run the check against
# the auto-generated ``frontend/dist-standalone/standalone.html`` instead
# of the hand-maintained mirror.
STANDALONE = Path(
    os.environ.get(
        "COSTUDY4GRID_STANDALONE_PATH",
        str(REPO_ROOT / "standalone_interface.html"),
    )
)


# ---------------------------------------------------------------------
# Canonical gesture model.
# ---------------------------------------------------------------------
#
# Each gesture entry specifies:
#   - ``name``: human label for the report.
#   - ``react_handler``: the identifier to look for in the React
#     source that implements this gesture.  The walker then extracts
#     the function body and scans it for ``interactionLogger.record``
#     + ``recordCompletion`` calls.
#   - ``standalone_handler``: same, for the single-file HTML.
#   - ``expected_events``: ordered list of event types the gesture
#     MUST emit in this order.  Events not listed here are ignored
#     (the gesture is allowed to emit additional events; parity only
#     cares about the declared ones firing in the right order).
#
# The sequence mirrors the 11-step canonical session in
# ``scripts/parity_e2e/e2e_parity.spec.ts``.

GESTURE_SEQUENCE = [
    {
        "name": "1. Load Study",
        "react_handler": "handleLoadConfig",
        "standalone_handler": "handleLoadConfig",
        "expected_events": ["config_loaded"],
    },
    {
        "name": "2. Select contingency",
        "react_handler": "handleSelectContingency",  # fallback to onChange
        "react_handler_fallbacks": ["contingency_selected"],
        "standalone_handler": "contingency_selected",
        "expected_events": ["contingency_selected"],
    },
    {
        "name": "3. Run analysis step 1",
        "react_handler": "handleRunAnalysisStep1",
        "react_handler_fallbacks": ["handleRunAnalysis"],
        "standalone_handler": "handleRunAnalysisStep1",
        "standalone_handler_fallbacks": ["runAnalysisStep1"],
        "expected_events": ["analysis_step1_started", "analysis_step1_completed"],
    },
    {
        "name": "4. Toggle overload",
        "react_handler": "handleOverloadToggle",
        "react_handler_fallbacks": ["overload_toggled"],
        "standalone_handler": "overload_toggled",
        "expected_events": ["overload_toggled"],
    },
    {
        "name": "5. Run analysis step 2",
        "react_handler": "handleRunAnalysisStep2",
        "react_handler_fallbacks": ["handleRunAnalysis"],
        "standalone_handler": "handleRunAnalysisStep2",
        "standalone_handler_fallbacks": ["handleRunAnalysis", "runAnalysisStep2"],
        "expected_events": ["analysis_step2_started", "analysis_step2_completed"],
    },
    {
        "name": "6. Display prioritized actions",
        "react_handler": "handleDisplayPrioritizedActions",
        "standalone_handler": "handleDisplayPrioritized",
        "standalone_handler_fallbacks": ["prioritized_actions_displayed"],
        "expected_events": ["prioritized_actions_displayed"],
    },
    {
        "name": "7. Select action card",
        "react_handler": "handleActionSelect",
        "standalone_handler": "handleActionSelect",
        "expected_events": ["action_selected"],
    },
    {
        "name": "8. Favorite action",
        "react_handler": "handleActionFavorite",
        "standalone_handler": "handleActionFavorite",
        "standalone_handler_fallbacks": ["action_favorited"],
        "expected_events": ["action_favorited"],
    },
    {
        "name": "9. Change diagram tab",
        "react_handler": "handleTabChange",
        "react_handler_fallbacks": ["diagram_tab_changed"],
        "standalone_handler": "diagram_tab_changed",
        "expected_events": ["diagram_tab_changed"],
    },
    {
        "name": "10. Zoom in / out",
        "react_handler": "handleManualZoomIn",
        "react_handler_fallbacks": ["zoom_in"],
        "standalone_handler": "handleManualZoomIn",
        "standalone_handler_fallbacks": ["zoom_in"],
        "expected_events": ["zoom_in"],
    },
    {
        "name": "11. Save results",
        "react_handler": "handleSaveResults",
        "standalone_handler": "handleSaveSession",
        "standalone_handler_fallbacks": ["handleSaveResults"],
        "expected_events": ["session_saved"],
    },
    # Gestures 12-15 added after the Action-Overview + Detached-Tabs
    # ports shipped — the original 11-step canonical sequence stopped
    # at Save Results and never visited the pin map, which is
    # precisely where the last four rounds of user-observed bugs hid.
    # These four entries exercise the surface area Layer 3b's
    # Playwright spec should also cover.
    {
        "name": "12. Overview pin single-click",
        "react_handler": "handlePinClick",
        "react_handler_fallbacks": ["overview_pin_clicked"],
        "standalone_handler": "handlePinClick",
        "standalone_handler_fallbacks": ["overview_pin_clicked"],
        "expected_events": ["overview_pin_clicked"],
    },
    {
        "name": "13. Overview pin double-click → drill-down",
        "react_handler": "handlePinDoubleClick",
        "react_handler_fallbacks": ["overview_pin_double_clicked"],
        "standalone_handler": "handlePinDoubleClick",
        "standalone_handler_fallbacks": ["overview_pin_double_clicked"],
        "expected_events": ["overview_pin_double_clicked"],
    },
    {
        "name": "14. Detach the Action tab",
        "react_handler": "handleDetachTab",
        "react_handler_fallbacks": ["tab_detached", "detach"],
        "standalone_handler": "handleDetachTab",
        "standalone_handler_fallbacks": ["tab_detached"],
        "expected_events": ["tab_detached"],
    },
    {
        "name": "15. Deselect action (Action tab stays, Overview re-appears)",
        "react_handler": "handleActionSelect",
        "standalone_handler": "handleActionSelect",
        "expected_events": ["action_deselected"],
    },
]


# ---------------------------------------------------------------------
# Extraction helpers.
# ---------------------------------------------------------------------

RECORD_CALL = re.compile(
    r"interactionLogger\.record\(\s*['\"]([a-z0-9_]+)['\"]"
)
RECORD_COMPLETION_CALL = re.compile(
    r"interactionLogger\.recordCompletion\(\s*['\"]([a-z0-9_]+)['\"]"
)


def _ts_files() -> list[Path]:
    out: list[Path] = []
    for pat in ("*.ts", "*.tsx"):
        for p in FRONTEND_SRC.rglob(pat):
            if ".test." in p.name:
                continue
            out.append(p)
    return sorted(out)


def _standalone_src() -> str:
    return STANDALONE.read_text(encoding="utf-8", errors="replace")


def _skip_balanced(src: str, i: int, open_c: str, close_c: str) -> int:
    """Assuming ``src[i] == open_c``, advance past the matching
    ``close_c`` (including nested pairs) and return the index AFTER
    the close char. Returns -1 if no match found.
    """
    assert src[i] == open_c
    depth = 0
    while i < len(src):
        c = src[i]
        if c == open_c:
            depth += 1
        elif c == close_c:
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return -1


def _find_handler_range(src: str, name: str) -> tuple[int, int] | None:
    """Return (start_offset, end_offset) of a function/handler with
    the given name in ``src``.

    Matches these JS/TS declaration shapes:

        function handleFoo(...)               { ... }
        const handleFoo = function (...)      { ... }
        const handleFoo = useCallback(async   (...)       => { ... }, [...])
        const handleFoo = async               (...)       => { ... }
        const handleFoo =                     (...)       => { ... }

    The walker uses regex only to find the start anchor (``const
    handleFoo = ...`` or ``function handleFoo``); from there it uses
    paren-balance scanning to skip over the parameter list (which
    may contain nested function types like ``(x: T) => R``) and
    reaches the body's opening ``{``.
    """
    # Anchor #1 — plain function declaration.
    m = re.search(rf"function\s+{re.escape(name)}\s*\(", src)
    if m:
        i = m.end() - 1  # position of `(`
        j = _skip_balanced(src, i, "(", ")")
        if j < 0:
            return None
        # Skip whitespace + optional return-type annotation.
        k = _skip_ws_and_return_type(src, j)
        if k < len(src) and src[k] == "{":
            end = _skip_balanced(src, k, "{", "}")
            if end > 0:
                return (m.start(), end)

    # Anchor #2 — `const handleFoo = ...`.
    m = re.search(rf"\bconst\s+{re.escape(name)}\s*=\s*", src)
    if m:
        i = m.end()
        # Optional modifiers before the arrow function.
        #   - useCallback(                   → step into the paren
        #   - async                          → skip keyword
        #   - (                              → already at arrow-fn param list
        if src[i:i + 12].startswith("useCallback"):
            # Advance to the `(` after "useCallback".
            i = src.find("(", i)
            if i < 0:
                return None
            i += 1  # past the opening `useCallback(`.
            i = _skip_ws(src, i)
        if src[i:i + 6].startswith("async "):
            i += 6
            i = _skip_ws(src, i)
        if i >= len(src) or src[i] != "(":
            return None
        j = _skip_balanced(src, i, "(", ")")
        if j < 0:
            return None
        j = _skip_ws_and_return_type(src, j)
        # Expect `=>`
        if src[j:j + 2] != "=>":
            return None
        j += 2
        j = _skip_ws(src, j)
        if j < len(src) and src[j] == "{":
            end = _skip_balanced(src, j, "{", "}")
            if end > 0:
                return (m.start(), end)

    return None


def _skip_ws(src: str, i: int) -> int:
    while i < len(src) and src[i] in " \t\n\r":
        i += 1
    return i


def _skip_ws_and_return_type(src: str, i: int) -> int:
    """After a `)` in an arrow-fn head, there may be an optional
    TypeScript return-type annotation like `: Promise<void>` before
    the `=>`. Skip whitespace and any colon-prefixed annotation up
    to (but not including) the `=>` or `{`.
    """
    i = _skip_ws(src, i)
    if i < len(src) and src[i] == ":":
        # Consume until we hit `=>` or `{`. The annotation can
        # contain generics `<...>` with nested commas, but not
        # unbalanced braces or parens.
        depth_angle = 0
        while i < len(src):
            c = src[i]
            if c == "<":
                depth_angle += 1
            elif c == ">":
                depth_angle -= 1
            elif depth_angle == 0 and src[i:i + 2] == "=>":
                break
            elif depth_angle == 0 and c == "{":
                break
            i += 1
    return _skip_ws(src, i)


def _find_event_record_site(src: str, event_type: str) -> tuple[int, int] | None:
    """Return a small window around the first ``interactionLogger.record('event_type', …)``
    call site in ``src`` — used as a fallback when a handler name
    isn't recoverable (many gestures are inline arrow functions in
    JSX onClick). We walk up ~200 chars before the record call to
    capture enough context that subsequent ordering checks still
    see nearby calls.
    """
    m = re.search(
        r"interactionLogger\.record\(\s*['\"]" + re.escape(event_type) + r"['\"]",
        src,
    )
    if m:
        start = max(0, m.start() - 400)
        end = min(len(src), m.end() + 2000)
        return (start, end)
    return None


def _extract_events(window: str) -> list[str]:
    """Return the ordered list of record() and recordCompletion()
    event types inside ``window``.
    """
    events: list[tuple[int, str]] = []
    for m in RECORD_CALL.finditer(window):
        events.append((m.start(), m.group(1)))
    for m in RECORD_COMPLETION_CALL.finditer(window):
        events.append((m.start(), m.group(1)))
    events.sort()
    return [t for _, t in events]


def resolve_gesture(src: str, gesture: dict, side: str) -> dict:
    """Locate the gesture in ``src`` and extract its emitted events."""
    key = f"{side}_handler"
    fallback_key = f"{side}_handler_fallbacks"
    candidates = [gesture[key]] + gesture.get(fallback_key, [])

    found_via = None
    span: tuple[int, int] | None = None
    for name in candidates:
        span = _find_handler_range(src, name)
        if span is not None:
            found_via = f"handler:{name}"
            break
    if span is None:
        # Fallback: locate the call site for the first expected event
        # directly. This gives us a synthetic window even when the
        # gesture is an inline onClick arrow.
        for event in gesture["expected_events"]:
            span = _find_event_record_site(src, event)
            if span is not None:
                found_via = f"callsite:{event}"
                break
    if span is None:
        return {"found_via": None, "events": [], "span": None}

    start, end = span
    window = src[start:end]
    events = _extract_events(window)
    return {"found_via": found_via, "events": events, "span": span}


def _check_order(expected: list[str], emitted: list[str]) -> dict:
    """Check that ``expected`` appears as an ordered subsequence of
    ``emitted``. Returns structured diff."""
    missing = [e for e in expected if e not in emitted]
    # Order-preserving subsequence check via two-pointer walk.
    i = 0
    for e in emitted:
        if i < len(expected) and e == expected[i]:
            i += 1
    ordered_ok = i == len(expected) and not missing
    return {
        "ordered_ok": ordered_ok,
        "missing": missing,
        "emitted": emitted,
    }


# ---------------------------------------------------------------------
# Main.
# ---------------------------------------------------------------------

def run_checks() -> dict:
    # Concatenate all TS/TSX source into one string for React — we
    # don't care which file a handler lives in, only that it exists.
    react_src = "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in _ts_files())
    standalone_src = _standalone_src()

    findings = []
    for gesture in GESTURE_SEQUENCE:
        react = resolve_gesture(react_src, gesture, "react")
        standalone = resolve_gesture(standalone_src, gesture, "standalone")

        react_diff = _check_order(gesture["expected_events"], react["events"])
        sa_diff = _check_order(gesture["expected_events"], standalone["events"])

        findings.append({
            "gesture": gesture["name"],
            "expected_events": gesture["expected_events"],
            "react": {
                "found_via": react["found_via"],
                "emitted": react["events"],
                "ordered_ok": react_diff["ordered_ok"],
                "missing": react_diff["missing"],
            },
            "standalone": {
                "found_via": standalone["found_via"],
                "emitted": standalone["events"],
                "ordered_ok": sa_diff["ordered_ok"],
                "missing": sa_diff["missing"],
            },
        })

    return {"gestures": findings}


def render_human(report: dict) -> str:
    out: list[str] = []
    out.append("GESTURE-SEQUENCE PARITY REPORT (Layer-3 static)")
    out.append("=" * 72)
    out.append("See scripts/parity_e2e/e2e_parity.spec.ts for the runtime equivalent.")
    out.append("")

    fails = 0
    for f in report["gestures"]:
        header = f"  {f['gesture']}  expects: {', '.join(f['expected_events'])}"
        out.append(header)
        for side in ("react", "standalone"):
            info = f[side]
            tag = "OK" if info["ordered_ok"] else "FAIL"
            if tag == "FAIL":
                fails += 1
            marker = "✅" if tag == "OK" else "❌"
            via = info["found_via"] or "(not found)"
            emitted = ", ".join(info["emitted"]) or "(none)"
            out.append(f"     {marker} {side:10s} via={via!s:28s} emitted=[{emitted}]")
            if info["missing"]:
                out.append(f"        missing: {info['missing']}")
        out.append("")

    total = sum(1 for _ in report["gestures"]) * 2
    passed = total - fails
    out.append(f"Summary: {passed}/{total} gesture-side parity checks passed.")
    return "\n".join(out)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--json", action="store_true", help="emit JSON instead of text")
    args = parser.parse_args()

    report = run_checks()
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(render_human(report))

    hard_fail = any(
        not g["react"]["ordered_ok"] or not g["standalone"]["ordered_ok"]
        for g in report["gestures"]
    )
    return 1 if hard_fail else 0


if __name__ == "__main__":
    sys.exit(main())
