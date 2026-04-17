# Worker NAD isolé : une `pp.network.Network` par thread pour vrai parallélisme

## Contexte

Après tous les commits v7→v10, la trace v10 montrait que `/api/config`
restait à 15 966 ms au lieu des ~13-14 s théoriques après la
mutualisation Network ↔ grid2op. Cause (confirmée dans
`docs/perf-concurrent-variants.md`) : **verrou Java-side sur le
Network pypowsybl partagé**. Le worker NAD et le main thread (env
setup grid2op) font chacun du variant switching sur le **même**
Network → leurs opérations sont **sérialisées** par ce verrou interne.

Deux voies explorées puis écartées :

- `allow_variant_multi_thread_access=True` : casse tous les endpoints
  read-only (chaque thread doit faire `set_working_variant` d'abord).
- `save_to_binary_buffer` round-trip : sérialisation ~3-5 s ≈ reload
  direct, aucun gain net.

## Solution retenue : Network isolé pour le worker

Le worker NAD charge sa **propre** instance pypowsybl Network,
indépendante de `network_service.network`. Deux instances Java-side =
deux locks séparés = vrai parallélisme.

### Code (simplifié)

```python
# recommender_service.py :: prefetch_base_nad_async()
def prefetch_base_nad_async(self):
    self._drain_pending_base_nad_prefetch()
    try:
        network_file = _resolve_xiidm_path(config.ENV_PATH)
    except Exception as e:
        # Record error without spawning a worker that would fail too.
        ...

    def _worker():
        import pypowsybl as pp
        # Worker-owned Network — own Java handle, own lock.
        worker_net = pp.network.load(str(network_file))
        diagram = self.get_network_diagram(network=worker_net)
        self._prefetched_base_nad = diagram

    threading.Thread(target=_worker, daemon=True, name="NADPrefetch").start()
```

```python
# diagram_mixin.py :: get_network_diagram()
def get_network_diagram(self, voltage_level_ids=None, depth=0, network=None):
    is_isolated = network is not None
    n = network if is_isolated else self._get_base_network()
    ...
    n_variant_id = self._get_n_variant(network=n if is_isolated else None)
    ...
    # Skip `_n_state_currents` cache write when on isolated network
    # — the shared cache must stay tied to the shared Network instance.
    if not is_isolated:
        self._n_state_currents = self._get_element_max_currents(n)
```

```python
# recommender_service.py :: _get_n_variant()
def _get_n_variant(self, network=None):
    n = network if network is not None else self._get_base_network()
    ...
```

### Timeline attendue

Sans isolation (v10) :
```
t=0     main: pn.load                       (3-5 s)
t=3-5   main: update_config                 ┐
        main: env setup grid2op (6-10 s)    ├── SÉRIALISÉS
        worker: NAD gen (5-6 s)             │   sur lock Java
                                            ┘   partagé
t=15.9  main: /api/config renvoie
```

Avec isolation (attendu v11) :
```
t=0     main: pn.load (network_service)     (3-5 s)
t=3-5   main: env setup sur Network #1      (6-10 s, SEUL)
        worker: pn.load Network #2 (3-5 s) + NAD (5-6 s) = 8-11 s
                ↑ parallèle vrai sur Network #2
t=9-13  main: /api/config renvoie
t=?     worker termine en parallèle
t=9-13  /api/network-diagram → cache hit NAD (ou fin immédiate)
```

**Gain attendu : `/api/config` 15.9 s → ~10-13 s (−3 à −5 s)**.

## Invariants (testés)

### `TestPrefetchWorkerUsesIsolatedNetwork` (2 tests)

- `test_worker_calls_pp_network_load_and_forwards_to_get_network_diagram` —
  garantit que le worker appelle `pp.network.load(path)` et transmet
  l'instance obtenue à `get_network_diagram(network=<isolé>)`.
- `test_worker_does_not_touch_base_network` — **poison check** :
  `self._base_network` est piégé avec `side_effect=AssertionError`, le
  test passe uniquement si le worker ne le touche jamais.

### Tests existants adaptés

- `TestPrefetchBaseNad` : le helper `_prefetch_mocks` fournit maintenant
  le triptyque de patches (`_resolve_xiidm_path`, `config.ENV_PATH`,
  `pypowsybl.network.load`) utilisé par tous les tests du prefetch.
- `test_prefetch_records_path_resolution_error_without_spawning_worker`
  (renommé depuis l'ancien `_records_network_load_error_...`) vérifie
  maintenant la gestion d'erreur du chemin fichier, pas de `_get_base_network`.

## Coûts et tradeoffs

| | Gain | Coût |
|---|---|---|
| Parallélisme Java-side | ✅ Vrai (locks séparés) | — |
| CPU `/api/config` | +0 s (parse worker absorbé par env setup) | +3-5 s de parse dans le worker (parallèle) |
| Mémoire | — | 2 instances pypowsybl Network durant le prefetch (~50 MB total au lieu de 25) |
| Compat API | Aucune modif externe | — |
| Complexité code | — | Signature `network=` ajoutée à 2 méthodes |

Quand le worker termine, **sa Network locale est candidate au GC**
(aucune référence persistante côté service). Le surcoût mémoire n'est
donc transitoire que pendant la durée du prefetch (~10 s).

## Ce qui n'est PAS changé

- **`self._base_network`** (shared with `network_service` and grid2op) :
  inchangé. Le worker n'y touche jamais.
- **Les endpoints** (`/api/network-diagram`, `/api/n1-diagram`, etc.) :
  inchangés côté API. Ils consomment le cache NAD via
  `get_prefetched_base_nad()`.
- **Les gardes variant-state** (`_ensure_n_state_ready`,
  `_ensure_n1_state_ready`) : inchangées. Elles opèrent toujours sur
  `self._base_network`.
- **Les autres endpoints** (`simulate_manual_action`,
  `run_analysis_step1/2`, …) : inchangés. Ils utilisent le Network
  partagé, variant contention non concernée (monothread d'une session).

## Vérification

```bash
pytest expert_backend/tests/test_recommender_service.py -v
# 33 tests, 2 nouveaux sur l'isolation.

pytest                             # full suite — 368 passed
cd frontend && npm run test -- --run  # 915 passed
npx tsc -b && npm run lint
```

Trace v11 attendue pour confirmer le gain wall-clock (~3-5 s sur
`/api/config`, `/api/network-diagram` reste à ~380 ms en cache hit).

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `expert_backend/services/recommender_service.py` | Nouveau helper top-level `_resolve_xiidm_path(env_path)`. `_get_n_variant` gagne un `network=None`. `prefetch_base_nad_async` capture le path avant spawn + le worker charge sa propre Network. `_get_base_network` fallback simplifié via le helper (DRY). |
| `expert_backend/services/diagram_mixin.py` | `get_network_diagram` gagne `network=None`. Skip de l'écriture dans `_n_state_currents` quand sur Network isolé. |
| `expert_backend/tests/test_recommender_service.py` | Tests du prefetch adaptés au nouveau mocking (3 patches au lieu de 2). Nouvelle classe `TestPrefetchWorkerUsesIsolatedNetwork` (2 tests d'invariant). |
