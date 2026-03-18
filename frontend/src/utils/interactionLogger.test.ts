import { describe, it, expect, beforeEach, vi } from 'vitest';
import { interactionLogger } from './interactionLogger';

describe('interactionLogger', () => {
    beforeEach(() => {
        interactionLogger.clear();
    });

    it('records entries with incrementing seq and correct type', () => {
        interactionLogger.record('config_loaded', { network_path: '/data/net.xiidm' });
        interactionLogger.record('contingency_selected', { element: 'LINE_A' });

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(2);
        expect(log[0].seq).toBe(0);
        expect(log[0].type).toBe('config_loaded');
        expect(log[0].details).toEqual({ network_path: '/data/net.xiidm' });
        expect(log[1].seq).toBe(1);
        expect(log[1].type).toBe('contingency_selected');
    });

    it('assigns ISO timestamps to entries', () => {
        interactionLogger.record('zoom_in');
        const log = interactionLogger.getLog();
        // Should be a valid ISO date string
        expect(() => new Date(log[0].timestamp)).not.toThrow();
        expect(new Date(log[0].timestamp).toISOString()).toBe(log[0].timestamp);
    });

    it('returns a correlation_id from record()', () => {
        const corrId = interactionLogger.record('analysis_step1_started', { element: 'LINE_X' });
        expect(typeof corrId).toBe('string');
        expect(corrId.length).toBeGreaterThan(0);

        const log = interactionLogger.getLog();
        expect(log[0].correlation_id).toBe(corrId);
    });

    it('accepts a custom correlation_id', () => {
        const customId = 'my-custom-id';
        const returned = interactionLogger.record('overload_toggled', {}, customId);
        expect(returned).toBe(customId);
        expect(interactionLogger.getLog()[0].correlation_id).toBe(customId);
    });

    it('recordCompletion links to correlation_id and computes duration_ms', () => {
        const startTs = new Date().toISOString();
        const corrId = interactionLogger.record('analysis_step1_started', { element: 'L1' });

        // Simulate a small delay
        vi.useFakeTimers();
        vi.advanceTimersByTime(500);

        interactionLogger.recordCompletion('analysis_step1_completed', corrId, {
            overloads_found: ['OL1', 'OL2'],
        }, startTs);

        vi.useRealTimers();

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(2);
        expect(log[1].correlation_id).toBe(corrId);
        expect(log[1].type).toBe('analysis_step1_completed');
        expect(log[1].duration_ms).toBeGreaterThanOrEqual(0);
        expect(log[1].details).toEqual({ overloads_found: ['OL1', 'OL2'] });
    });

    it('getLog returns a copy, not a reference', () => {
        interactionLogger.record('zoom_in');
        const log1 = interactionLogger.getLog();
        const log2 = interactionLogger.getLog();
        expect(log1).not.toBe(log2);
        expect(log1).toEqual(log2);
    });

    it('clear() empties the log and resets seq counter', () => {
        interactionLogger.record('action_favorited', { action_id: 'a1' });
        interactionLogger.record('action_rejected', { action_id: 'a2' });
        expect(interactionLogger.getLog()).toHaveLength(2);

        interactionLogger.clear();
        expect(interactionLogger.getLog()).toHaveLength(0);

        // Seq should reset
        interactionLogger.record('zoom_reset');
        expect(interactionLogger.getLog()[0].seq).toBe(0);
    });

    it('maintains insertion order across many records', () => {
        const types = [
            'config_loaded', 'contingency_selected', 'analysis_step1_started',
            'overload_toggled', 'action_selected', 'diagram_tab_changed',
        ] as const;

        for (const t of types) {
            interactionLogger.record(t);
        }

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(types.length);
        types.forEach((t, i) => {
            expect(log[i].type).toBe(t);
            expect(log[i].seq).toBe(i);
        });
    });

    it('defaults details to empty object when not provided', () => {
        interactionLogger.record('sld_overlay_closed');
        expect(interactionLogger.getLog()[0].details).toEqual({});
    });
});
