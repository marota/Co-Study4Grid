# Contention pypowsybl `/api/config` — trouvaille et décision

## Contexte

La v10 a mesuré `/api/config` à 15 966 ms, contre ~13-14 s attendus
après l'élimination du 3e chargement (`docs/performance/history/grid2op-shared-network.md`).
Les ~2-3 s « manquantes » viennent d'une **contention** entre :

- **Main thread** : `setup_environment_configs_pypowsybl(network=...)` —
  setup grid2op sur le Network partagé (appels variant + lecture topologie).
- **Worker thread** : `RecommenderService.get_network_diagram()` via
  `prefetch_base_nad_async()` — génération du NAD sur le MÊME Network.

Les deux threads font des `n.set_working_variant(...)` et des
load-flows pypowsybl en concurrence.

## Diagnostic

Ce **n'est pas** le GIL Python : les appels pypowsybl (AC/DC LF, NAD
generation) sont en Java via JPype et **releasent le GIL** pendant leurs
opérations lourdes. Le profil trace confirme que le temps passe côté
Java, pas côté CPython.

La contention vient d'un **verrou interne du Network Java-side** dans
pypowsybl : par défaut, `pp.network.Network` est construit en mode
« single-threaded variant access ». Les opérations variant (`set_working_variant`,
`clone_variant`, `run_ac`) sont **sérialisées** sur un lock Java.

## Solution envisagée puis abandonnée

`pypowsybl.network.load()` expose un paramètre :

```python
pn.load(file, ..., allow_variant_multi_thread_access: bool = False)
```

Quand `True`, le Network autorise l'accès concurrent aux variants
depuis plusieurs threads. C'est, sur le papier, exactement le flag
qu'on veut.

**En pratique**, activer ce flag **casse les endpoints read-only** :

```
$ POST /api/config → 400 Bad Request
{"detail":"Variant index not set for current thread System-6"}
```

Le mode multi-thread impose un contrat strict : **chaque thread qui
touche le Network doit d'abord appeler `n.set_working_variant(<id>)`**
pour établir son variant de travail. Sans ça, pypowsybl refuse toute
opération avec l'erreur ci-dessus.

Or FastAPI sert chaque requête sur un thread arbitraire de son pool
(uvicorn/asyncio). Les endpoints read-only n'ont **aucune raison
actuelle d'appeler `set_working_variant`** :

- `/api/branches` → `network_service.get_disconnectable_elements()` → `self.network.get_lines()`
- `/api/voltage-levels` → `network_service.get_voltage_levels()` → `self.network.get_voltage_levels()`
- `/api/nominal-voltages` → idem
- `/api/element-voltage-levels` → idem

Activer le flag exigerait un garde `set_working_variant` au début de
**chaque endpoint** (read ou write) et dans `network_service` pour
chaque méthode lecture. C'est une surface de modification bien plus
grande que l'optimisation ne le justifie, avec un risque de régression
élevé (oublis faciles).

## Décision

**Garder le flag à `False` (défaut)**. La contention (~2-3 s) est
acceptée comme coût résiduel.

Le test `test_load_network_keeps_multi_thread_variant_flag_off` dans
`expert_backend/tests/test_network_service.py` sert de garde-fou :
tout commit qui réactiverait ce flag sans accompagner le chantier
required (per-thread variant positioning sur TOUS les endpoints) fera
échouer le test avec un pointeur vers ce document.

## Alternatives possibles (non poursuivies dans ce commit)

1. **Clone du Network pour le worker NAD** : le worker duplique le
   Network via `save_to_binary_buffer` + `load_from_binary_buffers`
   avant de générer le NAD. Les deux instances ont des locks Java
   séparés → parallélisme vrai. Coût : la sérialisation BIIDM prend
   probablement 2-5 s sur 25 MB, ce qui **mange le gain**. À benchmarker
   avant de s'engager.

2. **Subprocess `multiprocessing`** pour le worker NAD : zéro
   contention (JVM séparée) mais re-parse du `.xiidm` dans le subprocess
   (~3-5 s) qui dépasse probablement le gain. Plus IPC pour re-envoyer
   le SVG 25 MB.

3. **Setter le variant dans `network_service`** pour chaque endpoint
   read-only, PUIS activer le flag. Chantier estimé : ~5 endpoints
   backend + vérification grid2op + tests. Risque de race sur le
   variant (main thread a une identité instable entre requêtes
   FastAPI sur le même endpoint).

4. **Accepter l'état actuel** — ce qui est fait ici.

## Récapitulatif des gains obtenus (v6 → v10)

| Change | Gain cumulé |
|---|---|
| Parallel XHRs + text-format (v7) | −2.8 s |
| NAD prefetch (v8) | −0.6 s supp. |
| Mutualisation Network (v9) | −2.6 s supp. |
| Partage avec grid2op (v10) | −0.6 s supp. |
| **Total v6 → v10** | **~24 s → 17.4 s (−28 %)** |

La contention résiduelle documentée ici plafonne le gain achievable
par les approches "sans refactor majeur" à cet ordre de grandeur.
Des optimisations complémentaires (cache disque NAD, streaming
`/api/config`) restent possibles mais touchent d'autres dimensions
que la contention pypowsybl.
