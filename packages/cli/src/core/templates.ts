export interface TemplateArgs {
  pascalName: string;
  kebabName: string;
  schemaConst: string;
}

export function renderComponent({ pascalName, kebabName }: TemplateArgs): string {
  return `import type { ${pascalName}Props } from "./${kebabName}.schema";

export function ${pascalName}(props: ${pascalName}Props) {
  return (
    <div>
      {/* TODO: render ${pascalName} */}
      <pre>{JSON.stringify(props, null, 2)}</pre>
    </div>
  );
}
`;
}

export function renderSchema({ pascalName, schemaConst }: TemplateArgs): string {
  return `import { z } from "zod";

export const ${schemaConst} = z.object({
  // TODO: define props. Use .describe() so the agent knows what each prop means.
  text: z.string().describe("the quote text"),
});

export type ${pascalName}Props = z.infer<typeof ${schemaConst}>;
`;
}

export function renderTest({ pascalName, kebabName, schemaConst }: TemplateArgs): string {
  return `import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ${pascalName} } from "./${kebabName}";
import { ${schemaConst} } from "./${kebabName}.schema";

describe("${pascalName}", () => {
  it("schema accepts valid props", () => {
    const result = ${schemaConst}.safeParse({ text: "hello" });
    expect(result.success).toBe(true);
  });

  it("renders without crashing", () => {
    render(<${pascalName} text="hello" />);
    expect(screen.getByText(/hello/)).toBeTruthy();
  });
});
`;
}

export function renderStory({ pascalName, kebabName }: TemplateArgs): string {
  return `import type { Meta, StoryObj } from "@storybook/react";
import { ${pascalName} } from "./${kebabName}";

const meta: Meta<typeof ${pascalName}> = {
  title: "Agent/${pascalName}",
  component: ${pascalName},
};
export default meta;

export const Default: StoryObj<typeof ${pascalName}> = {
  args: { text: "hello" },
};
`;
}
