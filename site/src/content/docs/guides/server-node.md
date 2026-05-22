---
title: "Server companion — `@kibadist/agentui-node`"
description: "Framework-agnostic server primitives. Drop in alongside Express, Fastify, Hono, raw `node:http`, or a Next.js Route Handler."
---

```ts
import { createServer } from "node:http";
import { createAgentStream } from "@kibadist/agentui-node";

createServer(async (req, res) => {
  if (req.url?.endsWith("/stream")) {
    const stream = createAgentStream(res, { sessionId: "demo" });
    await stream.emit({
      op: "ui.append",
      node: { key: "hello", type: "panel", props: { text: "Hi" } },
    });
    await stream.close();
  } else {
    res.statusCode = 404;
    res.end();
  }
}).listen(3001);
```

Built-in helpers wrap the common patterns:

```ts
import { emitToolCall, emitTextStream } from "@kibadist/agentui-node";

await emitToolCall(stream, {
  name: "search_clients",
  args: { q: "Acme" },
  runner: () => db.clients.search("Acme"),
});

await emitTextStream(stream, {
  chunks: anthropicResponse.deltas, // any AsyncIterable<string>
});
```

## Conversation persistence

```ts
import { Conversation, MemoryConversationStorage } from "@kibadist/agentui-node";

const conv = new Conversation({ storage: new MemoryConversationStorage() });
const stream = createAgentStream(res, { sessionId, conversation: conv });
// Every emitted event is also written to storage.

const history = await conv.history(sessionId, { limit: 50 });
```

To plug in Prisma or Drizzle, implement the `ConversationStorage` interface against your schema — append + history are the only two methods.

## Web / Edge variant

```ts
import { createAgentReadable } from "@kibadist/agentui-node";

export async function GET() {
  const { readable, stream } = createAgentReadable({ sessionId: "demo" });
  await stream.emit({ op: "ui.toast", level: "info", message: "hi" });
  await stream.close();
  return new Response(readable, {
    headers: { "Content-Type": "text/event-stream" },
  });
}
```

## Related

- [LLM adapters](./llm-adapters.md)
- [JSON Schema export](./json-schema-export.md)
