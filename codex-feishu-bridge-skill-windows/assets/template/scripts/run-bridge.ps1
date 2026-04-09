$ErrorActionPreference = "Stop"
Set-Location "__INSTALL_DIR__"

$envFile = "__INSTALL_DIR__\.bridge.env"
if (Test-Path $envFile) {
  Get-Content $envFile | ForEach-Object {
    if ($_ -match '^\s*#' -or $_ -notmatch '=') { return }
    $parts = $_ -split '=', 2
    $name = $parts[0].Trim()
    $value = $parts[1].Trim()
    if ($value.StartsWith('"') -and $value.EndsWith('"')) {
      $value = $value.Substring(1, $value.Length - 2)
    }
    [Environment]::SetEnvironmentVariable($name, $value)
  }
}

if (Get-Command node -ErrorAction SilentlyContinue) {
  & node src/bridge.js
  exit $LASTEXITCODE
}

Write-Error "node not found on PATH"
exit 1
