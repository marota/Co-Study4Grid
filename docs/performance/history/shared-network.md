# Mutualisation du pypowsybl Network entre `network_service` et `recommender_service`

## Observation (v8 trace)

Le NAD prefetch introduit en v8 (`docs/performance/history/nad-prefetch.md`) a délivré
`/api/network-diagram` en **516 ms** au lieu de 6 385 ms, mais
`/api/config` est passé de 14 790 ms à **19 171 ms (+4.4 s)**. Le gain
net a été de seulement ~1.5 s sur la critical path.

En auditant le code, on s'aperçoit qu'on charge le **même `.xiidm`
jusqu'à trois fois** pendant `/api/config` :

1. `network_service.load_network()` — `pn.load(file_path)`, ~3-5 s
2. `recommender_service._get_base_network()` — `pp.network.load(str(network_file))`, ~3-5 s **doublon complet**
3. `setup_environment_configs_pypowsybl()` dans grid2op — backend pypowsybl charge encore une fois, ~3-5 s

Les appels #1 et #2 chargent **exactement le même fichier** et produisent
**la même Network pypowsybl**. La pré-chauffe `_base_network` que fait
`prefetch_base_nad_async()` en main thread est responsable d'une grosse
partie du +4.4 s sur `/api/config`.

## Change

`_get_base_network()` préfère maintenant **réutiliser la Network déjà
chargée par `network_service`** plutôt que de la re-parser :

```python
def _get_base_network(self):
    if self._base_network is not None:
        return self._base_network

    # Préfère l'instance déjà chargée par network_service.
    from expert_backend.services.network_service import network_service
    if network_service.network is not None:
        n = network_service.network
        n.get_line_ids = lambda: n.get_lines().index.tolist()
        self._base_network = n
        self._capture_initial_pst_taps(n)
        return self._base_network

    # Fallback : pp.network.load(config.ENV_PATH) pour les tests /
    # appels qui bypass /api/config.
    …
```

## Sûreté de partage

Les deux services tiennent une référence vers le **même objet
pypowsybl Network**. Les accès restent sûrs :

- **`network_service`** ne fait que des lectures (`get_lines`,
  `get_voltage_levels`, …), jamais de variant switch.
- **`recommender_service`** switche les variants dans `_get_n_variant`
  / `_get_n1_variant` mais restaure toujours le variant d'origine dans
  un `try/finally`, donc toute lecture depuis `network_service` voit
  un état cohérent.
- Le monkey-patch `get_line_ids` est idempotent et purement additif.
- `_capture_initial_pst_taps` est spécifique au recommender (state
  isolé) et doit toujours s'exécuter pour capturer les tap positions
  N-state.

## Invariants (testés)

`test_recommender_service.py::TestGetBaseNetworkMutualisation` :

- `test_reuses_network_service_network_when_available` — quand
  `network_service.network` est peuplé, `_get_base_network()` ne
  déclenche AUCUN nouveau `pp.network.load()` et retourne exactement
  la même instance.
- `test_falls_back_to_standalone_load_when_network_service_empty` —
  quand `network_service.network is None` (tests, appelants qui
  bypass `/api/config`), on retombe sur le chargement standalone.

Le test existant `test_direct_file_loading.py::test_get_base_network_with_file_path`
est mis à jour pour forcer explicitement le chemin fallback en
mettant `network_service.network = None`.

## Impact attendu

Baseline v8 (avec NAD prefetch seul) :

| Segment | v8 mesuré |
|---|---|
| `/api/config` | 19 171 ms |
| `/api/network-diagram` | 516 ms |
| Total critical path | ~20.5 s |

Attendu v9 (avec mutualisation) :

| Segment | v9 attendu |
|---|---|
| `/api/config` | ~14-16 s (−3-5 s : plus de pp.network.load doublon) |
| `/api/network-diagram` | ~500 ms (inchangé, cache toujours chaud) |
| Total critical path | **~15 s (−5 s vs v8, −6 s vs v7)** |

On récupère ainsi **une grosse partie du gain théorique du prefetch
NAD** qui avait été absorbé par le chargement dupliqué.

## Ce qui n'est PAS changé

- **Le chargement pypowsybl par grid2op** (#3 ci-dessus) reste en
  place — il est enfoui dans `expert_op4grid_recommender` et ne peut
  pas être court-circuité sans modifier la lib externe.
- **Le comportement des endpoints** est identique : seul le plomberie
  interne change.
- **Les appelants qui construisent `RecommenderService` directement**
  (tests, scripts d'intégration) continuent de fonctionner grâce au
  fallback.

## Fichiers modifiés

| Fichier | Changement |
|---|---|
| `expert_backend/services/recommender_service.py` | `_get_base_network` préfère `network_service.network` quand disponible ; fallback `pp.network.load` préservé. |
| `expert_backend/tests/test_recommender_service.py` | Nouvelle classe `TestGetBaseNetworkMutualisation` (2 tests). |
| `expert_backend/tests/test_direct_file_loading.py` | `test_get_base_network_with_file_path` force explicitement le chemin fallback. |
