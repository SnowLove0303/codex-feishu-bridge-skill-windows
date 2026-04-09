param(
  [string]$TargetDir = "$HOME\.codex-feishu-bridge"
)

$ErrorActionPreference = "Stop"

$SkillDir = Split-Path -Parent $PSScriptRoot
$TemplateDir = Join-Path $SkillDir "assets\template"

New-Item -ItemType Directory -Force -Path $TargetDir | Out-Null
Copy-Item -Path (Join-Path $TemplateDir "*") -Destination $TargetDir -Recurse -Force

$files = Get-ChildItem -Path $TargetDir -Recurse -File | Where-Object {
  $_.Extension -in ".ps1", ".cmd", ".js", ".json" -or $_.Name -eq ".bridge.env.example"
}

foreach ($file in $files) {
  $content = Get-Content -Raw -LiteralPath $file.FullName
  $replacement = if ($file.Extension -in ".js", ".json") {
    $TargetDir.Replace("\", "\\")
  } else {
    $TargetDir
  }
  $content = $content.Replace("__INSTALL_DIR__", $replacement)
  Set-Content -LiteralPath $file.FullName -Value $content -NoNewline
}

$envExample = Join-Path $TargetDir ".bridge.env.example"
$envFile = Join-Path $TargetDir ".bridge.env"
if ((Test-Path $envExample) -and -not (Test-Path $envFile)) {
  Copy-Item $envExample $envFile
}

Write-Host "Installed Windows bridge template to: $TargetDir"
Write-Host "Next steps:"
Write-Host "1. cd $TargetDir"
Write-Host "2. npm install"
Write-Host "3. node .\node_modules\@larksuite\cli\scripts\run.js config init --app-id <APP_ID> --app-secret-stdin --brand feishu"
Write-Host "4. node .\node_modules\@larksuite\cli\scripts\run.js auth login --domain im,event --recommend"
Write-Host "5. powershell -ExecutionPolicy Bypass -File .\scripts\configure_notify_target.ps1 <CHAT_ID>"
Write-Host "   Or set it later from Feishu with /setnotifyhere"
Write-Host "6. powershell -ExecutionPolicy Bypass -File .\scripts\bridge-start.ps1"
