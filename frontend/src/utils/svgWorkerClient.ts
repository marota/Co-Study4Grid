/**
 * Client for the SVG processing Web Worker.
 *
 * Provides a Promise-based API: `processSvgAsync(rawSvg, vlCount)`
 * that offloads the heavy DOMParser/XMLSerializer work to a worker thread.
 *
 * Falls back to synchronous processing if workers are unavailable.
 */

import type { ViewBox } from '../types';
import { processSvg } from './svgUtils';

interface PendingRequest {
    resolve: (result: { svg: string; viewBox: ViewBox | null }) => void;
}

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, PendingRequest>();

function getWorker(): Worker | null {
    if (worker) return worker;
    try {
        worker = new Worker(
            new URL('./svgProcessWorker.ts', import.meta.url),
            { type: 'module' },
        );
        worker.onmessage = (e: MessageEvent<{ id: number; svg: string; viewBox: ViewBox | null }>) => {
            const { id, svg, viewBox } = e.data;
            const req = pending.get(id);
            if (req) {
                pending.delete(id);
                req.resolve({ svg, viewBox });
            }
        };
        worker.onerror = () => {
            // If worker fails, resolve all pending with synchronous fallback
            worker = null;
        };
        return worker;
    } catch {
        return null;
    }
}

export const processSvgAsync = (
    rawSvg: string,
    vlCount: number,
): Promise<{ svg: string; viewBox: ViewBox | null }> => {
    const w = getWorker();
    if (!w) {
        // Synchronous fallback
        return Promise.resolve(processSvg(rawSvg, vlCount));
    }

    const id = nextId++;
    return new Promise(resolve => {
        pending.set(id, { resolve });
        w.postMessage({ id, rawSvg, vlCount });
    });
};
