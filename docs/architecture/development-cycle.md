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

## 1. Mise en place d'une base minimale de bout en bout — ère « ExpertAssist » (14/02/2026 → 28/03/2026, PRs #1 → #65)

Le clone local n'expose plus que les commits postérieurs à la bannière
MPL-2.0 (`426b6f7`, 28/03/2026), juste après le rebrand. Mais sur
GitHub, l'historique pré-0.5.0 est riche : **65 PRs en ~6 semaines**,
sous le nom *ExpertAssist*. Ce paragraphe les consolide à partir des
descriptions de PR (et non plus du seul `CHANGELOG`, qui les agrège
sous *Earlier Development (pre-0.5.0)* sans les énumérer). Le projet
arrive en 0.5.0 (14/04/2026) avec la quasi-totalité de l'architecture
encore en place aujourd'hui ; ce qui suit est donc plus qu'un
préalable — c'est l'essentiel du socle.

### 1.1. Bootstrap (avant le 14/02/2026, antérieur à la PR #1)

PR #1 est déjà titré **« Improve NAD rendering for large grids and
refactor diagram generation »** : le scaffolding existe donc déjà,
poussé directement sur `main` sans PR. À ce stade le projet possède :

- Un backend **FastAPI** + un frontend **React + TypeScript + Vite**
  monorepo, plus le **mirror HTML standalone** maintenu en parallèle.
- Un chargement réseau via **pypowsybl**, la génération NAD pour les
  états N et N-1, et un premier passage d'analyse câblé sur le
  recommender.
- Un client **axios** pointé sur le backend local.

### 1.2. Bouclage métier de bout en bout (14 → 22/02/2026, PRs #1 → #15)

Première semaine de PRs : on rend le triangle *réseau → contingence →
action* utilisable de bout en bout.

- **PR #1 (14/02)** — *NAD rendering for large grids* : `boostSvgForLargeGrid()`
  (scale fonts/labels/legends en `sqrt(taille/référence)` au-delà de
  1,5× la référence), extraction des helpers backend (`_load_network`,
  `_load_layout`, `_default_nad_parameters`, `_generate_diagram`),
  endpoints `GET /api/element-voltage-levels` + `POST /api/focused-diagram`
  pour les sous-diagrammes centrés sur un équipement.
- **PR #2 (14/02)** — première version du `CLAUDE.md` (160 lignes,
  référence projet pour humains et assistants).
- **PR #4 (15/02)** — README projet.
- **PR #5 (15/02)** — pan/zoom + métadata lookups optimisés.
- **PR #6 (16/02)** — *ActionFeed* avec données `rho` structurées.
- **PR #7 (16/02)** — `/api/action-variant-diagram` + sélection
  interactive d'actions sur la N-1.
- **PR #8 (16/02)** — pré-calcul de l'état réseau pour accélérer
  les variantes d'action.
- **PR #9 (17/02)** — *highlights* des lignes en surcharge et des
  cibles d'action sur la SVG.
- **PR #11 (18/02)** — **actions manuelles** simulables côté UI.
- **PR #12 (19/02)** — mode **delta flows** (Δ versus N-state).
- **PR #13 (19/02)** — filtres par voltage level.
- **PR #14 (20/02)** — intégration des **scores estimés** pour les
  actions manuelles (la colonne *score* devient utilisable avant
  simulation complète).
- **PR #15 (21/02)** — refonte majeure de la visualisation : le hook
  `usePanZoom` (manipulation directe du viewBox SVG en bypass de
  React), le module `svgUtils.ts` (`processSvg`, `buildMetadataIndex`
  O(1), `applyOverloadedHighlights`, `applyActionTargetHighlights`,
  `applyDeltaVisuals`, `boostSvgForLargeGrid`), le **multi-tab indépendant**
  N / N-1 / action / overflow et le streaming SSE des résultats.
  `VisualizationPanel` passe de 397 à 259 lignes.

### 1.3. Maturation UX/UI (22/02 → 01/03/2026, PRs #16 → #24)

- **PRs #16–#18 (22/02)** — assets cliquables sur les action cards,
  tooltips en `position: fixed` (debord clean), overlay SLD draggable.
- **PR #19 (27/02)** — **Recommender Settings panel** complet :
  sliders pour `min_line_reconnections`, `min_close_coupling`,
  `min_open_coupling`, `min_line_disconnections`, `n_prioritized_actions` ;
  flow *Apply / Close* avec backup pour annuler ; auto-apply +
  banner dynamique pour le `lines_monitoring_path` ;
  panneau settings tabbé *Recommender / Configurations*. La PR fixe
  aussi le **bug du score 0,00 sur les disconnections** quand
  `lines_monitoring_file` est actif (correction de
  `expert_op4grid_recommender/action_evaluation/discovery.py`) et
  re-mémoise `actions.json` côté backend pour rendre les hot-swaps
  de settings instantanés.
- **PR #20 (28/02)** — **OverloadPanel** compact en haut de la sidebar
  (lignes en surcharge N + N-1, clic = zoom), **`monitoringFactor`**
  (`MONITORING_FACTOR_THERMAL_LIMITS`, default 0,95) propagé partout :
  détection backend `_get_overloaded_lines`, mise à l'échelle des
  `rho_before/rho_after/max_rho`, seuils de coloration des
  action cards.
- **PR #21 (28/02)** — exclusion des surcharges pré-existantes en N-1
  sauf si **aggravées** par la contingence.
- **PRs #22–#24 (01/03)** — filtres par type d'action ; persistence
  des actions manuelles ; restructuration du layout ; *state-switching*
  des SLD (le diagramme suit l'onglet actif).

### 1.4. Robustesse + CI + perfs (01 → 10/03/2026, PRs #25 → #46)

C'est la phase où la base devient testable et fiable :

- **PR #25 (01/03)** — **suite de tests** complète : backend
  (`test_api_endpoints.py`, `test_network_service.py`,
  `test_compute_deltas.py`, `test_sanitize.py`) avec un
  `conftest.py` qui mocke `pypowsybl` / `expert_op4grid_recommender`
  pour CI, frontend (`api.test.ts`, `svgUtils.test.ts`,
  `VisualizationPanel.test.tsx`, `OverloadPanel.test.tsx`) sous
  Vitest + RTL.
- **PR #28 (02/03)** — **CircleCI + GitHub Actions** en parallèle
  (Python + React/Vitest/ESLint), `pyproject.toml` introduit. À ce
  point : 80 tests backend + 66 frontend.
- **PR #26** — pan/zoom batché en interaction state.
- **PR #27** — clustering des voltage levels détectés + bucket
  sous 25 kV.
- **PR #29** — exclusion des branches non monitorées.
- **PR #30** — bouton **« Make a first guess »** + warnings clarifiés.
- **PRs #31–#32** — calcul des deltas terminal-aware avec sélection
  par VL, intégration de la puissance réactive.
- **PRs #33–#35** — fix SLD voltage diagram, modes
  `IGNORE_RECONNECTIONS` / `PYPOWSYBL_FAST_MODE`, refactor du
  `RecommenderService` pour la consistence des simulations.
- **PRs #36–#38** — recherche SLD synchronisée entre tabs,
  **lazy-loading des actions** côté recommender.
- **PRs #39–#41** — fix sérialisation NaN (`Infinity` → `null`),
  UI de non-convergence (tags *divergent*, warnings orange,
  tests unitaires), réintroduction des actions manuelles différées.
- **PR #46 (10/03)** — latence de tab-switch + optimisation SVG.

### 1.5. Persistance + actions complexes (10 → 22/03/2026, PRs #47 → #56)

- **PR #47** — **confirmation dialogs** pour le changement de
  contingence et le reload d'étude.
- **PR #48** — enrichissement de la topologie d'action avec `pst_tap`.
- **PR #49 (11/03)** — **save session** : `session.json` + copie du
  PDF *overflow graph* + theme jaune cohérent + auto-fade des
  notifications + `test_save_session.py`.
- **PR #50** — reset propre de l'état de contingence.
- **PR #51 (14/03)** — **islanding MW reporting** + highlights
  multi-assets pour les actions combinées.
- **PR #52 (17/03)** — **reload session** + persistance des paires
  combinées :
  - `/api/list-sessions` + `/api/load-session` + bouton dédié dans
    le banner.
  - Restauration sans re-simulation (rho values + status tags
    sauvegardés sont réaffichés tels quels ; la simulation ne se
    déclenche qu'à la sélection d'une action).
  - `restore_analysis_context()` côté backend pour conserver
    `lines_we_care_about` (consistence du monitoring entre runs).
  - Reconstruction de la topologie d'action depuis les données
    sauvegardées pour les actions absentes du dictionnaire courant.
  - Suppression des dialogs de changement de contingence pendant
    le restore via `restoringSessionRef`.
- **PRs #53–#54** — détection PST robuste dans les actions combinées,
  highlights de contingence orange.
- **PR #56 (21/03)** — **App.tsx Phase 1** : extraction de **5 hooks**
  (`useSettings`, `useActions`, `useAnalysis`, `useDiagrams`,
  `useSession`) ; `App.tsx` passe de **2 100+ → ~800 lignes** et
  devient un *state-orchestration hub*. C'est aussi la PR qui
  introduit `docs/app-refactoring-plan.md`.

### 1.6. Two-step analysis, replay-ready logging et rebrand (22 → 28/03/2026, PRs #57 → #65)

Dernière vague avant le tag 0.5.0, qui pose la majorité des
contrats utilisateur encore en vigueur :

- **PR #57 (22/03)** — **split de l'analyse en deux étapes** :
  `runAnalysisStep1` (POST → `can_proceed`, détection des
  surcharges) puis `runAnalysisStep2Stream` (POST avec
  `selected_overloads` / `all_overloads` / `monitor_deselected`,
  réponse streaming NDJSON). Sélection intelligente : préserve les
  surcharges déjà sélectionnées si elles intersectent les nouvelles,
  fallback all-detected sinon. Test coverage massive sur
  `useAnalysis` (396 lignes).
- **PR #58 / #60** — *interface discrepancies* React/standalone.
- **PR #59 (24/03)** — **persistance config** sur disque :
  `config.default.json` (templaté, tracké) + `config.json`
  (auto-créé, gitignoré) + endpoints `GET/POST /api/user-config`.
  Remplace l'ancien `localStorage`.
- **PR #61 (25/03)** — **action de délestage de charge** intégrée :
  paramètre `MIN_LOAD_SHEDDING`, calcul du delta MW shedded dans
  `_enrich_actions` et `simulate_manual_action`, badges VL verts
  cliquables et `get_load_voltage_levels_bulk()` côté backend.
- **PR #62 (25/03)** — colonne **MW Start** sur les action scores
  (line disconnection : `abs(p_or)` ; PST tap : `abs(p_or)` du PST ;
  load shedding : `load_p` ; open coupling : somme des `abs(p_or)`
  des virtuelles, etc.).
- **PR #63 (26/03)** — **SLD impact highlights** : 4 styles
  distincts (orange contingencies / yellow actions / dashed-orange
  overloads / purple breakers), avec lookup d'équipement à fallback
  multiples (sanitization dot/underscore + substring SVG ID),
  enrichissement backend `pst_tap` + `substations` + `switches`.
- **PR #64 (27/03)** — **interaction-logging replay-ready** :
  `InteractionLogger` singleton, 50+ types d'événements, `seq` +
  ISO timestamp + correlation ID pour les paires async start/complete,
  sauvegarde dans `interaction_log.json`, design doc 655 lignes
  + `docs/interaction-logging.md` (456 lignes).
- **PR #65 (28/03)** — **rebrand `ExpertAssist` → `Co-Study4Grid`**
  (1 commit, 18 fichiers, +26/−1998 — purge des références au
  vieux nom et nettoyage). C'est ce point qui ouvre l'historique
  git visible localement.

> **Bilan de la phase ExpertAssist** : 65 PRs sur 6 semaines, des
> couches de scaffold + visualisation NAD multi-tab à un workflow
> N-1 deux-étapes streamé, avec persistance de session, interaction
> logging, mocks de CI et la première extraction d'`App.tsx` en hooks.
> La 0.5.0 (14/04/2026) ne fait qu'apposer un tag sur cet ensemble et
> ajouter le catalogue d'actions complet (PST, curtailment) +
> les vectorisations perf — l'architecture qui sous-tend ce qui
> existe aujourd'hui est bâtie ici.

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
