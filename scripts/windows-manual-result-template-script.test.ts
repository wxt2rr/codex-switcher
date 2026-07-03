import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const repoRoot = "/Users/wangxt/myspace/codex-switcher";

test("windows manual result template generator script pre-fills metadata and checklist structure", async () => {
  const content = await readFile(`${repoRoot}/scripts/windows-manual-result-template.ps1`, "utf8");

  const requiredLines = [
    "param(",
    "[string]$OutputPath = \".\\windows-manual-result.md\"",
    "[string]$InstallSource = \"npm global install\"",
    "[string]$EvidencePath = \".\\windows-manual-evidence.txt\"",
    "$ErrorActionPreference = \"Stop\"",
    "function Ensure-ParentDirectory {",
    "New-Item -ItemType Directory -Path $parent -Force | Out-Null",
    "$windowsVersion = (Get-ComputerInfo -Property WindowsProductName, WindowsVersion, OsBuildNumber | Out-String).Trim()",
    "$date = (Get-Date).ToString(\"yyyy-MM-dd\")",
    "$machine = $env:COMPUTERNAME",
    "$operator = $env:USERNAME",
    "# Windows Manual Checklist Result Template",
    "- Date: $date",
    "- Operator: $operator",
    "- Machine: $machine",
    "- Windows version: $windowsVersion",
    "- [$installSourceNpm] npm global install",
    "- [$installSourceSource] source install",
    "attach `$EvidencePath`",
    "Ensure-ParentDirectory -Path $OutputPath",
    "Set-Content -Path $OutputPath -Value $content",
    "Write-Host \"Result template written to $OutputPath\"",
  ];

  for (const line of requiredLines) {
    assert.ok(content.includes(line), `windows-manual-result-template.ps1 should include: ${line}`);
  }
});
