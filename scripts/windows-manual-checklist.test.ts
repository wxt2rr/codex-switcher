import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("Windows manual checklist documents the supported validation flows", async () => {
  const content = await readFile(`${repoRoot}/docs/windows-manual-checklist.md`, "utf8");

  const requiredLines = [
    "# Windows Manual Checklist",
    "Run this checklist on a real Windows machine with Codex installed.",
    "## Setup",
    "## Shell install paths",
    "## CLI isolation",
    "## App switching",
    "## TUI checks",
    "## Recovery and integrity",
    "## Token refresh and logs",
    "## Security checks",
    "Record the execution result in [docs/windows-manual-checklist-result-template.md](docs/windows-manual-checklist-result-template.md).",
    "npm run windows:manual:start",
    "npm run windows:manual:capture",
    "npm run windows:manual:result-template",
    "Run the command below from a repository checkout or from a package contents directory that includes the `scripts/` helper files.",
    "powershell -ExecutionPolicy Bypass -File .\\scripts\\windows-manual-start.ps1 -EvidencePath .\\windows-manual-evidence.txt -ResultPath .\\windows-manual-result.md",
    "This generates both `windows-manual-evidence.txt` and `windows-manual-result.md`.",
    "Use the PowerShell commands above when you are validating from packaged contents that include the helper scripts but do not include the repository `package.json` shortcuts.",
    "`codex-sw platform` returns `windows`",
    "`node scripts/bin/codex-sw-node.cjs install --shell powershell` writes the launcher and PowerShell profile init block",
    "`node scripts/bin/codex-sw-node.cjs install --shell cmd` writes `cmd-init.bat`",
    "`node scripts/bin/codex-sw-node.cjs install --shell windows-terminal` completes successfully",
    "`codex-sw ac use work -t app && codex-sw app restart-current` opens Codex under `default/work`",
    "`codex-sw app stop-managed` stops the managed App instance without damaging CLI state",
    "`codex-sw ops token-refresh start` creates or updates the scheduled task",
    "no tokens are visible in `%USERPROFILE%\\.codex-switcher\\switcher.log`",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `windows manual checklist should include: ${line}`);
  }
});
