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

const jsonPointerSchema = z.string().regex(/^$|^(\/([^/~]|~0|~1)*)+$/, "invalid JSON Pointer");

const jsonPatchOpSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("add"), path: jsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal("remove"), path: jsonPointerSchema }),
  z.object({ op: z.literal("replace"), path: jsonPointerSchema, value: z.unknown() }),
  z.object({ op: z.literal("move"), from: jsonPointerSchema, path: jsonPointerSchema }),
  z.object({ op: z.literal("copy"), from: jsonPointerSchema, path: jsonPointerSchema }),
  z.object({ op: z.literal("test"), path: jsonPointerSchema, value: z.unknown() }),
]);

const uiReplaceSchema = baseEventSchema
  .extend({
    op: z.literal("ui.replace"),
    key: z.string().min(1).max(256),
    props: z.record(z.string(), z.any()).optional(),
    replace: z.boolean().optional(),
    patch: z.array(jsonPatchOpSchema).min(1).max(256).optional(),
  })
  .superRefine((val, ctx) => {
    const hasProps = val.props !== undefined;
    const hasPatch = val.patch !== undefined;
    if (hasProps === hasPatch) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "ui.replace requires exactly one of `props` or `patch`",
      });
    }
    if (hasPatch && val.replace !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "`replace` cannot be combined with `patch`",
      });
    }
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

export const uiEventSchema = z.union([
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

// ─── Workflow Events ────────────────────────────────────────────────────────

const workflowStepSchema = z
  .object({
    id: z.string().min(1).max(256),
    title: z.string().min(1).max(256),
    nodeKey: z.string().min(1).max(256).optional(),
  })
  .strict();

const workflowStartSchema = baseEventSchema
  .extend({
    op: z.literal("workflow.start"),
    id: z.string().min(1).max(256),
    steps: z.array(workflowStepSchema).min(1).max(64),
    turnId: z.string().max(256).optional(),
  })
  .superRefine((evt, ctx) => {
    const seen = new Set<string>();
    for (const step of evt.steps) {
      if (seen.has(step.id)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `duplicate step id: ${step.id}`,
          path: ["steps"],
        });
        return;
      }
      seen.add(step.id);
    }
  });

const workflowAdvanceSchema = baseEventSchema.extend({
  op: z.literal("workflow.advance"),
  id: z.string().min(1).max(256),
  stepId: z.string().min(1).max(256),
});

const workflowCompleteSchema = baseEventSchema.extend({
  op: z.literal("workflow.complete"),
  id: z.string().min(1).max(256),
  result: z.unknown().optional(),
});

const workflowCancelSchema = baseEventSchema.extend({
  op: z.literal("workflow.cancel"),
  id: z.string().min(1).max(256),
  reason: z.string().max(1024).optional(),
});

export const workflowEventSchema = z.union([
  workflowStartSchema,
  workflowAdvanceSchema,
  workflowCompleteSchema,
  workflowCancelSchema,
]);

// ─── Session Lifecycle Events ───────────────────────────────────────────────

export const sessionMetaSchema = baseEventSchema.extend({
  op: z.literal("session.meta"),
  conversationId: z.string().min(1).max(256),
});

export const sessionInitSchema = baseEventSchema.extend({
  op: z.literal("session.init"),
  capabilities: z.object({
    nodeTypes: z.array(z.string().min(1).max(256)).max(512),
    actions: z.array(z.string().min(1).max(256)).max(512),
    permissions: z.array(z.string().min(1).max(256)).max(512),
  }),
});

/**
 * Reserved op-namespace prefixes. The protocol owns these — any wire op
 * whose name starts with one of these prefixes is treated as a closed
 * protocol variant. Custom wire events must use a different prefix
 * (`host.*`, `myapp.*`, etc.). Used by `customWireEventSchema` to refuse
 * shadowing and exported so consumers can detect custom events at
 * runtime; also drives the JSON Schema `pattern` constraint via
 * `zod-to-json-schema` (which can translate `.regex()` but not
 * `.refine()`), keeping AJV-based validation in lockstep with the zod
 * runtime.
 */
export const RESERVED_PROTOCOL_OP_PREFIXES: readonly string[] = [
  "ui.",
  "tool.",
  "reasoning.",
  "optimistic.",
  "session.",
  "workflow.",
];

/**
 * Exact protocol op names. Kept for back-compat (was the public seam in
 * v1.3.1 / v1.3.2) and for drift tests, but the schema constraint is
 * now prefix-based via {@link RESERVED_PROTOCOL_OP_PREFIXES}.
 */
export const RESERVED_PROTOCOL_OPS: ReadonlySet<string> = new Set<string>([
  "ui.append",
  "ui.replace",
  "ui.remove",
  "ui.toast",
  "ui.navigate",
  "ui.reset",
  "tool.start",
  "tool.args-delta",
  "tool.result",
  "tool.cancel",
  "reasoning.start",
  "reasoning.delta",
  "reasoning.end",
  "optimistic.apply",
  "optimistic.confirm",
  "optimistic.rollback",
  "session.meta",
  "session.init",
  "workflow.start",
  "workflow.advance",
  "workflow.complete",
  "workflow.cancel",
]);

/**
 * Negative-lookahead pattern: an `op` value is valid for a custom wire
 * event iff it does NOT start with any reserved protocol prefix. The
 * pattern is intentionally a JavaScript-compatible regex so
 * `zod-to-json-schema` translates it cleanly into JSON Schema's
 * `pattern` field — that keeps AJV validation aligned with zod (without
 * the alignment, AJV would accept malformed protocol events via the
 * passthrough arm, since refines don't survive the JSON Schema
 * translation).
 */
const CUSTOM_WIRE_EVENT_OP_PATTERN =
  /^(?!(?:ui|tool|reasoning|optimistic|session|workflow)\.).+$/;

/**
 * Passthrough variant for consumer-defined wire ops. Requires the standard
 * base envelope (`v`, `id`, `ts`, `sessionId`, `op`) and accepts any
 * additional fields. The `op` must NOT start with a reserved protocol
 * prefix — that keeps the closed variants authoritative for protocol ops
 * while letting hosts add their own typed seams (e.g. `host.panelPatch`,
 * `myapp.refresh`).
 *
 * The reducer no-ops unknown ops; consumers observe them via
 * `AgentStore.subscribeAction` (fires on every dispatch, including no-ops).
 */
const customWireEventSchema = baseEventSchema
  .extend({
    op: z
      .string()
      .min(1)
      .max(256)
      .regex(
        CUSTOM_WIRE_EVENT_OP_PATTERN,
        "custom wire event op cannot use a reserved protocol prefix (ui., tool., reasoning., optimistic., session., workflow.)",
      ),
  })
  .passthrough();

export const agentWireEventSchema = z.union([
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
  sessionInitSchema,
  workflowStartSchema,
  workflowAdvanceSchema,
  workflowCompleteSchema,
  workflowCancelSchema,
  customWireEventSchema,
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
