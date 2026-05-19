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
      // Drop the preceding string key (which is a complete "key" pair)
      if (t.endsWith('"')) {
        const keyOpen = findClosedStringStart(t);
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

    // Trailing dangling string key (no colon following) → drop it
    // Only applies when the string is in key position (preceded by `{` or `,`),
    // not when it's a value (preceded by `:`).
    if (tail === '"') {
      const keyOpen = findClosedStringStart(s);
      if (keyOpen === -1) break; // Can't parse, will fall through to closers
      const before = s.slice(0, keyOpen).replace(/\s+$/, "");
      const beforeChar = before[before.length - 1];
      if (beforeChar === ":" ) break; // It's a value string — don't strip it
      // It's a dangling key
      let t = before;
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
          const keyOpen = findClosedStringStart(t);
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
          const keyOpen = findClosedStringStart(t);
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
  // Walk backward, respecting escapes. Returns the last unescaped " (opening of unclosed string).
  for (let i = s.length - 1; i >= 0; i--) {
    if (s[i] === '"') {
      let bs = 0;
      for (let j = i - 1; j >= 0 && s[j] === "\\"; j--) bs++;
      if (bs % 2 === 0) return i;
    }
  }
  return -1;
}

function findClosedStringStart(s: string): number {
  // s ends with a closing " — find the opening " of that complete string token.
  // The last char must be an unescaped ".
  if (!s.endsWith('"')) return -1;
  // Walk backward from the second-to-last char to find the opening ".
  for (let i = s.length - 2; i >= 0; i--) {
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

export async function* streamingJsonParse<T = unknown>(
  source: AsyncIterable<string> | ReadableStream<Uint8Array>,
): AsyncIterable<Partial<T>> {
  let buffer = "";
  let lastJson: string | undefined;

  const asAsyncIterable = isReadableStream(source)
    ? readableStreamToAsyncIterable(source)
    : (source as AsyncIterable<string>);

  for await (const chunk of asAsyncIterable) {
    if (!chunk) continue;
    buffer += chunk;
    const parsed = parsePartialJson<T>(buffer);
    if (parsed === undefined) continue;
    const json = JSON.stringify(parsed);
    if (json === lastJson) continue;
    // Only yield when the result is at least as informative as the last yield.
    // Require strictly increasing JSON length so that repair artifacts (e.g. `{}`
    // produced when a key is started but has no value yet) are suppressed until
    // a truly richer parse arrives.
    if (lastJson === undefined) {
      // First emission: skip trivially-empty containers that carry no real info.
      if (!hasContent(parsed)) continue;
    } else if (json.length <= lastJson.length) {
      continue;
    }
    lastJson = json;
    yield parsed;
  }
}

/** Returns true if the parsed value carries meaningful content (not an empty container). */
function hasContent(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v as object).length > 0;
  return true; // primitive (string, number, boolean)
}

function isReadableStream(x: unknown): x is ReadableStream<Uint8Array> {
  return typeof x === "object" && x !== null && typeof (x as ReadableStream).getReader === "function";
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
