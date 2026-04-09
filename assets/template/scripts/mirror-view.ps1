param(
  [string]$Target = "latest",
  [int]$Count = 60
)

$ErrorActionPreference = "Stop"
$statePath = "__INSTALL_DIR__\.codex-feishu-bridge\state.json"
if (-not (Test-Path $statePath)) {
  throw "state.json not found"
}

$state = Get-Content $statePath -Raw | ConvertFrom-Json
$conversations = @()
foreach ($p in $state.conversations.PSObject.Properties) {
  $conversations += [PSCustomObject]@{ Key = $p.Name; Value = $p.Value }
}

if ($Target -eq "latest") {
  $match = $conversations | Sort-Object { $_.Value.updatedAt } -Descending | Select-Object -First 1
} else {
  $match = $conversations | Where-Object {
    $_.Value.threadId -eq $Target -or $_.Value.chatId -eq $Target -or $_.Value.senderOpenId -eq $Target -or $_.Key -eq $Target
  } | Select-Object -First 1
}

if (-not $match) {
  throw "No mirrored conversation matched: $Target"
}

$history = @($match.Value.history)
if ($history.Count -gt $Count) {
  $history = $history | Select-Object -Last $Count
}

Write-Host "== Mirror View =="
Write-Host "conversationKey: $($match.Key)"
Write-Host "chatId: $($match.Value.chatId)"
Write-Host "senderOpenId: $($match.Value.senderOpenId)"
Write-Host "threadId: $($match.Value.threadId)"
Write-Host "updatedAt: $($match.Value.updatedAt)"
if ($match.Value.mirror.markdown) { Write-Host "markdown: $($match.Value.mirror.markdown)" }
if ($match.Value.mirror.jsonl) { Write-Host "jsonl: $($match.Value.mirror.jsonl)" }
Write-Host ""
Write-Host "== Recent $($history.Count) item(s) =="
foreach ($item in $history) {
  $role = if ($item.role -eq "user") { "User" } elseif ($item.role -eq "assistant") { "Assistant" } else { "System" }
  Write-Host "[$role] $($item.at) | $($item.source)"
  Write-Host $item.text
  Write-Host ""
}
