import type { ComponentType } from "react";
import type { z } from "zod";
import type { UINode } from "@kibadist/agentui-protocol";

export interface DefineNodeOptions<TSchema extends z.ZodObject<z.ZodRawShape>> {
  type: string;
  schema: TSchema;
  component: ComponentType<z.infer<TSchema>>;
  requires?: string[];
}

export interface BuildArgs<TSchema extends z.ZodObject<z.ZodRawShape>> {
  key: string;
  props: z.infer<TSchema>;
  slot?: string;
  meta?: Omit<NonNullable<UINode["meta"]>, "requires">;
}

export interface NodeDefinition<TSchema extends z.ZodObject<z.ZodRawShape>> {
  readonly type: string;
  readonly schema: TSchema;
  readonly component: ComponentType<z.infer<TSchema>>;
  readonly requires: readonly string[] | undefined;
  build(args: BuildArgs<TSchema>): UINode;
}

export function defineNode<TSchema extends z.ZodObject<z.ZodRawShape>>(
  opts: DefineNodeOptions<TSchema>,
): NodeDefinition<TSchema> {
  const requires = opts.requires;
  return {
    type: opts.type,
    schema: opts.schema,
    component: opts.component,
    requires,
    build({ key, props, slot, meta }) {
      const parsed = opts.schema.safeParse(props);
      if (!parsed.success) {
        const issues = JSON.stringify(parsed.error.issues, null, 2);
        throw new Error(`defineNode(${opts.type}).build: invalid props\n${issues}`);
      }

      const node: UINode = {
        key,
        type: opts.type,
        props: parsed.data as Record<string, unknown>,
      };
      if (slot !== undefined) node.slot = slot;

      const hasUserMeta = meta !== undefined && Object.keys(meta).length > 0;
      if (requires !== undefined && requires.length > 0) {
        node.meta = { ...(meta ?? {}), requires: [...requires] };
      } else if (hasUserMeta) {
        node.meta = { ...meta };
      }

      return node;
    },
  };
}
