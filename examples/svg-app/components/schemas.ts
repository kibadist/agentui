import { z } from "zod";

/**
 * Prop schemas for the agent-observability component registry. Mirrors the
 * backend's COMPONENT_DEFS in svg-api's agent.service.ts — keep the two in
 * sync. These give the renderer runtime prop validation (the security
 * boundary), and the agent only emits component types registered here.
 *
 * Enums (status / level / type) are kept permissive with `z.string()` so the
 * SVG components own their own vocabulary handling.
 */

export const workflowCanvasSchema = z.object({
  title: z.string().optional(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      sublabel: z.string().optional(),
      status: z.string().optional(),
    }),
  ),
  edges: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
        status: z.string().optional(),
      }),
    )
    .optional(),
});

export const toolTimelineSchema = z.object({
  title: z.string().optional(),
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.string().optional(),
      durationMs: z.number().optional(),
      detail: z.string().optional(),
    }),
  ),
});

export const stateMachineSchema = z.object({
  title: z.string().optional(),
  states: z.array(
    z.object({
      id: z.string(),
      label: z.string().optional(),
      status: z.string().optional(),
    }),
  ),
  transitions: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        label: z.string().optional(),
      }),
    )
    .optional(),
  active: z.string().optional(),
});

export const memoryMapSchema = z.object({
  title: z.string().optional(),
  nodes: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      type: z.string().optional(),
      group: z.string().optional(),
    }),
  ),
  links: z
    .array(
      z.object({
        id: z.string(),
        from: z.string(),
        to: z.string(),
        strength: z.number().optional(),
      }),
    )
    .optional(),
});

export const reviewCheckpointSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
  level: z.string().optional(),
  summary: z.string().optional(),
});

export const textBlockSchema = z.object({
  title: z.string().optional(),
  body: z.string(),
});
