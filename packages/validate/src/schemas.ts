import { z } from "zod";

// ─── Base ────────────────────────────────────────────────────────────────────

const baseEventSchema = z.object({
  v: z.literal(1),
  id: z.string().min(1),
  ts: z.string().min(1),
  traceId: z.string().optional(),
  sessionId: z.string().min(1),
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
  children?: unknown[];
  meta?: { ttlMs?: number; requires?: string[] };
}> = z.lazy(() =>
  z.object({
    key: z.string().min(1),
    type: z.string().min(1),
    props: z.record(z.any()),
    slot: z.string().optional(),
    children: z.array(uiNodeSchema).optional(),
    meta: uiNodeMetaSchema.optional(),
  }),
);

// ─── UI Events ───────────────────────────────────────────────────────────────

const uiAppendSchema = baseEventSchema.extend({
  op: z.literal("ui.append"),
  node: uiNodeSchema,
  index: z.number().int().nonnegative().optional(),
});

const uiReplaceSchema = baseEventSchema.extend({
  op: z.literal("ui.replace"),
  key: z.string().min(1),
  props: z.record(z.any()),
  replace: z.boolean().optional(),
});

const uiRemoveSchema = baseEventSchema.extend({
  op: z.literal("ui.remove"),
  key: z.string().min(1),
});

const uiToastSchema = baseEventSchema.extend({
  op: z.literal("ui.toast"),
  level: z.enum(["info", "success", "warning", "error"]),
  message: z.string().min(1),
});

const uiNavigateSchema = baseEventSchema.extend({
  op: z.literal("ui.navigate"),
  href: z.string().min(1),
  replace: z.boolean().optional(),
});

export const uiEventSchema = z.discriminatedUnion("op", [
  uiAppendSchema,
  uiReplaceSchema,
  uiRemoveSchema,
  uiToastSchema,
  uiNavigateSchema,
]);

// ─── Action Events ───────────────────────────────────────────────────────────

const actionBaseFields = {
  kind: z.literal("action" as const),
  name: z.string().min(1),
  payload: z.record(z.any()).optional(),
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
