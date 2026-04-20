# NetworkTopologyCache — 2 optimisations additionnelles (iter 2)

## Contexte

Après la première passe de vectorisation (commit upstream `ee5c8a9a`,
0.2.0.post4, cf `docs/performance/history/vectorize-topology-cache.md`), le profilage
de `/api/config` sur la grille France 400 kV montrait :

| Étape du cache | Temps |
|---|---|
| `_get_switches_with_topology` (vectorized) | 313 ms |
| `vl_switches_groupby` (pandas groupby loop) | **446 ms** 🔴 |
| `get_lines + get_branches + autres queries` | ~210 ms |
| Per-VL UF baseline + divers | ~350 ms |
| **Total NetworkTopologyCache** | **~1 320 ms** |

On attaque les deux plus gros postes avec des **patches upstream purement
pandas/numpy** qui préservent l'output à l'identique.

## Patch 1 — Raw numpy loop au lieu de pandas groupby (0.2.0.post5, commit `8b72e392`)

`_build_vl_topology_data` contenait :

```python
for vl_id, grp in valid_sw.groupby('voltage_level_id', sort=False):
    self._vl_switches[vl_id] = list(zip(grp.index, grp['bus_breaker_bus1_id'], grp['bus_breaker_bus2_id']))
    self._vl_nodes[vl_id] = set(grp['bus_breaker_bus1_id']) | set(grp['bus_breaker_bus2_id'])
```

Pandas `groupby().iter()` matérialise un DataFrame slice par groupe —
très coûteux quand on a 6 835 groupes. Remplacé par un **raw loop Python
sur les arrays numpy** :

```python
vl_arr = valid_sw['voltage_level_id'].values
idx_arr = valid_sw.index.values
b1_arr = valid_sw['bus_breaker_bus1_id'].values
b2_arr = valid_sw['bus_breaker_bus2_id'].values
for i in range(len(vl_arr)):
    vl_id = vl_arr[i]
    b1, b2 = b1_arr[i], b2_arr[i]
    sw_tup = (idx_arr[i], b1, b2)
    sw_list = _vl_switches.get(vl_id)
    if sw_list is None:
        _vl_switches[vl_id] = [sw_tup]
        _vl_nodes[vl_id] = {b1, b2}
    else:
        sw_list.append(sw_tup)
        nodes = _vl_nodes[vl_id]; nodes.add(b1); nodes.add(b2)
```

Benchmark sur 85 304 switches / 6 835 VLs :

| Approche | Median |
|---|---|
| pandas `groupby().iter()` (actuel) | 374 ms |
| itertools + sorted slice | 80 ms |
| defaultdict append loop | 98 ms |
| **raw loop + `dict.get`** | **48 ms** (**7.8×**) |

## Patch 2 — Narrow pypowsybl query attributes (0.2.0.post6, commit `2f634911`)

Les 3 helpers appelaient `getter(all_attributes=True)` pour récupérer
toutes les colonnes pypowsybl (10 à 37 selon l'élément), alors qu'on
n'en consomme que 2 à 5. Chaque colonne non utilisée coûte du temps de
sérialisation Java → Python.

Benchmark par query (PyPSA-EUR France) :

| Query | `all_attributes=True` | Narrow (`attributes=[...]`) | Gain |
|---|---|---|---|
| `get_switches` | 201 ms | 95 ms | −106 ms (−53 %) |
| `get_lines` | 72 ms | 29 ms | −43 ms (−60 %) |
| `get_branches` | 61 ms | 43 ms | −18 ms (−30 %) |
| `get_loads` | 36 ms | 25 ms | −11 ms (−31 %) |
| `get_generators` | 41 ms | 18 ms | −23 ms (−56 %) |

Chaque helper déclare maintenant la liste minimale de colonnes consommées
par son code downstream, avec fallback sur `all_attributes=True` si la
version pypowsybl installée ne supporte pas un attribut demandé.

## Résultat cumulé

**NetworkTopologyCache init complet** sur grille France 118 MB :

| | Temps | Speedup cumulé |
|---|---|---|
| 0.2.0.post3 (pré-vectorize) | 9 578 ms | 1× |
| **0.2.0.post4** (vectorize 3 helpers) | **1 300 ms** | **7.4×** |
| **0.2.0.post5** (groupby→raw loop) | **1 024 ms** | **9.4×** |
| **0.2.0.post6** (narrow attributes) | **~700 ms** | **13.7×** 🎯 |

## Validation

- Les 30 tests du module (environment_detection + conversion_actions
  vectorized + detect_non_reconnectable_fast_path + environment_pypowsybl)
  passent.
- Output `_vl_switches` / `_vl_nodes` / autres structures : validés
  strictement identiques par comparaison dict-equality sur la grille
  réelle (0 mismatch sur 6 835 VLs / 85 304 switches).

## Projection sur Load Study

La gain sur NetworkTopologyCache (~−625 ms par rapport à post4) se
retrouve proportionnellement dans `/api/config` côté backend. Attendu
sur trace v17 :

| Segment | v16 | v17 attendu |
|---|---|---|
| `/api/config` | 10 190 ms | **~9.5 s** |
| Fin dernier XHR | 11 723 ms | **~11 s** |

Gain estimé : −500-700 ms. Marginal comparé à la série précédente mais
toujours positif.

## Dépendance

Co-Study4Grid requiert `expert_op4grid_recommender >= 0.2.0.post6`.
Aucun changement côté Co-Study4Grid — les optims sont purement upstream
et s'activent automatiquement.
