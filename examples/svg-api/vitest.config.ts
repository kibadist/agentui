import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  // Anchor the project to this directory so the config works whether invoked
  // from here (`pnpm --filter ... test`) or from the repo root.
  root: fileURLToPath(new URL(".", import.meta.url)),
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    globals: false,
  },
});
