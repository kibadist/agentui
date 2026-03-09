import { z } from "zod";
import type { ComponentDef } from "@kibadist/agentui-validate";

export const textBlockSchema = z.object({
  title: z.string().optional().describe("heading text"),
  body: z.string().describe("markdown or plain text content"),
});

export const infoCardSchema = z.object({
  title: z.string().describe("card heading"),
  description: z.string().describe("card body text"),
  icon: z.string().optional().describe("emoji icon"),
});

export const actionCardSchema = z.object({
  title: z.string().describe("card heading"),
  description: z.string().describe("body text"),
  actions: z
    .array(z.object({ name: z.string(), label: z.string() }))
    .describe("buttons the user can click"),
});

export const dataTableSchema = z.object({
  title: z.string().optional().describe("table heading"),
  columns: z.array(z.string()).describe("column headers"),
  rows: z.array(z.array(z.string())).describe("row data"),
});

export const statusBadgeSchema = z.object({
  label: z.string().describe("badge text"),
  variant: z
    .enum(["info", "success", "warning", "error"])
    .describe("color/style"),
});

/** Component definitions used by both the registry and describeComponents() */
export const componentDefs: Record<string, ComponentDef> = {
  "text-block": { propsSchema: textBlockSchema },
  "info-card": { propsSchema: infoCardSchema },
  "action-card": { propsSchema: actionCardSchema },
  "data-table": { propsSchema: dataTableSchema },
  "status-badge": { propsSchema: statusBadgeSchema },
};
