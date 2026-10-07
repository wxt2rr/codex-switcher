import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = process.cwd();

test("Windows manual result template preserves the expected evidence and verdict structure", async () => {
  const content = await readFile(`${repoRoot}/docs/windows-manual-checklist-result-template.md`, "utf8");

  const requiredLines = [
    "# Windows Manual Checklist Result Template",
    "Use this template after running [windows-manual-checklist.md](windows-manual-checklist.md) on a real Windows machine.",
    "You can generate this file together with baseline command evidence via `scripts/windows-manual-start.ps1`, or generate only the prefilled working copy with `scripts/windows-manual-result-template.ps1`.",
    "From a source checkout, the shortcut commands are `npm run windows:manual:start` and `npm run windows:manual:result-template`.",
    "Use the raw PowerShell helper commands when you are validating from packaged contents that include `scripts/` but not the repository npm scripts.",
    "## Session Metadata",
    "- Install source:",
    "- [ ] npm global install",
    "- [ ] source install",
    "- Shells verified:",
    "- [ ] PowerShell",
    "- [ ] cmd",
    "- [ ] Windows Terminal",
    "## Checklist Result",
    "- [ ] Setup",
    "- [ ] Shell install paths",
    "- [ ] CLI isolation",
    "- [ ] App switching",
    "- [ ] TUI checks",
    "- [ ] Gateway and plugin isolation",
    "- [ ] Packaging and update recovery",
    "- [ ] Recovery and integrity",
    "- [ ] Token refresh and logs",
    "- [ ] Security checks",
    "## Command Evidence",
    "attach `windows-manual-evidence.txt` and the generated `windows-sandbox.json` when the AppContainer helper was available",
    "preserve the explicit `SKIPPED` line instead of treating the smoke as passed",
    "codex-sw check:",
    "codex-sw platform:",
    "codex-sw ops doctor:",
    "codex-sw app status:",
    "codex-sw ops token-refresh status:",
    "### Gateway and plugin isolation",
    "`filesystemWriteGranted`:",
    "### Packaging and update recovery",
    "Authenticode status:",
    "Failed-boot rollback result:",
    "## Open Issues",
    "## Final Verdict",
    "- [ ] Passed without blockers",
    "- [ ] Passed with minor caveats",
    "- [ ] Failed and needs code changes",
    "Summary:",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `windows manual result template should include: ${line}`);
  }
});
