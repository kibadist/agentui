import * as fs from "node:fs";
import * as path from "node:path";
import { validateName, toKebab } from "../core/name.js";
import { loadConfig } from "../core/config.js";
import { detectStorybook, detectPackageManager } from "../core/detect.js";
import {
  insertRegistryEntry,
  hasMarkers,
  hasEntryKey,
} from "../core/registry-edit.js";
import {
  renderComponent,
  renderSchema,
  renderTest,
  renderStory,
} from "../core/templates.js";

export interface NewNodeArgs {
  name: string;
  dryRun: boolean;
}

export type NewNodeResult =
  | { ok: true; created: string[]; storybook: string | null; pkgManager: string }
  | { ok: false; error: string };

export function runNewNode(args: NewNodeArgs, cwd: string): NewNodeResult {
  const v = validateName(args.name);
  if (!v.ok) return { ok: false, error: v.error };

  const kebab = toKebab(args.name);
  const schemaConst = lowerCamel(args.name) + "Schema";

  const cfg = loadConfig(cwd);
  const componentsAbs = path.resolve(cwd, cfg.componentsDir);
  const registryAbs = path.resolve(cwd, cfg.registry);

  if (!fs.existsSync(registryAbs)) {
    return {
      ok: false,
      error: `Registry not found at ${cfg.registry}. Set "registry" in agentui.config.json or create the file.`,
    };
  }

  const registrySrc = fs.readFileSync(registryAbs, "utf8");
  if (!hasMarkers(registrySrc)) {
    return {
      ok: false,
      error:
        `Registry file ${cfg.registry} has no agentui markers. Add these to enable auto-insertion:\n\n` +
        `  // agentui:registry-imports-start\n  // agentui:registry-imports-end\n\n  ...createRegistry({\n    // agentui:registry-entries-start\n    // agentui:registry-entries-end\n  });\n\nThen re-run.`,
    };
  }

  const storybookPreset = detectStorybook(cwd);
  const pkgManager = detectPackageManager(cwd);

  const componentFile = path.join(componentsAbs, `${kebab}.tsx`);
  const schemaFile = path.join(componentsAbs, `${kebab}.schema.ts`);
  const testFile = path.join(componentsAbs, `${kebab}.test.tsx`);
  const storyFile = path.join(componentsAbs, `${kebab}.stories.tsx`);

  const targets: string[] = [componentFile, schemaFile, testFile];
  if (storybookPreset) targets.push(storyFile);

  const conflicts = targets.filter((p) => fs.existsSync(p));
  if (conflicts.length > 0) {
    return {
      ok: false,
      error:
        `Cannot create ${args.name} — these files already exist:\n` +
        conflicts.map((p) => "  " + path.relative(cwd, p)).join("\n") +
        `\n\nDelete them and re-run, or pick a different name.`,
    };
  }

  if (hasEntryKey(registrySrc, kebab)) {
    return {
      ok: false,
      error: `Registry already contains a "${kebab}" entry. Pick a different name.`,
    };
  }

  const tplArgs = { pascalName: args.name, kebabName: kebab, schemaConst };
  const componentSrc = renderComponent(tplArgs);
  const schemaSrcOut = renderSchema(tplArgs);
  const testSrc = renderTest(tplArgs);
  const storySrc = storybookPreset ? renderStory(tplArgs) : null;

  const newRegistry = insertRegistryEntry(registrySrc, {
    kebabKey: kebab,
    pascalName: args.name,
    schemaConst,
    componentImportPath: `./${kebab}`,
    schemaImportPath: `./${kebab}.schema`,
  });

  if (args.dryRun) {
    return {
      ok: true,
      created: targets.map((p) => path.relative(cwd, p)),
      storybook: storybookPreset,
      pkgManager,
    };
  }

  fs.mkdirSync(componentsAbs, { recursive: true });
  fs.writeFileSync(componentFile, componentSrc);
  fs.writeFileSync(schemaFile, schemaSrcOut);
  fs.writeFileSync(testFile, testSrc);
  if (storySrc) fs.writeFileSync(storyFile, storySrc);
  fs.writeFileSync(registryAbs, newRegistry);

  return {
    ok: true,
    created: targets.map((p) => path.relative(cwd, p)),
    storybook: storybookPreset,
    pkgManager,
  };
}

function lowerCamel(pascal: string): string {
  return pascal[0].toLowerCase() + pascal.slice(1);
}
