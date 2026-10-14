<#
.SYNOPSIS
    Ejecuta TODAS las comprobaciones del proyecto APRENDO LMS.

.DESCRIPTION
    Reune en un solo comando las verificaciones que se pueden hacer sin navegador
    ni base de datos:

      1. Sintaxis de todos los archivos JavaScript      (node --check)
      2. Estructura de las paginas HTML y recursos      (check_html.py)
      3. Cableado HTML <-> JavaScript por pagina        (check_wiring.py)
      4. Consistencia interna del esquema SQL           (check_sql.py)
      5. Deteccion de embeds de Wistia                  (test-wistia.js)

    Lo que NO comprueba, y conviene tener presente: que el CSS se vea bien, que el
    reproductor de Wistia cargue de verdad y que el SQL se ejecute en PostgreSQL.
    Eso requiere un navegador y una base de datos reales.

.EXAMPLE
    pwsh _tools/check-all.ps1
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Continue'
$Raiz = if ($PSScriptRoot) { Split-Path -Parent $PSScriptRoot } else { (Get-Location).Path }
Set-Location $Raiz

# Localizar Python: el del sistema suele ser el alias de la Microsoft Store.
$python = $null
foreach ($c in @(
    'C:\Users\Gregorio\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\python\python.exe',
    "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
    "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe"
)) { if (Test-Path $c) { $python = $c; break } }
if (-not $python) {
    $c = Get-Command python -ErrorAction SilentlyContinue
    if ($c -and $c.Source -notmatch 'WindowsApps') { $python = $c.Source }
}
$node = $null
$c = Get-Command node -ErrorAction SilentlyContinue
if ($c) { $node = $c.Source } elseif (Test-Path 'C:\Program Files\nodejs\node.exe') { $node = 'C:\Program Files\nodejs\node.exe' }

$resultados = New-Object System.Collections.Generic.List[object]

function Anotar($nombre, $ok, $detalle) {
    $resultados.Add([pscustomobject]@{ Prueba = $nombre; Estado = $(if ($ok) { 'OK' } else { 'FALLO' }); Detalle = $detalle })
}

Write-Host ''
Write-Host '  APRENDO LMS - verificacion completa' -ForegroundColor White
Write-Host ('  ' + ('-' * 34)) -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. JavaScript
Write-Host ''
Write-Host '  [1/9] Sintaxis JavaScript' -ForegroundColor Cyan
if (-not $node) {
    Anotar 'Sintaxis JS' $false 'node no encontrado'
    Write-Host '        node no encontrado' -ForegroundColor Red
} else {
    $js = Get-ChildItem 'assets\js' -Filter '*.js' -ErrorAction SilentlyContinue | Sort-Object Name
    $malos = @()
    foreach ($f in $js) {
        & $node --check $f.FullName 2>$null | Out-Null
        if ($LASTEXITCODE -ne 0) { $malos += $f.Name; Write-Host "        FALLO: $($f.Name)" -ForegroundColor Red }
    }
    if ($malos.Count -eq 0) { Write-Host "        $($js.Count) archivos correctos" -ForegroundColor Green }
    Anotar 'Sintaxis JS' ($malos.Count -eq 0) "$($js.Count) archivos, $($malos.Count) con fallos"
}

# ---------------------------------------------------------------- 2. HTML
Write-Host ''
Write-Host '  [2/9] Estructura de las paginas HTML' -ForegroundColor Cyan
if (-not $python) {
    Anotar 'Estructura HTML' $false 'Python no encontrado (es opcional)'
    Write-Host '        Python no encontrado; se omite' -ForegroundColor Yellow
} else {
    $salida = & $python '_tools\check_html.py' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $errs = @($salida | Select-String 'ERROR').Count
    $paginas = @($salida | Select-String '^=== .*\.html').Count
    if ($ok -and $errs -eq 0) { Write-Host "        $paginas paginas con estructura correcta" -ForegroundColor Green }
    else { $salida | Select-String 'ERROR' | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
    Anotar 'Estructura HTML' ($ok -and $errs -eq 0) "$paginas paginas, $errs errores"
}

# ---------------------------------------------------------------- 3. Cableado
Write-Host ''
Write-Host '  [3/9] Cableado HTML <-> JavaScript' -ForegroundColor Cyan
if ($python) {
    $salida = & $python '_tools\check_wiring.py' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $pedidos = 0
    $salida | Select-String 'getElementById detectados : (\d+)' | ForEach-Object {
        $pedidos += [int]$_.Matches[0].Groups[1].Value
    }
    if ($ok) { Write-Host "        $pedidos referencias a elementos, todas resueltas" -ForegroundColor Green }
    else { $salida | Select-String '\[X\]' | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
    Anotar 'Cableado HTML/JS' $ok "$pedidos referencias"
} else {
    Anotar 'Cableado HTML/JS' $false 'Python no encontrado'
}

# ---------------------------------------------------------------- 4. SQL
Write-Host ''
Write-Host '  [4/9] Consistencia del esquema SQL' -ForegroundColor Cyan
if ($python) {
    $salida = & $python '_tools\check_sql.py' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $tablas = @($salida | Select-String '^   \w+\s+\d+ columnas').Count
    $pols = 0
    $salida | Select-String 'Politicas: (\d+)' | ForEach-Object { $pols = [int]$_.Matches[0].Groups[1].Value }
    if ($ok) { Write-Host "        $tablas tablas con RLS, $pols politicas, sin errores" -ForegroundColor Green }
    else { $salida | Select-String '\[X\]' | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
    Anotar 'Esquema SQL' $ok "$tablas tablas, $pols politicas"
} else {
    Anotar 'Esquema SQL' $false 'Python no encontrado'
}

# ---------------------------------------------------------------- 5. Wistia
Write-Host ''
Write-Host '  [5/9] Deteccion de embeds de Wistia' -ForegroundColor Cyan
if ($node) {
    $salida = & $node '_tools\test-wistia.js' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $linea = $salida | Select-String 'casos, \d+ fallo' | Select-Object -Last 1
    if ($linea) { Write-Host "        $($linea.Line.Trim())" -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' }) }
    Anotar 'Deteccion Wistia' $ok $(if ($linea) { $linea.Line.Trim() } else { '' })
} else {
    Anotar 'Deteccion Wistia' $false 'node no encontrado'
}

# ---------------------------------------------------------------- 6. Worker
Write-Host ''
Write-Host '  [6/9] Enrutado de subdominios (Worker de Cloudflare)' -ForegroundColor Cyan
if ($node) {
    $salida = & $node 'cloudflare\test-routing.mjs' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $linea = $salida | Select-String 'casos, \d+ fallo' | Select-Object -Last 1
    if ($linea) { Write-Host "        $($linea.Line.Trim())" -ForegroundColor $(if ($ok) { 'Green' } else { 'Red' }) }
    Anotar 'Enrutado Worker' $ok $(if ($linea) { $linea.Line.Trim() } else { '' })
} else {
    Anotar 'Enrutado Worker' $false 'node no encontrado'
}

# ---------------------------------------------------------------- 7. Anidamientos
Write-Host ''
Write-Host '  [7/9] Consultas anidadas contra claves foraneas' -ForegroundColor Cyan
if ($python) {
    $salida = & $python '_tools\check_embeds.py' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $cuantos = 0
    $salida | Select-String 'Consultas anidadas encontradas: (\d+)' | ForEach-Object {
        $cuantos = [int]$_.Matches[0].Groups[1].Value
    }
    if ($ok) { Write-Host "        $cuantos anidamientos, todos con su clave foranea" -ForegroundColor Green }
    else { $salida | Select-String '\[X\]|Falta una clave' | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
    Anotar 'Anidamientos/FK' $ok "$cuantos anidamientos"
} else {
    Anotar 'Anidamientos/FK' $false 'Python no encontrado'
}

# ---------------------------------------------------------------- 8. Certificado
Write-Host ''
Write-Host '  [8/9] Generacion del certificado PDF (con jsPDF de verdad)' -ForegroundColor Cyan
if (-not $node) {
    Anotar 'Certificado PDF' $false 'node no encontrado'
} elseif (-not (Test-Path '_tools\vendor\node_modules\jspdf')) {
    # No es un fallo: jsPDF solo hace falta para ESTA prueba. El sitio publicado
    # lo carga desde su CDN, asi que su ausencia no afecta al producto.
    Write-Host '        Omitida: falta jsPDF para las pruebas' -ForegroundColor Yellow
    Write-Host '        Instalalo con: cd _tools\vendor; npm install jspdf@2.5.2 --no-audit --no-fund' -ForegroundColor DarkGray
    Anotar 'Certificado PDF' $true 'omitida (sin jsPDF)'
} else {
    $salida = & $node '_tools\test-certificado.js' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $cuantas = @($salida | Select-String '^  OK ').Count
    $malas = @($salida | Select-String '^  FALLO').Count
    if ($ok) { Write-Host "        $cuantas comprobaciones del PDF, todas correctas" -ForegroundColor Green }
    else { $salida | Select-String '^  FALLO|->' | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
    Anotar 'Certificado PDF' $ok "$cuantas comprobaciones, $malas fallos"
}

# ---------------------------------------------------------------- 9. Panel
Write-Host ''
Write-Host '  [9/9] Funciones puras del panel (slug y JSON de la IA)' -ForegroundColor Cyan
if ($node) {
    $salida = & $node '_tools\test-admin.js' 2>&1
    $ok = ($LASTEXITCODE -eq 0)
    $cuantas = @($salida | Select-String '^  OK ').Count
    $malas = @($salida | Select-String '^  FALLO').Count
    if ($ok) { Write-Host "        $cuantas comprobaciones, todas correctas" -ForegroundColor Green }
    else { $salida | Select-String '^  FALLO|esperado:|obtenido:' | ForEach-Object { Write-Host "        $_" -ForegroundColor Red } }
    Anotar 'Panel (funciones puras)' $ok "$cuantas comprobaciones, $malas fallos"
} else {
    Anotar 'Panel (funciones puras)' $false 'node no encontrado'
}

# ---------------------------------------------------------------- resumen
Write-Host ''
Write-Host '  RESUMEN' -ForegroundColor White
Write-Host ('  ' + ('-' * 34)) -ForegroundColor DarkGray
foreach ($r in $resultados) {
    $color = if ($r.Estado -eq 'OK') { 'Green' } else { 'Red' }
    Write-Host ("    {0,-22} {1,-6} {2}" -f $r.Prueba, $r.Estado, $r.Detalle) -ForegroundColor $color
}

$fallos = @($resultados | Where-Object { $_.Estado -ne 'OK' }).Count
Write-Host ''
if ($fallos -eq 0) {
    Write-Host '  Todo correcto.' -ForegroundColor Green
    Write-Host '  El aspecto visual se revisa aparte (ver el README, seccion de revision visual).' -ForegroundColor DarkGray
    Write-Host '  Y esto NO comprueba que el SQL se ejecute en PostgreSQL: eso se confirma' -ForegroundColor DarkGray
    Write-Host '  aplicandolo en el SQL Editor y viendo que liste 10 tablas con rls_activo.' -ForegroundColor DarkGray
} else {
    Write-Host "  $fallos comprobacion(es) con fallos." -ForegroundColor Red
}
Write-Host ''
exit $fallos
