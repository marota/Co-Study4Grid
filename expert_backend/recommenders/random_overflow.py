# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Canonical example: random recommender that respects the overflow analysis.

Requires the step-2 overflow-graph build. Samples uniformly from the
actions retained by the expert rule filter
(``context['filtered_candidate_actions']``), so the random pick
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

from expert_backend.recommenders.network_existence import (
    filter_to_existing_network_elements,
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

        # The pipeline runs the expert rule filter when the model
        # declares ``requires_overflow_graph=True``, so this is
        # populated whenever step-2 graph was produced. We do NOT
        # silently fall back to ``dict_action.keys()`` when the
        # filter returned an empty set — that would defeat the point
        # of the model (sampling within the reduced action space).
        # When the field is None (filter genuinely wasn't run), log
        # and fall back so the model still produces something for the
        # operator to inspect, but flag it so the regression is visible
        # in logs.
        candidate_ids = inputs.filtered_candidate_actions
        if candidate_ids is None:
            logger.warning(
                "RandomOverflowRecommender: filtered_candidate_actions is None "
                "(expert rule filter did not run). Falling back to the full "
                "action dictionary — expected ONLY when step-2 graph was skipped."
            )
            candidate_ids = list((inputs.dict_action or {}).keys())
        elif not candidate_ids:
            logger.info(
                "RandomOverflowRecommender: expert rule filter returned an "
                "empty candidate set for this contingency. Returning {} "
                "rather than sampling from outside the reduced action space."
            )
            return RecommenderOutput(prioritized_actions={})

        # Defensive existence check: drop actions whose target VL or
        # line is unknown to the loaded network. The expert rule
        # validator filters by overflow-graph paths but doesn't
        # verify that an action's targets actually live on this
        # network — so dict entries left over from a larger grid
        # would otherwise leak through as "Network element not found"
        # errors when the operator clicks the action card.
        candidate_ids = filter_to_existing_network_elements(
            candidate_ids, inputs.dict_action, inputs.network,
        )
        if not candidate_ids:
            logger.info(
                "RandomOverflowRecommender: no candidate action targets a "
                "network element present in the loaded grid. Returning {}."
            )
            return RecommenderOutput(prioritized_actions={})

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
