param(
  [switch]$NoBrowser,
  [switch]$ForceRecreate,
  [switch]$NoPause,
  [switch]$RepairFirewall
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location -LiteralPath $projectRoot
. (Join-Path $PSScriptRoot 'docker.ps1')

# This launcher elevates only the setup step. The firewall rule is narrow:
# TCP 3080 from the local subnet, never a public port-forward rule.
$ruleName = 'Hearth LAN album (TCP 3080)'
$legacyRuleName = 'MyMoment LAN album (TCP 3080)'
Get-NetFirewallRule -DisplayName $legacyRuleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
$route = Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Sort-Object RouteMetric | Select-Object -First 1
$wifiAddress = if ($route) { Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notmatch '^169\.254\.' } | Select-Object -First 1 } else { Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^192\.168\.' } | Select-Object -First 1 }
$remoteAddresses = @('LocalSubnet', '10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')
if ($wifiAddress) { $remoteAddresses += ConvertTo-SubnetCidr -IPAddress $wifiAddress.IPAddress -PrefixLength $wifiAddress.PrefixLength }
$remoteAddresses = @($remoteAddresses | Select-Object -Unique)
$existingRule = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
$ruleExists = $null -ne $existingRule
$existingAddressFilter = if ($existingRule) { Get-NetFirewallAddressFilter -AssociatedNetFirewallRule $existingRule -ErrorAction SilentlyContinue } else { $null }
$missingRemoteAddresses = if ($existingAddressFilter) { @($remoteAddresses | Where-Object { $existingAddressFilter.RemoteAddress -notcontains $_ }) } else { @($remoteAddresses) }
$needsFirewall = $RepairFirewall -or -not $ruleExists -or $missingRemoteAddresses.Count -gt 0
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if ($needsFirewall -and -not ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator))) {
  $elevatedArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"{0}"' -f $MyInvocation.MyCommand.Path))
  if ($NoBrowser) { $elevatedArgs += '-NoBrowser' }
  if ($ForceRecreate) { $elevatedArgs += '-ForceRecreate' }
  if ($NoPause) { $elevatedArgs += '-NoPause' }
  if ($RepairFirewall) { $elevatedArgs += '-RepairFirewall' }
  $systemPowerShell = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $elevated = Start-Process -FilePath $systemPowerShell -Verb RunAs -ArgumentList $elevatedArgs -Wait -PassThru
  if ($elevated.ExitCode -ne 0) { throw "Administrator startup failed with exit code $($elevated.ExitCode)." }
  exit 0
}

if ($needsFirewall -and $ruleExists) {
  Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule
  $ruleExists = $false
}
if (-not $ruleExists) {
  New-NetFirewallRule -DisplayName $ruleName -Description 'Allow Hearth from the local subnet only. No public port forwarding.' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3080 -Profile Any -RemoteAddress $remoteAddresses | Out-Null
}

if (-not (Get-Command docker.exe -ErrorAction SilentlyContinue)) {
  throw 'Docker Desktop was not found. Install it first.'
}

$dockerProbe = Get-DockerEngineProbe
if (-not $dockerProbe.Ready) {
  if (Test-DockerAccessDenied $dockerProbe) { throw $script:DockerAccessDeniedMessage }
  $desktop = Join-Path ${env:ProgramFiles} 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path -LiteralPath $desktop) {
    $desktopProcess = Get-Process -Name 'Docker Desktop' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($null -eq $desktopProcess) {
      Start-Process -FilePath $desktop -WindowStyle Hidden
      Write-Host 'Starting Docker Desktop and waiting for it to be ready...'
    } else {
      Write-Host 'Docker Desktop is open; waiting for Docker Engine...'
    }
    [void](Wait-DockerEngine -TimeoutSeconds 120 -PollSeconds 2)
  } else { throw 'Docker Desktop is not running.' }
}

$upArgs = @('compose','up','-d','--build','--wait','--wait-timeout','90')
if ($ForceRecreate) { $upArgs += '--force-recreate' }
# Docker cannot enumerate the host's Wi-Fi adapter from inside the container.
# Pass the default-route address explicitly so QR generation remains stable.
if ($wifiAddress) { $env:ALBUM_LAN_ADDRESSES = $wifiAddress.IPAddress }
else { Remove-Item Env:ALBUM_LAN_ADDRESSES -ErrorAction SilentlyContinue }
& docker @upArgs
if ($LASTEXITCODE -ne 0) { throw '相册容器启动失败，请在 Docker Desktop 中查看围炉日志。' }

$healthy = $false
for ($i = 0; $i -lt 30; $i++) {
  try {
    $response = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/api/health' -UseBasicParsing -TimeoutSec 3
    if ($response.StatusCode -eq 200) { $healthy = $true; break }
  } catch { }
  Start-Sleep -Seconds 1
}
if (-not $healthy) { throw 'The album container started but health check failed. Check the Docker Desktop logs.' }

$wifi = $wifiAddress.IPAddress
Write-Host ''
Write-Host '围炉已就绪。' -ForegroundColor Green
Write-Host 'Local: http://localhost:3080'
if ($wifi) { Write-Host "LAN: http://${wifi}:3080" }
Write-Host 'Firewall rule: TCP 3080 is allowed from the local subnet only.'
if (-not $NoBrowser) { Start-Process 'http://localhost:3080' }
if (-not $NoPause) { Read-Host 'Press Enter to close this window' }
