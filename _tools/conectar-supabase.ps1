<#
.SYNOPSIS
    Conecta APRENDO LMS con la API de gestion de Supabase.

.DESCRIPTION
    Pide un token de acceso personal de Supabase (empieza por sbp_), comprueba que
    sirve, averigua a que proyectos da acceso y lo guarda en .env.

    Con eso puedo aplicar el esquema SQL y verificar el resultado sin tocar el
    archivo de configuracion de los servidores MCP.

    El token NO queda en el historial de PowerShell: se pega en el aviso del script.

    OJO, IMPORTANTE: un token de Supabase da acceso a TODA la cuenta, no a un solo
    proyecto. Por eso el script te ensena exactamente que proyectos ve antes de
    guardar nada: asi confirmas que es la cuenta correcta.

.PARAMETER Token
    Opcional, solo para uso automatico. Si lo pasas, no pregunta.
    Si lo escribes en la linea de comandos queda en el historial de PowerShell.

.PARAMETER SoloComprobar
    No guarda nada; solo dice si el token guardado o el que pases funciona.

.EXAMPLE
    .\_tools\conectar-supabase.cmd
#>
[CmdletBinding()]
param(
    [string]$Token,
    [switch]$SoloComprobar
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

$Root     = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$EnvPath  = Join-Path $Root '.env'
$RefEsperada = 'wkqmgkevttvmbqrpxguk'   # el proyecto de APRENDO LMS

function Ok    { param($t) Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso { param($t) Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Mal   { param($t) Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Info  { param($t) Write-Host "  [i]     $t" -ForegroundColor Gray }

function LeerEnv {
    $map = @{}
    if (-not (Test-Path $EnvPath)) { return $map }
    foreach ($l in (Get-Content -LiteralPath $EnvPath -Encoding UTF8)) {
        if ($l -match '^\s*#' -or $l -notmatch '=') { continue }
        $i = $l.IndexOf('=')
        $map[$l.Substring(0, $i).Trim()] = $l.Substring($i + 1).Trim()
    }
    return $map
}

function GuardarEnEnv([string]$clave, [string]$valor) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $txt = [System.IO.File]::ReadAllText($EnvPath, $enc)
    if ($txt -match "(?m)^$clave=") {
        $txt = [regex]::Replace($txt, "(?m)^$clave=.*$", { param($m) "$clave=$valor" })
    } else {
        $txt = $txt.TrimEnd() + "`r`n$clave=$valor`r`n"
    }
    [System.IO.File]::WriteAllText($EnvPath, $txt, $enc)
}

function Limpiar([string]$t) {
    if ($null -eq $t) { return '' }
    return ($t.Trim() -replace '[\r\n\t ]', '').Trim('"', "'", '`', ',', ';')
}

function Revisar([string]$t) {
    if ([string]::IsNullOrWhiteSpace($t)) { return 'Esta vacio.' }
    if ($t -match '^sbp_') {
        if ($t.Length -lt 30) { return "Parece INCOMPLETO: tiene $($t.Length) caracteres y uno real ronda los 40." }
        return ''
    }
    if ($t -match '^sb_publishable_') { return 'Eso es la clave PUBLICA del proyecto, no un token de acceso. Los tokens empiezan por sbp_.' }
    if ($t -match '^sb_secret_')      { return 'Eso es la clave SECRETA del proyecto, no un token de acceso. Los tokens empiezan por sbp_.' }
    if ($t -match '^eyJ')             { return 'Eso es una clave del proyecto (JWT), no un token de acceso. Los tokens empiezan por sbp_.' }
    if ($t -match '^github_pat_')     { return 'Eso es un token de GitHub, no de Supabase.' }
    return "No empieza por sbp_ (tiene $($t.Length) caracteres)."
}

function PedirToken {
    for ($i = 1; $i -le 4; $i++) {
        Write-Host ''
        Write-Host '  ---------------------------------------------------------' -ForegroundColor DarkGray
        Write-Host '   Pega tu token de Supabase y pulsa Enter.' -ForegroundColor White
        Write-Host '   No se vera mientras lo pegas (es normal).' -ForegroundColor DarkGray
        Write-Host '   Empieza por sbp_ y tiene unos 40 caracteres.' -ForegroundColor DarkGray
        Write-Host '  ---------------------------------------------------------' -ForegroundColor DarkGray
        Write-Host ''
        Write-Host '  Token: ' -NoNewline -ForegroundColor Cyan

        $s = Read-Host -AsSecureString
        $b = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($s)
        try   { $t = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($b) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($b) }

        $t = Limpiar $t
        $p = Revisar $t
        if ([string]::IsNullOrWhiteSpace($p)) { Write-Host ''; Ok "Token recibido ($($t.Length) caracteres)."; return $t }
        Write-Host ''
        Mal $p
        if ($i -lt 4) { Info 'Intentalo otra vez.' }
    }
    Write-Host ''
    Mal 'Se agotaron los intentos.'
    Info 'Genera un token en: https://supabase.com/dashboard/account/tokens'
    exit 1
}

# ---------------------------------------------------------------- comprobar contra Supabase
function ComprobarToken([string]$t) {
    $cab = @{ Authorization = "Bearer $t"; 'User-Agent' = 'aprendo-lms' }
    try {
        $proyectos = Invoke-RestMethod -Uri 'https://api.supabase.com/v1/projects' -Headers $cab -Method Get -TimeoutSec 40
    } catch {
        $code = $null
        try { $code = [int]$_.Exception.Response.StatusCode } catch { }
        if ($code -eq 401) { Mal 'Supabase rechazo el token (401). Esta mal copiado, caducado o revocado.' }
        elseif ($code)     { Mal "Supabase respondio HTTP $code al pedir la lista de proyectos." }
        else               { Mal "No se pudo conectar con Supabase: $($_.Exception.Message)" }
        return $null
    }

    if (-not $proyectos -or $proyectos.Count -eq 0) {
        Mal 'El token es valido pero no ve ningun proyecto. Puede que la cuenta este vacia.'
        return @()
    }

    Write-Host ''
    Info "Esta cuenta tiene $($proyectos.Count) proyecto(s):"
    foreach ($pr in $proyectos) {
        $marca = if ($pr.id -eq $RefEsperada) { '  <-- APRENDO LMS' } else { '' }
        $color = if ($pr.id -eq $RefEsperada) { 'Green' } else { 'DarkGray' }
        Write-Host ("      {0,-24} {1,-22} {2}{3}" -f $pr.id, $pr.name, $pr.region, $marca) -ForegroundColor $color
    }

    $encontrado = @($proyectos | Where-Object { $_.id -eq $RefEsperada }).Count -gt 0
    Write-Host ''
    if ($encontrado) {
        Ok "El token SI da acceso al proyecto de APRENDO LMS ($RefEsperada)."
    } else {
        Mal "El token NO ve el proyecto $RefEsperada."
        Info 'Seguramente iniciaste sesion en OTRA cuenta de Supabase. Entra en la cuenta'
        Info 'que tiene el proyecto APRENDO LMS y genera ahi el token.'
    }
    return $proyectos
}

# ================================================================ MAIN
Write-Host ''
Write-Host '  APRENDO LMS - conectar con Supabase' -ForegroundColor White
Write-Host ('  ' + ('-' * 35)) -ForegroundColor DarkGray
Info "Proyecto objetivo: $RefEsperada"
Write-Host ''

if (-not (Test-Path $EnvPath)) { Mal 'No existe .env.'; exit 1 }

$conf = LeerEnv
$guardado = Limpiar ([string]$conf['SUPABASE_ACCESS_TOKEN'])

$usar = ''
if ($PSBoundParameters.ContainsKey('Token')) {
    # Si el token llega como argumento se valida y se falla: nunca se abre el aviso
    # interactivo, porque en uso automatico se quedaria colgado esperando respuesta.
    $usar = Limpiar $Token
    $p = Revisar $usar
    if (-not [string]::IsNullOrWhiteSpace($p)) { Mal "El token no sirve: $p"; exit 1 }
} elseif (-not [string]::IsNullOrWhiteSpace($guardado) -and [string]::IsNullOrWhiteSpace((Revisar $guardado))) {
    $usar = $guardado
    Ok "Ya hay un token guardado ($($usar.Length) caracteres). Se usara ese."
    Info 'Si quieres cambiarlo, ejecuta:  .\_tools\conectar-supabase.cmd -Token "sbp_..."'
} else {
    $usar = PedirToken
}

Write-Host ''
Info 'Comprobando el token contra Supabase...'
$proyectos = ComprobarToken $usar
if ($null -eq $proyectos) { exit 1 }
if (@($proyectos | Where-Object { $_.id -eq $RefEsperada }).Count -eq 0) { exit 1 }

if ($SoloComprobar) {
    Write-Host ''
    Ok 'Comprobacion terminada. No se guardo nada (-SoloComprobar).'
    exit 0
}

if ($usar -ne $guardado) {
    GuardarEnEnv 'SUPABASE_ACCESS_TOKEN' $usar
    Write-Host ''
    Ok 'Guardado en .env como SUPABASE_ACCESS_TOKEN (Git ignora ese archivo).'
} else {
    Info 'El token no cambio; no hubo que reescribir .env.'
}

Write-Host ''
Write-Host '  Listo. Ya puedo aplicar el esquema SQL y verificar el resultado.' -ForegroundColor Green
Write-Host ''
exit 0
