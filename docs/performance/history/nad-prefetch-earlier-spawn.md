# Spawn NAD prefetch earlier in `update_config`

## Contexte

Après la vectorisation de `NetworkTopologyCache` (commit `f56438f`,
gain −7.6 s sur `update_config`), la trace v15 a révélé un effet de
bord : **`/api/network-diagram` est passé de 352 ms à 1 974 ms**
(+1 622 ms). Le goulot a simplement été déplacé.

### Cause

Le worker NAD prefetch (~6 s de compute pypowsybl) était spawné
tardivement dans `update_config`, juste avant le setup grid2op. Avec
la vectorisation, le reste d'`update_config` ne prend plus que ~2 s,
donc le worker n'a pas assez de temps pour finir avant la réponse
`/api/config`. Quand le frontend appelle ensuite
`/api/network-diagram`, le endpoint attend que le worker termine
(~1.6 s restants).

Avant vectorisation, `update_config` durait ~12 s → le worker avait
largement le temps de finir en parallèle.

## Correction

Déplacement de `self.prefetch_base_nad_async()` **plus tôt dans
`update_config`** — juste après le bloc de configuration des lignes
monitoring, et **avant** le load du dictionnaire d'actions +
`enrich_actions_lazy`.

**Avant** (juste avant `setup_environment_configs_pypowsybl`) :
```
update_config timeline:
  0-0.1s: globals mutation
  0.1-2.1s: enrich_actions_lazy (NetworkTopologyCache)
  2.1-2.2s: more globals
  2.2s:  ← prefetch_base_nad_async()
  2.2-4.5s: setup_environment_configs_pypowsybl
  4.5s: config returns

NAD worker: spawned at 2.2s, runs ~6 s → finishes at 8.2s
client fires /api/network-diagram at 4.5s → waits 3.7s → gets SVG
```

**Après** :
```
update_config timeline:
  0-0.1s: globals mutation (ENV_PATH, LAYOUT_FILE_PATH, monitoring)
  0.1s:  ← prefetch_base_nad_async()
  0.1-2.1s: enrich_actions_lazy
  2.1-4.5s: setup_environment_configs_pypowsybl
  4.5s: config returns

NAD worker: spawned at 0.1s, runs ~6 s → finishes at 6.1s
client fires /api/network-diagram at 4.5s → waits 1.6s → gets SVG
```

Gain : **−2 s sur `/api/network-diagram`** (avant cette trace,
estimation — à confirmer).

## Dépendances config du worker NAD

Le worker lance `get_network_diagram()` qui a besoin de :

- `config.ENV_PATH` (pour `_get_base_network` fallback)
- `config.LAYOUT_FILE_PATH` (pour `_load_layout`)
- `config.MONITORING_FACTOR_THERMAL_LIMITS` (indirect via
  `_get_lines_we_care_about` → `_get_monitoring_parameters`)
- `config.IGNORE_LINES_MONITORING`

Tous ces globals sont définis **dans les lignes 247-310** de
`update_config`, avant le bloc de chargement du dict d'actions.
Le nouveau spawn est à la ligne 311 (juste après le bloc monitoring) —
tous les globals NAD-dépendants sont déjà en place.

## Mesure sur grille France 118 MB

Mesure via `/tmp/profile_endpoint_real.py` :

| | Avant (v15) | Après | Δ |
|---|---|---|---|
| `update_config` (main thread) | 4 588 ms | 8 745 ms | +4 157 ms (worker en parallèle) |
| Response block (get_disc + monitored) | 4 122 ms | 211 ms | **−3 911 ms** (plus de contention) |
| **Total main thread** | 11 660 ms | **11 528 ms** | −131 ms |
| **NAD worker encore actif après endpoint** | 1 119 ms | **0 ms** 🎯 | −1 119 ms |

L'endpoint `/api/config` prend essentiellement le même temps, mais le
worker NAD **termine maintenant avant la réponse** → pas de contention
avec les 4 XHRs parallèles qui suivent.

## Impact attendu sur trace v16

| Segment | v15 | v16 attendu |
|---|---|---|
| `/api/config` | 10 662 ms | ~11 s |
| `/api/branches` | 1 688 ms | ~500-800 ms (worker fini) |
| `/api/voltage-levels` | 692 ms | ~300-400 ms |
| `/api/nominal-voltages` | 572 ms | ~300 ms |
| `/api/network-diagram` | 1 974 ms | **~350 ms** (cache hit) |
| **Fin dernier XHR** | 12 636 ms | **~11.5-12 s** (−0.5-1 s) |

Gain global wall-clock modeste, mais la **forme de la critical path
change** : toute l'activité serveur est maintenant avant la réponse,
les XHRs post-config sont tous des aller-retours quasi-instantanés.

## Invariants

Aucun changement sémantique. Le worker fait exactement le même
travail, juste démarré plus tôt. Les 372 tests backend continuent
de passer.

Le seul risque théorique : **contention** entre le worker (qui fait
du variant switching + LF pypowsybl) et `enrich_actions_lazy` (qui
fait des lectures pypowsybl massives via `NetworkTopologyCache`).
En pratique :

- `enrich` lit la topologie (switches, lignes, nodes) via
  `get_*(all_attributes=True)` qui retourne des DataFrames
  **snapshots** — pas sensibles à l'état du variant courant.
- Le worker fait des variant ops, mais dans un `try/finally` qui
  restaure l'état.

Donc pas de race fonctionnelle. L'impact mesuré est : le worker
s'exécute en ~6-8 s (légèrement plus lent à cause de la contention
pypowsybl JVM), mais cette lenteur est intégralement absorbée par
le temps d'`update_config` et n'affecte pas l'endpoint.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `expert_backend/services/recommender_service.py` | `prefetch_base_nad_async()` appelé à la ligne ~311 (après monitoring config) au lieu de ~367 (avant env setup). Le point d'appel précédent est remplacé par un commentaire explicatif. |
