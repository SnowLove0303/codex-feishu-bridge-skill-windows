$ErrorActionPreference = "Stop"
$root = "__INSTALL_DIR__"
$runDir = Join-Path $root ".run"
$pidFile = Join-Path $runDir "bridge.pid"
$stdout = Join-Path $root "bridge.stdout.log"
$stderr = Join-Path $root "bridge.stderr.log"
New-Item -ItemType Directory -Force -Path $runDir | Out-Null

if (Test-Path $pidFile) {
  $existingPid = (Get-Content $pidFile -Raw).Trim()
  if ($existingPid) {
    $existing = Get-Process -Id $existingPid -ErrorAction SilentlyContinue
    if ($existing) {
      Write-Host "Bridge already running with PID $existingPid"
      exit 0
    }
  }
}

$proc = Start-Process -FilePath "powershell" `
  -ArgumentList @("-ExecutionPolicy","Bypass","-File",(Join-Path $root "scripts\run-bridge.ps1")) `
  -WorkingDirectory $root `
  -RedirectStandardOutput $stdout `
  -RedirectStandardError $stderr `
  -WindowStyle Hidden `
  -PassThru

Set-Content -LiteralPath $pidFile -Value $proc.Id
Write-Host "Bridge started with PID $($proc.Id)"
