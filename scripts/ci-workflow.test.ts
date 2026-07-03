import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("GitHub Actions CI keeps Windows cross-platform coverage and macOS desktop regression coverage", async () => {
  const content = await readFile(`${repoRoot}/.github/workflows/ci.yml`, "utf8");

  const requiredLines = [
    "name: ci",
    "cross-platform:",
    "windows-latest",
    "macos-latest",
    "ubuntu-latest",
    "Run cross-platform tests",
    "run: npm run test:cross-platform",
    "mac-desktop:",
    "Run desktop tests",
    "run: npm run desktop:test",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `ci workflow should include: ${line}`);
  }
});
