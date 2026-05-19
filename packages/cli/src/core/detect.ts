import * as fs from "node:fs";
import * as path from "node:path";

export type StorybookPreset = "@storybook/react" | "@storybook/nextjs";
export type PackageManager = "pnpm" | "yarn" | "npm";

export function detectStorybook(cwd: string): StorybookPreset | null {
  const file = path.join(cwd, "package.json");
  if (!fs.existsSync(file)) return null;
  let pkg: { dependencies?: Record<string, unknown>; devDependencies?: Record<string, unknown> };
  try {
    pkg = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
  const all = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if ("@storybook/nextjs" in all) return "@storybook/nextjs";
  if ("@storybook/react" in all) return "@storybook/react";
  return null;
}

export function detectPackageManager(cwd: string): PackageManager {
  if (fs.existsSync(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (fs.existsSync(path.join(cwd, "yarn.lock"))) return "yarn";
  if (fs.existsSync(path.join(cwd, "package-lock.json"))) return "npm";
  return "npm";
}
