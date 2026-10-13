# Starts the LIFEOS production server bound to your LAN so the phone (or the
# test APK) can load it over Wi-Fi.
#
#   powershell -ExecutionPolicy Bypass -File scripts\start-lan.ps1
#
# Keep this window open. The phone must be on the same Wi-Fi network.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$ip = (Get-NetIPAddress -AddressFamily IPv4 |
  Where-Object {
    $_.IPAddress -notlike '127.*' -and
    $_.IPAddress -notlike '169.*' -and
    $_.InterfaceAlias -notlike 'VMware*' -and
    $_.InterfaceAlias -notlike 'vEthernet*'
  } |
  Select-Object -First 1).IPAddress

if (-not $ip) { throw "No LAN IPv4 address found. Connect to Wi-Fi first." }

$url = "http://${ip}:3000"
$env:NEXT_PUBLIC_APP_URL = $url
$env:AUTH_URL = $url
$env:AUTH_TRUST_HOST = "true"
$env:HOSTNAME = "0.0.0.0"

Write-Host ""
Write-Host "  LIFEOS LAN server : $url" -ForegroundColor Green
Write-Host "  Keep this window open while using the app." -ForegroundColor DarkGray
Write-Host "  Phone must be on the same Wi-Fi network." -ForegroundColor DarkGray
Write-Host ""

npx next start -H 0.0.0.0 -p 3000
