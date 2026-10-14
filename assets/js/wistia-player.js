/* ============================================================================
   APRENDO LMS — Capa de abstracción de Wistia
   ============================================================================
   POR QUÉ EXISTE ESTE ARCHIVO
   Wistia tiene dos generaciones de reproductor y, desgraciadamente, NO comparten
   la misma API:

     AURORA (el actual, lo que recibe una cuenta nueva)
       <wistia-player media-id="...">
       Evento:  'percent-watched-change'   ->  event.detail.percent (decimal 0..1)
       API:     addEventListener / player.percentWatched, player.secondsWatched

     VULCAN / E-v1 (el legacy)
       <div class="wistia_embed wistia_async_ID">
       Evento:  'percentwatchedchanged'    ->  (percent, lastPercent)  (0..100)
       API:     window._wq.push({ id, onReady: function (video) { video.bind(...) } })

   El prompt maestro pide 'percentwatchedchanged', que es la API ANTIGUA. Una
   cuenta de Wistia recién creada entrega AURORA. Si solo implementáramos el
   nombre antiguo, el desbloqueo secuencial no funcionaría nunca.

   Este módulo detecta el formato del embed que pegas en el panel, monta el
   reproductor correcto y expone SIEMPRE la misma interfaz:

       onProgreso(porcentaje)   // número 0..100, monótono (nunca baja)
       onFin()

   Además del evento oficial, sondeamos `secondsWatched` (segundos ÚNICOS, que
   excluyen lo saltado con la barra) y usamos el MAYOR de los dos. Así el alumno
   no puede desbloquear la lección 2 arrastrando la barra hasta el final.
   ============================================================================ */
(function () {
  'use strict';

  var ID_RE = /\b([a-z0-9]{10})\b/;   // los hashed_id de Wistia son 10 caracteres

  var cargados = {};   // url -> Promise, para no inyectar dos veces el mismo script

  /* ------------------------------------------------------------ carga de scripts */
  function cargarScript(url, esModulo) {
    if (cargados[url]) return cargados[url];
    cargados[url] = new Promise(function (resolve, reject) {
      // Si ya está en el DOM, no lo duplicamos
      var existente = document.querySelector('script[src="' + url + '"]');
      if (existente) {
        if (existente.dataset.cargado === '1') return resolve();
        existente.addEventListener('load', function () { resolve(); });
        existente.addEventListener('error', function () { reject(new Error('No se pudo cargar ' + url)); });
        return;
      }
      var s = document.createElement('script');
      s.src = url;
      s.async = true;
      if (esModulo) s.type = 'module';
      s.addEventListener('load', function () { s.dataset.cargado = '1'; resolve(); });
      s.addEventListener('error', function () { reject(new Error('No se pudo cargar ' + url)); });
      document.head.appendChild(s);
    });
    return cargados[url];
  }

  /* ------------------------------------------------------------ parseo del embed */
  /**
   * Acepta cualquiera de los formatos que Wistia entrega y devuelve un objeto
   * normalizado. Es tolerante: si pegas el embed de Aurora, el de E-v1, un
   * iframe, o incluso solo el ID, funciona.
   */
  function parsearEmbed(codigo) {
    var res = { ok: false, motor: 'aurora', mediaId: null, error: null, advertencias: [] };
    if (!codigo || !String(codigo).trim()) {
      res.error = 'El código embed está vacío.';
      return res;
    }
    var c = String(codigo).trim();

    // ---- 1. Detectar el motor ----
    if (/E-v1\.js/i.test(c) || /wistia_async_/i.test(c) || /embed\/medias\//i.test(c)) {
      res.motor = 'legacy';
    } else if (/wistia-player|player\.js|web_component/i.test(c)) {
      res.motor = 'aurora';
    }
    if (/<iframe/i.test(c)) {
      res.advertencias.push(
        'Pegaste un embed de iframe. El proyecto usa el embed estándar (async), ' +
        'como pide el prompt: se ha convertido automáticamente al formato correcto.'
      );
    }

    // ---- 2. Extraer el media-id, probando los patrones conocidos ----
    var patrones = [
      /media-id\s*=\s*["']([a-z0-9]{10})["']/i,          // <wistia-player media-id="...">
      /fast\.wistia\.com\/embed\/medias\/([a-z0-9]{10})/i, // jsonp legacy
      /wistia_async_([a-z0-9]{10})/i,                      // clase legacy
      /fast\.wistia\.(?:com|net)\/embed\/iframe\/([a-z0-9]{10})/i,
      /fast\.wistia\.com\/embed\/([a-z0-9]{10})\.js/i,     // módulo de Aurora
      /fast\.wistia\.com\/medias\/([a-z0-9]{10})/i,
      /data-media-id\s*=\s*["']([a-z0-9]{10})["']/i
    ];
    for (var i = 0; i < patrones.length; i++) {
      var m = c.match(patrones[i]);
      if (m) { res.mediaId = m[1].toLowerCase(); break; }
    }

    // ---- 3. Si no hay etiquetas, aceptar un ID suelto ----
    if (!res.mediaId) {
      var solo = c.match(/^([a-z0-9]{10})$/i);
      if (solo) {
        res.mediaId = solo[1].toLowerCase();
      } else {
        var libre = c.match(ID_RE);
        if (libre && !/[<>{}]/.test(c)) res.mediaId = libre[1].toLowerCase();
      }
    }

    if (!res.mediaId) {
      res.error = 'No se pudo encontrar el ID del video en el código. ' +
                  'Pega el embed completo de Wistia, o escribe directamente el ID (10 caracteres).';
      return res;
    }
    if (!/^[a-z0-9]{10}$/.test(res.mediaId)) {
      res.error = 'El ID detectado ("' + res.mediaId + '") no tiene el formato de Wistia (10 letras o números).';
      return res;
    }

    res.ok = true;
    return res;
  }

  /* ------------------------------------------------------------ montaje: AURORA */
  function montarAurora(contenedor, mediaId, opciones) {
    var color = (opciones.color || 'FF6B00').replace('#', '');
    var radio = opciones.radio == null ? 12 : opciones.radio;

    // Precarga visual mientras el componente se define (evita el salto de layout)
    contenedor.innerHTML =
      '<wistia-player media-id="' + mediaId + '"></wistia-player>' +
      '<style>wistia-player[media-id="' + mediaId + '"]:not(:defined){' +
      'background:center/contain no-repeat url(https://fast.wistia.com/embed/medias/' + mediaId + '/swatch);' +
      'display:block;filter:blur(6px);padding-top:56.25%;}</style>';

    var el = contenedor.querySelector('wistia-player');
    el.setAttribute('player-color', color);
    el.setAttribute('rounded-player', String(radio));
    el.setAttribute('seo', 'false');

    return cargarScript('https://fast.wistia.com/player.js', false)
      .then(function () {
        // El script por-media aporta metadatos y SEO; si falla, el reproductor
        // sigue funcionando porque player.js ya define el componente.
        return cargarScript('https://fast.wistia.com/embed/' + mediaId + '.js', true)
          .catch(function () { return null; });
      })
      .then(function () {
        return new Promise(function (resolve) {
          var terminado = false;
          function listo() {
            if (terminado) return;
            terminado = true;
            resolve({ motor: 'aurora', el: el, mediaId: mediaId });
          }
          el.addEventListener('api-ready', listo);
          // Respaldo por si api-ready ya se disparó o nunca llega
          setTimeout(listo, 4000);
        });
      })
      .then(function (handle) {
        conectarAurora(el, opciones);
        if (opciones.onListo) opciones.onListo(handle);
        return handle;
      });
  }

  function conectarAurora(el, opciones) {
    var maximo = 0;

    function publicar(pct, motivo) {
      pct = Math.max(0, Math.min(100, pct));
      if (pct > maximo) {              // monótono: el progreso nunca retrocede
        maximo = pct;
        try { opciones.onProgreso(maximo, motivo); } catch (e) { console.error(e); }
      }
    }

    // --- Medida oficial: el evento que pide el prompt, en su nombre de Aurora ---
    el.addEventListener('percent-watched-change', function (ev) {
      var d = (ev && ev.detail) || {};
      var dec = (typeof d.percent === 'number') ? d.percent
              : (typeof el.percentWatched === 'number' ? el.percentWatched : 0);
      publicar(dec * 100, 'percent-watched-change');
    });

    // --- Medida robusta: segundos ÚNICOS (excluye lo saltado con la barra) ---
    el.addEventListener('second-change', function () {
      try {
        var dur = Math.floor(el.duration || 0);
        if (dur > 0 && typeof el.secondsWatched === 'number') {
          publicar((el.secondsWatched / dur) * 100, 'secondsWatched');
        }
      } catch (e) { /* el reproductor aún no expone duration */ }
    });

    el.addEventListener('ended', function () {
      publicar(100, 'ended');
      if (opciones.onFin) { try { opciones.onFin(); } catch (e) { console.error(e); } }
    });

    if (opciones.onListo) { /* ya se llamó en montarAurora */ }
  }

  /* ------------------------------------------------------------ montaje: E-v1 */
  function montarLegacy(contenedor, mediaId, opciones) {
    contenedor.innerHTML =
      '<div class="wistia_embed wistia_async_' + mediaId + ' seo=false videoFoam=true" ' +
      'style="width:100%;height:100%"></div>';

    return cargarScript('https://fast.wistia.com/assets/external/E-v1.js', false)
      .then(function () {
        return new Promise(function (resolve) {
          window._wq = window._wq || [];
          var terminado = false;
          window._wq.push({
            id: mediaId,
            onReady: function (video) {
              if (terminado) return;
              terminado = true;

              var maximo = 0;
              function publicar(pct, motivo) {
                pct = Math.max(0, Math.min(100, pct));
                if (pct > maximo) {
                  maximo = pct;
                  try { opciones.onProgreso(maximo, motivo); } catch (e) { console.error(e); }
                }
              }

              // El nombre LEGACY que pide el prompt: percentwatchedchanged (0..100)
              video.bind('percentwatchedchanged', function (pct) {
                publicar(Number(pct) || 0, 'percentwatchedchanged');
              });

              // Respaldo con segundos únicos
              video.bind('secondchange', function () {
                try {
                  var dur = Math.floor(video.duration() || 0);
                  if (dur > 0 && typeof video.secondsWatched === 'function') {
                    publicar((video.secondsWatched() / dur) * 100, 'secondsWatched');
                  }
                } catch (e) { /* aún sin duración */ }
              });

              function fin() {
                publicar(100, 'end');
                if (opciones.onFin) { try { opciones.onFin(); } catch (e) { console.error(e); } }
              }
              video.bind('end', fin);
              video.bind('ended', fin);   // por compatibilidad entre versiones

              resolve({ motor: 'legacy', video: video, mediaId: mediaId });
            }
          });
          setTimeout(function () {
            if (!terminado) { terminado = true; resolve({ motor: 'legacy', video: null, mediaId: mediaId }); }
          }, 8000);
        });
      })
      .then(function (handle) {
        if (opciones.onListo) opciones.onListo(handle);
        return handle;
      });
  }

  /* ------------------------------------------------------------ API pública */
  function montar(contenedor, codigo, opciones) {
    opciones = opciones || {};
    if (!contenedor) return Promise.reject(new Error('Falta el contenedor del video.'));

    var info = parsearEmbed(codigo);
    if (!info.ok) return Promise.reject(new Error(info.error));

    contenedor.innerHTML = '';
    var promesa = (info.motor === 'legacy')
      ? montarLegacy(contenedor, info.mediaId, opciones)
      : montarAurora(contenedor, info.mediaId, opciones);

    return promesa.then(function (handle) {
      handle.advertencias = info.advertencias;
      handle.parseo = info;
      return handle;
    });
  }

  window.WistiaLMS = {
    parsearEmbed: parsearEmbed,
    montar: montar
  };
})();
