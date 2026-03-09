/**
 * Web Worker for off-main-thread SVG processing.
 *
 * Receives raw SVG strings and applies the boostSvgForLargeGrid transform
 * (DOMParser + querySelectorAll + XMLSerializer) without blocking the UI.
 */

interface WorkerRequest {
    id: number;
    rawSvg: string;
    vlCount: number;
}

interface WorkerResponse {
    id: number;
    svg: string;
    viewBox: { x: number; y: number; w: number; h: number } | null;
}

function parseViewBox(svgString: string): { x: number; y: number; w: number; h: number } | null {
    const match = svgString.match(/viewBox=["']([^"']+)["']/);
    if (!match) return null;
    const parts = match[1].split(/\s+|,/).map(parseFloat);
    if (parts.length === 4) return { x: parts[0], y: parts[1], w: parts[2], h: parts[3] };
    return null;
}

function boostSvgForLargeGrid(
    svgString: string,
    viewBox: { x: number; y: number; w: number; h: number } | null,
    vlCount: number,
): string {
    if (!viewBox) return svgString;
    if (!vlCount || vlCount < 500) return svgString;

    const diagramSize = Math.max(viewBox.w, viewBox.h);
    const REFERENCE_SIZE = 1250;
    const BOOST_THRESHOLD = 3;
    const ratio = diagramSize / REFERENCE_SIZE;
    if (ratio <= BOOST_THRESHOLD) return svgString;

    const boost = Math.sqrt(ratio / BOOST_THRESHOLD);

    const parser = new DOMParser();
    const doc = parser.parseFromString(svgString, 'image/svg+xml');
    const svgEl = doc.documentElement;

    if (ratio > 6) {
        svgEl.setAttribute('data-large-grid', 'true');
    }

    // 1. Scale CSS values in <style> blocks
    const styles = svgEl.querySelectorAll('style');
    styles.forEach(style => {
        let css = style.textContent || '';
        css = css.replace(/font:\s*25px\s+serif/, `font: ${Math.round(25 * boost)}px serif`);
        css = css.replace(
            'padding: 10px; border-radius: 10px;',
            `padding: ${Math.round(10 * boost)}px; border-radius: ${Math.round(10 * boost)}px;`,
        );
        css = css.replace(
            'margin-right: 10px; width: 20px; height: 20px;',
            `margin-right: ${Math.round(10 * boost)}px; width: ${Math.round(20 * boost)}px; height: ${Math.round(20 * boost)}px;`,
        );
        style.textContent = css;
    });

    // 2. Scale node groups (circles + inner bus sectors/paths)
    const scaledGroups = new Set<Element>();
    svgEl.querySelectorAll('circle').forEach(circle => {
        const g = circle.parentElement;
        if (!g || g.tagName !== 'g' || scaledGroups.has(g)) return;
        if (g.querySelector('foreignObject')) return;
        scaledGroups.add(g);
        const cx = parseFloat(circle.getAttribute('cx') || '0');
        const cy = parseFloat(circle.getAttribute('cy') || '0');
        const t = g.getAttribute('transform') || '';
        g.setAttribute('transform',
            `${t} translate(${cx},${cy}) scale(${boost.toFixed(2)}) translate(${-cx},${-cy})`);
    });

    // 3. Scale edge-info group transforms (flow arrows + values)
    const edgeInfoGroup = svgEl.querySelector('.nad-edge-infos');
    if (edgeInfoGroup) {
        edgeInfoGroup.querySelectorAll(':scope > g[transform]').forEach(g => {
            const t = g.getAttribute('transform');
            if (t && t.includes('translate(') && !t.includes('scale(')) {
                g.setAttribute('transform', t + ` scale(${boost.toFixed(2)})`);
            }
        });
    }

    return new XMLSerializer().serializeToString(svgEl);
}

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
    const { id, rawSvg, vlCount } = e.data;
    const viewBox = parseViewBox(rawSvg);
    const svg = boostSvgForLargeGrid(rawSvg, viewBox, vlCount);
    const response: WorkerResponse = { id, svg, viewBox };
    self.postMessage(response);
};
