export interface SSEProxyOptions {
  /** Base URL of the NestJS backend, e.g. "http://localhost:3001" */
  targetUrl: string;
  /** Optional: add headers (e.g. auth tokens) to the proxied request */
  getHeaders?: (req: Request) => Record<string, string> | Promise<Record<string, string>>;
  /** Timeout in ms for the initial upstream connection (default: 10000) */
  connectTimeoutMs?: number;
}

/**
 * Creates a Next.js App Router GET handler that proxies SSE from the Nest backend.
 *
 * Usage in app/api/agent/[sessionId]/stream/route.ts:
 *   export const GET = createSSEProxyHandler({ targetUrl: "http://localhost:3001" });
 */
export function createSSEProxyHandler(opts: SSEProxyOptions) {
  return async (req: Request, { params }: { params: Promise<{ sessionId: string }> }) => {
    const { sessionId } = await params;
    const extraHeaders = opts.getHeaders ? await opts.getHeaders(req) : {};

    const upstream = await fetch(`${opts.targetUrl}/agent/${sessionId}/stream`, {
      headers: {
        Accept: "text/event-stream",
        ...extraHeaders,
      },
      signal: AbortSignal.timeout(opts.connectTimeoutMs ?? 10_000),
    });

    if (!upstream.ok || !upstream.body) {
      return new Response("Upstream SSE error", { status: upstream.status });
    }

    return new Response(upstream.body, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      },
    });
  };
}
