import { describe, it, expect } from "vitest";
import { computeBackoff, type BackoffOptions } from "../src/stream-backoff.js";

const base: BackoffOptions = {
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: "none",
};

describe("computeBackoff", () => {
  it("doubles per attempt with jitter=none", () => {
    expect(computeBackoff(0, base, () => 0.5)).toBe(500);
    expect(computeBackoff(1, base, () => 0.5)).toBe(1000);
    expect(computeBackoff(2, base, () => 0.5)).toBe(2000);
    expect(computeBackoff(3, base, () => 0.5)).toBe(4000);
  });

  it("caps at maxDelayMs", () => {
    expect(computeBackoff(20, base, () => 0.5)).toBe(30_000);
    expect(computeBackoff(100, base, () => 0.5)).toBe(30_000);
  });

  it("jitter=full → random(0, raw)", () => {
    const opts = { ...base, jitter: "full" as const };
    expect(computeBackoff(0, opts, () => 0)).toBe(0);
    expect(computeBackoff(0, opts, () => 0.5)).toBe(250);
    expect(computeBackoff(0, opts, () => 1)).toBe(500);
  });

  it("jitter=equal → raw/2 + random(0, raw/2)", () => {
    const opts = { ...base, jitter: "equal" as const };
    expect(computeBackoff(0, opts, () => 0)).toBe(250);
    expect(computeBackoff(0, opts, () => 1)).toBe(500);
    expect(computeBackoff(1, opts, () => 0.5)).toBe(750);
  });

  it("defaults: rng defaults to Math.random", () => {
    const v = computeBackoff(0, { ...base, jitter: "full" });
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThanOrEqual(500);
  });
});
