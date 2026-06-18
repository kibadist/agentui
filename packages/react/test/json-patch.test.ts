import { describe, it, expect } from "vitest";
import { applyPatch } from "../src/json-patch.js";

describe("applyPatch", () => {
  describe("replace op", () => {
    it("replaces a leaf value, preserves siblings by reference", () => {
      const target = { a: { b: 1, c: { d: 2 } }, e: [10, 20] };
      const result = applyPatch(target, [{ op: "replace", path: "/a/b", value: 99 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const v = result.value as typeof target;
      expect(v.a.b).toBe(99);
      expect(v.a.c).toBe(target.a.c);
      expect(v.e).toBe(target.e);
      expect(target.a.b).toBe(1);
    });

    it("replaces the entire document with empty pointer", () => {
      const target = { a: 1 };
      const result = applyPatch(target, [{ op: "replace", path: "", value: { b: 2 } }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ b: 2 });
    });

    it("fails on non-existent path", () => {
      const target = { a: 1 };
      const result = applyPatch(target, [{ op: "replace", path: "/missing", value: 1 }]);
      expect(result.ok).toBe(false);
    });
  });

  describe("add op", () => {
    it("adds a new object property", () => {
      const result = applyPatch({ a: 1 }, [{ op: "add", path: "/b", value: 2 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ a: 1, b: 2 });
    });

    it("inserts into an array at index", () => {
      const result = applyPatch({ items: [1, 2, 4] }, [{ op: "add", path: "/items/2", value: 3 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ items: [1, 2, 3, 4] });
    });

    it("appends with end-array sentinel '-'", () => {
      const result = applyPatch({ items: [1, 2] }, [{ op: "add", path: "/items/-", value: 3 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ items: [1, 2, 3] });
    });

    it("fails on non-existent parent path", () => {
      const result = applyPatch({ a: 1 }, [{ op: "add", path: "/missing/x", value: 1 }]);
      expect(result.ok).toBe(false);
    });
  });

  describe("remove op", () => {
    it("removes an object property", () => {
      const result = applyPatch({ a: 1, b: 2 }, [{ op: "remove", path: "/a" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ b: 2 });
    });

    it("removes an array element by index", () => {
      const result = applyPatch({ items: [1, 2, 3] }, [{ op: "remove", path: "/items/1" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ items: [1, 3] });
    });

    it("fails on non-existent path", () => {
      const result = applyPatch({ a: 1 }, [{ op: "remove", path: "/missing" }]);
      expect(result.ok).toBe(false);
    });
  });

  describe("move op", () => {
    it("moves value from one path to another", () => {
      const result = applyPatch({ a: 1, b: 2 }, [{ op: "move", from: "/a", path: "/c" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ b: 2, c: 1 });
    });

    it("rejects moving a location into its own descendant (RFC 6902)", () => {
      const result = applyPatch({ a: { b: 1 } }, [{ op: "move", from: "/a", path: "/a/b/c" }]);
      expect(result.ok).toBe(false);
    });
  });

  describe("copy op", () => {
    it("copies value, keeping source", () => {
      const result = applyPatch({ a: { x: 1 } }, [{ op: "copy", from: "/a", path: "/b" }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ a: { x: 1 }, b: { x: 1 } });
    });
  });

  describe("test op", () => {
    it("succeeds with matching value and does not mutate", () => {
      const target = { a: 1 };
      const result = applyPatch(target, [{ op: "test", path: "/a", value: 1 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ a: 1 });
    });

    it("fails on value mismatch", () => {
      const result = applyPatch({ a: 1 }, [{ op: "test", path: "/a", value: 2 }]);
      expect(result.ok).toBe(false);
    });

    it("uses deep equality for objects", () => {
      const result = applyPatch({ a: { x: 1, y: 2 } }, [
        { op: "test", path: "/a", value: { x: 1, y: 2 } },
      ]);
      expect(result.ok).toBe(true);
    });
  });

  describe("pointer escaping", () => {
    it("unescapes ~1 to /", () => {
      const result = applyPatch({ "a/b": 1 }, [{ op: "replace", path: "/a~1b", value: 2 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ "a/b": 2 });
    });

    it("unescapes ~0 to ~", () => {
      const result = applyPatch({ "a~b": 1 }, [{ op: "replace", path: "/a~0b", value: 2 }]);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value).toEqual({ "a~b": 2 });
    });
  });

  describe("all-or-nothing", () => {
    it("aborts on a failing op, leaving input untouched", () => {
      const target = { a: 1, b: 2 };
      const result = applyPatch(target, [
        { op: "replace", path: "/a", value: 10 },
        { op: "test", path: "/b", value: 999 },
        { op: "replace", path: "/b", value: 20 },
      ]);
      expect(result.ok).toBe(false);
      expect(target).toEqual({ a: 1, b: 2 });
    });
  });

  describe("depth limit", () => {
    it("rejects pointers deeper than 32 segments", () => {
      const path = "/" + Array.from({ length: 33 }, (_, i) => `s${i}`).join("/");
      const result = applyPatch({}, [{ op: "replace", path, value: 1 }]);
      expect(result.ok).toBe(false);
    });
  });
});
