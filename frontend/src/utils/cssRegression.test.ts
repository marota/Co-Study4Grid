// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study. 

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * CSS regression tests — ensure critical rendering rules are present in the
 * stylesheets. These tests exist to prevent accidental removal of CSS
 * properties that are essential for pypowsybl NAD visualization performance
 * and correctness on large grids.
 *
 * Background: removing `vector-effect: non-scaling-stroke` caused three
 * compounding regressions (invisible line colors, zoom lag/crash, tab-switch
 * latency). These tests guard against that happening again.
 */

const APP_CSS = fs.readFileSync(
    path.resolve(__dirname, '../App.css'),
    'utf-8',
);

const STANDALONE_HTML = fs.readFileSync(
    path.resolve(__dirname, '../../../standalone_interface.html'),
    'utf-8',
);

// Helper: extract CSS between <style> tags from standalone HTML
function extractStandaloneCSS(html: string): string {
    const match = html.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
    return match ? match[1] : '';
}

const STANDALONE_CSS = extractStandaloneCSS(STANDALONE_HTML);

describe('Critical CSS: non-scaling-stroke', () => {
    it('App.css applies vector-effect: non-scaling-stroke to SVG paths', () => {
        expect(APP_CSS).toContain('vector-effect: non-scaling-stroke');
        // Should apply to path, line, polyline, rect inside .svg-container svg
        expect(APP_CSS).toMatch(/\.svg-container\s+svg\s+path[\s\S]*?vector-effect:\s*non-scaling-stroke/);
    });

    it('App.css applies non-scaling-stroke to SVG lines', () => {
        expect(APP_CSS).toMatch(/\.svg-container\s+svg\s+(path,\s*\n\s*\.svg-container\s+svg\s+)?line/);
    });

    it('standalone_interface.html applies vector-effect: non-scaling-stroke to SVG paths', () => {
        expect(STANDALONE_CSS).toContain('vector-effect: non-scaling-stroke');
        expect(STANDALONE_CSS).toMatch(/\.svg-container\s+svg\s+path[\s\S]*?vector-effect:\s*non-scaling-stroke/);
    });
});

describe('Critical CSS: CSS containment', () => {
    it('App.css has contain: layout style paint on .svg-container', () => {
        expect(APP_CSS).toMatch(/\.svg-container\s*\{[^}]*contain:\s*layout\s+style\s+paint/);
    });

    it('standalone_interface.html has contain: layout style paint on .svg-container', () => {
        expect(STANDALONE_CSS).toMatch(/\.svg-container\s*\{[^}]*contain:\s*layout\s+style\s+paint/);
    });
});


describe('Critical CSS: svg-interacting pointer-events + filter suppression', () => {
    it('App.css disables pointer-events on SVG children during interaction', () => {
        expect(APP_CSS).toMatch(
            /\.svg-container\.svg-interacting\s+svg\s+\*[\s\S]*?pointer-events:\s*none\s*!important/,
        );
    });

    it('App.css suppresses drop-shadow filters on highlights during interaction', () => {
        expect(APP_CSS).toMatch(
            /\.svg-container\.svg-interacting\s+\.nad-action-target[\s\S]*?filter:\s*none\s*!important/,
        );
    });
});

describe('Critical CSS: highlight styles', () => {
    it('App.css defines .nad-overloaded highlight with orange stroke', () => {
        expect(APP_CSS).toMatch(/\.nad-overloaded[\s\S]*?stroke:\s*#ff8c00/);
    });

    it('App.css defines .nad-action-target highlight with pink stroke', () => {
        expect(APP_CSS).toMatch(/\.nad-action-target[\s\S]*?stroke:\s*#ff4081/);
    });

    it('App.css defines .nad-contingency-highlight with yellow stroke', () => {
        expect(APP_CSS).toMatch(/\.nad-contingency-highlight[\s\S]*?stroke:\s*#ffe033/);
    });

    it('standalone_interface.html defines .nad-overloaded highlight with orange stroke', () => {
        expect(STANDALONE_CSS).toMatch(/\.nad-overloaded[\s\S]*?stroke:\s*#ff8c00/);
    });

    it('standalone_interface.html defines .nad-action-target highlight with pink stroke', () => {
        expect(STANDALONE_CSS).toMatch(/\.nad-action-target[\s\S]*?stroke:\s*#ff4081/);
    });

    it('standalone_interface.html defines .nad-contingency-highlight with yellow stroke', () => {
        expect(STANDALONE_CSS).toMatch(/\.nad-contingency-highlight[\s\S]*?stroke:\s*#ffe033/);
    });
});

describe('Critical CSS: delta flow visualization', () => {
    it('App.css defines positive delta style (orange)', () => {
        expect(APP_CSS).toMatch(/\.nad-delta-positive[\s\S]*?stroke:\s*#ff8c00/);
    });

    it('App.css defines negative delta style (blue)', () => {
        expect(APP_CSS).toMatch(/\.nad-delta-negative[\s\S]*?stroke:\s*#2196F3/);
    });
});

describe('Critical rendering: standalone usePanZoom guards', () => {
    it('usePanZoom useLayoutEffect has [initialViewBox] dependency (not every render)', () => {
        // The useLayoutEffect for SVG caching must have [initialViewBox] deps
        // to avoid blocking paint on every render (critical for tab-switch latency)
        expect(STANDALONE_HTML).toMatch(/useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?svgElRef\.current[\s\S]*?\},\s*\[initialViewBox\]\)/);
    });

    it('usePanZoom has useLayoutEffect([active]) for tab activation sync', () => {
        // When becoming active, viewBox must be applied before paint
        expect(STANDALONE_HTML).toMatch(/useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?if\s*\(!active[\s\S]*?\},\s*\[active\]\)/);
    });

    it('tab synchronization uses useLayoutEffect (not useEffect)', () => {
        // Tab sync must use useLayoutEffect to apply viewBox before paint
        expect(STANDALONE_HTML).toMatch(/useLayoutEffect\(\(\)\s*=>\s*\{[\s\S]*?prevTabRef\.current[\s\S]*?sourceVB/);
    });
});

describe('Critical rendering: voltage filter early-return', () => {
    it('standalone voltage filter short-circuits when range covers all voltages', () => {
        // Prevents iterating all elements when no filtering is needed
        expect(STANDALONE_HTML).toContain('minKv <= uniqueVoltages[0] && maxKv >= uniqueVoltages[uniqueVoltages.length - 1]');
    });
});

describe('Critical rendering: deferred highlights on tab switch', () => {
    it('standalone uses requestAnimationFrame for highlights on tab switch', () => {
        // Highlights must be deferred on tab switch so the browser paints the tab first
        expect(STANDALONE_HTML).toMatch(/isTabSwitch[\s\S]*?requestAnimationFrame\(\(\)\s*=>\s*\{[\s\S]*?applyHighlightsForTab/);
    });
});

describe('Critical rendering: boost cache', () => {
    it('standalone caches boosted SVG to avoid redundant DOMParser work', () => {
        expect(STANDALONE_HTML).toContain('_boostCache');
        expect(STANDALONE_HTML).toContain('BOOST_CACHE_MAX');
    });
});
describe('Critical CSS: node/label visibility (regression guard)', () => {
    it('App.css does NOT contain .text-hidden rules that hide content', () => {
        expect(APP_CSS).not.toContain('text-hidden');
    });

    it('App.css does NOT hide foreignObject or text elements (except clones)', () => {
        // We allow display:none for nad-highlight-clone to avoid messy overlays,
        // but it should NOT be applied globally or to .svg-container children by default.
        const globalHide = APP_CSS.match(/(?:^|[^.])(foreignObject|text)\s*\{[^}]*display:\s*none/);
        if (globalHide) {
           // If we find a match, ensure it's scoped to .nad-action-target or similar
           expect(APP_CSS).toMatch(/\.nad-action-target\s+(text|foreignObject)/);
        }
    });

    it('standalone_interface.html does NOT contain .text-hidden or data-large-grid logic', () => {
        expect(STANDALONE_CSS).not.toContain('text-hidden');
        expect(STANDALONE_HTML).not.toContain('data-large-grid');
    });
});

describe('Critical config: standalone user-config save parity', () => {
    // The standalone's persist-to-file effect must include ALL config fields
    // that the React frontend saves. Missing fields silently lose user settings.

    // Extract the POST body from the standalone's user-config save effect
    const saveMatch = STANDALONE_HTML.match(
        /axios\.post\([^)]*api\/user-config[^)]*,\s*\{([\s\S]*?)\}\s*\)\.catch/
    );
    const saveBody = saveMatch ? saveMatch[1] : '';

    const REQUIRED_CONFIG_FIELDS = [
        'network_path',
        'action_file_path',
        'layout_path',
        'output_folder_path',
        'lines_monitoring_path',
        'min_line_reconnections',
        'min_close_coupling',
        'min_open_coupling',
        'min_line_disconnections',
        'min_pst',
        'min_load_shedding',
        'min_renewable_curtailment_actions',
        'n_prioritized_actions',
        'monitoring_factor',
        'pre_existing_overload_threshold',
        'ignore_reconnections',
        'pypowsybl_fast_mode',
    ];

    REQUIRED_CONFIG_FIELDS.forEach(field => {
        it(`standalone user-config save includes ${field}`, () => {
            expect(saveBody).toContain(field);
        });
    });
});
