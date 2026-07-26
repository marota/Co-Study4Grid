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
def _current_busbars(poste, cells):
    """Each departure's CURRENT busbar in the real snapshot state."""
    from expert_op4grid_recommender.manoeuvre.algo import _wired_busbar
    out = {}
    for eq, cell in cells.items():
        bb = _wired_busbar(cell, poste.graph)
        if bb is not None:
            out[eq] = bb
    return out


def _all_busbars(G):
    from expert_op4grid_recommender.manoeuvre import graph as mgraph
    return sorted(mgraph.busbar_nodes(G))


def plan_for_vl(ref_net, ref_vl: str, mat_groups: dict[int, list[str]],
                pairing: dict[str, str], all_nodes=None) -> dict | None:
    """Derive the rebuild plan from the REAL voltage level.

    ``mat_groups``: MATPOWER source bus -> its feeder/transformer ids (the
    electrical nodes to reproduce — possibly a single one).
    ``pairing``: MATPOWER equipment id -> RTE departure id.

    Three regimes:
    * single MATPOWER node — no libTOPO needed: the CURRENT real wiring is
      kept as is (every real busbar exposed, all chain couplers closed), which
      is maximally faithful and still fully manoeuvrable;
    * several nodes, every node holding >= 1 paired departure — libTOPO
      (``determiner_topo_complete_cible``) computes the detailed state that
      realises the partition inside the real structure;
    * nodes WITHOUT any paired departure — they get an extra busbar appended
      after the real ones, with an open boundary (hybrid real/generic), so the
      electrical node count is still exact.
    """
    from expert_op4grid_recommender.manoeuvre import build_vl_graph
    from expert_op4grid_recommender.manoeuvre.topologie import (
        NoeudElectrique, PosteTopologique, TopologieNodale)
    from expert_op4grid_recommender.manoeuvre.algo import (
        determiner_topo_complete_cible, _set_switch, _wired_busbar)

    G = build_vl_graph(ref_net, ref_vl)
    poste = PosteTopologique.from_graph(G, ref_vl)
    cells = {c.equipment_id: c for c in poste.cellules.cellules_depart}
    real_bbs = _all_busbars(G)
    if not real_bbs:
        return None

    paired_groups = {mb: [f for f in fs if pairing.get(f) in cells]
                     for mb, fs in mat_groups.items()}
    paired_groups = {mb: fs for mb, fs in paired_groups.items() if fs}
    if not paired_groups:
        return None                       # nothing anchors this VL to reality

    manoeuvres: list = []
    if len(paired_groups) <= 1:
        # ---- single anchored node: keep the real current wiring ----------
        bb_of = _current_busbars(poste, cells)
        node_of = {eq: "MAT" for eq in bb_of}
    else:
        # ---- multi-node: libTOPO computes the realising detailed state ----
        cible = TopologieNodale(voltage_level_id=ref_vl)
        node_of: dict[str, str] = {}
        for mb, feeders in sorted(paired_groups.items()):
            for f in feeders:
                node_of[pairing[f]] = f"MAT_{mb}"
        cur = poste.topologie_nodale
        # Unpaired real departures MERGE into the largest MAT group: they are
        # not recreated in the rebuild, and giving them their own node demands
        # more busbars than the post owns (measured: every 2-busbar post with
        # 2 MATPOWER nodes failed verification on the 3-node target).
        sizes = collections.Counter(node_of.values())
        biggest = max(sizes, key=sizes.get)
        for nd in cur.noeuds.values():
            for dep in nd.departs:
                node_of.setdefault(dep.equipment_id, biggest)
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
        if res.is_verified:
            manoeuvres = res.manoeuvres
            G2 = poste.graph.copy()
            for m in res.manoeuvres:
                _set_switch(G2, m.switch_id, m.action == "OPEN")
            bb_of = {}
            for eq, cell in cells.items():
                bb = _wired_busbar(cell, G2)
                if bb is not None:
                    bb_of[eq] = bb
        else:
            # libTOPO cannot verify on this post (complex coupling component
            # the port truncates, e.g. CPNIE's 4-SJB coupler). DIRECT ASSIGN:
            # real busbar count kept, each MAT group laid on its own real
            # busbar (in order), open boundaries between groups. Less "real
            # current wiring" but still the real structure and the exact
            # MATPOWER partition.
            groups = sorted({n for n in node_of.values() if n.startswith("MAT_")})
            # surplus groups (more nodes than real busbars) get NO direct
            # busbar here — the post-hoc extra-busbar pass appends one per
            # uncovered node behind an open boundary.
            bb_by_group = {g: real_bbs[i]
                           for i, g in enumerate(groups[:len(real_bbs)])}
            bb_of = {}
            for eq, nom in node_of.items():
                if nom in bb_by_group and eq in cells:
                    bb_of[eq] = bb_by_group[nom]

    # ---- chain layout: node groups contiguous, then empty real busbars ----
    sjb_node: dict[int, str] = {}
    for eq, bb in bb_of.items():
        sjb_node.setdefault(bb, node_of.get(eq, "?"))
    used = sorted(sjb_node, key=lambda bb: (sjb_node[bb], bb))
    empty = [bb for bb in real_bbs if bb not in sjb_node]
    order = used + empty                  # empties glued to the last group
    slot_of_sjb = {bb: i for i, bb in enumerate(order)}
    open_after = [i for i in range(len(used) - 1)
                  if sjb_node[used[i]] != sjb_node[used[i + 1]]]

    inv_pair = {v: k for k, v in pairing.items()}
    slot = {inv_pair[eq]: slot_of_sjb[bb]
            for eq, bb in bb_of.items() if eq in inv_pair}
    group_slot: dict[int, int] = {}
    for mb, feeders in paired_groups.items():
        slots = [slot[f] for f in feeders if f in slot]
        if slots:
            group_slot[mb] = min(slots)
    # EVERY source node still without a busbar gets its own EXTRA one behind
    # an open boundary — nodes with no paired departure, but ALSO "paired"
    # nodes whose real cell turned out unwired in the libTOPO state (measured
    # on Creney: the node then had no busbar, no boundary, and two electrical
    # nodes merged). Includes load/generator-only buses via ``all_nodes``.
    n_busbars = len(order)
    for mb in (all_nodes or mat_groups):
        if mb in group_slot:
            continue
        open_after.append(n_busbars - 1)
        group_slot[mb] = n_busbars
        n_busbars += 1
    return {"ref_vl": ref_vl, "n_busbars": max(n_busbars, 1), "slot": slot,
            "open_after": sorted(set(open_after)), "group_slot": group_slot,
            "n_real_busbars": len(real_bbs),
            "manoeuvres": [f"{m.action} {m.switch_id}" for m in manoeuvres]}


def _arbitrate_site(cands, ns, kv, eq_of_bus, ref_ix, ref_departs_fn,
                    ref_adj=None):
    """Pick the VL's site by deduction-elimination on its own ouvrages.

    Candidates: the given ones (conflicting strict / loose sites) PLUS —
    graph structure — every reference site adjacent to the strict far-sites
    of the VL's lines (the VL must be a real neighbour of its neighbours).
    Each candidate is scored by how many of the VL's lines pair against its
    real yard (far site + exact X/R/B). Winner needs >= 2 paired lines, or a
    single NEAR-EXACT one (cost < 0.2), and must strictly beat the runner-up.
    """
    mat_lines = [e for n in ns for e in eq_of_bus.get(str(n), ())
                 if e["kind"] == "line" and e["far_site"]]
    cands = {c for c in cands if c}
    if ref_adj:
        for e in mat_lines:
            cands |= ref_adj.get(e["far_site"], set())
    # count-by-type constraint: a VL with k lines can only be a yard with a
    # comparable line-departure count — the degree penalty ranks candidates
    # whose real yard size matches the VL's, which breaks ties inside
    # anchor-free clusters where few lines pair.
    n_mat = len({e["id"] for e in mat_lines})
    scores = []
    for cand in sorted(cands):
        ref_vl = ref_ix.get((cand, kv))
        if ref_vl is None:
            continue
        deps = [d for d in ref_departs_fn(ref_vl) if d["kind"] == "line"]
        pairing = pair_departures(mat_lines, deps)
        best_cost = min((_sig_cost(m["sig"], d["sig"])
                         for m in mat_lines for d in deps
                         if pairing.get(m["id"]) == d["id"]), default=9.9)
        deg_pen = abs(n_mat - len(deps))
        scores.append((len(pairing), -best_cost, -deg_pen, cand))
    scores.sort(reverse=True)
    if not scores:
        return None
    n_top, negc, negd, cand = scores[0]
    if n_top < 2 and not (n_top == 1 and -negc < 0.2):
        return None
    if len(scores) > 1 and scores[0][:3] == scores[1][:3]:
        return None                       # exact tie — leave unresolved
    return cand


# ------------------------------------------------- network-source frontend
def plans_from_network(src, bus_sub: dict, loose_sub: dict | None = None,
                       verbose: bool = False) -> dict:
    """Real-topology plans for EVERY identity-mapped THT voltage level of the
    imported MATPOWER network — multi-node AND single-node (the game needs the
    real detailed structure everywhere manoeuvre actions may be played).

    A VL is eligible when every one of its source buses is mapped to the SAME
    substation and the reference owns that site's yard at the VL's voltage.
    Plans are keyed by ``(site, kv, frozenset(buses))`` and joined by the
    rebuild on the exact source-bus set.
    """
    ref_net = load_tht_reference()
    ref_ix = reference_vls(ref_net)
    ref_lines = ref_net.get_lines()
    ref_twt = ref_net.get_2_windings_transformers()

    vls = src.get_voltage_levels()
    nomv = {v: float(vls.loc[v, "nominal_v"]) for v in vls.index}
    buses = src.get_buses(attributes=["voltage_level_id"])

    # Node identity is the FULL pypowsybl bus id ("VL-x_0", "VL-x_1"): a
    # multi-node VL's buses share the same MATPOWER number, so keying by
    # number would merge distinct electrical nodes (measured: 6383 buses
    # instead of 6468 and a diverging load flow). The MATPOWER number of a
    # bus is recovered from the LINE-f-t / TWT-f-t equipment ids (side1=f).
    def eq_nums(eid):
        parts = str(eid).split("#")[0].split("-")
        try:
            return int(parts[1]), int(parts[2])
        except (IndexError, ValueError):
            return None, None

    vl_buses: dict = collections.defaultdict(list)
    for bid, r in buses.iterrows():
        vl_buses[r["voltage_level_id"]].append(str(bid))
    kv_of_bid = {bid: int(round(nomv.get(vl, 0)))
                 for vl, bs in vl_buses.items() for bid in bs}

    lines = src.get_lines(all_attributes=True)
    twt = src.get_2_windings_transformers(all_attributes=True)
    num_of_bid: dict = {}
    for df in (lines, twt):
        for eid, r in df.iterrows():
            f, t = eq_nums(eid)
            if f is not None:
                num_of_bid.setdefault(str(r["bus1_id"]), f)
                num_of_bid.setdefault(str(r["bus2_id"]), t)

    overlay: dict = {}      # bus id -> site fixed by an already-planned VL

    def site_of_bid(bid):
        if str(bid) in overlay:
            return overlay[str(bid)]
        n = num_of_bid.get(str(bid))
        rec = bus_sub.get(n) if n is not None else None
        if rec is None and n is not None:
            rec = bus_sub.get(str(n))
        if rec is None:
            return None
        return rec["substation"] if isinstance(rec, dict) else rec

    def loose_site_of_bid(bid):
        if not loose_sub:
            return None
        n = num_of_bid.get(str(bid))
        rec = loose_sub.get(n) if n is not None else None
        if rec is None and n is not None:
            rec = loose_sub.get(str(n))
        if rec is None:
            return None
        return rec["substation"] if isinstance(rec, dict) else rec

    # MATPOWER equipment per pypowsybl bus id: same-kv lines + transformers.
    # Rebuilt each recursion pass: far sites gain information as neighbouring
    # VLs get planned (their buses enter the overlay).
    eq_of_bus: dict = collections.defaultdict(list)

    def rebuild_lines_eq():
        for lst in eq_of_bus.values():
            lst[:] = [e for e in lst if e["kind"] != "line"]
        for lid, r in lines.iterrows():
            b1, b2 = str(r["bus1_id"]), str(r["bus2_id"])
            if kv_of_bid.get(b1) != kv_of_bid.get(b2):
                continue
            b_tot = abs(r.get("b1", 0.0)) + abs(r.get("b2", 0.0))
            sig = _line_sig(abs(r["x"]), abs(r["r"]), b_tot)
            for a, b_ in ((b1, b2), (b2, b1)):
                eq_of_bus[a].append({"id": str(lid), "kind": "line",
                                     "far_site": site_of_bid(b_), "sig": sig})

    for tid, r in twt.iterrows():
        # intra-VL transformers are SERIES devices (phase-shifter loops, e.g.
        # the Logelbach TD: TWT-6102-6231 + LINE-6231-6102 between two nodes
        # of one VL) — pairing one to a substation AT cell slots both ends on
        # the same busbar and kills it. They stay on the generic per-node
        # layout, which keeps the loop's two nodes apart.
        if r["voltage_level1_id"] == r["voltage_level2_id"]:
            continue
        for a in (str(r["bus1_id"]), str(r["bus2_id"])):
            eq_of_bus[a].append({"id": str(tid), "kind": "xfmr",
                                 "far_site": None, "sig": None})

    # reference departures per ref VL: lines (far site + signature) + 2WT
    def ref_departs(ref_vl):
        deps = []
        for lid, r in ref_lines.iterrows():
            v1, v2 = r["voltage_level1_id"], r["voltage_level2_id"]
            if ref_vl not in (v1, v2):
                continue
            other = v2 if v1 == ref_vl else v1
            b_tot = abs(r.get("b1", 0.0)) + abs(r.get("b2", 0.0))
            deps.append({"id": lid, "kind": "line", "far_site": other[:5],
                         "sig": _line_sig(r["x"], r["r"], b_tot)})
        for tid, r in ref_twt.iterrows():
            if ref_vl in (r["voltage_level1_id"], r["voltage_level2_id"]):
                deps.append({"id": tid, "kind": "xfmr", "far_site": None,
                             "sig": None})
        return deps

    # reference site adjacency (lines), for graph-structure candidates
    ref_adj: dict = collections.defaultdict(set)
    for _, r in ref_lines.iterrows():
        s1, s2 = r["voltage_level1_id"][:5], r["voltage_level2_id"][:5]
        if s1 != s2:
            ref_adj[s1].add(s2)
            ref_adj[s2].add(s1)

    plans: dict = {}
    stats = collections.Counter()
    planned_vls: set = set()
    for _pass in range(3):
        rebuild_lines_eq()
        pass_added = 0
        pass_stats = collections.Counter()
        for vl, ns in sorted(vl_buses.items()):
            if vl in planned_vls:
                continue
            plan = _try_plan_vl(vl, ns, nomv, site_of_bid, loose_site_of_bid,
                                _arbitrate_site, ref_ix, ref_departs, ref_adj,
                                eq_of_bus, ref_net, pass_stats, verbose)
            if plan is None:
                continue
            plans[(plan["site"], plan["kv"], frozenset(plan["buses"]))] = plan
            planned_vls.add(vl)
            for b in plan["buses"]:
                overlay[b] = plan["site"]
            pass_added += 1
        stats = pass_stats
        if verbose:
            print(f"  [rte-topo] passe {_pass + 1}: +{pass_added} plans "
                  f"(total {len(plans)})")
        if pass_added == 0:
            break

    # ---- anchor-free clusters: joint constrained backtracking -------------
    unresolved = [vl for vl, ns in vl_buses.items()
                  if vl not in planned_vls
                  and int(round(nomv.get(vl, 0))) in (380, 225)]
    if unresolved:
        rebuild_lines_eq()
        taken = {(p["site"], p["kv"]) for p in plans.values()}
        assign = _cluster_solve(unresolved, vl_buses, nomv, eq_of_bus,
                                site_of_bid, ref_ix, ref_departs, ref_adj,
                                taken, verbose=verbose)
        if assign:
            for vl, site in assign.items():
                for b in vl_buses[vl]:
                    overlay[str(b)] = site
            rebuild_lines_eq()
            added = 0
            for vl in sorted(assign):
                plan = _try_plan_vl(vl, vl_buses[vl], nomv, site_of_bid,
                                    loose_site_of_bid, _arbitrate_site,
                                    ref_ix, ref_departs, ref_adj, eq_of_bus,
                                    ref_net, stats, verbose)
                if plan is not None:
                    plans[(plan["site"], plan["kv"],
                           frozenset(plan["buses"]))] = plan
                    planned_vls.add(vl)
                    added += 1
            if verbose:
                print(f"  [rte-topo] passe cluster: +{added} plans "
                      f"(total {len(plans)})")
    if verbose:
        print(f"  [rte-topo] bilan: {dict(stats)}")
    return plans


def _try_plan_vl(vl, ns, nomv, site_of_bid, loose_site_of_bid, arbitrate,
                 ref_ix, ref_departs, ref_adj, eq_of_bus, ref_net, stats,
                 verbose):
        kv = int(round(nomv.get(vl, 0)))
        if kv not in (380, 225):
            return None
        # The VL *is* one physical substation: its site is the strict-mapped
        # buses' common site. Conflicting strict sites, or no strict site at
        # all, are ARBITRATED BY THE VL'S OWN OUVRAGES: every candidate (the
        # conflicting strict sites, or the buses' loose sites) is scored by
        # how many of the VL's lines pair — far site + exact X/R/B features —
        # against the real departures of that candidate's yard; a clear
        # winner (>=2 paired, strictly ahead) takes the VL. This is
        # deduction-by-elimination on graph structure, not on the map alone.
        sites = {x for x in (site_of_bid(n) for n in ns) if x}
        if len(sites) != 1:
            cands = set(sites)
            for n in ns:
                ls = loose_site_of_bid(n)
                if ls:
                    cands.add(ls)
            best = arbitrate(cands, ns, kv, eq_of_bus, ref_ix,
                             ref_departs, ref_adj=ref_adj)
            if best is None:
                stats["vl_site_mixte_ou_absent"] += 1
                return None
            stats["site_arbitre"] += 1
            s = best
        else:
            s = next(iter(sites))
        ref_vl = ref_ix.get((s, kv))
        if ref_vl is None:
            stats["vl_sans_yard_ref"] += 1
            return None
        mat_groups = {n: [e["id"] for e in eq_of_bus.get(n, ())] for n in ns}
        mat_groups = {n: ids for n, ids in mat_groups.items() if ids}
        if not mat_groups:
            stats["vl_sans_equipement"] += 1
            return None
        deps = ref_departs(ref_vl)
        # pair the lines by far-site+features, the transformers by exclusivity
        mat_flat = [e for n in ns for e in eq_of_bus.get(n, ())]
        pairing = pair_departures(
            [e for e in mat_flat if e["kind"] == "line" and e["far_site"]],
            [d for d in deps if d["kind"] == "line"])
        rte_x = [d["id"] for d in deps if d["kind"] == "xfmr"]
        mat_x = sorted({e["id"] for e in mat_flat if e["kind"] == "xfmr"})
        for mid, rid in zip(mat_x, rte_x):
            pairing[mid] = rid
        try:
            plan = plan_for_vl(ref_net, ref_vl, mat_groups, pairing,
                               all_nodes=[str(n) for n in ns])
        except Exception as exc:  # noqa: BLE001 — graceful per-VL degradation
            if verbose:
                print(f"  [rte-topo] {ref_vl}: libTOPO KO ({exc})")
            stats["libtopo_ko"] += 1
            plan = None
        if plan is None:
            stats["plan_none"] += 1
            return None
        plan["site"], plan["kv"], plan["buses"] = s, kv, sorted(str(n) for n in ns)
        stats["multi" if len(ns) > 1 else "mono"] += 1
        if verbose and len(ns) > 1:
            print(f"  [rte-topo] {ref_vl}: {plan['n_busbars']} barres "
                  f"({plan['n_real_busbars']} réelles), "
                  f"{len(plan['slot'])} départs, open@{plan['open_after']}")
        return plan


# ---------------------------------------------------- anchor-free clusters
def _cluster_solve(unresolved, vl_buses, nomv, eq_of_bus, site_of_bid,
                   ref_ix, ref_departs_fn, ref_adj, taken_sites,
                   verbose=False):
    """Joint resolution of an anchor-free cluster of VLs by constrained
    backtracking on graph structure.

    Local deduction cannot start inside a cluster whose members only point at
    each other. Jointly, the constraints are strong: every VL must sit on a
    site whose real yard exists at its voltage, adjacent (in the reference)
    to the sites of its already-resolved neighbours AND of its co-cluster
    neighbours; two VLs cannot share a (site, kv) yard; candidates are scored
    by ouvrage pairing. Most-constrained-first DFS with pruning.

    Returns {vl: site} for the assignments found (possibly partial: the DFS
    only fixes VLs whose candidate list is non-empty and consistent).
    """
    members = set(unresolved)
    # neighbour sites (resolved) and cluster edges, per member VL
    fixed_nbrs: dict = collections.defaultdict(set)
    cluster_edges: dict = collections.defaultdict(set)
    bid_vl = {str(b): vl for vl, bs in vl_buses.items() for b in bs}
    for vl in members:
        for b in vl_buses[vl]:
            for e in eq_of_bus.get(str(b), ()):
                if e["kind"] != "line":
                    continue
                if e["far_site"]:
                    fixed_nbrs[vl].add(e["far_site"])
    # cluster adjacency via shared line ids
    line_vls: dict = collections.defaultdict(set)
    for vl in members:
        for b in vl_buses[vl]:
            for e in eq_of_bus.get(str(b), ()):
                if e["kind"] == "line":
                    line_vls[e["id"]].add(vl)
    for _lid, vls_ in line_vls.items():
        for a in vls_:
            for b in vls_:
                if a != b:
                    cluster_edges[a].add(b)

    # candidates per VL: sites adjacent (ref) to every fixed neighbour site,
    # owning the right yard, not already taken — scored by ouvrage pairing
    cand: dict = {}
    for vl in members:
        kv = int(round(nomv.get(vl, 0)))
        pool: set | None = None
        for s in fixed_nbrs[vl]:
            near = ref_adj.get(s, set())
            pool = near if pool is None else (pool & near)
        if pool is None:
            continue                      # no fixed neighbour at all
        pool = {s for s in pool if (s, kv) in ref_ix
                and (s, kv) not in taken_sites}
        if not pool:
            continue
        mat_lines = [e for b in vl_buses[vl] for e in eq_of_bus.get(str(b), ())
                     if e["kind"] == "line" and e["far_site"]]
        scored = []
        for s in sorted(pool):
            deps = [d for d in ref_departs_fn(ref_ix[(s, kv)])
                    if d["kind"] == "line"]
            scored.append((-len(pair_departures(mat_lines, deps)),
                           abs(len(mat_lines) - len(deps)), s))
        scored.sort()
        cand[vl] = [s for *_x, s in scored[:4]]
    if not cand:
        return {}

    order = sorted(cand, key=lambda vl: len(cand[vl]))
    assign: dict = {}

    def ok(vl, s):
        kv = int(round(nomv.get(vl, 0)))
        if any(a_s == s and int(round(nomv.get(a_vl, 0))) == kv
               for a_vl, a_s in assign.items()):
            return False                  # yard exclusivity
        for nb in cluster_edges[vl]:
            if nb in assign and assign[nb] != s \
                    and assign[nb] not in ref_adj.get(s, set()):
                return False              # cluster edges must be real-adjacent
        return True

    def dfs(i):
        if i == len(order):
            return True
        vl = order[i]
        for s in cand[vl]:
            if ok(vl, s):
                assign[vl] = s
                if dfs(i + 1):
                    return True
                del assign[vl]
        # leaving this VL unassigned is preferable to failing the cluster —
        # tried last, so assignment always wins when consistent
        return dfs(i + 1)

    dfs(0)
    if verbose and assign:
        print(f"  [rte-topo] cluster-solve: {len(assign)}/{len(members)} "
              f"VL affectés {sorted(assign.items())[:6]}")
    return assign
