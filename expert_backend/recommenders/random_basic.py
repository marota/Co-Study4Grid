# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Canonical example: a baseline random recommender.

Does NOT need the overflow-graph step. Samples uniformly from the
operator's action dictionary, augmented at runtime with simple
reconnection / load-shedding / curtailment actions derived from the
post-fault observation. Useful as a sanity-check baseline against
the expert system.
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

from expert_backend.recommenders.synthetic_actions import (
    build_curtailment_actions,
    build_load_shedding_actions,
    build_reconnection_actions,
)

logger = logging.getLogger(__name__)


class RandomRecommender(RecommenderModel):
    name = "random"
    label = "Random"
    requires_overflow_graph = False

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
                description="Total number of actions sampled uniformly.",
            ),
        ]

    def recommend(self, inputs: RecommenderInputs, params: dict) -> RecommenderOutput:
        n = int(params.get("n_prioritized_actions", 5))
        env = inputs.env
        obs = inputs.obs_defaut

        pool: Dict[str, Any] = {}
        # Materialise dict_action entries into grid2op/pypowsybl actions.
        # Entries without a usable `content` field are skipped.
        for action_id, desc in (inputs.dict_action or {}).items():
            content = desc.get("content") if isinstance(desc, dict) else None
            if content is None:
                continue
            try:
                pool[action_id] = env.action_space(content)
            except Exception as e:
                logger.debug("Skipping dict action %s: %s", action_id, e)

        # Augment with synthetic reconnection / shedding / curtailment.
        pool.update(build_reconnection_actions(env, inputs.non_connected_reconnectable_lines))
        pool.update(build_load_shedding_actions(env, obs))
        pool.update(build_curtailment_actions(env, obs))

        if not pool:
            logger.warning("RandomRecommender: empty action pool, returning {}")
            return RecommenderOutput(prioritized_actions={})

        chosen_ids = random.sample(list(pool.keys()), min(n, len(pool)))
        return RecommenderOutput(
            prioritized_actions={aid: pool[aid] for aid in chosen_ids},
            action_scores={},
        )
