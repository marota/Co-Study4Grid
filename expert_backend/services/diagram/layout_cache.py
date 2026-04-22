# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""`(path, mtime)`-keyed loader for ``grid_layout.json``.

The DataFrame is cached on the caller's instance via a ``get_cache``
/ ``set_cache`` callable pair — the caller (the mixin) owns
per-study state. Repeated NAD generations within the same process
reuse the parsed DataFrame instead of re-reading the JSON + rebuilding
pandas (~50-150 ms saved per call on large grids).

Cache auto-invalidates when the layout file is modified.
"""
from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger(__name__)


def load_layout(
    layout_file: Path | None,
    get_cache: Callable[[], Any],
    set_cache: Callable[[Any], None],
):
    """Return the cached (or freshly parsed) layout DataFrame, or ``None``.

    ``layout_file`` is the absolute path to ``grid_layout.json``. The
    callable pair (``get_cache``, ``set_cache``) stores the tuple
    ``((path_str, mtime), DataFrame)`` on the caller.
    """
    import pandas as pd

    if not layout_file or not layout_file.exists():
        return None

    try:
        mtime = layout_file.stat().st_mtime
    except OSError as e:
        logger.warning("Warning: Could not stat layout: %s", e)
        return None

    cache_key = (str(layout_file), mtime)
    cached = get_cache()
    if cached is not None and cached[0] == cache_key:
        return cached[1]

    try:
        with open(layout_file, "r") as f:
            layout_data = json.load(f)
        records = [{"id": k, "x": v[0], "y": v[1]} for k, v in layout_data.items()]
        df = pd.DataFrame(records).set_index("id")
        set_cache((cache_key, df))
        return df
    except Exception as e:
        logger.warning("Warning: Could not load layout: %s", e)
        return None
