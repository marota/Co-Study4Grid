# Fast path pour `detect_non_reconnectable_lines` (upstream) — défensif, sans gain mesurable

## Contexte

Le profilage de `setup_environment_configs_pypowsybl` sur la grille
PyPSA-EUR France 400 kV (113 MB .xiidm) a révélé deux choses :

1. `env.network_manager.detect_non_reconnectable_lines()` apparaissait
   comme un gros contributeur (**~2.8 s dans un premier micro-bench**).
2. En inspectant le code de
   `expert_op4grid_recommender.utils.helpers_pypowsybl.detect_non_reconnectable_lines`,
   on a découvert que le "fast path global" annoncé dans la docstring
   **ne se déclenchait jamais** parce que le check de colonnes était faux :

   - Il cherchait `connectable_id` + `node_id` dans `get_terminals()` →
     ces colonnes **ne sont pas populées** par pypowsybl (même avec
     `all_attributes=True`).
   - Il cherchait `node1_id` + `node2_id` dans `get_switches()` → pypowsybl
     expose `node1` / `node2` (**sans suffixe `_id`**) quand
     `all_attributes=True` est demandé.

## Correction upstream (`expert_op4grid_recommender == 0.2.0.post2`)

Commit amont : `0fb4e62f`

### Changement

Au lieu d'utiliser `get_terminals()` (qui n'expose pas les colonnes
nécessaires), utiliser :

- `get_lines(all_attributes=True)` → expose `node1` / `node2` par
  endpoint de ligne
- `get_2_windings_transformers(all_attributes=True)` → idem pour trafos
- `get_switches(all_attributes=True)` → expose `node1` / `node2` des
  switches

Le `connectable_map` est bâti directement depuis ces colonnes en un
seul batch. Le fallback per-VL (`get_node_breaker_topology`) est
préservé pour les grilles purement bus-breaker ou les versions
pypowsybl qui n'exposeraient pas `node1`/`node2`.

### Tests upstream ajoutés

`tests/test_detect_non_reconnectable_fast_path.py` (6 tests) :

- Détection correcte d'une ligne isolée des deux côtés (fast path).
- Non-détection quand un disconnector reste fermé (reconnectable).
- Ignore les lignes connectées des deux côtés.
- Fallback déclenché quand les colonnes `node*` manquent sur les
  switches (bus-breaker).
- Short-circuit quand aucun élément n'est déconnecté.
- Fallback déclenché quand le fast path produit un `connectable_map`
  vide (NaN partout).

Le test d'intégration existant (`test_environment_detection::test_non_reconnectable_detection_with_date`)
passe sur la petite grille node-breaker réelle — valide la correction
numérique avec physique réelle.

## ⚠️ Gain réel : nul sur les conditions mesurées

Le micro-bench initial (single-process, OLD appelé AVANT NEW dans le
même process) montrait :

- OLD : 3 239 ms
- NEW : 683 ms
- → **4.7× speedup annoncé**

Le benchmark propre (3 processes × 5 répétitions chacun, chaque
process démarrant avec une JVM fresh) raconte une autre histoire :

| | Process 1 (median) | Process 2 (median) | Process 3 (median) |
|---|---|---|---|
| **OLD** (per-VL fallback) | 825 ms | 845 ms | 762 ms |
| **NEW** (fast path) | 812 ms | 764 ms | 765 ms |

**Les deux versions sont équivalentes à ~30 ms près, soit dans le bruit.**

### Explication

Le 3 239 ms du premier bench était un **artefact JIT cold-start** :
la toute première invocation de `get_node_breaker_topology()` dans
un processus Python force la JVM pypowsybl à JIT-compiler le chemin
de topologie node-breaker — coût unique de 2-3 s payé UNE FOIS. Les
appels suivants tombent à ~0.25 ms chacun.

Une fois le backend Co-Study4Grid démarré et warm, les deux chemins
de code sont équivalents : la JVM a JIT-compilé ce qu'il fallait.
L'inspection de la trace v13 a confirmé ça — aucun gain visible sur
`/api/config` par rapport à v10.

## Pourquoi on garde quand même le patch

Le patch reste en place parce qu'il **corrige un dead code path** :
le "fast path" annoncé dans la docstring d'origine ne se déclenchait
jamais sur une pypowsybl moderne (1.13+). Le fix :

1. Rétablit un comportement conforme à la docstring du code d'origine.
2. Ne régresse pas (performance équivalente au fallback).
3. Pourrait apporter un gain réel sur **d'autres grilles** ou futures
   versions pypowsybl où le coût de `get_node_breaker_topology` par VL
   scale-rait moins bien (grilles avec node-breaker très profond,
   beaucoup de substations impactées, etc.).
4. Les 6 tests unitaires + 1 intégration préservent la sémantique.

## Leçon méthodologique

**Toujours benchmarker dans un processus Python frais avec JVM
froide, en moyenne sur plusieurs répétitions et plusieurs processes**.
Un micro-bench dans un process déjà chauffé par des mesures
précédentes peut mentir de 4× sur un algorithme JVM-based.

Snippet de benchmark clean à garder pour l'avenir :

```python
import subprocess, sys
script = '''
import time, pypowsybl as pp
from X import func_to_benchmark
net = pp.network.load("grid.xiidm")
ts = []
for _ in range(5):
    t0 = time.perf_counter()
    func_to_benchmark(net)
    ts.append((time.perf_counter()-t0)*1000)
print(f"min={min(ts):.0f} median={sorted(ts)[2]:.0f}")
'''
for i in range(3):
    subprocess.run([sys.executable, "-c", script])
```

## Dépendance

Co-Study4Grid fonctionne indifféremment avec ou sans ce patch.
`expert_op4grid_recommender >= 0.2.0.post2` (avec le patch) est
équivalent à 0.2.0 + 0.2.0.post1 côté performance réelle.
