import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const desktopRoot = existsSync(join(process.cwd(), "apps", "desktop", "package.json"))
  ? join(process.cwd(), "apps", "desktop")
  : process.cwd();

const desktopPackage = JSON.parse(
  readFileSync(join(desktopRoot, "package.json"), "utf8")
) as {
  main: string;
  scripts: Record<string, string>;
  build: {
    appId: string;
    files: string[];
    extraResources: Array<{
      from: string;
      to: string;
    }>;
    mac?: {
      target?: string[];
      icon?: string;
    };
  };
};

test("desktop package defines electron packaging entrypoints", () => {
  assert.equal(desktopPackage.main, "electron-dist/electron/main.cjs");
  assert.equal(desktopPackage.scripts["package:dir"], "electron-builder --dir");
  assert.equal(desktopPackage.build.appId, "com.wangxt.codex-switcher");
  assert.deepEqual(desktopPackage.build.files, ["dist/**", "electron-dist/**", "package.json"]);
  assert.deepEqual(desktopPackage.build.extraResources, [
    {
      from: "../../packages/core/dist",
      to: "packages/core/dist",
    },
    {
      from: "../../packages/core/package.json",
      to: "packages/core/package.json",
    },
    {
      from: "../../plugins/codex-switcher/scripts",
      to: "plugins/codex-switcher/scripts",
    },
    {
      from: "../../scripts/bin",
      to: "scripts/bin",
    },
  ]);
  assert.deepEqual(desktopPackage.build.mac?.target, ["dmg", "zip", "dir"]);
  assert.equal(desktopPackage.build.mac?.icon, "build/icon.icns");
});
