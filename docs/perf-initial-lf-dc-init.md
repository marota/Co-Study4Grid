# Initial LF — use DC_VALUES init, skip failed PREVIOUS_VALUES attempt

## Contexte

Les logs d'`/api/config` comportaient systématiquement :

```
Warning: Load flow with PREVIOUS_VALUES failed
  (com.powsybl.commons.PowsyblException: Voltage magnitude is undefined
   for bus 'CHOLOP3_2'). Retrying with DC_VALUES...
```

Le LF initial dans `SimulationEnvironment._ensure_valid_state` utilisait
les paramètres par défaut (`voltage_init_mode=PREVIOUS_VALUES`), échouait
immédiatement parce qu'aucun état précédent n'existe sur un Network
fraîchement chargé, puis était relancé en interne avec `DC_VALUES`.

## Correction upstream (`expert_op4grid_recommender == 0.2.0.post7`, commit `a377a968`)

Le paramètre `voltage_init_mode` est maintenant exposé sur
`NetworkManager.run_load_flow()`. `SimulationEnvironment._ensure_valid_state`
passe explicitement `lf.VoltageInitMode.DC_VALUES` :

```python
def _ensure_valid_state(self):
    result = self.network_manager.run_load_flow(
        voltage_init_mode=lf.VoltageInitMode.DC_VALUES,
    )
```

**Point critique** : ce changement ne s'applique **qu'au LF initial**
(construction de `SimulationEnvironment` + `reset()`). Tous les autres
appels à `run_load_flow` continuent d'utiliser `PREVIOUS_VALUES` par
défaut — qui est le bon choix après une mutation (warm-start depuis
le solution précédente).

## Mesure sur grille France 118 MB

Benchmark direct (3 reps, process frais) :

| Version | LF initial median |
|---|---|
| Current (PREVIOUS → fail → DC fallback) | 660 ms |
| Direct DC_VALUES | **588 ms** |

**Gain ~70 ms**. Plus modeste que les ~1 s estimés à l'origine — le
`PREVIOUS_VALUES` throw est rapide (pypowsybl détecte l'absence de
voltage et lève immédiatement). Mais :

1. **Logs propres** : plus de warning bogus sur le chargement.
2. **Sémantique correcte** : on déclare explicitement l'état initial.
3. **Marge** : sur d'autres grilles où le throw serait plus lent, le
   gain pourrait être plus important.

## Tests

24 tests upstream affectés (environment_detection, environment_pypowsybl,
conversion_actions_helpers_vectorized) passent. L'output numérique du
LF est le même (même convergence, mêmes flux, même status `CONVERGED`).

## Dépendance

Co-Study4Grid requiert `expert_op4grid_recommender >= 0.2.0.post7`.
Aucune modification côté Co-Study4Grid — le gain s'active au bump
upstream.
