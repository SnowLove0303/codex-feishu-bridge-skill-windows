param([int]$Lines = 80)
$logFile = "__INSTALL_DIR__\bridge.log"
if (Test-Path $logFile) {
  Get-Content $logFile -Tail $Lines
} else {
  Write-Host "bridge.log not found"
}
