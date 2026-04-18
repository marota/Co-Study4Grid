# Vectorize `NetworkTopologyCache` node-breaker column builders (upstream)

## Trouvaille

Profilage détaillé de `recommender_service.update_config` sur la
grille France 400 kV (118 MB) : **`enrich_actions_lazy` prenait 8 s**,
essentiellement bloqué sur la construction de `NetworkTopologyCache`
(~9.6 s). Décomposition :

| Sous-étape | Temps | % |
|---|---|---|
| **`_get_switches_with_topology`** | **6 137 ms** | **64 %** 🔴 |
| `_get_branch_with_bus_breaker_info` (branches + lines) | 1 631 ms | 17 % |
| `_get_injection_with_bus_breaker_info` (loads+gens+shunts) | 619 ms | 6 % |
| Autres (pandas groupby, Union-Find, etc.) | ~1 200 ms | 13 % |

## Cause racine

Trois helpers dans
`expert_op4grid_recommender/utils/conversion_actions_repas.py` utilisaient
`df.iterrows()` pour construire les IDs VL-préfixés en mode node-breaker :

```python
# Ancien code (6 137 ms sur 85 304 switches !)
bus1_ids = [
    _node_breaker_node_id(row['voltage_level_id'], int(row['node1']))
    if pd.notna(row['node1']) else None
    for _, row in df.iterrows()
]
```

`df.iterrows()` est réputé pour être **50-100× plus lent** que les
opérations pandas vectorisées sur de grandes DataFrames. Sur une grille
France avec 85 304 switches, on payait ~6 s pour une opération qui
devrait en prendre <100 ms.

## Correction upstream (`expert_op4grid_recommender == 0.2.0.post4`, commit `ee5c8a9a`)

Remplacement des 3 loops `iterrows` par des opérations pandas
vectorisées :

```python
# Nouveau code (~80 ms sur 85 304 switches — 75× plus rapide)
vl_str = df['voltage_level_id'].astype(str)
mask1 = df['node1'].notna()
bus1_series = vl_str + '#' + df['node1'].where(mask1, 0).astype('int64').astype(str)
bus1_series[~mask1] = None
```

Output **strictement identique** à l'ancien code (validé par test
de référence + 7 tests dédiés + 1 test d'intégration sur grille réelle).

## Tests upstream

`tests/test_conversion_actions_helpers_vectorized.py` (7 tests) :

- Switches : vectorized matches iterrows reference (test de régression)
- Switches : NaN handling sur chaque côté
- Switches : DataFrame vide
- Injections : conversion basique node → VL#node
- Injections : colonnes `node` en int vs float64
- Branches/lines : conversion basique
- Branches : NaN sur un des terminals

Le test d'intégration existant
(`test_environment_detection.py::test_non_reconnectable_detection_with_date`)
sur une petite grille node-breaker réelle continue de passer — valide
la correction numérique avec physique réelle.

## Mesure sur `/api/config` (grille France 118 MB)

| Métrique | Avant | Après | Δ |
|---|---|---|---|
| `_get_switches_with_topology` | 6 137 ms | **80 ms** | **−6 057 ms (77×)** |
| `NetworkTopologyCache.__init__` | 9 578 ms | **2 000 ms** | **−7 578 ms (4.8×)** |
| `recommender.update_config` (main thread) | 12 191 ms | **4 588 ms** | **−7 603 ms (62 %)** |
| `/api/config` endpoint wall-clock | 14 891 ms | **11 660 ms** | **−3 231 ms** |

Le gain réel sur l'endpoint est plus modeste que sur update_config
pur car le worker NAD prefetch qui tourne en parallèle dépasse
maintenant l'endpoint de ~1.1 s (il était éclipsé par update_config
avant).

## Impact projeté sur Load Study (trace v15)

| Segment | v10 | v15 attendu |
|---|---|---|
| `/api/config` | 15 966 ms | **~11-12 s** (−4-5 s) |
| NAD worker parallèle | caché | finit ~1-2 s après config |
| 4 XHRs parallèles | ~1.4 s | ~0.5-1 s (moins de contention) |
| **Fin dernier XHR** | 17 384 ms | **~12-13 s** (−4-5 s) |
| **Load Study v6 → v15** | −19 % | **~−45 à −50 %** |

## Dépendance

Co-Study4Grid requiert `expert_op4grid_recommender >= 0.2.0.post4`.
Aucun changement nécessaire dans Co-Study4Grid — le gain vient
exclusivement de l'upstream patch, qui s'active automatiquement
à chaque import.

## Leçon

Dans toute lib Python qui manipule de grosses DataFrames pandas,
**`df.iterrows()` est un code smell** qui doit déclencher un examen
critique. Les opérations pandas vectorisées (arithmétique / string
concat sur Series) sont quasiment toujours 10-100× plus rapides.
Profile `NetworkTopologyCache` révèle une optimisation de 4.8× sur
un algorithme qui paraissait "déjà rapide".
