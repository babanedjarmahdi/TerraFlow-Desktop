# Ensures a per-user Node.js >= 18 is available (no admin rights required).
$ErrorActionPreference = 'Stop'
$dest = Join-Path $env:LOCALAPPDATA 'Programs\TerraFlow\nodejs'
$nodeExe = Join-Path $dest 'node.exe'
$minMajor = 18
$version = '20.18.0'

function Get-Major($exe) {
  try {
    $v = (& $exe -v 2>$null | Select-Object -First 1)
    if ($v -and $v -match '^v?(\d+)') { return [int]$Matches[1] }
  } catch {}
  return 0
}

if (Test-Path -LiteralPath $nodeExe) {
  $major = Get-Major $nodeExe
  if ($major -ge $minMajor) {
    Write-Output "node ready (bundled install at $dest)"
    exit 0
  }
}

$arch = 'x64'
if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { $arch = 'arm64' }
$url = "https://nodejs.org/dist/v$version/node-v$version-win-$arch.zip"
$zip = Join-Path $env:TEMP "node-v$version-win-$arch.zip"

Write-Output "downloading Node.js $version ($arch) from nodejs.org ..."
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
  Invoke-WebRequest -Uri $url -OutFile $zip -UseBasicParsing -TimeoutSec 300
} catch {
  Write-Output "DOWNLOAD_FAILED: $($_.Exception.Message)"
  Write-Output 'Opening the Node.js download page - install it manually, then run the installer again.'
  try { Start-Process 'https://nodejs.org' } catch {}
  exit 1
}

if (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Recurse -Force }
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Expand-Archive -Path $zip -DestinationPath $dest -Force

$inner = Join-Path $dest "node-v$version-win-$arch"
if (Test-Path -LiteralPath $inner) {
  Get-ChildItem -LiteralPath $inner -Force | Move-Item -Destination $dest -Force
  Remove-Item -LiteralPath $inner -Recurse -Force
}
Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath $dest -Recurse -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue

$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
if (-not $userPath) { $userPath = '' }
if ($userPath -notlike "*$dest*") {
  $newPath = if ($userPath) { "$dest;$userPath" } else { $dest }
  [Environment]::SetEnvironmentVariable('Path', $newPath, 'User')
  Write-Output 'added Node.js to your user PATH'
}

$major = Get-Major $nodeExe
if ($major -lt $minMajor) {
  Write-Output "BAD_VERSION: installed node reports major $major"
  exit 1
}
Write-Output "node installed ($(& $nodeExe -v))"
exit 0
