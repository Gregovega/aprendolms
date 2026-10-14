<#
.SYNOPSIS
    Activa las credenciales de APRENDO LMS y verifica la conexión con Supabase.

.DESCRIPTION
    Guarda las credenciales en .env (privado, ignorado por Git) y genera
    assets/js/config.js (público, para el frontend estático).

    Hace tres cosas que te ahorran dolores de cabeza:
      1. Valida el FORMATO de cada credencial antes de guardarla.
      2. Detecta si pegaste la service_role key por error: esa clave da
         acceso total a la base de datos y NUNCA debe ir en el frontend.
      3. Prueba de verdad contra Supabase que la URL y la anon key responden.

.PARAMETER SupabaseUrl
    Project URL, con forma https://xxxxxxxxxxxxxxxxxxxx.supabase.co

.PARAMETER SupabaseAnonKey
    anon key (JWT que empieza por eyJ...) o publishable key (sb_publishable_...)

.EXAMPLE
    pwsh _tools/set-credentials.ps1 `
      -SupabaseUrl 'https://abcdefghijklmnopqrst.supabase.co' `
      -SupabaseAnonKey 'eyJhbGciOi...' `
      -AcademyName 'Mi Academia'

.EXAMPLE
    # Solo comprobar lo que ya está guardado en .env
    pwsh _tools/set-credentials.ps1 -TestOnly

.EXAMPLE
    # Ver el estado enmascarado (sin exponer secretos)
    pwsh _tools/set-credentials.ps1 -Show
#>
[CmdletBinding()]
param(
    [string]$SupabaseUrl,
    [string]$SupabaseAnonKey,
    [string]$SupabaseServiceRoleKey,
    [string]$WistiaApiToken,
    [string]$WistiaProjectId,
    [string]$GithubRepo,
    [string]$GithubToken,
    [string]$GithubUser,
    [string]$GithubBranch,
    [string]$CloudflareApiToken,
    [string]$CloudflareZoneId,
    [string]$CloudflareAccountId,
    [string]$AcademyName,
    [string]$RootDomain,

    [switch]$TestOnly,
    [switch]$Show,
    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------- rutas
$Root = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
$EnvPath    = Join-Path $Root '.env'
$EnvExample = Join-Path $Root '.env.example'
$ConfigDir  = Join-Path $Root 'assets\js'
$ConfigPath = Join-Path $ConfigDir 'config.js'

$script:Warnings = New-Object System.Collections.Generic.List[string]
$script:Errors   = New-Object System.Collections.Generic.List[string]

# ---------------------------------------------------------------- salida
function Write-Head($t) { Write-Host ''; Write-Host "  $t" -ForegroundColor Cyan; Write-Host ('  ' + ('-' * $t.Length)) -ForegroundColor DarkGray }
function Write-Ok($t)   { Write-Host "  [OK]    $t" -ForegroundColor Green }
function Write-Warn($t) { Write-Host "  [AVISO] $t" -ForegroundColor Yellow; $script:Warnings.Add($t) }
function Write-Bad($t)  { Write-Host "  [ERROR] $t" -ForegroundColor Red;    $script:Errors.Add($t) }
function Write-Info($t) { Write-Host "  [i]     $t" -ForegroundColor Gray }

function Get-Masked([string]$v) {
    if ([string]::IsNullOrWhiteSpace($v)) { return '<vacío>' }
    if ($v.Length -le 12) { return ('*' * $v.Length) }
    return ($v.Substring(0, 8) + '...' + $v.Substring($v.Length - 4) + "  (len=$($v.Length))")
}

# ---------------------------------------------------------------- .env IO
function Read-DotEnv([string]$path) {
    $map = @{}
    if (-not (Test-Path $path)) { return $map }
    foreach ($line in (Get-Content -LiteralPath $path -Encoding UTF8)) {
        if ($line -match '^\s*#' -or $line -notmatch '=') { continue }
        $i = $line.IndexOf('=')
        $k = $line.Substring(0, $i).Trim()
        $v = $line.Substring($i + 1).Trim()
        if ($k) { $map[$k] = $v }
    }
    return $map
}

function Write-DotEnv([hashtable]$map, [string]$path) {
    $order = @(
        'SUPABASE_URL','SUPABASE_ANON_KEY','SUPABASE_SERVICE_ROLE_KEY',
        'WISTIA_API_TOKEN','WISTIA_PROJECT_ID',
        'GITHUB_REPO','GITHUB_TOKEN','GITHUB_USER','GITHUB_BRANCH',
        'CLOUDFLARE_API_TOKEN','CLOUDFLARE_ZONE_ID','CLOUDFLARE_ACCOUNT_ID',
        'ACADEMY_NAME','ROOT_DOMAIN'
    )
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.AppendLine('# ============================================================')
    [void]$sb.AppendLine('#  APRENDO LMS — generado por _tools/set-credentials.ps1')
    [void]$sb.AppendLine("#  Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
    [void]$sb.AppendLine('#  ARCHIVO PRIVADO — no se sube a GitHub (ver .gitignore)')
    [void]$sb.AppendLine('# ============================================================')
    [void]$sb.AppendLine('')
    foreach ($k in $order) {
        $v = if ($map.ContainsKey($k)) { [string]$map[$k] } else { '' }
        [void]$sb.AppendLine("$k=$v")
    }
    # claves extra que no estén en el orden canónico
    foreach ($k in ($map.Keys | Sort-Object)) {
        if ($order -notcontains $k) { [void]$sb.AppendLine("$k=$($map[$k])") }
    }
    # UTF-8 sin BOM
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($path, $sb.ToString(), $enc)
}

# ---------------------------------------------------------------- validación
function Test-SupabaseUrl([string]$u) {
    return ($u -match '^https://[a-z0-9]{16,}\.supabase\.(co|in)$')
}

function Get-JwtPayload([string]$jwt) {
    if ($jwt -notmatch '^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$') { return $null }
    try {
        $p = $jwt.Split('.')[1].Replace('-', '+').Replace('_', '/')
        switch ($p.Length % 4) { 2 { $p += '==' } 3 { $p += '=' } }
        $json = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($p))
        return ($json | ConvertFrom-Json)
    } catch { return $null }
}

function Assert-SupabaseAnonKey([string]$key) {
    # publishable moderna
    if ($key -match '^sb_publishable_[A-Za-z0-9_-]{10,}$') {
        Write-Ok 'anon key con formato publishable (sb_publishable_...)'
        return $true
    }
    $pl = Get-JwtPayload $key
    if (-not $pl) {
        Write-Bad 'SUPABASE_ANON_KEY no parece ni un JWT (eyJ...) ni una publishable key (sb_publishable_...). Revisa que copiaste la clave completa.'
        return $false
    }
    $role = [string]$pl.role
    if ($role -eq 'service_role') {
        Write-Bad 'ALTO: pegaste la clave service_role en el campo de la anon key. Esa clave SALTA todas las reglas de seguridad (RLS) y da control total de la base de datos. Si se publica en GitHub Pages, cualquiera puede leer y borrar todo. Usa la clave "anon" / "publishable".'
        return $false
    }
    if ($role -eq 'anon') {
        Write-Ok "anon key válida (role=anon, proyecto ref=$([string]$pl.ref))"
        return $true
    }
    Write-Warn "La clave es un JWT con role='$role'. Lo esperado es 'anon'. Verifica en Supabase > Settings > API Keys."
    return $true
}

function Assert-SupabaseServiceRole([string]$key) {
    if ([string]::IsNullOrWhiteSpace($key)) { return $true }
    if ($key -match '^sb_secret_') { Write-Ok 'service_role key (formato secreto moderno) guardada solo en .env'; return $true }
    $pl = Get-JwtPayload $key
    if ($pl -and [string]$pl.role -eq 'service_role') {
        Write-Ok 'service_role key guardada SOLO en .env (nunca en el frontend)'
        return $true
    }
    Write-Warn 'La SUPABASE_SERVICE_ROLE_KEY no parece una service_role válida. Se guarda igual, solo en .env.'
    return $true
}

# ---------------------------------------------------------------- prueba de red
function Test-SupabaseConnection([string]$url, [string]$anonKey) {
    Write-Head 'Prueba de conexión real con Supabase'
    if (-not (Test-SupabaseUrl $url)) { Write-Bad "URL inválida: $url"; return $false }
    if ([string]::IsNullOrWhiteSpace($anonKey)) { Write-Bad 'Falta la anon key para probar.'; return $false }

    $headers = @{ apikey = $anonKey; Authorization = "Bearer $anonKey" }
    $keyValidated   = $false
    $networkTrouble = $false

    # 1) LA PRUEBA DEFINITIVA.
    #    /auth/v1/health EXIGE la apikey. Por eso un HTTP 200 demuestra dos cosas a la vez:
    #    que el dominio existe y que la clave pertenece a ESTE proyecto.
    try {
        $health = Invoke-RestMethod -Uri "$url/auth/v1/health" -Headers $headers -Method Get -TimeoutSec 25
        $hName = if ($health.PSObject.Properties['name'])    { [string]$health.name }    else { 'desconocido' }
        $hVer  = if ($health.PSObject.Properties['version']) { [string]$health.version } else { '' }
        Write-Ok "Proyecto vivo y clave ACEPTADA. Servicio de auth: $hName $hVer"
        $keyValidated = $true
    } catch {
        $code = $null; $body = ''
        try { $code = [int]$_.Exception.Response.StatusCode } catch { }
        try {
            $stream = $_.Exception.Response.GetResponseStream()
            if ($stream) { $body = (New-Object System.IO.StreamReader($stream)).ReadToEnd() }
        } catch { }

        if ($code -eq 401) {
            Write-Bad "Supabase RECHAZÓ la anon key (HTTP 401). La clave no pertenece a este proyecto o quedó incompleta al copiarla. Respuesta del servidor: $body"
        } elseif ($code) {
            Write-Warn "El dominio existe pero /auth/v1/health devolvió HTTP $code. Si el proyecto acaba de crearse, espera ~2 minutos y reintenta."
        } else {
            Write-Bad "No hubo respuesta de red. OJO: las credenciales pueden estar perfectas y el fallo ser de conexión. Detalle: $($_.Exception.Message)"
            $networkTrouble = $true
        }
    }

    # 2) PostgREST. /rest/v1/ (el listado de esquema OpenAPI) exige una clave SECRETA en el
    #    Supabase moderno: con una clave publishable/anon devuelve 401 "Secret API key required".
    #    Eso NO es un fallo de credenciales, así que aquí nunca se marca error.
    if ($keyValidated) {
        try {
            $spec = Invoke-RestMethod -Uri "$url/rest/v1/" -Headers $headers -Method Get -TimeoutSec 25
            $tables = @()
            if ($spec.PSObject.Properties['definitions']) { $tables = @($spec.definitions.PSObject.Properties.Name) }
            if ($tables.Count -gt 0) {
                Write-Ok "PostgREST operativo. Tablas en el esquema public: $($tables.Count)"
                Write-Info ("Tablas: " + (($tables | Select-Object -First 12) -join ', ') + $(if ($tables.Count -gt 12) { ' ...' }))
            } else {
                Write-Ok 'PostgREST operativo. El esquema public está vacío (proyecto nuevo, perfecto para empezar).'
            }
        } catch {
            $code = $null; $body = ''
            try { $code = [int]$_.Exception.Response.StatusCode } catch { }
            try {
                $stream = $_.Exception.Response.GetResponseStream()
                if ($stream) { $body = (New-Object System.IO.StreamReader($stream)).ReadToEnd() }
            } catch { }
            if ($body -match 'Secret API key required') {
                Write-Ok 'PostgREST operativo. (El listado de esquema pide clave secreta: es lo normal con claves publishable y no afecta a la app.)'
            } elseif ($code) {
                Write-Warn "El listado de esquema devolvió HTTP $code. Como la prueba 1 ya aceptó la clave, la credencial es válida. No es bloqueante."
            } else {
                Write-Warn "No se pudo consultar el esquema: $($_.Exception.Message). No es bloqueante."
            }
        }
    }

    # 3) Si falló la red, decir si es internet/DNS/firewall y no credenciales.
    if ($networkTrouble) {
        $targetHost = try { ([Uri]$url).Host } catch { '' }
        Write-Info 'Diagnóstico de red:'
        $dnsOk = $false
        try {
            $dns = Resolve-DnsName $targetHost -Type A -ErrorAction Stop
            $ips = @(($dns | Where-Object { $_.IPAddress } | Select-Object -First 2).IPAddress)
            if ($ips.Count -gt 0) { Write-Info "  DNS resuelve ${targetHost} -> $($ips -join ', ')"; $dnsOk = $true }
        } catch { Write-Info "  El DNS no resuelve ${targetHost}: $($_.Exception.Message)" }
        if ($dnsOk) {
            try {
                $tcp = New-Object System.Net.Sockets.TcpClient
                $tcp.Connect($targetHost, 443); $tcp.Close()
                Write-Info '  El puerto 443 CONECTA. Entonces el problema es TLS: revisa antivirus, VPN o proxy que inspeccione HTTPS.'
            } catch { Write-Info "  El puerto 443 no conecta: $($_.Exception.Message)" }
        }
        Write-Info '  Conclusión: esto es un problema de RED local, no de tus credenciales.'
    }

    return $keyValidated
}

# ---------------------------------------------------------------- generar config pública
function Write-FrontendConfig([string]$url, [string]$anonKey, [string]$academy, [string]$rootDomain) {
    if ([string]::IsNullOrWhiteSpace($url) -or [string]::IsNullOrWhiteSpace($anonKey)) {
        Write-Warn 'Sin URL o sin anon key: no se generó assets/js/config.js.'
        return
    }
    if (-not (Test-Path $ConfigDir)) { New-Item -ItemType Directory -Path $ConfigDir -Force | Out-Null }

    $esc = { param($s) ([string]$s).Replace('\', '\\').Replace("'", "\'") }

    # La clave PUBLICA de los avisos push no se puede inventar de nuevo: su pareja
    # privada vive como secreto en Supabase y firma los avisos. Si este generador
    # la borrara, los avisos del telefono dejarian de funcionar sin que nadie se
    # enterara hasta que un pago no llegara. Asi que se CONSERVA la que ya hubiera.
    $vapid = ''
    if (Test-Path $ConfigPath) {
        $previo = [System.IO.File]::ReadAllText($ConfigPath, (New-Object System.Text.UTF8Encoding($false)))
        $m = [regex]::Match($previo, "VAPID_PUBLICA:\s*'([^']+)'")
        if ($m.Success) { $vapid = $m.Groups[1].Value; Write-Ok 'Se conserva la clave publica de los avisos push.' }
    }
    $extraVapid = ''
    if ($vapid) { $extraVapid = ",`n  VAPID_PUBLICA: '$vapid'" }

    $content = @"
/* ============================================================
   APRENDO LMS — configuración del frontend
   GENERADO AUTOMÁTICAMENTE por _tools/set-credentials.ps1
   Fecha: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')

   Este archivo SÍ se publica en GitHub Pages. Es correcto y seguro:
   la anon key está diseñada para vivir en el navegador y queda
   protegida por las políticas RLS de Supabase.

   NO pongas aquí la service_role key ni el token de Wistia.
   ============================================================ */
window.APRENDO_CONFIG = {
  SUPABASE_URL: '$(& $esc $url)',
  SUPABASE_ANON_KEY: '$(& $esc $anonKey)',
  ACADEMY_NAME: '$(& $esc $academy)',
  ROOT_DOMAIN: '$(& $esc $rootDomain)'$extraVapid
};
"@
    $enc = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($ConfigPath, $content, $enc)
    Write-Ok "Generado $($ConfigPath -replace [regex]::Escape($Root), '.')"
}

# ================================================================ MAIN
Write-Host ''
Write-Host '  APRENDO LMS — activación de credenciales' -ForegroundColor White
Write-Host "  Carpeta del proyecto: $Root" -ForegroundColor DarkGray

$existing = Read-DotEnv $EnvPath

# ---------------- modo -Show ----------------
if ($Show) {
    Write-Head 'Estado actual de .env (enmascarado)'
    if ($existing.Count -eq 0) { Write-Info "No existe .env todavía. Copia .env.example o ejecuta este script con -SupabaseUrl y -SupabaseAnonKey." }
    else {
        foreach ($k in ($existing.Keys | Sort-Object)) {
            $v = [string]$existing[$k]
            $mark = if ([string]::IsNullOrWhiteSpace($v) -or $v -match '^https://x+\.supabase\.co$') { '  (pendiente)' } else { '' }
            Write-Host ("    {0,-28} {1}{2}" -f $k, (Get-Masked $v), $mark)
        }
    }
    Write-Host ''
    exit 0
}

# ---------------- modo -TestOnly ----------------
if ($TestOnly) {
    if ($existing.Count -eq 0) { Write-Bad 'No hay .env que probar. Ejecuta primero sin -TestOnly.'; exit 1 }
    Write-Head 'Revalidando formato'
    [void](Assert-SupabaseAnonKey ([string]$existing['SUPABASE_ANON_KEY']))
    $ok = Test-SupabaseConnection ([string]$existing['SUPABASE_URL']) ([string]$existing['SUPABASE_ANON_KEY'])
    Write-Host ''
    if ($script:Errors.Count -gt 0) { Write-Host "  RESULTADO: $($script:Errors.Count) error(es), $($script:Warnings.Count) aviso(s)" -ForegroundColor Red; exit 1 }
    if ($ok) { Write-Host "  RESULTADO: credenciales correctas y verificadas. $($script:Warnings.Count) aviso(s)." -ForegroundColor Green; exit 0 }
    Write-Host "  RESULTADO: sin errores fatales pero la conexión no se confirmó." -ForegroundColor Yellow
    exit 0
}

# ---------------- modo normal: fusionar y guardar ----------------
Write-Head 'Validación de formato'

$final = @{}
foreach ($k in $existing.Keys) { $final[$k] = [string]$existing[$k] }

# Supabase
if ($SupabaseUrl) {
    $SupabaseUrl = $SupabaseUrl.Trim().TrimEnd('/')
    if (Test-SupabaseUrl $SupabaseUrl) {
        Write-Ok "SUPABASE_URL con formato correcto ($($SupabaseUrl -replace 'https://([a-z0-9]{4})[a-z0-9]+\.', 'https://$1***.'))"
    } else {
        Write-Bad "SUPABASE_URL no tiene el formato esperado. Se espera https://<20 letras>.supabase.co y llegó: $SupabaseUrl"
    }
    $final['SUPABASE_URL'] = $SupabaseUrl
}
if ($SupabaseAnonKey) {
    $SupabaseAnonKey = $SupabaseAnonKey.Trim()
    [void](Assert-SupabaseAnonKey $SupabaseAnonKey)
    $final['SUPABASE_ANON_KEY'] = $SupabaseAnonKey
}
if ($SupabaseServiceRoleKey) { [void](Assert-SupabaseServiceRole $SupabaseServiceRoleKey); $final['SUPABASE_SERVICE_ROLE_KEY'] = $SupabaseServiceRoleKey.Trim() }

# Wistia
if ($WistiaApiToken) {
    $WistiaApiToken = $WistiaApiToken.Trim()
    if ($WistiaApiToken -match '^[a-f0-9]{40,64}$') { Write-Ok 'WISTIA_API_TOKEN con formato correcto (hex)' }
    else { Write-Warn 'WISTIA_API_TOKEN no parece un token hex de Wistia. Se guarda igual.' }
    $final['WISTIA_API_TOKEN'] = $WistiaApiToken
}
if ($WistiaProjectId) { $final['WISTIA_PROJECT_ID'] = $WistiaProjectId.Trim() }

# GitHub
if ($GithubRepo) {
    $GithubRepo = $GithubRepo.Trim() -replace '^https://github\.com/', '' -replace '\.git$', ''
    if ($GithubRepo -match '^[\w.-]+/[\w.-]+$') { Write-Ok "GITHUB_REPO = $GithubRepo" }
    else { Write-Warn "GITHUB_REPO no parece 'usuario/repositorio': $GithubRepo" }
    $final['GITHUB_REPO'] = $GithubRepo
}
if ($GithubToken) {
    $GithubToken = $GithubToken.Trim()
    $largo = $GithubToken.Length

    # Detectar el TEXTO DE EJEMPLO. Es un error facilismo de cometer: se copia la
    # instruccion "github_pat_..." en vez del token real, y como el prefijo coincide
    # una validacion ingenua lo daria por bueno.
    $esEjemplo = ($GithubToken -match '\.\.\.$') -or
                 ($GithubToken -match '^(github_pat_|ghp_|gho_)\.\.\.$') -or
                 ($GithubToken -in @('TU_TOKEN','TOKEN','AQUI-TU-TOKEN','PEGA-AQUI-EL-TOKEN'))

    if ($esEjemplo) {
        Write-Bad "GITHUB_TOKEN es el TEXTO DE EJEMPLO, no tu token ('$GithubToken'). Copia el valor completo que te dio GitHub: empieza por github_pat_ y ronda los 90 caracteres."
    }
    elseif ($GithubToken -match '^github_pat_') {
        # Un fine-grained PAT real mide ~93 caracteres (github_pat_ + 22 + _ + ~59).
        if ($largo -lt 40) {
            Write-Bad "GITHUB_TOKEN parece INCOMPLETO: solo tiene $largo caracteres y uno real ronda los 90. Revisa que lo copiaste entero, sin cortar."
        } else {
            Write-Ok "GITHUB_TOKEN con formato correcto (fine-grained, $largo caracteres)"
        }
    }
    elseif ($GithubToken -match '^ghp_') {
        # Un PAT clasico mide 40 caracteres (ghp_ + 36).
        if ($largo -lt 40) {
            Write-Bad "GITHUB_TOKEN parece INCOMPLETO: solo tiene $largo caracteres y uno clasico mide 40."
        } else {
            Write-Ok "GITHUB_TOKEN con formato correcto (PAT clasico, $largo caracteres)"
        }
    }
    elseif ($GithubToken -match '^gho_') {
        Write-Warn 'GITHUB_TOKEN parece un token OAuth (gho_). Para publicar se recomienda un PAT.'
    }
    else {
        Write-Warn "GITHUB_TOKEN no empieza por github_pat_ ni ghp_ (tiene $largo caracteres). Se guarda igual, pero revisalo."
    }
    $final['GITHUB_TOKEN'] = $GithubToken
}
if ($GithubUser)   { $final['GITHUB_USER'] = $GithubUser.Trim() }
$final['GITHUB_BRANCH'] = if ($GithubBranch) { $GithubBranch.Trim() } elseif ($final['GITHUB_BRANCH']) { $final['GITHUB_BRANCH'] } else { 'main' }

# Cloudflare
if ($CloudflareApiToken) {
    Write-Ok 'CLOUDFLARE_API_TOKEN recibido (no se puede validar el formato sin consultar la API)'
    $final['CLOUDFLARE_API_TOKEN'] = $CloudflareApiToken.Trim()
}
if ($CloudflareZoneId) {
    if ($CloudflareZoneId.Trim() -match '^[a-f0-9]{32}$') { Write-Ok 'CLOUDFLARE_ZONE_ID con formato correcto' }
    else { Write-Warn 'CLOUDFLARE_ZONE_ID no son 32 caracteres hex.' }
    $final['CLOUDFLARE_ZONE_ID'] = $CloudflareZoneId.Trim()
}
if ($CloudflareAccountId) { $final['CLOUDFLARE_ACCOUNT_ID'] = $CloudflareAccountId.Trim() }

# Ajustes
if ($AcademyName) { $final['ACADEMY_NAME'] = $AcademyName.Trim(); Write-Ok "ACADEMY_NAME = $($final['ACADEMY_NAME'])" }
if ($RootDomain)  { $final['ROOT_DOMAIN']  = $RootDomain.Trim();  Write-Ok "ROOT_DOMAIN = $($final['ROOT_DOMAIN'])" }

# Guardar
Write-Head 'Guardando'
if ($script:Errors.Count -gt 0 -and -not $Force) {
    Write-Bad 'Hay errores de formato. NO se guardó nada. Corrige y vuelve a ejecutar, o usa -Force si estás seguro.'
    Write-Host ''
    exit 1
}
Write-DotEnv $final $EnvPath
Write-Ok ".env guardado ($($final.Keys.Count) variables) — está en .gitignore"

$url = [string]$final['SUPABASE_URL']
$anon = [string]$final['SUPABASE_ANON_KEY']
$acad = [string]$final['ACADEMY_NAME']
$rd   = [string]$final['ROOT_DOMAIN']

Write-FrontendConfig $url $anon $acad $rd

# Prueba de conexión
if ($url -and $anon) { [void](Test-SupabaseConnection $url $anon) }
else { Write-Head 'Conexión'; Write-Info 'Aún faltan SUPABASE_URL y/o SUPABASE_ANON_KEY: no se probó la conexión.' }

# Resumen
Write-Head 'Resumen'
$pend = @()
foreach ($k in @('SUPABASE_URL','SUPABASE_ANON_KEY','WISTIA_API_TOKEN','GITHUB_REPO','GITHUB_TOKEN','CLOUDFLARE_API_TOKEN','CLOUDFLARE_ZONE_ID','ACADEMY_NAME')) {
    $v = [string]$final[$k]
    if ([string]::IsNullOrWhiteSpace($v) -or $v -match '^https://x+\.supabase\.co$') { $pend += $k }
}
if ($pend.Count -eq 0) { Write-Ok 'Todas las credenciales principales están cargadas.' }
else { Write-Info "Pendientes: $($pend -join ', ')" }

Write-Host ''
if ($script:Errors.Count -gt 0)   { Write-Host "  Terminado con $($script:Errors.Count) error(es) y $($script:Warnings.Count) aviso(s)." -ForegroundColor Red;   exit 1 }
if ($script:Warnings.Count -gt 0) { Write-Host "  Terminado con $($script:Warnings.Count) aviso(s)." -ForegroundColor Yellow; exit 0 }
Write-Host '  Terminado sin problemas.' -ForegroundColor Green
exit 0
