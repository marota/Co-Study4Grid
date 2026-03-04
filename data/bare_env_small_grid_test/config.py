from datetime import datetime, timedelta

from grid2op.Reward import L2RPNReward
from grid2op.Rules import DefaultRules, AlwaysLegal
from grid2op.Chronics import Multifolder
from grid2op.Chronics import GridStateFromFileWithForecasts
from grid2op.Opponent import BaseOpponent, NeverAttackBudget
from grid2op.Chronics.handlers import PerfectForecastHandler,CSVHandler, CSVMaintenanceHandler, JSONInitStateHandler,DoNothingHandler
from grid2op.Chronics import FromHandlers

from grid2op.Action import PlayableAction, DontAct
from grid2op.Observation import CompleteObservation

from lightsim2grid import LightSimBackend


class ActionAF2024(PlayableAction):
    authorized_keys = {
        "set_line_status",
        # "change_bus",  # more than 2 busbar so deactivated
        "set_bus",
        "change_bus",
        # "redispatch",
        # "set_storage",
        "curtail",
        # "raise_alert",
        "detach_load",  # new in 1.11.0
        "detach_gen",  # new in 1.11.0
        "detach_storage",  # new in 1.11.0
    }

    attr_list_vect = [
        "_set_line_status",
        "_switch_line_status",
        "_set_topo_vect",
        "_change_bus_vect",
        # "_redispatch",
        # "_storage_power",
        "_curtail",
        # "_raise_alert",
        "_detach_load",  # new in 1.11.0
        "_detach_gen",  # new in 1.11.0
        "_detach_storage",  # new in 1.11.0
    ]
    attr_list_set = set(attr_list_vect)
    pass


class ObservationAF2024(CompleteObservation):
    attr_list_vect = [
        "year",
        "month",
        "day",
        "hour_of_day",
        "minute_of_hour",
        "day_of_week",
        "gen_p",
        "gen_q",
        "gen_v",
        "load_p",
        "load_q",
        "load_v",
        "p_or",
        "q_or",
        "v_or",
        "a_or",
        "p_ex",
        "q_ex",
        "v_ex",
        "a_ex",
        "rho",
        "line_status",
        # "timestep_overflow", #Disparait car plus de notion temporelle intrinsèque ?
        "topo_vect",
        # "time_before_cooldown_line", #Disparait car plus de notion temporelle intrinsèque ?
        # "time_before_cooldown_sub", #Disparait car plus de notion temporelle intrinsèque ?
        # "time_next_maintenance", #A enlever si on met pas les maintenances dans la class choisie pour gridvalueClass
        # "duration_next_maintenance", #A enlever si on met pas les maintenances dans la class choisie pour gridvalueClass
        # "target_dispatch", #Pas d'action dispatch
        "actual_dispatch",
        # "storage_charge", #Pas de storage
        # "storage_power_target",
        # "storage_power",
        "gen_p_before_curtail",
        "curtailment",
        "curtailment_limit",
        "curtailment_limit_effective",
        # "_shunt_p", # Pas de shunt sur la zone
        # "_shunt_q",
        # "_shunt_v",
        # "_shunt_bus",
        "current_step",
        "max_step",
        "delta_time",
        "gen_margin_up",  # A conserver pour expliquer qu'un écretement n'ai pas pu se faire complètement ?
        "gen_margin_down",  # A conserver pour expliquer qu'un écretement n'ai pas pu se faire complètement ?
        # line alert (starting grid2Op 1.9.1, for compatible envs)
        # "active_alert", #Pas d'alerte simulée
        # "attack_under_alert",
        # "time_since_last_alert",
        # "alert_duration",
        # "total_number_of_alert",
        # "time_since_last_attack",
        # "was_alert_used_after_attack",
        
        # "slack" (>= 1.11.0)
        "gen_p_delta",
        # detachment (>= 1.11.0)
        "load_detached",
        "gen_detached",
        "storage_detached",
        "load_p_detached",
        "load_q_detached",
        "gen_p_detached",
        "storage_p_detached",
    ]
    attr_list_json = [
        "_thermal_limit",
        "support_theta",
        "theta_or",
        "theta_ex",
        "load_theta",
        "gen_theta",
        # "storage_theta" #no storage
    ]
    attr_list_set = set(attr_list_vect)


config = {
    "backend": LightSimBackend,  # décider des paramètres +issue sur Git
    "action_class": ActionAF2024,
    "observation_class": ObservationAF2024,
    "reward_class": L2RPNReward,
    "gamerules_class": AlwaysLegal,
    # limite le nb de changements de connections powerlines/substations à 1 pas de temps -> ajouter les maintenances?
    "chronics_class": FromHandlers,
    "data_feeding_kwargs": {
        "gen_p_handler": DoNothingHandler(),
        "load_p_handler": DoNothingHandler(),
        "gen_v_handler": DoNothingHandler(),
        "load_q_handler": DoNothingHandler(),
        "gen_p_for_handler": DoNothingHandler(),
        "gen_v_for_handler": DoNothingHandler(),
        "load_p_for_handler": DoNothingHandler(),
        "load_q_for_handler": DoNothingHandler(),
    },
    "volagecontroler_class": None,
    "names_chronics_to_grid": None,

    'opponent_attack_cooldown': 99999999,  # deactivate opponent
    'opponent_attack_duration': 0,
    'opponent_budget_per_ts': 0.0,
    'opponent_init_budget': 0.0,
    'opponent_action_class': DontAct,
    'opponent_class': BaseOpponent,
    'opponent_budget_class': NeverAttackBudget
}
