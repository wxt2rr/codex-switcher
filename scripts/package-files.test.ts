import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

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
});
