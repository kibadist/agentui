import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { detectStorybook, detectPackageManager } from "../src/core/detect.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

let tmp: string;
beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agentui-detect-"));
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

function writePkg(deps: object) {
  fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify(deps));
}

describe("detectStorybook", () => {
  it("returns null when no package.json", () => {
    expect(detectStorybook(tmp)).toBeNull();
  });
  it("detects @storybook/react in dependencies", () => {
    writePkg({ dependencies: { "@storybook/react": "^8" } });
    expect(detectStorybook(tmp)).toBe("@storybook/react");
  });
  it("detects @storybook/nextjs in devDependencies", () => {
    writePkg({ devDependencies: { "@storybook/nextjs": "^8" } });
    expect(detectStorybook(tmp)).toBe("@storybook/nextjs");
  });
  it("prefers @storybook/nextjs when both present", () => {
    writePkg({
      devDependencies: { "@storybook/react": "^8", "@storybook/nextjs": "^8" },
    });
    expect(detectStorybook(tmp)).toBe("@storybook/nextjs");
  });
  it("returns null when neither present", () => {
    writePkg({ dependencies: { react: "^19" } });
    expect(detectStorybook(tmp)).toBeNull();
  });
});

describe("detectPackageManager", () => {
  it("detects pnpm", () => {
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    expect(detectPackageManager(tmp)).toBe("pnpm");
  });
  it("detects yarn", () => {
    fs.writeFileSync(path.join(tmp, "yarn.lock"), "");
    expect(detectPackageManager(tmp)).toBe("yarn");
  });
  it("detects npm", () => {
    fs.writeFileSync(path.join(tmp, "package-lock.json"), "");
    expect(detectPackageManager(tmp)).toBe("npm");
  });
  it("prefers pnpm > yarn > npm", () => {
    fs.writeFileSync(path.join(tmp, "pnpm-lock.yaml"), "");
    fs.writeFileSync(path.join(tmp, "yarn.lock"), "");
    fs.writeFileSync(path.join(tmp, "package-lock.json"), "");
    expect(detectPackageManager(tmp)).toBe("pnpm");
  });
  it("falls back to npm when no lockfile", () => {
    expect(detectPackageManager(tmp)).toBe("npm");
  });
});
