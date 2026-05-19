/**
 * Pluggable async/sync storage for persisting conversation ids and other
 * session lifecycle data. The default `localStorageAdapter` is web-only;
 * React Native consumers pass a wrapper around AsyncStorage.
 */
export interface SessionStorageAdapter {
  get(key: string): Promise<string | null> | string | null;
  set(key: string, value: string): Promise<void> | void;
  remove(key: string): Promise<void> | void;
}

const hasLocalStorage = (): boolean => {
  try {
    return typeof localStorage !== "undefined";
  } catch {
    return false;
  }
};

/** Web default. Safe in SSR — falls back to in-memory no-op when localStorage isn't available. */
export const localStorageAdapter: SessionStorageAdapter = {
  get(key) {
    if (!hasLocalStorage()) return null;
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key, value) {
    if (!hasLocalStorage()) return;
    try {
      localStorage.setItem(key, value);
    } catch {
      // Quota exceeded / privacy mode — swallow.
    }
  },
  remove(key) {
    if (!hasLocalStorage()) return;
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  },
};
