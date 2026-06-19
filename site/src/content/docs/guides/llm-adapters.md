---
title: "LLM adapters: provider stream → wire events"
description: "`@kibadist/agentui-llm` ships three async-generator adapters that turn a provider's native streaming response into AgentUI wire events. Drop them into your SSE handler to skip the manual state-tracking:"
---

```ts
import Anthropic from "@anthropic-ai/sdk";
import { fromAnthropic } from "@kibadist/agentui-llm";

const anthropic = new Anthropic();
const stream = anthropic.messages.stream({
  model: "claude-sonnet-4-6",
  messages: [{ role: "user", content: userMessage }],
});

for await (const event of fromAnthropic(stream, { sessionId })) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```

`fromOpenAI` and `fromGemini` follow the same shape. Each adapter maps:

- **Text** → `ui.append` (first delta creates a `text-block` node) + `ui.replace` for subsequent deltas.
- **Tool calls** → `tool.start` + `tool.args-delta` (host executes the tool and emits `tool.result` itself).
- **Reasoning** (Anthropic extended thinking only) → `reasoning.start` / `.delta` / `.end`.
- **Stream errors** → `ui.toast` with `level: "error"`.

Each provider's SDK is a *peer-dependency* of `@kibadist/agentui-llm` — install only the ones you use.

## Related

- [Server companion (Node)](../server-node/)
