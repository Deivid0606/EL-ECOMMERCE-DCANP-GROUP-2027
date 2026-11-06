#requires -Version 5.1
# DCANP Sucursal: setup LOCAL MediaMTX on the Windows PC already connected to iCSee.
# This script does NOT open router ports and does NOT upload camera credentials.
# Execute in PowerShell as the Windows user who should run MediaMTX.
$ErrorActionPreference = 'Stop'
$workdir = Join-Path $env:LOCALAPPDATA 'DCANP-Sucursal'
New-Item -ItemType Directory -Force -Path $workdir | Out-Null
Write-Host 'DCANP Sucursal - instalacion del servidor local RTSP/HLS' -ForegroundColor Cyan
Write-Host 'La contrasena de la camara queda SOLO en este equipo.'
Write-Host 'Nunca compartas la URL RTSP completa con otra persona.'
$streamId = (Read-Host 'Pega el ID de canal UUID que copiaste desde Sucursal').Trim()
if ($streamId -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$') { throw 'ID de canal invalido' }
$localRtsp = (Read-Host 'Pega la URL RTSP que ya probaste en VLC (solo aqui en tu PC)').Trim()
if ($localRtsp -notmatch '^rtsp://') { throw 'Se necesita una URL rtsp:// valida.' }
try {
  $u = [uri]$localRtsp
  $ipAddress = $null
  if (-not [System.Net.IPAddress]::TryParse($u.Host, [ref]$ipAddress) -or $u.Host -notmatch '^(10\.|192\.168\.|172\.)') {
    throw 'Usa solo la IP LOCAL de la camara.'
  }
  if ($u.Host -match '^172\.') {
    $second = [int]($u.Host.Split('.')[1]); if ($second -lt 16 -or $second -gt 31) { throw 'La IP no es privada.' }
  }
} catch { throw 'URL RTSP local invalida.' }
$version = '1.21.3'
$fileName = "mediamtx_v${version}_windows_amd64.zip"
$download = "https://github.com/bluenviron/mediamtx/releases/download/v${version}/$fileName"
$zipPath = Join-Path $workdir $fileName
$sha256 = 'b2f5246b07cb72961df03b8d5e8cad43dc657bcf3f49a87bb031bdf22721af74'
Write-Host 'Descargando MediaMTX desde el repositorio oficial...'
if (-not (Test-Path $zipPath)) { Invoke-WebRequest -Uri $download -OutFile $zipPath -UseBasicParsing }
$actual = (Get-FileHash -Algorithm SHA256 $zipPath).Hash.ToLower()
if ($actual -ne $sha256) { throw 'Checksum SHA256 diferente. Instalacion cancelada; elimina el ZIP y vuelve a descargar.' }
$bin = Join-Path $workdir 'bin'
New-Item -ItemType Directory -Force -Path $bin | Out-Null
Expand-Archive -Path $zipPath -DestinationPath $bin -Force
# JSON-quoted YAML scalar handles &, ?, spaces and quote escapes safely.
$quotedSource = ConvertTo-Json -Compress -InputObject $localRtsp
$quotedStream = ConvertTo-Json -Compress -InputObject $streamId.ToLower()
$yaml = @"
logLevel: warn
rtsp: false
rtmp: false
srt: false
webrtc: false
hls: true
hlsAddress: 127.0.0.1:8888
hlsAllowOrigins:
  - "https://www.el-ecommercedcanpgroup.com"
  - "https://el-ecommercedcanpgroup.com"
  - "https://ecommerce20.vercel.app"
  - "https://mitienda.el-ecommercedcanpgroup.com"
hlsVariant: mpegts
authMethod: http
authHTTPAddress: https://mnpbwoknqwsjtiyrrxbm.supabase.co/functions/v1/branch-camera-auth
paths:
  ${quotedStream}:
    source: ${quotedSource}
    sourceOnDemand: true
"@
$config = Join-Path $workdir 'mediamtx.yml'
# PowerShell 5.1 UTF8 writes a BOM; MediaMTX YAML rejects it as an unknown key.
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($config,$yaml,$utf8NoBom)
# Restrict filesystem access to current user and SYSTEM; RTSP source can contain passwords.
& icacls $config /inheritance:r /grant:r "${env:USERNAME}:(R,W)" 'SYSTEM:(F)' | Out-Null
$runner = Join-Path $workdir 'start-mediamtx.ps1'
$runnerBody = @'
$ErrorActionPreference = 'Stop'
$folder = Join-Path $env:LOCALAPPDATA 'DCANP-Sucursal'
Set-Location $folder
& (Join-Path $folder 'bin\mediamtx.exe') (Join-Path $folder 'mediamtx.yml')
'@
[System.IO.File]::WriteAllText($runner,$runnerBody,[System.Text.Encoding]::UTF8)
Write-Host 'Configuracion instalada.' -ForegroundColor Green
Write-Host 'El servidor local escuchara solamente en 127.0.0.1:8888.'
Write-Host 'Se abrira una consola del servidor. No la cierres durante la prueba.'
Write-Host 'Para acceso remoto se debe configurar Cloudflare Tunnel HTTPS por separado, hacia http://127.0.0.1:8888'
Write-Host 'No publiques RTSP 554, MediaMTX 8888 ni 34567 directamente.'
Start-Process powershell.exe -ArgumentList @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"'+$runner+'"')) -WorkingDirectory $workdir
