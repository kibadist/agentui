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
        if (closed || res.destroyed) return;
        try {
          res.write(":\n\n");
        } catch {
          onClientClose();
        }
      }, ms);
      // Don't keep the event loop alive solely for the heartbeat.
      (heartbeat as unknown as { unref?: () => void }).unref?.();
    }
  }

  // Serialize writes so concurrent emit() calls preserve FIFO order even
  // when an earlier write parks on 'drain' for backpressure.
  // Returns true if the chunk was handed to the wire, false if dropped because
  // the stream was already closed/destroyed.
  let writeChain: Promise<boolean> = Promise.resolve(true);
  function writeChunk(chunk: string): Promise<boolean> {
    const next = writeChain.then(async () => {
      if (closed || res.destroyed) {
        closed = true;
        return false;
      }
      const ok = res.write(chunk);
      if (ok) return true;
      await new Promise<void>((resolve) => {
        res.on("drain", resolve);
      });
      return true;
    });
    // Swallow rejections on the chain itself so one failure doesn't poison
    // subsequent writes; the caller still sees their own rejection.
    writeChain = next.catch(() => false);
    return next;
  }

  function buildFrame(event: AgentWireEvent): string {
    return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
  }

  function finalize(input: EmitInput): AgentWireEvent {
    // Authoritative fields (v, sessionId) come AFTER the spread so callers
    // can't smuggle in conflicting values. id/ts/traceId remain overridable
    // via the explicit assignments above the spread.
    return {
      id: input.id ?? randomUUID(),
      ts: input.ts ?? new Date().toISOString(),
      ...(input.traceId !== undefined
        ? { traceId: input.traceId }
        : opts.traceId !== undefined
          ? { traceId: opts.traceId }
          : {}),
      ...input,
      v: 1 as const,
      sessionId: opts.sessionId,
    } as AgentWireEvent;
  }

  return {
    async emit(input) {
      if (closed || res.destroyed) return;
      ensureHeaders();
      const event = finalize(input);
      const written = await writeChunk(buildFrame(event));
      if (!written) return;
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
