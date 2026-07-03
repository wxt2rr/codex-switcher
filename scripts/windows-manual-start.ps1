param(
  [string]$EvidencePath = ".\windows-manual-evidence.txt",
  [string]$ResultPath = ".\windows-manual-result.md",
  [string]$InstallSource = "npm global install"
)

$ErrorActionPreference = "Stop"

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$captureScript = Join-Path $scriptRoot "windows-manual-capture.ps1"
$resultTemplateScript = Join-Path $scriptRoot "windows-manual-result-template.ps1"

if (-not (Test-Path -LiteralPath $captureScript)) {
  throw "Missing helper script: $captureScript"
}

if (-not (Test-Path -LiteralPath $resultTemplateScript)) {
  throw "Missing helper script: $resultTemplateScript"
}

powershell -ExecutionPolicy Bypass -File $captureScript -OutputPath $EvidencePath
powershell -ExecutionPolicy Bypass -File $resultTemplateScript -OutputPath $ResultPath -InstallSource $InstallSource -EvidencePath $EvidencePath

Write-Host "Windows manual verification started."
Write-Host "Evidence file: $EvidencePath"
Write-Host "Result template: $ResultPath"
