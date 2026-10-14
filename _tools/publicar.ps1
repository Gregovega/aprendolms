<#
.SYNOPSIS
    Publica APRENDO LMS en GitHub. Pide el token si hace falta y hace todo lo demas.

.DESCRIPTION
    Un solo comando. Si ya hay un token valido guardado, no pregunta nada y publica.
    Si no lo hay, lo pide de forma OCULTA (no se ve al pegarlo) y luego:

      1. Limpia lo que pegues (comillas, espacios, saltos de linea sobrantes).
      2. Comprueba que tiene pinta de token real y no del texto de ejemplo.
      3. Lo guarda en .env (que Git ignora).
      4. Delega en push.ps1, que valida contra GitHub y sube los commits.

    El token NO queda en el historial de PowerShell, porque no se escribe en la
    linea de comandos: se pega en el aviso del propio script.

.PARAMETER Token
    Opcional. Solo para uso automatico. Si lo pasas, no pregunta nada.
    OJO: si lo escribes en la linea de comandos, queda en el historial de
    PowerShell. Para el uso normal, no lo pases y deja que lo pida.

.PARAMETER CambiarToken
    Fuerza a pedir el token otra vez aunque ya hubiera uno guardado.

.EXAMPLE
    .\_tools\publicar.cmd
#>
[CmdletBinding()]
param(
    [string]$Token,
    [switch]$CambiarToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$Root    = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$EnvPath = Join-Path $Root '.env'

function Linea { param($t, $color) Write-Host $t -ForegroundColor $color }
function Ok     { param($t) Write-Host "  [OK]    $t" -ForegroundColor Green }
function Aviso  { param($t) Write-Host "  [AVISO] $t" -ForegroundColor Yellow }
function Mal    { param($t) Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Info   { param($t) Write-Host "  [i]     $t" -ForegroundColor Gray }

# ---------------------------------------------------------------- .env
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

function GuardarToken([string]$t) {
    $enc = New-Object System.Text.UTF8Encoding($false)
    $txt = [System.IO.File]::ReadAllText($EnvPath, $enc)
    if ($txt -match '(?m)^GITHUB_TOKEN=') {
        # Evaluador en lugar de cadena de reemplazo: asi el token se escribe LITERAL,
        # sin que un $ o una barra invertida puedan interpretarse como comodin.
        $txt = [regex]::Replace($txt, '(?m)^GITHUB_TOKEN=.*$', { param($m) 'GITHUB_TOKEN=' + $t })
    } else {
        $txt = $txt.TrimEnd() + "`r`nGITHUB_TOKEN=$t`r`n"
    }
    [System.IO.File]::WriteAllText($EnvPath, $txt, $enc)
}

# ---------------------------------------------------------------- validacion
function LimpiarToken([string]$t) {
    if ($null -eq $t) { return '' }
    # Quitar espacios, saltos de linea y comillas que se cuelan al copiar y pegar
    $t = $t.Trim()
    $t = $t -replace '[\r\n\t ]', ''
    $t = $t.Trim('"', "'", '`', ',', ';')
    return $t
}

function RevisarToken([string]$t) {
    if ([string]::IsNullOrWhiteSpace($t)) { return 'Esta vacio.' }
    if ($t -match '\.\.\.$' -or $t -in @('TU_TOKEN', 'TOKEN', 'PEGA-AQUI-EL-TOKEN')) {
        return 'Ese es el TEXTO DE EJEMPLO de la guia, no tu token. Copia el valor completo que te dio GitHub.'
    }
    if ($t -match '^github_pat_') {
        if ($t.Length -lt 40) { return "Parece INCOMPLETO: solo tiene $($t.Length) caracteres y uno real ronda los 90." }
        return ''
    }
    if ($t -match '^ghp_') {
        if ($t.Length -lt 40) { return "Parece INCOMPLETO: solo tiene $($t.Length) caracteres y uno clasico mide 40." }
        return ''
    }
    if ($t -match '^gho_') { return 'Es un token OAuth (gho_). Necesitas un PAT que empiece por github_pat_.' }
    return "No empieza por github_pat_ ni ghp_ (tiene $($t.Length) caracteres). Revisa que copiaste el token y no otra cosa."
}

# ---------------------------------------------------------------- pedir el token
function PedirToken {
    for ($intento = 1; $intento -le 4; $intento++) {
        Write-Host ''
        Linea '  ---------------------------------------------------------' DarkGray
        Linea '   Pega tu token de GitHub y pulsa Enter.' White
        Linea '   No se vera mientras lo pegas (es normal).' DarkGray
        Linea '   Empieza por github_pat_ y tiene unos 90 caracteres.' DarkGray
        Linea '  ---------------------------------------------------------' DarkGray
        Write-Host ''
        Write-Host '  Token: ' -NoNewline -ForegroundColor Cyan

        $seguro = Read-Host -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($seguro)
        try   { $t = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }

        $t = LimpiarToken $t
        $problema = RevisarToken $t

        if ([string]::IsNullOrWhiteSpace($problema)) {
            Write-Host ''
            Ok "Token recibido y con buen formato ($($t.Length) caracteres)."
            return $t
        }

        Write-Host ''
        Mal $problema
        if ($intento -lt 4) { Info 'Intentalo otra vez.' }
    }
    Write-Host ''
    Mal 'Se agotaron los intentos. No se guardo nada.'
    Info 'Genera un token nuevo en: https://github.com/settings/personal-access-tokens/new'
    Info 'Permisos: Contents = Read and write, y solo el repositorio Gregovega/aprendolms.'
    exit 1
}

# ================================================================ MAIN
Write-Host ''
Linea '  APRENDO LMS - publicar en GitHub' White
Linea ('  ' + ('-' * 33)) DarkGray
Info "Carpeta: $Root"
Write-Host ''

if (-not (Test-Path $EnvPath)) {
    Mal 'No existe el archivo .env.'
    Info 'Ejecuta primero:  .\_tools\set-credentials.cmd -SupabaseUrl "..." -SupabaseAnonKey "..."'
    exit 1
}

$conf = LeerEnv
$guardado = LimpiarToken ([string]$conf['GITHUB_TOKEN'])

$usar = ''
if (-not [string]::IsNullOrWhiteSpace($Token)) {
    $usar = LimpiarToken $Token
    Info 'Token recibido como argumento.'
} elseif (-not $CambiarToken -and -not [string]::IsNullOrWhiteSpace($guardado) -and
          [string]::IsNullOrWhiteSpace((RevisarToken $guardado))) {
    $usar = $guardado
    Ok "Ya hay un token guardado y valido ($($usar.Length) caracteres). No hace falta que lo pegues otra vez."
} else {
    if (-not [string]::IsNullOrWhiteSpace($guardado)) {
        $p = RevisarToken $guardado
        Aviso "El token guardado no sirve: $p"
    }
    $usar = PedirToken
}

# ---------------------------------------------------------------- validar SIEMPRE
# Venga el token del argumento o del aviso, no se guarda sin comprobarlo antes.
# (Sin esto, pasar un token al script lo guardaba sin revisar.)
$problemaFinal = RevisarToken $usar
if (-not [string]::IsNullOrWhiteSpace($problemaFinal)) {
    Write-Host ''
    Mal "El token no sirve: $problemaFinal"
    Info 'No se guardo nada. Revisa el token y vuelve a intentarlo.'
    exit 1
}

# ---------------------------------------------------------------- guardar
$eraIgual = ($usar -eq $guardado)
if (-not $eraIgual) {
    GuardarToken $usar
    Ok '.env actualizado (Git ignora ese archivo).'
} else {
    Info 'El token no cambio; no hubo que reescribir .env.'
}

# ---------------------------------------------------------------- publicar
$push = Join-Path $PSScriptRoot 'push.ps1'
if (-not (Test-Path $push)) { Mal "No encuentro push.ps1 en $PSScriptRoot"; exit 1 }

Write-Host ''
Linea '  Publicando...' White
& $push
exit $LASTEXITCODE
