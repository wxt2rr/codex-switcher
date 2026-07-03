param(
  [string]$OutputPath = ".\windows-manual-result.md",
  [string]$InstallSource = "npm global install",
  [string]$EvidencePath = ".\windows-manual-evidence.txt"
)

$ErrorActionPreference = "Stop"

function Ensure-ParentDirectory {
  param([string]$Path)
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

$windowsVersion = (Get-ComputerInfo -Property WindowsProductName, WindowsVersion, OsBuildNumber | Out-String).Trim()
$date = (Get-Date).ToString("yyyy-MM-dd")
$machine = $env:COMPUTERNAME
$operator = $env:USERNAME

$installSourceNpm = if ($InstallSource -eq "npm global install") { "x" } else { " " }
$installSourceSource = if ($InstallSource -eq "source install") { "x" } else { " " }

$content = @"
# Windows Manual Checklist Result Template

Use this template after running [windows-manual-checklist.md](windows-manual-checklist.md) on a real Windows machine.

## Session Metadata

- Date: $date
- Operator: $operator
- Machine: $machine
- Windows version: $windowsVersion
- Codex version:
- codex-switcher version:
- Install source:
  - [$installSourceNpm] npm global install
  - [$installSourceSource] source install
- Shells verified:
  - [ ] PowerShell
  - [ ] cmd
  - [ ] Windows Terminal

## Checklist Result

- [ ] Setup
- [ ] Shell install paths
- [ ] CLI isolation
- [ ] App switching
- [ ] TUI checks
- [ ] Recovery and integrity
- [ ] Token refresh and logs
- [ ] Security checks

## Command Evidence

If you used `scripts/windows-manual-capture.ps1`, note whether you ran it from a repository checkout or from a package contents directory, attach `$EvidencePath`, then paste or summarize the most important outputs here:

```text
codex-sw check:

codex-sw platform:

codex-sw ops doctor:

codex-sw app status:

codex-sw ops token-refresh status:
```

## Notes by Section

### Setup

- Outcome:
- Evidence:

### Shell install paths

- Outcome:
- Evidence:

### CLI isolation

- Outcome:
- Evidence:

### App switching

- Outcome:
- Evidence:

### TUI checks

- Outcome:
- Evidence:

### Recovery and integrity

- Outcome:
- Evidence:

### Token refresh and logs

- Outcome:
- Evidence:

### Security checks

- Outcome:
- Evidence:

## Open Issues

- Issue:
- Impact:
- Reproduction:
- Suggested next step:

## Final Verdict

- [ ] Passed without blockers
- [ ] Passed with minor caveats
- [ ] Failed and needs code changes

Summary:
"@

Ensure-ParentDirectory -Path $OutputPath
Set-Content -Path $OutputPath -Value $content
Write-Host "Result template written to $OutputPath"
