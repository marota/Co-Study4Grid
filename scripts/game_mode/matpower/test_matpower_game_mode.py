# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
"""Tests for the France EHV (Matpower) game-mode tooling: the scenario-database
builder (build_scenarios.py), the player-facing projection
(gen_matpower_presets.py), the compressed-network transport
(network.xiidm.gz.b64), and consistency between the graded database, the shipped
frontend JSON and the per-grid on-disk assets.

Hermetic — stdlib only, no pypowsybl and no network load. The tests that read
the committed data skip when the family has not been built in this checkout.
"""
from __future__ import annotations

import base64
import gzip
import importlib.util
import json
from pathlib import Path

import pytest

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
DATA = REPO / "data" / "rte_matpower"
GRIDS = DATA / "grids"
FRONTEND_JSON = REPO / "frontend" / "src" / "game" / "matpowerScenarios.json"
DIFFICULTIES = ("easy", "medium", "hard")


def _load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


builder = _load("build_scenarios")
presets = _load("gen_matpower_presets")


# --------------------------------------------------------------------------- #
# build_scenarios.py — pure logic, on a synthetic family
# --------------------------------------------------------------------------- #
def _family(tmp_path, graded_rows, contingencies=None):
    """A minimal on-disk family: one grid, its mapping, N-1 file and grading."""
    gid = "grid_deadbeef"
    (tmp_path / "grids" / gid).mkdir(parents=True)
    (tmp_path / "mapping_private.json").write_text(json.dumps({gid: {
        "case_label": "case6515rte", "case_date": "2013-01-18T19:00",
        "period_title": "January — Friday evening",
    }}))
    conts = contingencies if contingencies is not None else [{
        "tripped_line": "LINE-1-2", "max_loading_pct": 137.5, "antenna": False,
        "overloaded_lines": [{"line_id": "LINE-3-4"}],
    }]
    (tmp_path / "grids" / gid / "n1_contingencies.json").write_text(
        json.dumps({"total_contingencies_tested": 100, "contingencies": conts}))
    (tmp_path / "grids" / gid / "graded.jsonl").write_text(
        "\n".join(json.dumps(r) for r in graded_rows))
    return gid


def test_build_keeps_only_playable_verdicts(tmp_path):
    """A `trivial` contingency (nothing overloads once the recommender applies
    the monitoring factor and the base-relative rule) is not a game case, and
    neither is a non-converged one."""
    _family(tmp_path, [
        {"contingency_id": "LINE-1-2", "difficulty": "medium", "n_overloads": 1,
         "n_actions": 12, "solution": {"kind": "pair", "max_rho": 0.94}},
        {"contingency_id": "LINE-5-6", "difficulty": "trivial", "n_overloads": 0},
        {"contingency_id": "LINE-7-8", "difficulty": "non_converged"},
    ])
    db = builder.build(tmp_path)
    assert db["n_scenarios"] == 1
    assert db["counts"] == {"easy": 0, "medium": 1, "hard": 0}
    assert db["skipped"] == {"trivial": 1, "non_converged": 1}


def test_build_projects_the_full_scenario_record(tmp_path):
    _family(tmp_path, [{
        "contingency_id": "LINE-1-2", "difficulty": "easy", "n_overloads": 1,
        "overloaded_lines": ["LINE-3-4"], "n_actions": 15,
        "solution": {"kind": "unitary", "action": "disco_LINE-3-4", "max_rho": 0.0},
    }])
    s = builder.build(tmp_path)["scenarios"][0]
    assert s["difficulty"] == "easy"
    assert s["contingencyElementId"] == "LINE-1-2"
    assert s["baselineMaxLoadingPct"] == 137.5
    assert s["overloadedLines"] == ["LINE-3-4"]
    assert s["nActionsDiscovered"] == 15
    assert s["bestAchievableLoadingPct"] == 0.0
    assert s["title"] == "January — Friday evening"
    assert s["networkPath"].endswith("grid_deadbeef/network.xiidm")


def test_build_prefers_the_recommender_view_of_the_overloads(tmp_path):
    """The session is judged against what the RECOMMENDER sees, so its list
    wins over the screening's when both are present."""
    _family(tmp_path, [{
        "contingency_id": "LINE-1-2", "difficulty": "hard", "n_overloads": 2,
        "overloaded_lines": ["LINE-9-9", "LINE-8-8"], "solution": {},
    }])
    assert builder.build(tmp_path)["scenarios"][0]["overloadedLines"] == \
        ["LINE-9-9", "LINE-8-8"]


def test_build_falls_back_to_the_screening_list(tmp_path):
    """Records graded before `overloaded_lines` was persisted still build."""
    _family(tmp_path, [{"contingency_id": "LINE-1-2", "difficulty": "hard",
                        "n_overloads": 1, "solution": {}}])
    assert builder.build(tmp_path)["scenarios"][0]["overloadedLines"] == \
        ["LINE-3-4"]


def test_scenario_ids_are_stable_across_rebuilds(tmp_path):
    """Sessions and retained solutions key on the scenario id: the same grid
    and contingency must yield the same id every time it is rebuilt."""
    rows = [{"contingency_id": "LINE-1-2", "difficulty": "easy",
             "n_overloads": 1, "solution": {}}]
    _family(tmp_path, rows)
    first = builder.build(tmp_path)["scenarios"][0]["id"]
    second = builder.build(tmp_path)["scenarios"][0]["id"]
    assert first == second
    assert first.startswith("s_deadbeef_")
    assert builder.scenario_id("grid_deadbeef", "LINE-1-2") != \
        builder.scenario_id("grid_deadbeef", "LINE-9-9")


def test_build_takes_the_last_grading_of_a_contingency(tmp_path):
    """graded.jsonl is append-only and a re-run re-grades: last write wins,
    otherwise a corrected verdict would be shadowed by the stale one."""
    _family(tmp_path, [
        {"contingency_id": "LINE-1-2", "difficulty": "hard", "solution": {}},
        {"contingency_id": "LINE-1-2", "difficulty": "easy", "solution": {}},
    ])
    assert builder.build(tmp_path)["counts"] == {"easy": 1, "medium": 0, "hard": 0}


def test_build_reports_the_monitoring_regime(tmp_path):
    _family(tmp_path, [{"contingency_id": "LINE-1-2", "difficulty": "easy",
                        "solution": {}}])
    db = builder.build(tmp_path)
    assert db["monitoring_factor"] == 0.95
    assert "95%" in db["description"] or "95 %" in db["description"]


def test_build_on_an_ungraded_family_is_empty_not_broken(tmp_path):
    _family(tmp_path, [])
    db = builder.build(tmp_path)
    assert db["n_scenarios"] == 0
    assert db["scenarios"] == []


def test_best_rho_drops_the_sentinel(tmp_path):
    """`hard` records carry a 9e9 sentinel for "no action found"; surfacing it
    as a loading percentage would show the player 9e11 %."""
    assert builder._best_rho({"max_rho": 9e9}) is None
    assert builder._best_rho({}) is None
    assert builder._best_rho({"max_rho": 0.941}) == 94.1


# --------------------------------------------------------------------------- #
# gen_matpower_presets.py — the player-facing projection
# --------------------------------------------------------------------------- #
def test_projection_hides_the_solution_and_the_date():
    study = presets.to_study({
        "id": "s_x_1", "title": "January — Friday evening",
        "label": "January — Friday evening — LINE-1-2",
        "networkPath": "n", "actionFilePath": "a", "layoutPath": "l",
        "contingencyElementId": "LINE-1-2", "contingencyLabel": "LINE-1-2",
        "baselineMaxLoadingPct": 137.5,
        "solution": {"kind": "unitary", "action": "disco_LINE-3-4"},
        "difficulty": "easy",
    })
    assert "solution" not in study
    assert "difficulty" not in study
    assert "2013" not in json.dumps(study)
    assert "137.5%" in study["description"]


# --------------------------------------------------------------------------- #
# The committed family (skipped when not built in this checkout)
# --------------------------------------------------------------------------- #
requires_family = pytest.mark.skipif(
    not (DATA / "scenarios.json").exists(),
    reason="famille Matpower non construite dans ce checkout")


@requires_family
def test_every_grid_ships_a_decodable_network():
    encoded = sorted(GRIDS.glob("*/network.xiidm.gz.b64"))
    assert encoded, "aucun network.xiidm.gz.b64 committé"
    for enc in encoded:
        xml = gzip.decompress(base64.b64decode(enc.read_bytes()))
        assert xml.lstrip().startswith(b"<?xml"), f"{enc} ne décode pas en XML"
        assert b"<iidm:network" in xml[:4000] or b"<network" in xml[:4000]


@requires_family
def test_every_grid_ships_its_playable_assets():
    for grid in sorted(p for p in GRIDS.iterdir() if p.is_dir()):
        for name in ("actions.json", "grid_layout.json",
                     "n1_contingencies.json", "network.xiidm.gz.b64"):
            assert (grid / name).is_file(), f"{grid.name}: {name} manquant"


@requires_family
def test_frontend_json_matches_the_graded_database():
    db = json.loads((DATA / "scenarios.json").read_text())
    front = json.loads(FRONTEND_JSON.read_text())
    assert set(front) == set(DIFFICULTIES)
    for level in DIFFICULTIES:
        assert len(front[level]) == db["counts"][level], (
            f"{level}: frontend {len(front[level])} != base {db['counts'][level]}"
            " — regénérer gen_matpower_presets.py")


@requires_family
def test_frontend_never_leaks_the_solution_or_the_year():
    front = json.loads(FRONTEND_JSON.read_text())
    blob = json.dumps(front)
    assert '"solution"' not in blob
    assert "2013" not in blob, "la date réelle des cas fuit côté client"


@requires_family
def test_scenarios_reference_existing_grid_assets():
    db = json.loads((DATA / "scenarios.json").read_text())
    for s in db["scenarios"]:
        grid = GRIDS / s["gridId"]
        assert (grid / "actions.json").is_file()
        assert (grid / "grid_layout.json").is_file()
        # the network ships encoded; the decoded file is a build artifact
        assert (grid / "network.xiidm.gz.b64").is_file()
        assert s["networkPath"] == \
            f"data/rte_matpower/grids/{s['gridId']}/network.xiidm"
