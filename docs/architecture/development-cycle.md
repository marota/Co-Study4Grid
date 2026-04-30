# Cycle de développement de Co-Study4Grid

> Résumé du cycle de développement reconstruit à partir du `git log`
> (358 commits, du 28/03/2026 au 30/04/2026) et du `CHANGELOG.md`,
> qui retrace les versions 0.5.0 → 0.6.5 et renvoie à l'historique
> antérieur (PRs #57–#65, ère « ExpertAssist »).

Ce document est une vue d'ensemble chronologique des grandes phases
du projet. Pour les détails par sujet, voir les docs ciblées :

- Audit qualité 2026-04 : [`code-quality-analysis.md`](code-quality-analysis.md)
- Refactor `App.tsx` : [`app-refactoring-plan.md`](app-refactoring-plan.md),
  [`phase2-state-management-optimization.md`](phase2-state-management-optimization.md)
- Pipeline PyPSA-EUR → XIIDM : [`../data/pypsa-eur-osm-to-xiidm.md`](../data/pypsa-eur-osm-to-xiidm.md)
- Audit de parité standalone : [`../../frontend/PARITY_AUDIT.md`](../../frontend/PARITY_AUDIT.md)

---

## 1. Mise en place d'une base minimale de bout en bout (avant le 28/03/2026, ère « ExpertAssist », PRs #57–#65)

L'historique git visible commence sur la bannière MPL-2.0 (`426b6f7`),
mais le `CHANGELOG.md` documente la phase initiale dans la section
*Earlier Development (pre-0.5.0)* :

- **Backbone full-stack minimal** : scaffolding FastAPI + React/TypeScript/Vite,
  client `axios` câblé sur `127.0.0.1:8000`.
- **Boucle métier minimale de bout en bout** : chargement réseau (pypowsybl),
  listing des éléments déconnectables (`/api/branches`), diagramme N-1 et
  **première analyse mono-passe** (`/api/run-analysis`).
- **Mirror HTML standalone** maintenu à la main en parallèle de la SPA React,
  pour une distribution mono-fichier.
- **Premières briques transverses** : interaction-logging embryonnaire,
  persistance de configuration utilisateur (PR #59), corrections de
  diagrammes — tout ce qui a permis ensuite la consolidation 0.5.0.

## 2. Ajout de features (0.5.0, fin mars → 14/04/2026)

Première release taguée, qui rebrande *ExpertAssist → Co-Study4Grid*
(PR #65) et empile la quasi-totalité du catalogue fonctionnel :

- **Catalogue d'actions remédiales complet** : topologie, **PST tap** (PR #78),
  **curtailment renouvelable** (PR #72), **délestage de charge** (PR #61/#73)
  avec MW configurable.
- **Actions combinées** : *Computed Pairs* + *Explore Pairs*, théorème de
  superposition avec fallback simulation complète (PR #72).
- **Workflow N-1 en deux étapes** (détecter → sélectionner → résoudre)
  qui devient le chemin principal, l'endpoint mono-passe restant en legacy.
- **Onglets de visualisation détachables** pour le multi-écran (PR #84/#86/#87/#90).
- **Highlights SLD**, **colonne MW Start**, **sous-diagrammes focalisés**
  (`/api/focused-diagram`).
- **Save Results / Reload Session** + **interaction-logging rejouable**
  (PRs #62/#64) — restauration sans re-simulation.
- **Performance** : vectorisations massives (`care_mask` ~1 100×, flux ~13×,
  deltas ~47×, cache d'observations ~65×) → simulation manuelle
  ~16,5 s → ~4 s sur le réseau français entier (PR #66).
- **Confirmation dialogs**, **React ErrorBoundary**, zoom-tier LoD.

## 3. Consolidation de la base de code et de sa qualité (0.6.0 → 0.6.5, 14/04 → 22/04/2026)

Les features ralentissent au profit de l'architecture, de la dette
technique et de la non-régression :

- **Refactor `App.tsx`** : Phase 1 (PR #74) 2 100 → 650 lignes,
  transformation en *state-orchestration hub*. Phase 2 (PR #75)
  memoization + `React.memo`. Phase 2 hooks (PR #109) : extraction
  de `useN1Fetch`, `useDiagramHighlights`, `AppSidebar`,
  `SidebarSummary`, `StatusToasts` — `App.tsx` retombe à ~1 150 lignes.
- **Décomposition backend (PR #104/#106)** : `simulate_manual_action`
  599 → 146 LoC, `compute_superposition` 285 → 108, `analysis_mixin`
  1 116 → 509 + 4 modules, `diagram_mixin` 974 → 469 + 7 modules,
  via injection de dépendances pour préserver les `@patch` existants.
- **Décomposition frontend** : `svgUtils.ts` 1 807 → 60 lignes
  + 8 modules focalisés.
- **Standalone auto-généré** (PR #101) : `vite-plugin-singlefile`
  produit `dist-standalone/standalone.html` ; le
  `standalone_interface.html` manuel est gelé puis renommé `_legacy`.
  Source unique = `frontend/src/`.
- **Garde-fou parité 4 couches** (statique, fidélité de session,
  séquence de gestes, **Layer 4 user-observable invariants**)
  + Playwright E2E.
- **Continuous code-quality** (PR #104) : `code_quality_report.py`
  + `check_code_quality.py` + workflow GitHub Actions/CircleCI
  publiant le rapport au job summary, plafonds LoC, zéro `print()`
  / `any` / `@ts-ignore`.
- **Perf SVG DOM recycling** (PR #108) : `/api/n1-diagram-patch`
  & `/api/action-variant-diagram-patch`, ~80 % plus rapide sur les
  bascules d'onglets, payload 27 → 5,5 MB.
- **Réorganisation `docs/`** en `features/ performance/{,history/}
  architecture/ proposals/ data/` avec index par dossier ;
  trois propositions LoD overlapping fusionnées.
- **Ruff E9/F**, `CONTRIBUTING.md`, `.editorconfig`, `.env.example`,
  `CORS_ALLOWED_ORIGINS` configurable, ~234 nouveaux tests unitaires
  sur les helpers extraits.

## 4. Création d'un jeu de données open-source européen — PyPSA-EUR (16/04 → 24/04/2026, PR #112)

Branche `feat/pypsa-eur-network-scripts`, mergée le 24/04. Construit
un pipeline reproductible PyPSA-EUR → XIIDM, livré avec deux jeux
de données engagés dans `data/` :

- **`41005e0`** (16/04) : pipeline initial *PyPSA-EUR France 400 kV
  build & conversion*.
- **`c2a16ca`** : première version chargeable de la grille PyPSA.
- **`bd43044`** : noms OSM réels intégrés au pipeline et affichés dans l'UI.
- **`b194fb3`** : correction du système de coordonnées de `grid_layout.json`.
- **`20b56b5`** : montée en échelle à **75 GW** avec **limites thermiques
  calibrées sur les flux**.
- **`4680689`** : modularisation du pipeline de conversion + paramétrisation
  du fetch OSM.
- **`0baa3e2`** : consolidation du pipeline, ajout de la couverture pytest
  dédiée (`test_build_pipeline.py`, `test_calibrate_thermal_limits.py`,
  `test_generate_n1_overloads.py`, `test_regenerate_grid_layout.py`)
  et commit du jeu **`fr225_400`**.
- Scripts livrés sous `scripts/pypsa_eur/` : `build_pipeline.py`,
  `convert_pypsa_to_xiidm.py`, `calibrate_thermal_limits.py`,
  `add_detailed_topology.py`, `generate_n1_overloads.py`,
  `fetch_osm_names.py`, `regenerate_grid_layout.py` + tests
  d'intégration et de calibration N-1.
- Datasets disponibles : **`data/pypsa_eur_fr400`** (réseau 400 kV)
  et **`data/pypsa_eur_fr225_400`** (mixte 225/400 kV) — premier
  réseau open-source utilisable nativement par l'application en plus
  du `bare_env_small_grid_test` historique.

En post-merge, sur cette nouvelle base de données, viennent les
itérations *Overflow HTML viewer* (PR #116, toggle Hierarchical/Geo,
mise à l'échelle des canvas géographiques), un fix d'islanding
(`d9b1652`, 29/04) et le rafraîchissement des `CLAUDE.md` /
`README.md` en 0.6.5.
