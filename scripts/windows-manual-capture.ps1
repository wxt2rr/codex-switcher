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

$helperCandidates = @(
  ".\apps\desktop\resources\native\windows\codex-switcher-plugin-sandbox.exe",
  ".\resources\native\windows\codex-switcher-plugin-sandbox.exe"
)
$helperPath = $helperCandidates |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
$smokeScript = ".\scripts\windows-plugin-sandbox-smoke.cjs"
$verifyScript = ".\scripts\verify-sandbox-evidence.mjs"
$nodePath = (Get-Command node.exe -ErrorAction SilentlyContinue).Source

if ($helperPath -and (Test-Path -LiteralPath $smokeScript -PathType Leaf) -and
    (Test-Path -LiteralPath $verifyScript -PathType Leaf) -and $nodePath) {
  $outputFullPath = [System.IO.Path]::GetFullPath($OutputPath)
  $evidenceDirectory = Split-Path -Parent $outputFullPath
  $sandboxEvidencePath = Join-Path $evidenceDirectory "windows-sandbox.json"
  $env:CODEX_SWITCHER_EVIDENCE_OUT = $sandboxEvidencePath
  $smokeCommand = 'node "' + [System.IO.Path]::GetFullPath($smokeScript) +
    '" --launcher "' + [System.IO.Path]::GetFullPath($helperPath) +
    '" --node "' + $nodePath + '" --evidence-out "' + $sandboxEvidencePath + '"'
  $verifyCommand = 'node "' + [System.IO.Path]::GetFullPath($verifyScript) +
    '" "' + $sandboxEvidencePath + '"'
  Invoke-And-Capture "Windows AppContainer smoke" $smokeCommand
  Invoke-And-Capture "Windows AppContainer evidence verification" $verifyCommand
} else {
  Write-Section "Windows plugin sandbox smoke"
  Add-Content -Path $OutputPath -Value "SKIPPED: Windows AppContainer helper or smoke scripts were not found."
}

Write-Host "Evidence written to $OutputPath"
