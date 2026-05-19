/**
 * Structured error surfaced by `<AgentRoot>` via `onError`. Discriminated by
 * `kind` so hosts can branch (e.g., show a retry button for `stream` failures
 * but not for `session-create`).
 */
export interface AgentError {
  kind: "session-create" | "session-resume" | "history-fetch" | "stream";
  message: string;
  /** The underlying error (Response, Error, unknown) if available. */
  cause?: unknown;
}
