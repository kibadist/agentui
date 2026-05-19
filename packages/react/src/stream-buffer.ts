export type OverflowStrategy = "drop-oldest" | "drop-newest" | "block-stream" | "callback";

export interface BufferOptions<T> {
  max: number;
  onOverflow: OverflowStrategy;
  onOverflowCallback?: (dropped: T) => void;
}

export interface Buffer<T> {
  enqueue(value: T): void;
  drain(dispatch: (value: T) => void): void;
  waitForCapacity(): Promise<void>;
  clear(): void;
}

export function createBuffer<T>(opts: BufferOptions<T>): Buffer<T> {
  const queue: T[] = [];
  const waiters: Array<() => void> = [];

  function notifyWaiters() {
    while (waiters.length > 0 && queue.length < opts.max) {
      const w = waiters.shift();
      w?.();
    }
  }

  return {
    enqueue(value) {
      if (queue.length < opts.max) {
        queue.push(value);
        return;
      }
      switch (opts.onOverflow) {
        case "drop-oldest": {
          const evicted = queue.shift() as T;
          queue.push(value);
          opts.onOverflowCallback?.(evicted);
          return;
        }
        case "drop-newest":
        case "callback": {
          opts.onOverflowCallback?.(value);
          return;
        }
        case "block-stream": {
          // Caller should waitForCapacity() before enqueue; if they didn't,
          // we drop newest as a safety net.
          opts.onOverflowCallback?.(value);
          return;
        }
      }
    },

    drain(dispatch) {
      while (queue.length > 0) {
        const value = queue.shift() as T;
        dispatch(value);
      }
      notifyWaiters();
    },

    waitForCapacity() {
      if (opts.onOverflow !== "block-stream") return Promise.resolve();
      if (queue.length < opts.max) return Promise.resolve();
      return new Promise<void>((resolve) => waiters.push(resolve));
    },

    clear() {
      queue.length = 0;
      notifyWaiters();
    },
  };
}
