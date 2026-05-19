import { describe, it, expect, vi } from "vitest";
import { createBuffer } from "../src/stream-buffer.js";

describe("createBuffer", () => {
  it("enqueues up to max, drains in order", () => {
    const buf = createBuffer<number>({ max: 3, onOverflow: "drop-newest" });
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3);
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([1, 2, 3]);
  });

  it("drop-oldest drops the head when full", () => {
    const dropped: number[] = [];
    const buf = createBuffer<number>({
      max: 3,
      onOverflow: "drop-oldest",
      onOverflowCallback: (v) => dropped.push(v),
    });
    for (let i = 1; i <= 5; i++) buf.enqueue(i);
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([3, 4, 5]);
    expect(dropped).toEqual([1, 2]);
  });

  it("drop-newest drops the incoming event", () => {
    const dropped: number[] = [];
    const buf = createBuffer<number>({
      max: 3,
      onOverflow: "drop-newest",
      onOverflowCallback: (v) => dropped.push(v),
    });
    for (let i = 1; i <= 5; i++) buf.enqueue(i);
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([1, 2, 3]);
    expect(dropped).toEqual([4, 5]);
  });

  it("callback strategy = drop-newest with required callback", () => {
    const dropped: number[] = [];
    const buf = createBuffer<number>({
      max: 2,
      onOverflow: "callback",
      onOverflowCallback: (v) => dropped.push(v),
    });
    buf.enqueue(1);
    buf.enqueue(2);
    buf.enqueue(3); // dropped
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([1, 2]);
    expect(dropped).toEqual([3]);
  });

  it("block-stream returns a pending promise from waitForCapacity when full", async () => {
    const buf = createBuffer<number>({ max: 2, onOverflow: "block-stream" });
    buf.enqueue(1);
    buf.enqueue(2);

    let resolved = false;
    const wait = buf.waitForCapacity().then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    buf.drain(() => {});
    await wait;
    expect(resolved).toBe(true);
  });

  it("waitForCapacity resolves immediately when there is room", async () => {
    const buf = createBuffer<number>({ max: 2, onOverflow: "block-stream" });
    buf.enqueue(1);
    await expect(buf.waitForCapacity()).resolves.toBeUndefined();
  });

  it("clear empties the queue", () => {
    const buf = createBuffer<number>({ max: 10, onOverflow: "drop-newest" });
    buf.enqueue(1);
    buf.enqueue(2);
    buf.clear();
    const out: number[] = [];
    buf.drain((v) => out.push(v));
    expect(out).toEqual([]);
  });

  it("max=Infinity means unbounded (no overflow ever)", () => {
    const cb = vi.fn();
    const buf = createBuffer<number>({
      max: Infinity,
      onOverflow: "drop-newest",
      onOverflowCallback: cb,
    });
    for (let i = 0; i < 10_000; i++) buf.enqueue(i);
    expect(cb).not.toHaveBeenCalled();
  });
});
