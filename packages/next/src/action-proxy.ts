export interface ActionProxyOptions {
  /** Base URL of the NestJS backend */
  targetUrl: string;
  /** Optional: add headers (e.g. auth tokens) to the proxied request */
  getHeaders?: (req: Request) => Record<string, string> | Promise<Record<string, string>>;
  /** Timeout in ms for the upstream request (default: 30000) */
  timeoutMs?: number;
}

/**
 * Creates a Next.js App Router POST handler that forwards actions to the Nest backend.
 *
 * Usage in app/api/agent/[sessionId]/action/route.ts:
 *   export const POST = createActionProxyHandler({ targetUrl: "http://localhost:3001" });
 */
export function createActionProxyHandler(opts: ActionProxyOptions) {
  return async (req: Request, { params }: { params: Promise<{ sessionId: string }> }) => {
    const { sessionId } = await params;
    const body = await req.text();
    const extraHeaders = opts.getHeaders ? await opts.getHeaders(req) : {};

    const upstream = await fetch(`${opts.targetUrl}/agent/${sessionId}/action`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...extraHeaders,
      },
      body,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    });

    const data = await upstream.text();
    return new Response(data, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  };
}
