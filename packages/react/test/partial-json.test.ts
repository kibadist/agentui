import { describe, it, expect } from "vitest";
import { parsePartialJson, streamingJsonParse } from "../src/partial-json.js";

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
