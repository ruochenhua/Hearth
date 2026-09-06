$script:DockerAccessDeniedMessage = 'Docker Desktop is running, but this Windows account cannot access Docker Engine. Add the account to the docker-users group, then sign out and sign in to Windows once.'

function ConvertTo-SubnetCidr {
  param(
    [Parameter(Mandatory)][string]$IPAddress,
    [Parameter(Mandatory)][int]$PrefixLength
  )
  $octets = @($IPAddress.Split('.') | ForEach-Object { [int]$_ })
  if ($octets.Count -ne 4 -or $PrefixLength -lt 0 -or $PrefixLength -gt 32) { throw "Invalid IPv4 network: $IPAddress/$PrefixLength" }
  $fullOctets = [math]::Floor($PrefixLength / 8)
  $remainder = $PrefixLength % 8
  for ($index = 0; $index -lt 4; $index++) {
    if ($index -lt $fullOctets) { continue }
    if ($index -eq $fullOctets -and $remainder -gt 0) {
      $mask = 256 - [math]::Pow(2, 8 - $remainder)
      $octets[$index] = $octets[$index] -band [int]$mask
    } else { $octets[$index] = 0 }
  }
  return (($octets -join '.') + '/' + $PrefixLength)
}

function Get-DockerEngineProbe {
  $previousErrorAction = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $outputLines = @(& docker info 2>&1 | ForEach-Object { $_.ToString() })
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousErrorAction
  }
  [PSCustomObject]@{ Ready = ($exitCode -eq 0); Output = ($outputLines -join [Environment]::NewLine).Trim() }
}

function Test-DockerAccessDenied {
  param([Parameter(Mandatory)]$Probe)
  return $Probe.Output -match '(?i)access is denied|拒绝访问'
}

function Wait-DockerEngine {
  param(
    [int]$TimeoutSeconds = 120,
    [int]$PollSeconds = 2
  )

  $probe = Get-DockerEngineProbe
  if ($probe.Ready) { return $true }
  if (Test-DockerAccessDenied $probe) { throw $script:DockerAccessDeniedMessage }

  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    if ($PollSeconds -gt 0) { Start-Sleep -Seconds $PollSeconds }
    $probe = Get-DockerEngineProbe
    if ($probe.Ready) { return $true }
    if (Test-DockerAccessDenied $probe) { throw $script:DockerAccessDeniedMessage }
  }

  throw "Docker Desktop did not expose Docker Engine within $TimeoutSeconds seconds. Open Docker Desktop and check its status, then try again."
}
