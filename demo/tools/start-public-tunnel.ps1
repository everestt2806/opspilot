param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('EXPRESS', 'NEXT', 'VITE')]
  [string]$Name,

  [Parameter(Mandatory = $true)]
  [ValidateRange(33000, 34999)]
  [int]$LocalPort
)

$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path -Parent $PSScriptRoot
$cloudflared = Join-Path $PSScriptRoot 'cloudflared.exe'
$logRoot = Join-Path $demoRoot 'public-tunnel-logs'
$origin = "http://127.0.0.1:$LocalPort"
$healthUrl = if ($Name -eq 'EXPRESS') { "$origin/health" } else { "$origin/" }

if (-not (Test-Path -LiteralPath $cloudflared)) {
  throw "Khong tim thay $cloudflared"
}

try {
  $probe = Invoke-WebRequest -Uri $healthUrl -UseBasicParsing -TimeoutSec 5
  if ($probe.StatusCode -lt 200 -or $probe.StatusCode -ge 400) {
    throw "HTTP $($probe.StatusCode)"
  }
} catch {
  throw "App $Name chua truy cap duoc tai local tunnel $origin. Hay chay 03-MO-DUONG-DU-PHONG.cmd truoc."
}

New-Item -ItemType Directory -Force -Path $logRoot | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$stdoutPath = Join-Path $logRoot "$Name-$stamp.stdout.log"
$stderrPath = Join-Path $logRoot "$Name-$stamp.stderr.log"
$pidPath = Join-Path $logRoot "$Name.pid"
$urlPath = Join-Path $demoRoot "PUBLIC-$Name-URL.txt"

$process = Start-Process -FilePath $cloudflared `
  -ArgumentList @('tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', $origin) `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

Set-Content -LiteralPath $pidPath -Value $process.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(45)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  $text = ''
  if (Test-Path $stdoutPath) { $text += Get-Content -LiteralPath $stdoutPath -Raw }
  if (Test-Path $stderrPath) { $text += Get-Content -LiteralPath $stderrPath -Raw }
  $match = [regex]::Match($text, 'https://[a-z0-9-]+\.trycloudflare\.com')
  if ($match.Success) {
    $url = $match.Value
    Set-Content -LiteralPath $urlPath -Value $url -Encoding ascii
    Set-Clipboard -Value $url
    Write-Host ""
    Write-Host "PUBLIC $Name URL: $url" -ForegroundColor Green
    Write-Host "Da copy URL vao clipboard. Giu cloudflared dang chay trong nen."
    exit 0
  }
  if ($process.HasExited) {
    throw "cloudflared dung som. Xem log: $stderrPath"
  }
}

throw "Qua 45 giay chua nhan duoc URL. Xem log: $stderrPath"
