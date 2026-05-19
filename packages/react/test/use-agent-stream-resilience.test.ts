import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAgentStream } from "../src/use-agent-stream.js";
import * as sseModule from "../src/sse-transport.js";

type ConnectOpts = Parameters<typeof sseModule.connectSse>[0];

let connectSpy: ReturnType<typeof vi.spyOn>;
let connectCalls: ConnectOpts[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  connectCalls = [];
  connectSpy = vi.spyOn(sseModule, "connectSse").mockImplementation(async (opts) => {
    connectCalls.push(opts);
    return new Promise<void>((resolve) => {
      opts.signal.addEventListener("abort", () => resolve());
    });
  });
});

afterEach(() => {
  vi.useRealTimers();
  connectSpy.mockRestore();
});

describe("useAgentStream — retry", () => {
  it("retries with backoff after transient failures", async () => {
    let attempts = 0;
    connectSpy.mockImplementation(async (opts) => {
      attempts++;
      if (attempts < 3) {
        opts.onError(new Error("transient"));
        return;
      }
      opts.onOpen();
      await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        retry: { maxAttempts: 5, initialDelayMs: 100, maxDelayMs: 1000, jitter: "none" },
      }),
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(attempts).toBe(1);
    expect(result.current.status).toBe("reconnecting");

    await act(async () => { await vi.advanceTimersByTimeAsync(100); });
    expect(attempts).toBe(2);

    await act(async () => { await vi.advanceTimersByTimeAsync(200); });
    expect(attempts).toBe(3);

    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.status).toBe("open");
  });

  it("gives up after maxAttempts and stays in error", async () => {
    const onGiveUp = vi.fn();
    connectSpy.mockImplementation(async (opts) => {
      opts.onError(new Error("permanent"));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        retry: { maxAttempts: 2, initialDelayMs: 50, maxDelayMs: 100, jitter: "none", onGiveUp },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      await vi.advanceTimersByTimeAsync(50);
      await vi.advanceTimersByTimeAsync(100);
    });

    expect(onGiveUp).toHaveBeenCalledOnce();
    expect(result.current.status).toBe("error");
  });
});

describe("useAgentStream — auth", () => {
  it("refreshes token on 401 and reconnects", async () => {
    const getToken = vi.fn().mockResolvedValueOnce("t1").mockResolvedValueOnce("t2");
    const onUnauthorized = vi.fn().mockResolvedValue(undefined);

    let call = 0;
    connectSpy.mockImplementation(async (opts) => {
      connectCalls.push(opts);
      call++;
      if (call === 1) {
        opts.onError(new sseModule.SseHttpError(401, "Unauthorized"));
        return;
      }
      opts.onOpen();
      await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        retry: { maxAttempts: 5, initialDelayMs: 0, maxDelayMs: 0, jitter: "none" },
        auth: { getToken, onUnauthorized },
      }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(getToken).toHaveBeenCalledTimes(2);
    expect(onUnauthorized).toHaveBeenCalledOnce();
    expect(connectCalls[0].headers?.Authorization).toBe("Bearer t1");
    expect(connectCalls[1].headers?.Authorization).toBe("Bearer t2");
    expect(result.current.status).toBe("open");
  });
});

describe("useAgentStream — buffer", () => {
  it("drop-oldest keeps the most recent events", async () => {
    connectSpy.mockImplementation(async (opts) => {
      opts.onOpen();
      for (let i = 0; i < 50; i++) {
        opts.onEvent(
          JSON.stringify({
            v: 1,
            id: `e-${i}`,
            ts: new Date().toISOString(),
            sessionId: "s",
            op: "ui.append",
            node: { key: `n-${i}`, type: "text-block", props: { text: `${i}` } },
          }),
          `e-${i}`,
        );
      }
      await new Promise<void>((r) => opts.signal.addEventListener("abort", () => r()));
    });

    const { result } = renderHook(() =>
      useAgentStream({
        url: "http://x",
        sessionId: "s",
        buffer: { max: 10, onOverflow: "drop-oldest" },
      }),
    );

    await act(async () => { await vi.advanceTimersByTimeAsync(50); });

    expect(result.current.state.nodes.length).toBe(10);
    expect(result.current.state.nodes.at(-1)?.key).toBe("n-49");
  });
});
