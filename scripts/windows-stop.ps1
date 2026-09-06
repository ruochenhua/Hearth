$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location -LiteralPath $root
& docker compose stop album
if ($LASTEXITCODE -ne 0) { throw 'The album could not be stopped. Check Docker Desktop.' }
