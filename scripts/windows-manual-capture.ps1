param(
  [string]$OutputPath = ".\windows-manual-evidence.txt"
)

$ErrorActionPreference = "Stop"

function Ensure-ParentDirectory {
  param([string]$Path)
  $parent = Split-Path -Parent $Path
  if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
  }
}

function Write-Section {
  param([string]$Title)
  Add-Content -Path $OutputPath -Value ""
  Add-Content -Path $OutputPath -Value ("=== " + $Title + " ===")
}

function Invoke-And-Capture {
  param(
    [string]$Label,
    [string]$Command
  )

  Write-Section $Label
  Add-Content -Path $OutputPath -Value ("> " + $Command)
  try {
    $result = Invoke-Expression $Command | Out-String
    Add-Content -Path $OutputPath -Value $result.TrimEnd()
  } catch {
    Add-Content -Path $OutputPath -Value ("ERROR: " + $_.Exception.Message)
    throw
  }
}

Ensure-ParentDirectory -Path $OutputPath
"codex-switcher Windows manual evidence" | Set-Content -Path $OutputPath
("generated_at: " + (Get-Date).ToString("s")) | Add-Content -Path $OutputPath
("hostname: " + $env:COMPUTERNAME) | Add-Content -Path $OutputPath
("user: " + $env:USERNAME) | Add-Content -Path $OutputPath

Invoke-And-Capture "codex-sw check" "codex-sw check"
Invoke-And-Capture "codex-sw platform" "codex-sw platform"
Invoke-And-Capture "codex-sw ops doctor" "codex-sw ops doctor"
Invoke-And-Capture "codex-sw status" "codex-sw status"
Invoke-And-Capture "codex-sw app status" "codex-sw app status"
Invoke-And-Capture "codex-sw ops token-refresh status" "codex-sw ops token-refresh status"

Write-Host "Evidence written to $OutputPath"
