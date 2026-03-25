"""Tests for _compute_mw_start_for_scores and _get_action_mw_start."""

import numpy as np
import pytest
from unittest.mock import MagicMock

from expert_backend.services.recommender_service import RecommenderService


def _make_obs(name_line, p_or, name_load=None, load_p=None):
    """Helper to build a mock N-1 observation."""
    obs = MagicMock()
    obs.name_line = name_line
    obs.p_or = np.array(p_or, dtype=float)
    obs.name_load = name_load or []
    obs.load_p = np.array(load_p or [], dtype=float)
    return obs


def _make_service_with_context(obs_n1, dict_action):
    """Build a RecommenderService with a minimal analysis context and action dict."""
    svc = RecommenderService()
    svc._analysis_context = {"obs_simu_defaut": obs_n1}
    svc._dict_action = dict_action
    return svc


class TestComputeMwStartNoContext:
    def test_returns_unchanged_when_no_context(self):
        svc = RecommenderService()
        svc._analysis_context = None

        scores = {"line_disconnection": {"scores": {"act1": 0.9}}}
        result = svc._compute_mw_start_for_scores(scores)

        # No mw_start key added
        assert "mw_start" not in result["line_disconnection"]

    def test_returns_unchanged_when_no_obs_in_context(self):
        svc = RecommenderService()
        svc._analysis_context = {}  # missing obs_simu_defaut

        scores = {"line_disconnection": {"scores": {"act1": 0.9}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert "mw_start" not in result["line_disconnection"]

    def test_empty_scores_returns_unchanged(self):
        svc = RecommenderService()
        svc._analysis_context = {"obs_simu_defaut": _make_obs([], [])}
        svc._dict_action = {}

        result = svc._compute_mw_start_for_scores({})
        assert result == {}


class TestMwStartLineDisconnection:
    def test_extracts_abs_p_or_for_disconnected_line(self):
        obs = _make_obs(["LINE_A", "LINE_B"], [120.5, -80.0])
        dict_action = {
            "disco_LINE_A": {
                "content": {
                    "set_bus": {"lines_or_id": {"LINE_A": -1}}
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"line_disconnection": {"scores": {"disco_LINE_A": 0.9}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["line_disconnection"]["mw_start"]["disco_LINE_A"] == pytest.approx(120.5, abs=0.1)

    def test_negative_p_or_returns_abs_value(self):
        obs = _make_obs(["LINE_B"], [-75.3])
        dict_action = {
            "disco_LINE_B": {
                "content": {
                    "set_bus": {"lines_ex_id": {"LINE_B": -1}}
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"line_disconnection": {"scores": {"disco_LINE_B": 0.7}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["line_disconnection"]["mw_start"]["disco_LINE_B"] == pytest.approx(75.3, abs=0.1)

    def test_unknown_line_returns_none(self):
        obs = _make_obs(["LINE_C"], [50.0])
        dict_action = {
            "disco_UNKNOWN": {
                "content": {
                    "set_bus": {"lines_or_id": {"UNKNOWN_LINE": -1}}
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"line_disconnection": {"scores": {"disco_UNKNOWN": 0.5}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["line_disconnection"]["mw_start"]["disco_UNKNOWN"] is None

    def test_missing_action_returns_none(self):
        obs = _make_obs(["LINE_A"], [100.0])
        svc = _make_service_with_context(obs, {})  # action not in dict

        scores = {"line_disconnection": {"scores": {"disco_LINE_A": 0.8}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["line_disconnection"]["mw_start"]["disco_LINE_A"] is None


class TestMwStartPst:
    def test_extracts_p_or_for_pst_line(self):
        obs = _make_obs(["PST_1", "LINE_X"], [200.0, 50.0])
        dict_action = {
            "pst_tap_PST_1_inc1": {
                "content": {
                    "pst_tap": {"PST_1": 5}
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"pst_tap_change": {"scores": {"pst_tap_PST_1_inc1": 0.85}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["pst_tap_change"]["mw_start"]["pst_tap_PST_1_inc1"] == pytest.approx(200.0, abs=0.1)

    def test_pst_not_in_obs_returns_none(self):
        obs = _make_obs(["LINE_A"], [100.0])
        dict_action = {
            "pst_inc": {
                "content": {"pst_tap": {"PST_NOT_IN_OBS": 3}}
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"pst_tap_change": {"scores": {"pst_inc": 0.6}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["pst_tap_change"]["mw_start"]["pst_inc"] is None


class TestMwStartLoadShedding:
    def test_extracts_load_p_for_shed_load(self):
        obs = _make_obs([], [], name_load=["LOAD_1", "LOAD_2"], load_p=[150.0, 80.0])
        dict_action = {
            "load_shedding_LOAD_1": {
                "content": {
                    "set_bus": {"loads_id": {"LOAD_1": -1}}
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"load_shedding": {"scores": {"load_shedding_LOAD_1": 0.4}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["load_shedding"]["mw_start"]["load_shedding_LOAD_1"] == pytest.approx(150.0, abs=0.1)

    def test_sums_multiple_shed_loads(self):
        obs = _make_obs([], [], name_load=["L1", "L2", "L3"], load_p=[60.0, 40.0, 20.0])
        dict_action = {
            "ls_multi": {
                "content": {
                    "set_bus": {"loads_id": {"L1": -1, "L2": -1, "L3": 1}}  # L3 not shed
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"load_shedding": {"scores": {"ls_multi": 0.3}}}
        result = svc._compute_mw_start_for_scores(scores)

        # L1 + L2 = 100.0 (L3 kept on bus 1, not shed)
        assert result["load_shedding"]["mw_start"]["ls_multi"] == pytest.approx(100.0, abs=0.1)

    def test_no_shed_loads_returns_none(self):
        obs = _make_obs([], [], name_load=["LOAD_X"], load_p=[50.0])
        dict_action = {
            "ls_none": {
                "content": {
                    "set_bus": {"loads_id": {"LOAD_X": 1}}  # bus=1, not -1
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"load_shedding": {"scores": {"ls_none": 0.5}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["load_shedding"]["mw_start"]["ls_none"] is None


class TestMwStartOpenCoupling:
    def test_sums_abs_p_or_for_moved_lines(self):
        obs = _make_obs(["LINE_1", "LINE_2", "LINE_3"], [100.0, -60.0, 30.0])
        dict_action = {
            "open_coupling_act": {
                "content": {
                    "set_bus": {
                        "lines_or_id": {"LINE_1": 2},  # moved to bus 2
                        "lines_ex_id": {"LINE_2": 2},  # moved to bus 2
                    }
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"open_coupling": {"scores": {"open_coupling_act": 0.75}}}
        result = svc._compute_mw_start_for_scores(scores)

        # |100| + |-60| = 160
        assert result["open_coupling"]["mw_start"]["open_coupling_act"] == pytest.approx(160.0, abs=0.1)

    def test_no_lines_in_action_returns_none(self):
        obs = _make_obs(["LINE_A"], [50.0])
        dict_action = {
            "open_coupling_empty": {
                "content": {"set_bus": {}}  # no lines_or_id / lines_ex_id
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"open_coupling": {"scores": {"open_coupling_empty": 0.5}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["open_coupling"]["mw_start"]["open_coupling_empty"] is None


class TestMwStartNaTypes:
    def test_line_reconnection_is_null(self):
        obs = _make_obs(["LINE_A"], [100.0])
        dict_action = {
            "reco_LINE_A": {
                "content": {
                    "set_bus": {"lines_or_id": {"LINE_A": 1}}
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"line_reconnection": {"scores": {"reco_LINE_A": 0.8}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["line_reconnection"]["mw_start"]["reco_LINE_A"] is None

    def test_close_coupling_is_null(self):
        obs = _make_obs(["LINE_A"], [100.0])
        dict_action = {
            "close_coupling_act": {
                "content": {
                    "set_bus": {"lines_or_id": {"LINE_A": 1}}
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"close_coupling": {"scores": {"close_coupling_act": 0.6}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["close_coupling"]["mw_start"]["close_coupling_act"] is None


class TestComputeMwStartMultipleTypes:
    def test_all_types_processed_in_one_call(self):
        obs = _make_obs(
            ["LINE_A", "PST_X"],
            [120.0, 90.0],
            name_load=["LOAD_1"],
            load_p=[75.0],
        )
        dict_action = {
            "disco_LINE_A": {"content": {"set_bus": {"lines_or_id": {"LINE_A": -1}}}},
            "reco_LINE_A": {"content": {"set_bus": {"lines_or_id": {"LINE_A": 1}}}},
            "pst_PST_X_inc1": {"content": {"pst_tap": {"PST_X": 3}}},
            "ls_LOAD_1": {"content": {"set_bus": {"loads_id": {"LOAD_1": -1}}}},
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {
            "line_disconnection": {"scores": {"disco_LINE_A": 0.9}},
            "line_reconnection": {"scores": {"reco_LINE_A": 0.7}},
            "pst_tap_change": {"scores": {"pst_PST_X_inc1": 0.8}},
            "load_shedding": {"scores": {"ls_LOAD_1": 0.5}},
        }
        result = svc._compute_mw_start_for_scores(scores)

        assert result["line_disconnection"]["mw_start"]["disco_LINE_A"] == pytest.approx(120.0, abs=0.1)
        assert result["line_reconnection"]["mw_start"]["reco_LINE_A"] is None
        assert result["pst_tap_change"]["mw_start"]["pst_PST_X_inc1"] == pytest.approx(90.0, abs=0.1)
        assert result["load_shedding"]["mw_start"]["ls_LOAD_1"] == pytest.approx(75.0, abs=0.1)
