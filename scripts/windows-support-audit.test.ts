import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("windows support audit captures the proven scope and remaining real-machine gap", async () => {
  const content = await readFile(`${repoRoot}/docs/windows-support-audit.md`, "utf8");

  const requiredLines = [
    "# Windows Support Audit",
    "## Goal",
    "## Proven by Current Repository Evidence",
    "`npm run test:cross-platform`",
    "GitHub Actions also runs that suite on `windows-latest`, `macos-latest`, and `ubuntu-latest` via [.github/workflows/ci.yml](../.github/workflows/ci.yml).",
    "Result: passed with one intentional lifecycle-sensitive skip in the current Codex App environment",
    "`npm run desktop:test`",
    "macOS desktop regression coverage is also enforced in GitHub Actions via `.github/workflows/ci.yml`.",
    "Result: passed",
    "## Windows validation handoff assets",
    "[../scripts/windows-manual-capture.ps1](../scripts/windows-manual-capture.ps1)",
    "[../scripts/windows-manual-result-template.ps1](../scripts/windows-manual-result-template.ps1)",
    "[../scripts/windows-manual-start.ps1](../scripts/windows-manual-start.ps1)",
    "`npm run test:lifecycle`",
    "## Remaining Unproven Requirement",
    "The repository still lacks authoritative runtime evidence from a real Windows machine.",
    "## What Would Close the Gap",
    "powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-manual-start.ps1 -EvidencePath .\\windows-manual-evidence.txt -ResultPath .\\windows-manual-result.md",
    "Overall status: not yet complete, but blocked only on external Windows execution evidence rather than obvious repository gaps.",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `windows support audit should include: ${line}`);
  }
});
