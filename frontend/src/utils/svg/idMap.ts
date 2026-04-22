// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

/**
 * Cached DOM-id map for an SVG container.
 *
 * Avoids repeated `querySelectorAll('[id]')` scans on large SVG
 * containers. The cache is keyed by container element and is
 * invalidated (by identity of the inner `<svg>`) whenever the SVG
 * content changes.
 */
const idMapCache = new WeakMap<HTMLElement, { svg: SVGSVGElement | null; map: Map<string, Element> }>();

export const getIdMap = (container: HTMLElement): Map<string, Element> => {
    const svg = container.querySelector('svg');
    const cached = idMapCache.get(container);
    if (cached && cached.svg === svg) return cached.map;
    const map = new Map<string, Element>();
    container.querySelectorAll('[id]').forEach(el => map.set(el.id, el));
    idMapCache.set(container, { svg, map });
    return map;
};

export const invalidateIdMapCache = (container: HTMLElement) => {
    idMapCache.delete(container);
};
