"""
COMPROBADOR DE CABLEADO HTML <-> JAVASCRIPT
============================================
Busca una clase de fallo muy comun y silenciosa: que un script llame a
getElementById('algo') cuando ese id no existe en la pagina. El navegador no avisa,
simplemente devuelve null y la funcion muere con "Cannot read properties of null".

Para cada pagina comprueba que cada id que el JavaScript pide por getElementById
existe, bien en el HTML, bien en algun HTML que el propio JavaScript genera
(innerHTML con id="...").
"""
import re, os, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

PAGINAS = [
    ('index.html',     ['catalogo.js', 'ui.js', 'supabase-client.js']),
    ('curso.html',     ['curso.js', 'quiz.js', 'certificado.js', 'ui.js', 'supabase-client.js']),
    ('admin.html',     ['admin.js', 'ui.js', 'supabase-client.js', 'wistia-player.js']),
    ('verificar.html', ['verificar.js', 'ui.js', 'supabase-client.js']),
]

def leer(rel):
    p = os.path.join(RAIZ, rel.replace('/', os.sep))
    if not os.path.exists(p):
        return None
    with open(p, 'r', encoding='utf-8') as f:
        return f.read()

def ids_de_html(t):
    return set(re.findall(r"""\bid\s*=\s*["']([^"']+)["']""", t))

def ids_de_js(t):
    """ids que el JavaScript crea dinamicamente dentro de sus plantillas HTML"""
    return set(re.findall(r"""\bid\s*=\s*\\?["']([A-Za-z][\w:-]*)""", t))

def ids_pedidos(t):
    """ids que el JavaScript busca: getElementById('x'), querySelector('#x') o el atajo $('x')"""
    encontrados = set()
    encontrados |= set(re.findall(r"""getElementById\(\s*['"]([^'"]+)['"]\s*\)""", t))
    encontrados |= set(re.findall(r"""querySelector(?:All)?\(\s*['"]#([\w:-]+)""", t))
    # El proyecto define  function $(id) { return document.getElementById(id); }
    encontrados |= set(re.findall(r"""(?<![\w$.])\$\(\s*['"]([^'"]+)['"]\s*\)""", t))
    return encontrados

total_fallos = 0

for html, scripts in PAGINAS:
    t_html = leer(html)
    print(f'\n=== {html} ===')
    if t_html is None:
        print('  (la pagina no existe)')
        continue

    declarados = ids_de_html(t_html)
    print(f'  ids declarados en el HTML : {len(declarados)}')

    # ids que TODOS los scripts generan dinamicamente
    dinamicos = set()
    pedidos = {}
    for s in scripts:
        t_js = leer(f'assets/js/{s}')
        if t_js is None:
            print(f'  FALTAA el script assets/js/{s}')
            total_fallos += 1
            continue
        dinamicos |= ids_de_js(t_js)
        for pid in ids_pedidos(t_js):
            pedidos.setdefault(pid, []).append(s)

    disponibles = declarados | dinamicos
    print(f'  ids generados por el JS   : {len(dinamicos - declarados)}')
    print(f'  getElementById detectados : {len(pedidos)}')

    faltan = []
    for pid, quienes in sorted(pedidos.items()):
        if pid not in disponibles:
            faltan.append((pid, quienes))

    if faltan:
        total_fallos += len(faltan)
        print(f'  ERRORES ({len(faltan)}):')
        for pid, quienes in faltan:
            print(f'    [X] getElementById("{pid}") en {", ".join(sorted(set(quienes)))} '
                  f'-> NO existe en {html} ni lo genera el JS')
    else:
        print('  Cableado correcto: todo getElementById encuentra su elemento')

    # Aviso inverso: ids declarados que ningun script usa (posible resto de una version anterior).
    # Contamos como "usado" cualquier id que aparezca como literal entre comillas en el JS:
    # el proyecto pasa ids a ayudantes del tipo ponerTexto('stat-cursos', ...) o
    # actualizarPreview('prev-firma', ...), que un analisis sintactico no veria.
    usados = set(pedidos.keys())
    for s in scripts:
        t_js = leer(f'assets/js/{s}')
        if t_js:
            usados |= ids_de_js(t_js)
            usados |= set(re.findall(r"""['"]([A-Za-z][\w:-]*)['"]""", t_js))
    huerfanos = sorted(declarados - usados)
    if huerfanos:
        print(f'  (aviso) ids declarados que ningun script referencia: {", ".join(huerfanos)}')

print(f'\n{"="*60}')
print(f'RESULTADO: {"FALLO con " + str(total_fallos) + " problema(s)" if total_fallos else "TODO CABLEADO CORRECTAMENTE"}')
sys.exit(1 if total_fallos else 0)
