import type {
  AgentWireEvent,
  UIAppendEvent,
  UIReplacePropsEvent,
  UIReplacePatchEvent,
  UIRemoveEvent,
  UIToastEvent,
  UINavigateEvent,
  UIResetEvent,
  ToolCallStartEvent,
  ToolArgsDeltaEvent,
  ToolCallResultEvent,
  ToolCallCancelEvent,
  ReasoningStartEvent,
  ReasoningDeltaEvent,
  ReasoningEndEvent,
  OptimisticApplyEvent,
  OptimisticConfirmEvent,
  OptimisticRollbackEvent,
  SessionMetaEvent,
  SessionInitEvent,
} from "@kibadist/agentui-protocol";

/**
 * Per-event input shape: caller provides everything except v/id/ts/sessionId
 * which the stream fills in. id/ts/traceId remain overridable.
 */
type OmitBase<T> = Omit<T, "v" | "id" | "ts" | "sessionId"> & {
  id?: string;
  ts?: string;
  traceId?: string;
};

export type EmitInput =
  | OmitBase<UIAppendEvent>
  | OmitBase<UIReplacePropsEvent>
  | OmitBase<UIReplacePatchEvent>
  | OmitBase<UIRemoveEvent>
  | OmitBase<UIToastEvent>
  | OmitBase<UINavigateEvent>
  | OmitBase<UIResetEvent>
  | OmitBase<ToolCallStartEvent>
  | OmitBase<ToolArgsDeltaEvent>
  | OmitBase<ToolCallResultEvent>
  | OmitBase<ToolCallCancelEvent>
  | OmitBase<ReasoningStartEvent>
  | OmitBase<ReasoningDeltaEvent>
  | OmitBase<ReasoningEndEvent>
  | OmitBase<OptimisticApplyEvent>
  | OmitBase<OptimisticConfirmEvent>
  | OmitBase<OptimisticRollbackEvent>
  | OmitBase<SessionMetaEvent>
  | OmitBase<SessionInitEvent>;

export interface AgentStream {
  /** Emit an event. Resolves once the wire has accepted (or buffered) the frame. */
  emit(event: EmitInput): Promise<void>;
  /** Send an SSE comment line (`: <text>\n\n`). Useful as a manual heartbeat. */
  comment(text: string): Promise<void>;
  /** Close the underlying transport. Idempotent. */
  close(): Promise<void>;
  /** True once close() has been called OR the consumer disconnected. */
  readonly closed: boolean;
}

export interface AgentStreamOptions {
  /** Required; stamped onto every emitted event. */
  sessionId: string;
  /** Optional; default traceId stamped on events (overridable per emit). */
  traceId?: string;
  /** Headers merged onto the SSE response. Caller wins on conflict. */
  headers?: Record<string, string>;
  /** Heartbeat interval in ms (0 to disable). Default 15000. */
  heartbeatMs?: number;
  /** Fires after each event is written to the wire. */
  onEventEmitted?: (event: AgentWireEvent) => void;
  // /** If set, each emitted event is also forwarded to conversation.append. */
  // conversation?: import("./conversation.js").Conversation;
}
