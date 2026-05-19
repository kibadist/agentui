---
ticket: DET-152
title: Streaming partial-JSON parser helper
version_target: 0.8.0
date: 2026-05-19
---

# Streaming Partial-JSON Parser — Design Spec

## 1. Goal

LLM tool-call args stream in incrementally. Today `applyToolArgsDelta` calls `JSON.parse` on every cumulative `argsRaw` and silently discards the partial result until the very last delta when the JSON is complete. Ship a tolerant partial-JSON parser so consumers (and the reducer itself) get a typed partial after every delta.

Two public APIs:
- `parsePartialJson<T>(text: string): Partial<T> | undefined` — sync, attempt to repair and parse an incomplete JSON string
- `streamingJsonParse<T>(source): AsyncIterable<Partial<T>>` — accumulate deltas, yield the latest partial per chunk

Both live in `@kibadist/agentui-react` (per the ticket's recommendation).

## 2. Algorithm

`parsePartialJson` works in two passes:

1. **Fast path:** try `JSON.parse(text)` directly. If it succeeds, return the value.
2. **Repair path:** walk the text character-by-character maintaining a small parser state machine:
   - Track a stack of expected closing tokens (`}`, `]`, `"`).
   - Detect "trailing incomplete" tokens that prevent parsing: trailing comma, partial keyword (`tr`/`tru`/`fa`/`fals`/`nu`/`nul`), partial number (ending in `.`, `e`, `e+`, `e-`, or `-`), object key with `:` but no value, object key with no `:`, trailing escape (`\`).
   - Strip the offending suffix, then synthesize the close tokens from the stack.
   - Try `JSON.parse` on the repaired text. If it still fails, return `undefined`.

Walks are O(n) in input length; no recursion. Whitespace between tokens is permitted and not specifically tracked beyond skipping during the truncation cleanup phase.

`streamingJsonParse` is a thin async generator:
- Accepts `AsyncIterable<string>` or `ReadableStream<Uint8Array>`.
- For `ReadableStream`, decodes via `TextDecoder` with `stream: true`.
- Accumulates a buffer; after each chunk, runs `parsePartialJson` on the cumulative buffer and yields the result if it's not undefined and is different from the last yielded value (shallow inequality via `JSON.stringify` comparison — cheap enough at delta cadence).

## 3. Truncation cleanup rules

After the stack walk, before closing, do (in order, repeatedly until stable):
1. Trim trailing whitespace.
2. If inside a string (top of stack is `"`):
   - If ends in lone `\`: drop it.
   - If ends in unterminated `\u` or `\u<hex>` (< 4 hex chars): drop the partial escape.
   - Append closing `"`, pop stack.
3. If the last non-whitespace token is a partial keyword (`t`, `tr`, `tru`, `f`, `fa`, `fal`, `fals`, `n`, `nu`, `nul`): drop those characters back to a meaningful boundary (last `,`, `:`, `{`, `[`, or beginning). If dropping leaves a trailing `,`, also drop the comma.
4. If the last non-whitespace token is a partial number (`-`, ends in `.`, `e`, `e+`, `e-`, `0x` prefix never valid, etc.): drop back to the last valid number boundary or to the boundary before the number.
5. If the last non-whitespace char is `,`: drop it.
6. If the last non-whitespace is `:`: this means a key has no value; back up further:
   - Drop the colon.
   - Drop the preceding string key (everything from the colon back through the matching `"`).
   - If preceded by `,`: drop the comma too.
7. If after step 6 the last non-whitespace is `{` or `[` followed only by whitespace: leave it (empty object/array is valid).

Then close out the stack: append `}`, `]`, or `"` in reverse stack order.

## 4. API

```ts
// packages/react/src/partial-json.ts

export function parsePartialJson<T = unknown>(text: string): Partial<T> | undefined;

export function streamingJsonParse<T = unknown>(
  source: AsyncIterable<string> | ReadableStream<Uint8Array>,
): AsyncIterable<Partial<T>>;
```

Both exported from `packages/react/src/index.ts`.

## 5. Integration

### 5.1 Reducer

`packages/react/src/reducer.ts` — `applyToolArgsDelta`:

```ts
function applyToolArgsDelta(state, e) {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const argsRaw = existing.argsRaw + e.delta;
  const args = parsePartialJson(argsRaw);
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, argsRaw, args });
  return { ...state, toolCalls };
}
```

`args` now updates monotonically as more text arrives, instead of staying `undefined` until the last chunk.

### 5.2 LLM adapters (deferred)

The ticket suggests adapters use `streamingJsonParse` to detect tool-call boundaries. In practice the adapters (`@kibadist/agentui-llm`) detect tool boundaries via provider-native structured events (Anthropic `content_block_start`, OpenAI `tool_calls` chunk indices). They don't need to re-parse JSON to find boundaries. Defer adapter integration; ship the helper as a public API for hosts that want to consume `argsRaw` deltas externally.

## 6. File Layout

```
packages/react/src/
├── partial-json.ts           # NEW — parsePartialJson + streamingJsonParse
├── reducer.ts                # MODIFY — applyToolArgsDelta uses parsePartialJson
└── index.ts                  # MODIFY — export parsePartialJson, streamingJsonParse

packages/react/test/
└── partial-json.test.ts      # NEW — repair + streaming cases
```

## 7. Testing

### 7.1 `parsePartialJson`

- Complete JSON parses unchanged: `{"a":1}` → `{ a: 1 }`
- Trailing object: `{"name":"foo","items":[1,2` → `{ name: "foo", items: [1, 2] }`
- Inside string: `{"name":"fo` → `{ name: "fo" }`
- Trailing backslash: `{"name":"foo\\` → `{ name: "foo" }`
- Partial unicode escape: `{"x":"a\\u00` → `{ x: "a" }`
- Trailing comma: `{"a":1,` → `{ a: 1 }`
- Object key without value: `{"a":1,"b":` → `{ a: 1 }`
- Object key without colon: `{"a":1,"b"` → `{ a: 1 }`
- Partial keyword: `{"x":tru` → `{}` (drops the partial value AND the key, since `b:` has no value); `{"x":true,"y":fals` → `{ x: true }`
- Partial number: `{"n":3.` → `{}` (drops); `{"n":3,"m":1e` → `{ n: 3 }`
- Just `-`: `{"n":-` → `{}`
- Empty input: `""` → `undefined`
- Plain text (not started with `{`/`[`/quote/digit/keyword): `hello` → `undefined`
- Truly malformed (not just incomplete): `{"a":}` → `undefined`
- Nested: `{"a":{"b":[1,2,{"c":` → `{ a: { b: [1, 2, {}] } }`
- TypeScript narrows: `parsePartialJson<{ name: string }>("...")` returns `Partial<{ name: string }> | undefined`

### 7.2 `streamingJsonParse`

- Chunked input `["{\"a\":", "1,", "\"b\":2}"]` yields `{ a: 1 }` then `{ a: 1, b: 2 }`
- Yields are non-decreasing in completeness (each contains the prior, by shape)
- `ReadableStream<Uint8Array>` source decodes via TextDecoder
- Source ending mid-stream yields the final partial (no error)
- Source containing truly malformed JSON yields nothing (does not throw)

### 7.3 Reducer integration

- After `tool.start` + a `tool.args-delta` of `{"q":"foo`, the tool's `args` field is `{ q: "foo" }`
- After a follow-up `tool.args-delta` of `bar"}`, `args` is `{ q: "foobar" }`
- `argsRaw` is the concatenated raw text (unchanged behavior)

## 8. Out of Scope

- JSON5/JSONL/concatenated streams
- Streaming validation against a Zod schema (host concern)
- Performance optimization for large inputs (parser is O(n); good enough for typical tool args < 16KB)
- Adapter integration (deferred per §5.2)

## 9. Acceptance Criteria

- `pnpm test` passes including new partial-json tests
- `pnpm typecheck` clean
- Tool-call args update progressively after each `tool.args-delta` rather than only at completion
- README has a "Streaming partial-JSON" subsection
- CHANGELOG v0.8.0 block updated with the new entry
