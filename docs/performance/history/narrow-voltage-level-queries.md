# Narrow pypowsybl queries on voltage-level endpoints

## Contexte

Après la vectorisation de `NetworkTopologyCache` (0.2.0.post4-post6) et les
patches DC_VALUES + GEOGRAPHICAL, les 3 queries suivantes restaient sur
l'API `get_voltage_levels()` (ou `get_switches(attributes=[..., 'kind', ...])`)
avec des colonnes non utilisées downstream :

| Endpoint | Query avant | Temps avant |
|---|---|---|
| `_get_switches_with_topology` (upstream) | 5 attributes dont `kind` inutilisé | 174 ms |
| `/api/voltage-levels` | `get_voltage_levels()` (all_attributes) + sort index | 7.5 ms |
| `/api/nominal-voltages` | `get_voltage_levels()` + `iterrows()` | 144 ms |

## Patches

### 1. `_get_switches_with_topology` — drop `kind` (upstream)

Le `kind` était demandé mais jamais consommé : le post-processing ne
manipule que `voltage_level_id`, `node1`/`node2` et `open`. Retirer
`kind` des attributs demandés libère ~20 ms de sérialisation
Java→Python sur les 85 k switches.

| | Avant | Après |
|---|---|---|
| Query `get_switches(attrs=[...kind...])` | 100 ms | 80 ms |
| Function total (query + vectorized string ops) | **174 ms** | **141 ms** (−19 %) |

### 2. `/api/voltage-levels` — `attributes=[]` (Co-Study4Grid)

L'endpoint retourne la liste triée des IDs de voltage levels — rien
d'autre. `get_voltage_levels()` avec défaut rapatrie `nominal_v`,
`topology_kind`, `name`, `substation_id`, ... (5 colonnes × 6 835
lignes) pour rien. `attributes=[]` skip toute la sérialisation des
colonnes et ne rapporte que l'index.

Attention : pandas considère un DataFrame `6835 × 0` comme `.empty ==
True`. Le check devient `len(index) > 0`.

| | Avant | Après |
|---|---|---|
| `NetworkService.get_voltage_levels()` | 7.5 ms | **4.5 ms** (−40 %) |

### 3. `/api/nominal-voltages` — narrow attrs + no-iterrows (Co-Study4Grid)

Deux problèmes cumulés :

1. `get_voltage_levels()` rapatriait toutes les colonnes alors qu'on
   n'utilise que `nominal_v` (~4 ms gaspillés).
2. **Le vrai goulot** : la dict-comprehension finale utilisait
   `voltage_levels.iterrows()` pour construire `{vl_id: clean_v}`.
   Pandas `iterrows` est notoirement lent — ~130 ms sur 6 835 lignes.

Remplacé par :

```python
nom_v_arr = voltage_levels['nominal_v'].values
idx_list = voltage_levels.index.tolist()
# ...clustering + bucketing identique...
nom_v_list = nom_v_arr.tolist()
return {
    idx_list[i]: raw_to_clean[float(nom_v_list[i])]
    for i in range(len(idx_list))
}
```

| | Avant | Après |
|---|---|---|
| `NetworkService.get_nominal_voltages()` | **144 ms** | **5.7 ms** (**25×** faster) |

Output **strictement identique** (vérifié par `dict == dict` sur les
6 835 mappings).

## Résultat cumulé

| Endpoint | Avant | Après | Gain |
|---|---|---|---|
| `_get_switches_with_topology` | 174 ms | 141 ms | −33 ms |
| `/api/voltage-levels` | 7.5 ms | 4.5 ms | −3 ms |
| `/api/nominal-voltages` | 144 ms | 5.7 ms | **−138 ms** |
| **Total** | **325 ms** | **151 ms** | **−174 ms** |

## Tests

- Upstream : 117 tests passent (pypowsybl_backend + voltage_init_mode +
  conversion_actions + environment_detection + detect_non_reconnectable).
- Co-Study4Grid : 26 tests passent (network_service + diagram_mixin).

## Dépendance

- Patch 1 (`_get_switches_with_topology`) : upstream
  `expert_op4grid_recommender 0.2.0.post8`.
- Patches 2 et 3 : Co-Study4Grid uniquement (pas de bump upstream).
