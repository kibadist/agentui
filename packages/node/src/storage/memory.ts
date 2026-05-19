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
      const cutoff = opts.before;
      result = result.filter((e) => e.ts < cutoff);
    }
    if (opts?.limit !== undefined) {
      result = result.slice(0, opts.limit);
    }
    return result.slice();
  }
}
