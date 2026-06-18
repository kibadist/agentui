import type { JsonPatchOp } from "@kibadist/agentui-protocol";

export type ApplyResult =
  | { ok: true; value: unknown }
  | { ok: false; error: string };

const MAX_DEPTH = 32;

function parsePointer(pointer: string): string[] | { error: string } {
  if (pointer === "") return [];
  if (pointer[0] !== "/") return { error: `invalid pointer: ${pointer}` };
  const parts = pointer.slice(1).split("/");
  if (parts.length > MAX_DEPTH) return { error: `pointer depth exceeds ${MAX_DEPTH}` };
  return parts.map((seg) => seg.replace(/~1/g, "/").replace(/~0/g, "~"));
}

/** True when `prefix` is a strict ancestor path of `path` (proper prefix). */
function isProperPrefix(prefix: string[], path: string[]): boolean {
  if (prefix.length >= path.length) return false;
  return prefix.every((seg, i) => seg === path[i]);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    const ak = Object.keys(ao);
    const bk = Object.keys(bo);
    if (ak.length !== bk.length) return false;
    return ak.every((k) => k in bo && deepEqual(ao[k], bo[k]));
  }
  return false;
}

function isArrayIndex(seg: string, len: number, forAdd: boolean): number | null {
  if (forAdd && seg === "-") return len;
  if (!/^(0|[1-9][0-9]*)$/.test(seg)) return null;
  const n = Number(seg);
  if (n > 100_000) return null;
  if (forAdd ? n > len : n >= len) return null;
  return n;
}

function getAt(value: unknown, path: string[]): { ok: true; value: unknown } | { ok: false; error: string } {
  let cur = value;
  for (let i = 0; i < path.length; i++) {
    const seg = path[i];
    if (Array.isArray(cur)) {
      const idx = isArrayIndex(seg, cur.length, false);
      if (idx === null) return { ok: false, error: `bad array index "${seg}"` };
      cur = cur[idx];
    } else if (cur !== null && typeof cur === "object") {
      const obj = cur as Record<string, unknown>;
      if (!(seg in obj)) return { ok: false, error: `path not found: /${path.slice(0, i + 1).join("/")}` };
      cur = obj[seg];
    } else {
      return { ok: false, error: `cannot traverse into primitive at /${path.slice(0, i).join("/")}` };
    }
  }
  return { ok: true, value: cur };
}

function setAt(
  value: unknown,
  path: string[],
  newValue: unknown,
  mode: "add" | "replace",
): { ok: true; value: unknown } | { ok: false; error: string } {
  if (path.length === 0) return { ok: true, value: newValue };
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const arr = [...value];
    if (rest.length === 0) {
      const idx = isArrayIndex(head, arr.length, mode === "add");
      if (idx === null) return { ok: false, error: `bad array index "${head}"` };
      if (mode === "add") arr.splice(idx, 0, newValue);
      else arr[idx] = newValue;
      return { ok: true, value: arr };
    }
    const idx = isArrayIndex(head, arr.length, false);
    if (idx === null) return { ok: false, error: `bad array index "${head}"` };
    const inner = setAt(arr[idx], rest, newValue, mode);
    if (!inner.ok) return inner;
    arr[idx] = inner.value;
    return { ok: true, value: arr };
  }
  if (value !== null && typeof value === "object") {
    const obj = { ...(value as Record<string, unknown>) };
    if (rest.length === 0) {
      if (mode === "replace" && !(head in obj)) {
        return { ok: false, error: `path not found: /${head}` };
      }
      obj[head] = newValue;
      return { ok: true, value: obj };
    }
    if (!(head in obj)) return { ok: false, error: `path not found: /${head}` };
    const inner = setAt(obj[head], rest, newValue, mode);
    if (!inner.ok) return inner;
    obj[head] = inner.value;
    return { ok: true, value: obj };
  }
  return { ok: false, error: `cannot traverse into primitive` };
}

function removeAt(value: unknown, path: string[]): { ok: true; value: unknown } | { ok: false; error: string } {
  if (path.length === 0) return { ok: false, error: "cannot remove root" };
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const arr = [...value];
    const idx = isArrayIndex(head, arr.length, false);
    if (idx === null) return { ok: false, error: `bad array index "${head}"` };
    if (rest.length === 0) {
      arr.splice(idx, 1);
      return { ok: true, value: arr };
    }
    const inner = removeAt(arr[idx], rest);
    if (!inner.ok) return inner;
    arr[idx] = inner.value;
    return { ok: true, value: arr };
  }
  if (value !== null && typeof value === "object") {
    const obj = { ...(value as Record<string, unknown>) };
    if (!(head in obj)) return { ok: false, error: `path not found: /${head}` };
    if (rest.length === 0) {
      delete obj[head];
      return { ok: true, value: obj };
    }
    const inner = removeAt(obj[head], rest);
    if (!inner.ok) return inner;
    obj[head] = inner.value;
    return { ok: true, value: obj };
  }
  return { ok: false, error: `cannot traverse into primitive` };
}

function applyOp(value: unknown, op: JsonPatchOp): { ok: true; value: unknown } | { ok: false; error: string } {
  const path = parsePointer(op.path);
  if ("error" in path) return { ok: false, error: path.error };
  switch (op.op) {
    case "add":
      return setAt(value, path, op.value, "add");
    case "replace":
      return setAt(value, path, op.value, "replace");
    case "remove":
      return removeAt(value, path);
    case "test": {
      const got = getAt(value, path);
      if (!got.ok) return got;
      if (!deepEqual(got.value, op.value)) {
        return { ok: false, error: `test failed at ${op.path}` };
      }
      return { ok: true, value };
    }
    case "move": {
      const from = parsePointer(op.from);
      if ("error" in from) return { ok: false, error: from.error };
      // RFC 6902: a location cannot be moved into one of its own children.
      if (isProperPrefix(from, path)) {
        return {
          ok: false,
          error: `cannot move into own descendant: ${op.from} -> ${op.path}`,
        };
      }
      const got = getAt(value, from);
      if (!got.ok) return got;
      const removed = removeAt(value, from);
      if (!removed.ok) return removed;
      return setAt(removed.value, path, got.value, "add");
    }
    case "copy": {
      const from = parsePointer(op.from);
      if ("error" in from) return { ok: false, error: from.error };
      const got = getAt(value, from);
      if (!got.ok) return got;
      return setAt(value, path, got.value, "add");
    }
  }
}

export function applyPatch(target: unknown, patch: JsonPatchOp[]): ApplyResult {
  let cur = target;
  for (const op of patch) {
    const result = applyOp(cur, op);
    if (!result.ok) return result;
    cur = result.value;
  }
  return { ok: true, value: cur };
}
