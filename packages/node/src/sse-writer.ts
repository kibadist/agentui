import { randomUUID } from "node:crypto";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import type { AgentStream, AgentStreamOptions, EmitInput } from "./types.js";

/**
 * Structural subset of node:http ServerResponse — works with Express, Fastify .raw, raw http.
 */
export interface NodeServerResponse {
  writeHead(statusCode: number, headers: Record<string, string>): unknown;
  write(chunk: string): boolean;
  end(): unknown;
  on(event: "drain" | "close" | "error", listener: () => void): unknown;
  readonly destroyed?: boolean;
}

const DEFAULT_HEARTBEAT_MS = 15_000;

const BASE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no",
};

export function createAgentStream(
  res: NodeServerResponse,
  opts: AgentStreamOptions,
): AgentStream {
  let headersWritten = false;
  let closed = false;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const onClientClose = () => {
    closed = true;
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  };
  res.on("close", onClientClose);
  res.on("error", onClientClose);

  function ensureHeaders() {
    if (headersWritten) return;
    headersWritten = true;
    const merged: Record<string, string> = { ...BASE_HEADERS, ...(opts.headers ?? {}) };
    res.writeHead(200, merged);
    const ms = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    if (ms > 0) {
      heartbeat = setInterval(() => {
        if (!closed) {
          res.write(":\n\n");
        }
      }, ms);
      // Don't keep the event loop alive solely for the heartbeat.
      (heartbeat as unknown as { unref?: () => void }).unref?.();
    }
  }

  // Serialize writes so concurrent emit() calls preserve FIFO order even
  // when an earlier write parks on 'drain' for backpressure.
  let writeChain: Promise<void> = Promise.resolve();
  function writeChunk(chunk: string): Promise<void> {
    const next = writeChain.then(async () => {
      if (closed || res.destroyed) {
        closed = true;
        return;
      }
      const ok = res.write(chunk);
      if (ok) return;
      await new Promise<void>((resolve) => {
        res.on("drain", resolve);
      });
    });
    // Swallow rejections on the chain itself so one failure doesn't poison
    // subsequent writes; the caller still sees their own rejection.
    writeChain = next.catch(() => {});
    return next;
  }

  function buildFrame(event: AgentWireEvent): string {
    return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
  }

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
    // Re-stamp authoritative fields in case `input` smuggled in a sessionId.
    (full as { sessionId: string }).sessionId = opts.sessionId;
    (full as { v: 1 }).v = 1;
    return full;
  }

  return {
    async emit(input) {
      ensureHeaders();
      const event = finalize(input);
      await writeChunk(buildFrame(event));
      opts.onEventEmitted?.(event);
      if (opts.conversation) {
        await opts.conversation.append(opts.sessionId, event);
      }
    },
    async comment(text) {
      ensureHeaders();
      const safe = text.replace(/\n/g, " ");
      await writeChunk(`: ${safe}\n\n`);
    },
    async close() {
      if (closed) return;
      closed = true;
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (!res.destroyed) {
        res.end();
      }
    },
    get closed() {
      return closed;
    },
  };
}
