// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

// Build config dedicated to producing the single-file `standalone.html`
// artifact. Inlines all JS / CSS / assets into one HTML file so the
// bundle can be shipped independently of the Vite dev server.
//
// See CLAUDE.md → "Standalone Interface Parity Audit" for the long-term
// plan to retire the hand-maintained `standalone_interface.html` in
// favour of this auto-generated output.

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { resolve } from 'node:path'
import { renameSync, existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs'

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: 'rename-and-inline-favicon',
      closeBundle() {
        const outDir = resolve(__dirname, 'dist-standalone')
        const from = resolve(outDir, 'index.html')
        const to = resolve(outDir, 'standalone.html')
        if (!existsSync(from)) return
        if (existsSync(to)) renameSync(to, to + '.bak')
        renameSync(from, to)

        // Replace the `<link rel="icon" href="./vite.svg">` reference
        // with an inline data URI so the single-file HTML remains
        // truly self-contained when opened via `file://` (no 404 on
        // the sibling vite.svg, no need to ship two files).
        const svgPath = resolve(outDir, 'vite.svg')
        if (existsSync(svgPath)) {
          const svgSrc = readFileSync(svgPath, 'utf-8').trim()
          const dataUri =
            'data:image/svg+xml;utf8,' + encodeURIComponent(svgSrc)
          let html = readFileSync(to, 'utf-8')
          html = html.replace(
            /href="\.\/vite\.svg"/,
            `href="${dataUri}"`,
          )
          writeFileSync(to, html)
          unlinkSync(svgPath)
        }
      },
    },
  ],
  build: {
    outDir: 'dist-standalone',
    emptyOutDir: true,
    assetsInlineLimit: 100_000_000,
    cssCodeSplit: false,
    // Keep the bundle unminified so the parity scripts
    // (scripts/check_standalone_parity.py et al.) can still walk the
    // inlined JS for `interactionLogger.record(...)` sites, `/api/...`
    // paths, and `useState` field identifiers. The size cost is ~2-3×
    // — acceptable while the auto-generated standalone runs alongside
    // the hand-maintained one.
    minify: false,
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
