$ErrorActionPreference = "SilentlyContinue"
$root = "__INSTALL_DIR__"
$pidFile = Join-Path $root ".run\bridge.pid"
$logFile = Join-Path $root "bridge.log"

Write-Host "== process =="
if (Test-Path $pidFile) {
  $pid = (Get-Content $pidFile -Raw).Trim()
  $proc = Get-Process -Id $pid -ErrorAction SilentlyContinue
  if ($proc) {
    Write-Host "running (PID $pid)"
  } else {
    Write-Host "not running (stale pid file)"
  }
} else {
  Write-Host "not running"
}

Write-Host ""
Write-Host "== recent bridge log =="
if (Test-Path $logFile) {
  Get-Content $logFile -Tail 30
} else {
  Write-Host "bridge.log not found"
}
