import { describe, it, expect } from 'vitest';
import { processSvgAsync } from './svgWorkerClient';

describe('processSvgAsync', () => {
    it('extracts viewBox from SVG string', async () => {
        const svg = '<svg viewBox="0 10 800 600"><rect/></svg>';
        const result = await processSvgAsync(svg, 10);
        expect(result.viewBox).toEqual({ x: 0, y: 10, w: 800, h: 600 });
    });

    it('returns null viewBox when not present', async () => {
        const svg = '<svg><rect/></svg>';
        const result = await processSvgAsync(svg, 10);
        expect(result.viewBox).toBeNull();
    });

    it('returns svg string', async () => {
        const svg = '<svg viewBox="0 0 100 100"><rect/></svg>';
        const result = await processSvgAsync(svg, 10);
        expect(result.svg).toContain('<svg');
    });

    it('does not boost small grids', async () => {
        const svg = '<svg viewBox="0 0 1000 1000"><text>hello</text></svg>';
        const result = await processSvgAsync(svg, 100);
        // Small grid (100 VLs < 500 threshold) — should not boost
        expect(result.svg).not.toContain('data-large-grid');
    });

    it('handles viewBox with commas', async () => {
        const svg = '<svg viewBox="0,0,500,400"><rect/></svg>';
        const result = await processSvgAsync(svg, 10);
        expect(result.viewBox).toEqual({ x: 0, y: 0, w: 500, h: 400 });
    });
});
