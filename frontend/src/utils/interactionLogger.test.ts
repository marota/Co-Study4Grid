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

    it('tracks multiple concurrent async operations with distinct correlation IDs', () => {
        const corr1 = interactionLogger.record('analysis_step1_started', { element: 'LINE_A' });
        const corr2 = interactionLogger.record('analysis_step2_started', { selected_overloads: ['OL1'] });

        expect(corr1).not.toBe(corr2);

        const startTs = new Date().toISOString();
        interactionLogger.recordCompletion('analysis_step2_completed', corr2, { actions_count: 5 }, startTs);
        interactionLogger.recordCompletion('analysis_step1_completed', corr1, { overloads_detected: 3 }, startTs);

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(4);
        expect(log[2].correlation_id).toBe(corr2);
        expect(log[2].type).toBe('analysis_step2_completed');
        expect(log[3].correlation_id).toBe(corr1);
        expect(log[3].type).toBe('analysis_step1_completed');
    });

    it('supports all 34 interaction types without error', () => {
        const allTypes: import('../types').InteractionType[] = [
            'config_loaded', 'settings_opened', 'settings_tab_changed',
            'settings_applied', 'settings_cancelled', 'path_picked',
            'contingency_selected', 'contingency_confirmed',
            'analysis_step1_started', 'analysis_step1_completed',
            'overload_toggled', 'analysis_step2_started', 'analysis_step2_completed',
            'prioritized_actions_displayed',
            'action_selected', 'action_deselected', 'action_favorited',
            'action_unfavorited', 'action_rejected', 'action_unrejected',
            'manual_action_simulated',
            'combine_modal_opened', 'combine_modal_closed',
            'combine_pair_toggled', 'combine_pair_estimated', 'combine_pair_simulated',
            'diagram_tab_changed', 'view_mode_changed', 'voltage_range_changed',
            'asset_clicked', 'zoom_in', 'zoom_out', 'zoom_reset',
            'inspect_query_changed',
            'sld_overlay_opened', 'sld_overlay_tab_changed', 'sld_overlay_closed',
            'session_saved', 'session_reload_modal_opened', 'session_reloaded',
        ];

        for (const t of allTypes) {
            interactionLogger.record(t, { test: true });
        }

        const log = interactionLogger.getLog();
        expect(log).toHaveLength(allTypes.length);
        allTypes.forEach((t, i) => {
            expect(log[i].type).toBe(t);
        });
    });

    it('getLog entries are JSON-serializable', () => {
        interactionLogger.record('config_loaded', { path: '/data/net.xiidm', nested: { a: 1 } });
        interactionLogger.record('zoom_in');
        const startTs = new Date().toISOString();
        const corrId = interactionLogger.record('analysis_step1_started');
        interactionLogger.recordCompletion('analysis_step1_completed', corrId, { count: 3 }, startTs);

        const log = interactionLogger.getLog();
        const json = JSON.stringify(log);
        const parsed = JSON.parse(json);
        expect(parsed).toHaveLength(4);
        expect(parsed[0].type).toBe('config_loaded');
        expect(parsed[0].details.nested.a).toBe(1);
        expect(parsed[3].duration_ms).toBeGreaterThanOrEqual(0);
    });

    it('preserves complex detail objects including arrays and nested data', () => {
        interactionLogger.record('analysis_step2_started', {
            selected_overloads: ['LINE_A', 'LINE_B'],
            monitor_deselected: false,
            config: { factor: 0.95, threshold: 0.02 },
        });

        const entry = interactionLogger.getLog()[0];
        expect(entry.details.selected_overloads).toEqual(['LINE_A', 'LINE_B']);
        expect(entry.details.monitor_deselected).toBe(false);
        expect((entry.details.config as Record<string, unknown>).factor).toBe(0.95);
    });

    it('duration_ms is positive for recordCompletion with real time gap', async () => {
        const startTs = new Date().toISOString();
        const corrId = interactionLogger.record('analysis_step1_started');

        // Use fake timers to simulate 250ms delay
        vi.useFakeTimers();
        vi.advanceTimersByTime(250);

        interactionLogger.recordCompletion('analysis_step1_completed', corrId, {}, startTs);
        vi.useRealTimers();

        const log = interactionLogger.getLog();
        expect(log[1].duration_ms).toBeGreaterThanOrEqual(200);
    });

    it('seq continues incrementing across record and recordCompletion calls', () => {
        const startTs = new Date().toISOString();
        interactionLogger.record('zoom_in');                              // seq 0
        interactionLogger.record('zoom_out');                             // seq 1
        const corrId = interactionLogger.record('analysis_step1_started'); // seq 2
        interactionLogger.recordCompletion('analysis_step1_completed', corrId, {}, startTs); // seq 3
        interactionLogger.record('zoom_reset');                           // seq 4

        const log = interactionLogger.getLog();
        expect(log.map(e => e.seq)).toEqual([0, 1, 2, 3, 4]);
    });
});
