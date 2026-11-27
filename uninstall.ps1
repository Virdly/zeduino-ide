# ZedArduino IDE - uninstall
#
# Removes the program installed by install.ps1. Settings and logs are kept by
# default; pass -RemoveSettings to delete %APPDATA%\ZedArduino IDE as well.

param(
    [switch]$RemoveSettings
)

$ErrorActionPreference = 'Stop'
$target = Join-Path $env:LOCALAPPDATA 'Programs\ZedArduino IDE'

Get-Process ZedArduinoIDE -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep -Milliseconds 400

foreach ($lnk in @(
    (Join-Path ([Environment]::GetFolderPath('Desktop')) 'ZedArduino IDE.lnk'),
    (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\ZedArduino IDE.lnk')
)) {
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
}

if (Test-Path $target) {
    Remove-Item $target -Recurse -Force
    Write-Host "Removed $target"
} else {
    Write-Host 'Program folder not found, nothing to remove.'
}

if ($RemoveSettings) {
    $settings = Join-Path $env:APPDATA 'ZedArduino IDE'
    if (Test-Path $settings) {
        Remove-Item $settings -Recurse -Force
        Write-Host "Removed settings $settings"
    }
}

Write-Host 'Done.' -ForegroundColor Green
