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
