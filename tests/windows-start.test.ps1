$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\scripts\platform\windows-docker.ps1')

function Assert-True([bool]$Value, [string]$Message) {
  if (-not $Value) { throw "Assertion failed: $Message" }
}

function Assert-ThrowsContaining([scriptblock]$Block, [string]$Text) {
  try { & $Block; throw "Expected an error containing '$Text'." }
  catch {
    if ($_.Exception.Message -notmatch [regex]::Escape($Text)) { throw "Unexpected error: $($_.Exception.Message)" }
  }
}

$script:FakeDockerMode = 'ready'
function docker {
  param([Parameter(ValueFromRemainingArguments = $true)]$Arguments)
  switch ($script:FakeDockerMode) {
    'ready' { 'Server: Docker Engine'; $global:LASTEXITCODE = 0 }
    'warning' { Write-Error -ErrorAction Continue 'WARNING: No blkio throttle.read_bps_device support'; 'Server: Docker Engine'; $global:LASTEXITCODE = 0 }
    'denied' { 'error during connect: Access is denied'; $global:LASTEXITCODE = 1 }
    'starting' { 'error during connect: daemon is starting'; $global:LASTEXITCODE = 1 }
  }
}

Assert-True (Wait-DockerEngine -TimeoutSeconds 1 -PollSeconds 0) 'ready engine should pass immediately'
$script:FakeDockerMode = 'warning'
Assert-True (Wait-DockerEngine -TimeoutSeconds 1 -PollSeconds 0) 'Docker warnings should not fail a ready engine'
$cidr = ConvertTo-SubnetCidr -IPAddress '192.168.31.89' -PrefixLength 24
Assert-True ($cidr -eq '192.168.31.0/24') '24-bit subnet should be calculated correctly'
$cidr = ConvertTo-SubnetCidr -IPAddress '192.168.31.89' -PrefixLength 20
Assert-True ($cidr -eq '192.168.16.0/20') '20-bit subnet should be calculated correctly'
$privateRanges = @('10.0.0.0/8', '172.16.0.0/12', '192.168.0.0/16')
Assert-True ($privateRanges.Count -eq 3) 'LAN and Docker private ranges should be covered'
$script:FakeDockerMode = 'denied'
Assert-ThrowsContaining { Wait-DockerEngine -TimeoutSeconds 1 -PollSeconds 0 } 'docker-users'
$script:FakeDockerMode = 'starting'
Assert-ThrowsContaining { Wait-DockerEngine -TimeoutSeconds 0 -PollSeconds 0 } 'did not expose Docker Engine'
Write-Output 'WINDOWS_START_HELPERS_OK'
