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

Este script cruza las consultas anidadas del cliente con las claves foraneas del
esquema y avisa cuando falta el enlace. Es exactamente el fallo que no se ve hasta
que alguien abre la pantalla.
"""
import re, os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUTA_SQL = os.path.join(RAIZ, 'supabase', '001_esquema_inicial.sql')
RUTA_JS = os.path.join(RAIZ, 'assets', 'js', 'supabase-client.js')

with open(RUTA_SQL, 'r', encoding='utf-8') as f:
    sql = f.read()
with open(RUTA_JS, 'r', encoding='utf-8') as f:
    js = f.read()

sql_limpio = re.sub(r'--[^\n]*', '', sql)

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
# fk[(tabla_origen, tabla_destino)] = "columna -> destino"
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
# .from('origen') ... .select('..., destino(columnas)')
consulta_re = re.compile(
    r"\.from\(\s*['\"](\w+)['\"]\s*\)\s*\n?\s*\.select\(\s*['\"]([^'\"]*)['\"]",
    re.S)

anidamientos = []
for m in consulta_re.finditer(js):
    origen, campos = m.group(1), m.group(2)
    linea = js[:m.start()].count('\n') + 1
    for t in re.finditer(r'(\w+)\s*\(', campos):
        destino = t.group(1)
        # Descartar funciones de agregado y palabras que no son tablas
        if destino.lower() in ('count', 'sum', 'avg', 'min', 'max', 'cast', 'coalesce'):
            continue
        if destino not in tablas:
            continue
        anidamientos.append((origen, destino, linea, campos.strip()))

# ------------------------------------------------------------------ informe
print(f'Tablas del esquema : {len(tablas)}')
print(f'Claves foraneas    : {len(fk)} pares origen->destino')
for (o, d), cols in sorted(fk.items()):
    print(f'   {o}.{", ".join(cols)} -> {d}')
print(f'\nConsultas anidadas encontradas: {len(anidamientos)}')

errores = []
for origen, destino, linea, campos in anidamientos:
    directa = (origen, destino) in fk
    inversa = (destino, origen) in fk
    if directa:
        estado = f'OK  (por {origen}.{fk[(origen, destino)][0]} -> {destino})'
    elif inversa:
        estado = f'OK  (inversa: {destino}.{fk[(destino, origen)][0]} -> {origen})'
    else:
        estado = 'FALTA LA CLAVE FORANEA'
        errores.append((origen, destino, linea, campos))
    print(f'\n   L{linea}: {origen} -> {destino}(...)')
    print(f'      {estado}')

print('\n' + '=' * 64)
if errores:
    print(f'ERRORES ({len(errores)}): PostgREST no podra resolver estos anidamientos')
    for origen, destino, linea, campos in errores:
        print(f'  [X] L{linea}: {origen} -> {destino}')
        print(f'      Falta una clave foranea entre {origen} y {destino}.')
        print(f'      Anade:  alter table public.{origen} add constraint ...')
        print(f'              foreign key (<columna>) references public.{destino}(id);')
    sys.exit(1)

print(f'RESULTADO: los {len(anidamientos)} anidamientos tienen su clave foranea')
sys.exit(0)
