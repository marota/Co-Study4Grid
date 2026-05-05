// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// SPDX-License-Identifier: MPL-2.0

/**
 * End-to-end render test for the overflow-graph iframe overlay JS.
 *
 * The overlay is a Python f-string in
 * ``expert_backend/services/overflow_overlay.py`` — the unit tests in
 * ``test_overflow_overlay.py`` only assert that the produced JS *contains*
 * the right keywords. This test goes one layer deeper: it loads the
 * overlay JS into a jsdom document, builds a synthetic graphviz-style
 * SVG, simulates a ``cs4g:pins`` postMessage, and asserts that pin glyphs
 * actually land in the DOM.
 *
 * This is the regression guard for the user-reported bug "no pins are
 * rendered on the overflow analysis tab" — without it, a typo / scope
 * issue in the overlay's render() loop is invisible to the rest of the
 * test suite (the Python tests only check keywords).
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, vi } from 'vitest';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const OVERLAY_PY = resolve(REPO_ROOT, 'expert_backend/services/overflow_overlay.py');
const PIN_GLYPH_JS = resolve(REPO_ROOT, 'frontend/src/utils/svg/pinGlyph.js');

/**
 * Extract the inlined overlay <script> body from the Python source.
 *
 * The Python file builds the JS via an f-string returned by
 * ``_build_overlay_block``. We pull the body of the first
 * ``<script id="cs4g-overlay-script">…</script>`` block out by
 * regex — same shape ``inject_overlay`` ships at runtime — and
 * strip Python's ``{{`` / ``}}`` doubling so the result is valid JS.
 */
function loadOverlayScript(): string {
    const py = readFileSync(OVERLAY_PY, 'utf-8');
    const m = py.match(/<script id="cs4g-overlay-script">([\s\S]*?)<\/script>/);
    if (!m) throw new Error('cs4g-overlay-script block not found');
    let body = m[1];
    // The Python f-string substitutes ``{pin_glyph_js}`` with the
    // contents of ``frontend/src/utils/svg/pinGlyph.js`` (ESM
    // ``export`` keywords stripped). Reproduce that substitution
    // BEFORE we collapse ``{{`` / ``}}`` into single braces, so the
    // glyph file's own braces are preserved verbatim.
    let glyph = readFileSync(PIN_GLYPH_JS, 'utf-8');
    glyph = glyph.replace(/^export\s+/gm, '');
    body = body.replace('{pin_glyph_js}', glyph);
    // Now collapse the remaining f-string brace doubling.
    body = body.replace(/\{\{/g, '{').replace(/\}\}/g, '}');
    return body;
}

interface SyntheticPoint { x: number; y: number }

/**
 * Build a synthetic graphviz-style SVG with two named nodes and a
 * curved edge whose path runs from src to tgt. jsdom does not
 * implement getBBox / getCTM / getTotalLength / getPointAtLength, so
 * we monkey-patch them with deterministic stubs keyed off element
 * attributes — enough for the overlay's edgeCentre / nodeCentre
 * helpers to land somewhere reasonable.
 */
function buildSyntheticOverflowDom(
    nodes: Array<{ name: string; x: number; y: number }>,
    edges: Array<{ name: string; src: string; tgt: string; midpoint: SyntheticPoint }>,
): { svg: SVGSVGElement; cleanup: () => void } {
    document.body.innerHTML = '';
    const root = document.createElement('div');
    root.id = 'stage';
    document.body.appendChild(root);
    const svgNs = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNs, 'svg') as SVGSVGElement;
    root.appendChild(svg);
    const graph = document.createElementNS(svgNs, 'g');
    graph.setAttribute('class', 'graph');
    svg.appendChild(graph);

    // Identity CTM stubs — overlay's projectToLayer multiplies inverses
    // and sums translates. With identity matrices the projection is a
    // no-op and the local bbox / path coords are returned as-is.
    const identityCTM = () => ({
        a: 1, b: 0, c: 0, d: 1, e: 0, f: 0,
        inverse() { return identityCTM(); },
        multiply() { return identityCTM(); },
    });
    // Patch the prototype rather than per-element, so newly created
    // children of frag.appendChild(...) inside render() also get the
    // stubs.
    (Element.prototype as unknown as { getCTM: () => unknown }).getCTM = identityCTM;

    for (const n of nodes) {
        const g = document.createElementNS(svgNs, 'g');
        g.setAttribute('class', 'node');
        g.setAttribute('data-name', n.name);
        // Stub getBBox to return a node centred at (n.x, n.y).
        (g as unknown as { getBBox: () => DOMRect }).getBBox = () =>
            ({ x: n.x - 5, y: n.y - 5, width: 10, height: 10 } as DOMRect);
        graph.appendChild(g);
    }
    for (const e of edges) {
        const g = document.createElementNS(svgNs, 'g');
        g.setAttribute('class', 'edge');
        g.setAttribute('data-attr-name', e.name);
        g.setAttribute('data-source', e.src);
        g.setAttribute('data-target', e.tgt);
        const path = document.createElementNS(svgNs, 'path');
        path.setAttribute('d', `M${e.src} L${e.tgt}`);
        // Stub getTotalLength + getPointAtLength to land on midpoint.
        (path as unknown as { getTotalLength: () => number }).getTotalLength = () => 100;
        (path as unknown as {
            getPointAtLength: (l: number) => DOMPoint;
        }).getPointAtLength = () => ({ x: e.midpoint.x, y: e.midpoint.y } as DOMPoint);
        g.appendChild(path);
        graph.appendChild(g);
    }
    return {
        svg,
        cleanup: () => { document.body.innerHTML = ''; },
    };
}

const noop = () => {};

describe('overflow overlay — render() actually attaches pin glyphs', () => {
    beforeEach(() => {
        // Silence the overlay's ``window.parent.postMessage`` calls.
        vi.spyOn(window, 'postMessage').mockImplementation(noop);
    });

    it('renders one unitary pin per descriptor when the iframe receives cs4g:pins', () => {
        const { cleanup } = buildSyntheticOverflowDom(
            [
                { name: 'NODE_A', x: 100, y: 100 },
                { name: 'NODE_B', x: 200, y: 200 },
            ],
            [{ name: 'L_AB', src: 'NODE_A', tgt: 'NODE_B', midpoint: { x: 150, y: 150 } }],
        );

        const overlay = loadOverlayScript();
        // Wrap the IIFE body inside an explicit call so eval doesn't
        // run it at module load time — we want to control timing.
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        new Function(overlay)();

        // Post the cs4g:pins payload — same shape ``useOverflowIframe``
        // sends from the parent window.
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'cs4g:pins',
                visible: true,
                pins: [
                    {
                        actionId: 'disco_L_AB',
                        substation: 'NODE_A',
                        nodeCandidates: [],
                        lineNames: ['L_AB'],
                        label: '65%',
                        severity: 'orange',
                        isSelected: false,
                        isRejected: false,
                    },
                    {
                        actionId: 'load_shedding_NODE_B',
                        substation: 'NODE_B',
                        nodeCandidates: [],
                        lineNames: [],
                        label: '79%',
                        severity: 'red',
                        isSelected: false,
                        isRejected: false,
                    },
                ],
            },
        }));

        const layer = document.querySelector('g.cs4g-pin-layer');
        expect(layer).not.toBeNull();
        // Two unitary pins must materialise in the layer.
        const pins = layer!.querySelectorAll('[data-action-id]');
        expect(pins.length).toBeGreaterThanOrEqual(2);
        const ids = Array.from(pins).map(p => p.getAttribute('data-action-id'));
        expect(ids).toContain('disco_L_AB');
        expect(ids).toContain('load_shedding_NODE_B');

        cleanup();
    });

    it('renders the combined-pin curve + "+" badge AND keeps unitary pins visible', () => {
        const { cleanup } = buildSyntheticOverflowDom(
            [
                { name: 'NODE_A', x: 100, y: 100 },
                { name: 'NODE_B', x: 200, y: 200 },
                { name: 'NODE_C', x: 300, y: 300 },
            ],
            [],
        );

        const overlay = loadOverlayScript();
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        new Function(overlay)();

        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'cs4g:pins',
                visible: true,
                pins: [
                    {
                        actionId: 'a',
                        substation: 'NODE_A',
                        label: '50%', severity: 'green',
                        isSelected: false, isRejected: false,
                    },
                    {
                        actionId: 'b',
                        substation: 'NODE_B',
                        label: '60%', severity: 'orange',
                        isSelected: false, isRejected: false,
                    },
                    {
                        actionId: 'a+b',
                        isCombined: true,
                        action1Id: 'a',
                        action2Id: 'b',
                        substation: '',
                        label: '70%', severity: 'red',
                        isSelected: false, isRejected: false,
                    },
                ],
            },
        }));

        const layer = document.querySelector('g.cs4g-pin-layer')!;
        // Unitary pins must STILL be present even though a combined
        // pair is drawn — this is the regression the user reported.
        const ids = Array.from(layer.querySelectorAll('[data-action-id]'))
            .map(p => p.getAttribute('data-action-id'));
        expect(ids).toContain('a');
        expect(ids).toContain('b');
        expect(ids).toContain('a+b');
        // Dashed connector path between the two constituents.
        expect(layer.querySelector('.cs4g-overflow-combined-curve')).not.toBeNull();
        // Constituent pins are flagged for dimming.
        const constituents = Array.from(layer.querySelectorAll(
            '[data-combined-constituent="1"]',
        )).map(el => el.getAttribute('data-action-id'));
        expect(constituents).toEqual(expect.arrayContaining(['a', 'b']));

        cleanup();
    });

    it('a combined-pin failure does NOT erase the unitary pins (try/catch fence)', () => {
        const { cleanup } = buildSyntheticOverflowDom(
            [{ name: 'NODE_A', x: 100, y: 100 }, { name: 'NODE_B', x: 200, y: 200 }],
            [],
        );

        const overlay = loadOverlayScript();
        // eslint-disable-next-line @typescript-eslint/no-implied-eval, no-new-func
        new Function(overlay)();

        // The combined pin references a unitary id that doesn't
        // resolve to a node — this used to abort render() and leave
        // the layer empty. With the try/catch fence the unitary
        // pins must still come through.
        window.dispatchEvent(new MessageEvent('message', {
            data: {
                type: 'cs4g:pins',
                visible: true,
                pins: [
                    {
                        actionId: 'a', substation: 'NODE_A',
                        label: '50%', severity: 'green',
                        isSelected: false, isRejected: false,
                    },
                    {
                        actionId: 'b', substation: 'NODE_B',
                        label: '60%', severity: 'orange',
                        isSelected: false, isRejected: false,
                    },
                    {
                        actionId: 'a+ghost',
                        isCombined: true,
                        action1Id: 'a',
                        action2Id: 'ghost-not-in-pins',
                        substation: '',
                        label: '70%', severity: 'red',
                        isSelected: false, isRejected: false,
                    },
                ],
            },
        }));

        const layer = document.querySelector('g.cs4g-pin-layer')!;
        const ids = Array.from(layer.querySelectorAll('[data-action-id]'))
            .map(p => p.getAttribute('data-action-id'));
        expect(ids).toContain('a');
        expect(ids).toContain('b');
        // The combined pin pointing at a missing constituent must not
        // emit a glyph (the curve has no second anchor).
        expect(ids).not.toContain('a+ghost');

        cleanup();
    });
});
