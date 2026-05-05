# Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
# This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
# If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
# you can obtain one at http://mozilla.org/MPL/2.0/.
# SPDX-License-Identifier: MPL-2.0
# This file is part of Co-Study4Grid.

"""Co-Study4Grid–specific overlay injected into the upstream alphaDeesp
interactive overflow-graph HTML.

The overlay adds **action overview pins** on top of the overflow graph.
The upstream HTML viewer (rendered by `alphaDeesp.core.interactive_html`)
already provides pan/zoom, layer toggles and click-to-highlight; this
module is a thin add-on that lives ONLY in Co-Study4Grid because it
depends on action-recommendation data that the upstream library has no
knowledge of.

Wire-format (parent React app → iframe via `postMessage`)::

    {
      "type":    "cs4g:pins",
      "visible": true | false,
      "pins":    [
        {
          "actionId":   "f344b…",
          "substation": "BEON",          # primary anchor
          "nodeCandidates": ["VL_1", …], # ordered fallback anchors
          "label":      "90.1%",
          "severity":   "green" | "orange" | "red" | "grey",
          "isSelected": true,
          "isRejected": false
        }, …
      ]
    }

The iframe answers back with::

    { "type": "cs4g:pin-clicked", "actionId": "<id>" }
    { "type": "cs4g:pin-double-clicked", "actionId": "<id>", "substation": "<name>" }

The pin glyph itself is rendered by the SHARED ``pinGlyph.js`` module
(``frontend/src/utils/svg/pinGlyph.js``), inlined verbatim into the
overlay so the iframe's pins are visually identical to the React
Action Overview pins. Single-source palette + single-source SVG path.

The injection is a pure string substitution: we splice ``<style>`` +
``<script>`` blocks immediately before the closing ``</body>`` tag.
Keeping the contract pure-text rather than DOM-aware lets us
unit-test the injector without an HTML parser dependency.
"""

from __future__ import annotations

import re
from pathlib import Path

# Path to the shared JS pin-glyph module. Same file is consumed by the
# React/TS bundle (`actionPinRender.ts`) via a normal ES import; here
# we read it as text and inline the body into the iframe's <script>.
_PIN_GLYPH_JS_PATH = (
    Path(__file__).resolve().parent.parent.parent
    / "frontend" / "src" / "utils" / "svg" / "pinGlyph.js"
)


def _load_pin_glyph_js() -> str:
    """Return the contents of ``pinGlyph.js`` with ESM ``export``
    keywords stripped so the body works as a plain inline script.

    The file is intentionally written without ``import`` statements
    (see its module-level comment) so the only ESM artefact is
    ``export const`` / ``export function``. We strip those prefixes
    at runtime — the resulting code is plain ES2015 that runs both
    inside a Vite bundle and inside the iframe overlay.
    """
    text = _PIN_GLYPH_JS_PATH.read_text(encoding="utf-8")
    # ``\bexport\s+(const|function|let|var)\s+`` keeps the keyword
    # after ``export`` intact; the module-scope binding is preserved.
    return re.sub(r"\bexport\s+(const|function|let|var)\s+", r"\1 ", text)


def _build_overlay_block() -> str:
    """Return the literal ``<style>…</style><script>…</script>`` block to
    inject before the iframe's ``</body>``.

    Single function (rather than a top-level constant) so we can
    re-read ``pinGlyph.js`` on every call — useful during dev when the
    shared module is being iterated on. In production the FastAPI
    process is restarted between deployments anyway.
    """
    pin_glyph_js = _load_pin_glyph_js()

    # Note the doubled ``{{ }}`` braces inside the f-string — they
    # encode literal ``{`` / ``}`` so the JS object literals survive
    # f-string formatting unchanged.
    return f"""
<style id="cs4g-overlay-style">
  /* Pin overlay — visual contract is owned by pinGlyph.js below.
     This file only adds interactive affordances (cursor / opacity). */
  .cs4g-pin {{ pointer-events: auto; cursor: pointer; }}

  /* ``ACTION PINS FILTERS`` section appended at the BOTTOM of the
     iframe's sidebar when the pin overlay is visible. Mirrors the
     chip-row filters of the React Action Overview tab so operators
     get identical filtering on both surfaces. The whole panel is
     wrapped in its own bordered container so it visually reads as
     a distinct, action-pin-scoped widget separate from the
     graph-layer toggles above. */
  #cs4g-filters {{
    display: none; margin: 14px 0 0; padding: 8px 0 0;
    border-top: 1px solid var(--border, #d1d5db);
  }}
  #cs4g-filters.visible {{ display: block; }}
  #cs4g-filters .filters-header {{
    display: flex; align-items: center; gap: 6px;
    font-size: 12px; text-transform: uppercase;
    color: var(--muted, #6b7280); margin: 0 0 6px;
    letter-spacing: 0.04em;
  }}
  #cs4g-filters .filters-counter {{
    margin-left: auto; display: inline-flex; align-items: center;
    gap: 3px; font-weight: 600; color: #111;
    font-variant-numeric: tabular-nums; text-transform: none;
    letter-spacing: 0;
  }}
  #cs4g-filters .row {{
    display: flex; align-items: center; gap: 6px;
    margin-bottom: 4px; font-size: 12px; flex-wrap: wrap;
  }}
  #cs4g-filters .swatch {{
    width: 10px; height: 10px; border-radius: 2px;
    border: 1px solid #ccc; display: inline-block; flex-shrink: 0;
  }}
  #cs4g-filters .chip {{
    padding: 2px 6px; border-radius: 4px;
    border: 1px solid #ccc; cursor: pointer; user-select: none;
    background: #fff; font-size: 11px;
  }}
  #cs4g-filters .chip[aria-pressed="true"] {{
    background: #1d4ed8; color: #fff; border-color: #1d4ed8;
  }}
  #cs4g-filters .threshold input {{
    width: 48px; padding: 1px 4px; font-size: 11px;
    border: 1px solid #ccc; border-radius: 3px;
    text-align: right; font-variant-numeric: tabular-nums;
  }}
  #cs4g-filters .pill {{
    padding: 1px 6px; border-radius: 3px;
    background: transparent; border: 1px solid transparent;
    cursor: pointer; user-select: none; font-size: 11px;
    color: #1d4ed8; text-decoration: underline;
  }}
  #cs4g-filters label.toggle {{
    display: inline-flex; align-items: center; gap: 4px;
    cursor: pointer; user-select: none;
  }}
</style>
<script id="cs4g-overlay-script">
(function() {{
  // ---- Shared glyph builder (inlined from frontend/src/utils/svg/pinGlyph.js)
  // The shared module defines its own private ``const SVG_NS`` at the
  // top of its body — we re-use that here rather than re-declaring it
  // (a duplicate ``const`` would be a parse error and silently disable
  // the entire overlay script).
{pin_glyph_js}
  // ---- /shared

  // Last-known pin payload — re-rendered whenever pin state changes.
  let lastPins = [];
  let lastVisible = false;

  // Last-known Action-Overview filter state (sent by the parent
  // every time it changes). The iframe never reads filter state
  // anywhere else — it just renders chips and posts user changes
  // back. The actual pin filtering happens in the React parent
  // (``buildOverflowPinPayload``).
  const PIN_COLORS = {{
    green: '#28a745', orange: '#f0ad4e',
    red: '#dc3545', grey: '#9ca3af',
  }};
  const ACTION_TYPE_TOKENS = [
    'all', 'disco', 'reco', 'ls', 'rc', 'open', 'close', 'pst',
  ];
  let filterState = {{
    categories: {{ green: true, orange: true, red: true, grey: true }},
    threshold: 1.5,
    showUnsimulated: false,
    actionType: 'all',
  }};

  function postFilters() {{
    window.parent.postMessage({{
      type: 'cs4g:overflow-filter-changed',
      filters: filterState,
    }}, '*');
  }}

  function buildFiltersPanel() {{
    const sidebar = document.getElementById('sidebar');
    if (!sidebar) return null;
    let panel = document.getElementById('cs4g-filters');
    if (panel) return panel;
    panel = document.createElement('section');
    panel.id = 'cs4g-filters';
    panel.innerHTML =
      '<div class="filters-header">'
      +   '<span aria-hidden>\U0001F4CC</span>'
      +   '<span>Action pins filters</span>'
      +   '<span class="filters-counter" data-counter title="Pins currently rendered on the overflow graph">'
      +     '<span aria-hidden>\U0001F4CC</span>'
      +     '<span data-counter-value>0</span>'
      +   '</span>'
      + '</div>'
      + '<div class="row" data-filter-row="categories"></div>'
      + '<div class="row" data-filter-row="category-bulk">'
      +   '<button type="button" class="pill" data-action="select-all">All</button>'
      +   '<button type="button" class="pill" data-action="select-none">None</button>'
      + '</div>'
      + '<div class="row threshold">'
      +   '<span style="color:#6b7280">Max loading</span>'
      +   '<input type="number" min="0" max="300" step="1" data-filter="threshold" />'
      +   '<span style="color:#6b7280">%</span>'
      + '</div>'
      + '<div class="row">'
      +   '<label class="toggle">'
      +     '<input type="checkbox" data-filter="show-unsimulated" />'
      +     '<span style="color:#6b7280">Show unsimulated</span>'
      +   '</label>'
      + '</div>'
      + '<div class="row" data-filter-row="action-types"></div>';
    // Append to the END of the sidebar so the filter chips read as
    // a distinct "pin-scoped" widget that follows the existing
    // graph-layer toggles, rather than competing for top-of-list
    // attention before the operator has even enabled pins.
    sidebar.appendChild(panel);
    // Categories row (Solves overload / Low margin / Still over… / Div).
    const catRow = panel.querySelector('[data-filter-row="categories"]');
    const catSpecs = [
      {{ key: 'green', label: 'Solves overload' }},
      {{ key: 'orange', label: 'Low margin' }},
      {{ key: 'red', label: 'Still overloaded' }},
      {{ key: 'grey', label: 'Divergent / islanded' }},
    ];
    for (const spec of catSpecs) {{
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.setAttribute('data-category', spec.key);
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.innerHTML =
        '<span class="swatch" style="background:' + PIN_COLORS[spec.key] + '"></span> '
        + spec.label;
      chip.addEventListener('click', function() {{
        filterState = {{
          ...filterState,
          categories: {{
            ...filterState.categories,
            [spec.key]: !filterState.categories[spec.key],
          }},
        }};
        renderFilterState();
        postFilters();
      }});
      catRow.appendChild(chip);
    }}
    // Bulk select-all / select-none.
    const bulkRow = panel.querySelector('[data-filter-row="category-bulk"]');
    bulkRow.querySelector('[data-action="select-all"]').addEventListener('click', function() {{
      filterState = {{
        ...filterState,
        categories: {{ green: true, orange: true, red: true, grey: true }},
      }};
      renderFilterState(); postFilters();
    }});
    bulkRow.querySelector('[data-action="select-none"]').addEventListener('click', function() {{
      filterState = {{
        ...filterState,
        categories: {{ green: false, orange: false, red: false, grey: false }},
      }};
      renderFilterState(); postFilters();
    }});
    // Threshold spinner.
    const thr = panel.querySelector('input[data-filter="threshold"]');
    thr.addEventListener('change', function(ev) {{
      const raw = parseInt(ev.target.value, 10);
      if (!Number.isFinite(raw)) return;
      const clamped = Math.max(0, Math.min(300, raw));
      filterState = {{ ...filterState, threshold: clamped / 100 }};
      renderFilterState(); postFilters();
    }});
    // Show-unsimulated checkbox.
    const showU = panel.querySelector('input[data-filter="show-unsimulated"]');
    showU.addEventListener('change', function(ev) {{
      filterState = {{ ...filterState, showUnsimulated: !!ev.target.checked }};
      renderFilterState(); postFilters();
    }});
    // Action-type chips.
    const typeRow = panel.querySelector('[data-filter-row="action-types"]');
    for (const tok of ACTION_TYPE_TOKENS) {{
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.setAttribute('data-action-type', tok);
      chip.setAttribute('role', 'button');
      chip.setAttribute('tabindex', '0');
      chip.textContent = tok.toUpperCase();
      chip.addEventListener('click', function() {{
        filterState = {{ ...filterState, actionType: tok }};
        renderFilterState(); postFilters();
      }});
      typeRow.appendChild(chip);
    }}
    return panel;
  }}

  function renderFilterState() {{
    const panel = document.getElementById('cs4g-filters');
    if (!panel) return;
    panel.querySelectorAll('[data-category]').forEach(function(el) {{
      const k = el.getAttribute('data-category');
      el.setAttribute('aria-pressed',
        filterState.categories[k] ? 'true' : 'false');
    }});
    panel.querySelectorAll('[data-action-type]').forEach(function(el) {{
      const k = el.getAttribute('data-action-type');
      el.setAttribute('aria-pressed',
        filterState.actionType === k ? 'true' : 'false');
    }});
    const thr = panel.querySelector('input[data-filter="threshold"]');
    if (thr) thr.value = String(Math.round(filterState.threshold * 100));
    const showU = panel.querySelector('input[data-filter="show-unsimulated"]');
    if (showU) showU.checked = !!filterState.showUnsimulated;
  }}

  function updatePinCounter(count) {{
    const panel = document.getElementById('cs4g-filters');
    if (!panel) return;
    const v = panel.querySelector('[data-counter-value]');
    if (v) v.textContent = String(count);
  }}

  function getSvg() {{
    return document.querySelector('#stage svg');
  }}
  function getRoot(svg) {{
    if (!svg) return null;
    return svg.querySelector('g.graph') || svg.querySelector('g') || svg;
  }}

  // Pin layer lives INSIDE the ``g.graph`` group so it inherits the
  // graphviz transform (graphviz emits ``transform="scale(…) translate(…)"``
  // on ``g.graph``). Without this, ``getBBox()`` coordinates from a
  // ``.node`` would be in the graph's local space but pin coordinates
  // would render against the outer SVG's viewport, leaving pins
  // floating above / outside the actual graph.
  function ensureLayer() {{
    const root = getRoot(getSvg());
    if (!root) return null;
    let layer = root.querySelector('g.cs4g-pin-layer');
    if (!layer) {{
      layer = document.createElementNS(SVG_NS, 'g');
      layer.setAttribute('class', 'cs4g-pin-layer');
      // Append last so pins draw on top of nodes / edges.
      root.appendChild(layer);
    }}
    return layer;
  }}

  // Project a point in a node's local space into the layer's space
  // by composing CTMs. Returns null if either CTM is unavailable.
  function projectToLayer(node, layer, lx, ly) {{
    if (!node.getCTM || !layer.getCTM) return null;
    const nodeCTM = node.getCTM();
    const layerCTM = layer.getCTM();
    if (!nodeCTM || !layerCTM) return null;
    const m = layerCTM.inverse().multiply(nodeCTM);
    return {{
      x: m.a * lx + m.c * ly + m.e,
      y: m.b * lx + m.d * ly + m.f,
    }};
  }}

  // Anchor a pin at the midpoint of the edge whose ``data-attr-name``
  // matches one of the candidate line names. This mirrors the Action
  // Overview NAD pin's edge-midpoint anchor for branch actions —
  // disco / reco / max_rho_line all land on the line's middle, not
  // on either endpoint.
  function edgeCentre(lineNames, layer) {{
    const root = getRoot(getSvg());
    if (!root || !lineNames || !lineNames.length) return null;
    for (const name of lineNames) {{
      if (typeof name !== 'string' || !name) continue;
      const safe = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/(["\\\\])/g, '\\\\$1');
      const edge = root.querySelector('.edge[data-attr-name="' + safe + '"]');
      if (!edge) continue;
      const src = edge.getAttribute('data-source');
      const tgt = edge.getAttribute('data-target');
      if (!src || !tgt) continue;
      const safeSrc = (window.CSS && CSS.escape) ? CSS.escape(src) : src;
      const safeTgt = (window.CSS && CSS.escape) ? CSS.escape(tgt) : tgt;
      const srcNode = root.querySelector('.node[data-name="' + safeSrc + '"]');
      const tgtNode = root.querySelector('.node[data-name="' + safeTgt + '"]');
      if (!srcNode || !tgtNode) continue;
      try {{
        const sb = srcNode.getBBox();
        const tb = tgtNode.getBBox();
        const sp = projectToLayer(srcNode, layer,
          sb.x + sb.width / 2, sb.y + sb.height / 2);
        const tp = projectToLayer(tgtNode, layer,
          tb.x + tb.width / 2, tb.y + tb.height / 2);
        if (!sp || !tp) continue;
        return {{
          x: (sp.x + tp.x) / 2,
          y: (sp.y + tp.y) / 2,
          ref: sb,
        }};
      }} catch (e) {{
        continue;
      }}
    }}
    return null;
  }}

  // Anchor a pin on the centre of the matching node group. ``names``
  // is an ordered list of candidate ``data-name`` values — the
  // substation first, then any voltage-level ids the action targets,
  // so we still find an anchor when the recommender emits a VL-keyed
  // overflow graph rather than a substation-keyed one.
  //
  // ``getBBox()`` returns the node's local-space bounding box —
  // BEFORE the node's own ``transform="translate(...)"`` is applied.
  // Graphviz emits per-node translate transforms, so we must compose
  // the node's CTM with the inverse of the layer's CTM to project
  // the bbox centre into the layer's coordinate system. Otherwise
  // every pin would land at (0, 0) of the graph and stack on top of
  // each other behind the background polygon.
  function nodeCentre(names, layer) {{
    const root = getRoot(getSvg());
    if (!root || !names || !names.length) return null;
    for (const name of names) {{
      if (typeof name !== 'string' || !name) continue;
      const safe = (window.CSS && CSS.escape) ? CSS.escape(name) : name.replace(/(["\\\\])/g, '\\\\$1');
      const node = root.querySelector('.node[data-name="' + safe + '"]');
      if (!node) continue;
      try {{
        const bb = node.getBBox();
        // Pin tip lands at the TOP of the node so the body floats
        // above instead of overlapping the label.
        const projected = projectToLayer(
          node, layer,
          bb.x + bb.width / 2, bb.y,
        );
        if (projected) {{
          return {{ x: projected.x, y: projected.y, ref: bb }};
        }}
        return {{ x: bb.x + bb.width / 2, y: bb.y, ref: bb }};
      }} catch (e) {{
        continue;
      }}
    }}
    return null;
  }}

  // Pick a global pin radius by sampling the FIRST visible node.
  // The bbox is in node-local space; we scale it through the layer's
  // CTM so the radius is expressed in the same coordinate system as
  // the centre we just computed. Cached because every node in a
  // graphviz dot output uses the same shape size class.
  let cachedR = null;
  function basePinRadius(layer) {{
    if (cachedR !== null) return cachedR;
    const root = getRoot(getSvg());
    if (!root) return 14;
    const node = root.querySelector('.node');
    if (!node) return 14;
    try {{
      const bb = node.getBBox();
      let r = Math.min(bb.width, bb.height) * 0.55;
      if (layer && node.getCTM && layer.getCTM) {{
        const nodeCTM = node.getCTM();
        const layerCTM = layer.getCTM();
        if (nodeCTM && layerCTM) {{
          const m = layerCTM.inverse().multiply(nodeCTM);
          // Uniform scale factor (graphviz transforms are
          // axis-aligned scale + translate, so |a| ~= |d|).
          const scale = Math.sqrt(Math.abs(m.a * m.d - m.b * m.c)) || 1;
          r = r * scale;
        }}
      }}
      cachedR = Math.max(8, r);
    }} catch (e) {{
      cachedR = 14;
    }}
    return cachedR;
  }}

  // Delay used to distinguish a single click from the first click of
  // a double click. Mirrors PIN_SINGLE_CLICK_DELAY_MS in
  // ``actionPinRender.ts`` so both pin layers feel identical.
  const SINGLE_CLICK_DELAY_MS = 250;

  function buildPin(pin, centre, layer) {{
    const r = basePinRadius(layer);
    const isUnsim = !!pin.unsimulated;
    // Reuse the SHARED action-overview glyph builder — same SVG
    // shape, palette, chrome and status symbols. Un-simulated pins
    // ride the ``dimmed`` flag so the body uses the dimmed palette,
    // matching the Action Overview's renderUnsimulatedPin.
    const g = createPinGlyph(document, {{
      severity: pin.severity,
      label: pin.label,
      // Use the explicit ``title`` field when the parent provided
      // one (e.g. multi-line score / rank / MW-start summary for
      // un-simulated pins) so the native <title> tooltip carries
      // the same content as the Action Overview NAD pin. Falls
      // back to the action id for simulated pins.
      title: (typeof pin.title === 'string' && pin.title)
        ? pin.title
        : pin.actionId,
      actionId: pin.actionId,
      isSelected: !!pin.isSelected,
      isRejected: !!pin.isRejected,
      dimmed: isUnsim,
      r: r,
    }});
    g.setAttribute('transform', 'translate(' + centre.x + ' ' + centre.y + ')');
    if (isUnsim) {{
      // Match the Action-Overview unsimulated pin's visual:
      // dashed outline + reduced opacity + ``data-unsimulated``
      // sentinel so unit tests can disambiguate the two layers.
      g.setAttribute('data-unsimulated', 'true');
      g.setAttribute('opacity', '0.5');
      const path = g.querySelector('path');
      if (path) {{
        path.setAttribute('stroke', '#1f2937');
        path.setAttribute('stroke-width', String(r * 0.08));
        path.setAttribute('stroke-dasharray',
          String(r * 0.35) + ' ' + String(r * 0.2));
      }}
    }}

    // Single click vs double click are debounced — exactly the same
    // pattern used by the Action Overview pins. Single click posts
    // ``cs4g:pin-clicked`` (parent focuses the feed card) AFTER the
    // 250 ms timer; double click cancels the timer and posts
    // ``cs4g:pin-double-clicked`` (parent opens the SLD on its
    // action sub-tab). Without this, the click handler would always
    // run before dblclick, switching the React tab and preventing
    // the SLD overlay from materialising on the right tab.
    let clickTimer = null;
    g.addEventListener('click', function(ev) {{
      ev.stopPropagation();
      if (clickTimer !== null) return;
      // Capture the pin's screen-pixel rect at click time so the
      // parent React app can position the floating action-card
      // popover next to the pin (same UX as the Action Overview
      // pin). Coordinates are iframe-screen pixels; the parent
      // adds the iframe's own offset to convert to parent-screen.
      const rect = g.getBoundingClientRect();
      const rectPayload = {{
        left: rect.left, top: rect.top,
        width: rect.width, height: rect.height,
      }};
      clickTimer = setTimeout(function() {{
        clickTimer = null;
        window.parent.postMessage({{
          type: 'cs4g:pin-clicked',
          actionId: pin.actionId,
          screenRect: rectPayload,
        }}, '*');
      }}, SINGLE_CLICK_DELAY_MS);
    }});
    g.addEventListener('dblclick', function(ev) {{
      ev.stopPropagation();
      ev.preventDefault();
      if (clickTimer !== null) {{
        clearTimeout(clickTimer);
        clickTimer = null;
      }}
      // Un-simulated pins kick off a manual simulation rather than
      // open the SLD overlay. Mirrors the Action Overview's
      // ``onUnsimulatedPinDoubleClick`` path.
      if (isUnsim) {{
        window.parent.postMessage({{
          type: 'cs4g:overflow-unsimulated-pin-double-clicked',
          actionId: pin.actionId,
        }}, '*');
      }} else {{
        window.parent.postMessage({{
          type: 'cs4g:pin-double-clicked',
          actionId: pin.actionId,
          substation: pin.substation
        }}, '*');
      }}
    }});
    return g;
  }}

  function render() {{
    const layer = ensureLayer();
    if (!layer) return;
    while (layer.firstChild) layer.removeChild(layer.firstChild);
    cachedR = null;  // Re-sample radius after every render.
    let drawn = 0;
    if (lastVisible && lastPins.length) {{
      for (const pin of lastPins) {{
        // Branch actions (disco / reco / max_rho_line) anchor at
        // the midpoint of the matching edge — same rule the Action
        // Overview pins follow. Falls back to a single-node anchor
        // when the edge isn't drawn (e.g. a line filtered out by
        // the recommender's keep_overloads_components).
        let centre = null;
        if (Array.isArray(pin.lineNames) && pin.lineNames.length) {{
          centre = edgeCentre(pin.lineNames, layer);
        }}
        if (!centre) {{
          const candidates = [pin.substation].concat(
            Array.isArray(pin.nodeCandidates) ? pin.nodeCandidates : []
          );
          centre = nodeCentre(candidates, layer);
        }}
        if (!centre) continue;
        layer.appendChild(buildPin(pin, centre, layer));
        drawn += 1;
      }}
    }}
    updatePinCounter(drawn);
  }}

  function syncFilterPanelVisibility() {{
    const panel = buildFiltersPanel();
    if (!panel) return;
    if (lastVisible) panel.classList.add('visible');
    else panel.classList.remove('visible');
  }}

  window.addEventListener('message', function(ev) {{
    const msg = ev && ev.data;
    if (!msg || typeof msg !== 'object') return;
    if (msg.type === 'cs4g:filters' && msg.filters && typeof msg.filters === 'object') {{
      // Parent broadcasts the live overviewFilters value. We only
      // overwrite our local copy — the parent is the single source
      // of truth and re-emits this whenever its state changes.
      filterState = {{
        categories: {{
          green: !!msg.filters.categories?.green,
          orange: !!msg.filters.categories?.orange,
          red: !!msg.filters.categories?.red,
          grey: !!msg.filters.categories?.grey,
        }},
        threshold: typeof msg.filters.threshold === 'number'
          ? msg.filters.threshold : 1.5,
        showUnsimulated: !!msg.filters.showUnsimulated,
        actionType: typeof msg.filters.actionType === 'string'
          ? msg.filters.actionType : 'all',
      }};
      buildFiltersPanel();
      renderFilterState();
      return;
    }}
    if (msg.type !== 'cs4g:pins') return;
    lastVisible = !!msg.visible;
    if (Array.isArray(msg.pins)) lastPins = msg.pins;
    syncFilterPanelVisibility();
    render();
  }});

  // Notify the parent that the overlay is wired up so it can post
  // pins immediately rather than waiting for a poll.
  window.addEventListener('load', function() {{
    window.parent.postMessage({{ type: 'cs4g:overlay-ready' }}, '*');
  }});
}})();
</script>
"""


def inject_overlay(html: str) -> str:
    """Splice the Co-Study4Grid overlay block before the closing
    ``</body>`` of an upstream alphaDeesp overflow-graph HTML.

    Idempotent: re-injection on an already-augmented file replaces the
    previous block (matched by its ``id`` attributes) so successive
    cache fetches do not accumulate duplicate listeners.

    Raises ``ValueError`` if the input lacks a ``</body>`` tag.
    """
    closing = "</body>"
    if closing not in html:
        raise ValueError(
            "Overflow HTML has no </body> tag — refusing to inject overlay."
        )

    # Strip any prior injection so a re-fetch of the same file doesn't
    # accumulate duplicate event listeners (cheap string match — both
    # blocks carry deterministic ids).
    for marker in ('<style id="cs4g-overlay-style">', '<script id="cs4g-overlay-script">'):
        start = html.find(marker)
        if start == -1:
            continue
        # Find the closing tag that matches the marker's element.
        end_tag = "</style>" if marker.startswith("<style") else "</script>"
        end = html.find(end_tag, start)
        if end == -1:
            continue
        html = html[:start] + html[end + len(end_tag):]

    block = _build_overlay_block()
    return html.replace(closing, block + closing, 1)


__all__ = ["inject_overlay"]
