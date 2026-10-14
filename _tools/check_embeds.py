"""
COMPROBADOR DE CONSULTAS ANIDADAS (PostgREST) <-> CLAVES FORANEAS
==================================================================
Este comprobador existe por un fallo real que se coló en el proyecto:

    el cliente hacia   .from('inscripciones').select('..., perfiles(nombre_completo)')
    pero en el esquema NO habia ninguna clave foranea entre inscripciones y perfiles.
    Las dos apuntaban por separado a auth.users.

PostgREST resuelve los anidamientos buscando una clave foranea DIRECTA entre las dos
tablas. Si no la encuentra devuelve "Could not find a relationship between ... in the
schema cache" y esa parte del panel queda vacia, sin que nada avise al programar.

DOS CORRECCIONES SOBRE LA PRIMERA VERSION (las dos eran agujeros de verdad)
--------------------------------------------------------------------------
1. Leia SOLO supabase/001_esquema_inicial.sql. Al anadir las migraciones 002 y 003,
   el comprobador seguia diciendo "correcto" sin haber visto ni una de sus tablas:
   daba falsa tranquilidad justo cuando mas codigo nuevo habia.
   Ahora lee todas las migraciones en orden.

2. Su patron exigia que la lista de campos fuera UNA sola cadena. Pero en el cliente
   las listas largas se escriben concatenadas:

       .select('id, estado, ... ' +
               'perfiles(nombre_completo, email), cursos(nombre, slug)')

   Los anidamientos viven precisamente en las partes siguientes, asi que no los veia.
   Tampoco entendia el anidamiento con pista, que es obligatorio cuando una tabla se
   apunta a si misma:

       duplicado:pagos!duplicado_de(id, referencia, creado_en)

   Ahora se leen TODAS las cadenas del .select(...) y se entienden las tres formas:
   destino(...), alias:destino(...) y alias:destino!pista(...).
"""
import re, os, sys, io, glob

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DIR_SQL = os.path.join(RAIZ, 'supabase')
RUTA_JS = os.path.join(RAIZ, 'assets', 'js', 'supabase-client.js')

# ------------------------------------------------------------------ el esquema
# Se leen TODAS las migraciones, en orden de nombre. Si algun dia hay una 004,
# entra sola.
rutas_sql = sorted(glob.glob(os.path.join(DIR_SQL, '*.sql')))
if not rutas_sql:
    print('No se encontro ninguna migracion en supabase/. Nada que comprobar.')
    sys.exit(1)

sql = ''
for r in rutas_sql:
    with open(r, 'r', encoding='utf-8') as f:
        sql += '\n' + f.read()

with open(RUTA_JS, 'r', encoding='utf-8') as f:
    js = f.read()

sql_limpio = re.sub(r'--[^\n]*', '', sql)

print('Migraciones leidas:')
for r in rutas_sql:
    print(f'   {os.path.basename(r)}')

# ------------------------------------------------------------------ tablas
def bloque_parentesis(texto, inicio):
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

tablas = set()
for m in re.finditer(r'create\s+table\s+if\s+not\s+exists\s+public\.(\w+)', sql_limpio, re.I):
    tablas.add(m.group(1))

# ------------------------------------------------------------------ claves foraneas
# fk[(tabla_origen, tabla_destino)] = ["columna", ...]
fk = {}

def registrar(origen, columna, destino):
    if origen in tablas and destino in tablas:
        fk.setdefault((origen, destino), []).append(columna)

# 1) Las declaradas dentro del CREATE TABLE
for m in re.finditer(r'create\s+table\s+if\s+not\s+exists\s+public\.(\w+)', sql_limpio, re.I):
    origen = m.group(1)
    cuerpo = bloque_parentesis(sql_limpio, m.end())
    for linea in cuerpo.split('\n'):
        linea = linea.strip()
        cm = re.match(r'^(\w+)\s+[^,]*?references\s+(?:public\.)?(\w+)\s*\(', linea, re.I)
        if cm:
            registrar(origen, cm.group(1), cm.group(2))

# 2) Las anadidas despues con ALTER TABLE ... ADD CONSTRAINT
for m in re.finditer(
        r'alter\s+table\s+public\.(\w+)\s+add\s+constraint\s+\w+\s+'
        r'foreign\s+key\s*\(\s*(\w+)\s*\)\s*references\s+(?:public\.)?(\w+)\s*\(',
        sql_limpio, re.I):
    registrar(m.group(1), m.group(2), m.group(3))

# ------------------------------------------------------------------ consultas anidadas

def leer_cadenas_del_select(texto, pos):
    """
    Lee todas las cadenas de un .select(...) a partir de `pos` (justo despues del
    parentesis de apertura) y las devuelve unidas.

    Se detiene en el parentesis de cierre que queda FUERA de las comillas, que es
    lo que permite que las columnas de un anidamiento lleven parentesis dentro.
    """
    partes = []
    i, n = pos, len(texto)
    while i < n:
        c = texto[i]
        if c in ("'", '"'):
            fin, buf = i + 1, []
            while fin < n:
                if texto[fin] == '\\':
                    if fin + 1 < n:
                        buf.append(texto[fin + 1])
                    fin += 2
                    continue
                if texto[fin] == c:
                    break
                buf.append(texto[fin])
                fin += 1
            partes.append(''.join(buf))
            i = fin + 1
            continue
        if c == ')':
            break
        i += 1
    return ''.join(partes), i

consulta_re = re.compile(
    r"\.from\(\s*['\"](\w+)['\"]\s*\)"
    # Entre el .from() y el .select() solo puede haber llamadas encadenadas de la
    # MISMA consulta. Sin este limite, un .from() sin .select() propio (por ejemplo
    # el de un borrado) se emparejaba con el .select() de la funcion siguiente y
    # aparecian anidamientos que no existen. Por eso se prohibe cruzar un punto y
    # coma, otro .from( o el principio de otra funcion.
    r"((?:(?!\.from\(|;|async\s)[\s\S]){0,200}?)"
    r"\.select\(\s*", re.S)

anidamientos = []
for m in consulta_re.finditer(js):
    origen = m.group(1)
    campos, _ = leer_cadenas_del_select(js, m.end())
    linea = js[:m.start()].count('\n') + 1

    # Tres formas de anidar:
    #   destino(cols)                     -> destino
    #   alias:destino(cols)               -> destino
    #   alias:destino!pista_de_fk(cols)   -> destino   (obligatorio al apuntarse a si misma)
    for t in re.finditer(r"(?:(\w+)\s*:\s*)?(\w+)(?:\s*!\s*\w+)?\s*\(", campos):
        destino = t.group(2)
        if destino.lower() in ('count', 'sum', 'avg', 'min', 'max', 'cast', 'coalesce', 'and', 'or'):
            continue
        if destino not in tablas:
            continue
        anidamientos.append((origen, destino, linea))

# ------------------------------------------------------------------ informe
print(f'\nTablas del esquema : {len(tablas)}  ({", ".join(sorted(tablas))})')
print(f'Claves foraneas    : {len(fk)} pares origen->destino')
for (o, d), cols in sorted(fk.items()):
    print(f'   {o}.{", ".join(cols)} -> {d}')

print(f'\nConsultas anidadas encontradas: {len(anidamientos)}')

errores = []
for origen, destino, linea in anidamientos:
    directa = (origen, destino) in fk
    inversa = (destino, origen) in fk
    if directa:
        estado = f'OK  (por {origen}.{fk[(origen, destino)][0]} -> {destino})'
    elif inversa:
        estado = f'OK  (inversa: {destino}.{fk[(destino, origen)][0]} -> {origen})'
    else:
        estado = 'FALTA LA CLAVE FORANEA'
        errores.append((origen, destino, linea))
    print(f'   L{linea}: {origen} -> {destino}(...)')
    print(f'      {estado}')

# Aviso: si el cliente anida pero no se encontro NINGUNA consulta, algo va mal en
# el propio comprobador (es lo que pasaba antes y daba falsa tranquilidad).
if not anidamientos:
    print('\nAVISO: no se encontro ninguna consulta anidada. Si el cliente usa anidamientos,')
    print('       este comprobador ha dejado de verlos y hay que revisarlo.')

print('\n' + '=' * 64)
if errores:
    print(f'ERRORES ({len(errores)}): PostgREST no podra resolver estos anidamientos')
    for origen, destino, linea in errores:
        print(f'  [X] L{linea}: {origen} -> {destino}')
        print(f'      Falta una clave foranea entre {origen} y {destino}.')
        print(f'      Anade:  alter table public.{origen} add constraint ...')
        print(f'              foreign key (<columna>) references public.{destino}(id);')
    sys.exit(1)

print(f'RESULTADO: los {len(anidamientos)} anidamientos tienen su clave foranea')
sys.exit(0)
