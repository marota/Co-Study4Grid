# Plan: Fix Tab-Switch Rendering Latency in Standalone Interface

## Context

Sur un réseau France (11 225 lignes, ~500+ niveaux de tension), le changement d'onglet Action ↔ N-1 prend 1-3s. L'onglet ne s'affiche que quand tout le rendu est terminé — on ne voit pas le SVG apparaître puis se décorer, on voit un freeze.

### Causes identifiées (par ordre d'impact)

| # | Cause | Impact | Localisation |
|---|-------|--------|-------------|
| **1** | `useLayoutEffect` sans dépendances dans `usePanZoom` **bloque le paint** | **CRITIQUE** — empêche le navigateur de montrer l'onglet | `standalone_interface.html:448-461` |
| **2** | Filtre voltage : 33 675 écritures `style.display` même quand le range couvre tout | **~1-3s** — inutile dans le cas par défaut | `standalone_interface.html:2430-2477` |
| **3** | `applyDeltaVisuals` : en mode Impacts/delta, ajoute une classe CSS à **chaque** ligne du réseau (positive/negative/grey) + modifie le texte de chaque terminal | **~50-200ms** | `standalone_interface.html:2247-2345` |
| **4** | `getScreenCTM()` dans les highlights force un recalcul de layout | **~5-15ms** | `standalone_interface.html:884-885, 959-960` |
| **5** | 4× `querySelectorAll` de nettoyage dans `applyDeltaVisuals` scannent tout le SVG même quand aucun delta n'a été appliqué | **~3-7ms** | `standalone_interface.html:2250-2257` |

### Cause #1 en détail : le `useLayoutEffect` bloquant

```javascript
// Line 448 — PAS de tableau de dépendances → tourne à CHAQUE render
useLayoutEffect(() => {
    svgElRef.current = svgRef.current.querySelector('svg');
    if (svgElRef.current?.hasAttribute('data-large-grid')) {
        svgRef.current.classList.add('text-hidden');
    }
});
```

`useLayoutEffect` s'exécute **avant** le paint du navigateur. Sans dependency array, il tourne 3 fois par render (un par instance de `usePanZoom` : N, N-1, Action). La séquence est :

1. `setActiveTab('n-1')` → React re-render
2. React calcule le nouveau DOM (visibility CSS passe à 'visible')
3. **AVANT paint** : 3× `useLayoutEffect` font des `querySelector('svg')` sur des SVG massifs
4. **AVANT paint** : `useLayoutEffect` de `activeTabRef` (léger)
5. Navigateur paint → mais seulement maintenant
6. `useEffect`s se déclenchent (highlights + voltage filter via rAF)

→ L'utilisateur ne voit le changement qu'après l'étape 5.

## Plan d'implémentation

### Fix 1 : Ajouter un dependency array au `useLayoutEffect` de `usePanZoom` (critique)

**Fichier :** `standalone_interface.html:448-461`

Ajouter `[initialViewBox]` comme dépendance — ce hook n'a besoin de tourner que quand le SVG change (nouveau diagramme chargé), pas à chaque render.

```javascript
useLayoutEffect(() => {
    if (svgRef.current) {
        svgElRef.current = svgRef.current.querySelector('svg');
        if (svgElRef.current?.hasAttribute('data-large-grid')) {
            const vb = viewBoxRef.current;
            const origMax = initialMaxDimRef.current;
            if (!vb || !origMax || Math.max(vb.w, vb.h) / origMax >= 0.5) {
                svgRef.current.classList.add('text-hidden');
            }
        }
    } else {
        svgElRef.current = null;
    }
}, [initialViewBox]); // ← ne tourne que quand un nouveau diagramme arrive
```

### Fix 2 : Short-circuit du filtre voltage quand le range couvre tout

**Fichier :** `standalone_interface.html:2430` (dans `applyVoltageFilter`)

```javascript
const applyVoltageFilter = useCallback((container, metaIndex) => {
    if (!container || !metaIndex) return;
    if (uniqueVoltages.length === 0 || Object.keys(nominalVoltageMap).length === 0) return;

    const [minKv, maxKv] = voltageRange;
    // Skip if range covers everything — all elements already visible
    if (minKv <= uniqueVoltages[0] && maxKv >= uniqueVoltages[uniqueVoltages.length - 1]) return;

    // ... rest of filter
```

### Fix 3 : Guard `applyDeltaVisuals` nettoyage avec un flag

**Fichier :** `standalone_interface.html:2247-2257`

Tracker si des deltas ont été appliqués avec un `data-` attribute pour éviter 4 scans inutiles :

```javascript
const applyDeltaVisuals = useCallback((container, diagram, metaIndex) => {
    if (!container || !diagram || !metaIndex) return;

    // Skip cleanup if no deltas were ever applied to this container
    if (container.hasAttribute('data-deltas-applied')) {
        container.querySelectorAll('.nad-delta-positive').forEach(el => el.classList.remove('nad-delta-positive'));
        container.querySelectorAll('.nad-delta-negative').forEach(el => el.classList.remove('nad-delta-negative'));
        container.querySelectorAll('.nad-delta-grey').forEach(el => el.classList.remove('nad-delta-grey'));
        container.querySelectorAll('[data-original-text]').forEach(el => {
            el.textContent = el.getAttribute('data-original-text');
            el.removeAttribute('data-original-text');
        });
        container.removeAttribute('data-deltas-applied');
    }

    if (actionViewMode !== 'delta' || !diagram.flow_deltas) return;

    // ... apply deltas, then at end:
    container.setAttribute('data-deltas-applied', '1');
```

### Fix 4 : Cacher `bgCTM` dans les fonctions de highlight

**Fichier :** `standalone_interface.html:884-885, 959-960`

`getScreenCTM()` du background layer est constant pour un SVG donné. Le cacher :

```javascript
// In applyHighlight():
const bgCTM = backgroundLayer._cachedScreenCTM || (backgroundLayer._cachedScreenCTM = backgroundLayer.getScreenCTM());
```

Invalider quand le SVG change (dans l'effet d'invalidation du cache id-map).

### Fix 5 : Utiliser `getIdMap()` dans `applyOverloadedHighlights` au lieu de `querySelector`

**Fichier :** `standalone_interface.html:762`

Remplacer `container.querySelector([id="${edge.svgId}"])` par `getIdMap(container).get(edge.svgId)` — O(1) au lieu de O(n).

### Fix 6 : Appliquer les mêmes optimisations au frontend React

**Fichiers :**
- `frontend/src/components/VisualizationPanel.tsx` — voltage filter early-return, useLayoutEffect deps
- `frontend/src/utils/svgUtils.ts` — getIdMap dans highlights, CTM cache, delta guard

## Fichiers à modifier

1. `standalone_interface.html` — Fixes 1-5
2. `frontend/src/components/VisualizationPanel.tsx` — Fix 6 (voltage filter early-return, useLayoutEffect)
3. `frontend/src/utils/svgUtils.ts` — Fix 6 (getIdMap in highlights, CTM cache)
4. `frontend/src/utils/svgUtils.test.ts` — Tests pour early-return et skip behaviors

## Vérification

1. Ouvrir `standalone_interface.html` avec le réseau France
2. Changer d'onglet Action ↔ N-1 → doit être quasi-instantané (tab visible immédiatement, décorations ~1 frame après)
3. Bouger le slider kV → le filtre voltage doit toujours fonctionner
4. Activer le mode Impacts → les couleurs delta doivent apparaître correctement
5. `cd frontend && npx vitest run` → tous les tests passent
6. `cd frontend && npm run build && npm run lint` → clean
