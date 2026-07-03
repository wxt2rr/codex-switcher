import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("windows handoff doc captures the continuation flow for a real Windows machine", async () => {
  const content = await readFile(`${repoRoot}/docs/windows-handoff.md`, "utf8");

  const requiredLines = [
    "# Windows Handoff",
    "This document is the handoff package for continuing `codex-switcher` Windows-native validation work on a real Windows machine.",
    "## Current Repository State",
    "`npm run test:cross-platform`",
    "`npm run desktop:test`",
    "`npm run test:lifecycle`",
    "`npm run windows:manual:start`",
    "windows-manual-evidence.txt",
    "windows-manual-result.md",
    "Read docs/windows-handoff.md first",
    "## Completion Criteria",
    "Do not treat repository tests alone as final proof.",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `windows handoff doc should include: ${line}`);
  }
});
