# Tentative rejetée : Network isolé pour le worker NAD

## Contexte

Après v10 (`docs/perf-grid2op-shared-network.md`), `/api/config` plafonnait
à ~15.9 s contre ~13 s théoriques. L'analyse pointait une contention
Java-side sur les variants du Network pypowsybl partagé entre le main
thread (grid2op env setup) et le worker NAD.

## Hypothèse testée (commit `2e2d234`, révertée en `f67e0a3`)

Donner au worker NAD **sa propre instance** `pp.network.Network`,
chargée indépendamment via `pp.network.load(path)`. Deux instances
Java-side = deux locks séparés → **vrai parallélisme attendu**.

Implémentation (`prefetch_base_nad_async` → spawn worker qui fait son
propre `pp.network.load()` et appelle `get_network_diagram(network=<isolé>)`) :

- `_get_n_variant(network=None)` et `get_network_diagram(network=None)`
  gagnent un paramètre pour router l'opération sur le Network isolé.
- Helper top-level `_resolve_xiidm_path(env_path)` partagé entre le main
  thread et le worker pour résoudre le chemin `.xiidm`.
- 368 tests backend passent (avec une classe de regression
  `TestPrefetchWorkerUsesIsolatedNetwork` en garde-fou).

## Résultat mesuré (trace v11)

| Métrique | v10 (avant) | v11 (après) | Δ |
|---|---|---|---|
| `/api/config` | 15 966 ms | **17 632 ms** | **+1 666 ms** 🔴 |
| `/api/network-diagram` | 352 ms | 505 ms | +153 ms 🔴 |
| **Fin dernier XHR** | 17 384 ms | **19 071 ms** | **+1 687 ms** 🔴 |

**Régression de ~1.7 s** au lieu des −3 à −5 s attendus.

## Diagnostic

L'hypothèse de départ (« deux Networks = deux locks Java = parallélisme »)
était **incomplète**. Le lock Java-side sur le Network n'est qu'une
partie de la contention ; le reste se passe plus bas dans la pile :

### 1. JVM partagée par processus

pypowsybl utilise **une seule JVM** par processus Python (via JPype).
Les threads Python se partagent cette JVM avec ses propres synchronisations :
- **Class loader** JVM (synchronisé à la première utilisation)
- **JIT compiler** (thread-global)
- **Garbage collector** (stop-the-world)
- **Code natif partagé** du loader IIDM (XML parser Java)

Deux `pp.network.load()` concurrents se sérialisent sur ces points,
indépendamment du lock Network.

### 2. Pool de threads natifs pour l'algèbre linéaire

Les AC load flows pypowsybl s'appuient sur OpenBLAS/LAPACK via JNI. Ces
libs ont leur **propre pool de threads natifs** (souvent = nb de cœurs
CPU). Deux LF concurrents se partagent ce pool, sans accélérer leur
durée individuelle.

### 3. Surcoût net

Le worker fait maintenant du travail **supplémentaire** :
- +1 `pp.network.load(path)` complet (~3-5 s)
- +1 LF AC sur N variant de son Network isolé (~2-3 s)

Si le parallélisme Java/natif absorbait ces coûts, le wall-clock serait
inchangé voire meilleur. En pratique, la contention JVM/BLAS ne les
absorbe que partiellement → le wall-clock augmente de ~1.7 s.

## Conclusion

**L'isolation du Network au niveau Python ne permet pas de vrai
parallélisme pypowsybl.** Le lock pertinent n'est pas celui du Network
mais un ensemble de points de synchronisation plus bas dans la JVM et
dans les libs natives.

La **seule voie technique** qui débloquerait vraiment le parallélisme
serait **`multiprocessing`** (JVM séparée par process) — mais l'IPC
pour renvoyer un SVG 25 MB dépasserait largement le gain (~1 s rien
que pour la sérialisation + transfert pipe).

## Décision

- **Revert** du commit `2e2d234`.
- **v10 (commit `65ea850`) reste l'état optimisé final côté `/api/config`.**
- Ce document est conservé pour éviter que l'on re-tente la même piste.

## Alternatives rejetées ou restantes

| Approche | Verdict | Pointeur |
|---|---|---|
| `allow_variant_multi_thread_access=True` | ❌ Casse les endpoints read-only | `docs/perf-concurrent-variants.md` |
| **Network isolé par thread** | ❌ **Régresse de 1.7 s** | ce document |
| `save_to_binary_buffer` round-trip | 🟡 Même coût qu'un reload (~3-5 s) | `docs/perf-concurrent-variants.md` |
| `multiprocessing` + pipe SVG | 🟡 IPC 25 MB mange le gain | `docs/perf-concurrent-variants.md` |
| Accepter v10 comme plafond | ✅ **Choix actuel** | — |

## Pistes hors contention serveur (recommandées)

Puisque le serveur plafonne à ~15.9 s sur `/api/config`, les leviers
restants sont ailleurs :

1. **Cache disque NAD** (`hash(mtime+size)` → `.svg.gz`) — gain massif
   au 2e load d'un même réseau. ROI 1/2 journée pour ~6-7 s d'économie.
2. **Streaming progress `/api/config`** — UX : convertit les 16 s de
   silence en barre de progression visible.
3. **Brotli sur les endpoints SVG** — 100-200 ms wire.
4. **IndexedDB client cache** (complément de 1) — second load
   instantané sans même un XHR.

Voir les propositions détaillées dans les échanges de planning.

## Leçon méthodologique

Les optimisations de parallélisme sur des libs externes (pypowsybl
ici) demandent **des micro-benchmarks isolés** AVANT d'engager
l'architecture. Un test simple — `threading.Thread` qui fait 2
`pp.network.load()` concurrents et qu'on mesure — aurait montré
l'absence de speedup en quelques minutes, évitant la construction
complète + la régression.

Tests proposés pour le futur :

```python
# Micro-bench de validité du parallélisme pypowsybl
import time, threading, pypowsybl.network as pn

def parse_once():
    t0 = time.time()
    pn.load("grid.xiidm")
    return time.time() - t0

# Séquentiel : 2 × t_parse
t1 = parse_once(); t2 = parse_once()
seq = t1 + t2

# Parallèle : devrait être max(t1, t2) si parallélisme vrai
result = [None, None]
def wrap(i): result[i] = parse_once()
threads = [threading.Thread(target=wrap, args=(i,)) for i in range(2)]
t0 = time.time()
for t in threads: t.start()
for t in threads: t.join()
par = time.time() - t0

print(f"Sequential: {seq:.2f}s, Parallel: {par:.2f}s, speedup: {seq/par:.2f}x")
# Attendu pour lib vraiment parallèle : ~1.8-2x
# Mesuré pour pypowsybl (hypothèse confirmée par v11) : ~1.0-1.2x
```

À intégrer dans `tests/` si on veut ré-auditer dans le futur.

## Fichiers qui existaient sous l'approche (maintenant supprimés par le revert)

- `docs/perf-isolated-nad-worker.md` (doc originale)

Les changements code suivants ont été revertés :

- `expert_backend/services/recommender_service.py` : `_resolve_xiidm_path`
  top-level, `_get_n_variant(network=...)`, `prefetch_base_nad_async`
  revenue à la version mutualisée.
- `expert_backend/services/diagram_mixin.py` : `get_network_diagram(network=...)`
- `expert_backend/tests/test_recommender_service.py` : tests
  `TestPrefetchWorkerUsesIsolatedNetwork` supprimés, `TestPrefetchBaseNad`
  revenu à sa forme pré-isolation.
