# @kibadist/agentui-openai

OpenAI function-calling adapter for the AgentUI protocol. Works with any OpenAI-compatible API (OpenAI, DeepSeek, Ollama, vLLM, etc.).

## Install

```bash
npm install @kibadist/agentui-openai
```

**Peer dependency:** `openai` ^4.0.0

## Quick start

```ts
import OpenAI from "openai";
import { runAgentLoop } from "@kibadist/agentui-openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

await runAgentLoop({
  openai,
  model: "gpt-4o",
  systemPrompt: "You are a helpful assistant. Use emit_ui_event to render UI.",
  userMessage: "Show me a summary of recent sales",
  allowedTypes: ["text-block", "info-card", "data-table"],
  sessionId: "session-123",
  onUIEvent: (event) => {
    // Forward to SSE stream, save to DB, etc.
    console.log(event);
  },
});
```

## How it works

`runAgentLoop` creates an `emit_ui_event` function tool whose schema constrains the agent to only emit your registered component types. The agent calls this tool to append, replace, remove, toast, or navigate. The loop runs multi-turn until the model stops or `maxRounds` is reached.

## Using different providers

```ts
// OpenAI
new OpenAI({ apiKey: "sk-..." });

// DeepSeek
new OpenAI({ apiKey: "sk-...", baseURL: "https://api.deepseek.com" });

// Local (Ollama, vLLM)
new OpenAI({ apiKey: "none", baseURL: "http://localhost:11434/v1" });
```

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `openai` | `OpenAI` | required | OpenAI client instance |
| `model` | `string` | `"gpt-4o"` | Model name |
| `systemPrompt` | `string` | required | Agent instructions |
| `userMessage` | `string` | required | Current user message |
| `allowedTypes` | `string[]` | required | Component types the agent can emit |
| `sessionId` | `string` | required | Session ID injected into events |
| `onUIEvent` | `(event: UIEvent) => void` | required | Callback for each emitted UIEvent |
| `extraTools` | `ChatCompletionTool[]` | `[]` | Additional tools beyond the UI emitter |
| `onToolCall` | `(name, args) => string` | - | Handler for extra tool calls |
| `maxRounds` | `number` | `10` | Max tool-call rounds to prevent loops |

## Exports

| Export | Kind | Description |
|---|---|---|
| `runAgentLoop` | function | Multi-turn agent loop with UI event emission |
| `createUIEmitterTool` | function | Generate the `emit_ui_event` tool definition |
| `UI_EMITTER_TOOL_NAME` | constant | `"emit_ui_event"` |
| `RunAgentLoopOptions` | interface | Options for `runAgentLoop` |

## License

MIT
