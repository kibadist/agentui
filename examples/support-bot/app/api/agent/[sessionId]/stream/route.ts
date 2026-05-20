import type { NextRequest } from "next/server";

type StreamCtx = { params: Promise<{ sessionId: string }> };

const subscribers = new Map<string, Set<(chunk: string) => void>>();

export function subscribe(sessionId: string, push: (chunk: string) => void) {
  let set = subscribers.get(sessionId);
  if (!set) {
    set = new Set();
    subscribers.set(sessionId, set);
  }
  set.add(push);
  return () => {
    set?.delete(push);
    if (set?.size === 0) subscribers.delete(sessionId);
  };
}

export function publish(sessionId: string, event: unknown): void {
  const frame = `id: ${(event as { id: string }).id}\ndata: ${JSON.stringify(event)}\n\n`;
  subscribers.get(sessionId)?.forEach((push) => push(frame));
}

export async function GET(_req: NextRequest, ctx: StreamCtx) {
  const { sessionId } = await ctx.params;
  const encoder = new TextEncoder();

  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const push = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          /* closed */
        }
      };
      unsubscribe = subscribe(sessionId, push);
    },
    cancel() {
      unsubscribe?.();
      unsubscribe = null;
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
