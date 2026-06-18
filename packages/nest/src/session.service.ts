import { Subject, type Observable } from "rxjs";
import type { UIEvent, ActionEvent } from "@kibadist/agentui-protocol";

export interface SessionEntry {
  ui$: Subject<UIEvent>;
  action$: Subject<ActionEvent>;
  createdAt: number;
  /**
   * Timestamp of the last event in either direction. Sessions expire after
   * `ttlMs` of *inactivity* (not age), so a long-lived but actively-streaming
   * session is never evicted mid-stream.
   */
  lastActivityAt: number;
}

/**
 * In-memory session event bus.
 * For v1 this is sufficient; swap to Redis pub/sub for horizontal scaling.
 */
export class AgentSessionService {
  private sessions = new Map<string, SessionEntry>();
  private ttlMs: number;
  private cleanupIntervalMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: {
    ttlMs?: number;
    cleanupIntervalMs?: number;
    /**
     * Auto-start the periodic cleanup sweep on construction (default `true`).
     * The sweep timer is `unref`-ed so it never keeps the Node process alive.
     * Set to `false` if you want to drive cleanup manually via
     * {@link startCleanup}.
     */
    autoCleanup?: boolean;
  }) {
    this.ttlMs = opts?.ttlMs ?? 30 * 60 * 1000; // 30 min default
    this.cleanupIntervalMs = opts?.cleanupIntervalMs ?? 60_000;
    if (opts?.autoCleanup !== false) {
      this.startCleanup(this.cleanupIntervalMs);
    }
  }

  /** Start periodic cleanup of expired sessions (safe to call multiple times) */
  startCleanup(intervalMs = this.cleanupIntervalMs) {
    if (this.cleanupTimer) return;
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
    // Don't keep the event loop alive solely for the cleanup sweep.
    (this.cleanupTimer as unknown as { unref?: () => void }).unref?.();
  }

  stopCleanup() {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  create(sessionId: string): SessionEntry {
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)!;
    }
    const now = Date.now();
    const entry: SessionEntry = {
      ui$: new Subject<UIEvent>(),
      action$: new Subject<ActionEvent>(),
      createdAt: now,
      lastActivityAt: now,
    };
    this.sessions.set(sessionId, entry);
    return entry;
  }

  get(sessionId: string): SessionEntry | undefined {
    return this.sessions.get(sessionId);
  }

  /** Push a UI event into a session's stream */
  emitUI(sessionId: string, event: UIEvent): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Session not found: ${sessionId}`);
    entry.lastActivityAt = Date.now();
    entry.ui$.next(event);
  }

  /** Push an action into a session (for agent consumption) */
  emitAction(sessionId: string, action: ActionEvent): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Session not found: ${sessionId}`);
    entry.lastActivityAt = Date.now();
    entry.action$.next(action);
  }

  /** Observable of UI events for SSE streaming */
  uiStream(sessionId: string): Observable<UIEvent> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Session not found: ${sessionId}`);
    return entry.ui$.asObservable();
  }

  /** Observable of actions (for agent to subscribe to) */
  actionStream(sessionId: string): Observable<ActionEvent> {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Session not found: ${sessionId}`);
    return entry.action$.asObservable();
  }

  destroy(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (entry) {
      entry.ui$.complete();
      entry.action$.complete();
      this.sessions.delete(sessionId);
    }
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.sessions) {
      if (now - entry.lastActivityAt > this.ttlMs) {
        this.destroy(id);
      }
    }
  }
}
