import type { InteractionType, InteractionLogEntry } from '../types';

class InteractionLogger {
    private log: InteractionLogEntry[] = [];
    private seq = 0;

    /**
     * Record a user interaction event.
     * Returns a correlation_id that can be passed to recordCompletion()
     * for async start/complete pairs.
     */
    record(
        type: InteractionType,
        details: Record<string, unknown> = {},
        correlationId?: string,
    ): string {
        const id = correlationId ?? crypto.randomUUID();
        this.log.push({
            seq: this.seq++,
            timestamp: new Date().toISOString(),
            type,
            details,
            correlation_id: id,
        });
        return id;
    }

    /**
     * Record the completion of an async operation, linking it to its
     * start event via correlation_id and computing duration_ms.
     */
    recordCompletion(
        type: InteractionType,
        correlationId: string,
        details: Record<string, unknown>,
        startTimestamp: string,
    ): void {
        this.log.push({
            seq: this.seq++,
            timestamp: new Date().toISOString(),
            type,
            details,
            correlation_id: correlationId,
            duration_ms: Date.now() - new Date(startTimestamp).getTime(),
        });
    }

    /** Return a shallow copy of the log (safe to serialize). */
    getLog(): InteractionLogEntry[] {
        return [...this.log];
    }

    /** Clear all entries and reset the sequence counter. */
    clear(): void {
        this.log = [];
        this.seq = 0;
    }
}

export const interactionLogger = new InteractionLogger();
