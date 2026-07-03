import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("package.json exposes Windows manual helper npm scripts", async () => {
  const packageJson = JSON.parse(await readFile(`${repoRoot}/package.json`, "utf8")) as {
    scripts?: Record<string, string>;
  };

  assert.ok(packageJson.scripts, "package.json should define scripts");
  assert.equal(
    packageJson.scripts?.["windows:manual:start"],
    "powershell -ExecutionPolicy Bypass -File ./scripts/windows-manual-start.ps1",
  );
  assert.equal(
    packageJson.scripts?.["windows:manual:capture"],
    "powershell -ExecutionPolicy Bypass -File ./scripts/windows-manual-capture.ps1",
  );
  assert.equal(
    packageJson.scripts?.["windows:manual:result-template"],
    "powershell -ExecutionPolicy Bypass -File ./scripts/windows-manual-result-template.ps1",
  );
  assert.equal(
    packageJson.scripts?.["test:lifecycle"],
    "node ./scripts/run-lifecycle-tests.mjs",
  );
});
