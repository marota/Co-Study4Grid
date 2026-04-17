# Partage du pypowsybl Network avec le backend grid2op

## Contexte

Après la mutualisation `network_service` ↔ `recommender_service._base_network`
(`docs/perf-shared-network.md`), le même `.xiidm` était encore **chargé
deux fois** pendant `/api/config` :

1. ✅ `network_service.load_network()` — pypowsybl parse #1.
2. ✅ `recommender_service._get_base_network()` — mutualisé avec #1.
3. ⚠️ `setup_environment_configs_pypowsybl()` — pypowsybl parse **#2**
   via grid2op : la lib upstream `expert_op4grid_recommender` chargeait
   le fichier une seconde fois pour construire sa `SimulationEnvironment`.

Sur les gros réseaux (PyPSA-EUR 400 kV) ce deuxième parse coûte ~1-5 s
de CPU inutile.

## Changement

### Patch upstream (`expert_op4grid_recommender` 0.2.0.post1)

- `get_env_first_obs_pypowsybl()` accepte un paramètre
  `network: Optional[pp.network.Network] = None`. Quand non-None, la
  découverte `.xiidm` + `pp.network.load()` sont sautés ; l'instance
  injectée est passée directement à
  `SimulationEnvironment(network=..., network_path=None)`.
- `setup_environment_configs_pypowsybl()` gagne le même paramètre et
  le transmet à `get_env_first_obs_pypowsybl`.
- Les wrappers de compat (`setup_environment_configs`, `setup_environment_pypowsybl`)
  tranmettent aussi `network=` — aucune rupture d'API.
- `SimulationEnvironment.__init__` et `NetworkManager.__init__`
  **acceptaient déjà** `network=` — seul le chaînage haut-niveau
  manquait. Voir `pypowsybl_backend/simulation_env.py:46` et
  `pypowsybl_backend/network_manager.py:34`.

### Patch Co-Study4Grid

`recommender_service.update_config()` injecte `self._base_network`
(déjà pré-chauffé par `prefetch_base_nad_async`) dans l'appel upstream :

```python
env, _obs, ... = setup_environment_configs_pypowsybl(
    network=self._base_network  # ← SKIP pp.network.load() côté grid2op
)
```

## Sûreté de partage

Le même objet pypowsybl Network est maintenant référencé par **trois**
détenteurs :

- `network_service.network` — lectures seulement (`get_lines`, `get_voltage_levels`, …)
- `recommender_service._base_network` — lectures + variant switching dans
  `_get_n_variant` / `_get_n1_variant`, toujours restauré dans un `try/finally`
- `SimulationEnvironment.network_manager.network` — possédé par le
  backend grid2op, utilise intensivement le variant switching pendant
  les LF d'analyse et de simulation

**Argumentaire de non-collision** :

1. **Les LF grid2op ne tournent pas pendant `/api/config`**. Elles sont
   déclenchées par `run_analysis_step2`, `simulate_manual_action`, etc.
   — postérieures au retour de la config. Quand le frontend fire les
   4 XHRs parallèles post-config, seul le worker NAD et les lectures
   basiques tournent — pas de LF grid2op.
2. **Le worker NAD termine avant `/api/config`** (confirmé par v9 :
   diagram XHR = 379 ms = pur transfert wire). Donc au moment où les
   actions commencent à se simuler, le thread NAD est déjà fini.
3. **Un seul worker uvicorn en pratique** — Co-Study4Grid est un outil
   mono-utilisateur, pas de sessions d'analyse concurrentes qui
   partagent l'état.

**Échappatoire si problème** : `network.clone()` (API pypowsybl) — la
`SimulationEnvironment` reçoit une deep-copy. Coût ~500 ms vs ~3 s de
parse frais — toujours un gain net si on doit y recourir un jour.

## Invariants (testés)

**Upstream** (`tests/test_environment_pypowsybl.py`) :

- `test_get_env_first_obs_skips_file_load_when_network_is_injected` —
  avec un Network injecté, aucun `.xiidm` n'est découvert ni chargé ;
  `SimulationEnvironment` est construit avec `network=<injecté>` et
  `network_path=None`.
- `test_get_env_first_obs_injected_network_still_looks_up_companion_files` —
  le raccourci vaut uniquement pour le network lui-même ; les fichiers
  compagnons (thermal_limits.json, etc.) sont toujours cherchés.
- `test_get_env_first_obs_injected_network_handles_direct_xiidm_env_name` —
  quand `env_name` pointe sur un chemin de fichier direct (`/data/grid.xiidm`),
  le `env_path` retombe sur le parent pour les compagnons.
- `test_setup_environment_configs_forwards_injected_network` — le
  wrapper de compat transmet `network=` à la fonction inner.

**Co-Study4Grid** (`test_recommender_service.py::TestUpdateConfigSharesNetworkWithGrid2op`) :

- `test_update_config_injects_preloaded_network_into_upstream` — assertion
  stricte que `setup_environment_configs_pypowsybl` est appelée avec
  `network=<l'instance de self._base_network>`.

## Impact attendu

Baseline v9 (après mutualisation network_service ↔ recommender_service) :

| Segment | v9 mesuré |
|---|---|
| `/api/config` | 16 596 ms |
| `/api/network-diagram` | 379 ms |
| Total critical path | ~18 s |

Attendu v10 (avec partage grid2op) :

| Segment | v10 attendu |
|---|---|
| `/api/config` | ~13-14 s (−3 s : plus de pp.network.load côté grid2op) |
| `/api/network-diagram` | ~380 ms (inchangé, cache NAD toujours chaud) |
| Total critical path | **~15 s (−3 s vs v9, −6 s vs v7)** |

## Dépendance

Requiert `expert_op4grid_recommender >= 0.2.0.post1`. Si une version
antérieure est installée, l'appel `setup_environment_configs_pypowsybl(network=...)`
lève un `TypeError` explicite au démarrage. Pas de fallback silencieux
— ce serait masquer un problème de déploiement.

## Ce qui n'est PAS changé

- **Endpoints** : comportement identique côté client.
- **Frontend** : aucun changement.
- **Cas `_get_base_network` fallback** (`network_service.network is None`) :
  préservé pour les tests et les appels directs à `RecommenderService`
  hors `/api/config`.
- **Autres optimisations** (cache disque NAD, streaming `/api/config`) :
  orthogonales, à revisiter dans un commit ultérieur.

## Fichiers modifiés

### Upstream (`expert_op4grid_recommender`, commit `58fe2e44`)

| Fichier | Changement |
|---|---|
| `expert_op4grid_recommender/environment_pypowsybl.py` | `get_env_first_obs_pypowsybl` et `setup_environment_configs_pypowsybl` gagnent `network=None` et le transmettent à `SimulationEnvironment`. Wrapper `setup_environment_configs` aussi. |
| `expert_op4grid_recommender/main.py` | `setup_environment_pypowsybl` gagne `network=None` passthrough. |
| `tests/test_environment_pypowsybl.py` | 4 nouveaux tests sur le chemin d'injection + 1 ajustement du test compat wrapper. |
| `pyproject.toml` | 0.2.0 → 0.2.0.post1. |

### Co-Study4Grid

| Fichier | Changement |
|---|---|
| `expert_backend/services/recommender_service.py` | `update_config` passe `network=self._base_network` à `setup_environment_configs_pypowsybl`. |
| `expert_backend/tests/test_recommender_service.py` | Nouvelle classe `TestUpdateConfigSharesNetworkWithGrid2op` (1 test d'invariant). |
