// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0

import type { MetadataIndex } from '../../types';
import { getIdMap } from './idMap';

const SVG_NS = 'http://www.w3.org/2000/svg';
const VL_TITLE_MARKER = 'data-vl-title';

/**
 * Inject a `<title>` SVG element into each voltage-level node group so
 * the browser shows a native tooltip with the VL name when the user
 * hovers the bus circle and surrounding coordinates. Used in tandem
 * with the `nad-hide-vl-labels` class (toggled by the user from the
 * diagram bottom-left controls): when the on-diagram labels are
 * hidden the tooltip is the only way to recover the VL name.
 *
 * Idempotent — re-running on the same container updates each title's
 * text content rather than duplicating elements.
 */
export const applyVlTitles = (
    container: HTMLElement | null,
    metaIndex: MetadataIndex | null,
    displayName?: (id: string) => string,
): void => {
    if (!container || !metaIndex) return;
    const idMap = getIdMap(container);
    metaIndex.nodesBySvgId.forEach((node, svgId) => {
        const el = idMap.get(svgId);
        if (!el) return;
        const equipmentId = node.equipmentId;
        const friendly = displayName ? displayName(equipmentId) : equipmentId;
        const text = friendly && friendly !== equipmentId
            ? `${friendly} (${equipmentId})`
            : equipmentId;
        let title = el.querySelector(`:scope > title[${VL_TITLE_MARKER}]`);
        if (!title) {
            title = document.createElementNS(SVG_NS, 'title');
            title.setAttribute(VL_TITLE_MARKER, '');
            el.insertBefore(title, el.firstChild);
        }
        if (title.textContent !== text) title.textContent = text;
    });
};
