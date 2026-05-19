import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { loadConfig } from "../src/core/config.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentui-cfg-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns defaults when no config file", () => {
    const cfg = loadConfig(tmp);
    expect(cfg.registry).toBe("./components/registry.ts");
    expect(cfg.componentsDir).toBe("./components");
  });

  it("reads partial overrides", () => {
    fs.writeFileSync(
      path.join(tmp, "agentui.config.json"),
      JSON.stringify({ componentsDir: "./src/components" }),
    );
    const cfg = loadConfig(tmp);
    expect(cfg.componentsDir).toBe("./src/components");
    expect(cfg.registry).toBe("./components/registry.ts");
  });

  it("warns on unknown keys but does not throw", () => {
    fs.writeFileSync(
      path.join(tmp, "agentui.config.json"),
      JSON.stringify({ componentsDir: "./x", futureKey: true }),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = loadConfig(tmp);
    expect(cfg.componentsDir).toBe("./x");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("throws on invalid JSON", () => {
    fs.writeFileSync(path.join(tmp, "agentui.config.json"), "{ not json");
    expect(() => loadConfig(tmp)).toThrow(/agentui\.config\.json/);
  });

  it("throws on wrong types", () => {
    fs.writeFileSync(
      path.join(tmp, "agentui.config.json"),
      JSON.stringify({ componentsDir: 123 }),
    );
    expect(() => loadConfig(tmp)).toThrow();
  });
});
