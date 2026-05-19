# Streaming Partial-JSON Parser — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tolerant partial-JSON parser + streaming async iterator, exposed from `@kibadist/agentui-react`. Integrate `parsePartialJson` into the reducer's `tool.args-delta` path so tool-call args update progressively instead of only at completion.

**Architecture:** Single new pure module `packages/react/src/partial-json.ts`. The repair algorithm walks character-by-character maintaining a stack of expected closing tokens, then applies truncation cleanup rules before synthesizing closers and re-running `JSON.parse`. The reducer's `applyToolArgsDelta` swaps `JSON.parse` for `parsePartialJson`. LLM adapter integration is deferred (see spec §5.2).

**Tech Stack:** TypeScript ESM, Vitest. No new runtime deps.

**Version target:** rolls into 0.8.0 alongside DET-151.

---

## File Structure

**New:**
- `packages/react/src/partial-json.ts` — parser + streaming iterator
- `packages/react/test/partial-json.test.ts` — unit tests

**Modified:**
- `packages/react/src/reducer.ts` — `applyToolArgsDelta` uses `parsePartialJson`
- `packages/react/src/index.ts` — exports
- `README.md` — Streaming partial-JSON subsection
- `CHANGELOG.md` — append to v0.8.0 block

---

## Task 1: parsePartialJson (sync repair)

**Files:**
- Create: `packages/react/src/partial-json.ts`
- Create: `packages/react/test/partial-json.test.ts`

- [ ] **Step 1: Write the failing tests** at `packages/react/test/partial-json.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parsePartialJson } from "../src/partial-json.js";

describe("parsePartialJson — fast path", () => {
  it("parses complete JSON unchanged", () => {
    expect(parsePartialJson('{"a":1,"b":[2,3]}')).toEqual({ a: 1, b: [2, 3] });
  });
  it("parses complete primitives at root", () => {
    expect(parsePartialJson("true")).toBe(true);
    expect(parsePartialJson("42")).toBe(42);
    expect(parsePartialJson('"hi"')).toBe("hi");
    expect(parsePartialJson("null")).toBe(null);
  });
});

describe("parsePartialJson — repair", () => {
  it("closes an open object", () => {
    expect(parsePartialJson('{"a":1')).toEqual({ a: 1 });
  });
  it("closes an open array inside an object", () => {
    expect(parsePartialJson('{"name":"foo","items":[1,2')).toEqual({
      name: "foo",
      items: [1, 2],
    });
  });
  it("closes an open string", () => {
    expect(parsePartialJson('{"name":"fo')).toEqual({ name: "fo" });
  });
  it("drops trailing backslash in string", () => {
    expect(parsePartialJson('{"name":"foo\\')).toEqual({ name: "foo" });
  });
  it("drops a partial unicode escape", () => {
    expect(parsePartialJson('{"x":"a\\u00')).toEqual({ x: "a" });
  });
  it("drops trailing comma", () => {
    expect(parsePartialJson('{"a":1,')).toEqual({ a: 1 });
  });
  it("drops a key with only a colon (no value)", () => {
    expect(parsePartialJson('{"a":1,"b":')).toEqual({ a: 1 });
  });
  it("drops a key with no colon", () => {
    expect(parsePartialJson('{"a":1,"b"')).toEqual({ a: 1 });
  });
  it("drops a partial keyword (tru, fals, nul)", () => {
    expect(parsePartialJson('{"x":tru')).toEqual({});
    expect(parsePartialJson('{"x":true,"y":fals')).toEqual({ x: true });
    expect(parsePartialJson('{"x":nul')).toEqual({});
  });
  it("drops a partial number with dangling exponent or decimal", () => {
    expect(parsePartialJson('{"n":3.')).toEqual({});
    expect(parsePartialJson('{"n":3,"m":1e')).toEqual({ n: 3 });
    expect(parsePartialJson('{"n":-')).toEqual({});
  });
  it("handles deeply nested partial structures", () => {
    expect(parsePartialJson('{"a":{"b":[1,2,{"c":')).toEqual({ a: { b: [1, 2, {}] } });
  });
  it("preserves whitespace tolerance", () => {
    expect(parsePartialJson('{ "a" : 1, "b" : [ 2,')).toEqual({ a: 1, b: [2] });
  });
});

describe("parsePartialJson — failure modes", () => {
  it("returns undefined for empty input", () => {
    expect(parsePartialJson("")).toBe(undefined);
    expect(parsePartialJson("   ")).toBe(undefined);
  });
  it("returns undefined for plain text", () => {
    expect(parsePartialJson("hello")).toBe(undefined);
  });
  it("returns undefined for truly malformed JSON", () => {
    expect(parsePartialJson('{"a":}')).toBe(undefined);
    expect(parsePartialJson('{"a":,"b":1}')).toBe(undefined);
  });
});

describe("parsePartialJson — type narrowing", () => {
  it("narrows to Partial<T>", () => {
    const result = parsePartialJson<{ name: string; count: number }>('{"name":"foo"');
    // Type assertion at compile time; runtime check below
    expect(result).toEqual({ name: "foo" });
    if (result) {
      // @ts-expect-error - count is optional via Partial
      const n: number = result.count;
      void n;
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @kibadist/agentui-react test partial-json
```

Expected: module doesn't exist.

- [ ] **Step 3: Implement `packages/react/src/partial-json.ts`**

Use this exact starting implementation:

```ts
export function parsePartialJson<T = unknown>(text: string): Partial<T> | undefined {
  if (!text || !text.trim()) return undefined;
  // Fast path
  try {
    return JSON.parse(text) as Partial<T>;
  } catch {
    /* fall through */
  }
  const repaired = repair(text);
  if (repaired === undefined) return undefined;
  try {
    return JSON.parse(repaired) as Partial<T>;
  } catch {
    return undefined;
  }
}

// ─── repair ──────────────────────────────────────────────────────────────────

type StackFrame = "object" | "array" | "string";

function repair(text: string): string | undefined {
  // First pass: scan to determine the stack at end-of-input.
  const stack: StackFrame[] = [];
  let i = 0;
  let cutoff = text.length; // index up to which the input was "well-formed enough"
  while (i < text.length) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (top === "string") {
      if (c === "\\") {
        // Skip the escape; treat lone trailing backslash as cleanup later.
        if (i + 1 >= text.length) break;
        i += 2;
        continue;
      }
      if (c === '"') {
        stack.pop();
      }
      i++;
      continue;
    }
    if (c === '"') {
      stack.push("string");
      i++;
      continue;
    }
    if (c === "{") {
      stack.push("object");
      i++;
      continue;
    }
    if (c === "[") {
      stack.push("array");
      i++;
      continue;
    }
    if (c === "}") {
      if (top !== "object") return undefined;
      stack.pop();
      i++;
      continue;
    }
    if (c === "]") {
      if (top !== "array") return undefined;
      stack.pop();
      i++;
      continue;
    }
    i++;
  }
  cutoff = text.length;

  // Truncation cleanup applied to a mutable slice.
  let s = text;

  // 1. Inside-string cleanup.
  if (stack[stack.length - 1] === "string") {
    // Find the opening quote of this string.
    const openIdx = findOpeningQuote(s);
    if (openIdx === -1) return undefined;
    // Drop a trailing lone backslash.
    if (s.endsWith("\\")) {
      // count consecutive trailing backslashes; lone = odd count
      let k = 0;
      for (let j = s.length - 1; j >= 0 && s[j] === "\\"; j--) k++;
      if (k % 2 === 1) s = s.slice(0, -1);
    }
    // Drop a partial \uXXXX (less than 4 hex chars after \u).
    s = s.replace(/\\u[0-9a-fA-F]{0,3}$/, "");
    s += '"';
    stack.pop();
  }

  // Loop: trim trailing whitespace, then handle dangling syntactic atoms.
  // Repeat until the tail is "settled" or we can't repair.
  let progressed = true;
  while (progressed) {
    progressed = false;
    s = s.replace(/\s+$/, "");
    if (!s) return undefined;

    const tail = s[s.length - 1];

    // Trailing comma → drop
    if (tail === ",") {
      s = s.slice(0, -1);
      progressed = true;
      continue;
    }

    // Trailing colon → drop the key:value-less pair
    if (tail === ":") {
      // Drop the colon
      let t = s.slice(0, -1).replace(/\s+$/, "");
      // Drop the preceding string key
      if (t.endsWith('"')) {
        const keyOpen = findOpeningQuote(t);
        if (keyOpen === -1) return undefined;
        t = t.slice(0, keyOpen).replace(/\s+$/, "");
      } else {
        // Object key without proper quoting — unrecoverable in strict JSON
        return undefined;
      }
      // If a comma preceded the dropped key, drop the comma too
      if (t.endsWith(",")) t = t.slice(0, -1);
      s = t;
      progressed = true;
      continue;
    }

    // Trailing partial keyword (true/false/null prefix)
    const partialKw = matchPartialKeyword(s);
    if (partialKw !== null) {
      s = s.slice(0, s.length - partialKw);
      // After dropping value, expect colon: same logic as ":" tail
      s = s.replace(/\s+$/, "");
      if (s.endsWith(":")) {
        let t = s.slice(0, -1).replace(/\s+$/, "");
        if (t.endsWith('"')) {
          const keyOpen = findOpeningQuote(t);
          if (keyOpen === -1) return undefined;
          t = t.slice(0, keyOpen).replace(/\s+$/, "");
        } else {
          return undefined;
        }
        if (t.endsWith(",")) t = t.slice(0, -1);
        s = t;
      } else if (s.endsWith(",") || s.endsWith("[")) {
        // Array element partial — drop trailing comma if any
        if (s.endsWith(",")) s = s.slice(0, -1);
      }
      progressed = true;
      continue;
    }

    // Trailing partial number — ends in `.`, `e`, `e+`, `e-`, or lone `-`
    const partialNum = matchPartialNumber(s);
    if (partialNum > 0) {
      s = s.slice(0, s.length - partialNum);
      s = s.replace(/\s+$/, "");
      if (s.endsWith(":")) {
        let t = s.slice(0, -1).replace(/\s+$/, "");
        if (t.endsWith('"')) {
          const keyOpen = findOpeningQuote(t);
          if (keyOpen === -1) return undefined;
          t = t.slice(0, keyOpen).replace(/\s+$/, "");
        } else {
          return undefined;
        }
        if (t.endsWith(",")) t = t.slice(0, -1);
        s = t;
      } else if (s.endsWith(",")) {
        s = s.slice(0, -1);
      }
      progressed = true;
      continue;
    }
  }

  // Close out remaining stack.
  while (stack.length) {
    const frame = stack.pop();
    if (frame === "object") s += "}";
    else if (frame === "array") s += "]";
    else if (frame === "string") s += '"';
  }

  return s;
}

function findOpeningQuote(s: string): number {
  // Walk backward, respecting escapes.
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === '"') {
      let bs = 0;
      for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) bs++;
      if (bs % 2 === 0) return i;
    }
  }
  return -1;
}

function matchPartialKeyword(s: string): number | null {
  // Returns the number of trailing characters that form a strict prefix of true/false/null.
  // E.g., "...tru" → 3; "...false" → null (it's complete, leave it).
  const prefixes = ["t", "tr", "tru", "f", "fa", "fal", "fals", "n", "nu", "nul"];
  // Sort by length desc so we match longest prefix first
  prefixes.sort((a, b) => b.length - a.length);
  for (const p of prefixes) {
    if (s.endsWith(p)) {
      // Make sure the character before this prefix is a value-start position
      // (after `:`, `,`, `[`, or whitespace following one).
      const before = s.slice(0, s.length - p.length).replace(/\s+$/, "");
      const last = before[before.length - 1];
      if (last === ":" || last === "," || last === "[" || before.length === 0) {
        return p.length;
      }
    }
  }
  return null;
}

function matchPartialNumber(s: string): number {
  // Returns the number of trailing chars to drop if the number is incomplete; 0 otherwise.
  // Walk back to identify the last number token.
  let j = s.length;
  while (j > 0 && /[\d+\-eE.]/.test(s[j - 1])) j--;
  const tok = s.slice(j);
  if (!tok) return 0;
  // Verify it's actually a number context (preceded by `:`, `,`, `[`, or sof)
  const before = s.slice(0, j).replace(/\s+$/, "");
  const last = before[before.length - 1];
  if (last !== ":" && last !== "," && last !== "[" && before.length !== 0) return 0;
  // If the token already parses as a number, leave it.
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(tok)) return 0;
  // Otherwise drop the whole partial token.
  return tok.length;
}

// ─── streamingJsonParse (Task 2) ─────────────────────────────────────────────
// Placeholder: filled in Task 2.
export async function* streamingJsonParse<T = unknown>(
  source: AsyncIterable<string> | ReadableStream<Uint8Array>,
): AsyncIterable<Partial<T>> {
  // To be implemented in Task 2.
  yield* [] as unknown as AsyncIterable<Partial<T>>;
  void source;
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @kibadist/agentui-react test partial-json
```

All `parsePartialJson` cases must pass. Iterate on the parser until they do.

- [ ] **Step 5: Run typecheck**

```bash
pnpm typecheck
```

Clean.

- [ ] **Step 6: Commit**

```bash
git add packages/react/src/partial-json.ts packages/react/test/partial-json.test.ts
git commit -m "feat(react): add parsePartialJson with truncation repair (DET-152)"
```

---

## Task 2: streamingJsonParse (async iterator)

**Files:**
- Modify: `packages/react/src/partial-json.ts` — flesh out `streamingJsonParse`
- Append to: `packages/react/test/partial-json.test.ts`

- [ ] **Step 1: Append tests** at the end of `packages/react/test/partial-json.test.ts`

```ts
import { streamingJsonParse } from "../src/partial-json.js";

async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}

async function* fromChunks(chunks: string[]): AsyncIterable<string> {
  for (const c of chunks) yield c;
}

describe("streamingJsonParse", () => {
  it("yields progressively richer partials from string chunks", async () => {
    const chunks = ['{"a":', '1,', '"b":2}'];
    const out = await collect(streamingJsonParse(fromChunks(chunks)));
    expect(out).toEqual([{ a: 1 }, { a: 1, b: 2 }]);
  });

  it("does not yield duplicate identical partials", async () => {
    const chunks = ['{"a":1', "", "  ", "}"];
    const out = await collect(streamingJsonParse(fromChunks(chunks)));
    expect(out).toEqual([{ a: 1 }]);
  });

  it("decodes a ReadableStream<Uint8Array> source", async () => {
    const enc = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(enc.encode('{"x":'));
        controller.enqueue(enc.encode('"hello"'));
        controller.enqueue(enc.encode("}"));
        controller.close();
      },
    });
    const out = await collect(streamingJsonParse<{ x: string }>(stream));
    expect(out.at(-1)).toEqual({ x: "hello" });
  });

  it("yields nothing for input that never becomes parseable", async () => {
    const out = await collect(streamingJsonParse(fromChunks(["nope", "still", "bad"])));
    expect(out).toEqual([]);
  });

  it("survives mid-stream truncation without throwing", async () => {
    const out = await collect(streamingJsonParse(fromChunks(['{"a":1,', '"b":'])));
    expect(out).toEqual([{ a: 1 }]);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
pnpm --filter @kibadist/agentui-react test partial-json
```

Streaming cases should fail (placeholder yields nothing).

- [ ] **Step 3: Replace the placeholder `streamingJsonParse` body**

```ts
export async function* streamingJsonParse<T = unknown>(
  source: AsyncIterable<string> | ReadableStream<Uint8Array>,
): AsyncIterable<Partial<T>> {
  let buffer = "";
  let lastJson: string | undefined;

  const asAsyncIterable = isAsyncIterable(source)
    ? source
    : readableStreamToAsyncIterable(source);

  for await (const chunk of asAsyncIterable) {
    if (!chunk) continue;
    buffer += chunk;
    const parsed = parsePartialJson<T>(buffer);
    if (parsed === undefined) continue;
    const json = JSON.stringify(parsed);
    if (json === lastJson) continue;
    lastJson = json;
    yield parsed;
  }
}

function isAsyncIterable(x: unknown): x is AsyncIterable<string> {
  return typeof x === "object" && x !== null && Symbol.asyncIterator in x;
}

async function* readableStreamToAsyncIterable(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        const tail = decoder.decode();
        if (tail) yield tail;
        return;
      }
      yield decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}
```

- [ ] **Step 4: Run tests**

```bash
pnpm --filter @kibadist/agentui-react test partial-json
```

All passing.

- [ ] **Step 5: Commit**

```bash
git add packages/react/src/partial-json.ts packages/react/test/partial-json.test.ts
git commit -m "feat(react): add streamingJsonParse async iterator (DET-152)"
```

---

## Task 3: Reducer integration + exports + docs

**Files:**
- Modify: `packages/react/src/reducer.ts` — `applyToolArgsDelta` uses `parsePartialJson`
- Modify: `packages/react/src/index.ts` — export both
- Modify: `README.md` — Streaming partial-JSON subsection
- Modify: `CHANGELOG.md` — append to v0.8.0 block

- [ ] **Step 1: Write a reducer integration test**

Find the existing reducer test file (`packages/react/test/reducer.test.ts` or similar). Add two cases:

```ts
it("updates tool args progressively from partial args-delta JSON", () => {
  let state = initialAgentState;
  state = agentReducer(state, {
    v: 1, id: "t1", ts: "t", sessionId: "s",
    op: "tool.start", name: "search",
  });
  state = agentReducer(state, {
    v: 1, id: "d1", ts: "t", sessionId: "s",
    op: "tool.args-delta", id: "t1", delta: '{"q":"foo',
  });
  expect(state.toolCalls.get("t1")?.args).toEqual({ q: "foo" });
  state = agentReducer(state, {
    v: 1, id: "d2", ts: "t", sessionId: "s",
    op: "tool.args-delta", id: "t1", delta: 'bar"}',
  });
  expect(state.toolCalls.get("t1")?.args).toEqual({ q: "foobar" });
});
```

(Inspect the existing reducer test file's structure first — adapt the imports and the `id` field placement on `tool.start` to match the protocol's actual shape. Check the existing tool.args-delta test for reference.)

- [ ] **Step 2: Update `applyToolArgsDelta` in `packages/react/src/reducer.ts`**

Add `import { parsePartialJson } from "./partial-json.js";` at the top. Replace the body of `applyToolArgsDelta`:

```ts
function applyToolArgsDelta(state: AgentState, e: ToolArgsDeltaEvent): AgentState {
  const existing = state.toolCalls.get(e.id);
  if (!existing || existing.status !== "pending") return state;
  const argsRaw = existing.argsRaw + e.delta;
  const args = parsePartialJson(argsRaw);
  const toolCalls = new Map(state.toolCalls);
  toolCalls.set(e.id, { ...existing, argsRaw, args });
  return { ...state, toolCalls };
}
```

- [ ] **Step 3: Export from `packages/react/src/index.ts`**

Add:

```ts
export { parsePartialJson, streamingJsonParse } from "./partial-json.js";
```

- [ ] **Step 4: Run all tests**

```bash
pnpm --filter @kibadist/agentui-react test
pnpm typecheck
```

Both clean.

- [ ] **Step 5: Add a `## Streaming partial-JSON` subsection to `README.md`**

Add near the JSON Patch section (or wherever wire-protocol helpers are documented):

```markdown
### Streaming partial-JSON

LLM tool calls stream their JSON args incrementally. `parsePartialJson` returns a `Partial<T>` after each delta, repairing truncated input:

```ts
import { parsePartialJson, streamingJsonParse } from "@kibadist/agentui-react";

parsePartialJson<{ q: string; tags: string[] }>('{"q":"foo","tags":[1,2');
// → { q: "foo", tags: [1, 2] }

for await (const partial of streamingJsonParse<{ q: string }>(stream)) {
  // partial.q updates progressively
}
```

The reducer uses `parsePartialJson` internally so `state.toolCalls.get(id).args` updates after every `tool.args-delta` event, not only at completion.
```

- [ ] **Step 6: Update `CHANGELOG.md`** — append to the existing v0.8.0 `### Added` list:

```markdown
- New `parsePartialJson<T>(text)` and `streamingJsonParse<T>(source)` helpers exported from `@kibadist/agentui-react`. The reducer uses `parsePartialJson` so tool-call args update progressively after each `tool.args-delta`. ([DET-152](https://linear.app/detailing-app/issue/DET-152))
```

- [ ] **Step 7: Run full verification**

```bash
pnpm typecheck
pnpm test
pnpm build
```

- [ ] **Step 8: Commit**

```bash
git add packages/react/src/reducer.ts packages/react/src/index.ts packages/react/test/reducer.test.ts README.md CHANGELOG.md
git commit -m "feat(react): wire parsePartialJson into tool.args-delta + docs (DET-152)"
```

---

## Self-Review Checklist

- [ ] `parsePartialJson` returns `undefined` for genuinely malformed input (vs incomplete-but-recoverable)
- [ ] All trailing cleanup cases match the spec table
- [ ] `streamingJsonParse` accepts both `AsyncIterable<string>` and `ReadableStream<Uint8Array>`
- [ ] `streamingJsonParse` does NOT yield identical partials (idempotency check)
- [ ] Reducer's `args` updates progressively (verified by the new test)
- [ ] README example renders cleanly
- [ ] CHANGELOG appended (not duplicated v0.8.0 block)
