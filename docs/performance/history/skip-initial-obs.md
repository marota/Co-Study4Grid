# Skip the unused `env.get_obs()` in `setup_environment_configs_pypowsybl`

## Trouvaille

Le profilage détaillé de `/api/config` sur la grille France 400 kV
(118 MB) a révélé que **`env.get_obs()` coûte ~4.6 s** dans
`setup_environment_configs_pypowsybl`. Il construit la première
`PypowsyblObservation` en faisant des reads pypowsybl massifs
(`get_lines`, `get_buses`, `get_generators`, `get_loads`, group-bys
pandas…).

**Mais** dans `recommender_service.update_config` :

```python
env, _obs, env_path, ... = setup_environment_configs_pypowsybl(network=self._base_network)
#     ^^^^  DISCARDED
```

Le `_obs` retourné est **jeté** — jamais stocké dans
`_cached_env_context`, jamais utilisé par `run_analysis_step1`. Les
~4.6 s de construction sont du pur gaspillage.

## Fix

### Upstream (`expert_op4grid_recommender >= 0.2.0.post3`, commit `b6f6282a`)

Nouveau paramètre `skip_initial_obs: bool = False` sur :

- `get_env_first_obs_pypowsybl`
- `setup_environment_configs_pypowsybl`
- `setup_environment_configs` (compat wrapper)
- `main.setup_environment_pypowsybl` (compat wrapper)

Quand `True`, `env.get_obs()` est sauté et `obs=None` est retourné dans
le tuple. Les appels ultérieurs à `env.get_obs()` par le caller (par
ex. `run_analysis_step1`) restent fonctionnels.

Backward-compatible : défaut `False` → comportement historique
inchangé.

### Co-Study4Grid (`recommender_service.update_config`)

```python
env, _obs, ... = setup_environment_configs_pypowsybl(
    network=self._base_network,
    skip_initial_obs=True,  # NEW
)
```

## Invariant testé

### Upstream (`tests/test_environment_pypowsybl.py`, 3 nouveaux tests)

- `test_get_env_first_obs_skips_get_obs_when_requested` — avec
  `skip_initial_obs=True`, `env.get_obs()` n'est PAS appelée et
  `obs is None`.
- `test_get_env_first_obs_calls_get_obs_by_default` — défaut conserve
  le comportement historique.
- `test_setup_environment_configs_forwards_skip_initial_obs` — le
  wrapper de compat thread le flag jusqu'à l'inner function.

### Co-Study4Grid (`test_update_config_injects_preloaded_network_into_upstream`)

Assertion enrichie pour vérifier que `update_config` passe
`skip_initial_obs=True` à l'upstream helper.

## Mesure sur grille France 400 kV

| | Avant | Après | Δ |
|---|---|---|---|
| `env.get_obs()` (première obs, discardée) | 4 588 ms | **0 ms** | **−4 588 ms** |
| `update_config` total (main thread) | ~16-18 s | 12 191 ms | ~−4 s |
| `/api/config` endpoint wall-clock | ~18 s | **~14.9 s** | **~−3.5 s** |

## Impact projeté sur Load Study (trace v14)

| Segment | v10 | v14 attendu |
|---|---|---|
| `/api/config` | 15 966 ms | **~12-13 s** (−3 à −4 s) |
| 4 XHRs parallèles | ~1.4 s (slowest) | ~0.5-1 s (moins de contention NAD) |
| **Fin dernier XHR** | 17 384 ms | **~13-14 s** (−3-4 s) |
| **Load Study v6 → v14** | −19 % | **~−40 %** (si le gain tient) |

## Dépendance

Co-Study4Grid requiert `expert_op4grid_recommender >= 0.2.0.post3`.
L'ancienne version (0.2.0.post2 et antérieures) reste fonctionnelle
mais sans ce gain — si le flag `skip_initial_obs` n'est pas reconnu,
le call lèvera `TypeError`. Co-Study4Grid devrait garder une version
minimum cohérente dans ses requirements.
