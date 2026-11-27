# ZedArduino IDE - quick install (Windows, no admin rights required)
#
# Usage:
#   Right click -> "Run with PowerShell", or:
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
#
# Installs the portable build from this folder (or .\artifacts\ZedArduinoIDE /
# .\release\ZedArduinoIDE when run from the repository) into
# %LOCALAPPDATA%\Programs\ZedArduino IDE and creates Desktop + Start Menu shortcuts.

param(
    [string]$Source,
    [switch]$NoLaunch
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $Source) {
    $candidates = @(
        $here,
        (Join-Path $here 'artifacts\ZedArduinoIDE'),
        (Join-Path $here 'release\ZedArduinoIDE')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path (Join-Path $candidate 'ZedArduinoIDE.exe')) {
            $Source = $candidate
            break
        }
    }
}

if (-not $Source -or -not (Test-Path (Join-Path $Source 'ZedArduinoIDE.exe'))) {
    throw 'ZedArduinoIDE.exe not found. Put install.ps1 into the portable app folder or pass -Source.'
}

$Source = (Resolve-Path $Source).Path
$target = Join-Path $env:LOCALAPPDATA 'Programs\ZedArduino IDE'

Write-Host "Installing ZedArduino IDE" -ForegroundColor Cyan
Write-Host "  from: $Source"
Write-Host "  to:   $target"

Get-Process ZedArduinoIDE -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

New-Item -ItemType Directory -Force -Path $target | Out-Null
robocopy $Source $target /E /NFL /NDL /NJH /NJS /MT:8 | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed with exit code $LASTEXITCODE" }

$exe = Join-Path $target 'ZedArduinoIDE.exe'
$icon = Join-Path $target 'icon.ico'

$ws = New-Object -ComObject WScript.Shell
$shortcuts = @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ZedArduino IDE.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ZedArduino IDE.lnk')
)
foreach ($lnkPath in $shortcuts) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $lnkPath) | Out-Null
    $shortcut = $ws.CreateShortcut($lnkPath)
    $shortcut.TargetPath = $exe
    $shortcut.WorkingDirectory = $target
    if (Test-Path $icon) { $shortcut.IconLocation = "$icon,0" }
    $shortcut.Description = 'ZedArduino IDE'
    $shortcut.Save()
}

Write-Host 'Installed.' -ForegroundColor Green
if (-not $NoLaunch) {
    Start-Process -FilePath $exe -WorkingDirectory $target
}
