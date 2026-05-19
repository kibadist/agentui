import { describe, it, expect } from "vitest";
import { renderComponent, renderSchema, renderTest, renderStory } from "../src/core/templates.js";

const ARGS = { pascalName: "QuoteCard", kebabName: "quote-card", schemaConst: "quoteCardSchema" };

describe("templates", () => {
  it("component imports from schema and renders props", () => {
    const out = renderComponent(ARGS);
    expect(out).toContain(`import type { QuoteCardProps } from "./quote-card.schema";`);
    expect(out).toContain(`export function QuoteCard(props: QuoteCardProps)`);
  });

  it("schema exports zod object and inferred type", () => {
    const out = renderSchema(ARGS);
    expect(out).toContain(`export const quoteCardSchema = z.object({`);
    expect(out).toContain(`export type QuoteCardProps = z.infer<typeof quoteCardSchema>;`);
    expect(out).toContain(`.describe(`);
  });

  it("test imports both component and schema", () => {
    const out = renderTest(ARGS);
    expect(out).toContain(`import { QuoteCard } from "./quote-card";`);
    expect(out).toContain(`import { quoteCardSchema } from "./quote-card.schema";`);
    expect(out).toContain(`safeParse`);
  });

  it("story uses CSF3 and @storybook/react types", () => {
    const out = renderStory(ARGS);
    expect(out).toContain(`import type { Meta, StoryObj } from "@storybook/react";`);
    expect(out).toContain(`title: "Agent/QuoteCard"`);
    expect(out).toContain(`export const Default`);
  });
});
