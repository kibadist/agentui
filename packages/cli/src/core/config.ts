import * as fs from "node:fs";
import * as path from "node:path";
import { z } from "zod";

export interface AgentuiConfig {
  registry: string;
  componentsDir: string;
}

const DEFAULTS: AgentuiConfig = {
  registry: "./components/registry.ts",
  componentsDir: "./components",
};

const KNOWN_KEYS = new Set(["$schema", "registry", "componentsDir"]);

export function loadConfig(cwd: string): AgentuiConfig {
  const file = path.join(cwd, "agentui.config.json");
  if (!fs.existsSync(file)) return { ...DEFAULTS };

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (err) {
    throw new Error(`Failed to parse agentui.config.json: ${(err as Error).message}`);
  }

  if (typeof raw !== "object" || raw === null) {
    throw new Error("agentui.config.json must be a JSON object.");
  }

  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!KNOWN_KEYS.has(key)) {
      console.warn(`agentui.config.json: unknown key "${key}" (ignored)`);
    }
  }

  const FieldSchema = z.object({
    registry: z.string().optional(),
    componentsDir: z.string().optional(),
  });
  const parsed = FieldSchema.parse(obj);

  return {
    registry: parsed.registry ?? DEFAULTS.registry,
    componentsDir: parsed.componentsDir ?? DEFAULTS.componentsDir,
  };
}
