# LLM adapters package `@kibadist/agentui-llm` (DET-144 / v0.6.1)

Linear: [DET-144 — v0.6 — `@kibadist/agentui-llm` adapter package](https://linear.app/detailing-app/issue/DET-144)

## Goal

Ship `@kibadist/agentui-llm` so the "take a provider stream → emit UIEvents" glue lives in the library, not in every consumer's backend. Three async-generator adapters (`fromAnthropic`, `fromOpenAI`, `fromGemini`) take a provider's native streaming response and yield validated `AgentWireEvent` values. Acquisition story: plug in Claude/OpenAI/Gemini, get a chat UI in 20 lines.

## Non-goals (deliberate)

- `session.meta` carrying usage / stop reason. The current wire shape only has `conversationId`; widening it for usage stats is a separate ticket.
- `tool.result` emission from the adapter. Tool results come from the host after executing the call — they're host-driven.
- Live-network integration tests. Tests are fixture-based (hand-crafted event arrays typed against each provider SDK's stream event types).
- Stream cancellation logic inside the adapter. Hosts cancel via their own `AbortController` on the provider stream; our adapter just stops yielding when the input iterator throws or completes.
- OpenAI o1 reasoning stream parsing (different API surface — Responses API, not chat.completions); Gemini reasoning (not yet in stable API). Anthropic extended-thinking IS supported because the event shape is documented and stable.

## Architecture

```
host backend                 @kibadist/agentui-llm                @kibadist/agentui-react
─────────────                ────────────────────                 ──────────────────────
const stream =
  anthropic.messages
  .stream({...})        ───► fromAnthropic(stream)  ───► yields ────► SSE response
                              async function*               AgentWireEvent
                              (yields wire events)          │
                                                            ▼
                                                       host writes
                                                       "data: {...}\n\n"
                                                            │
                                                            ▼
                                                  ◄── client useAgentStream ──◄
```

Each adapter is a pure async generator: input is an async iterable of provider events; output is an async iterable of validated wire events. Stateless from the host's perspective (no setup/teardown beyond the iteration).

## Public API

```ts
// All adapters share this options shape.
export interface FromAdapterOptions {
  /** Session id stamped on every emitted event. Default: "session". */
  sessionId?: string;
  /**
   * Stable React key for the streaming text block node. Default: a freshly
   * generated id per adapter invocation.
   */
  textKey?: string;
}

// packages/llm/src/anthropic.ts
export async function* fromAnthropic(
  stream: AsyncIterable<AnthropicStreamEvent>,
  options?: FromAdapterOptions,
): AsyncIterable<AgentWireEvent>;

// packages/llm/src/openai.ts
export async function* fromOpenAI(
  stream: AsyncIterable<OpenAIStreamChunk>,
  options?: FromAdapterOptions,
): AsyncIterable<AgentWireEvent>;

// packages/llm/src/gemini.ts
export async function* fromGemini(
  stream: AsyncIterable<GeminiStreamResponse>,
  options?: FromAdapterOptions,
): AsyncIterable<AgentWireEvent>;
```

`AnthropicStreamEvent`, `OpenAIStreamChunk`, `GeminiStreamResponse` are local re-aliases of each provider SDK's public stream type. They live in the adapter file so consumers don't need to know exact SDK type paths.

## Event mapping

| Provider behavior | Emitted wire event |
|---|---|
| Text block first delta | `ui.append` — node `{ key: textKey, type: "text-block", props: { text } }` |
| Text block subsequent deltas | `ui.replace` — `{ key: textKey, props: { text: accumulated } }` |
| New tool-use start | `tool.start` — `{ id, name, args? }` |
| Tool args streaming (JSON deltas) | `tool.args-delta` — `{ id, delta }` |
| Anthropic `thinking` block start | `reasoning.start` — `{ id }` |
| Anthropic `thinking_delta` | `reasoning.delta` — `{ id, delta }` |
| Anthropic `thinking` block stop | `reasoning.end` — `{ id }` |
| Stream throws | `ui.toast` — `{ level: "error", message }` |
| Stream completes normally | no event (iterator ends) |

## Provider-specific notes

### Anthropic — `@anthropic-ai/sdk`

The `messages.stream` method returns a `MessageStream` that's async-iterable. Events have a typed union (`MessageStreamEvent`):

- `message_start` — opening event with usage estimates; ignored by adapter.
- `content_block_start` — opens a block at `index`. The `content_block` field tells us if it's text, tool_use, or thinking.
- `content_block_delta` — delta for the current block. `delta.type` is `text_delta` / `input_json_delta` / `thinking_delta`.
- `content_block_stop` — closes the block.
- `message_delta` — usage info; ignored.
- `message_stop` — end of stream.

Adapter tracks per-`index` block state in a Map. Emits start events on `content_block_start`, delta events on `content_block_delta`, and (for thinking blocks only) `reasoning.end` on `content_block_stop`.

Tool-use blocks: `content_block.id` is the tool-call id; `content_block.name` is the tool name. The `args?` field may be partially present in `content_block_start` (Anthropic includes initial empty `input: {}`); subsequent `input_json_delta` events stream the JSON. The adapter emits `tool.start` immediately with `args` set only if non-empty.

### OpenAI — `openai`

`chat.completions.create({ stream: true })` returns a `Stream<ChatCompletionChunk>`. Each chunk has `choices[0].delta` containing:
- `content?: string` — text delta
- `tool_calls?: [{ index, id?, function?: { name?, arguments? } }]` — partial tool-call info

Tool calls in OpenAI's stream are tricky: chunks contain partial `tool_calls[]` arrays keyed by `index`. The first chunk for a tool call has `index`, `id`, and `function.name`. Subsequent chunks have `index` and `function.arguments` deltas. The adapter accumulates per-index state.

`finish_reason: "tool_calls"` on the final chunk signals "all calls done; please execute" — the adapter does nothing extra here (the host knows from the stream ending).

OpenAI doesn't expose reasoning streams via the standard chat.completions API in v0.6.1's scope. Skip.

### Gemini — `@google/genai` (or current Google SDK)

`generateContentStream` returns an `AsyncIterable<GenerateContentResponse>`. Each chunk has `candidates[0].content.parts[]` containing either `{ text }` or `{ functionCall: { name, args } }`.

The wrinkle: Gemini's stream chunks each carry the FULL parts array (incremental in content but not delta-shaped). The adapter computes deltas by comparing against accumulated state per chunk.

For text: track accumulated string; emit `ui.replace` whenever the latest chunk's text exceeds the prior length; emit `ui.append` on the first non-empty text.

For function calls: Gemini emits the full `functionCall.args` object once it's ready (not streamed JSON). The adapter emits `tool.start` with the complete `args` field set; no `tool.args-delta` events.

## Tests

Each adapter test file follows the same pattern: hand-crafted fixture arrays typed against the provider's stream event type, fed through the adapter, asserted against expected wire-event sequences.

Three tests per adapter (so 9 total):

1. **Text streaming.** Fixture: 3-4 text deltas. Assert first event is `ui.append` with text-block node; subsequent are `ui.replace` accumulating.
2. **Interleaved text + tool call.** Fixture: text → tool call → more text (Anthropic only since OpenAI groups text and tool calls in the same chunks; OpenAI test uses concurrent text + tool_calls; Gemini test uses a fixture where parts contain text then functionCall). Assert events emit in chronological order with correct types.
3. **Stream error → toast.** Fixture: a generator that yields one event then throws. Assert the last emitted wire event is `ui.toast` with `level: "error"` and the error's message.

Plus, for Anthropic only, a 4th test:

4. **Reasoning (thinking) block.** Fixture: thinking block with deltas. Assert `reasoning.start` → `reasoning.delta` × N → `reasoning.end`.

## File touches

| File | Action |
|---|---|
| `packages/llm/package.json` | Create (peerDependencies on provider SDKs; devDependencies for type imports) |
| `packages/llm/tsconfig.json` | Create (extends `../../tsconfig.base.json`) |
| `packages/llm/src/index.ts` | Create — re-exports the three adapters |
| `packages/llm/src/shared.ts` | Create — `generateId`, `baseEvent`, `makeToastEvent` helpers |
| `packages/llm/src/anthropic.ts` | Create — `fromAnthropic` adapter |
| `packages/llm/src/openai.ts` | Create — `fromOpenAI` adapter |
| `packages/llm/src/gemini.ts` | Create — `fromGemini` adapter |
| `packages/llm/test/anthropic.test.ts` | Create — 4 tests |
| `packages/llm/test/openai.test.ts` | Create — 3 tests |
| `packages/llm/test/gemini.test.ts` | Create — 3 tests |
| `scripts/bump-and-publish.sh` | Modify if it hardcodes the publish list (add `llm` between `validate` and `react`) |
| `CHANGELOG.md` | Start a `0.6.0` section above `0.5.0` |
| `README.md` | New "LLM adapters" subsection |

## Implementation plan decomposition

The implementation plan will split into five tasks:

1. **Package skeleton + shared helpers.** New `packages/llm/` with package.json, tsconfig.json, src/index.ts (empty re-exports), src/shared.ts (id generation + base event factory + toast helper). Verify `pnpm build` succeeds on the new package.
2. **`fromAnthropic` adapter + 4 tests.** Most feature-rich provider — covers text + tool_use + thinking + error. Serves as the reference implementation for the other two.
3. **`fromOpenAI` adapter + 3 tests.** Text + tool_calls + error. No reasoning.
4. **`fromGemini` adapter + 3 tests.** Text (delta-via-diff) + functionCall (whole) + error.
5. **Publish script + docs.** Update `scripts/bump-and-publish.sh` if hardcoded; CHANGELOG + README.

Each adapter is independent — Tasks 2/3/4 don't share runtime code beyond `shared.ts`.

## Edge cases

- **Empty stream** (immediately ends without yielding any events). Adapter yields nothing.
- **Stream throws on first iteration.** Catch in the outer try, emit `ui.toast` with the error, stop.
- **Multiple text blocks in one Anthropic message.** Anthropic can emit multiple `text` blocks at different `index` values. The adapter currently coalesces them into one `text-block` node (since `textKey` is shared). Documented; multi-text-block UX is a host concern (they can call `fromAnthropic` multiple times if they want separate blocks).
- **Tool call with no arguments.** `tool.start` emits with no `args` field; no subsequent `tool.args-delta`. Correct behavior.
- **`textKey` collisions across concurrent adapter calls.** If the host calls `fromAnthropic` twice concurrently with the default-generated `textKey`, they'll have different keys (one per invocation). If the host passes the same `textKey` explicitly, they're responsible for the collision.
- **`sessionId` not provided.** Defaults to `"session"`. The adapter is wire-level; in practice hosts always set `sessionId` from their `useAgentStream` query param.
- **Provider SDK version drift.** Stream event shapes can change between SDK majors. The adapter pins types via the peerDependency range and the test fixtures (which match the documented shapes at the pinned versions). Major SDK upgrades require bumping the peerDependency and re-validating fixtures.

## Migration / before-after

```ts
// Before (host wires the SSE stream manually with state tracking)
import Anthropic from "@anthropic-ai/sdk";
const stream = anthropic.messages.stream({...});
let textKey = randomUUID();
let accumulated = "";
let textBlockStarted = false;
const blockKinds = new Map();
for await (const event of stream) {
  // ... 50 lines of switch-on-event-type logic ...
  res.write(`data: ${JSON.stringify(wireEvent)}\n\n`);
}

// After
import { fromAnthropic } from "@kibadist/agentui-llm";
const stream = anthropic.messages.stream({...});
for await (const event of fromAnthropic(stream, { sessionId })) {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}
```

20 lines of glue collapse to a `for await` loop.

## Versioning

Starts the 0.6.0 release. Other v0.6 tickets (DET-145/146/147) layer on top.

The new package version aligns with the workspace at publish time. Currently the bump script (`scripts/bump-and-publish.sh`) lists packages explicitly; adding `llm` to the dependency order between `validate` and `react` is one line of edits.

## Open questions

None blocking. Resolved inline:

- **One `from(stream, provider)` or separate functions?** Separate (matches ticket recommendation + clearer SDK type imports).
- **Reasoning support per-provider?** Anthropic only in v0.6.1. OpenAI and Gemini revisit when their reasoning APIs stabilize.
- **Session usage tracking?** Out of scope (would require widening `session.meta`).
