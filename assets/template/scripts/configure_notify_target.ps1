param([string]$ChatId = "")

$ErrorActionPreference = "Stop"
$root = "__INSTALL_DIR__"
$envFile = Join-Path $root ".bridge.env"
$example = Join-Path $root ".bridge.env.example"

if (-not $ChatId) {
  $ChatId = Read-Host "Enter Feishu chat id for publish-success notifications"
}
if (-not $ChatId) {
  throw "No chat id provided."
}

if (-not (Test-Path $envFile) -and (Test-Path $example)) {
  Copy-Item $example $envFile
}

$lines = @()
if (Test-Path $envFile) {
  $lines = Get-Content $envFile
}

$needle = "CODEX_BRIDGE_PUBLISH_NOTIFY_CHAT_ID="
$newLine = $needle + '"' + $ChatId + '"'
$found = $false
$out = foreach ($line in $lines) {
  if ($line.StartsWith($needle)) {
    $found = $true
    $newLine
  } else {
    $line
  }
}
if (-not $found) {
  $out += $newLine
}
Set-Content -LiteralPath $envFile -Value $out

Write-Host "Updated publish notify chat id: $ChatId"
Write-Host "Restart the bridge if it is already running."
