import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { connectSse, SseHttpError } from "../src/sse-transport.js";

function streamFromText(text: string): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
}

function mockResponse(body: string, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(streamFromText(body), { status, headers });
}

let originalFetch: typeof globalThis.fetch;

beforeEach(() => {
  originalFetch = globalThis.fetch;
});
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("connectSse", () => {
  it("parses a single data event", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`data: hello\n\n`));
    const events: Array<{ raw: string; id: string | undefined }> = [];
    const onOpen = vi.fn();
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw, id) => events.push({ raw, id }),
      onOpen,
      onError: () => {},
    });
    expect(onOpen).toHaveBeenCalledOnce();
    expect(events).toEqual([{ raw: "hello", id: undefined }]);
  });

  it("captures id field", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`id: abc\ndata: foo\n\n`));
    const events: Array<{ raw: string; id: string | undefined }> = [];
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw, id) => events.push({ raw, id }),
      onOpen: () => {},
      onError: () => {},
    });
    expect(events).toEqual([{ raw: "foo", id: "abc" }]);
  });

  it("ignores comments and heartbeats", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`:keepalive\ndata: x\n\n`));
    const events: Array<{ raw: string }> = [];
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw) => events.push({ raw }),
      onOpen: () => {},
      onError: () => {},
    });
    expect(events).toEqual([{ raw: "x" }]);
  });

  it("joins multi-line data with newlines", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`data: line1\ndata: line2\n\n`));
    const events: string[] = [];
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw) => events.push(raw),
      onOpen: () => {},
      onError: () => {},
    });
    expect(events).toEqual(["line1\nline2"]);
  });

  it("parses CRLF-terminated streams (strips trailing \\r)", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse(`id: abc\r\ndata: hello\r\n\r\n`));
    const events: Array<{ raw: string; id: string | undefined }> = [];
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: (raw, id) => events.push({ raw, id }),
      onOpen: () => {},
      onError: () => {},
    });
    expect(events).toEqual([{ raw: "hello", id: "abc" }]);
  });

  it("emits SseHttpError on non-2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("nope", { status: 401 }));
    let err: Error | null = null;
    await connectSse({
      url: "x",
      signal: new AbortController().signal,
      onEvent: () => {},
      onOpen: () => {},
      onError: (e) => { err = e; },
    });
    expect(err).toBeInstanceOf(SseHttpError);
    expect((err as unknown as SseHttpError).status).toBe(401);
  });

  it("forwards headers and lastEventId", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(``));
    globalThis.fetch = fetchSpy;
    await connectSse({
      url: "x",
      headers: { Authorization: "Bearer t" },
      lastEventId: "evt-9",
      signal: new AbortController().signal,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer t");
    expect(headers["Last-Event-ID"]).toBe("evt-9");
    expect(headers["Accept"]).toBe("text/event-stream");
  });

  it("uses the supplied fetch override and leaves global fetch untouched", async () => {
    const globalSpy = vi.fn();
    globalThis.fetch = globalSpy;
    const customFetch = vi.fn().mockResolvedValue(mockResponse(`data: hi\n\n`));
    const events: string[] = [];
    await connectSse({
      url: "x",
      fetch: customFetch as unknown as typeof fetch,
      signal: new AbortController().signal,
      onEvent: (raw) => events.push(raw),
      onOpen: () => {},
      onError: () => {},
    });
    expect(customFetch).toHaveBeenCalledOnce();
    expect(globalSpy).not.toHaveBeenCalled();
    expect(events).toEqual(["hi"]);
  });

  it("respects abort signal", async () => {
    const ctrl = new AbortController();
    globalThis.fetch = vi.fn().mockImplementation(
      (_u: string, init: RequestInit) =>
        new Promise((_, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    );
    const p = connectSse({
      url: "x",
      signal: ctrl.signal,
      onEvent: () => {},
      onOpen: () => {},
      onError: () => {},
    });
    ctrl.abort();
    await expect(p).resolves.toBeUndefined();
  });
});
