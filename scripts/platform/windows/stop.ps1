$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location -LiteralPath $root
& docker compose stop album
if ($LASTEXITCODE -ne 0) { throw 'The album could not be stopped. Check Docker Desktop.' }
