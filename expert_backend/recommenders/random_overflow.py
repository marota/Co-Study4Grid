# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Canonical example: random recommender that respects the overflow analysis.

Requires the step-2 overflow-graph build. Samples uniformly from actions
that (a) pass the expert rule validator AND (b) target an element on
the overflow-graph paths (dispatch / constrained / loop / hubs).
Useful as a "is the overflow analysis useful?" baseline.
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
from expert_backend.recommenders.overflow_path_filter import (
    restrict_to_overflow_paths,
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
                    "expert-rule-filtered candidate set restricted to "
                    "overflow-graph paths."
                ),
            ),
        ]

    def recommend(self, inputs: RecommenderInputs, params: dict) -> RecommenderOutput:
        n = int(params.get("n_prioritized_actions", 5))
        env = inputs.env

        # Layer 1 — expert rule filter (path-analysis-aware): drops
        # actions the expert validator rejects (wrong shape / already
        # open / etc.). Populated upstream by
        # ``_run_expert_action_filter`` whenever the model requests the
        # overflow graph.
        candidate_ids = inputs.filtered_candidate_actions
        if candidate_ids is None:
            logger.warning(
                "RandomOverflowRecommender: filtered_candidate_actions is None "
                "(expert rule filter did not run). Falling back to dict_action "
                "keys — expected ONLY when step-2 graph was skipped."
            )
            candidate_ids = list((inputs.dict_action or {}).keys())
        elif not candidate_ids:
            logger.info(
                "RandomOverflowRecommender: expert rule filter returned an "
                "empty candidate set. Returning {}."
            )
            return RecommenderOutput(prioritized_actions={})

        # Layer 2 — overflow-graph path filter: keep only actions
        # whose declared target lies on the dispatch / constrained /
        # loop / hub paths the expert discoverer would target. The
        # rule validator alone is too permissive — see
        # ``overflow_path_filter`` docstring.
        candidate_ids = restrict_to_overflow_paths(
            candidate_ids,
            inputs.dict_action,
            inputs.distribution_graph,
            inputs.obs,
            inputs.hubs,
        )
        if not candidate_ids:
            logger.info(
                "RandomOverflowRecommender: no candidate targets an overflow "
                "graph path; returning {}."
            )
            return RecommenderOutput(prioritized_actions={})

        # Layer 3 — network-existence filter: defensive drop of
        # actions whose target VL / line is not in the loaded network
        # (e.g. dict shipped for a larger grid).
        candidate_ids = filter_to_existing_network_elements(
            candidate_ids, inputs.dict_action, inputs.network,
        )
        if not candidate_ids:
            logger.info(
                "RandomOverflowRecommender: no remaining candidate after "
                "network-existence check; returning {}."
            )
            return RecommenderOutput(prioritized_actions={})

        # Materialise actions through env.action_space; drop entries
        # the action space rejects (third defensive line).
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
