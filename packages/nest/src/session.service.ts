import { Subject, type Observable } from "rxjs";
import type { UIEvent, ActionEvent } from "@agentui/protocol";

export interface SessionEntry {
  ui$: Subject<UIEvent>;
  action$: Subject<ActionEvent>;
  createdAt: number;
}

/**
 * In-memory session event bus.
 * For v1 this is sufficient; swap to Redis pub/sub for horizontal scaling.
 */
export class AgentSessionService {
  private sessions = new Map<string, SessionEntry>();
  private ttlMs: number;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(opts?: { ttlMs?: number }) {
    this.ttlMs = opts?.ttlMs ?? 30 * 60 * 1000; // 30 min default
  }

  /** Start periodic cleanup of expired sessions */
  startCleanup(intervalMs = 60_000) {
    this.cleanupTimer = setInterval(() => this.cleanup(), intervalMs);
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
    const entry: SessionEntry = {
      ui$: new Subject<UIEvent>(),
      action$: new Subject<ActionEvent>(),
      createdAt: Date.now(),
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
    entry.ui$.next(event);
  }

  /** Push an action into a session (for agent consumption) */
  emitAction(sessionId: string, action: ActionEvent): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) throw new Error(`Session not found: ${sessionId}`);
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
      if (now - entry.createdAt > this.ttlMs) {
        this.destroy(id);
      }
    }
  }
}
