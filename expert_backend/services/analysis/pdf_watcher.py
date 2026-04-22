# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""PDF-file watcher helpers — stateless glob + mtime lookups.

The analysis pipeline writes an overflow-graph PDF into
``SAVE_FOLDER_VISUALIZATION``.  Streaming endpoints poll that folder
while the background thread runs, and emit a ``pdf`` event as soon as
the file lands so the UI can render the visualisation ahead of the
full analysis result.
"""
from __future__ import annotations

import glob
import os

# Tiny safety margin added to `analysis_start_time` before filtering
# PDFs.  Prevents edge cases where the PDF was written a fraction of a
# second before the monotonic clock tick on hosts with clock drift or
# filesystem-level timestamp truncation.
_MTIME_SAFETY_MARGIN_S = 1.0


def find_latest_pdf(save_folder: str, analysis_start_time: float | None = None) -> str | None:
    """Return the most-recently-modified ``*.pdf`` under ``save_folder``.

    When ``analysis_start_time`` is provided, only PDFs newer than that
    monotonic timestamp (minus a 1-second safety margin) are considered —
    this prevents the poller from picking up a stale PDF left over from
    an earlier study that shares the same output folder.
    """
    pdfs = glob.glob(os.path.join(save_folder, "*.pdf"))
    if not pdfs:
        return None
    if analysis_start_time is not None:
        cutoff = analysis_start_time - _MTIME_SAFETY_MARGIN_S
        pdfs = [p for p in pdfs if os.path.getmtime(p) >= cutoff]
        if not pdfs:
            return None
    return max(pdfs, key=os.path.getmtime)
