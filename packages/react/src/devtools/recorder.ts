"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";
import { useAgentStore } from "../agent-state-context.js";
import type { AgentAction, AgentState, AgentResetAction } from "../reducer.js";

/** A captured action plus its dispatch-time metadata and resulting state. */
export interface RecordedEvent {
  /** Monotonic seq starting at 0 from recorder mount. Never reset, even after eviction. */
  seq: number;
  /** The raw action that ran (wire event or synthetic __reset__). */
  action: Exclude<AgentAction, AgentResetAction> | AgentResetAction;
  /** Recorder-clock timestamp (ms since epoch, captured at insertion). */
  capturedAt: number;
  /** State after applying this action. */
  state: AgentState;
  /** Ms taken by the store's listener-notify loop for this dispatch. */
  dispatchMs: number;
}

/** Options for the recorder hook. */
export interface UseAgentDevToolsRecorderOptions {
  /** Max events to retain in the ring buffer. Default 500. */
  maxEvents?: number;
}

/** Recorder snapshot returned by the hook. */
export interface UseAgentDevToolsRecorderResult {
  /** All currently buffered events (oldest first). */
  events: RecordedEvent[];
  /** Total count of events seen since mount (including evicted ones). */
  totalSeen: number;
}

/**
 * Subscribe to every non-no-op action on the current `AgentStore` and keep a
 * ring buffer of the last `maxEvents` `RecordedEvent`s. Re-renders the
 * consuming component at most once per animation frame to absorb bursty
 * streams.
 *
 * MUST be used inside an `<AgentStateProvider>` (i.e., inside `<AgentRoot>`).
 */
export function useAgentDevToolsRecorder(
  options: UseAgentDevToolsRecorderOptions = {},
): UseAgentDevToolsRecorderResult {
  const { maxEvents = 500 } = options;
  const store = useAgentStore();

  const eventsRef = useRef<RecordedEvent[]>([]);
  const totalRef = useRef(0);
  const versionRef = useRef(0);
  const rafScheduledRef = useRef(false);
  const listenersRef = useRef<Set<() => void>>(new Set());

  // Stable subscribe/getSnapshot pair for useSyncExternalStore.
  const subscribeRef = useRef((cb: () => void) => {
    listenersRef.current.add(cb);
    return () => {
      listenersRef.current.delete(cb);
    };
  });
  const getSnapshotRef = useRef(() => versionRef.current);

  useEffect(() => {
    const unsub = store.subscribeAction((action, nextState, dispatchMs) => {
      const seq = totalRef.current++;
      const ev: RecordedEvent = {
        seq,
        action,
        capturedAt: Date.now(),
        state: nextState,
        dispatchMs,
      };
      const buf = eventsRef.current;
      buf.push(ev);
      while (buf.length > maxEvents) buf.shift();

      // Throttle: schedule at most one rerender per animation frame.
      if (!rafScheduledRef.current) {
        rafScheduledRef.current = true;
        const flush = () => {
          rafScheduledRef.current = false;
          versionRef.current++;
          listenersRef.current.forEach((l) => l());
        };
        if (typeof requestAnimationFrame === "function") {
          requestAnimationFrame(flush);
        } else {
          // Test envs without rAF: flush microtask.
          Promise.resolve().then(flush);
        }
      }
    });
    return unsub;
  }, [store, maxEvents]);

  // Bump version every time someone calls `useSyncExternalStore` to read the
  // latest events. The events array reference itself is mutable, so we return
  // a shallow copy on each snapshot read (cheap relative to the panel's own
  // render cost).
  useSyncExternalStore(subscribeRef.current, getSnapshotRef.current, getSnapshotRef.current);

  return {
    events: eventsRef.current.slice(),
    totalSeen: totalRef.current,
  };
}
