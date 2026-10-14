"""
COMPROBADOR DE BOTONES DE PANEL (drawers)
==========================================
Nacido de un fallo real que costo mucho diagnosticar:

    Los botones "Guardar preguntas" y "Borrar todas" viven en el PIE del panel,
    y en crearCapa el pie es un HERMANO de .drawer-body, no un hijo. El panel de
    lecciones ataba su escuchador de clics solo al cuerpo, asi que pulsar
    "Guardar preguntas" no hacia absolutamente NADA: ni guardaba, ni avisaba, ni
    daba error. Un fallo silencioso, que es el peor tipo.

Lo que comprueba este script
----------------------------
  1. Saca las acciones (`data-accion`) de cada bloque `var pie = ...`, que son
     los botones del PIE del panel.
  2. Saca las acciones que cada escuchador de clics atiende (sus `case`).
  3. Avisa si alguna accion del pie NO la atiende ningun escuchador atado al
     panel completo. Atarla al cuerpo es justo lo que rompia las cosas.
  4. Avisa tambien de cualquier escuchador de clics atado a una variable que
     parece el cuerpo del panel, por si alguien vuelve a hacerlo.

Limite honesto: es analisis estatico por expresiones regulares sobre admin.js.
No entiende el codigo, solo su forma. Si algun dia se reestructura el archivo con
otra nomenclatura, habra que ajustar los patrones (y este texto).
"""
import re, os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUTA = os.path.join(RAIZ, 'assets', 'js', 'admin.js')

with open(RUTA, 'r', encoding='utf-8') as f:
    js = f.read()

# Quitamos comentarios para no confundir el analisis con lo que dicen
sin_comentarios = re.sub(r'/\*[\s\S]*?\*/', '', js)
sin_comentarios = re.sub(r'(?m)^\s*//.*$', '', sin_comentarios)

errores, avisos = [], []

# ---------------------------------------------------------------- 1. acciones del pie
acciones_pie = {}
for m in re.finditer(r'var\s+pie\s*=\s*([\s\S]*?);\s*\n', sin_comentarios):
    bloque = m.group(1)
    linea = sin_comentarios[:m.start()].count('\n') + 1
    for a in re.finditer(r'data-accion="([\w-]+)"', bloque):
        acciones_pie.setdefault(a.group(1), []).append(linea)

# ---------------------------------------------------------------- 2. que atiende cada escuchador
# Cada escuchador de clics: quien lo recibe y que `case` contiene.
escuchadores = []
for m in re.finditer(r"([\w.$]+(?:\.\w+)?)\s*\.addEventListener\('click'", sin_comentarios):
    receptor = m.group(1)
    # El bloque llega hasta el cierre del addEventListener: buscamos los `case`
    # en una ventana razonable a partir de aqui.
    trozo = sin_comentarios[m.end(): m.end() + 3500]
    fin = trozo.find('});')
    if fin > 0:
        trozo = trozo[:fin]
    # Los manejadores despachan de DOS formas distintas segun el panel:
    #   - switch/case:            case 'guardar-preguntas':
    #   - comparaciones:          if (accion === 'guardar')  /  if (b.getAttribute('data-accion') === 'inscribir')
    # Hay que reconocer las dos. La primera version de este comprobador solo miraba
    # los `case`, y por eso daba tres falsos positivos (guardar, cancelar, inscribir).
    acciones = set(re.findall(r"case\s+'([\w-]+)'", trozo))
    acciones |= set(re.findall(r"\baccion\s*={2,3}\s*'([\w-]+)'", trozo))
    acciones |= set(re.findall(r"getAttribute\(\s*'data-accion'\s*\)\s*={2,3}\s*'([\w-]+)'", trozo))
    escuchadores.append({
        'receptor': receptor,
        'acciones': acciones,
        'linea': sin_comentarios[:m.start()].count('\n') + 1
    })

# Un escuchador "amplio" cubre el panel completo (y por tanto tambien su pie).
def es_amplio(receptor):
    r = receptor.lower()
    return r in ('panel', 'capa.panel') or r.endswith('.panel')

amplios = [e for e in escuchadores if es_amplio(e['receptor'])]
estrechos = [e for e in escuchadores if not es_amplio(e['receptor'])]

# ---------------------------------------------------------------- 3. cobertura
cubiertas = set()
for e in amplios:
    cubiertas |= e['acciones']
# crearCapa atiende "cerrar-capa" desde su propio escuchador del panel
cubiertas.add('cerrar-capa')

print(f'Escuchadores de clic encontrados: {len(escuchadores)}')
for e in escuchadores:
    tipo = 'AMPLIO (panel)' if es_amplio(e['receptor']) else 'estrecho'
    print(f"   L{e['linea']:<5} {e['receptor']:<18} {tipo:<16} {len(e['acciones'])} accion(es)")

print(f'\nAcciones declaradas en el PIE: {len(acciones_pie)}')
for a, lineas in sorted(acciones_pie.items()):
    ok = a in cubiertas
    print(f"   {a:<22} {'cubierta' if ok else 'SIN MANEJADOR'}"
          + ('' if ok else f'   (declarada en la linea {lineas[0]})'))
    if not ok:
        errores.append(
            f'La accion "{a}" esta en el pie del panel (linea {lineas[0]}) pero ningun '
            f'escuchador atado al panel la atiende. Pulsarla no hara nada.')

# ---------------------------------------------------------------- 4. escuchadores sospechosos
for e in estrechos:
    r = e['receptor'].lower()
    if 'cuerpo' in r or 'body' in r:
        avisos.append(
            f'L{e["linea"]}: hay un escuchador de clics atado a "{e["receptor"]}", que parece '
            f'el cuerpo del panel. Los botones del PIE no llegaran a el. '
            f'Es exactamente el fallo de "Guardar preguntas".')
    elif e['acciones']:
        # Un escuchador acotado con acciones propias no es necesariamente un fallo
        # (puede ser una tarjeta o el fondo), pero conviene revisarlo.
        avisos.append(
            f'L{e["linea"]}: escuchador atado a "{e["receptor"]}" con '
            f'{len(e["acciones"])} accion(es): {", ".join(sorted(e["acciones"]))}')

# ---------------------------------------------------------------- informe
print()
if errores:
    print(f'ERRORES ({len(errores)}):')
    for e in errores:
        print(f'  [X] {e}')
else:
    print('ERRORES: ninguno — todos los botones del pie tienen quien los atienda')

if avisos:
    print(f'\nAVISOS ({len(avisos)}):')
    for a in avisos:
        print(f'  [!] {a}')

print()
print('RESULTADO:', 'FALLO' if errores else 'CORRECTO')
sys.exit(1 if errores else 0)
