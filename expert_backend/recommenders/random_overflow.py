# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Canonical example: random recommender that respects the overflow analysis.

Requires the step-2 overflow-graph build. Samples uniformly from the
actions retained by the expert rule filter
(``context["filtered_candidate_actions"]``), so the random pick
benefits from the topological analysis without inheriting the expert
scoring. Useful as a "is the overflow analysis useful?" baseline.
"""
from __future__ import annotations

import logging
import random
from typing import Any, Dict, List

from expert_op4grid_recommender.models.base import (
    ParamSpec,
    RecommenderInputs,
    RecommenderModel,
    RecommenderOutput,
)

logger = logging.getLogger(__name__)


class RandomOverflowRecommender(RecommenderModel):
    name = "random_overflow"
    label = "Random (post overflow analysis)"
    requires_overflow_graph = True

    @classmethod
    def params_spec(cls) -> List[ParamSpec]:
        return [
            ParamSpec(
                "n_prioritized_actions",
                "N Prioritized Actions",
                "int",
                default=5,
                min=1,
                max=50,
                description=(
                    "Number of actions sampled uniformly from the "
                    "expert-rule-filtered candidate set."
                ),
            ),
        ]

    def recommend(self, inputs: RecommenderInputs, params: dict) -> RecommenderOutput:
        n = int(params.get("n_prioritized_actions", 5))
        env = inputs.env

        # Prefer the filtered set from the expert rules; fall back to
        # the whole dictionary when the upstream pipeline did not
        # populate it (e.g. step-2 graph skipped).
        candidate_ids = inputs.filtered_candidate_actions
        if not candidate_ids:
            logger.warning(
                "RandomOverflowRecommender: no filtered candidates available, "
                "falling back to the full action dictionary."
            )
            candidate_ids = list((inputs.dict_action or {}).keys())

        pool: Dict[str, Any] = {}
        for action_id in candidate_ids:
            desc = (inputs.dict_action or {}).get(action_id)
            if not isinstance(desc, dict):
                continue
            content = desc.get("content")
            if content is None:
                continue
            try:
                pool[action_id] = env.action_space(content)
            except Exception as e:
                logger.debug("Skipping candidate %s: %s", action_id, e)

        if not pool:
            logger.warning("RandomOverflowRecommender: empty pool, returning {}")
            return RecommenderOutput(prioritized_actions={})

        chosen_ids = random.sample(list(pool.keys()), min(n, len(pool)))
        return RecommenderOutput(
            prioritized_actions={aid: pool[aid] for aid in chosen_ids},
            action_scores={},
        )
