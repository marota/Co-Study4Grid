# Portage libTOPO (`expert_op4grid_recommender.manoeuvre`) — limites relevées

**Date : 2026-07-26.** Banc systématique sur les **1383 VL THT** du snapshot RTE7000
nommé (`grid_5384e039`) : construction du graphe, détection des cellules, puis un
test de scission en 2 nœuds (`determiner_topo_complete_cible`, premier départ
isolé des autres). Objectif : relever les limitations du portage nodale→détaillée
pour son amélioration. Script : session Rosetta (libtopo_survey.py).

## Classification

| Verdict | VL | Lecture |
|---|---|---|
| OK | 274 | scission réalisée et vérifiée |
| OK malgré troncature >2 SJB | 162 | l'avertissement n'empêche pas toujours |
| **Échec, avec troncature** | **107** | limitation n°1 |
| **Échec, sans troncature** | **110** | limitation n°2 |
| Mono-barre : scission infaisable | 728 | attendu (pas un défaut) — codes numérotés à 1 SJB |
| < 2 départs | 2 | hors banc |

Sur les **653 postes ≥ 2 barres**, le portage vérifie **436 (67 %)**.

## Limitation n°1 — troncature des composantes de couplage > 2 SJB

`cellules.py` émet « Composante de couplage avec N SJB (poste ≥ 3 barres ?) :
seulement les 2 premières SJB seront enregistrées dans la cellule » sur **362 VL**
(26 %) — composantes à 3, 4, jusqu'à 6 SJB (couplages en anneau, barres de
transfert, disjoncteurs de couplage communs). Quand les SJB perdues sont
nécessaires à la manœuvre, la séquence laisse un départ orphelin : symptôme
uniforme **« obtenu N+1 nœuds, visé N »** (CPNIE 4 SJB, CERGY 6, MEZE5, P.GAS,
REALT, GEN.P…). 107 échecs directement imputables. **Amélioration : enregistrer
la composante de couplage complète (liste de SJB, pas une paire) et étendre le
séquenceur aux ré-aiguillages via ces couplages multi-barres.**

## Limitation n°2 — départs non ré-aiguillables → nœuds orphelins

110 postes à 2 barres SANS troncature échouent avec le même symptôme (DAMBR,
EGUZO, LESQU, SAUS5, H.PAU, CRENE, SSELO, ANSER, ANTIB… ; DOMLO : « obtenu 6,
visé 2 »). Hypothèse à instrumenter dans le portage : cellules **mono-aiguillage**
(un seul SA vers une seule barre, piquages, `shared_equipment`) que le séquenceur
ne peut pas déplacer ; le rejeu s'arrête avec le départ resté sur son tronçon.
**Amélioration : diagnostiquer chaque départ non déplaçable dans
`ResultatManoeuvres.ecarts` (aujourd'hui le message global ne dit pas QUEL départ
est orphelin), et traiter les cellules mono-SA (déplacement du tronçon entier ou
refus explicite par départ).**

## Contournements adoptés côté rebuild Matpower (rte_topology.py)

- cible : les départs réels non appariés FUSIONNENT dans le plus gros nœud cible
  (ne pas exiger un nœud de plus que nécessaire) ;
- si `is_verified` reste faux : **direct-assign** (chaque nœud MATPOWER sur sa
  barre réelle, frontières ouvertes) — structure réelle conservée, état détaillé
  non issu du séquenceur ;
- les VL «étoiles» de modélisation MATPOWER (bus milieux de 3WT éclatés,
  tronçons composites — VL-59xx/62xx) ne sont PAS des postes physiques : layout
  générique par nœud, correct par nature.
