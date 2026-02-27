# @kibadist/agentui-next

Next.js App Router proxy handlers for the AgentUI protocol. Routes requests between your Next.js frontend and a NestJS (or any) backend.

## Install

```bash
npm install @kibadist/agentui-next
```

## Usage

### SSE stream proxy

```ts
// app/api/agent/[sessionId]/stream/route.ts
import { createSSEProxyHandler } from "@kibadist/agentui-next";

export const GET = createSSEProxyHandler({
  targetUrl: "http://localhost:3001",
});
```

### Action proxy

```ts
// app/api/agent/[sessionId]/action/route.ts
import { createActionProxyHandler } from "@kibadist/agentui-next";

export const POST = createActionProxyHandler({
  targetUrl: "http://localhost:3001",
});
```

### With authentication headers

```ts
export const GET = createSSEProxyHandler({
  targetUrl: process.env.AGENT_API_URL!,
  getHeaders: (req) => ({
    Authorization: req.headers.get("authorization") ?? "",
  }),
});

export const POST = createActionProxyHandler({
  targetUrl: process.env.AGENT_API_URL!,
  getHeaders: (req) => ({
    Authorization: req.headers.get("authorization") ?? "",
  }),
});
```

Then point your React client at the Next.js proxy instead of the backend directly:

```tsx
<AgentRuntimeProvider
  url={`/api/agent/${sessionId}/stream`}
  sessionId={sessionId}
/>
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `createSSEProxyHandler` | function | Creates a Next.js GET handler that proxies SSE streams |
| `createActionProxyHandler` | function | Creates a Next.js POST handler that proxies action requests |
| `SSEProxyOptions` | interface | Options: `targetUrl`, `getHeaders?` |
| `ActionProxyOptions` | interface | Options: `targetUrl`, `getHeaders?` |

## License

MIT
