<#
.SYNOPSIS
    Sirve APRENDO LMS en local para probarlo antes de publicar.

.DESCRIPTION
    Abrir index.html con doble clic (file://) NO funciona: el navegador bloquea las
    llamadas a Supabase por origen nulo y la autenticación falla. Hay que servirlo
    por HTTP. Este script levanta un servidor estático mínimo en localhost.

    No necesita administrador (usa un puerto alto) ni instalar nada.

    Nota tecnica: usa sockets TCP directamente en vez de System.Net.HttpListener.
    HttpListener depende del API HTTP de Windows (http.sys), que exige registrar el
    prefijo de URL y falla en entornos restringidos. Un TcpListener solo abre un
    socket en loopback, que siempre esta permitido.

.EXAMPLE
    pwsh _tools/serve.ps1
    pwsh _tools/serve.ps1 -Puerto 5500
    pwsh _tools/serve.ps1 -AbrirNavegador
#>
[CmdletBinding()]
param(
    [int]$Puerto = 8080,
    [switch]$AbrirNavegador
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Raiz = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$RaizCompleta = [IO.Path]::GetFullPath($Raiz)

$MIME = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'text/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.svg'  = 'image/svg+xml'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.webp' = 'image/webp'
    '.gif'  = 'image/gif'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
    '.pdf'  = 'application/pdf'
    '.txt'  = 'text/plain; charset=utf-8'
    '.md'   = 'text/plain; charset=utf-8'
    '.sql'  = 'text/plain; charset=utf-8'
    '.map'  = 'application/json; charset=utf-8'
    '.docx' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
}

function Write-Respuesta($stream, [int]$codigo, [string]$motivo, [string]$tipo, [byte[]]$cuerpo, [bool]$soloCabeceras) {
    $cabecera = "HTTP/1.1 $codigo $motivo`r`n" +
                "Content-Type: $tipo`r`n" +
                "Content-Length: $($cuerpo.Length)`r`n" +
                "Cache-Control: no-store`r`n" +
                "X-Content-Type-Options: nosniff`r`n" +
                "Connection: close`r`n`r`n"
    $bytesCab = [Text.Encoding]::ASCII.GetBytes($cabecera)
    $stream.Write($bytesCab, 0, $bytesCab.Length)
    if (-not $soloCabeceras -and $cuerpo.Length -gt 0) {
        $stream.Write($cuerpo, 0, $cuerpo.Length)
    }
    $stream.Flush()
}

function Write-Texto($stream, [int]$codigo, [string]$motivo, [string]$texto, [bool]$soloCabeceras) {
    Write-Respuesta $stream $codigo $motivo 'text/plain; charset=utf-8' `
        ([Text.Encoding]::UTF8.GetBytes($texto)) $soloCabeceras
}

# ---------------------------------------------------------------- arranque
Write-Host ''
Write-Host '  APRENDO LMS - servidor local' -ForegroundColor White
Write-Host ('  ' + ('-' * 30)) -ForegroundColor DarkGray
Write-Host "  Carpeta  : $RaizCompleta"
Write-Host "  Direccion: " -NoNewline; Write-Host "http://localhost:$Puerto/" -ForegroundColor Cyan
Write-Host ''
Write-Host '  Paginas:' -ForegroundColor DarkGray
Write-Host "    http://localhost:$Puerto/                          portada" -ForegroundColor DarkGray
Write-Host "    http://localhost:$Puerto/curso.html?slug=mi-curso  pagina del curso" -ForegroundColor DarkGray
Write-Host "    http://localhost:$Puerto/admin.html                panel de administracion" -ForegroundColor DarkGray
Write-Host "    http://localhost:$Puerto/verificar.html            verificar un certificado" -ForegroundColor DarkGray
Write-Host ''

$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Puerto)
try {
    $listener.Start()
} catch {
    Write-Host "  No se pudo abrir el puerto $Puerto." -ForegroundColor Red
    Write-Host "  Detalle: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "  Prueba con otro puerto: pwsh _tools\serve.ps1 -Puerto 5500" -ForegroundColor Yellow
    exit 1
}
Write-Host "  Escuchando. Pulsa Ctrl+C para detenerlo." -ForegroundColor Green
Write-Host ''

if ($AbrirNavegador) { Start-Process "http://localhost:$Puerto/" }

$atendidas = 0
try {
    while ($true) {
        $cliente = $listener.AcceptTcpClient()
        $atendidas++
        $stream = $null
        try {
            $cliente.ReceiveTimeout = 5000
            $cliente.SendTimeout = 15000
            $stream = $cliente.GetStream()

            # Leer la linea de peticion y luego las cabeceras hasta la linea en blanco
            $reader = New-Object System.IO.StreamReader($stream, [Text.Encoding]::ASCII, $false, 2048, $true)
            $linea = $reader.ReadLine()
            if ([string]::IsNullOrWhiteSpace($linea)) { continue }

            $fin = $false
            while (-not $fin) {
                $cab = $reader.ReadLine()
                if ($null -eq $cab -or $cab -eq '') { $fin = $true }
            }

            $partes = $linea -split '\s+'
            if ($partes.Count -lt 2) { Write-Texto $stream 400 'Bad Request' 'Peticion mal formada' $false; continue }

            $metodo = $partes[0].ToUpperInvariant()
            $objetivo = $partes[1]
            $soloCabeceras = ($metodo -eq 'HEAD')

            $ruta = $objetivo
            $interrogante = $ruta.IndexOf('?')
            if ($interrogante -ge 0) { $ruta = $ruta.Substring(0, $interrogante) }
            $almohadilla = $ruta.IndexOf('#')
            if ($almohadilla -ge 0) { $ruta = $ruta.Substring(0, $almohadilla) }
            try { $ruta = [System.Uri]::UnescapeDataString($ruta) } catch { }

            if ($metodo -ne 'GET' -and $metodo -ne 'HEAD') {
                Write-Texto $stream 405 'Method Not Allowed' 'Solo se permiten GET y HEAD' $soloCabeceras
                continue
            }

            if ($ruta -eq '/' -or [string]::IsNullOrWhiteSpace($ruta)) { $ruta = '/index.html' }

            $relativa = $ruta.TrimStart('/').Replace('/', [IO.Path]::DirectorySeparatorChar)
            $completa = [IO.Path]::GetFullPath((Join-Path $RaizCompleta $relativa))

            # Barrera contra salir de la carpeta con ../
            if (-not $completa.StartsWith($RaizCompleta, [StringComparison]::OrdinalIgnoreCase)) {
                Write-Texto $stream 403 'Forbidden' '403 - Fuera de la carpeta del proyecto' $soloCabeceras
                Write-Host ("  {0}  403  {1}" -f (Get-Date -Format 'HH:mm:ss'), $ruta) -ForegroundColor Yellow
                continue
            }
            if (-not (Test-Path -LiteralPath $completa -PathType Leaf)) {
                Write-Texto $stream 404 'Not Found' "404 - No existe: $ruta" $soloCabeceras
                Write-Host ("  {0}  404  {1}" -f (Get-Date -Format 'HH:mm:ss'), $ruta) -ForegroundColor Yellow
                continue
            }

            $ext = [IO.Path]::GetExtension($completa).ToLowerInvariant()
            $tipo = if ($MIME.ContainsKey($ext)) { $MIME[$ext] } else { 'application/octet-stream' }
            $cuerpo = [IO.File]::ReadAllBytes($completa)

            Write-Respuesta $stream 200 'OK' $tipo $cuerpo $soloCabeceras
            Write-Host ("  {0}  200  {1}  ({2} bytes)" -f (Get-Date -Format 'HH:mm:ss'), $ruta, $cuerpo.Length) -ForegroundColor DarkGray
        } catch {
            Write-Host "  Error atendiendo: $($_.Exception.Message)" -ForegroundColor Red
        } finally {
            try { if ($stream) { $stream.Close() } } catch { }
            try { $cliente.Close() } catch { }
        }
    }
} finally {
    try { $listener.Stop() } catch { }
    Write-Host ''
    Write-Host "  Servidor detenido. Peticiones atendidas: $atendidas" -ForegroundColor DarkGray
}
