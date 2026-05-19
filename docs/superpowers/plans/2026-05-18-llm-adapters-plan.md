# LLM Adapters Package Implementation Plan (DET-144)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@kibadist/agentui-llm` — a new package with three async-generator adapters (`fromAnthropic`, `fromOpenAI`, `fromGemini`) that map provider streaming responses to `AgentWireEvent`.

**Architecture:** Each adapter is a pure async generator consuming the provider SDK's async-iterable stream and yielding wire events. Shared helpers live in `shared.ts` (id generation, base event factory, error→toast). The three adapters are independent files with provider-specific state machines.

**Tech Stack:** TypeScript strict, async generators, Vitest. Peer-deps on `@anthropic-ai/sdk`, `openai`, `@google/genai`.

**Spec:** [docs/superpowers/specs/2026-05-18-llm-adapters-design.md](../specs/2026-05-18-llm-adapters-design.md)

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `packages/llm/package.json` | Create | Package metadata + peer/dev deps |
| `packages/llm/tsconfig.json` | Create | Extends repo base; rootDir src, outDir dist |
| `packages/llm/src/index.ts` | Create | Re-exports the three adapters |
| `packages/llm/src/shared.ts` | Create | `generateId`, `baseEvent`, `makeToastEvent` |
| `packages/llm/src/anthropic.ts` | Create | `fromAnthropic` adapter |
| `packages/llm/src/openai.ts` | Create | `fromOpenAI` adapter |
| `packages/llm/src/gemini.ts` | Create | `fromGemini` adapter |
| `packages/llm/test/anthropic.test.ts` | Create | 4 tests |
| `packages/llm/test/openai.test.ts` | Create | 3 tests |
| `packages/llm/test/gemini.test.ts` | Create | 3 tests |
| `scripts/bump-and-publish.sh` | Modify if hardcoded | Add `llm` to publish order |
| `CHANGELOG.md` | Modify | Start 0.6.0 section |
| `README.md` | Modify | Add LLM adapters subsection |

---

## Conventions

- All commands run from `/Users/max/agentui`.
- Tests: `pnpm test` (one-shot — wired to `vitest run`). NEVER watch mode.
- Typecheck: `pnpm typecheck`.
- ESM `.js` relative imports throughout.
- SDK types are imported as `type`-only to avoid runtime dep — they're devDependencies of `@kibadist/agentui-llm` and peerDependencies for consumers.

---

## Task 1: Package skeleton + shared helpers

**Files:**
- Create: `packages/llm/package.json`
- Create: `packages/llm/tsconfig.json`
- Create: `packages/llm/src/index.ts` (initially empty)
- Create: `packages/llm/src/shared.ts`

### Step 1: Create `packages/llm/package.json`

```json
{
  "name": "@kibadist/agentui-llm",
  "version": "0.5.0",
  "description": "Provider-native LLM stream adapters (Anthropic, OpenAI, Gemini) → AgentUI wire events",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/kibadist/agentui.git",
    "directory": "packages/llm"
  },
  "homepage": "https://github.com/kibadist/agentui#readme",
  "publishConfig": {
    "access": "public"
  },
  "type": "module",
  "sideEffects": false,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.js",
      "default": "./dist/index.js"
    }
  },
  "files": ["dist"],
  "scripts": {
    "prepublishOnly": "pnpm run build",
    "build": "tsc",
    "clean": "rm -rf dist",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@kibadist/agentui-protocol": "workspace:^"
  },
  "peerDependencies": {
    "@anthropic-ai/sdk": ">=0.27.0",
    "openai": ">=4.0.0",
    "@google/genai": ">=0.3.0"
  },
  "peerDependenciesMeta": {
    "@anthropic-ai/sdk": { "optional": true },
    "openai": { "optional": true },
    "@google/genai": { "optional": true }
  },
  "devDependencies": {
    "@anthropic-ai/sdk": ">=0.27.0",
    "openai": ">=4.0.0",
    "@google/genai": ">=0.3.0",
    "typescript": "^5.7.3"
  }
}
```

The `peerDependenciesMeta.optional: true` lets hosts depend on only the providers they use.

### Step 2: Create `packages/llm/tsconfig.json`

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "dist",
    "rootDir": "src"
  },
  "include": ["src"]
}
```

### Step 3: Create `packages/llm/src/shared.ts`

```ts
import type {
  AgentWireEvent,
  UIAppendEvent,
  UIReplaceEvent,
  UIToastEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
} from "@kibadist/agentui-protocol";

let counter = 0;
/** Generate a short unique id. Not cryptographic — adequate for in-stream correlation. */
export function generateId(prefix = "id"): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export interface BaseEventInput {
  sessionId: string;
  ts?: string;
}

/** Build a BaseEvent with v/id/ts/sessionId fields filled in. */
function baseFields({ sessionId, ts }: BaseEventInput) {
  return {
    v: 1 as const,
    id: generateId("evt"),
    ts: ts ?? new Date().toISOString(),
    sessionId,
  };
}

export function makeAppendTextEvent(
  base: BaseEventInput,
  textKey: string,
  text: string,
): UIAppendEvent {
  return {
    ...baseFields(base),
    op: "ui.append",
    node: { key: textKey, type: "text-block", props: { text } },
  };
}

export function makeReplaceTextEvent(
  base: BaseEventInput,
  textKey: string,
  text: string,
): UIReplaceEvent {
  return {
    ...baseFields(base),
    op: "ui.replace",
    key: textKey,
    props: { text },
  };
}

export function makeToolStartEvent(
  base: BaseEventInput,
  toolId: string,
  name: string,
  args?: unknown,
): ToolCallStartEvent {
  const e: ToolCallStartEvent = {
    ...baseFields(base),
    op: "tool.start",
    id: toolId,
    name,
  };
  if (args !== undefined) e.args = args;
  return e;
}

export function makeToolArgsDeltaEvent(
  base: BaseEventInput,
  toolId: string,
  delta: string,
): ToolArgsDeltaEvent {
  return {
    ...baseFields(base),
    op: "tool.args-delta",
    id: toolId,
    delta,
  };
}

export function makeReasoningStartEvent(
  base: BaseEventInput,
  segmentId: string,
): ReasoningStartEvent {
  return {
    ...baseFields(base),
    op: "reasoning.start",
    id: segmentId,
  };
}

export function makeReasoningDeltaEvent(
  base: BaseEventInput,
  segmentId: string,
  delta: string,
): ReasoningDeltaEvent {
  return {
    ...baseFields(base),
    op: "reasoning.delta",
    id: segmentId,
    delta,
  };
}

export function makeReasoningEndEvent(
  base: BaseEventInput,
  segmentId: string,
): ReasoningEndEvent {
  return {
    ...baseFields(base),
    op: "reasoning.end",
    id: segmentId,
  };
}

export function makeToastEvent(
  base: BaseEventInput,
  level: "error",
  message: string,
): UIToastEvent {
  return {
    ...baseFields(base),
    op: "ui.toast",
    level,
    message,
  };
}

export type AnyWireEvent = AgentWireEvent;
```

### Step 4: Create `packages/llm/src/index.ts` (placeholder for now)

```ts
// Re-exports filled in by adapter tasks.
export {};
```

### Step 5: Install peer deps as devDependencies

Run from repo root: `cd /Users/max/agentui && pnpm install` — this picks up the new package.json and installs the SDK types as dev deps.

Expected output: pnpm installs `@anthropic-ai/sdk`, `openai`, `@google/genai` into `packages/llm/node_modules`.

If pnpm rejects with a workspace error, run `pnpm install --filter @kibadist/agentui-llm`.

### Step 6: Typecheck the new package

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-llm typecheck`
Expected: clean (no errors — the package has no real code yet, just shared helpers and an empty index).

### Step 7: Build the new package

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-llm build`
Expected: build succeeds, `dist/` populated with `index.js`, `index.d.ts`, `shared.js`, `shared.d.ts`.

### Step 8: Run the full suite — confirm no regressions

Run: `cd /Users/max/agentui && pnpm test`
Expected: existing 104 tests pass. The new package has no test files yet.

### Step 9: Commit

```bash
cd /Users/max/agentui
git add packages/llm/ pnpm-lock.yaml
git commit -m "feat(llm): scaffold @kibadist/agentui-llm package + shared helpers"
```

---

## Task 2: `fromAnthropic` adapter + tests

**Files:**
- Create: `packages/llm/src/anthropic.ts`
- Create: `packages/llm/test/anthropic.test.ts`
- Modify: `packages/llm/src/index.ts` (export fromAnthropic)

The Anthropic SDK's stream events follow a documented union. Key event types:
- `message_start` — open
- `content_block_start` — `content_block` field tells us block type (`text` / `tool_use` / `thinking`)
- `content_block_delta` — `delta.type` is `text_delta` / `input_json_delta` / `thinking_delta`
- `content_block_stop` — close
- `message_delta`, `message_stop` — final events

### Step 1: Write the failing tests

Create `packages/llm/test/anthropic.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { fromAnthropic } from "../src/anthropic.js";

async function* toStream<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

const sessionId = "s1";
const textKey = "tb-1";

describe("fromAnthropic — text streaming", () => {
  it("first text delta → ui.append; subsequent → ui.replace accumulating", async () => {
    const fixture = [
      { type: "message_start", message: { id: "msg_1", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Hello" } },
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: " world" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 2 } },
      { type: "message_stop" },
    ];

    const events: AgentWireEvent[] = await collect(
      fromAnthropic(toStream(fixture), { sessionId, textKey }),
    );

    expect(events).toHaveLength(3);
    expect(events[0].op).toBe("ui.append");
    if (events[0].op === "ui.append") {
      expect(events[0].node).toMatchObject({
        key: textKey,
        type: "text-block",
        props: { text: "Hello" },
      });
    }
    expect(events[1].op).toBe("ui.replace");
    if (events[1].op === "ui.replace") {
      expect(events[1].key).toBe(textKey);
      expect(events[1].props).toEqual({ text: "Hello world" });
    }
    // events[2] is the second ui.replace from the second delta? Actually the
    // first delta emits ui.append, the second delta emits ui.replace.
    // Total: 1 append + 1 replace = 2 events for text. The third would be
    // something else if there were more blocks. With our fixture, only the
    // two text deltas produce events. Adjust:
    expect(events).toHaveLength(2);
  });
});

describe("fromAnthropic — tool calls", () => {
  it("tool_use block → tool.start with name + tool.args-delta on input_json_delta", async () => {
    const fixture = [
      { type: "message_start", message: { id: "msg_2", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "tool_use", id: "toolu_1", name: "search", input: {} } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "{\"q\":" } },
      { type: "content_block_delta", index: 0, delta: { type: "input_json_delta", partial_json: "\"hi\"}" } },
      { type: "content_block_stop", index: 0 },
      { type: "message_delta", delta: { stop_reason: "tool_use" }, usage: { output_tokens: 5 } },
      { type: "message_stop" },
    ];

    const events: AgentWireEvent[] = await collect(
      fromAnthropic(toStream(fixture), { sessionId }),
    );

    expect(events[0].op).toBe("tool.start");
    if (events[0].op === "tool.start") {
      expect(events[0].id).toBe("toolu_1");
      expect(events[0].name).toBe("search");
    }
    expect(events[1].op).toBe("tool.args-delta");
    if (events[1].op === "tool.args-delta") {
      expect(events[1].id).toBe("toolu_1");
      expect(events[1].delta).toBe('{"q":');
    }
    expect(events[2].op).toBe("tool.args-delta");
    if (events[2].op === "tool.args-delta") {
      expect(events[2].delta).toBe('"hi"}');
    }
  });
});

describe("fromAnthropic — reasoning (thinking) blocks", () => {
  it("thinking block → reasoning.start / .delta / .end", async () => {
    const fixture = [
      { type: "message_start", message: { id: "msg_3", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } },
      { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Let me think." } },
      { type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: " More." } },
      { type: "content_block_stop", index: 0 },
      { type: "message_stop" },
    ];

    const events: AgentWireEvent[] = await collect(
      fromAnthropic(toStream(fixture), { sessionId }),
    );

    expect(events[0].op).toBe("reasoning.start");
    expect(events[1].op).toBe("reasoning.delta");
    if (events[1].op === "reasoning.delta") {
      expect(events[1].delta).toBe("Let me think.");
    }
    expect(events[2].op).toBe("reasoning.delta");
    if (events[2].op === "reasoning.delta") {
      expect(events[2].delta).toBe(" More.");
    }
    expect(events[3].op).toBe("reasoning.end");
  });
});

describe("fromAnthropic — stream error", () => {
  it("error mid-stream → final event is ui.toast with level: error", async () => {
    async function* errorStream(): AsyncIterable<unknown> {
      yield { type: "message_start", message: { id: "m", role: "assistant", content: [], model: "x", stop_reason: null, stop_sequence: null, usage: { input_tokens: 1, output_tokens: 0 } } };
      throw new Error("network blip");
    }
    const events: AgentWireEvent[] = await collect(fromAnthropic(errorStream() as AsyncIterable<never>, { sessionId }));
    const last = events.at(-1);
    expect(last?.op).toBe("ui.toast");
    if (last?.op === "ui.toast") {
      expect(last.level).toBe("error");
      expect(last.message).toContain("network blip");
    }
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/llm/test/anthropic.test.ts`
Expected: failure — `fromAnthropic` doesn't exist yet.

### Step 3: Create `packages/llm/src/anthropic.ts`

```ts
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import {
  generateId,
  makeAppendTextEvent,
  makeReplaceTextEvent,
  makeReasoningDeltaEvent,
  makeReasoningEndEvent,
  makeReasoningStartEvent,
  makeToastEvent,
  makeToolArgsDeltaEvent,
  makeToolStartEvent,
} from "./shared.js";

export interface FromAdapterOptions {
  sessionId?: string;
  textKey?: string;
}

/**
 * Anthropic Messages API stream event (loose shape — matches @anthropic-ai/sdk
 * docs and types). We type as a discriminated union on `type`.
 */
type AnthropicEvent =
  | { type: "message_start"; message: unknown }
  | {
      type: "content_block_start";
      index: number;
      content_block:
        | { type: "text"; text: string }
        | { type: "tool_use"; id: string; name: string; input: unknown }
        | { type: "thinking"; thinking: string };
    }
  | {
      type: "content_block_delta";
      index: number;
      delta:
        | { type: "text_delta"; text: string }
        | { type: "input_json_delta"; partial_json: string }
        | { type: "thinking_delta"; thinking: string };
    }
  | { type: "content_block_stop"; index: number }
  | { type: "message_delta"; delta?: { stop_reason?: string } }
  | { type: "message_stop" };

interface BlockState {
  kind: "text" | "tool_use" | "thinking";
  toolId?: string;          // for tool_use
  reasoningId?: string;     // for thinking
  textAccumulator?: string; // for text (we accumulate and emit the full text in ui.replace)
}

/**
 * Map an Anthropic Messages stream to AgentUI wire events.
 *
 * Text → ui.append (first delta in any text block) + ui.replace for subsequent.
 * Tool use → tool.start + tool.args-delta per chunk.
 * Thinking → reasoning.start / .delta / .end.
 * Errors → ui.toast (level: "error").
 */
export async function* fromAnthropic(
  stream: AsyncIterable<AnthropicEvent>,
  options: FromAdapterOptions = {},
): AsyncIterable<AgentWireEvent> {
  const sessionId = options.sessionId ?? "session";
  const textKey = options.textKey ?? generateId("tb");
  const base = { sessionId };

  // Per-block state, keyed by Anthropic's `index`.
  const blocks = new Map<number, BlockState>();
  // We share one text-block node across all text blocks in this message.
  // First text delta in the message anywhere → ui.append; subsequent → ui.replace.
  let textBlockStarted = false;
  let accumulatedText = "";

  try {
    for await (const event of stream) {
      switch (event.type) {
        case "message_start":
          // No emission.
          break;

        case "content_block_start": {
          const cb = event.content_block;
          if (cb.type === "text") {
            blocks.set(event.index, { kind: "text", textAccumulator: cb.text ?? "" });
            // The initial text in content_block_start is usually empty for streaming;
            // we wait for content_block_delta to emit.
            if (cb.text !== undefined && cb.text !== "") {
              accumulatedText += cb.text;
              if (!textBlockStarted) {
                textBlockStarted = true;
                yield makeAppendTextEvent(base, textKey, accumulatedText);
              } else {
                yield makeReplaceTextEvent(base, textKey, accumulatedText);
              }
            }
          } else if (cb.type === "tool_use") {
            blocks.set(event.index, { kind: "tool_use", toolId: cb.id });
            // Emit tool.start. `input` may be {} for streaming; include only if non-empty.
            const args =
              cb.input && typeof cb.input === "object" && Object.keys(cb.input as object).length > 0
                ? cb.input
                : undefined;
            yield makeToolStartEvent(base, cb.id, cb.name, args);
          } else if (cb.type === "thinking") {
            const reasoningId = generateId("r");
            blocks.set(event.index, { kind: "thinking", reasoningId });
            yield makeReasoningStartEvent(base, reasoningId);
            if (cb.thinking !== undefined && cb.thinking !== "") {
              yield makeReasoningDeltaEvent(base, reasoningId, cb.thinking);
            }
          }
          break;
        }

        case "content_block_delta": {
          const state = blocks.get(event.index);
          if (!state) break;
          const d = event.delta;
          if (d.type === "text_delta" && state.kind === "text") {
            accumulatedText += d.text;
            if (!textBlockStarted) {
              textBlockStarted = true;
              yield makeAppendTextEvent(base, textKey, accumulatedText);
            } else {
              yield makeReplaceTextEvent(base, textKey, accumulatedText);
            }
          } else if (d.type === "input_json_delta" && state.kind === "tool_use" && state.toolId) {
            yield makeToolArgsDeltaEvent(base, state.toolId, d.partial_json);
          } else if (d.type === "thinking_delta" && state.kind === "thinking" && state.reasoningId) {
            yield makeReasoningDeltaEvent(base, state.reasoningId, d.thinking);
          }
          break;
        }

        case "content_block_stop": {
          const state = blocks.get(event.index);
          if (state && state.kind === "thinking" && state.reasoningId) {
            yield makeReasoningEndEvent(base, state.reasoningId);
          }
          // Cleanup not strictly needed; the Map can grow per message.
          break;
        }

        case "message_delta":
        case "message_stop":
          // No emission in v0.6.1 (usage info deferred).
          break;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield makeToastEvent(base, "error", message);
  }
}
```

### Step 4: Update `packages/llm/src/index.ts`

Replace with:

```ts
export { fromAnthropic, type FromAdapterOptions } from "./anthropic.js";
```

### Step 5: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-llm typecheck && pnpm test packages/llm/test/anthropic.test.ts`
Expected: typecheck clean; `4 passed`.

Note: the first test expects `events.length === 2` not 3 (initial expectation was wrong in the fixture). The `content_block_stop` event for a text block doesn't emit anything; only `content_block_delta` events with `text_delta` produce emissions. Re-check the test assertions match the actual fixture flow.

### Step 6: Run the full suite

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 7: Commit

```bash
cd /Users/max/agentui
git add packages/llm/src/anthropic.ts packages/llm/src/index.ts packages/llm/test/anthropic.test.ts
git commit -m "feat(llm): add fromAnthropic adapter (text, tools, thinking, error)"
```

---

## Task 3: `fromOpenAI` adapter + tests

**Files:**
- Create: `packages/llm/src/openai.ts`
- Create: `packages/llm/test/openai.test.ts`
- Modify: `packages/llm/src/index.ts` (add fromOpenAI export)

OpenAI's stream chunks have `choices[0].delta` containing partial `content` and partial `tool_calls[]`. Tool calls are tracked per-index: first chunk has `id` + `function.name`; subsequent chunks have `function.arguments` deltas.

### Step 1: Write the failing tests

Create `packages/llm/test/openai.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { fromOpenAI } from "../src/openai.js";

async function* toStream<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

const sessionId = "s1";
const textKey = "tb-1";

describe("fromOpenAI — text streaming", () => {
  it("first text chunk → ui.append; subsequent → ui.replace", async () => {
    const fixture = [
      { choices: [{ index: 0, delta: { role: "assistant" } }] },
      { choices: [{ index: 0, delta: { content: "Hello" } }] },
      { choices: [{ index: 0, delta: { content: " world" } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: "stop" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromOpenAI(toStream(fixture), { sessionId, textKey }),
    );
    expect(events[0].op).toBe("ui.append");
    if (events[0].op === "ui.append") {
      expect(events[0].node.props).toEqual({ text: "Hello" });
    }
    expect(events[1].op).toBe("ui.replace");
    if (events[1].op === "ui.replace") {
      expect(events[1].props).toEqual({ text: "Hello world" });
    }
  });
});

describe("fromOpenAI — tool calls", () => {
  it("first tool_call chunk → tool.start; subsequent → tool.args-delta", async () => {
    const fixture = [
      { choices: [{ index: 0, delta: { role: "assistant" } }] },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                { index: 0, id: "call_abc", function: { name: "search", arguments: "" } },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"q":' } }],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '"hi"}' } }],
            },
          },
        ],
      },
      { choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromOpenAI(toStream(fixture), { sessionId }),
    );
    expect(events[0].op).toBe("tool.start");
    if (events[0].op === "tool.start") {
      expect(events[0].id).toBe("call_abc");
      expect(events[0].name).toBe("search");
    }
    const argsDeltas = events.filter((e) => e.op === "tool.args-delta");
    expect(argsDeltas).toHaveLength(2);
    if (argsDeltas[0].op === "tool.args-delta") {
      expect(argsDeltas[0].delta).toBe('{"q":');
    }
    if (argsDeltas[1].op === "tool.args-delta") {
      expect(argsDeltas[1].delta).toBe('"hi"}');
    }
  });
});

describe("fromOpenAI — stream error", () => {
  it("error mid-stream → final event is ui.toast (error)", async () => {
    async function* errorStream(): AsyncIterable<unknown> {
      yield { choices: [{ index: 0, delta: { content: "x" } }] };
      throw new Error("boom");
    }
    const events: AgentWireEvent[] = await collect(fromOpenAI(errorStream() as AsyncIterable<never>, { sessionId }));
    const last = events.at(-1);
    expect(last?.op).toBe("ui.toast");
    if (last?.op === "ui.toast") {
      expect(last.level).toBe("error");
      expect(last.message).toContain("boom");
    }
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/llm/test/openai.test.ts`
Expected: failure — `fromOpenAI` doesn't exist.

### Step 3: Create `packages/llm/src/openai.ts`

```ts
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import {
  generateId,
  makeAppendTextEvent,
  makeReplaceTextEvent,
  makeToastEvent,
  makeToolArgsDeltaEvent,
  makeToolStartEvent,
} from "./shared.js";
import type { FromAdapterOptions } from "./anthropic.js";

/**
 * OpenAI ChatCompletion stream chunk shape.
 * Mirrors `ChatCompletionChunk` from the `openai` SDK (loose typing).
 */
interface OpenAIChunk {
  choices?: Array<{
    index?: number;
    delta?: {
      role?: string;
      content?: string;
      tool_calls?: Array<{
        index: number;
        id?: string;
        function?: { name?: string; arguments?: string };
      }>;
    };
    finish_reason?: string | null;
  }>;
}

interface OpenAIToolState {
  toolId: string;
  startedAt: number; // for ordering, currently unused
}

/**
 * Map an OpenAI ChatCompletion stream to AgentUI wire events.
 *
 * Text → ui.append (first non-empty content) + ui.replace for subsequent.
 * Tool calls → tool.start (first chunk per index with id+name) + tool.args-delta
 *   for subsequent arguments fragments.
 * Errors → ui.toast (level: "error").
 *
 * No reasoning support in v0.6.1 (OpenAI's reasoning streams use the
 * separate Responses API, not chat.completions).
 */
export async function* fromOpenAI(
  stream: AsyncIterable<OpenAIChunk>,
  options: FromAdapterOptions = {},
): AsyncIterable<AgentWireEvent> {
  const sessionId = options.sessionId ?? "session";
  const textKey = options.textKey ?? generateId("tb");
  const base = { sessionId };

  let accumulatedText = "";
  let textBlockStarted = false;

  // Tool calls are keyed by their `index` in the delta array.
  const toolStates = new Map<number, OpenAIToolState>();

  try {
    for await (const chunk of stream) {
      const choice = chunk.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta;
      if (!delta) continue;

      // Text content
      if (typeof delta.content === "string" && delta.content !== "") {
        accumulatedText += delta.content;
        if (!textBlockStarted) {
          textBlockStarted = true;
          yield makeAppendTextEvent(base, textKey, accumulatedText);
        } else {
          yield makeReplaceTextEvent(base, textKey, accumulatedText);
        }
      }

      // Tool calls
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index;
          let state = toolStates.get(idx);
          if (!state) {
            // First chunk for this tool — must have id + function.name.
            if (!tc.id || !tc.function?.name) {
              // Malformed; skip.
              continue;
            }
            state = { toolId: tc.id, startedAt: idx };
            toolStates.set(idx, state);
            yield makeToolStartEvent(base, tc.id, tc.function.name);
            // The initial chunk may also contain a non-empty arguments delta.
            if (tc.function.arguments && tc.function.arguments !== "") {
              yield makeToolArgsDeltaEvent(base, tc.id, tc.function.arguments);
            }
          } else {
            // Subsequent chunk: emit arguments delta if present.
            if (tc.function?.arguments) {
              yield makeToolArgsDeltaEvent(base, state.toolId, tc.function.arguments);
            }
          }
        }
      }

      // finish_reason: no emission in v0.6.1.
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield makeToastEvent(base, "error", message);
  }
}
```

### Step 4: Update `packages/llm/src/index.ts`

Replace with:

```ts
export { fromAnthropic, type FromAdapterOptions } from "./anthropic.js";
export { fromOpenAI } from "./openai.js";
```

### Step 5: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-llm typecheck && pnpm test packages/llm/test/openai.test.ts`
Expected: typecheck clean; `3 passed`.

### Step 6: Run the full suite

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass.

### Step 7: Commit

```bash
cd /Users/max/agentui
git add packages/llm/src/openai.ts packages/llm/src/index.ts packages/llm/test/openai.test.ts
git commit -m "feat(llm): add fromOpenAI adapter (text + tool_calls + error)"
```

---

## Task 4: `fromGemini` adapter + tests

**Files:**
- Create: `packages/llm/src/gemini.ts`
- Create: `packages/llm/test/gemini.test.ts`
- Modify: `packages/llm/src/index.ts` (add fromGemini export)

Gemini's `generateContentStream` yields chunks where each chunk has `candidates[0].content.parts[]` — full parts arrays at each step, not deltas. The adapter computes deltas by tracking accumulated state.

### Step 1: Write the failing tests

Create `packages/llm/test/gemini.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import { fromGemini } from "../src/gemini.js";

async function* toStream<T>(items: T[]): AsyncIterable<T> {
  for (const item of items) yield item;
}

async function collect<T>(it: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of it) out.push(v);
  return out;
}

const sessionId = "s1";
const textKey = "tb-1";

describe("fromGemini — text streaming", () => {
  it("first chunk with text → ui.append; subsequent text chunks → ui.replace", async () => {
    const fixture = [
      { candidates: [{ content: { parts: [{ text: "Hello" }] } }] },
      { candidates: [{ content: { parts: [{ text: "Hello world" }] } }] },
      { candidates: [{ finishReason: "STOP" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromGemini(toStream(fixture), { sessionId, textKey }),
    );
    expect(events[0].op).toBe("ui.append");
    if (events[0].op === "ui.append") {
      expect(events[0].node.props).toEqual({ text: "Hello" });
    }
    expect(events[1].op).toBe("ui.replace");
    if (events[1].op === "ui.replace") {
      expect(events[1].props).toEqual({ text: "Hello world" });
    }
  });
});

describe("fromGemini — function calls", () => {
  it("functionCall part → tool.start with complete args (no args-delta)", async () => {
    const fixture = [
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: {
                    name: "search",
                    args: { q: "hi" },
                  },
                },
              ],
            },
          },
        ],
      },
      { candidates: [{ finishReason: "STOP" }] },
    ];
    const events: AgentWireEvent[] = await collect(
      fromGemini(toStream(fixture), { sessionId }),
    );
    const toolStart = events.find((e) => e.op === "tool.start");
    expect(toolStart).toBeDefined();
    if (toolStart?.op === "tool.start") {
      expect(toolStart.name).toBe("search");
      expect(toolStart.args).toEqual({ q: "hi" });
    }
    // Gemini emits whole args; no args-delta events.
    expect(events.some((e) => e.op === "tool.args-delta")).toBe(false);
  });
});

describe("fromGemini — stream error", () => {
  it("error mid-stream → final event is ui.toast (error)", async () => {
    async function* errorStream(): AsyncIterable<unknown> {
      yield { candidates: [{ content: { parts: [{ text: "x" }] } }] };
      throw new Error("boom");
    }
    const events: AgentWireEvent[] = await collect(fromGemini(errorStream() as AsyncIterable<never>, { sessionId }));
    const last = events.at(-1);
    expect(last?.op).toBe("ui.toast");
    if (last?.op === "ui.toast") {
      expect(last.message).toContain("boom");
    }
  });
});
```

### Step 2: Run, confirm failure

Run: `cd /Users/max/agentui && pnpm test packages/llm/test/gemini.test.ts`
Expected: failure — `fromGemini` doesn't exist.

### Step 3: Create `packages/llm/src/gemini.ts`

```ts
import type { AgentWireEvent } from "@kibadist/agentui-protocol";
import {
  generateId,
  makeAppendTextEvent,
  makeReplaceTextEvent,
  makeToastEvent,
  makeToolStartEvent,
} from "./shared.js";
import type { FromAdapterOptions } from "./anthropic.js";

/** Gemini GenerateContentResponse (loose shape). */
interface GeminiChunk {
  candidates?: Array<{
    content?: {
      parts?: Array<
        | { text: string }
        | { functionCall: { name: string; args?: unknown } }
      >;
    };
    finishReason?: string;
  }>;
}

/**
 * Map a Gemini generateContentStream to AgentUI wire events.
 *
 * Text → ui.append (first non-empty text) + ui.replace as more text arrives.
 *   Gemini's stream chunks each carry the full accumulated text in `parts`,
 *   so the adapter emits the full text in each replace (not a delta).
 * Function calls → tool.start with complete args (Gemini emits the full
 *   functionCall once it's resolved; no streaming args).
 * Errors → ui.toast (level: "error").
 *
 * No reasoning support in v0.6.1 (Gemini's reasoning is not yet stable in
 * the streaming API).
 */
export async function* fromGemini(
  stream: AsyncIterable<GeminiChunk>,
  options: FromAdapterOptions = {},
): AsyncIterable<AgentWireEvent> {
  const sessionId = options.sessionId ?? "session";
  const textKey = options.textKey ?? generateId("tb");
  const base = { sessionId };

  let accumulatedText = "";
  let textBlockStarted = false;
  const emittedFunctionCalls = new Set<string>(); // dedupe by name+JSON.stringify(args)

  try {
    for await (const chunk of stream) {
      const candidate = chunk.candidates?.[0];
      if (!candidate?.content?.parts) continue;

      for (const part of candidate.content.parts) {
        if ("text" in part && typeof part.text === "string") {
          // Gemini chunks carry the full accumulated text in each chunk's
          // `text` field for streaming responses. Diff against our state.
          const chunkText = part.text;
          if (chunkText.length > accumulatedText.length && chunkText.startsWith(accumulatedText)) {
            // Strictly extending — normal streaming case.
            accumulatedText = chunkText;
            if (!textBlockStarted) {
              textBlockStarted = true;
              yield makeAppendTextEvent(base, textKey, accumulatedText);
            } else {
              yield makeReplaceTextEvent(base, textKey, accumulatedText);
            }
          } else if (chunkText !== accumulatedText) {
            // Non-extending change — replace whole-cloth.
            accumulatedText = chunkText;
            if (!textBlockStarted) {
              textBlockStarted = true;
              yield makeAppendTextEvent(base, textKey, accumulatedText);
            } else {
              yield makeReplaceTextEvent(base, textKey, accumulatedText);
            }
          }
          // No change → no emission.
        } else if ("functionCall" in part && part.functionCall) {
          const fc = part.functionCall;
          // Dedupe: Gemini may emit the same functionCall in multiple consecutive chunks.
          const dedupeKey = `${fc.name}:${JSON.stringify(fc.args ?? null)}`;
          if (emittedFunctionCalls.has(dedupeKey)) continue;
          emittedFunctionCalls.add(dedupeKey);
          const toolId = generateId("tool");
          yield makeToolStartEvent(base, toolId, fc.name, fc.args);
        }
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    yield makeToastEvent(base, "error", message);
  }
}
```

### Step 4: Update `packages/llm/src/index.ts`

Replace with:

```ts
export { fromAnthropic, type FromAdapterOptions } from "./anthropic.js";
export { fromOpenAI } from "./openai.js";
export { fromGemini } from "./gemini.js";
```

### Step 5: Typecheck + run new tests

Run: `cd /Users/max/agentui && pnpm --filter @kibadist/agentui-llm typecheck && pnpm test packages/llm/test/gemini.test.ts`
Expected: typecheck clean; `3 passed`.

### Step 6: Run the full suite

Run: `cd /Users/max/agentui && pnpm test`
Expected: all suites pass (10 new tests added across the three adapters; total 114).

### Step 7: Commit

```bash
cd /Users/max/agentui
git add packages/llm/src/gemini.ts packages/llm/src/index.ts packages/llm/test/gemini.test.ts
git commit -m "feat(llm): add fromGemini adapter (text + functionCall + error)"
```

---

## Task 5: CHANGELOG + README + publish script

**Files:**
- Modify: `CHANGELOG.md` — start a `## 0.6.0` section above `## 0.5.0`
- Modify: `README.md` — new LLM adapters subsection + update packages table
- Modify: `scripts/bump-and-publish.sh` if it hardcodes the publish order

### Step 1: Edit `CHANGELOG.md`

Find this line near the top of the file:

```md
## 0.5.0
```

BEFORE that line, insert a new `## 0.6.0` block:

```md
## 0.6.0

### Added — new package `@kibadist/agentui-llm`

- **Provider-native stream adapters.** Three async-generator functions that map LLM streaming responses to AgentUI `AgentWireEvent`:
  - `fromAnthropic(stream)` — text deltas, tool_use blocks, thinking (extended-reasoning) blocks, stream errors.
  - `fromOpenAI(stream)` — text deltas and tool_calls. (Reasoning via the Responses API is out of scope for v0.6.1.)
  - `fromGemini(stream)` — text (delta-via-diff) and functionCall. (Reasoning is not yet stable in the public Gemini streaming API.)
- All adapters accept `{ sessionId?, textKey? }` options and yield validated wire events. Stream errors yield a `ui.toast` with `level: "error"`.
- `tool.result` is NOT emitted by adapters — that's host-driven after executing the tool.
- Peer-dependencies on the three provider SDKs are marked optional so hosts only install what they need.

```

(Note the trailing blank line — separates 0.6.0 from 0.5.0.)

### Step 2: Edit `README.md` — packages table

Find the existing packages table (search for `## Packages` or the table with `@kibadist/agentui-protocol` row). After the row for `@kibadist/agentui-ai`, insert a new row for the LLM adapter package:

The existing table row format looks like:

```md
| [`@kibadist/agentui-ai`](https://www.npmjs.com/package/@kibadist/agentui-ai) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-ai)](https://www.npmjs.com/package/@kibadist/agentui-ai) | Provider-agnostic adapter via Vercel AI SDK (OpenAI, Anthropic, Google, DeepSeek) |
```

Add this row immediately after it (still inside the same table):

```md
| [`@kibadist/agentui-llm`](https://www.npmjs.com/package/@kibadist/agentui-llm) | [![npm](https://img.shields.io/npm/v/@kibadist/agentui-llm)](https://www.npmjs.com/package/@kibadist/agentui-llm) | Provider-native LLM stream adapters (Anthropic, OpenAI, Gemini) |
```

### Step 3: Edit `README.md` — LLM adapters subsection

Find the "Multiple agents in one app" paragraph from DET-143. After that paragraph (and before the next subsection or `---` separator), insert a new H3 subsection:

```md

### LLM adapters: provider stream → wire events

`@kibadist/agentui-llm` ships three async-generator adapters that turn a provider's native streaming response into AgentUI wire events. Drop them into your SSE handler to skip the manual state-tracking:

```ts
import Anthropic from "@anthropic-ai/sdk";
import { fromAnthropic } from "@kibadist/agentui-llm";

const anthropic = new Anthropic();
const stream = anthropic.messages.stream({
  model: "claude-sonnet-4-5",
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
```

### Step 4: Check the publish script

Run: `cat /Users/max/agentui/scripts/bump-and-publish.sh | grep -A 20 "PACKAGES"` or similar to find the package list.

If the script has a hardcoded array of package names (e.g., `PACKAGES=(protocol validate react ai nest next)`), add `llm` to it in the right dependency position — AFTER `validate` and BEFORE `react`.

If the script discovers packages via filesystem (e.g., `for pkg in packages/*`), no change needed.

### Step 5: Run the full suite as a smoke check

Run: `cd /Users/max/agentui && pnpm test`
Expected: all 114 tests pass.

### Step 6: Commit

```bash
cd /Users/max/agentui
git add CHANGELOG.md README.md scripts/bump-and-publish.sh
git commit -m "docs: document @kibadist/agentui-llm adapter package (0.6.0)"
```

(If `scripts/bump-and-publish.sh` was not modified, omit it from `git add`.)

---

## Verification — done when

- [ ] `pnpm test` passes — adds 10 new tests (4 + 3 + 3) bringing total to 114 across 26 files.
- [ ] `pnpm typecheck` clean across all packages.
- [ ] `pnpm --filter @kibadist/agentui-llm build` clean.
- [ ] `git log --oneline` shows the five task commits in order.
- [ ] No version bumps in `package.json` files beyond the new `llm` package starting at `0.5.0`.
- [ ] DET-144 transitioned to "Done" in Linear after the last commit lands.

## Out of scope (restated)

- Session usage / stop_reason events.
- OpenAI Responses API / reasoning streaming.
- Gemini reasoning.
- `tool.result` emission (host concern).
- Live-network integration tests.
