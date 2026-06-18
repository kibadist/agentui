import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { UIEvent } from "@kibadist/agentui-protocol";
import { AgentSessionService } from "../src/session.service.js";

const uiEvent = { v: 1, id: "e1", ts: "t", sessionId: "s", op: "ui.toast", level: "info", message: "hi" } as unknown as UIEvent;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("AgentSessionService idle TTL", () => {
  it("evicts a session after ttlMs of inactivity", () => {
    const svc = new AgentSessionService({ ttlMs: 1000, cleanupIntervalMs: 100 });
    svc.create("s");
    expect(svc.get("s")).toBeDefined();

    vi.advanceTimersByTime(1100); // no activity → past TTL
    expect(svc.get("s")).toBeUndefined();
    svc.stopCleanup();
  });

  it("does NOT evict an actively-streaming session (activity resets the clock)", () => {
    const svc = new AgentSessionService({ ttlMs: 1000, cleanupIntervalMs: 100 });
    svc.create("s");

    vi.advanceTimersByTime(800);
    svc.emitUI("s", uiEvent); // activity — resets idle clock
    vi.advanceTimersByTime(800); // 1600ms since create, but only 800ms idle
    expect(svc.get("s")).toBeDefined();

    vi.advanceTimersByTime(1100); // now idle past TTL
    expect(svc.get("s")).toBeUndefined();
    svc.stopCleanup();
  });

  it("auto-starts the cleanup sweep on construction (no manual startCleanup)", () => {
    const svc = new AgentSessionService({ ttlMs: 500, cleanupIntervalMs: 100 });
    svc.create("s");
    vi.advanceTimersByTime(700);
    expect(svc.get("s")).toBeUndefined();
    svc.stopCleanup();
  });

  it("autoCleanup:false leaves sessions until cleanup is driven manually", () => {
    const svc = new AgentSessionService({ ttlMs: 500, cleanupIntervalMs: 100, autoCleanup: false });
    svc.create("s");
    vi.advanceTimersByTime(700);
    expect(svc.get("s")).toBeDefined(); // no sweep running
    svc.startCleanup();
    vi.advanceTimersByTime(100);
    expect(svc.get("s")).toBeUndefined();
    svc.stopCleanup();
  });
});
