import { z } from "zod";

// ─── Base ────────────────────────────────────────────────────────────────────

const baseEventSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1).max(256),
  ts: z.string().min(1).max(64),
  traceId: z.string().max(256).optional(),
  sessionId: z.string().min(1).max(256),
});

// ─── UINode ──────────────────────────────────────────────────────────────────

const uiNodeMetaSchema = z
  .object({
    ttlMs: z.number().int().positive().optional(),
    requires: z.array(z.string()).optional(),
  })
  .strict();

export const uiNodeSchema: z.ZodType<{
  key: string;
  type: string;
  props: Record<string, unknown>;
  slot?: string;
  children?: { key: string; type: string; props: Record<string, unknown> }[];
  meta?: { ttlMs?: number; requires?: string[] };
}> = z.lazy(() =>
  z.object({
    key: z.string().min(1).max(256),
    type: z.string().min(1).max(128),
    props: z.record(z.string(), z.any()),
    slot: z.string().max(128).optional(),
    children: z.array(uiNodeSchema).optional(),
    meta: uiNodeMetaSchema.optional(),
  }),
);

// ─── UI Events ───────────────────────────────────────────────────────────────

const uiAppendSchema = baseEventSchema.extend({
  op: z.literal("ui.append"),
  node: uiNodeSchema,
  index: z.number().int().nonnegative().optional(),
  turnId: z.string().max(256).optional(),
});

const uiReplaceSchema = baseEventSchema.extend({
  op: z.literal("ui.replace"),
  key: z.string().min(1).max(256),
  props: z.record(z.string(), z.any()),
  replace: z.boolean().optional(),
});

const uiRemoveSchema = baseEventSchema.extend({
  op: z.literal("ui.remove"),
  key: z.string().min(1).max(256),
});

const uiToastSchema = baseEventSchema.extend({
  op: z.literal("ui.toast"),
  level: z.enum(["info", "success", "warning", "error"]),
  message: z.string().min(1).max(1024),
});

const uiNavigateSchema = baseEventSchema.extend({
  op: z.literal("ui.navigate"),
  href: z.string().min(1).max(2048),
  replace: z.boolean().optional(),
});

const uiResetSchema = baseEventSchema.extend({
  op: z.literal("ui.reset"),
});

export const uiEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema,
  uiReplaceSchema,
  uiRemoveSchema,
  uiToastSchema,
  uiNavigateSchema,
  uiResetSchema,
]);

// ─── Tool-Call Events ────────────────────────────────────────────────────────

const toolStartSchema = baseEventSchema.extend({
  op: z.literal("tool.start"),
  id: z.string().min(1).max(256),
  name: z.string().min(1).max(256),
  args: z.unknown().optional(),
  turnId: z.string().max(256).optional(),
});

const toolArgsDeltaSchema = baseEventSchema.extend({
  op: z.literal("tool.args-delta"),
  id: z.string().min(1).max(256),
  delta: z.string().max(64_000),
});

const toolResultSchema = baseEventSchema.extend({
  op: z.literal("tool.result"),
  id: z.string().min(1).max(256),
  status: z.enum(["ok", "error"]),
  result: z.unknown().optional(),
  error: z
    .object({
      message: z.string().min(1).max(1024),
      code: z.string().max(128).optional(),
    })
    .optional(),
  durationMs: z.number().nonnegative().optional(),
});

const toolCancelSchema = baseEventSchema.extend({
  op: z.literal("tool.cancel"),
  id: z.string().min(1).max(256),
});

export const toolEventSchema = z.discriminatedUnion("op", [
  toolStartSchema,
  toolArgsDeltaSchema,
  toolResultSchema,
  toolCancelSchema,
]);

// ─── Reasoning / Thinking Events ────────────────────────────────────────────

const reasoningStartSchema = baseEventSchema.extend({
  op: z.literal("reasoning.start"),
  id: z.string().min(1).max(256),
  turnId: z.string().max(256).optional(),
});

const reasoningDeltaSchema = baseEventSchema.extend({
  op: z.literal("reasoning.delta"),
  id: z.string().min(1).max(256),
  delta: z.string().max(64_000),
});

const reasoningEndSchema = baseEventSchema.extend({
  op: z.literal("reasoning.end"),
  id: z.string().min(1).max(256),
  tokens: z.number().int().nonnegative().optional(),
});

export const reasoningEventSchema = z.discriminatedUnion("op", [
  reasoningStartSchema,
  reasoningDeltaSchema,
  reasoningEndSchema,
]);

// ─── Optimistic Events ──────────────────────────────────────────────────────

const optimisticApplySchema = baseEventSchema.extend({
  op: z.literal("optimistic.apply"),
  entityKey: z.string().min(1).max(256),
  patch: z.record(z.string(), z.any()),
  originId: z.string().min(1).max(256),
  ttlMs: z.number().int().positive().max(24 * 60 * 60 * 1000).optional(),
});

const optimisticConfirmSchema = baseEventSchema.extend({
  op: z.literal("optimistic.confirm"),
  originId: z.string().min(1).max(256),
});

const optimisticRollbackSchema = baseEventSchema.extend({
  op: z.literal("optimistic.rollback"),
  originId: z.string().min(1).max(256),
});

export const optimisticEventSchema = z.discriminatedUnion("op", [
  optimisticApplySchema,
  optimisticConfirmSchema,
  optimisticRollbackSchema,
]);

// ─── Session Lifecycle Events ───────────────────────────────────────────────

export const sessionMetaSchema = baseEventSchema.extend({
  op: z.literal("session.meta"),
  conversationId: z.string().min(1).max(256),
});

export const agentWireEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema,
  uiReplaceSchema,
  uiRemoveSchema,
  uiToastSchema,
  uiNavigateSchema,
  uiResetSchema,
  toolStartSchema,
  toolArgsDeltaSchema,
  toolResultSchema,
  toolCancelSchema,
  reasoningStartSchema,
  reasoningDeltaSchema,
  reasoningEndSchema,
  optimisticApplySchema,
  optimisticConfirmSchema,
  optimisticRollbackSchema,
  sessionMetaSchema,
]);

// ─── Action Events ───────────────────────────────────────────────────────────

const actionBaseFields = {
  kind: z.literal("action" as const),
  name: z.string().min(1),
  payload: z.record(z.string(), z.any()).optional(),
  uiKey: z.string().optional(),
};

const actionSubmitSchema = baseEventSchema.extend({
  ...actionBaseFields,
  type: z.literal("action.submit"),
});

const actionSelectSchema = baseEventSchema.extend({
  ...actionBaseFields,
  type: z.literal("action.select"),
});

const actionApproveSchema = baseEventSchema.extend({
  ...actionBaseFields,
  type: z.literal("action.approve"),
  approved: z.boolean(),
});

const actionGenericSchema = baseEventSchema.extend({
  ...actionBaseFields,
  type: z.literal("action"),
});

export const actionEventSchema = z.discriminatedUnion("type", [
  actionSubmitSchema,
  actionSelectSchema,
  actionApproveSchema,
  actionGenericSchema,
]);
