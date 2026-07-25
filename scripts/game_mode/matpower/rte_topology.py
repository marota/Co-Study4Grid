# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# SPDX-License-Identifier: MPL-2.0
"""Real-RTE detailed topology plans for the MATPOWER node-breaker rebuild.

The generic rebuild (``node_breaker.py``) preserves the MATPOWER electrical
nodes but invents the busbar structure (one busbar per source bus + generic
extras). This module replaces that invention, for identity-mapped substations,
with the REAL substation structure driven by the recommender's
nodal->detailed algorithm (``expert_op4grid_recommender.manoeuvre``, the
Python port of RTE's libTOPO):

1. the real voltage level is taken AS IS from the committed named THT
   reference snapshot (``data/rte7000_tht/grids/grid_5384e039``) — real busbar
   count, real cells;
2. the MATPOWER feeders of the mapped buses are paired to the real departures
   (far-site first, exact X/R/B features to split parallel circuits);
3. the **target nodal topology** = the MATPOWER electrical nodes (which
   paired departures live on the same bus), and libTOPO computes the detailed
   state — which busbar each departure lands on — that realises those nodes
   inside the real structure (``determiner_topo_complete_cible``);
4. the resulting plan {n_busbars, feeder->busbar slot, open couplers between
   node groups} is consumed by ``rebuild_node_breaker``.

Every step degrades gracefully: any VL where pairing is incomplete, libTOPO
does not verify, or the reference lacks the yard, simply gets no plan and the
generic rebuild applies. Plans never touch the electrical state: the MATPOWER
node partition is reproduced exactly (couplers OPEN between node groups), so
load-flow fidelity is unchanged by construction.
"""
from __future__ import annotations

import base64
import collections
import gzip
import math
import tempfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[3]
THT_REF = REPO / "data" / "rte7000_tht" / "grids" / "grid_5384e039" / "network.xiidm.gz.b64"

#: feature-cost cap for a MATPOWER<->RTE departure pairing to be accepted.
PAIR_COST_MAX = 1.2


# --------------------------------------------------------------- reference
def load_tht_reference():
    """The committed named THT snapshot as a pypowsybl network."""
    import pypowsybl as pp
    raw = gzip.decompress(base64.b64decode(THT_REF.read_bytes()))
    tmp = Path(tempfile.mktemp(suffix=".xiidm"))
    tmp.write_bytes(raw)
    return pp.network.load(str(tmp))


def reference_vls(ref_net) -> dict:
    """(site_code, rounded_kv) -> reference VL id."""
    vls = ref_net.get_voltage_levels()
    out = {}
    for vl in vls.index:
        kv = int(round(float(vls.loc[vl, "nominal_v"])))
        out[(vl[:5], kv)] = vl
    return out


def _line_sig(x_ohm, r_ohm, b_s):
    return (math.log10(max(abs(x_ohm), 1e-3)),
            math.log10(max(abs(r_ohm), 1e-4)),
            math.log10(max(abs(b_s), 1e-7)))


def _sig_cost(a, b):
    return (1.0 * abs(a[0] - b[0]) + 0.6 * abs(a[1] - b[1])
            + 0.4 * abs(a[2] - b[2]))


# ---------------------------------------------------------------- pairing
def pair_departures(mat_feeders: list[dict], rte_departs: list[dict]) -> dict:
    """MATPOWER feeder id -> RTE departure id.

    ``mat_feeders``: [{id, far_site, sig}] — the VL's MATPOWER lines with the
    site of their far end (from the substation map) and the ohm-converted
    signature. ``rte_departs``: same shape for the reference cells.

    Grouped by far site; within a group (parallel circuits), exact-feature
    greedy assignment (measured reliable to the 2nd decimal on confirmed
    pairs). One-to-one; unpairable feeders are simply absent from the result.
    """
    by_far_r = collections.defaultdict(list)
    for d in rte_departs:
        by_far_r[d["far_site"]].append(d)
    out = {}
    for far, mats in _group_by(mat_feeders, "far_site").items():
        cands = list(by_far_r.get(far, ()))
        for m in sorted(mats, key=lambda d: d["id"]):
            if not cands:
                break
            best = min(cands, key=lambda c: _sig_cost(m["sig"], c["sig"]))
            if _sig_cost(m["sig"], best["sig"]) <= PAIR_COST_MAX:
                out[m["id"]] = best["id"]
                cands.remove(best)
    return out


def _group_by(rows, key):
    g = collections.defaultdict(list)
    for r in rows:
        g[r[key]].append(r)
    return g


# ------------------------------------------------------------------ plans
def plan_for_vl(ref_net, ref_vl: str, mat_groups: dict[int, list[str]],
                pairing: dict[str, str]) -> dict | None:
    """Run libTOPO on the REAL voltage level and derive the rebuild plan.

    ``mat_groups``: MATPOWER source bus -> its feeder ids (the electrical
    nodes to reproduce). ``pairing``: MATPOWER feeder id -> RTE departure id.

    Returns ``{"n_busbars", "slot" (mat feeder id -> 0-based busbar index),
    "open_after" (chain positions whose coupler must be OPEN),
    "manoeuvres"}`` or None when the target is not realisable/verified.
    """
    from expert_op4grid_recommender.manoeuvre import build_vl_graph
    from expert_op4grid_recommender.manoeuvre.topologie import (
        NoeudElectrique, PosteTopologique, TopologieNodale)
    from expert_op4grid_recommender.manoeuvre.algo import (
        determiner_topo_complete_cible, _set_switch, _wired_busbar)

    G = build_vl_graph(ref_net, ref_vl)
    poste = PosteTopologique.from_graph(G, ref_vl)
    cells = {c.equipment_id: c for c in poste.cellules.cellules_depart}

    # --- target: paired departures grouped per MATPOWER node --------------
    cible = TopologieNodale(voltage_level_id=ref_vl)
    node_of: dict[str, str] = {}
    for mb, feeders in sorted(mat_groups.items()):
        nom = f"MAT_{mb}"
        for f in feeders:
            rd = pairing.get(f)
            if rd in cells:
                node_of[rd] = nom
    if len(set(node_of.values())) < len(mat_groups):
        return None                       # a MATPOWER node got no departure
    # unpaired real departures keep their current node
    cur = poste.topologie_nodale
    for nom_cur, nd in cur.noeuds.items():
        for dep in nd.departs:
            node_of.setdefault(dep.equipment_id, f"CUR_{nom_cur}")
    by_node = collections.defaultdict(list)
    for nd in cur.noeuds.values():
        for dep in nd.departs:
            by_node[node_of[dep.equipment_id]].append(dep)
    for nom, deps in by_node.items():
        ne = NoeudElectrique(nom=nom)
        ne.departs.extend(deps)
        cible.noeuds[nom] = ne
        for dep in deps:
            cible.noeud_par_depart[dep.equipment_id] = nom

    res = determiner_topo_complete_cible(poste, cible)
    if not res.is_verified:
        return None

    # --- replay the manoeuvres, read each departure's final busbar ---------
    G2 = poste.graph.copy()
    for m in res.manoeuvres:
        _set_switch(G2, m.switch_id, m.action == "OPEN")
    bb_of: dict[str, int] = {}
    for eq, cell in cells.items():
        bb = _wired_busbar(cell, G2)
        if bb is not None:
            bb_of[eq] = bb

    # --- order busbars so node groups are contiguous on the chain ----------
    sjb_node: dict[int, str] = {}
    for eq, bb in bb_of.items():
        sjb_node.setdefault(bb, node_of.get(eq, "?"))
    order = sorted(sjb_node, key=lambda bb: (sjb_node[bb], bb))
    slot_of_sjb = {bb: i for i, bb in enumerate(order)}
    n_busbars = max(len(order), 1)
    open_after = [i for i in range(len(order) - 1)
                  if sjb_node[order[i]] != sjb_node[order[i + 1]]]

    inv_pair = {v: k for k, v in pairing.items()}
    slot = {inv_pair[eq]: slot_of_sjb[bb]
            for eq, bb in bb_of.items() if eq in inv_pair}
    # first chain slot of each MATPOWER node group — where the VL's OTHER
    # equipment of that source bus (loads, generators, transformer ends,
    # unpaired circuits) lands.
    group_slot: dict[int, int] = {}
    for mb, feeders in mat_groups.items():
        slots = [slot[f] for f in feeders if f in slot]
        if slots:
            group_slot[mb] = min(slots)
    return {"ref_vl": ref_vl, "n_busbars": n_busbars, "slot": slot,
            "open_after": open_after, "group_slot": group_slot,
            "manoeuvres": [f"{m.action} {m.switch_id}" for m in res.manoeuvres]}


# ------------------------------------------------- network-source frontend
def plans_from_network(src, bus_sub: dict, verbose: bool = False) -> dict:
    """Build plans directly from the imported MATPOWER pypowsybl network, so
    feeder ids match the rebuild's exactly. ``src`` is the BUS_BREAKER source
    network, ``bus_sub`` the identity map (MATPOWER bus -> substation)."""
    vls = src.get_voltage_levels()
    nomv = {v: float(vls.loc[v, "nominal_v"]) for v in vls.index}
    buses = src.get_buses(attributes=["voltage_level_id"])

    def bus_num(bid):
        try:
            return int(str(bid).split("-")[-1].split("_")[0].split("#")[0])
        except ValueError:
            return None

    bus_kv = {}
    for bid, r in buses.iterrows():
        n = bus_num(bid)
        if n is not None:
            bus_kv[n] = int(round(nomv.get(r["voltage_level_id"], 0)))
    lines = src.get_lines(all_attributes=True)
    case_lines = []
    for lid, r in lines.iterrows():
        f, t = bus_num(r["bus1_id"]), bus_num(r["bus2_id"])
        if f is None or t is None:
            continue
        b_tot = abs(r.get("b1", 0.0)) + abs(r.get("b2", 0.0))
        case_lines.append({"id": str(lid), "f": f, "t": t,
                           "x_ohm": abs(r["x"]), "r_ohm": abs(r["r"]),
                           "b_s": b_tot})
    return build_topology_plans(case_lines, bus_sub, bus_kv, verbose=verbose)


def build_topology_plans(case_lines: list[dict], bus_sub: dict,
                         bus_kv: dict, verbose: bool = False) -> dict:
    """Plans for every mapped multi-node THT voltage level of a case.

    ``case_lines``: [{id, f, t, x_ohm, r_ohm, b_s}] MATPOWER same-kv lines.
    ``bus_sub``: MATPOWER bus -> {"substation": code} identity map.
    ``bus_kv``: MATPOWER bus -> rounded kv.

    Returns ``{(site, kv): plan}``; each plan carries ``buses`` (the MATPOWER
    source buses it reproduces) so the caller can join onto its own VL ids
    (a rebuild VL is covered when its source buses are exactly the plan's).
    """
    ref_net = load_tht_reference()
    ref_ix = reference_vls(ref_net)
    lines_df = ref_net.get_lines()
    vls_df = ref_net.get_voltage_levels()
    nomv = {v: float(vls_df.loc[v, "nominal_v"]) for v in vls_df.index}

    # group MATPOWER buses per (site, kv)
    site_buses = collections.defaultdict(list)
    for b, rec in bus_sub.items():
        s = rec["substation"] if isinstance(rec, dict) else rec
        kv = bus_kv.get(int(b))
        if kv in (380, 225):
            site_buses[(s, kv)].append(int(b))

    plans: dict = {}
    for (s, kv), buses in sorted(site_buses.items()):
        if len(buses) < 2:
            continue                      # single node: generic build is exact
        ref_vl = ref_ix.get((s, kv))
        if ref_vl is None:
            continue
        # MATPOWER feeders of those buses at this kv
        mat_feeders, mat_groups = [], collections.defaultdict(list)
        for ln in case_lines:
            for a, b_ in ((ln["f"], ln["t"]), (ln["t"], ln["f"])):
                if a in buses and bus_kv.get(ln["f"]) == bus_kv.get(ln["t"]) == kv:
                    far = bus_sub.get(b_) or bus_sub.get(str(b_))
                    far_s = (far["substation"] if isinstance(far, dict) else far) \
                        if far else None
                    if far_s and far_s != s:
                        mat_feeders.append({"id": ln["id"], "far_site": far_s,
                                            "sig": _line_sig(ln["x_ohm"],
                                                             ln["r_ohm"],
                                                             ln["b_s"])})
                        mat_groups[a].append(ln["id"])
        if len(mat_groups) < 2:
            continue
        # RTE departures of the reference VL
        rte_departs = []
        for lid, r in lines_df.iterrows():
            v1, v2 = r["voltage_level1_id"], r["voltage_level2_id"]
            if ref_vl not in (v1, v2):
                continue
            other = v2 if v1 == ref_vl else v1
            b_tot = abs(r.get("b1", 0.0)) + abs(r.get("b2", 0.0))
            rte_departs.append({"id": lid, "far_site": other[:5],
                                "sig": _line_sig(r["x"], r["r"], b_tot)})
        pairing = pair_departures(mat_feeders, rte_departs)
        try:
            plan = plan_for_vl(ref_net, ref_vl, mat_groups, pairing)
        except Exception as exc:  # noqa: BLE001 — graceful per-VL degradation
            if verbose:
                print(f"  [rte-topo] {ref_vl}: libTOPO KO ({exc})")
            plan = None
        if plan:
            plan["site"] = s
            plan["kv"] = kv
            plan["buses"] = sorted(buses)
            plans[(s, kv)] = plan
            if verbose:
                print(f"  [rte-topo] {ref_vl}: plan réel "
                      f"{plan['n_busbars']} barres, "
                      f"{len(plan['slot'])} départs affectés, "
                      f"couplages ouverts après {plan['open_after']}")
    return plans
