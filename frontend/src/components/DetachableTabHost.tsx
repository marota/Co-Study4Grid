// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import React, { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Hosts a piece of React UI that can be relocated between its "home"
 * position in the main window and a secondary browser window (popup),
 * WITHOUT unmounting the React sub-tree.
 *
 * The trick: we create a stable orphan `<div>` (the "real target") once
 * via useRef, and always render children through `createPortal(children,
 * realTarget)`. Because the portal target never changes, React never
 * unmounts or remounts the sub-tree — all refs, DOM listeners and the
 * SVG viewBox attribute survive the round-trip.
 *
 * A useLayoutEffect then physically moves the orphan div between:
 *   - the home placeholder (when `detachedMountNode` is null), or
 *   - the popup's mount node (when detached).
 *
 * The home placeholder is a plain `<div ref={homeRef} style={homeStyle}/>`
 * rendered in the normal React position. While the content is detached,
 * the home div stays in the main tree as an empty positioned slot — the
 * parent's layout therefore never shifts and React never needs to
 * insertBefore against a missing anchor.
 *
 * This pattern is critical for preserving MemoizedSvgContainer state:
 * its useLayoutEffect runs `replaceChildren(svg)` on mount, and a
 * remount would clobber the auto-zoom viewBox that was applied between
 * the two invocations. By keeping the sub-tree mounted across the move,
 * we never trigger that remount.
 */
interface DetachableTabHostProps {
    /** When non-null, children are physically relocated to this DOM node (e.g., a popup body). */
    detachedMountNode: HTMLElement | null | undefined;
    /** Inline style applied to the home placeholder div in the main tree. */
    homeStyle?: React.CSSProperties;
    children: React.ReactNode;
}

const DetachableTabHost: React.FC<DetachableTabHostProps> = ({
    detachedMountNode,
    homeStyle,
    children,
}) => {
    const homeRef = useRef<HTMLDivElement>(null);

    // Stable, one-time-created orphan div that serves as the portal
    // target. Using `useState` with a lazy initializer guarantees the
    // same DOM node is returned on every render, without triggering
    // React's "no ref reads during render" rule. The returned value is
    // never set again, so this is effectively an immutable identity.
    const [realTarget] = useState<HTMLDivElement | null>(() => {
        if (typeof document === 'undefined') return null;
        const div = document.createElement('div');
        div.style.cssText = 'width: 100%; height: 100%; position: absolute; top: 0; left: 0;';
        return div;
    });

    // Relocate the orphan div between home and the detached mount node.
    // Runs synchronously after DOM mutations so that the move happens
    // before paint — no flicker.
    useLayoutEffect(() => {
        if (!realTarget) return;
        const target: HTMLElement | null = detachedMountNode ?? homeRef.current;
        if (!target) return;
        if (realTarget.parentNode === target) return;
        try {
            target.appendChild(realTarget);
        } catch {
            // The current parent may already be gone (e.g., the popup
            // document was torn down by the user closing the window).
            // `appendChild` will remove the node from its current parent
            // as part of its normal operation — a throw here just means
            // the orphaned parent is already detached, so we can force
            // it by detaching first and retrying.
            try {
                realTarget.remove();
                target.appendChild(realTarget);
            } catch {
                /* give up silently — next effect run will try again */
            }
        }
    }, [detachedMountNode, realTarget]);

    // On unmount, detach the orphan div so it doesn't linger in the DOM.
    useLayoutEffect(() => {
        return () => {
            if (realTarget && realTarget.parentNode) {
                try { realTarget.remove(); } catch { /* ignore */ }
            }
        };
    }, [realTarget]);

    return (
        <>
            <div ref={homeRef} style={homeStyle} />
            {realTarget && createPortal(children, realTarget)}
        </>
    );
};

export default DetachableTabHost;
