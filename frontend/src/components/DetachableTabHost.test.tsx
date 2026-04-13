// Copyright (c) 2025-2026, RTE (https://www.rte-france.com)
// This Source Code Form is subject to the terms of the Mozilla Public License, version 2.0.
// If a copy of the Mozilla Public License, version 2.0 was not distributed with this file,
// you can obtain one at http://mozilla.org/MPL/2.0/.
// SPDX-License-Identifier: MPL-2.0
// This file is part of Co-Study4Grid a Power Grid Study tool Assistant Interface to help solve contigencies for a grid state under study.

import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useLayoutEffect, useRef } from 'react';
import DetachableTabHost from './DetachableTabHost';

/**
 * Regression tests for the four detachable-tab bugs that motivated the
 * stable-portal-target + imperative DOM move refactor:
 *
 *   1. Detached window is frozen (no wheel/drag/focus).
 *   2. Detached window does not inherit the pre-detach zoom.
 *   3. Reattach blanks out other tabs in the main window.
 *   4. Reattached tab loses pan/zoom interactions.
 *
 * The root cause of all four was that `createPortal` with a changing
 * target unmounts and remounts the sub-tree, which destroyed:
 *   - the pan/zoom container ref (so `usePanZoom`'s captured `el` was
 *     stale),
 *   - the SVG element that had been injected by MemoizedSvgContainer,
 *   - and on reattach, caused React to try to unmount children from an
 *     about-to-be-closed popup document (blanking other tabs).
 *
 * These tests prove that `DetachableTabHost` does NOT remount the
 * sub-tree across detach/reattach, and that any DOM nodes / refs held
 * by children are the exact same objects before and after the move.
 * That property is what preserves the SVG viewBox attribute, pan/zoom
 * listeners, and every other piece of state that depends on the
 * container div's identity.
 */
/**
 * A tiny child component that records every mount, every layout
 * effect run, and every DOM element identity it has been rendered
 * into. Used to assert sub-tree stability.
 *
 * The probe state lives in a module-level mutable object rather
 * than being passed through props, because the React compiler
 * (react-hooks/immutability rule) forbids mutating component
 * props — and this probe's entire purpose is to be mutated from
 * inside a hook.
 */
interface Probe {
    mounts: number;
    layoutEffects: number;
    dom: HTMLSpanElement | null;
}

const probe: Probe = { mounts: 0, layoutEffects: 0, dom: null };

const resetProbe = () => {
    probe.mounts = 0;
    probe.layoutEffects = 0;
    probe.dom = null;
};

const ProbeChild = () => {
    const ref = useRef<HTMLSpanElement>(null);
    // useLayoutEffect with empty deps only re-runs if the component
    // remounts. Counting invocations is our "is the sub-tree stable"
    // check.
    useLayoutEffect(() => {
        probe.mounts += 1;
        probe.dom = ref.current;
    }, []);
    // A second layout effect runs on every render — used to verify
    // that "rerender" without remount still updates children.
    useLayoutEffect(() => {
        probe.layoutEffects += 1;
    });
    return <span ref={ref} data-testid="probe-child">probe</span>;
};

describe('DetachableTabHost', () => {
    beforeEach(() => {
        resetProbe();
    });

    it('renders children in a placeholder div in the main tree by default', () => {
        
        const { container, getByTestId } = render(
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
            </DetachableTabHost>
        );
        expect(probe.mounts).toBe(1);
        // The placeholder div exists and the probe's DOM is somewhere
        // inside the rendered tree.
        expect(container.querySelector('[data-testid="probe-child"]')).not.toBeNull();
        expect(getByTestId('probe-child').textContent).toBe('probe');
    });

    it('moves children into detachedMountNode without remounting the sub-tree (Bug 1, 2, 4)', () => {
        
        const popup = document.createElement('div');
        popup.id = 'fake-popup-mount';
        document.body.appendChild(popup);

        const { rerender } = render(
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
            </DetachableTabHost>
        );
        expect(probe.mounts).toBe(1);
        const originalDom = probe.dom;
        expect(originalDom).not.toBeNull();

        // Detach: pass the popup mount node.
        rerender(
            <DetachableTabHost detachedMountNode={popup}>
                <ProbeChild />
            </DetachableTabHost>
        );

        // Critical assertion: the child was NOT remounted. If it had
        // been, `mounts` would be 2 (old unmount + new mount), and
        // `dom` would be a different element. Both invariants are
        // what preserves the SVG container ref and its attached
        // event listeners across the detach round-trip.
        expect(probe.mounts).toBe(1);
        expect(probe.dom).toBe(originalDom);

        // And the child's DOM is now *physically* inside the popup
        // mount node, meaning viewBox state carried by the probe's
        // element travels with it.
        expect(popup.contains(originalDom!)).toBe(true);

        document.body.removeChild(popup);
    });

    it('moves children back to the main tree on reattach without remounting (Bug 3, 4)', () => {
        
        const popup = document.createElement('div');
        popup.id = 'fake-popup-mount';
        document.body.appendChild(popup);

        // Start detached.
        const { rerender, container } = render(
            <DetachableTabHost detachedMountNode={popup}>
                <ProbeChild />
            </DetachableTabHost>
        );
        expect(probe.mounts).toBe(1);
        const originalDom = probe.dom;
        expect(popup.contains(originalDom!)).toBe(true);

        // Reattach: pass null for the mount node.
        rerender(
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
            </DetachableTabHost>
        );

        // Critical: still one mount, same DOM element.
        expect(probe.mounts).toBe(1);
        expect(probe.dom).toBe(originalDom);
        // And it's now back inside the main-window placeholder.
        expect(popup.contains(originalDom!)).toBe(false);
        expect(container.contains(originalDom!)).toBe(true);

        document.body.removeChild(popup);
    });

    it('handles rapid detach → reattach → detach without remounting (Bug 2, 4)', () => {
        
        const popup = document.createElement('div');
        document.body.appendChild(popup);

        const { rerender } = render(
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
            </DetachableTabHost>
        );
        const originalDom = probe.dom;

        for (let i = 0; i < 5; i++) {
            rerender(
                <DetachableTabHost detachedMountNode={popup}>
                    <ProbeChild />
                </DetachableTabHost>
            );
            rerender(
                <DetachableTabHost detachedMountNode={null}>
                    <ProbeChild />
                </DetachableTabHost>
            );
        }

        // No matter how many round-trips, the sub-tree is never
        // remounted. Same DOM identity, same mount count.
        expect(probe.mounts).toBe(1);
        expect(probe.dom).toBe(originalDom);

        document.body.removeChild(popup);
    });

    it('uses the same createPortal target DOM node across re-renders (Bug 2)', () => {
        
        const { rerender, container } = render(
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
            </DetachableTabHost>
        );
        // The orphan div that DetachableTabHost creates is appended as
        // a child of the home placeholder. Capture that node and
        // verify it is still the exact same node after a re-render.
        const probeEl = container.querySelector('[data-testid="probe-child"]')!;
        const orphanDiv = probeEl.parentNode;
        expect(orphanDiv).not.toBeNull();

        rerender(
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
            </DetachableTabHost>
        );

        const probeElAfter = container.querySelector('[data-testid="probe-child"]')!;
        expect(probeElAfter.parentNode).toBe(orphanDiv);
    });

    it('removes its orphan div from the DOM on unmount so it does not linger', () => {
        
        const { container, unmount } = render(
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
            </DetachableTabHost>
        );
        const probeEl = container.querySelector('[data-testid="probe-child"]')!;
        const orphanDiv = probeEl.parentNode as HTMLElement;

        unmount();

        // After unmount the orphan div has no parent — it has been
        // detached. (The container itself is gone because
        // testing-library unmounts the root.)
        expect(orphanDiv.parentNode).toBeNull();
    });

    it('updates children on rerender without unmounting them', () => {
        
        const Wrapper = ({ label }: { label: string }) => (
            <DetachableTabHost detachedMountNode={null}>
                <ProbeChild />
                <span data-testid="label">{label}</span>
            </DetachableTabHost>
        );
        const { rerender, container } = render(<Wrapper label="one" />);
        expect(container.querySelector('[data-testid="label"]')?.textContent).toBe('one');

        rerender(<Wrapper label="two" />);
        // The ProbeChild was not remounted (mounts still 1), but the
        // sibling label DID update — proving that React is still
        // reconciling children through the stable portal.
        expect(probe.mounts).toBe(1);
        expect(container.querySelector('[data-testid="label"]')?.textContent).toBe('two');
    });
});
