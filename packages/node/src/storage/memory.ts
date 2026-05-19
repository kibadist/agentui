import type { ConversationStorage, StoredEvent } from "../conversation.js";

export class MemoryConversationStorage implements ConversationStorage {
  private readonly store = new Map<string, StoredEvent[]>();

  async append(sessionId: string, event: StoredEvent): Promise<void> {
    const list = this.store.get(sessionId);
    if (list) {
      list.push(event);
    } else {
      this.store.set(sessionId, [event]);
    }
  }

  async history(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<StoredEvent[]> {
    const list = this.store.get(sessionId);
    if (!list) return [];
    let result: StoredEvent[] = list;
    if (opts?.before) {
      // Compare as parsed timestamps — lexicographic compare on ISO strings
      // only equals chronological compare when both sides use the same
      // timezone formatting (e.g. both `Z`). Callers may pass offset-form
      // ISO strings (e.g. `+03:00`), so normalize via Date.parse.
      const cutoffMs = Date.parse(opts.before);
      result = result.filter((e) => Date.parse(e.ts) < cutoffMs);
    }
    if (opts?.limit !== undefined) {
      result = result.slice(0, opts.limit);
    }
    return result.slice();
  }
}
