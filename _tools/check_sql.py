"""
VALIDADOR DE CONSISTENCIA DEL ESQUEMA SQL
==========================================
Comprueba que el esquema es INTERNAMENTE coherente sin necesidad de un motor de
base de datos. Detecta:

  A. Referencias a tablas que no existen (errores de escritura)
  B. Tablas sin Row Level Security activado
  C. GRANT sobre tablas inexistentes
  D. Nombres de política duplicados
  E. GRANT EXECUTE sobre funciones inexistentes
  F. Columnas usadas en políticas que no existen en su tabla
  G. Tablas creadas pero nunca mencionadas en ninguna política

CORREGIDO: antes leía SOLO supabase/001_esquema_inicial.sql. Al añadir las
migraciones 002 y 003 seguía diciendo "correcto" con 10 tablas, sin haber visto
ni una de las tablas nuevas: daba por bueno un esquema que no había leído. Ahora
lee TODAS las migraciones en orden, así que una 004 entra sola.
"""
import re, sys, io, os, glob

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

DIR_SQL = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'supabase')
RUTAS = sorted(glob.glob(os.path.join(DIR_SQL, '*.sql')))

if not RUTAS:
    print('No se encontró ninguna migración en supabase/. Nada que validar.')
    sys.exit(1)

sql = ''
for r in RUTAS:
    with open(r, 'r', encoding='utf-8') as f:
        sql += '\n' + f.read()

# Quitamos los comentarios de linea para no confundir el analisis
sin_comentarios = re.sub(r'--[^\n]*', '', sql)

errores, avisos = [], []

# ---------------------------------------------------------------- tablas y columnas
def bloque_parentesis(texto, inicio):
    """Devuelve el contenido del parentesis que abre en/despues de `inicio`."""
    i = texto.find('(', inicio)
    if i < 0:
        return ''
    nivel, j = 0, i
    while j < len(texto):
        if texto[j] == '(':
            nivel += 1
        elif texto[j] == ')':
            nivel -= 1
            if nivel == 0:
                return texto[i + 1:j]
        j += 1
    return ''

tablas = {}   # nombre -> set de columnas
for m in re.finditer(r'create\s+table\s+if\s+not\s+exists\s+public\.(\w+)', sin_comentarios, re.I):
    nombre = m.group(1)
    cuerpo = bloque_parentesis(sin_comentarios, m.end())
    cols = set()
    for linea in cuerpo.split('\n'):
        linea = linea.strip()
        if not linea or linea.startswith('--'):
            continue
        # Saltamos restricciones de tabla
        if re.match(r'(?i)^(unique|primary\s+key|foreign\s+key|constraint|check)\b', linea):
            continue
        cm = re.match(r'^(\w+)\s+', linea)
        if cm:
            cols.add(cm.group(1))
    tablas[nombre] = cols

if not tablas:
    errores.append('No se detecto ninguna tabla. ¿Esta mal la ruta o el SQL?')

# ---------------------------------------------------------------- A. referencias
patrones_ref = [
    r'references\s+public\.(\w+)',
    r'\bfrom\s+public\.(\w+)',
    r'\binto\s+public\.(\w+)',
    r'\bupdate\s+public\.(\w+)',
    r'\bjoin\s+public\.(\w+)',
    r'\bon\s+public\.(\w+)',
    r'\btable\s+public\.(\w+)',
]
referenciadas = set()
for p in patrones_ref:
    for m in re.finditer(p, sin_comentarios, re.I):
        referenciadas.add(m.group(1))

for t in sorted(referenciadas):
    if t not in tablas:
        errores.append(f'A. Se referencia public.{t} pero esa tabla no se crea')

# ---------------------------------------------------------------- B. RLS
con_rls = set(m.group(1) for m in re.finditer(
    r'alter\s+table\s+public\.(\w+)\s+enable\s+row\s+level\s+security', sin_comentarios, re.I))
for t in sorted(tablas):
    if t not in con_rls:
        errores.append(f'B. La tabla public.{t} NO tiene RLS activado')

# ---------------------------------------------------------------- C. GRANT sobre tablas
for m in re.finditer(r'grant\s+[^;]*?\son\s+public\.(\w+)', sin_comentarios, re.I | re.S):
    t = m.group(1)
    if t not in tablas:
        errores.append(f'C. GRANT sobre public.{t}, que no existe')

# ---------------------------------------------------------------- D. politicas duplicadas
nombres_pol = [m.group(1) for m in re.finditer(r'create\s+policy\s+(\w+)', sin_comentarios, re.I)]
vistos = set()
for n in nombres_pol:
    if n in vistos:
        errores.append(f'D. La politica {n} esta definida mas de una vez')
    vistos.add(n)
if not nombres_pol:
    errores.append('D. No se detecto ninguna politica RLS')

# ---------------------------------------------------------------- E. funciones
funciones = set(m.group(1) for m in re.finditer(
    r'create\s+or\s+replace\s+function\s+public\.(\w+)', sin_comentarios, re.I))
for m in re.finditer(r'grant\s+execute\s+on\s+function\s+public\.(\w+)', sin_comentarios, re.I):
    f = m.group(1)
    if f not in funciones:
        errores.append(f'E. GRANT EXECUTE sobre public.{f}(), que no existe')

# Funciones internas que se invocan dentro de otras
for m in re.finditer(r'create\s+or\s+replace\s+function\s+public\.(\w+)(.*?)\$\$', sin_comentarios, re.I | re.S):
    cuerpo = m.group(2)
    for im in re.finditer(r'public\.(\w+)\s*\(', cuerpo):
        llamada = im.group(1)
        if llamada not in funciones and llamada not in tablas:
            avisos.append(f'E. La funcion public.{m.group(1)}() llama a public.{llamada}() que no se define')

# ---------------------------------------------------------------- F. columnas en politicas
PALABRAS = {
    'true','false','null','and','or','not','in','is','select','exists','where','using',
    'with','check','to','on','for','all','insert','update','delete','coalesce','upper',
    'lower','count','sum','max','min','substr','replace','gen_random_uuid','auth',
    'uid','es_admin','tiene_acceso','obtener_preguntas','calificar_test','verificar_certificado',
    'public','publicado','activa','estado','user_id','curso_id','leccion_id','id','rol',
    'security','definer','search_path','language','sql','plpgsql','stable','as','begin',
    'return','end','if','then','else','elsif','loop','declare','values','order','by','limit',
    'group','having','distinct','union','join','left','right','inner','outer','desc','asc',
    'text','uuid','boolean','int','integer','jsonb','numeric','timestamptz','date','void',
}
for m in re.finditer(r'create\s+policy\s+(\w+)\s+on\s+public\.(\w+)(.*?);', sin_comentarios, re.I | re.S):
    pol, tabla, cuerpo = m.group(1), m.group(2), m.group(3)
    if tabla not in tablas:
        continue

    # Se quitan los literales de texto ANTES de buscar identificadores.
    # En  estado = 'pendiente'  , "pendiente" es un VALOR, no una columna; sin
    # esto saltaba un aviso falso en la politica pagos_crear.
    cuerpo = re.sub(r"'(?:[^']|'')*'", "''", cuerpo)

    for im in re.finditer(r'\b([a-z_][a-z0-9_]*)\b', cuerpo):
        ident = im.group(1)
        if ident in PALABRAS or ident in funciones or ident in tablas:
            continue
        if ident not in tablas[tabla]:
            avisos.append(f'F. En la politica {pol} (tabla {tabla}) aparece "{ident}", '
                          f'que no es una columna de esa tabla')

# ---------------------------------------------------------------- G. tablas sin politica
tablas_con_pol = set(m.group(1) for m in re.finditer(
    r'create\s+policy\s+\w+\s+on\s+public\.(\w+)', sin_comentarios, re.I))
for t in sorted(tablas):
    if t not in tablas_con_pol:
        avisos.append(f'G. La tabla public.{t} tiene RLS pero NINGUNA politica: '
                      f'nadie podra leerla ni escribirla desde el cliente')

# ---------------------------------------------------------------- informe
print(f'Migraciones: {", ".join(os.path.basename(r) for r in RUTAS)}  ({len(sql)} bytes en total)')
print(f'Tablas detectadas: {len(tablas)}')
for t in sorted(tablas):
    print(f'   {t:20s} {len(tablas[t])} columnas, RLS={"si" if t in con_rls else "NO"}')
print(f'Politicas: {len(nombres_pol)}   Funciones: {len(funciones)}  ({", ".join(sorted(funciones))})')
print()

if errores:
    print(f'ERRORES ({len(errores)}):')
    for e in errores:
        print(f'  [X] {e}')
else:
    print('ERRORES: ninguno')

if avisos:
    print(f'\nAVISOS ({len(avisos)}):')
    for a in avisos:
        print(f'  [!] {a}')
else:
    print('AVISOS: ninguno')

print()
print('RESULTADO:', 'FALLO' if errores else 'CONSISTENTE')
sys.exit(1 if errores else 0)
