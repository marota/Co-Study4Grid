# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0

"""Decomposition helpers for ``analysis_mixin.py``.

The mixin used to be a ~1,100-line class; the heavy-lifting was pulled
into focused modules here so the orchestrator stays small and each
concern becomes independently testable:

- :mod:`pdf_watcher` — glob-based search for overflow PDFs
- :mod:`action_enrichment` — per-action detail computations (load
  shedding / curtailment / PST) — pure functions
- :mod:`mw_start_scoring` — MW-at-start computation per action type
- :mod:`analysis_runner` — legacy AC→DC fallback runner with PDF
  polling (streams NDJSON events)
"""
