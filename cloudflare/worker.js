/**
 * ============================================================================
 *  APRENDO LMS — Cloudflare Worker: un subdominio por curso
 * ============================================================================
 *
 *  QUÉ PROBLEMA RESUELVE
 *  El prompt maestro pide que cada curso viva en su subdominio, del tipo
 *  ventadechicha.tudominio.com. Pero GitHub Pages admite UN SOLO dominio
 *  personalizado por repositorio: no se pueden apuntar veinte subdominios al
 *  mismo sitio, porque Pages valida la cabecera Host y redirige al dominio
 *  configurado.
 *
 *  Este Worker se interpone delante del sitio y traduce:
 *
 *      https://ventadechicha.tudominio.com/          ->  /curso.html?slug=ventadechicha
 *      https://ventadechicha.tudominio.com/assets/…  ->  /assets/…   (sin tocar)
 *      https://tudominio.com/                        ->  /           (el catálogo)
 *      https://www.tudominio.com/                    ->  /           (el catálogo)
 *
 *  DETALLE IMPORTANTE: solo se reescribe la RAÍZ del subdominio. El resto de
 *  rutas (CSS, JS, imágenes) se reenvían intactas. Si se reescribieran todas,
 *  el navegador pediría /assets/js/curso.js y recibiría el HTML del curso:
 *  la página se vería sin estilos y sin funcionar.
 *
 *  CÓMO SE DESPLIEGA
 *    cd cloudflare
 *    npx wrangler deploy
 *
 *  Antes hay que rellenar ROOT_DOMAIN y PAGES_ORIGIN en wrangler.toml.
 *
 *  OJO: si configuras un dominio personalizado en GitHub Pages, Pages
 *  redirigirá al visitante fuera del subdominio. Con este Worker, déjalo SIN
 *  dominio personalizado.
 *
 *  Las pruebas de la lógica de enrutado están en test-routing.mjs.
 */

/**
 * Decide a dónde va una petición. Es una función PURA a propósito: así se puede
 * probar sin desplegar nada ni simular el entorno de Cloudflare.
 *
 * @param {{hostname:string, pathname:string, search:string}} peticion
 * @param {{ROOT_DOMAIN?:string, PAGES_ORIGIN?:string}} env
 * @returns {{tipo:'curso'|'sitio'|'pasar', url:string, slug?:string, motivo:string}}
 */
export function decidirRuta(peticion, env) {
  const host = String(peticion.hostname || '').toLowerCase();
  const ruta = peticion.pathname || '/';
  const query = peticion.search || '';

  const raiz = String((env && env.ROOT_DOMAIN) || '')
    .trim().toLowerCase().replace(/^\.+/, '').replace(/\.+$/, '');
  const origen = String((env && env.PAGES_ORIGIN) || '').trim().replace(/\/+$/, '');

  // Sin configurar no se puede decidir nada: se reenvía tal cual y el Worker
  // se comporta como un simple proxy.
  if (!raiz || !origen) {
    return {
      tipo: 'pasar',
      url: origen + ruta + query,
      motivo: 'Falta ROOT_DOMAIN o PAGES_ORIGIN: se reenvia sin reescribir.'
    };
  }

  const esSubdominio = host !== raiz && host.endsWith('.' + raiz);

  if (esSubdominio) {
    const sub = host.slice(0, host.length - raiz.length - 1);

    // www no es un curso: es el sitio principal.
    if (sub === 'www') {
      return { tipo: 'sitio', url: origen + ruta + query, motivo: 'www es el sitio principal.' };
    }

    // Un subdominio con varios niveles (a.b.dominio.com) no es el subdominio de
    // un curso: los slugs son de una sola etiqueta. Se sirve el sitio normal.
    if (sub.indexOf('.') !== -1 || sub === '') {
      return {
        tipo: 'pasar',
        url: origen + ruta + query,
        motivo: 'Subdominio de varios niveles: no es el subdominio de un curso.'
      };
    }

    // Solo la raíz del subdominio se convierte en la página del curso.
    if (ruta === '/' || ruta === '/index.html') {
      // Se conservan los parametros de la URL original (por ejemplo ?utm_source=…)
      // menos slug y curso, que los decide el subdominio.
      const params = new URLSearchParams(query);
      params.delete('slug');
      params.delete('curso');
      params.set('slug', sub);
      return {
        tipo: 'curso',
        slug: sub,
        url: origen + '/curso.html?' + params.toString(),
        motivo: 'Raiz del subdominio: se sirve la pagina del curso.'
      };
    }

    // Todo lo demas (assets, fuentes, imagenes) viaja intacto.
    return {
      tipo: 'pasar',
      url: origen + ruta + query,
      motivo: 'Recurso del subdominio: se reenvia sin reescribir.'
    };
  }

  // Dominio raiz (o cualquier otro host que apunte aqui): el sitio normal.
  return { tipo: 'sitio', url: origen + ruta + query, motivo: 'Dominio principal.' };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    const decision = decidirRuta(
      { hostname: url.hostname, pathname: url.pathname, search: url.search },
      env
    );

    if (!env || !env.PAGES_ORIGIN) {
      return new Response(
        'Falta configurar PAGES_ORIGIN en el Worker.\n' +
        'Edita cloudflare/wrangler.toml y vuelve a desplegar.\n',
        { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } }
      );
    }

    let destino;
    try {
      destino = new URL(decision.url);
    } catch (e) {
      return new Response('PAGES_ORIGIN no es una URL valida: ' + env.PAGES_ORIGIN + '\n',
        { status: 500, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    // Se construye una peticion nueva con el mismo metodo y cabeceras, pero con
    // el destino ya resuelto. Asi el Host que ve GitHub Pages es el suyo y no
    // el subdominio del curso.
    const reenviada = new Request(destino.toString(), request);

    const respuesta = await fetch(reenviada);

    // Cabeceras utiles para depurar desde el navegador.
    const salida = new Response(respuesta.body, respuesta);
    salida.headers.set('x-aprendo-tipo', decision.tipo);
    if (decision.slug) salida.headers.set('x-aprendo-curso', decision.slug);
    return salida;
  }
};
