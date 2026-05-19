import type { AgentWireEvent, ActionEvent } from "@kibadist/agentui-protocol";

export type StoredEvent = AgentWireEvent | ActionEvent;

export interface ConversationStorage {
  append(sessionId: string, event: StoredEvent): Promise<void>;
  history(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<StoredEvent[]>;
}

export interface ConversationOptions {
  storage: ConversationStorage;
  onConversationAppended?: (sessionId: string, event: StoredEvent) => void;
}

export class Conversation {
  private readonly storage: ConversationStorage;
  private readonly onAppend?: (sessionId: string, event: StoredEvent) => void;

  constructor(opts: ConversationOptions) {
    this.storage = opts.storage;
    this.onAppend = opts.onConversationAppended;
  }

  async append(sessionId: string, event: StoredEvent): Promise<void> {
    await this.storage.append(sessionId, event);
    this.onAppend?.(sessionId, event);
  }

  history(
    sessionId: string,
    opts?: { limit?: number; before?: string },
  ): Promise<StoredEvent[]> {
    return this.storage.history(sessionId, opts);
  }
}
