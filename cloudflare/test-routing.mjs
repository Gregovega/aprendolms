/**
 * Pruebas de la logica de enrutado del Worker de subdominios.
 *
 * `decidirRuta` es una funcion pura a proposito: se puede probar sin desplegar
 * nada, sin cuenta de Cloudflare y sin simular su entorno.
 *
 *   node cloudflare/test-routing.mjs
 */
import { decidirRuta } from './worker.js';

const ENV = {
  ROOT_DOMAIN: 'midominio.com',
  PAGES_ORIGIN: 'https://gregovega.github.io/aprendolms'
};

/** Atajo para escribir los casos de forma legible. */
function caso(hostname, pathname, search = '') {
  return { hostname, pathname, search };
}

const casos = [
  /* ---- El caso central: la raiz del subdominio sirve la pagina del curso ---- */
  {
    nombre: 'Raiz de un subdominio -> pagina del curso',
    entrada: caso('ventadechicha.midominio.com', '/'),
    espera: { tipo: 'curso', slug: 'ventadechicha', url: ENV.PAGES_ORIGIN + '/curso.html?slug=ventadechicha' }
  },
  {
    nombre: 'index.html explicito -> pagina del curso',
    entrada: caso('ventadechicha.midominio.com', '/index.html'),
    espera: { tipo: 'curso', slug: 'ventadechicha' }
  },

  /* ---- LO CRITICO: los recursos NO deben reescribirse ---- */
  {
    nombre: 'CSS del subdominio -> se reenvia intacto',
    entrada: caso('ventadechicha.midominio.com', '/assets/css/design-system.css'),
    espera: { tipo: 'pasar', url: ENV.PAGES_ORIGIN + '/assets/css/design-system.css' }
  },
  {
    nombre: 'JS del subdominio -> se reenvia intacto',
    entrada: caso('ventadechicha.midominio.com', '/assets/js/curso.js'),
    espera: { tipo: 'pasar', url: ENV.PAGES_ORIGIN + '/assets/js/curso.js' }
  },
  {
    nombre: 'Fuente de Google Fonts -> no se toca',
    entrada: caso('ventadechicha.midominio.com', '/assets/fonts/inter.woff2'),
    espera: { tipo: 'pasar' }
  },
  {
    nombre: 'curso.html con query en el subdominio -> se reenvia con su query',
    entrada: caso('ventadechicha.midominio.com', '/curso.html', '?slug=otro'),
    espera: { tipo: 'pasar', url: ENV.PAGES_ORIGIN + '/curso.html?slug=otro' }
  },

  /* ---- El dominio raiz es el catalogo ---- */
  {
    nombre: 'Dominio raiz -> el sitio',
    entrada: caso('midominio.com', '/'),
    espera: { tipo: 'sitio', url: ENV.PAGES_ORIGIN + '/' }
  },
  {
    nombre: 'www -> el sitio, NO un curso',
    entrada: caso('www.midominio.com', '/'),
    espera: { tipo: 'sitio', url: ENV.PAGES_ORIGIN + '/' }
  },
  {
    nombre: 'verificar.html en el dominio raiz -> el sitio',
    entrada: caso('midominio.com', '/verificar.html'),
    espera: { tipo: 'sitio', url: ENV.PAGES_ORIGIN + '/verificar.html' }
  },

  /* ---- Parametros de la URL: se conservan, salvo slug/curso ---- */
  {
    nombre: 'Se conservan los parametros de seguimiento',
    entrada: caso('ventadechicha.midominio.com', '/', '?utm_source=correo&utm_medium=email'),
    espera: { tipo: 'curso', slug: 'ventadechicha' },
    contiene: ['slug=ventadechicha', 'utm_source=correo', 'utm_medium=email']
  },
  {
    nombre: 'El subdominio MANDA sobre ?slug=  (no se deja secuestrar)',
    entrada: caso('ventadechicha.midominio.com', '/', '?slug=otro-curso'),
    espera: { tipo: 'curso', slug: 'ventadechicha' },
    contiene: ['slug=ventadechicha'],
    noContiene: ['otro-curso']
  },
  {
    nombre: 'El subdominio manda tambien sobre ?curso=',
    entrada: caso('ventadechicha.midominio.com', '/', '?curso=otro'),
    espera: { tipo: 'curso', slug: 'ventadechicha' },
    noContiene: ['curso=otro']
  },

  /* ---- Casos limite ---- */
  {
    nombre: 'Subdominio de varios niveles -> NO es un curso',
    entrada: caso('a.b.midominio.com', '/'),
    espera: { tipo: 'pasar' }
  },
  {
    nombre: 'Un subdominio de una etiqueta SIEMPRE es un curso (aunque no exista)',
    entrada: caso('staging.midominio.com', '/'),
    espera: { tipo: 'curso', slug: 'staging' }
  },
  {
    nombre: 'Otro dominio cualquiera -> el sitio',
    entrada: caso('ejemplo.com', '/'),
    espera: { tipo: 'sitio' }
  },
  {
    nombre: 'Mayusculas en el host -> se normalizan',
    entrada: caso('VENTADECHICHA.MIDOMINIO.COM', '/'),
    espera: { tipo: 'curso', slug: 'ventadechicha' }
  },
  {
    nombre: 'Subdominio parecido pero ajeno (midominio.com.evil.com)',
    entrada: caso('midominio.com.evil.com', '/'),
    espera: { tipo: 'sitio', url: ENV.PAGES_ORIGIN + '/' }
  },
  {
    nombre: 'Sin ROOT_DOMAIN configurado -> se reenvia sin reescribir',
    entrada: caso('ventadechicha.midominio.com', '/'),
    env: { PAGES_ORIGIN: ENV.PAGES_ORIGIN },
    espera: { tipo: 'pasar' }
  },
  {
    nombre: 'Sin PAGES_ORIGIN configurado -> se reenvia sin reescribir',
    entrada: caso('ventadechicha.midominio.com', '/'),
    env: { ROOT_DOMAIN: ENV.ROOT_DOMAIN },
    espera: { tipo: 'pasar' }
  },
  {
    nombre: 'PAGES_ORIGIN con barra final -> no genera doble barra',
    entrada: caso('midominio.com', '/'),
    env: { ROOT_DOMAIN: ENV.ROOT_DOMAIN, PAGES_ORIGIN: 'https://x.github.io/repo/' },
    espera: { tipo: 'sitio', url: 'https://x.github.io/repo/' }
  },
  {
    nombre: 'ROOT_DOMAIN con punto inicial -> se limpia',
    entrada: caso('ventadechicha.midominio.com', '/'),
    env: { ROOT_DOMAIN: '.midominio.com', PAGES_ORIGIN: ENV.PAGES_ORIGIN },
    espera: { tipo: 'curso', slug: 'ventadechicha' }
  },
  {
    nombre: 'Sitio de usuario de GitHub Pages (sin subcarpeta)',
    entrada: caso('ventadechicha.midominio.com', '/'),
    env: { ROOT_DOMAIN: ENV.ROOT_DOMAIN, PAGES_ORIGIN: 'https://usuario.github.io' },
    espera: { tipo: 'curso', slug: 'ventadechicha', url: 'https://usuario.github.io/curso.html?slug=ventadechicha' }
  }
];

/* ------------------------------------------------------------------ ejecucion */
let fallos = 0;

console.log('\n=== Pruebas del Worker de subdominios ===\n');

for (const c of casos) {
  const env = c.env || ENV;
  let r;
  try {
    r = decidirRuta(c.entrada, env);
  } catch (e) {
    fallos++;
    console.log(`  FALLO  ${c.nombre}`);
    console.log(`         -> lanzo una excepcion: ${e.message}`);
    continue;
  }

  const problemas = [];

  if (c.espera.tipo && r.tipo !== c.espera.tipo) {
    problemas.push(`tipo esperado=${c.espera.tipo} obtenido=${r.tipo}`);
  }
  if (c.espera.slug && r.slug !== c.espera.slug) {
    problemas.push(`slug esperado=${c.espera.slug} obtenido=${r.slug}`);
  }
  if (c.espera.url && r.url !== c.espera.url) {
    problemas.push(`url esperada=${c.espera.url}\n                    url obtenida=${r.url}`);
  }
  for (const trozo of (c.contiene || [])) {
    if (r.url.indexOf(trozo) === -1) problemas.push(`la url deberia contener "${trozo}" -> ${r.url}`);
  }
  for (const trozo of (c.noContiene || [])) {
    if (r.url.indexOf(trozo) !== -1) problemas.push(`la url NO deberia contener "${trozo}" -> ${r.url}`);
  }
  // Coherencia: nunca una url con doble barra tras el origen
  if (r.url && /https?:\/\/[^/]+\/\//.test(r.url)) {
    problemas.push(`url con doble barra: ${r.url}`);
  }

  if (problemas.length) {
    fallos++;
    console.log(`  FALLO  ${c.nombre}`);
    problemas.forEach(p => console.log(`         -> ${p}`));
  } else {
    const detalle = r.tipo === 'curso' ? `  ->  curso "${r.slug}"` : `  ->  ${r.tipo}`;
    console.log(`  OK     ${c.nombre}${detalle}`);
  }
}

console.log(`\n=== ${casos.length} casos, ${fallos} fallo(s) ===\n`);
process.exit(fallos ? 1 : 0);
