# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Overflow-file watcher helpers — stateless glob + mtime lookups.

The analysis pipeline writes an overflow-graph file (``.html`` since
``config.VISUALIZATION_FORMAT`` was switched to ``"html"``, or ``.pdf``
for legacy installs) into ``SAVE_FOLDER_VISUALIZATION``.  Streaming
endpoints poll that folder while the background thread runs, and emit a
``pdf`` event as soon as the file lands so the UI can render the
visualisation ahead of the full analysis result.
"""
from __future__ import annotations

import glob
import os

# Tiny safety margin added to `analysis_start_time` before filtering
# overflow files.  Prevents edge cases where the file was written a
# fraction of a second before the monotonic clock tick on hosts with
# clock drift or filesystem-level timestamp truncation.
_MTIME_SAFETY_MARGIN_S = 1.0

# Extensions we recognise as overflow-graph outputs.  HTML is the
# current format (interactive viewer shipped by expert_op4grid_recommender);
# PDF is retained so previously-saved sessions still load.
_OVERFLOW_PATTERNS = ("*.html", "*.pdf")


def find_latest_pdf(save_folder: str, analysis_start_time: float | None = None) -> str | None:
    """Return the most-recently-modified overflow file under ``save_folder``.

    Accepts both ``.html`` (current) and ``.pdf`` (legacy) outputs. When
    ``analysis_start_time`` is provided, only files newer than that
    monotonic timestamp (minus a 1-second safety margin) are considered —
    this prevents the poller from picking up a stale file left over from
    an earlier study that shares the same output folder.
    """
    candidates: list[str] = []
    for pattern in _OVERFLOW_PATTERNS:
        candidates.extend(glob.glob(os.path.join(save_folder, pattern)))
    if not candidates:
        return None
    if analysis_start_time is not None:
        cutoff = analysis_start_time - _MTIME_SAFETY_MARGIN_S
        candidates = [p for p in candidates if os.path.getmtime(p) >= cutoff]
        if not candidates:
            return None
    return max(candidates, key=os.path.getmtime)
