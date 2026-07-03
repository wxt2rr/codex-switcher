import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("run-lifecycle-tests wrapper enables lifecycle tests and forwards to cross-platform suite", async () => {
  const content = await readFile(`${repoRoot}/scripts/run-lifecycle-tests.mjs`, "utf8");

  const requiredLines = [
    "CODEX_SWITCHER_ENABLE_APP_LIFECYCLE_TESTS",
    "\"1\"",
    "npm",
    "run",
    "test:cross-platform",
    "spawn",
    "shell: process.platform === \"win32\"",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `run-lifecycle-tests.mjs should include: ${line}`);
  }
});
