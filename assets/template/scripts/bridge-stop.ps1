$ErrorActionPreference = "SilentlyContinue"
$root = "__INSTALL_DIR__"
$pidFile = Join-Path $root ".run\bridge.pid"
if (Test-Path $pidFile) {
  $pid = (Get-Content $pidFile -Raw).Trim()
  if ($pid) {
    Stop-Process -Id $pid -Force
  }
  Remove-Item $pidFile -Force
}
Write-Host "Bridge stopped."
