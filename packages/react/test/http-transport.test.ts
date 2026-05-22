import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  SessionNotFoundError,
  TransportHttpError,
} from "@kibadist/agentui-protocol";
import type { ActionEvent } from "@kibadist/agentui-protocol";
import { httpTransport } from "../src/http-transport.js";
import * as sseModule from "../src/sse-transport.js";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

let originalFetch: typeof globalThis.fetch;
beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("httpTransport", () => {
  describe("createSession", () => {
    it("POSTs /session for a fresh session and returns sessionId", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ sessionId: "ses_1" }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      const result = await t.createSession({});

      expect(result.sessionId).toBe("ses_1");
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/agent/session");
      expect(init?.method).toBe("POST");
    });

    it("includes conversationId in the URL when resuming", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ sessionId: "ses_resumed" }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      await t.createSession({ conversationId: "conv_1" });

      const [url] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/agent/session?conversationId=conv_1");
    });

    it("throws SessionNotFoundError on 404 when resuming", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("nope", { status: 404 }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      await expect(
        t.createSession({ conversationId: "conv_gone" }),
      ).rejects.toBeInstanceOf(SessionNotFoundError);
    });

    it("throws TransportHttpError on other non-2xx responses", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("server error", { status: 503 }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      const err = await t.createSession({}).catch((e) => e);
      expect(err).toBeInstanceOf(TransportHttpError);
      expect((err as TransportHttpError).status).toBe(503);
    });

    it("strips trailing slash from endpoint", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(jsonResponse({ sessionId: "ses_1" }));
      const t = httpTransport({ endpoint: "/api/agent/", fetch: fetchSpy });

      await t.createSession({});

      expect(fetchSpy.mock.calls[0][0]).toBe("/api/agent/session");
    });
  });

  describe("dispatchAction", () => {
    it("POSTs /action with the JSON-serialized action", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("", { status: 200 }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      const action: ActionEvent = {
        v: 1,
        id: "a-1",
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s",
        kind: "action",
        type: "action.submit",
        name: "purchase.confirm",
      };

      await t.dispatchAction({ action });

      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/agent/action");
      expect(init?.method).toBe("POST");
      expect(init?.body).toBe(JSON.stringify(action));
      expect((init?.headers as Record<string, string>)["Content-Type"]).toBe(
        "application/json",
      );
    });

    it("throws TransportHttpError on non-2xx (so hosts can instanceof-check 401)", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("nope", { status: 401 }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      const action = {
        v: 1,
        id: "a-1",
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s",
        kind: "action",
        type: "action.submit",
        name: "x",
      } as ActionEvent;

      const err = await t.dispatchAction({ action }).catch((e) => e);
      expect(err).toBeInstanceOf(TransportHttpError);
      expect((err as TransportHttpError).status).toBe(401);
    });
  });

  describe("getHistory", () => {
    it("GETs /history?sessionId=... and returns messages", async () => {
      const fetchSpy = vi.fn<typeof fetch>().mockResolvedValue(
        jsonResponse({
          messages: [{ role: "user", text: "hi", ts: "2026-01-01T00:00:00Z" }],
        }),
      );
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      const result = await t.getHistory({ sessionId: "ses_1" });

      expect(result.messages).toHaveLength(1);
      const [url, init] = fetchSpy.mock.calls[0];
      expect(url).toBe("/api/agent/history?sessionId=ses_1");
      expect(init?.method).toBe("GET");
    });

    it("returns empty messages on 404 — no history is not an error", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("", { status: 404 }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      const result = await t.getHistory({ sessionId: "ses_1" });
      expect(result.messages).toEqual([]);
    });

    it("throws TransportHttpError on other non-2xx responses", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("server error", { status: 500 }));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      const err = await t.getHistory({ sessionId: "ses_1" }).catch((e) => e);
      expect(err).toBeInstanceOf(TransportHttpError);
    });
  });

  describe("openStream", () => {
    it("delivers parsed AgentWireEvents — no raw SSE strings reach the consumer", async () => {
      // Stream the SSE wire payload through a real Response so the line parser exercises.
      const payload = JSON.stringify({
        v: 1,
        id: "evt-1",
        ts: "2026-01-01T00:00:00Z",
        sessionId: "s",
        op: "ui.toast",
        level: "info",
        message: "hi",
      });
      const sseBody = `data: ${payload}\n\n`;
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response(streamFromText(sseBody)));

      const t = httpTransport({ endpoint: "/api/agent" });
      const events: unknown[] = [];

      await t.openStream({
        sessionId: "s",
        signal: new AbortController().signal,
        onOpen: () => {},
        onEvent: (event) => events.push(event),
        onError: () => {},
      });

      expect(events).toHaveLength(1);
      // It's a parsed object, not a string — the contract we promised.
      expect(typeof events[0]).toBe("object");
      expect((events[0] as { op: string }).op).toBe("ui.toast");
    });

    it("invokes onInvalidEvent for non-JSON payloads", async () => {
      const sseBody = `data: not-json-at-all\n\n`;
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response(streamFromText(sseBody)));

      const t = httpTransport({ endpoint: "/api/agent" });
      const invalid: Array<{ raw: unknown; err: Error }> = [];

      await t.openStream({
        sessionId: "s",
        signal: new AbortController().signal,
        onOpen: () => {},
        onEvent: () => {},
        onInvalidEvent: (raw, err) => invalid.push({ raw, err }),
        onError: () => {},
      });

      expect(invalid).toHaveLength(1);
    });

    it("forwards headers (used by useAgentStream auth) to the SSE GET", async () => {
      const fetchSpy = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(streamFromText("")));
      const t = httpTransport({ endpoint: "/api/agent", fetch: fetchSpy });

      await t.openStream({
        sessionId: "s",
        headers: { Authorization: "Bearer xyz" },
        signal: new AbortController().signal,
        onOpen: () => {},
        onEvent: () => {},
        onError: () => {},
      });

      const init = fetchSpy.mock.calls[0][1];
      const headers = init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer xyz");
      expect(headers.Accept).toBe("text/event-stream");
    });

    it("uses the configured fetch override for the stream GET — global fetch is not called", async () => {
      const globalSpy = vi.fn();
      globalThis.fetch = globalSpy;
      const customFetch = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(streamFromText("")));
      const t = httpTransport({
        endpoint: "/api/agent",
        fetch: customFetch as unknown as typeof fetch,
      });

      await t.openStream({
        sessionId: "s",
        signal: new AbortController().signal,
        onOpen: () => {},
        onEvent: () => {},
        onError: () => {},
      });

      expect(customFetch).toHaveBeenCalledOnce();
      expect(globalSpy).not.toHaveBeenCalled();
    });

    it("delegates to connectSse internally (regression: transport composes the SSE helper, doesn't reimplement)", async () => {
      const spy = vi.spyOn(sseModule, "connectSse").mockResolvedValue();
      const t = httpTransport({ endpoint: "/api/agent" });

      await t.openStream({
        sessionId: "s",
        signal: new AbortController().signal,
        onOpen: () => {},
        onEvent: () => {},
        onError: () => {},
      });

      expect(spy).toHaveBeenCalledOnce();
      const opts = spy.mock.calls[0][0];
      expect(opts.url).toBe("/api/agent/stream?sessionId=s");
    });
  });
});
