# @kibadist/agentui-ai

Provider-agnostic AgentUI adapter built on the [Vercel AI SDK](https://ai-sdk.dev). Works with **any** AI SDK-compatible provider — OpenAI, Anthropic, Google, DeepSeek, Mistral, and more.

## Install

```bash
npm install @kibadist/agentui-ai ai zod
```

**Peer dependencies:** `ai` ^6.0.0, `zod` ^3.24.2

## Quick start

```ts
import { openai } from "@ai-sdk/openai";
import { runAgentLoop } from "@kibadist/agentui-ai";

await runAgentLoop({
  model: openai("gpt-4o"),
  system: "You are a helpful assistant. Use emit_ui_event to render UI.",
  prompt: "Show me a summary of recent sales",
  allowedTypes: ["text-block", "info-card", "data-table"],
  sessionId: "session-123",
  onUIEvent: (event) => {
    console.log(event);
  },
});
```

## Using different providers

```ts
// OpenAI
import { openai } from "@ai-sdk/openai";
const model = openai("gpt-4o");

// Anthropic
import { anthropic } from "@ai-sdk/anthropic";
const model = anthropic("claude-sonnet-4-5-20250514");

// Google
import { google } from "@ai-sdk/google";
const model = google("gemini-2.0-flash");

// DeepSeek
import { createOpenAI } from "@ai-sdk/openai";
const deepseek = createOpenAI({ baseURL: "https://api.deepseek.com", apiKey: process.env.DEEPSEEK_API_KEY });
const model = deepseek("deepseek-chat");
```

## How it works

`runAgentLoop` creates an `emit_ui_event` tool whose Zod schema constrains the agent to only emit your registered component types. It calls the AI SDK's `generateText` with multi-step tool calling — no manual loop, no JSON.parse, no message management.

The tool uses a `z.discriminatedUnion("op", [...])` so the model receives a precise schema for each operation (append, replace, remove, toast, navigate).

## Using the tool directly

If you need more control, use `createUIEmitterTool` directly:

```ts
import { generateText, stepCountIs } from "ai";
import { createUIEmitterTool, UI_EMITTER_TOOL_NAME } from "@kibadist/agentui-ai";

const uiTool = createUIEmitterTool({
  allowedTypes: ["text-block", "info-card"],
  sessionId: "session-123",
  onUIEvent: (event) => console.log(event),
});

const { text } = await generateText({
  model: openai("gpt-4o"),
  system: "You are a helpful assistant.",
  prompt: "Show a welcome message",
  tools: { [UI_EMITTER_TOOL_NAME]: uiTool },
  stopWhen: stepCountIs(5),
});
```

## Options

### `runAgentLoop`

| Option | Type | Default | Description |
|---|---|---|---|
| `model` | `LanguageModel` | required | Any AI SDK model instance |
| `system` | `string` | required | Agent instructions |
| `prompt` | `string` | required | Current user message |
| `allowedTypes` | `string[]` | required | Component types the agent can emit |
| `sessionId` | `string` | required | Session ID injected into events |
| `onUIEvent` | `(event: UIEvent) => void` | required | Callback for each emitted UIEvent |
| `extraTools` | `ToolSet` | `{}` | Additional AI SDK tools beyond the UI emitter |
| `maxSteps` | `number` | `10` | Max tool-call steps before stopping |

### `createUIEmitterTool`

| Option | Type | Description |
|---|---|---|
| `allowedTypes` | `string[]` | Component types the agent can emit |
| `sessionId` | `string` | Session ID injected into events |
| `onUIEvent` | `(event: UIEvent) => void` | Callback for each emitted UIEvent |

## Migration from `@kibadist/agentui-openai`

| Old (`agentui-openai`) | New (`agentui-ai`) |
|---|---|
| `openai: OpenAI` | `model: LanguageModel` (any provider) |
| `systemPrompt: string` | `system: string` |
| `userMessage: string` | `prompt: string` |
| `extraTools?: ChatCompletionTool[]` | `extraTools?: ToolSet` |
| `onToolCall?` | removed (each tool has its own `execute`) |
| `maxRounds?: number` | `maxSteps?: number` |

```ts
// Before (openai package)
import OpenAI from "openai";
import { runAgentLoop } from "@kibadist/agentui-openai";

await runAgentLoop({
  openai: new OpenAI(),
  model: "gpt-4o",
  systemPrompt: "...",
  userMessage: "...",
  allowedTypes: [...],
  sessionId: "...",
  onUIEvent: (e) => {},
});

// After (ai package)
import { openai } from "@ai-sdk/openai";
import { runAgentLoop } from "@kibadist/agentui-ai";

await runAgentLoop({
  model: openai("gpt-4o"),
  system: "...",
  prompt: "...",
  allowedTypes: [...],
  sessionId: "...",
  onUIEvent: (e) => {},
});
```

## Exports

| Export | Kind | Description |
|---|---|---|
| `runAgentLoop` | function | Multi-step agent loop with UI event emission |
| `createUIEmitterTool` | function | Generate the `emit_ui_event` AI SDK tool |
| `UI_EMITTER_TOOL_NAME` | constant | `"emit_ui_event"` |
| `RunAgentLoopOptions` | interface | Options for `runAgentLoop` |
| `CreateUIEmitterToolOptions` | interface | Options for `createUIEmitterTool` |

## License

MIT
