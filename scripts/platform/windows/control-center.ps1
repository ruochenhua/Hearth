$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
Set-Location -LiteralPath $root
$startScript = Join-Path $PSScriptRoot 'start.ps1'
$stopScript = Join-Path $PSScriptRoot 'stop.ps1'
$envPath = Join-Path $root '.env'
$accessPath = Join-Path $root '.local-access.txt'

function New-TestPassword {
  $bytes = New-Object byte[] 9
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }
  return ([Convert]::ToBase64String($bytes) -replace '\+','-' -replace '/','_' -replace '=','')
}
function Ensure-Config {
  if (Test-Path -LiteralPath $envPath) { return $false }
  $password = New-TestPassword
  $text = @("ALBUM_PASSWORD=$password",'PORT=3080','HOST=0.0.0.0','DATA_DIR=./data','IMPORT_DIR=./inbox','TZ=Asia/Shanghai','COOKIE_SECURE=false','NODE_IMAGE=public.ecr.aws/docker/library/node:24-bookworm-slim') -join "`r`n"
  [IO.File]::WriteAllText($envPath,$text,(New-Object Text.UTF8Encoding($false)))
  [IO.File]::WriteAllText($accessPath,("围炉 Hearth local access`r`n`r`nLocal: http://localhost:3080`r`nPassword: $password`r`n`r`nLAN access uses the computer IPv4 address and port 3080.`r`nKeep this file private.`r`n"),(New-Object Text.UTF8Encoding($false)))
  return $true
}
function Invoke-Hidden($file,$arguments) { Start-Process -FilePath $file -ArgumentList $arguments -WindowStyle Hidden }
function Get-LanUrl {
  $ip = Get-NetIPAddress -AddressFamily IPv4 -Type Unicast -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -match '^192\.168\.' -and $_.IPAddress -notmatch '\.1$' } | Select-Object -First 1 -ExpandProperty IPAddress
  if ($ip) { return "http://${ip}:3080" }
  return 'LAN address unavailable'
}

$form = New-Object Windows.Forms.Form
$form.Text = '围炉 Hearth Control Center'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object Drawing.Size(560,400)
$form.MinimumSize = New-Object Drawing.Size(560,400)
$form.BackColor = [Drawing.Color]::FromArgb(247,249,249)
$form.Font = New-Object Drawing.Font('Segoe UI',10)

$title = New-Object Windows.Forms.Label
$title.Text = '围炉 Hearth'
$title.Font = New-Object Drawing.Font('Segoe UI',22,[Drawing.FontStyle]::Bold)
$title.ForeColor = [Drawing.Color]::FromArgb(23,63,75)
$title.Location = New-Object Drawing.Point(28,22); $title.AutoSize = $true
$form.Controls.Add($title)
$subtitle = New-Object Windows.Forms.Label
$subtitle.Text = 'Family album control center'
$subtitle.ForeColor = [Drawing.Color]::FromArgb(105,126,135)
$subtitle.Location = New-Object Drawing.Point(31,62); $subtitle.AutoSize = $true
$form.Controls.Add($subtitle)
$status = New-Object Windows.Forms.Label
$status.Text = 'Status: checking...'
$status.Location = New-Object Drawing.Point(31,105); $status.AutoSize = $true
$status.Font = New-Object Drawing.Font('Segoe UI',11,[Drawing.FontStyle]::Bold)
$form.Controls.Add($status)
$url = New-Object Windows.Forms.Label
$url.Text = 'Local: http://localhost:3080'
$url.Location = New-Object Drawing.Point(31,137); $url.AutoSize = $true
$url.ForeColor = [Drawing.Color]::FromArgb(92,122,133)
$form.Controls.Add($url)
$lan = New-Object Windows.Forms.Label
$lan.Text = "LAN: $(Get-LanUrl)"
$lan.Location = New-Object Drawing.Point(31,163); $lan.AutoSize = $true
$lan.ForeColor = [Drawing.Color]::FromArgb(92,122,133)
$form.Controls.Add($lan)

$start = New-Object Windows.Forms.Button
$start.Text = 'Start album'; $start.Location = New-Object Drawing.Point(31,210); $start.Size = New-Object Drawing.Size(145,42)
$form.Controls.Add($start)
$stop = New-Object Windows.Forms.Button
$stop.Text = 'Stop album'; $stop.Location = New-Object Drawing.Point(190,210); $stop.Size = New-Object Drawing.Size(145,42)
$form.Controls.Add($stop)
$open = New-Object Windows.Forms.Button
$open.Text = 'Open album'; $open.Location = New-Object Drawing.Point(349,210); $open.Size = New-Object Drawing.Size(145,42)
$form.Controls.Add($open)
$repair = New-Object Windows.Forms.Button
$repair.Text = 'Repair LAN access'; $repair.Location = New-Object Drawing.Point(31,267); $repair.Size = New-Object Drawing.Size(145,38)
$form.Controls.Add($repair)
$details = New-Object Windows.Forms.Button
$details.Text = 'Login details'; $details.Location = New-Object Drawing.Point(190,267); $details.Size = New-Object Drawing.Size(145,38)
$form.Controls.Add($details)
$hint = New-Object Windows.Forms.Label
$hint.Text = 'The first start may ask Windows for permission to add the local firewall rule.'
$hint.Location = New-Object Drawing.Point(31,325); $hint.AutoSize = $true
$hint.ForeColor = [Drawing.Color]::FromArgb(120,137,144)
$form.Controls.Add($hint)

$timer = New-Object Windows.Forms.Timer
$timer.Interval = 2000
function Update-Status {
  try {
    $r = Invoke-WebRequest -Uri 'http://127.0.0.1:3080/api/health' -UseBasicParsing -TimeoutSec 2
    if ($r.StatusCode -eq 200) { $status.Text = 'Status: running'; $status.ForeColor = [Drawing.Color]::FromArgb(55,126,91); $start.Enabled = $false; $stop.Enabled = $true; return }
  } catch { }
  $status.Text = 'Status: stopped'; $status.ForeColor = [Drawing.Color]::FromArgb(150,104,72); $start.Enabled = $true; $stop.Enabled = $false
}
$timer.Add_Tick({ Update-Status })
$timer.Start()

$start.Add_Click({
  try {
    $created = Ensure-Config
    if ($created) { [Windows.Forms.MessageBox]::Show($form,'A secure album password was created and saved in .local-access.txt.','围炉 Hearth') | Out-Null }
    Invoke-Hidden 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -ForceRecreate -NoBrowser -NoPause"
    $status.Text = 'Status: starting...'; $start.Enabled = $false
  } catch { [Windows.Forms.MessageBox]::Show($form,$_.Exception.Message,'围炉 Hearth error') | Out-Null }
})
$stop.Add_Click({
  try { Invoke-Hidden 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$stopScript`""; $status.Text = 'Status: stopping...'; $stop.Enabled = $false }
  catch { [Windows.Forms.MessageBox]::Show($form,$_.Exception.Message,'围炉 Hearth error') | Out-Null }
})
$open.Add_Click({ Start-Process 'http://localhost:3080' })
$repair.Add_Click({
  try { Invoke-Hidden 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$startScript`" -RepairFirewall -NoBrowser -NoPause"; $status.Text = 'Status: repairing LAN access...' }
  catch { [Windows.Forms.MessageBox]::Show($form,$_.Exception.Message,'围炉 Hearth error') | Out-Null }
})
$details.Add_Click({
  if (Test-Path -LiteralPath $accessPath) { [Windows.Forms.MessageBox]::Show($form,(Get-Content -Raw $accessPath),'围炉 Hearth login details') | Out-Null }
  else { [Windows.Forms.MessageBox]::Show($form,'Start the album once to create the login details.','围炉 Hearth') | Out-Null }
})
$form.Add_FormClosed({ $timer.Stop() })
Update-Status
[void]$form.ShowDialog()
