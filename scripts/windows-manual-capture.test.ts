import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("windows manual capture script records the expected verification commands", async () => {
  const content = await readFile(`${repoRoot}/scripts/windows-manual-capture.ps1`, "utf8");

  const requiredLines = [
    "param(",
    "[string]$OutputPath = \".\\windows-manual-evidence.txt\"",
    "$ErrorActionPreference = \"Stop\"",
    "function Ensure-ParentDirectory {",
    "New-Item -ItemType Directory -Path $parent -Force | Out-Null",
    "function Write-Section {",
    "function Invoke-And-Capture {",
    "Ensure-ParentDirectory -Path $OutputPath",
    "\"codex-switcher Windows manual evidence\" | Set-Content -Path $OutputPath",
    "(\"generated_at: \" + (Get-Date).ToString(\"s\")) | Add-Content -Path $OutputPath",
    "(\"hostname: \" + $env:COMPUTERNAME) | Add-Content -Path $OutputPath",
    "(\"user: \" + $env:USERNAME) | Add-Content -Path $OutputPath",
    "Invoke-And-Capture \"codex-sw check\" \"codex-sw check\"",
    "Invoke-And-Capture \"codex-sw platform\" \"codex-sw platform\"",
    "Invoke-And-Capture \"codex-sw ops doctor\" \"codex-sw ops doctor\"",
    "Invoke-And-Capture \"codex-sw status\" \"codex-sw status\"",
    "Invoke-And-Capture \"codex-sw app status\" \"codex-sw app status\"",
    "Invoke-And-Capture \"codex-sw ops token-refresh status\" \"codex-sw ops token-refresh status\"",
    "Write-Host \"Evidence written to $OutputPath\"",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `windows-manual-capture.ps1 should include: ${line}`);
  }
});
