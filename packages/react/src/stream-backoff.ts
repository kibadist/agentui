export interface BackoffOptions {
  initialDelayMs: number;
  maxDelayMs: number;
  jitter: "none" | "full" | "equal";
}

/**
 * Pure exponential backoff with jitter. `attempt` is 0-indexed. `rng` is
 * injectable for tests; defaults to `Math.random`.
 */
export function computeBackoff(
  attempt: number,
  opts: BackoffOptions,
  rng: () => number = Math.random,
): number {
  const raw = Math.min(opts.initialDelayMs * Math.pow(2, attempt), opts.maxDelayMs);
  switch (opts.jitter) {
    case "none":
      return raw;
    case "full":
      return Math.floor(raw * rng());
    case "equal":
      return Math.floor(raw / 2 + (raw / 2) * rng());
  }
}
