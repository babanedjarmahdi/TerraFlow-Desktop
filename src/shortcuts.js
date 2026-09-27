import fs from 'fs';
import path from 'path';
import { isWindows } from './autostart.js';
import { runPowerShell } from './powershell.js';

const SCRIPT = `
param(
  [string]$Action = 'create',
  [string]$InstallDir = '',
  [string]$DesktopDir = '',
  [string]$StartMenuDir = '',
  [string]$Icon = ''
)
$ErrorActionPreference = 'Stop'

if (-not $InstallDir) { throw 'InstallDir is required' }
if (-not (Test-Path -LiteralPath $InstallDir)) { throw "install dir not found: $InstallDir" }

$desktop = if ($DesktopDir) { $DesktopDir } else { [Environment]::GetFolderPath('Desktop') }
$programs = if ($StartMenuDir) { $StartMenuDir } else { Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs' }
$appMenu = Join-Path $programs 'TerraFlow'
$mainLnk = Join-Path $desktop 'TerraFlow.lnk'

function New-Lnk($path, $target, $arguments) {
  $ws = New-Object -ComObject WScript.Shell
  $l = $ws.CreateShortcut($path)
  $l.TargetPath = $target
  if ($arguments) { $l.Arguments = $arguments }
  $l.WorkingDirectory = $InstallDir
  $l.Description = 'TerraFlow Desktop Runtime'
  if ($Icon -and (Test-Path -LiteralPath $Icon)) { $l.IconLocation = $Icon + ',0' }
  $l.Save()
}

if ($Action -eq 'create') {
  $wscript = Join-Path $env:WINDIR 'System32\\wscript.exe'
  $vbs = Join-Path $InstallDir 'TerraFlow.vbs'
  $uninstall = Join-Path $InstallDir 'uninstall.cmd'
  if (-not (Test-Path -LiteralPath $vbs)) { throw "missing launcher: $vbs" }
  if ($DesktopDir) { New-Item -ItemType Directory -Force -Path $desktop | Out-Null }
  New-Item -ItemType Directory -Force -Path $appMenu | Out-Null

  New-Lnk $mainLnk $wscript ('"{0}"' -f $vbs)
  $menuMain = Join-Path $appMenu 'TerraFlow.lnk'
  New-Lnk $menuMain $wscript ('"{0}"' -f $vbs)

  $links = @($mainLnk, $menuMain)
  if (Test-Path -LiteralPath $uninstall) {
    $menuUn = Join-Path $appMenu 'Uninstall TerraFlow.lnk'
    New-Lnk $menuUn $uninstall ''
    $links += $menuUn
  }
  $result = @{ ok = $true; links = @($links) } | ConvertTo-Json -Compress
  Write-Output ('RESULT:' + $result)
} else {
  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $mainLnk
  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath (Join-Path $appMenu 'TerraFlow.lnk')
  Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath (Join-Path $appMenu 'Uninstall TerraFlow.lnk')
  if (Test-Path -LiteralPath $appMenu) {
    if (-not (Get-ChildItem -Force -LiteralPath $appMenu)) {
      Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $appMenu
    }
  }
  if ((Test-Path -LiteralPath $programs) -and -not $StartMenuDir) {
    if (-not (Get-ChildItem -Force -LiteralPath $programs -ErrorAction SilentlyContinue)) {
      Remove-Item -Force -ErrorAction SilentlyContinue -LiteralPath $programs
    }
  }
  $result = @{ ok = $true } | ConvertTo-Json -Compress
  Write-Output ('RESULT:' + $result)
}
`;

function parseResult(r) {
  if (r.code !== 0) {
    return { ok: false, error: r.err || r.out || `powershell exited with ${r.code}` };
  }
  const line = r.out.split(/\r?\n/).find((l) => l.startsWith('RESULT:'));
  if (!line) return { ok: false, error: r.err || r.out || 'no result from shortcut script' };
  try {
    return JSON.parse(line.slice(7));
  } catch {
    return { ok: false, error: 'could not parse shortcut script output' };
  }
}

export async function createShortcuts({ installDir, desktopDir = '', startMenuDir = '', iconPath = '' }) {
  if (!isWindows()) return { supported: false, ok: false, reason: 'non-windows' };
  const args = ['-Action', 'create', '-InstallDir', installDir];
  if (desktopDir) args.push('-DesktopDir', desktopDir);
  if (startMenuDir) args.push('-StartMenuDir', startMenuDir);
  if (iconPath && fs.existsSync(iconPath)) args.push('-Icon', iconPath);
  const r = await runPowerShell(SCRIPT, args, { timeoutMs: 30000 });
  const parsed = parseResult(r);
  return { supported: true, ...parsed };
}

export async function removeShortcuts({ installDir, desktopDir = '', startMenuDir = '' }) {
  if (!isWindows()) return { supported: false, ok: false, reason: 'non-windows' };
  const args = ['-Action', 'remove', '-InstallDir', installDir];
  if (desktopDir) args.push('-DesktopDir', desktopDir);
  if (startMenuDir) args.push('-StartMenuDir', startMenuDir);
  const r = await runPowerShell(SCRIPT, args, { timeoutMs: 30000 });
  const parsed = parseResult(r);
  return { supported: true, ...parsed };
}

export { SCRIPT as SHORTCUTS_PS_SCRIPT };
