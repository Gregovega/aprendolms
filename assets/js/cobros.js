/* ============================================================================
   COBROS — pantalla de verificación de pagos
   ----------------------------------------------------------------------------
   Pensada para dejarla abierta en el teléfono: consulta cada pocos segundos y
   avisa con una campanita cuando entra un pago nuevo.

   El dinero es manual: aquí no se cobra nada automáticamente. El administrador
   mira la captura, comprueba en su banco que el pago entró, y aprueba o rechaza.

   Aprobar y rechazar NO se hacen desde aquí directamente: se llaman las funciones
   aprobar_pago / rechazar_pago del servidor, que son las únicas que pueden abrir
   el curso. Así, aunque alguien manipule esta página, no puede aprobarse nada.
   ============================================================================ */
(function () {
  'use strict';
  var A = window.APRENDO;

  // Si falta la configuracion de Supabase, supabase-client.js no llega a definir
  // window.APRENDO y ya muestra su propio aviso en la pagina. Sin esta guarda,
  // cualquier llamada aqui fallaria con un "Cannot read properties of undefined"
  // que no explica nada.
  if (!A) return;
  /* Cada cuánto se pregunta si entraron pagos nuevos. 20 s es un buen equilibrio:
     se entera uno casi al momento sin castigar el teléfono ni la base de datos. */
  var SEGUNDOS_ENTRE_CONSULTAS = 20;

  var estado = {
    pagos: [],
    filtro: 'pendiente',
    sonidoActivo: false,
    ultimoConteoPendientes: null,
    temporizador: null,
    ocupado: false
  };

  function h(s) { return A.escaparHtml(s); }
  function $(id) { return document.getElementById(id); }

  function fecha(iso) {
    try { return A.formatearFecha(iso, { fecha: true, hora: true }); }
    catch (e) { return String(iso || ''); }
  }

  function dinero(monto, moneda) {
    if (monto === null || monto === undefined || monto === '') return '—';
    var n = Number(monto);
    var num = isFinite(n)
      ? (Math.round(n * 100) / 100).toLocaleString('es-VE', { maximumFractionDigits: 2 })
      : String(monto);
    return num + ' ' + (moneda || '');
  }

  /* ------------------------------------------------------------------ sonido */

  var ctxAudio = null;

  /**
   * Los navegadores no dejan sonar nada hasta que la persona toca la página.
   * Por eso el aviso se activa con un botón, y ese mismo toque es el permiso.
   */
  function activarSonido() {
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      A.aviso('Este navegador no sabe reproducir el aviso sonoro. El contador de pendientes sí funciona.', 'warn');
      return false;
    }
    try {
      if (!ctxAudio) ctxAudio = new Ctor();
      if (ctxAudio.state === 'suspended') ctxAudio.resume();
      estado.sonidoActivo = true;
      return true;
    } catch (e) {
      A.aviso('No se pudo activar el sonido: ' + A.traducirError(e), 'warn');
      return false;
    }
  }

  /**
   * Campanita: tres notas cortas generadas al vuelo. No hace falta ningún archivo
   * de audio, así que funciona aunque el teléfono esté sin datos.
   */
  function campana() {
    if (!estado.sonidoActivo || !ctxAudio) return;
    if (ctxAudio.state === 'suspended') { try { ctxAudio.resume(); } catch (e) { /* sigue mudo */ } }

    var notas = [1046.5, 1318.5, 1568.0];   // do, mi, sol agudos: suena a aviso, no a alarma
    notas.forEach(function (frec, i) {
      var t = ctxAudio.currentTime + i * 0.16;
      var osc = ctxAudio.createOscillator();
      var vol = ctxAudio.createGain();
      osc.type = 'sine';
      osc.frequency.value = frec;
      // Ataque rapidísimo y caída suave: eso es lo que lo hace sonar a campana.
      vol.gain.setValueAtTime(0.0001, t);
      vol.gain.exponentialRampToValueAtTime(0.28, t + 0.015);
      vol.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
      osc.connect(vol);
      vol.connect(ctxAudio.destination);
      osc.start(t);
      osc.stop(t + 0.5);
    });
  }

  /** El título de la pestaña lleva el número de pendientes: se ve de un vistazo. */
  function pintarTitulo() {
    var n = estado.pagos.filter(function (p) { return p.estado === 'pendiente'; }).length;
    document.title = (n > 0 ? '(' + n + ') ' : '') + 'Cobros · Aprendo LMS';
  }

  /* ----------------------------------------------------------------- pintado */

  function etiquetaEstado(p) {
    if (p.estado === 'aprobado') return '<span class="badge badge-ok"><span class="badge-dot"></span>Aprobado</span>';
    if (p.estado === 'rechazado') return '<span class="badge badge-danger">Rechazado</span>';
    return '<span class="badge badge-warn"><span class="badge-dot"></span>Pendiente</span>';
  }

  function bloqueDuplicado(p) {
    if (!p.duplicado_de) return '';
    var d = p.duplicado || null;
    var donde = d && d.cursos ? d.cursos.nombre : null;

    return '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
      '<strong>Referencia repetida.</strong> Esta misma referencia ya se envió antes' +
      (donde ? ' para el curso <strong>' + h(donde) + '</strong>' : '') +
      (d && d.creado_en ? ' el <strong>' + h(fecha(d.creado_en)) + '</strong>' : '') +
      (d && d.estado ? ' (aquel pago quedó ' + h(d.estado) + ')' : '') +
      '.<br>Comprueba en tu banco antes de aceptarla: puede ser un pago ya usado.' +
      '</div></div>';
  }

  function tarjeta(p) {
    var alumno = p.perfiles ? (p.perfiles.nombre_completo || p.perfiles.email) : 'Alumno desconocido';
    var correo = p.perfiles ? p.perfiles.email : '';
    var curso = p.cursos ? p.cursos.nombre : 'Curso borrado';
    var pendiente = p.estado === 'pendiente';

    var acciones = '';
    if (pendiente) {
      acciones =
        '<div class="row mt-4">' +
        '<button class="btn btn-primary" type="button" data-accion="aprobar" data-id="' + h(p.id) + '">' +
        '&#10004; Aprobar y abrir el curso</button>' +
        '<button class="btn btn-danger" type="button" data-accion="rechazar" data-id="' + h(p.id) + '">' +
        'Rechazar</button>' +
        '</div>';
    } else if (p.motivo) {
      acciones = '<p class="text-sm mt-4 mb-0"><strong>Motivo enviado:</strong> ' + h(p.motivo) + '</p>';
    }

    return '<article class="card' + (pendiente ? ' card-hover' : '') + '" data-pago="' + h(p.id) + '">' +
      '<div class="row-between mb-4">' +
        '<div>' +
          etiquetaEstado(p) +
          ' <span class="text-faint text-xs">' + h(fecha(p.creado_en)) + '</span>' +
        '</div>' +
        '<div class="course-precio">' + h(dinero(p.monto, p.moneda)) + '</div>' +
      '</div>' +

      '<h3 class="card-title mb-2">' + h(curso) + '</h3>' +
      '<p class="text-sm mb-2"><strong>' + h(alumno) + '</strong>' +
        (correo && correo !== alumno ? ' · <span class="text-muted">' + h(correo) + '</span>' : '') + '</p>' +
      '<p class="text-sm mb-0 text-muted">' +
        'Método: ' + h(p.metodo_etiqueta || '—') +
        ' &nbsp;·&nbsp; Referencia: <code>' + h(p.referencia) + '</code>' +
      '</p>' +

      bloqueDuplicado(p) +

      (p.captura_url
        ? '<div class="mt-4"><button class="btn btn-ghost btn-sm" type="button" ' +
          'data-accion="ver-captura" data-id="' + h(p.id) + '">&#128247; Ver el comprobante</button></div>'
        : '<p class="text-faint text-xs mt-4 mb-0">Sin comprobante adjunto.</p>') +

      acciones +
      '</article>';
  }

  function pintar() {
    var zona = $('zona-pagos');
    var lista = estado.pagos;

    if (estado.filtro === 'pendiente') {
      lista = lista.filter(function (p) { return p.estado === 'pendiente'; });
    } else if (estado.filtro === 'duplicado') {
      lista = lista.filter(function (p) { return !!p.duplicado_de; });
    }

    if (!lista.length) {
      var que = estado.filtro === 'pendiente' ? 'pagos pendientes'
              : (estado.filtro === 'duplicado' ? 'referencias repetidas' : 'pagos');
      zona.innerHTML =
        '<div class="card empty-state">' +
        '<div class="empty-state-icon">&#9989;</div>' +
        '<h3>No hay ' + que + '</h3>' +
        '<p class="text-muted">' +
        (estado.filtro === 'pendiente'
          ? 'Todo revisado. Esta pantalla se actualiza sola cada ' + SEGUNDOS_ENTRE_CONSULTAS + ' segundos.'
          : 'Todavía no hay nada que mostrar aquí.') +
        '</p></div>';
      return;
    }

    zona.innerHTML = lista.map(tarjeta).join('');
  }

  function pintarResumen() {
    var c = { pendiente: 0, aprobado: 0, rechazado: 0 };
    estado.pagos.forEach(function (p) { if (c[p.estado] !== undefined) c[p.estado]++; });
    $('stat-pendientes').textContent = c.pendiente;
    $('stat-aprobados').textContent = c.aprobado;
    $('stat-rechazados').textContent = c.rechazado;
    pintarTitulo();
  }

  /* ------------------------------------------------------------------ carga */

  async function cargar(opciones) {
    opciones = opciones || {};
    if (estado.ocupado) return;
    estado.ocupado = true;
    try {
      var pagos = await A.db.pagos(200);
      var pendientesAntes = estado.ultimoConteoPendientes;
      var pendientesAhora = pagos.filter(function (p) { return p.estado === 'pendiente'; }).length;

      estado.pagos = pagos;
      pintarResumen();
      pintar();

      // Avisar solo cuando el número SUBE: si no, sonaría en cada consulta.
      if (pendientesAntes !== null && pendientesAhora > pendientesAntes) {
        campana();
        var nuevos = pendientesAhora - pendientesAntes;
        A.aviso(nuevos === 1 ? '¡Llegó un pago nuevo!' : '¡Llegaron ' + nuevos + ' pagos nuevos!', 'ok', 7000);
      }
      estado.ultimoConteoPendientes = pendientesAhora;

      if (!opciones.silencioso) {
        $('aviso-actualizado').textContent = 'Actualizado a las ' +
          new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }
    } catch (e) {
      if (!opciones.silencioso) A.aviso('No se pudieron cargar los cobros: ' + A.traducirError(e), 'error');
    } finally {
      estado.ocupado = false;
    }
  }

  /* --------------------------------------------------------------- acciones */

  async function aprobar(pago) {
    var alumno = pago.perfiles ? (pago.perfiles.nombre_completo || pago.perfiles.email) : 'el alumno';
    var curso = pago.cursos ? pago.cursos.nombre : 'el curso';
    if (!window.confirm(
      '¿Ya comprobaste en tu banco que entró el pago de ' + dinero(pago.monto, pago.moneda) + '?\n\n' +
      'Al aprobar se le abre «' + curso + '» a ' + alumno + '.')) return;

    A.cargando(true, 'Aprobando…');
    try {
      await A.db.aprobarPago(pago.id, 'Verificado por el administrador.');
      A.aviso('Pago aprobado. Se le abrió el curso a ' + alumno + '.', 'ok');
      await cargar({ silencioso: true });
    } catch (e) {
      A.aviso('No se pudo aprobar: ' + A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  async function rechazar(pago) {
    var d = pago.duplicado || null;
    var donde = d && d.cursos ? d.cursos.nombre : null;

    // Se propone el motivo ya escrito cuando la referencia está repetida: es el
    // caso más común y así el alumno recibe una explicación clara enseguida.
    var sugerido = pago.duplicado_de
      ? 'Pago duplicado: esa referencia ya se usó' + (donde ? ' en el curso «' + donde + '»' : '') +
        (d && d.creado_en ? ' el ' + fecha(d.creado_en) : '') + '.'
      : '';

    var motivo = window.prompt(
      '¿Por qué se rechaza? El alumno va a leer este texto tal cual.\n\n' +
      'Ejemplo: «No encontramos tu pago con esa referencia. Revísala y vuelve a enviarla.»',
      sugerido);

    if (motivo === null) return;                    // canceló
    motivo = String(motivo).trim();
    if (!motivo) { A.aviso('Hay que escribir un motivo: el alumno lo va a leer.', 'warn'); return; }

    A.cargando(true, 'Rechazando…');
    try {
      await A.db.rechazarPago(pago.id, motivo);
      A.aviso('Pago rechazado.', 'ok');
      await cargar({ silencioso: true });
    } catch (e) {
      A.aviso('No se pudo rechazar: ' + A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  async function verCaptura(pago) {
    A.cargando(true, 'Abriendo el comprobante…');
    try {
      var url = pago.captura_url;
      // El cubo es privado: hay que pedir un enlace temporal para poder verlo.
      if (url && url.indexOf('http') !== 0) url = await A.db.urlCaptura(pago.captura_url, 600);
      if (!url) { A.aviso('Ese pago no tiene comprobante.', 'warn'); return; }
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      A.aviso('No se pudo abrir el comprobante: ' + A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  /* ------------------------------------------------------------------ avisos */

  /**
   * Enciende o apaga los avisos de ESTE teléfono.
   *
   * Son dos cosas a la vez, y a propósito: el sonido (inmediato, mientras la
   * pantalla está abierta) y la notificación del sistema (llega aunque esté
   * cerrada). Un solo toque sirve para las dos porque los navegadores exigen un
   * gesto real tanto para permitir notificaciones como para dejar sonar audio.
   *
   * Si el navegador no admite notificaciones, el sonido se activa igual: nunca
   * se queda uno sin ninguna forma de enterarse de que entró dinero.
   */
  async function alternarAvisos() {
    if (estado.sonidoActivo) {
      estado.sonidoActivo = false;
      if (window.Avisos && window.Avisos.soportado()) {
        try { await window.Avisos.desactivar(); } catch (e) { /* no es grave */ }
      }
      await pintarEstadoAvisos();
      A.aviso('Avisos apagados en este teléfono. El contador de pendientes sigue funcionando.', 'warn');
      return;
    }

    // 1) El sonido primero: es lo único que funciona con seguridad.
    var sono = activarSonido();
    if (sono) campana();   // suena una vez, para que sepas cómo se oye

    // 2) Y la notificación del sistema, si el navegador la admite.
    var nota = '';
    if (window.Avisos && window.Avisos.soportado()) {
      try {
        await window.Avisos.activar();
        nota = ' También llegarán al teléfono aunque cierres la página.';
      } catch (e) {
        nota = ' (Los avisos del teléfono no se pudieron activar: ' + A.traducirError(e) + ')';
      }
    } else {
      nota = ' Este navegador no admite avisos del sistema: deja la pantalla abierta para oír el sonido.';
    }

    await pintarEstadoAvisos();
    if (sono) A.aviso('Avisos activados.' + nota, 'ok', 11000);
  }

  /** Línea de estado bajo la cabecera: qué está activo en este teléfono. */
  async function pintarEstadoAvisos() {
    var z = $('estado-avisos');
    var b = $('btn-sonido');
    if (!z || !b) return;

    var e = (window.Avisos && window.Avisos.soportado())
      ? await window.Avisos.estado()
      : 'no-soportado';

    var n = (window.Avisos && window.Avisos.cuantos) ? await window.Avisos.cuantos() : null;
    var cuales = (n === null || n === undefined) ? ''
      : ' Hay ' + n + (n === 1 ? ' teléfono suscrito' : ' teléfonos suscritos') + '.';

    var textos = {
      'no-soportado': 'Este navegador no admite avisos del sistema. El sonido funciona con la pantalla abierta.',
      'sin-clave': 'Falta configurar la clave de los avisos.',
      'permiso-no': 'Bloqueaste las notificaciones de este sitio. Actívalas en los ajustes del navegador.',
      'apagado': 'Los avisos del teléfono están apagados en este dispositivo. Pulsa «Activar avisos».' + cuales,
      'encendido': 'Este teléfono avisará cada vez que entre un pago, aunque cierres la página.' + cuales
    };
    z.textContent = textos[e] || '';

    var encendido = estado.sonidoActivo || e === 'encendido';
    b.className = 'btn ' + (encendido ? 'btn-primary' : 'btn-secondary');
    b.setAttribute('aria-pressed', encendido ? 'true' : 'false');
    b.innerHTML = encendido ? '&#128276; Avisos activados' : '&#128276; Activar avisos';
  }

  /* ------------------------------------------------------------------ eventos */

  function conectar() {
    $('zona-pagos').addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-accion]') : null;
      if (!b) return;
      var id = b.getAttribute('data-id');
      var pago = estado.pagos.filter(function (p) { return p.id === id; })[0];
      if (!pago) return;
      var accion = b.getAttribute('data-accion');
      if (accion === 'aprobar') aprobar(pago);
      else if (accion === 'rechazar') rechazar(pago);
      else if (accion === 'ver-captura') verCaptura(pago);
    });

    var filtros = ['filtro-pendientes', 'filtro-duplicados', 'filtro-todos'];
    filtros.forEach(function (id) {
      var b = $(id);
      if (!b) return;
      b.addEventListener('click', function () {
        estado.filtro = b.getAttribute('data-filtro');
        filtros.forEach(function (otro) {
          var el = $(otro);
          if (!el) return;
          var activo = el === b;
          el.className = 'btn ' + (activo ? 'btn-primary' : 'btn-ghost');
          el.setAttribute('aria-selected', activo ? 'true' : 'false');
        });
        pintar();
      });
    });

    $('btn-sonido').addEventListener('click', alternarAvisos);

    $('btn-mis-datos').addEventListener('click', function () {
      window.MetodosPago.abrirDrawer({
        onCambio: function () { cargar({ silencioso: true }); }
      });
    });

    // Al volver a la pestaña se consulta al momento, sin esperar al temporizador.
    // En el teléfono esto es lo normal: la pestaña queda dormida un rato.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) cargar({ silencioso: false });
    });

    $('zona-pagos').addEventListener('click', function (e) {
      // Segundo escuchador a propósito: reinicia el temporizador en cuanto el
      // administrador toca algo, para que la siguiente consulta no caiga encima.
      reiniciarTemporizador();
    });
  }

  function reiniciarTemporizador() {
    if (estado.temporizador) clearInterval(estado.temporizador);
    estado.temporizador = setInterval(function () {
      if (!document.hidden) cargar({ silencioso: true });
    }, SEGUNDOS_ENTRE_CONSULTAS * 1000);
  }

  /* ------------------------------------------------------------------ arranque */

  (async function arrancar() {
    await window.UI.iniciar('cobros');
    var sesion = await window.UI.exigirAdmin();
    if (!sesion) return;

    conectar();
    await pintarEstadoAvisos();
    await cargar({ silencioso: false });
    reiniciarTemporizador();
  })();

})();
