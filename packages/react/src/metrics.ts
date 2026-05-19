export interface Metric {
  name: string;
  value: number;
  kind: "timing" | "counter";
  tags: Record<string, string>;
}

export interface MetricEmitter {
  timing(name: string, value: number, tags?: Record<string, string>): void;
  counter(name: string, tags?: Record<string, string>): void;
}

const NOOP_EMITTER: MetricEmitter = {
  timing() {},
  counter() {},
};

/**
 * Build a metric emitter. If `onMetric` is undefined, returns a no-op
 * emitter with zero allocations per call.
 */
export function createMetricEmitter(
  onMetric: ((m: Metric) => void) | undefined,
  hostTags: Record<string, string>,
): MetricEmitter {
  if (onMetric === undefined) {
    return NOOP_EMITTER;
  }
  return {
    timing(name, value, tags) {
      onMetric({
        name,
        value,
        kind: "timing",
        tags: tags ? { ...hostTags, ...tags } : { ...hostTags },
      });
    },
    counter(name, tags) {
      onMetric({
        name,
        value: 1,
        kind: "counter",
        tags: tags ? { ...hostTags, ...tags } : { ...hostTags },
      });
    },
  };
}

/**
 * FNV-1a 32-bit hash, lowercase 8 hex chars. Anonymizes session ids
 * before they land in metric tags.
 */
export function hashSessionId(sessionId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < sessionId.length; i++) {
    hash ^= sessionId.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}
