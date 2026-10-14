<#
.SYNOPSIS
    Publica APRENDO LMS en su repositorio de GitHub.

.DESCRIPTION
    Lee el token de .env (nunca se escribe en .git/config ni en la URL del remoto),
    comprueba que el token puede escribir en TU repositorio y hace el push.

    Solo toca el repositorio indicado en GITHUB_REPO. No hace fetch, ni merge,
    ni force-push: si algo no puede avanzar de forma limpia, se detiene y avisa.

.EXAMPLE
    pwsh _tools/push.ps1
    pwsh _tools/push.ps1 -Mensaje "Anadir la pagina del curso"
#>
[CmdletBinding()]
param(
    [string]$Mensaje,
    [switch]$SinCommit,

    # Este parametro NO se usa: existe solo para atrapar el error mas facil de
    # cometer. Es natural pensar que el token se pasa al script que publica, y no:
    # el token va en publicar.cmd / set-credentials.cmd. Sin declararlo aqui,
    # PowerShell responde "A parameter cannot be found that matches parameter name
    # 'GithubToken'" en rojo, que no explica nada. Declarado, podemos dar una
    # instruccion util.
    [string]$GithubToken
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch { }

if ($PSBoundParameters.ContainsKey('GithubToken')) {
    Write-Host ''
    Write-Host '  [AVISO] El token no se pasa a este script.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host '  Usa este comando, que te lo pide y hace todo lo demas:' -ForegroundColor White
    Write-Host ''
    Write-Host '      .\_tools\publicar.cmd' -ForegroundColor Cyan
    Write-Host ''
    Write-Host '  (El token no queda en el historial de PowerShell si lo pegas ahi.)' -ForegroundColor DarkGray
    Write-Host ''
    exit 1
}

$Root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$EnvPath = Join-Path $Root '.env'

function Write-Head($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ('  ' + ('-' * $t.Length)) -ForegroundColor DarkGray }
function Write-Ok($t)   { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Write-Bad($t)  { Write-Host "  [ERROR] $t" -ForegroundColor Red }
function Write-Info($t) { Write-Host "  [i]     $t" -ForegroundColor Gray }

# ---------------------------------------------------------------- leer .env
if (-not (Test-Path $EnvPath)) { Write-Bad "No existe .env. Ejecuta primero: _tools\set-credentials.cmd -GithubToken \"...\""; exit 1 }
$conf = @{}
foreach ($line in (Get-Content -LiteralPath $EnvPath -Encoding UTF8)) {
    if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
    $i = $line.IndexOf('=')
    $conf[$line.Substring(0,$i).Trim()] = $line.Substring($i+1).Trim()
}

$token  = [string]$conf['GITHUB_TOKEN']
$repo   = [string]$conf['GITHUB_REPO']
$branch = if ($conf['GITHUB_BRANCH']) { [string]$conf['GITHUB_BRANCH'] } else { 'main' }
$user   = if ($conf['GITHUB_USER'])   { [string]$conf['GITHUB_USER'] }   else { ($repo -split '/')[0] }

if ([string]::IsNullOrWhiteSpace($token)) { Write-Bad 'Falta GITHUB_TOKEN en .env.'; exit 1 }
if ($repo -notmatch '^[\w.-]+/[\w.-]+$')  { Write-Bad "GITHUB_REPO invalido: '$repo'. Se espera usuario/repositorio."; exit 1 }

# Detectar el texto de ejemplo o un token cortado ANTES de gastar una peticion a GitHub,
# para dar un mensaje util en lugar de un 401 que no explica nada.
if ($token -match '\.\.\.$' -or $token -in @('TU_TOKEN','TOKEN','PEGA-AQUI-EL-TOKEN')) {
    Write-Bad "El GITHUB_TOKEN guardado es el TEXTO DE EJEMPLO ('$token'), no tu token real."
    Write-Info 'Arreglalo asi, en una terminal nueva:'
    Write-Info '  .\_tools\set-credentials.cmd -GithubToken "github_pat_EL_TOKEN_COMPLETO"'
    Write-Info '  .\_tools\push.cmd'
    exit 1
}
if ((($token -match '^github_pat_') -or ($token -match '^ghp_')) -and $token.Length -lt 40) {
    Write-Bad "El GITHUB_TOKEN guardado parece INCOMPLETO: tiene $($token.Length) caracteres y uno real ronda los 90."
    Write-Info 'Vuelve a copiarlo entero desde GitHub y guardalo otra vez con set-credentials.cmd.'
    exit 1
}

Write-Host ''
Write-Host '  APRENDO LMS — publicar en GitHub' -ForegroundColor White
Write-Info "Repositorio : $repo"
Write-Info "Rama        : $branch"
Write-Info "Usuario     : $user"
Write-Info "Token       : $($token.Substring(0, [Math]::Min(11,$token.Length)))... (oculto)"

# ---------------------------------------------------------------- localizar git
function Get-GitExe {
    $c = Get-Command git -ErrorAction SilentlyContinue
    if ($c) { return $c.Source }
    $alt = Join-Path $env:USERPROFILE 'git-portable\cmd\git.exe'
    if (Test-Path $alt) { return $alt }
    return $null
}
$git = Get-GitExe
if (-not $git) {
    Write-Bad 'No encuentro git. Abre una terminal NUEVA (para que tome el PATH) o reinstala con _tools\set-credentials.cmd.'
    exit 1
}
Write-Ok "git: $(& $git --version)"

# ---------------------------------------------------------------- 1. validar el token
Write-Head 'Paso 1 - Comprobar el token contra GitHub'
$authHeaders = @{
    Authorization          = "Bearer $token"
    'User-Agent'           = 'aprendo-lms'
    Accept                 = 'application/vnd.github+json'
}
try {
    $me = Invoke-RestMethod -Uri 'https://api.github.com/user' -Headers $authHeaders -TimeoutSec 30
    Write-Ok "El token es valido. Cuenta: $($me.login)"
} catch {
    $code = $null; try { $code = [int]$_.Exception.Response.StatusCode } catch { }
    if ($code -eq 401) { Write-Bad 'GitHub rechazo el token (401). Esta mal copiado, caducado o revocado.' }
    else { Write-Bad "No se pudo validar el token: $($_.Exception.Message)" }
    exit 1
}

try {
    $repoInfo = Invoke-RestMethod -Uri "https://api.github.com/repos/$repo" -Headers $authHeaders -TimeoutSec 30
    Write-Ok "El repositorio existe y el token lo ve: $($repoInfo.full_name) ($($repoInfo.visibility))"
    $perms = $repoInfo.permissions
    if ($perms -and $perms.PSObject.Properties['push'] -and $perms.push) { Write-Ok 'El token tiene permiso de escritura (push).' }
    elseif ($perms) { Write-Bad 'El token NO tiene permiso de escritura. Revisa que Contents este en Read and write.'; exit 1 }
} catch {
    Write-Bad "No se pudo leer el repositorio $repo. Revisa que el token incluya ESTE repositorio en Repository access."
    exit 1
}

# ---------------------------------------------------------------- 2. commit local
Write-Head 'Paso 2 - Preparar el commit local'
& $git -C $Root add -A
$pending = & $git -C $Root status --porcelain
if ($pending) {
    if (-not $Mensaje) { $Mensaje = "Actualizar proyecto ($(Get-Date -Format 'yyyy-MM-dd HH:mm'))" }
    & $git -C $Root -c user.name="$user" -c user.email="$user@users.noreply.github.com" commit -q -m $Mensaje
    Write-Ok "Commit creado: $Mensaje"
    $pending | ForEach-Object { Write-Info "  $_" }
} else {
    Write-Info 'No hay cambios que commitear.'
}

# Verificacion de seguridad antes de publicar
$tracked = & $git -C $Root ls-files
if ($tracked -contains '.env') { Write-Bad 'ABORTADO: .env esta rastreado por git. Tus secretos se publicarian. Revisa .gitignore.'; exit 1 }
Write-Ok '.env no esta rastreado (seguro para publicar).'

# ---------------------------------------------------------------- 3. push
Write-Head 'Paso 3 - Subir a GitHub'
$b64 = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("${user}:${token}"))

& $git -C $Root remote remove origin 2>$null | Out-Null
& $git -C $Root remote add origin "https://github.com/$repo.git"
Write-Info "origin = https://github.com/$repo.git  (sin token incrustado)"

# Traer por si el remoto avanzo, y avisar si hay que reconciliar
& $git -C $Root fetch origin $branch 2>&1 | Out-Null
$local  = & $git -C $Root rev-parse HEAD
$remote = & $git -C $Root rev-parse "origin/$branch" 2>$null
if ($remote) {
    & $git -C $Root merge-base --is-ancestor $remote $local
    if ($LASTEXITCODE -ne 0) {
        Write-Bad 'El remoto tiene cambios que tu copia local no tiene. NO hago force-push para no borrar nada.'
        Write-Info "Solucion: ejecuta  git pull --rebase origin $branch  y vuelve a lanzar este script."
        exit 1
    }
    Write-Ok 'Tu copia local incluye todo el historial remoto (avance limpio).'
}

# El token va en una cabecera temporal: NO se guarda en .git/config
& $git -C $Root -c "http.extraheader=AUTHORIZATION: basic $b64" push -u origin $branch 2>&1 | ForEach-Object { Write-Info "  $_" }

if ($LASTEXITCODE -ne 0) { Write-Bad "El push fallo (codigo $LASTEXITCODE)."; exit 1 }

Write-Head 'Listo'
Write-Ok "Publicado en https://github.com/$repo"
Write-Info "Commits subidos: $(& $git -C $Root rev-list --count origin/$branch 2>$null)"
Write-Info "Sitio (cuando haya index.html): https://$user.github.io/$(($repo -split '/')[1])/"
Write-Host ''
exit 0
