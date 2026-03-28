# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

"""Tests for _compute_mw_start_for_scores and _get_action_mw_start."""

import numpy as np
import pytest
from unittest.mock import MagicMock, patch

from expert_backend.services.recommender_service import RecommenderService


def _real_get_virtual_line_flow(obs, ind_load, ind_prod, ind_lor, ind_lex):
    """Reference implementation of get_virtual_line_flow for testing."""
    flow = 0.0
    flow += sum(-obs.p_or[i] for i in ind_lor)
    flow += sum(obs.p_or[i] for i in ind_lex)
    flow += sum(-obs.load_p[i] for i in ind_load)
    flow += sum(obs.gen_p[i] for i in ind_prod)
    return flow


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
    def test_extracts_load_p_for_shed_load_from_content(self):
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

    def test_extracts_load_p_from_action_id_pattern(self):
        """When content.set_bus is missing or empty, fall back to action_id pattern."""
        obs = _make_obs([], [], name_load=["NAVIL31SNCF", "OTHER"], load_p=[42.5, 10.0])
        dict_action = {
            "load_shedding_NAVIL31SNCF": {
                "content": {}  # no set_bus — library-enriched actions may lack it
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"load_shedding": {"scores": {"load_shedding_NAVIL31SNCF": 0.39}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["load_shedding"]["mw_start"]["load_shedding_NAVIL31SNCF"] == pytest.approx(42.5, abs=0.1)

    def test_extracts_load_p_when_action_entry_missing(self):
        """Action not in dict at all — still extract from action_id pattern."""
        obs = _make_obs([], [], name_load=["MY_LOAD"], load_p=[99.0])
        svc = _make_service_with_context(obs, {})  # empty dict

        scores = {"load_shedding": {"scores": {"load_shedding_MY_LOAD": 0.5}}}
        result = svc._compute_mw_start_for_scores(scores)

        assert result["load_shedding"]["mw_start"]["load_shedding_MY_LOAD"] == pytest.approx(99.0, abs=0.1)

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

    def test_no_shed_loads_and_no_id_pattern_returns_none(self):
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

        # bus=1 doesn't match -1, and action_id doesn't start with load_shedding_
        assert result["load_shedding"]["mw_start"]["ls_none"] is None


@patch(
    "expert_backend.services.recommender_service.get_virtual_line_flow",
    side_effect=_real_get_virtual_line_flow,
)
class TestMwStartOpenCoupling:
    def test_computes_kcl_at_bus1_only(self, _mock_vlf):
        """Virtual line flow = |KCL at bus 1|.

        When set_bus has elements on both bus 1 and bus 2, only bus 1
        elements contribute to the virtual line flow (matching the
        reference get_virtual_line_flow implementation).

        Example: VIELM1 (or, bus 2, p_or=-131), CPVAN1 (ex, bus 1, p_or=89),
                 TR631 (or, bus 1, p_or=23), TR632 (or, bus 2, p_or=20)
        KCL at bus 1:
          CPVAN1 (ex side, bus 1): +p_or = +89
          TR631 (or side, bus 1): -p_or = -23
          net = 89 - 23 = 66
        Virtual line = |66| = 66 MW
        """
        obs = _make_obs(
            ["VIELM1", "CPVAN1", "TR631", "TR632"],
            [-131.0, 89.0, 23.0, 20.0],
        )
        dict_action = {
            "open_coupling_act": {
                "content": {
                    "set_bus": {
                        "lines_or_id": {"VIELM1": 2, "TR631": 1, "TR632": 2},
                        "lines_ex_id": {"CPVAN1": 1},
                    }
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"open_coupling": {"scores": {"open_coupling_act": 0.75}}}
        result = svc._compute_mw_start_for_scores(scores)

        # KCL at bus 1: +89 (CPVAN1 ex) - 23 (TR631 or) = 66
        assert result["open_coupling"]["mw_start"]["open_coupling_act"] == pytest.approx(66.0, abs=0.1)

    def test_single_bus_computes_kcl_for_all(self, _mock_vlf):
        """When all elements are on one bus, all contribute to KCL."""
        # All on bus 2 → min({2}) = 2 = bus 1 equivalent
        obs = _make_obs(["LINE_A", "LINE_B"], [-131.0, 20.0])
        dict_action = {
            "coupling_act": {
                "content": {
                    "set_bus": {
                        "lines_or_id": {"LINE_A": 2, "LINE_B": 2},
                    }
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"open_coupling": {"scores": {"coupling_act": 7.0}}}
        result = svc._compute_mw_start_for_scores(scores)

        # KCL: -(-131) + -(20) = 131 - 20 = 111
        assert result["open_coupling"]["mw_start"]["coupling_act"] == pytest.approx(111.0, abs=0.1)

    def test_includes_generator_and_load_on_bus1(self, _mock_vlf):
        """Generators and loads on bus 1 contribute to KCL at bus 1."""
        obs = _make_obs(["LINE_A", "LINE_B"], [100.0, 50.0], name_load=["LOAD_1"], load_p=[30.0])
        obs.name_gen = ["GEN_1"]
        obs.gen_p = np.array([50.0])

        dict_action = {
            "coupling_gl": {
                "content": {
                    "set_bus": {
                        "lines_or_id": {"LINE_A": 1, "LINE_B": 2},
                        "generators_id": {"GEN_1": 1},
                        "loads_id": {"LOAD_1": 2},
                    }
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"open_coupling": {"scores": {"coupling_gl": 5.0}}}
        result = svc._compute_mw_start_for_scores(scores)

        # KCL at bus 1: -p_or(LINE_A) + gen_p(GEN_1) = -100 + 50 = -50
        # LOAD_1 and LINE_B are on bus 2, excluded
        # virtual line = |−50| = 50
        assert result["open_coupling"]["mw_start"]["coupling_gl"] == pytest.approx(50.0, abs=0.1)

    def test_ignores_disconnected_elements_bus_minus1(self, _mock_vlf):
        """Elements with bus=-1 are disconnected and excluded from KCL.

        Reproduces the real C.REGP6 pattern where generators have bus=-1.
        Without filtering, min({-1,1,2})=-1 → KCL on disconnected elements → 0.
        """
        obs = _make_obs(
            ["C.REGL61VIELM", "C.REGL61ZMAGN", "C.REGL62VIELM", "C.REGY633", "C.REGY631"],
            [-105.0, 118.0, -99.0, 32.0, 10.0],
            name_load=["C.REG6TR615", "C.REG6TR614", "C.REG6TR613"],
            load_p=[32.0, 32.0, 10.0],
        )
        obs.name_gen = ["C.REGIN3", "C.REGINF", "C.REGING"]
        obs.gen_p = np.array([0.0, 0.0, 0.0])

        dict_action = {
            "coupling_creg": {
                "content": {
                    "set_bus": {
                        "lines_or_id": {
                            "C.REGL61VIELM": 2, "C.REGL61ZMAGN": 1,
                            "C.REGL62VIELM": 1, "C.REGY633": 1, "C.REGY631": 2,
                        },
                        "lines_ex_id": {},
                        "loads_id": {
                            "C.REG6TR615": 2, "C.REG6TR614": 1, "C.REG6TR613": 1,
                        },
                        "generators_id": {
                            "C.REGIN3": 1, "C.REGINF": -1, "C.REGING": -1,
                        },
                    }
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)

        scores = {"open_coupling": {"scores": {"coupling_creg": 5.0}}}
        result = svc._compute_mw_start_for_scores(scores)

        mw = result["open_coupling"]["mw_start"]["coupling_creg"]
        # Bus 1 elements: ZMAGN(or,118), VIELM2(or,-99), Y633(or,32),
        #                  TR614(load,32), TR613(load,10), GEN3(gen,0)
        # KCL at bus 1: -(118) -(-99) -(32) - 32 - 10 + 0 = -118+99-32-32-10 = -93
        # virtual line = |−93| = 93
        assert mw is not None
        assert mw > 0  # Must not be 0; disconnected elements excluded

    def test_no_lines_in_action_returns_none(self, _mock_vlf):
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


class TestMwStartOpenCouplingRealData:
    """Tests using actual action data from reduced_model_actions_test.json.

    P_or values are derived from the N-1 diagram screenshots provided by
    the user and chosen to satisfy expected virtual line flow values.

    Sign convention (grid2op):
      - lines_or on bus 1: KCL contribution = -p_or
      - lines_ex on bus 1: KCL contribution = +p_or
      - loads on bus 1:    KCL contribution = -load_p
      - gens on bus 1:     KCL contribution = +gen_p
    """

    @patch(
        "expert_backend.services.recommender_service.get_virtual_line_flow",
        side_effect=_real_get_virtual_line_flow,
    )
    def test_c_regp6_open_coupling(self, _mock_vlf):
        """C.REGP6 action: 466f2c03-..._C.REGP6 — expected 63 MW.

        User expected: 105 - (32 + 10) = 63
          VIELM1 line (p_or=-105) on section 1A (bus 2), contributing 105 MW
          C.REGY631 transformer (p_or=10) on section 1A (bus 2), consuming 10 MW
          C.REG6TR615 load (32 MW) on section 1A (bus 2), consuming 32 MW

        KCL at bus 2 = 105 - 10 - 32 = 63
        KCL at bus 1 = -63 (opposite by conservation)
        """
        # Bus 1 values chosen so KCL at bus 1 = -63:
        # -p_or(ZMAGN=118) - p_or(VIELM2=-99) - p_or(Y633=32) - load(TR614=4) - load(TR613=8) + gen(IN3=0) = -63
        obs = _make_obs(
            ["C.REGL61VIELM", "C.REGL61ZMAGN", "C.REGL62VIELM", "C.REGY633", "C.REGY631"],
            [-105.0, 118.0, -99.0, 32.0, 10.0],
            name_load=["C.REG6TR615", "C.REG6TR614", "C.REG6TR613"],
            load_p=[32.0, 4.0, 8.0],
        )
        obs.name_gen = ["C.REGIN3", "C.REGINF", "C.REGING"]
        obs.gen_p = np.array([0.0, 0.0, 0.0])

        # Exact set_bus from the action JSON
        dict_action = {
            "466f2c03-90ce-401e-a458-fa177ad45abc_C.REGP6": {
                "content": {
                    "set_bus": {
                        "lines_or_id": {
                            "C.REGL61VIELM": 2, "C.REGL61ZMAGN": 1,
                            "C.REGL62VIELM": 1, "C.REGY633": 1, "C.REGY631": 2,
                        },
                        "lines_ex_id": {},
                        "loads_id": {
                            "C.REG6TR615": 2, "C.REG6TR614": 1, "C.REG6TR613": 1,
                        },
                        "generators_id": {
                            "C.REGIN3": 1, "C.REGINF": -1, "C.REGING": -1,
                        },
                        "shunts_id": {},
                    }
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)
        scores = {"open_coupling": {"scores": {"466f2c03-90ce-401e-a458-fa177ad45abc_C.REGP6": 5.0}}}
        result = svc._compute_mw_start_for_scores(scores)

        mw = result["open_coupling"]["mw_start"]["466f2c03-90ce-401e-a458-fa177ad45abc_C.REGP6"]
        assert mw == pytest.approx(63.0, abs=0.1)

    @patch(
        "expert_backend.services.recommender_service.get_virtual_line_flow",
        side_effect=_real_get_virtual_line_flow,
    )
    def test_cpvanp6_open_coupling(self, _mock_vlf):
        """CPVANP6 action: 3617076a-..._CPVANP6 — expected 29 MW.

        User expected: abs((88 + 39) - (38 + 118)) = abs(127 - 156) = 29
          COUCHL61CPVAN (ex, bus 1, p_or=88): +88 contribution
          CHALOL61CPVAN (ex, bus 1, p_or=39): +39 contribution
          CPVANL61TAVAU (or, bus 1, p_or=118): -118 contribution
          CPVANY633 (or, bus 1, p_or=38): -38 contribution
          KCL at bus 1 = 88 + 39 - 118 - 38 = -29, |flow| = 29
        """
        obs = _make_obs(
            [
                "CPVANL61PYMON", "CPVANL61TAVAU", "CPVANL61ZMAGN",
                "CPVANY633", "CPVANY632", "CPVANY631",
                "CHALOL61CPVAN", "COUCHL61CPVAN",
            ],
            [12.0, 118.0, 79.0, 38.0, 0.0, 3.0, 39.0, 88.0],
        )
        obs.name_gen = []
        obs.gen_p = np.array([])

        # Exact set_bus from the action JSON (CPVANY632 = -1 = disconnected)
        dict_action = {
            "3617076a-a7f5-4f8a-9009-127ac9b85cff_CPVANP6": {
                "content": {
                    "set_bus": {
                        "lines_or_id": {
                            "CPVANL61PYMON": 2, "CPVANL61TAVAU": 1,
                            "CPVANL61ZMAGN": 2, "CPVANY633": 1,
                            "CPVANY632": -1, "CPVANY631": 2,
                        },
                        "lines_ex_id": {
                            "CHALOL61CPVAN": 1, "COUCHL61CPVAN": 1,
                        },
                        "loads_id": {},
                        "generators_id": {},
                        "shunts_id": {},
                    }
                }
            }
        }
        svc = _make_service_with_context(obs, dict_action)
        scores = {"open_coupling": {"scores": {"3617076a-a7f5-4f8a-9009-127ac9b85cff_CPVANP6": 5.0}}}
        result = svc._compute_mw_start_for_scores(scores)

        mw = result["open_coupling"]["mw_start"]["3617076a-a7f5-4f8a-9009-127ac9b85cff_CPVANP6"]
        assert mw == pytest.approx(29.0, abs=0.1)


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
