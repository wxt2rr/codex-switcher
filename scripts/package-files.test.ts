import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { promisify } from "node:util";

const repoRoot = process.cwd();
const execFileAsync = promisify(execFile);

test("package.json publishes the Windows manual helper scripts", async () => {
  const packageJson = JSON.parse(await readFile(`${repoRoot}/package.json`, "utf8")) as {
    files?: string[];
  };

  assert.ok(Array.isArray(packageJson.files), "package.json should define a files array");
  assert.ok(
    packageJson.files?.includes("scripts/windows-manual-capture.ps1"),
    "package.json files should include scripts/windows-manual-capture.ps1",
  );
  assert.ok(
    packageJson.files?.includes("scripts/windows-manual-start.ps1"),
    "package.json files should include scripts/windows-manual-start.ps1",
  );
  assert.ok(
    packageJson.files?.includes("scripts/windows-manual-result-template.ps1"),
    "package.json files should include scripts/windows-manual-result-template.ps1",
  );
  assert.ok(
    packageJson.files?.includes("scripts/windows-plugin-sandbox-smoke.cjs"),
    "package.json files should include scripts/windows-plugin-sandbox-smoke.cjs",
  );
  assert.ok(
    packageJson.files?.includes("scripts/verify-sandbox-evidence.mjs"),
    "package.json files should include scripts/verify-sandbox-evidence.mjs",
  );
});

test("published package contains the Windows/Node CLI runtime closure", async () => {
  const packageJson = JSON.parse(await readFile(`${repoRoot}/package.json`, "utf8")) as {
    files?: string[];
    dependencies?: Record<string, string>;
  };
  for (const pattern of [
    "scripts/node-cli.ts",
    "scripts/core-cli.ts",
    "packages/core/src/**",
    "packages/gateway/src/**",
    "apps/desktop/electron/**",
  ]) {
    assert.ok(packageJson.files?.includes(pattern), `package.json files should include ${pattern}`);
  }
  for (const dependency of ["jsonc-parser", "sql.js", "tsx", "undici", "yaml"]) {
    assert.ok(packageJson.dependencies?.[dependency], `${dependency} must be a runtime dependency for the published CLI`);
  }

  const npm = process.platform === "win32" ? "npm.cmd" : "npm";
  const result = await execFileAsync(npm, ["pack", "--dry-run", "--json"], {
    cwd: repoRoot,
    maxBuffer: 4 * 1024 * 1024,
    shell: process.platform === "win32",
  });
  const packed = JSON.parse(result.stdout.trim()) as Array<{ files?: Array<{ path: string }> }>;
  const paths = new Set((packed[0]?.files ?? []).map((entry) => entry.path));
  for (const file of [
    "scripts/bin/launcher.cjs",
    "scripts/node-cli.ts",
    "scripts/core-cli.ts",
    "packages/core/src/api/core-api.ts",
    "packages/gateway/src/index.ts",
    "apps/desktop/electron/usage-router-manager.ts",
    "apps/desktop/electron/usage-store.ts",
  ]) {
    assert.ok(paths.has(file), `npm pack should include ${file}`);
  }
});
