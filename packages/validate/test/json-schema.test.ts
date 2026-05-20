import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv from "ajv";
import {
  safeParseUIEvent,
  safeParseActionEvent,
  safeParseAgentEvent,
} from "../src/parse.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCHEMA_DIR = join(__dirname, "..", "schema");

function loadSchema(filename: string): object {
  return JSON.parse(readFileSync(join(SCHEMA_DIR, filename), "utf8"));
}

const ajv = new Ajv({ allErrors: true, strict: false });

const base = {
  v: 1 as const,
  id: "e1",
  ts: "2026-05-19T00:00:00.000Z",
  sessionId: "s1",
};

describe("JSON Schema export — Ajv ↔ Zod cross-check", () => {
  it("ui-event.schema.json matches safeParseUIEvent for ui.append", () => {
    const schema = loadSchema("ui-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      op: "ui.append",
      node: { key: "k1", type: "x.y", props: {} },
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseUIEvent(valid).ok).toBe(true);
  });

  it("ui-event.schema.json rejects ui.append missing node (matches Zod)", () => {
    const schema = loadSchema("ui-event.schema.json");
    const validate = ajv.compile(schema);
    const invalid = { ...base, op: "ui.append" };
    expect(validate(invalid)).toBe(false);
    expect(safeParseUIEvent(invalid).ok).toBe(false);
  });

  it("agent-wire-event.schema.json accepts tool.start with all required fields", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      op: "tool.start",
      id: "call-1",
      name: "search_clients",
      args: { q: "Acme" },
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseAgentEvent(valid).ok).toBe(true);
  });

  it("agent-wire-event.schema.json rejects tool.start missing name (matches Zod)", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const invalid = { ...base, op: "tool.start", id: "call-1" };
    expect(validate(invalid)).toBe(false);
    expect(safeParseAgentEvent(invalid).ok).toBe(false);
  });

  it("action-event.schema.json accepts a valid action.submit", () => {
    const schema = loadSchema("action-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      kind: "action",
      type: "action.submit",
      name: "purchase.confirm",
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseActionEvent(valid).ok).toBe(true);
  });

  it("ui-node.schema.json accepts a nested UINode tree", () => {
    const schema = loadSchema("ui-node.schema.json");
    const validate = ajv.compile(schema);
    const node = {
      key: "root",
      type: "panel",
      props: {},
      children: [{ key: "child", type: "text", props: { value: "hi" } }],
    };
    expect(validate(node)).toBe(true);
  });

  it("agent-wire-event.schema.json accepts a valid workflow.start", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [
        { id: "a", title: "First" },
        { id: "b", title: "Second" },
      ],
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseAgentEvent(valid).ok).toBe(true);
  });

  it("agent-wire-event.schema.json rejects workflow.start with empty steps (matches Zod)", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const invalid = {
      ...base,
      op: "workflow.start",
      id: "wf1",
      steps: [],
    };
    expect(validate(invalid)).toBe(false);
    expect(safeParseAgentEvent(invalid).ok).toBe(false);
  });

  it("agent-wire-event.schema.json accepts session.init", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      op: "session.init",
      capabilities: { nodeTypes: ["x.y"], actions: ["do"], permissions: ["read"] },
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseAgentEvent(valid).ok).toBe(true);
  });

  it("agent-wire-event.schema.json accepts optimistic.apply", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = {
      ...base,
      op: "optimistic.apply",
      entityKey: "quote:1",
      patch: { status: "pending" },
      originId: "o1",
    };
    expect(validate(valid)).toBe(true);
    expect(safeParseAgentEvent(valid).ok).toBe(true);
  });

  it("agent-wire-event.schema.json accepts reasoning.start", () => {
    const schema = loadSchema("agent-wire-event.schema.json");
    const validate = ajv.compile(schema);
    const valid = { ...base, op: "reasoning.start", id: "r1" };
    expect(validate(valid)).toBe(true);
    expect(safeParseAgentEvent(valid).ok).toBe(true);
  });

  it("action-event.schema.json rejects action.approve missing approved (matches Zod)", () => {
    const schema = loadSchema("action-event.schema.json");
    const validate = ajv.compile(schema);
    const invalid = {
      ...base,
      kind: "action",
      type: "action.approve",
      name: "release.deploy",
    };
    expect(validate(invalid)).toBe(false);
    expect(safeParseActionEvent(invalid).ok).toBe(false);
  });
});
