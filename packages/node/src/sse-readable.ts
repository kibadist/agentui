import { randomUUID } from "node:crypto";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import type { AgentStream, AgentStreamOptions, EmitInput } from "./types.js";

export interface AgentReadable {
  readable: ReadableStream<Uint8Array>;
  stream: AgentStream;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

export function createAgentReadable(opts: AgentStreamOptions): AgentReadable {
  const encoder = new TextEncoder();
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  function stopHeartbeat() {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }

  const readable = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
      const ms = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
      if (ms > 0) {
        heartbeat = setInterval(() => {
          if (!closed) {
            try {
              controller.enqueue(encoder.encode(":\n\n"));
            } catch {
              closed = true;
              stopHeartbeat();
            }
          }
        }, ms);
        (heartbeat as unknown as { unref?: () => void }).unref?.();
      }
    },
    cancel() {
      closed = true;
      stopHeartbeat();
    },
  });

  function finalize(input: EmitInput): AgentWireEvent {
    const full = {
      v: 1 as const,
      id: input.id ?? randomUUID(),
      ts: input.ts ?? new Date().toISOString(),
      sessionId: opts.sessionId,
      ...(input.traceId !== undefined
        ? { traceId: input.traceId }
        : opts.traceId !== undefined
          ? { traceId: opts.traceId }
          : {}),
      ...input,
    } as AgentWireEvent;
    (full as { sessionId: string }).sessionId = opts.sessionId;
    (full as { v: 1 }).v = 1;
    return full;
  }

  function writeFrame(chunk: string) {
    if (closed) return;
    try {
      controller.enqueue(encoder.encode(chunk));
    } catch {
      closed = true;
      stopHeartbeat();
    }
  }

  const stream: AgentStream = {
    async emit(input) {
      if (closed) return;
      const event = finalize(input);
      writeFrame(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      opts.onEventEmitted?.(event);
      if (opts.conversation) {
        await opts.conversation.append(opts.sessionId, event);
      }
    },
    async comment(text) {
      if (closed) return;
      writeFrame(`: ${text.replace(/\n/g, " ")}\n\n`);
    },
    async close() {
      if (closed) return;
      closed = true;
      stopHeartbeat();
      try {
        controller.close();
      } catch {
        // Already closed
      }
    },
    get closed() {
      return closed;
    },
  };

  return { readable, stream };
}
