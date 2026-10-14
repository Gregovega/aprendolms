import sys, io, os
from html.parser import HTMLParser

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

VACIOS = {'area','base','br','col','embed','hr','img','input','link','meta',
          'param','source','track','wbr','path','circle','rect','line','polygon'}

class V(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.pila = []
        self.errores = []
        self.ids = {}
        self.refs = set()
        self.scripts = []
        self.links = []
    def handle_starttag(self, tag, attrs):
        d = dict(attrs)
        if 'id' in d:
            self.ids.setdefault(d['id'], 0)
            self.ids[d['id']] += 1
        if tag == 'script' and d.get('src'):
            self.scripts.append(d['src'])
        if tag == 'link' and d.get('href'):
            self.links.append(d['href'])
        for k in ('href','src'):
            v = d.get(k)
            if v and v.startswith('#'):
                self.refs.add(v[1:])
        if tag not in VACIOS:
            self.pila.append((tag, self.getpos()))
    def handle_endtag(self, tag):
        if tag in VACIOS:
            return
        if not self.pila:
            self.errores.append(f"cierre </{tag}> sin apertura en {self.getpos()}")
            return
        if self.pila[-1][0] != tag:
            # buscar hacia atras
            nombres = [t for t, _ in self.pila]
            if tag in nombres:
                while self.pila and self.pila[-1][0] != tag:
                    t, pos = self.pila.pop()
                    self.errores.append(f"<{t}> abierto en linea {pos[0]} sin cerrar (se encontro </{tag}>)")
                self.pila.pop()
            else:
                self.errores.append(f"cierre </{tag}> sin apertura en {self.getpos()}")
        else:
            self.pila.pop()

def revisar(ruta):
    with open(ruta, 'r', encoding='utf-8') as f:
        txt = f.read()
    p = V()
    p.feed(txt)
    p.close()
    print(f"\n=== {os.path.basename(ruta)} ({len(txt)} bytes) ===")
    for t, pos in p.pila:
        p.errores.append(f"<{t}> abierto en linea {pos[0]} y NUNCA cerrado")
    if p.errores:
        for e in p.errores:
            print(f"  ERROR: {e}")
    else:
        print("  Estructura HTML correcta")
    dups = [k for k, v in p.ids.items() if v > 1]
    print(f"  id unicos: {len(p.ids)}" + (f"   DUPLICADOS: {dups}" if dups else ""))
    faltan = [r for r in p.refs if r and r not in p.ids]
    if faltan:
        print(f"  AVISO: anclas sin destino: {faltan}")
    # recursos locales
    base = os.path.dirname(ruta)
    for r in p.scripts + [l for l in p.links if not l.startswith('http')]:
        if r.startswith('http'):
            continue
        full = os.path.join(base, r.replace('/', os.sep))
        marca = "OK" if os.path.exists(full) else "NO EXISTE"
        if marca == "NO EXISTE":
            print(f"  ERROR recurso: {r} -> {marca}")
    print(f"  scripts: {len(p.scripts)} ({len([s for s in p.scripts if s.startswith('http')])} por CDN)")

base = r"G:\Documents\a PROYECTOS AUTOMATIZACIONES\APRENDO LMS"
for nombre in ['index.html', 'curso.html', 'verificar.html', 'admin.html', r'_tools\design-system.html']:
    ruta = os.path.join(base, nombre)
    if os.path.exists(ruta):
        revisar(ruta)
    else:
        print(f"\n=== {nombre} ===  (aun no existe)")
