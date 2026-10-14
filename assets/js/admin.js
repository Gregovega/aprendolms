/* ============================================================================
   APRENDO LMS — Panel de administración (admin.html)
   Requiere, en este orden:
     1. assets/js/config.js
     2. el UMD de supabase-js
     3. assets/js/supabase-client.js   (window.APRENDO)
     4. assets/js/ui.js                (window.UI)
     5. assets/js/wistia-player.js     (window.WistiaLMS)
   ============================================================================
   DECISIONES DE DISEÑO (por qué está así)

   · TODO el acceso a datos pasa por APRENDO.db.*, para no duplicar consultas.
     Los contadores de las estadísticas (nº de lecciones e inscritos) se calculan
     con db.lecciones() / db.listarInscritos() porque db no expone agregados.

   · El editor de preguntas vive en memoria y se guarda ENTERO con
     db.borrarPreguntasDeCurso() + db.crearPreguntas(). Es el único camino que
     dan los métodos disponibles, y permite revisar/editar antes de publicar.
     Si el insert falla, el editor conserva las preguntas para reintentar: se
     avisa de forma explícita de que la tabla se quedó vacía.

   · Las lecciones se guardan de una en una (cada tarjeta tiene su botón). La
     tabla tiene unique(curso_id, orden), así que el orden se valida en local y
     el error de duplicado se traduce a un mensaje entendible.

   · La generación de preguntas con IA NO lleva ninguna clave en el navegador
     (sería un fallo de seguridad). Si APRENDO.cfg.AI_ENDPOINT está definido se
     usa; si no —o si falla— el panel entrega la instrucción lista para pegar en
     la IA del administrador y VALIDA el JSON que devuelva. Nunca se inventan
     preguntas desde el código.

   · Solo hay una vista previa de Wistia montada a la vez: montar un reproductor
     por lección cargaría decenas de reproductores sin necesidad.
   ============================================================================ */
(function () {
  'use strict';

  var A = window.APRENDO || null;   // se reasigna en el arranque, por seguridad

  /* ------------------------------------------------------------------ estado */
  var estado = {
    tab: 'cursos',
    cursos: [],
    ajustes: null,
    leccionesPorCurso: {},   // curso_id -> nº de lecciones (o null si falló)
    inscritosPorCurso: {},   // curso_id -> nº de inscripciones (o null si falló)
    cursoActual: null,       // curso abierto en el drawer "Lecciones y examen"
    lecciones: [],           // lecciones del curso actual (borradores incluidos)
    preguntas: [],           // preguntas del curso actual, en memoria
    preguntasSucias: false
  };

  var capas = [];            // pila de drawers/modales abiertos (el último arriba)
  var previewActiva = null;  // índice de la lección con la vista previa de Wistia

  /* ------------------------------------------------------------- utilidades */
  function h(s) { return A.escaparHtml(s); }

  function texto(v) { return v === null || v === undefined ? '' : String(v); }

  function esArray(v) { return Object.prototype.toString.call(v) === '[object Array]'; }

  /** Número con dos decimales para mostrar precios. */
  function formatearPrecio(v) {
    var n = Number(v);
    if (!isFinite(n)) return texto(v);
    return n.toFixed(2);
  }

  function precioValor(curso) {
    if (!curso || curso.precio === null || curso.precio === undefined || curso.precio === '') return '';
    var n = Number(curso.precio);
    return isFinite(n) ? String(n) : '';
  }

  /* ------------------------------------------------------------ slug y URLs */
  var ACENTOS = {
    'á': 'a', 'à': 'a', 'ä': 'a', 'â': 'a', 'ã': 'a', 'å': 'a',
    'é': 'e', 'è': 'e', 'ë': 'e', 'ê': 'e',
    'í': 'i', 'ì': 'i', 'ï': 'i', 'î': 'i',
    'ó': 'o', 'ò': 'o', 'ö': 'o', 'ô': 'o', 'õ': 'o',
    'ú': 'u', 'ù': 'u', 'ü': 'u', 'û': 'u',
    'ñ': 'n', 'ç': 'c'
  };

  function sinAcentos(s) {
    return texto(s).toLowerCase().replace(/[áàäâãåéèëêíìïîóòöôõúùüûñç]/g, function (ch) {
      return ACENTOS[ch] || ch;
    });
  }

  /**
   * Normaliza un slug para el subdominio: minúsculas, sin acentos, y todo lo que
   * no sea letra/número se convierte en guion. "Venta de Chicha 101" ->
   * "venta-de-chicha-101". Quita los guiones de los extremos.
   */
  function normalizarSlug(s) {
    return sinAcentos(s)
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Igual que normalizarSlug pero conservando un guion final: permite escribir
   * "venta-de-chicha" sin que el guion desaparezca al teclear. Se aplica al
   * vuelo; la versión estricta se aplica al salir del campo y al guardar.
   */
  function normalizarSlugSuave(s) {
    var t = sinAcentos(s).replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-');
    return t;
  }

  function slugValido(s) { return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(texto(s)); }

  function urlSubdominio(slug) {
    var root = (A.cfg && A.cfg.ROOT_DOMAIN) ? String(A.cfg.ROOT_DOMAIN) : '';
    if (!slug) return '';
    return root ? 'https://' + slug + '.' + root + '/' : 'https://' + slug + '.TU-DOMINIO/';
  }

  /* -------------------------------------------------------- HTML de apoyo */
  /** Aviso en línea (mensaje en texto plano: se escapa aquí). */
  function alertaHtml(msg, tipo) {
    var clase = tipo === 'ok' ? 'alert-ok'
      : tipo === 'warn' ? 'alert-warn'
      : tipo === 'info' ? 'alert-info'
      : 'alert-danger';
    var icono = tipo === 'ok' ? '&#10003;' : tipo === 'info' ? '&#8505;' : '&#9888;';
    return '<div class="alert ' + clase + ' mb-4"><span class="alert-icon">' + icono + '</span>' +
      '<div class="alert-body">' + h(msg) + '</div></div>';
  }

  function cargaHtml(t) {
    return '<div class="text-center text-muted text-sm" style="padding:26px 0">' +
      '<span class="spinner" style="margin:0 auto 10px;display:block"></span>' + h(t) + '</div>';
  }

  function vacioHtml(icono, titulo, detalle) {
    return '<div class="empty-state">' +
      '<div class="empty-state-icon">' + icono + '</div>' +
      '<h3>' + h(titulo) + '</h3>' +
      '<p class="text-muted">' + detalle + '</p>' +
      '</div>';
  }

  function badgeWistiaHtml(info) {
    var html = '<div class="row mb-4">' +
      '<span class="badge badge-ok"><span class="badge-dot"></span>Vídeo detectado: ' + h(info.mediaId) + '</span>' +
      '<span class="badge badge-accent">' + (info.motor === 'legacy' ? 'Legacy (E-v1)' : 'Aurora') + '</span>' +
      '</div>';
    if (info.advertencias && info.advertencias.length) {
      var lis = '';
      for (var i = 0; i < info.advertencias.length; i++) lis += '<li>' + h(info.advertencias[i]) + '</li>';
      html += '<div class="alert alert-warn mb-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
        '<ul style="margin:0;padding-left:20px">' + lis + '</ul></div></div>';
    }
    return html;
  }

  /* --------------------------------------------------- recorrer el DOM */
  /** Sube por el árbol hasta encontrar un elemento con data-<accion>. */
  function ancestroConAccion(el, limite) {
    var n = el;
    while (n && n !== limite && n.nodeType) {
      if (n.nodeType === 1 && n.getAttribute && n.getAttribute('data-accion')) return n;
      n = n.parentNode;
    }
    return null;
  }

  /** Sube por el árbol hasta encontrar un elemento que tenga el atributo dado. */
  function ancestroConDato(el, attr, limite) {
    var n = el;
    while (n && n !== limite && n.nodeType) {
      if (n.nodeType === 1 && n.getAttribute && n.getAttribute(attr) !== null) return n;
      n = n.parentNode;
    }
    return null;
  }

  function elementosEnfocables(raiz) {
    var sel = 'a[href], button:not([disabled]), input:not([disabled]), ' +
              'select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    var todos = raiz.querySelectorAll(sel);
    var salida = [];
    for (var i = 0; i < todos.length; i++) {
      // getClientRects() es fiable incluso dentro de un contenedor position:fixed
      if (todos[i].getClientRects().length > 0) salida.push(todos[i]);
    }
    return salida;
  }

  function enfocarPrimero(panel) {
    setTimeout(function () {
      var lista = elementosEnfocables(panel);
      if (!lista.length) return;
      var objetivo = lista[0];
      // Si hay campos de formulario, el primero es el más útil al abrir.
      for (var i = 0; i < lista.length; i++) {
        var tag = lista[i].tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') { objetivo = lista[i]; break; }
      }
      try { objetivo.focus(); } catch (e) { /* el elemento puede haberse ido */ }
    }, 120);
  }

  function atraparFoco(e, panel) {
    var lista = elementosEnfocables(panel);
    if (!lista.length) return;
    var primero = lista[0];
    var ultimo = lista[lista.length - 1];
    if (e.shiftKey && document.activeElement === primero) { e.preventDefault(); ultimo.focus(); }
    else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primero.focus(); }
  }

  /* -------------------------------------------------- drawers y modales */
  var escapeRegistrado = false;

  function registrarEscape() {
    if (escapeRegistrado) return;
    escapeRegistrado = true;
    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape' && e.key !== 'Esc') return;
      if (!capas.length) return;
      e.preventDefault();
      // Solo se cierra la capa de arriba (por ejemplo, el modal sobre el drawer)
      capas[capas.length - 1].cerrar();
    });
  }

  /**
   * Crea un drawer (deslizante desde la derecha) o un modal centrado.
   * opciones: { tipo, titulo, html, pieHtml, ancho, puedeCerrar, onMontar, onCerrar }
   * Devuelve una capa con .panel, .backdrop y .cerrar(forzar).
   */
  function crearCapa(opciones) {
    opciones = opciones || {};
    registrarEscape();

    var esModal = opciones.tipo === 'modal';
    var focoPrevio = document.activeElement;
    var backdrop = document.createElement('div');
    var panel = document.createElement('div');

    if (esModal) {
      backdrop.className = 'modal-backdrop';
      panel.className = 'modal';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      if (opciones.titulo) panel.setAttribute('aria-label', opciones.titulo);
      panel.innerHTML = opciones.html || '';
    } else {
      backdrop.className = 'drawer-backdrop';
      panel.className = 'drawer' + (opciones.ancho === 'ancho' ? ' drawer-wide' : '');
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-label', opciones.titulo || 'Panel');
      panel.innerHTML =
        '<div class="drawer-header">' +
          '<h2>' + h(opciones.titulo || '') + '</h2>' +
          '<button class="drawer-close" type="button" data-accion="cerrar-capa" aria-label="Cerrar el panel">&times;</button>' +
        '</div>' +
        '<div class="drawer-body">' + (opciones.html || '') + '</div>' +
        '<div class="drawer-footer">' + (opciones.pieHtml || '') + '</div>';
    }

    document.body.appendChild(backdrop);
    document.body.appendChild(panel);
    requestAnimationFrame(function () {
      backdrop.classList.add('open');
      panel.classList.add('open');
    });

    var capa = {
      panel: panel,
      backdrop: backdrop,
      esModal: esModal,
      puedeCerrar: opciones.puedeCerrar || null
    };

    capa.cerrar = function (forzar) {
      if (panel.getAttribute('data-cerrada') === '1') return;
      if (!forzar && capa.puedeCerrar && !capa.puedeCerrar()) return;
      panel.setAttribute('data-cerrada', '1');

      var i = capas.indexOf(capa);
      if (i > -1) capas.splice(i, 1);

      backdrop.classList.remove('open');
      panel.classList.remove('open');
      setTimeout(function () {
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        if (panel.parentNode) panel.parentNode.removeChild(panel);
      }, 340);

      if (focoPrevio && focoPrevio.focus) { try { focoPrevio.focus(); } catch (e) { /* ya no existe */ } }
      if (opciones.onCerrar) { try { opciones.onCerrar(); } catch (e) { console.error(e); } }
    };

    // Clic en el fondo (fuera del panel) cierra
    backdrop.addEventListener('click', function (e) { if (e.target === backdrop) capa.cerrar(); });

    // El botón × del drawer, y cualquier [data-accion="cerrar-capa"] del pie
    panel.addEventListener('click', function (e) {
      var b = ancestroConAccion(e.target, panel);
      if (b && b.getAttribute('data-accion') === 'cerrar-capa') { e.preventDefault(); capa.cerrar(); }
    });

    panel.addEventListener('keydown', function (e) { if (e.key === 'Tab') atraparFoco(e, panel); });

    capas.push(capa);
    enfocarPrimero(panel);
    if (opciones.onMontar) opciones.onMontar(capa);
    return capa;
  }

  /* ============================================================
     CARGA DEL PANEL
     ============================================================ */

  function buscarCurso(id) {
    for (var i = 0; i < estado.cursos.length; i++) {
      if (estado.cursos[i].id === id) return estado.cursos[i];
    }
    return null;
  }

  /** Carga ajustes + cursos y pinta todo. Lanza si Supabase falla. */
  async function cargarPanel() {
    var res = await Promise.all([A.db.ajustes(), A.db.todosLosCursos()]);
    estado.ajustes = res[0] || null;
    estado.cursos = res[1] || [];
    renderAjustes();

    var fallos = await cargarConteos(estado.cursos);
    if (fallos) A.aviso('No se pudieron contar las lecciones o los inscritos de algún curso.', 'warn');

    renderCursos();
    pintarStats();
  }

  /** Cuenta lecciones e inscritos de cada curso, en paralelo y sin romper nada. */
  function cargarConteos(cursos) {
    var tareas = [];
    for (var i = 0; i < cursos.length; i++) tareas.push(contarCurso(cursos[i].id));
    return Promise.all(tareas).then(function (resultados) {
      var fallos = 0;
      for (var j = 0; j < resultados.length; j++) { if (!resultados[j]) fallos++; }
      return fallos;
    });
  }

  function contarCurso(cursoId) {
    return Promise.all([
      A.db.lecciones(cursoId).then(function (l) { return l.length; }).catch(function (e) {
        console.warn('No se pudieron contar las lecciones', e);
        return null;
      }),
      A.db.listarInscritos(cursoId).then(function (l) { return l.length; }).catch(function (e) {
        console.warn('No se pudieron contar los inscritos', e);
        return null;
      })
    ]).then(function (res) {
      estado.leccionesPorCurso[cursoId] = res[0];
      estado.inscritosPorCurso[cursoId] = res[1];
      return res[0] !== null && res[1] !== null;
    });
  }

  async function refrescarContadores(soloCursoId) {
    if (soloCursoId) {
      await contarCurso(soloCursoId);
    } else {
      await cargarConteos(estado.cursos);
    }
    renderCursos();
    pintarStats();
  }

  function pintarStats() {
    var totalLecciones = 0;
    var totalInscritos = 0;
    var leccionesOk = true;
    var inscritosOk = true;

    for (var i = 0; i < estado.cursos.length; i++) {
      var id = estado.cursos[i].id;
      var nL = estado.leccionesPorCurso[id];
      var nI = estado.inscritosPorCurso[id];
      if (nL === null || nL === undefined) leccionesOk = false; else totalLecciones += nL;
      if (nI === null || nI === undefined) inscritosOk = false; else totalInscritos += nI;
    }

    ponerTexto('stat-cursos', String(estado.cursos.length));
    ponerTexto('stat-lecciones', leccionesOk ? String(totalLecciones) : '—');
    ponerTexto('stat-alumnos', inscritosOk ? String(totalInscritos) : '—');
  }

  function ponerTexto(id, valor) {
    var el = document.getElementById(id);
    if (el) el.textContent = valor;
  }

  /**
   * Lanza una promesa desde un manejador de eventos sin dejarla nunca sin
   * capturar: cualquier fallo acaba en un aviso, no en la consola del alumno.
   */
  function lanzar(promesa) {
    if (promesa && typeof promesa.catch === 'function') {
      promesa.catch(function (e) { A.aviso(A.traducirError(e), 'error'); });
    }
  }

  function cambiarTab(t) {
    estado.tab = t === 'ajustes' ? 'ajustes' : 'cursos';
    var esCursos = estado.tab === 'cursos';
    var pc = document.getElementById('panel-cursos');
    var pa = document.getElementById('panel-ajustes');
    var bc = document.getElementById('tab-cursos');
    var ba = document.getElementById('tab-ajustes');

    if (pc) { if (esCursos) pc.classList.remove('hidden'); else pc.classList.add('hidden'); }
    if (pa) { if (esCursos) pa.classList.add('hidden'); else pa.classList.remove('hidden'); }
    if (bc) {
      bc.className = 'btn ' + (esCursos ? 'btn-primary' : 'btn-ghost');
      bc.setAttribute('aria-selected', esCursos ? 'true' : 'false');
    }
    if (ba) {
      ba.className = 'btn ' + (esCursos ? 'btn-ghost' : 'btn-primary');
      ba.setAttribute('aria-selected', esCursos ? 'false' : 'true');
    }
  }

  /* ============================================================
     LISTA DE CURSOS
     ============================================================ */

  function renderCursos() {
    var cont = document.getElementById('lista-cursos');
    if (!cont) return;

    if (!estado.cursos.length) {
      cont.innerHTML = vacioHtml('&#127891;', 'Tu catálogo está vacío',
        'Pulsa <strong>Crear Nuevo Curso</strong> para publicar el primero.');
      return;
    }

    var html = '';
    for (var i = 0; i < estado.cursos.length; i++) html += tarjetaCurso(estado.cursos[i]);
    cont.innerHTML = html;
  }

  function tarjetaCurso(c) {
    var id = h(c.id);
    var nL = estado.leccionesPorCurso[c.id];
    var nI = estado.inscritosPorCurso[c.id];
    var badge = c.publicado
      ? '<span class="badge badge-ok"><span class="badge-dot"></span>Publicado</span>'
      : '<span class="badge badge-warn"><span class="badge-dot"></span>Borrador</span>';
    var precio = (c.precio === null || c.precio === undefined || Number(c.precio) === 0)
      ? '<span class="text-faint">Sin precio</span>'
      : h(formatearPrecio(c.precio));
    var desc = texto(c.descripcion).trim();

    return '' +
      '<article class="card" data-curso-id="' + id + '">' +
        '<div class="row-between mb-2">' +
          '<h3 class="card-title">' + h(texto(c.nombre).trim() || '(sin nombre)') + '</h3>' +
          badge +
        '</div>' +
        (desc ? '<p class="text-muted text-sm">' + h(desc) + '</p>' : '') +
        '<div class="card-meta stack">' +
          '<div>Slug: <code>' + h(texto(c.slug)) + '</code></div>' +
          '<div>' +
            (nL === null || nL === undefined ? 'Lecciones: —' : nL + (nL === 1 ? ' lección' : ' lecciones')) +
            ' · ' + (nI === null || nI === undefined ? 'Inscritos: —' : nI + (nI === 1 ? ' inscrito' : ' inscritos')) +
            ' · Precio: ' + precio +
          '</div>' +
        '</div>' +
        '<div class="row mt-4">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-accion="editar">Editar</button>' +
          '<button class="btn btn-secondary btn-sm" type="button" data-accion="lecciones">Lecciones y examen</button>' +
          '<button class="btn btn-secondary btn-sm" type="button" data-accion="inscribir">Inscribir alumnos</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-accion="publicar">' +
            (c.publicado ? 'Despublicar' : 'Publicar') + '</button>' +
          '<a class="btn btn-ghost btn-sm" href="curso.html?slug=' + encodeURIComponent(texto(c.slug)) + '" ' +
            'target="_blank" rel="noopener">Ver curso</a>' +
          '<button class="btn btn-danger btn-sm" type="button" data-accion="borrar">Borrar</button>' +
        '</div>' +
      '</article>';
  }

  function alClicEnCursos(e) {
    var b = ancestroConAccion(e.target, e.currentTarget);
    if (!b) return;
    var accion = b.getAttribute('data-accion');
    var tarjeta = ancestroConDato(b, 'data-curso-id', e.currentTarget);
    if (!tarjeta) return;
    var curso = buscarCurso(tarjeta.getAttribute('data-curso-id'));
    if (!curso) return;

    if (accion === 'editar') abrirCurso(curso.id);
    else if (accion === 'lecciones') lanzar(abrirLecciones(curso));
    else if (accion === 'inscribir') abrirInscritos(curso);
    else if (accion === 'publicar') lanzar(alternarPublicado(curso));
    else if (accion === 'borrar') lanzar(borrarCurso(curso));
  }

  async function alternarPublicado(curso) {
    var nuevo = !curso.publicado;
    if (nuevo && !estado.leccionesPorCurso[curso.id]) {
      // Publicar un curso vacío deja al alumno una página sin nada que ver.
      if (!window.confirm('Este curso no tiene lecciones todavía. Si lo publicas, aparecerá en el catálogo ' +
        'sin contenido. ¿Publicar de todos modos?')) return;
    }
    A.cargando(true, nuevo ? 'Publicando el curso…' : 'Pasando el curso a borrador…');
    try {
      await A.db.actualizarCurso(curso.id, { publicado: nuevo });
      curso.publicado = nuevo;
      renderCursos();
      A.aviso(nuevo ? 'Curso publicado: ya aparece en el catálogo.' : 'Curso pasado a borrador: ya no aparece en el catálogo.', 'ok');
    } catch (e) {
      A.aviso(A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  async function borrarCurso(curso) {
    var confirmado = await pedirConfirmacionSlug(curso);
    if (!confirmado) return;
    A.cargando(true, 'Borrando el curso…');
    try {
      await A.db.borrarCurso(curso.id);
      A.aviso('Curso borrado.', 'ok');
      await cargarPanel();
    } catch (e) {
      A.aviso(A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  /**
   * Confirmación destructiva "de verdad": hay que escribir el slug del curso.
   * Devuelve una promesa que resuelve a true solo si el administrador acierta.
   */
  function pedirConfirmacionSlug(curso) {
    return new Promise(function (resolve) {
      var respondido = false;
      var capa = crearCapa({
        tipo: 'modal',
        titulo: 'Borrar curso',
        html:
          '<h2>Borrar «' + h(texto(curso.nombre)) + '»</h2>' +
          '<div class="alert alert-danger"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
            'Se borrarán también sus lecciones, sus preguntas y sus inscripciones. ' +
            'Esta acción <strong>no se puede deshacer</strong>.' +
          '</div></div>' +
          '<label class="field"><span class="label">Escribe el slug para confirmar: <code>' + h(texto(curso.slug)) + '</code></span>' +
            '<input class="input" type="text" id="confirmar-slug" autocomplete="off" spellcheck="false" placeholder="' + h(texto(curso.slug)) + '">' +
          '</label>' +
          '<div class="row">' +
            '<button class="btn btn-ghost" type="button" data-accion="cancelar">Cancelar</button>' +
            '<button class="btn btn-danger" type="button" data-accion="confirmar" disabled>Borrar definitivamente</button>' +
          '</div>',
        onCerrar: function () { if (!respondido) { respondido = true; resolve(false); } }
      });

      var inp = capa.panel.querySelector('#confirmar-slug');
      var btn = capa.panel.querySelector('[data-accion="confirmar"]');

      inp.addEventListener('input', function () {
        var coincide = normalizarSlug(inp.value) === normalizarSlug(curso.slug) && inp.value.trim() !== '';
        if (coincide) btn.removeAttribute('disabled'); else btn.setAttribute('disabled', 'disabled');
      });

      capa.panel.addEventListener('click', function (e) {
        var b = ancestroConAccion(e.target, capa.panel);
        if (!b) return;
        var accion = b.getAttribute('data-accion');
        if (accion === 'cancelar') {
          capa.cerrar(true);
        } else if (accion === 'confirmar') {
          respondido = true;
          resolve(true);
          capa.cerrar(true);
        }
      });
    });
  }

  /* ============================================================
     DRAWER: CREAR / EDITAR CURSO
     ============================================================ */

  function abrirCurso(cursoId) {
    var curso = cursoId ? buscarCurso(cursoId) : null;
    var esNuevo = !curso;

    var html =
      '<div id="curso-error"></div>' +
      '<label class="field"><span class="label">Título del Curso <span class="req">*</span></span>' +
        '<input class="input" type="text" id="cu-nombre" required autocomplete="off" ' +
        'placeholder="Ej. Venta de Chicha 101" value="' + h(curso ? curso.nombre : '') + '">' +
        '<span class="hint">Es el nombre que verán los alumnos en el catálogo.</span></label>' +

      '<label class="field"><span class="label">Descripción Corta</span>' +
        '<textarea class="textarea textarea-plain" id="cu-descripcion" ' +
        'placeholder="Una frase que explique de qué va el curso.">' + h(curso ? curso.descripcion : '') + '</textarea></label>' +

      '<label class="field"><span class="label">Slug / URL <span class="req">*</span></span>' +
        '<input class="input" type="text" id="cu-slug" required autocomplete="off" spellcheck="false" ' +
        'placeholder="ventadechicha" value="' + h(curso ? curso.slug : '') + '">' +
        '<span class="hint">Solo minúsculas, números y guiones. Se normaliza solo al escribir.</span></label>' +
      '<div id="cu-url" class="card card-inset card-pad-sm mb-4 text-sm"></div>' +

      '<div class="field-row">' +
        '<label class="field"><span class="label">Precio</span>' +
          '<input class="input" type="number" id="cu-precio" min="0" step="0.01" inputmode="decimal" ' +
          'placeholder="0.00" value="' + h(precioValor(curso)) + '">' +
          '<span class="hint">Opcional. Déjalo vacío o en 0 si el curso es gratis.</span></label>' +
        '<label class="field"><span class="label">Moneda</span>' +
          '<input class="input" type="text" id="cu-moneda" autocomplete="off" maxlength="10" ' +
          'placeholder="Bs" value="' + h(curso && curso.moneda ? curso.moneda : 'Bs') + '">' +
          '<span class="hint">Tal como se lo muestras al alumno: Bs, USD, USDT…</span></label>' +
      '</div>' +

      '<label class="field"><span class="label">Foto de la tarjeta</span>' +
        '<input class="input" type="url" id="cu-imagen" autocomplete="off" inputmode="url" ' +
        'placeholder="https://…/foto.jpg" value="' + h(curso && curso.imagen_url ? curso.imagen_url : '') + '">' +
        '<span class="hint">Es la foto que se ve en el catálogo, arriba del título. ' +
        'Si la dejas vacía se pinta la inicial del curso. Lo ideal es 1200×675 (16:9).</span></label>' +
      '<img id="cu-imagen-previa" class="hidden mb-4" alt="Vista previa de la foto" ' +
        'style="width:100%;max-height:200px;object-fit:cover;border-radius:10px;border:1px solid var(--line)">' +

      '<div class="card card-inset card-pad-sm mb-4" id="cu-precios-metodos">' +
        '<div class="label mb-2">Cuánto cuesta en cada método de cobro</div>' +
        '<div id="cu-precios-lista" class="text-faint text-sm">Cargando tus métodos de cobro…</div>' +
        '<div class="text-faint text-xs mt-2">Deja un método vacío para no ofrecerlo en este curso. ' +
        'Tus datos de cobro (banco, teléfono, cédula) se escriben una sola vez, en la pantalla de Cobros.</div>' +
      '</div>' +

      '<div class="field"><span class="label">Estado</span>' +
        '<label class="check"><input type="checkbox" id="cu-publicado"' + (curso && curso.publicado ? ' checked' : '') + '>' +
        '<span>Publicado (visible en el catálogo)</span></label>' +
        '<span class="hint">Un curso en borrador no aparece en la portada.</span>' +
      '</div>';

    var pie =
      '<button class="btn btn-ghost" type="button" data-accion="cancelar">Cancelar</button>' +
      '<button class="btn btn-primary" type="button" data-accion="guardar">' +
      (esNuevo ? 'Crear curso' : 'Guardar cambios') + '</button>';

    // Referencia a los valores originales para detectar cambios sin guardar
    var original = {
      nombre: curso ? texto(curso.nombre) : '',
      descripcion: curso ? texto(curso.descripcion) : '',
      slug: curso ? texto(curso.slug) : '',
      precio: precioValor(curso),
      moneda: curso && curso.moneda ? texto(curso.moneda) : 'Bs',
      imagen: curso && curso.imagen_url ? texto(curso.imagen_url) : '',
      publicado: !!(curso && curso.publicado)
    };

    // Los id de este formulario son únicos en el documento: se consultan así
    // porque puedeCerrar se evalúa antes de tener la referencia a la capa.
    function valorDe(id) {
      var el = document.getElementById(id);
      return el ? el.value : '';
    }

    crearCapa({
      tipo: 'drawer',
      titulo: esNuevo ? 'Crear Nuevo Curso' : 'Editar curso',
      html: html,
      pieHtml: pie,
      puedeCerrar: function () {
        var chk = document.getElementById('cu-publicado');
        var igual =
          valorDe('cu-nombre') === original.nombre &&
          valorDe('cu-descripcion') === original.descripcion &&
          valorDe('cu-slug') === original.slug &&
          valorDe('cu-precio') === original.precio &&
          valorDe('cu-moneda') === original.moneda &&
          valorDe('cu-imagen') === original.imagen &&
          !!chk && chk.checked === original.publicado;
        if (igual) return true;
        return window.confirm('Tienes cambios sin guardar en este curso. ¿Cerrar de todos modos?');
      },
      onMontar: function (capa) {
        conectarDrawerCurso(capa, curso, esNuevo);
      }
    });
  }

  function conectarDrawerCurso(capa, curso, esNuevo) {
    var panel = capa.panel;
    var inpNombre = panel.querySelector('#cu-nombre');
    var inpSlug = panel.querySelector('#cu-slug');
    var inpPrecio = panel.querySelector('#cu-precio');
    var inpMoneda = panel.querySelector('#cu-moneda');
    var inpImagen = panel.querySelector('#cu-imagen');
    var previaImagen = panel.querySelector('#cu-imagen-previa');
    var inpPublicado = panel.querySelector('#cu-publicado');
    var zonaUrl = panel.querySelector('#cu-url');
    var zonaError = panel.querySelector('#curso-error');

    // Al editar no pisamos el slug existente con el título.
    var slugTocado = !esNuevo;

    function pintarUrl() {
      var slug = normalizarSlug(inpSlug.value);
      if (!slug) {
        zonaUrl.innerHTML = '<span class="text-faint">Escribe un slug para ver la URL del curso.</span>';
        return;
      }
      var ok = slugValido(slug);
      zonaUrl.innerHTML =
        (ok ? '' : '<div class="alert alert-danger mb-2"><span class="alert-icon">&#9888;</span>' +
          '<div class="alert-body">El slug solo admite minúsculas, números y guiones simples (por ejemplo ' +
          '<code>venta-de-chicha</code>).</div></div>') +
        '<div class="mb-2">Subdominio: <code>' + h(urlSubdominio(slug)) + '</code></div>' +
        '<div>Ruta directa: <code>curso.html?slug=' + h(slug) + '</code></div>' +
        ((A.cfg && A.cfg.ROOT_DOMAIN) ? '' :
          '<div class="text-faint mt-4">Configura <code>ROOT_DOMAIN</code> en <code>assets/js/config.js</code> ' +
          'para que el subdominio sea el real.</div>');
    }

    inpSlug.addEventListener('input', function () {
      var pos = inpSlug.selectionStart;
      var limpio = normalizarSlugSuave(inpSlug.value);
      if (limpio !== inpSlug.value) {
        inpSlug.value = limpio;
        try { inpSlug.setSelectionRange(pos, pos); } catch (e) { /* tipo de input sin selección */ }
      }
      slugTocado = true;
      pintarUrl();
    });

    inpSlug.addEventListener('blur', function () {
      inpSlug.value = normalizarSlug(inpSlug.value);
      pintarUrl();
    });

    inpNombre.addEventListener('input', function () {
      if (slugTocado) return;
      inpSlug.value = normalizarSlug(inpNombre.value);
      pintarUrl();
    });

    pintarUrl();

    // Vista previa de la foto de la tarjeta. Se enseña solo si la imagen carga de
    // verdad: asi, con una URL rota, no queda un hueco vacio ocupando espacio.
    function pintarPreviaImagen() {
      if (!previaImagen || !inpImagen) return;
      var u = (inpImagen.value || '').trim();
      if (!u) {
        previaImagen.classList.add('hidden');
        previaImagen.removeAttribute('src');
        return;
      }
      previaImagen.onload = function () { previaImagen.classList.remove('hidden'); };
      previaImagen.onerror = function () { previaImagen.classList.add('hidden'); };
      previaImagen.src = u;
    }
    if (inpImagen) inpImagen.addEventListener('input', pintarPreviaImagen);
    pintarPreviaImagen();

    /* ---- cuánto cuesta este curso en cada método de cobro -------------------
       Los datos de cobro (banco, teléfono, cédula) se escriben UNA vez en la
       pantalla de Cobros. Aquí solo se pone el monto de ESTE curso en cada uno.
       Se recuerda lo que había al abrir, para no tocar en la base lo que no ha
       cambiado y para saber cuándo hay que borrar un precio (campo vaciado).
    ------------------------------------------------------------------------ */
    var zonaPrecios = panel.querySelector('#cu-precios-lista');
    var preciosCargados = {};

    async function cargarPreciosMetodos() {
      if (!zonaPrecios) return;
      try {
        var metodos = await A.db.metodosPago();
        var activos = metodos.filter(function (m) { return m.activo !== false; });

        if (!activos.length) {
          zonaPrecios.innerHTML = '<span class="text-faint">Todavía no tienes métodos de cobro. ' +
            'Añádelos en la pantalla de <strong>Cobros</strong> y vuelve aquí.</span>';
          return;
        }

        var precios = (curso && curso.id) ? await A.db.preciosDeCurso(curso.id) : [];
        var porMetodo = {};
        (precios || []).forEach(function (p) { porMetodo[p.metodo_id] = p.monto; });

        zonaPrecios.innerHTML = activos.map(function (m) {
          var v = porMetodo[m.id];
          preciosCargados[m.id] = (v === undefined || v === null) ? '' : String(Number(v));
          return '<div class="row-between mb-2" style="gap:12px">' +
            '<span style="flex:1 1 auto;min-width:0">' + h(m.etiqueta) +
              ' <span class="text-faint text-xs">' + h(m.moneda || '') + '</span></span>' +
            '<input class="input" style="flex:0 0 130px" type="number" min="0" step="0.01" ' +
              'inputmode="decimal" data-precio-metodo="' + h(m.id) + '" placeholder="—" ' +
              'value="' + h(preciosCargados[m.id]) + '">' +
            '</div>';
        }).join('');
      } catch (e) {
        zonaPrecios.innerHTML = '<span class="text-sm" style="color:var(--danger)">' +
          'No se pudieron cargar tus métodos de cobro: ' + h(A.traducirError(e)) + '</span>';
      }
    }

    async function guardarPreciosMetodos(cursoId) {
      if (!cursoId || !zonaPrecios) return;
      var inputs = panel.querySelectorAll('[data-precio-metodo]');
      for (var i = 0; i < inputs.length; i++) {
        var id = inputs[i].getAttribute('data-precio-metodo');
        var bruto = String(inputs[i].value || '').trim();
        var antes = preciosCargados[id] || '';
        if (bruto === antes) continue;                    // nada cambió

        if (!bruto) {                                     // lo vaciaron: quitar
          if (antes) await A.db.borrarPrecioCurso(cursoId, id);
          continue;
        }
        var n = Number(bruto);
        if (!isFinite(n) || n <= 0) continue;             // la base exige monto > 0
        await A.db.guardarPrecioCurso(cursoId, id, n);
      }
    }

    cargarPreciosMetodos();

    // Los campos que se guardan, en un solo sitio para no olvidar ninguno.
    function camposCurso() {
      return {
        nombre: inpNombre, slug: inpSlug, precio: inpPrecio, moneda: inpMoneda,
        imagen: inpImagen, publicado: inpPublicado, zonaError: zonaError,
        guardarPrecios: guardarPreciosMetodos
      };
    }

    panel.addEventListener('click', function (e) {
      var b = ancestroConAccion(e.target, panel);
      if (!b) return;
      var accion = b.getAttribute('data-accion');
      if (accion === 'cancelar') {
        capa.cerrar();
      } else if (accion === 'guardar') {
        guardarCurso(capa, curso, esNuevo, camposCurso());
      }
    });

    // Enter en el título guarda (evita tener que bajar al pie)
    inpNombre.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); guardarCurso(capa, curso, esNuevo, camposCurso()); }
    });
  }

  function traducirErrorCurso(e) {
    var m = texto(e && e.message ? e.message : e);
    if (/duplicate key|23505|unique/i.test(m) && /slug/i.test(m)) {
      return 'Ese slug ya está en uso por otro curso. Elige otro.';
    }
    if (/duplicate key|23505|unique/i.test(m)) {
      return 'Ese slug ya está en uso por otro curso. Elige otro.';
    }
    if (/row-level security|permission denied|violates row-level/i.test(m)) {
      return 'Tu cuenta no tiene permisos de administrador para guardar cursos.';
    }
    return A.traducirError(e);
  }

  async function guardarCurso(capa, curso, esNuevo, campos) {
    var panel = capa.panel;
    campos.zonaError.innerHTML = '';

    var nombre = campos.nombre.value.trim();
    if (!nombre) {
      campos.zonaError.innerHTML = alertaHtml('El título del curso es obligatorio.', 'danger');
      campos.nombre.focus();
      return;
    }

    var slug = normalizarSlug(campos.slug.value);
    campos.slug.value = slug;
    if (!slug) {
      campos.zonaError.innerHTML = alertaHtml('El slug es obligatorio: es la dirección del curso.', 'danger');
      campos.slug.focus();
      return;
    }
    if (!slugValido(slug)) {
      campos.zonaError.innerHTML = alertaHtml('El slug solo admite minúsculas, números y guiones simples.', 'danger');
      campos.slug.focus();
      return;
    }
    // Comprobación local de unicidad (la base de datos también lo garantiza)
    for (var i = 0; i < estado.cursos.length; i++) {
      var otro = estado.cursos[i];
      if (otro.slug === slug && (!curso || otro.id !== curso.id)) {
        campos.zonaError.innerHTML = alertaHtml('Ese slug ya lo usa el curso «' + texto(otro.nombre) + '». Elige otro.', 'danger');
        campos.slug.focus();
        return;
      }
    }

    var precio = null;
    var precioBruto = campos.precio.value.trim();
    if (precioBruto !== '') {
      var n = Number(precioBruto);
      if (!isFinite(n) || n < 0) {
        campos.zonaError.innerHTML = alertaHtml('El precio debe ser un número igual o mayor que 0 (o quedar vacío).', 'danger');
        campos.precio.focus();
        return;
      }
      precio = n;
    }

    // Moneda: es solo la etiqueta que ve el alumno junto al precio.
    var moneda = campos.moneda ? campos.moneda.value.trim() : '';
    if (!moneda) moneda = 'Bs';
    if (moneda.length > 10) {
      campos.zonaError.innerHTML = alertaHtml('La moneda no puede pasar de 10 caracteres.', 'danger');
      campos.moneda.focus();
      return;
    }

    // Foto de la tarjeta: solo http(s). Se valida aqui para no guardar una
    // direccion rota que luego deje un hueco en el catalogo.
    var imagen = campos.imagen ? campos.imagen.value.trim() : '';
    if (imagen && !/^https?:\/\//i.test(imagen)) {
      campos.zonaError.innerHTML = alertaHtml(
        'La foto tiene que ser una dirección que empiece por <code>http://</code> o <code>https://</code>.', 'danger');
      campos.imagen.focus();
      return;
    }

    var datos = {
      nombre: nombre,
      slug: slug,
      descripcion: panel.querySelector('#cu-descripcion').value.trim() || null,
      precio: precio,
      moneda: moneda,
      imagen_url: imagen || null,
      publicado: !!campos.publicado.checked
    };

    A.cargando(true, esNuevo ? 'Creando el curso…' : 'Guardando los cambios…');
    try {
      var guardado;
      if (esNuevo) {
        guardado = await A.db.crearCurso(datos);
      } else {
        guardado = await A.db.actualizarCurso(curso.id, datos);
      }

      // Los montos por método de cobro se guardan aparte. Si algo falla aquí, el
      // curso ya está guardado y se avisa sin perder el trabajo hecho.
      var cursoId = (guardado && guardado.id) || (curso && curso.id);
      var falloPrecios = null;
      if (typeof campos.guardarPrecios === 'function') {
        try { await campos.guardarPrecios(cursoId); }
        catch (e2) { falloPrecios = traducirErrorCurso(e2); }
      }

      A.aviso(esNuevo ? 'Curso creado.' : 'Cambios guardados.', 'ok');
      if (falloPrecios) {
        A.aviso('El curso se guardó, pero los precios por método de cobro no: ' + falloPrecios +
                ' Vuelve a abrir el curso para reintentarlo.', 'error', 12000);
      }
      capa.cerrar(true);
      await cargarPanel();
    } catch (e) {
      var msg = traducirErrorCurso(e);
      campos.zonaError.innerHTML = alertaHtml(msg, 'danger');
      A.aviso(msg, 'error');
    } finally {
      A.cargando(false);
    }
  }

  /* ============================================================
     DRAWER: LECCIONES Y EXAMEN
     ============================================================ */

  async function abrirLecciones(curso) {
    estado.cursoActual = curso;
    estado.lecciones = [];
    estado.preguntas = [];
    estado.preguntasSucias = false;
    previewActiva = null;

    var html =
      '<div class="alert alert-info mb-4"><span class="alert-icon">&#8505;</span><div class="alert-body">' +
        'Cada lección se guarda con su propio botón. El <strong>orden</strong> no puede repetirse dentro del curso: ' +
        'es lo que desbloquea las lecciones en secuencia.' +
      '</div></div>' +

      '<div class="row-between mb-4">' +
        '<h3 class="mb-0">Lecciones</h3>' +
        '<button class="btn btn-primary btn-sm" type="button" data-accion="nueva-leccion">+ Añadir Lección</button>' +
      '</div>' +
      '<div id="zona-lecciones" class="stack">' + cargaHtml('Cargando lecciones…') + '</div>' +

      '<hr class="divider">' +

      '<div class="row-between mb-2">' +
        '<h3 class="mb-0">Preguntas del examen</h3>' +
        '<span class="badge" id="contador-preguntas">0 preguntas cargadas</span>' +
      '</div>' +
      '<div class="alert alert-warn mb-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
        'Las preguntas se editan aquí y se guardan <strong>todas juntas</strong> con «Guardar preguntas»: ' +
        'se sustituyen las anteriores de este curso. Revísalas antes de guardar.' +
      '</div></div>' +

      '<div class="card card-inset">' +
        '<h4 class="card-title">Generar Preguntas con IA</h4>' +
        '<label class="field"><span class="label">Pega aquí el texto de la lección o el tema</span>' +
          '<textarea class="textarea textarea-lg textarea-plain" id="ia-texto" ' +
          'placeholder="Pega el contenido de la lección (o el tema) del que quieres sacar ~30 preguntas."></textarea></label>' +
        '<div class="row">' +
          '<button class="btn btn-primary" type="button" data-accion="abrir-ia">Generar Preguntas con IA</button>' +
          '<span class="text-faint text-xs" style="flex:1 1 220px">Sin claves de IA en el navegador: el panel te da la ' +
          'instrucción lista para tu IA y valida el JSON que te devuelva antes de cargar nada.</span>' +
        '</div>' +
      '</div>' +

      '<div id="zona-preguntas" class="mt-4">' + cargaHtml('Cargando preguntas…') + '</div>' +
      '<button class="btn btn-ghost btn-sm mt-4" type="button" data-accion="nueva-pregunta">+ Añadir pregunta en blanco</button>';

    var pie =
      '<button class="btn btn-danger" type="button" data-accion="borrar-preguntas">Borrar todas</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-ghost" type="button" data-accion="cerrar-capa">Cerrar</button>' +
      '<button class="btn btn-primary" type="button" data-accion="guardar-preguntas">Guardar preguntas</button>';

    var capa = crearCapa({
      tipo: 'drawer',
      ancho: 'ancho',
      titulo: 'Lecciones y examen · ' + (texto(curso.nombre).trim() || texto(curso.slug)),
      html: html,
      pieHtml: pie,
      puedeCerrar: function () {
        if (estado.preguntasSucias) {
          return window.confirm('Tienes preguntas sin guardar. Si cierras, se perderán los cambios del editor. ¿Cerrar de todos modos?');
        }
        var nuevas = 0;
        for (var i = 0; i < estado.lecciones.length; i++) { if (!estado.lecciones[i].id) nuevas++; }
        if (nuevas > 0) {
          return window.confirm('Tienes ' + nuevas + ' lección(es) sin guardar. Si cierras, se perderán. ¿Cerrar de todos modos?');
        }
        return true;
      }
    });

    conectarDrawerLecciones(capa, curso);
    await cargarDatosCurso(capa, curso);
  }

  /** Trae lecciones y preguntas del curso y repinta el editor. */
  async function cargarDatosCurso(capa, curso) {
    var zonaLec = capa.panel.querySelector('#zona-lecciones');
    var zonaPre = capa.panel.querySelector('#zona-preguntas');
    try {
      var res = await Promise.all([
        A.db.lecciones(curso.id),
        A.db.preguntasDeCurso(curso.id)
      ]);
      estado.lecciones = res[0] || [];
      estado.preguntas = normalizarPreguntas(res[1] || []);
      estado.preguntasSucias = false;
      renderLecciones(capa);
      renderPreguntas(capa);
    } catch (e) {
      var msg = A.traducirError(e);
      if (zonaLec) zonaLec.innerHTML = alertaHtml('No se pudieron cargar las lecciones: ' + msg, 'danger');
      if (zonaPre) zonaPre.innerHTML = alertaHtml('No se pudieron cargar las preguntas: ' + msg, 'danger');
      A.aviso(msg, 'error');
    }
  }

  function normalizarPreguntas(filas) {
    var salida = [];
    for (var i = 0; i < filas.length; i++) {
      var f = filas[i] || {};
      var ops = normalizarOpciones(f.opciones);
      var correcta = typeof f.respuesta_correcta === 'number' ? f.respuesta_correcta : parseInt(f.respuesta_correcta, 10);
      if (!isFinite(correcta) || correcta < 0 || correcta >= ops.length) correcta = 0;
      salida.push({
        id: f.id || null,
        leccion_id: f.leccion_id || null,
        pregunta: texto(f.pregunta),
        opciones: ops,
        respuesta_correcta: correcta,
        explicacion: texto(f.explicacion)
      });
    }
    return salida;
  }

  function normalizarOpciones(o) {
    var salida = [];
    if (esArray(o)) {
      for (var i = 0; i < o.length; i++) salida.push(typeof o[i] === 'string' ? o[i] : texto(o[i]));
    }
    while (salida.length < 2) salida.push('');
    return salida;
  }

  function conectarDrawerLecciones(capa, curso) {
    var panel = capa.panel;
    var cuerpo = panel.querySelector('.drawer-body');

    /* --- clics -------------------------------------------------------------
       El escuchador va en el PANEL COMPLETO, no solo en .drawer-body.

       Motivo (era un fallo real): "Guardar preguntas" y "Borrar todas" viven en
       el PIE del panel, y en crearCapa el pie es un HERMANO de .drawer-body, no
       un hijo. Con el escuchador puesto solo en el cuerpo, pulsar "Guardar
       preguntas" no hacia absolutamente NADA: ni guardaba, ni avisaba, ni daba
       error. Costaba muchisimo de diagnosticar precisamente por ese silencio.

       El panel de curso ya lo hacia bien (conectarDrawerCurso usa panel). Al
       detectar el fallo se comprobaron los seis escuchadores de clic de admin.js
       y este era el unico atado al cuerpo.

       Como limite de las busquedas se usa tambien el panel: si se usara el
       cuerpo, al pulsar un boton del pie el recorrido hacia arriba no encontraria
       nunca ese limite y podria acabar leyendo un data-idx de otra parte de la
       pagina.
    ------------------------------------------------------------------------ */
    panel.addEventListener('click', function (e) {
      var b = ancestroConAccion(e.target, panel);
      if (!b) return;
      var accion = b.getAttribute('data-accion');

      var bloqueLec = ancestroConDato(b, 'data-idx', panel);
      var bloqueQ = ancestroConDato(b, 'data-qidx', panel);
      var idx = bloqueLec ? parseInt(bloqueLec.getAttribute('data-idx'), 10) : -1;
      var qi = bloqueQ ? parseInt(bloqueQ.getAttribute('data-qidx'), 10) : -1;

      switch (accion) {
        case 'nueva-leccion': anadirLeccion(capa); break;
        case 'guardar-leccion': lanzar(guardarLeccion(capa, idx)); break;
        case 'borrar-leccion': lanzar(borrarLeccion(capa, idx)); break;
        case 'validar-wistia': validarWistia(capa, idx, true); break;
        case 'preguntas-de-leccion': irAPreguntasDeLeccion(capa, idx); break;
        case 'abrir-ia': abrirGeneradorIA(capa); break;
        case 'nueva-pregunta': anadirPregunta(capa, null); break;
        case 'borrar-pregunta': borrarPregunta(capa, qi); break;
        case 'subir-pregunta': moverPregunta(capa, qi, -1); break;
        case 'bajar-pregunta': moverPregunta(capa, qi, 1); break;
        case 'anadir-opcion': anadirOpcion(capa, qi); break;
        case 'quitar-opcion': quitarOpcion(capa, qi, parseInt(b.getAttribute('data-oidx'), 10)); break;
        case 'guardar-preguntas': lanzar(guardarPreguntas(capa, curso)); break;
        case 'borrar-preguntas': lanzar(borrarTodasPreguntas(capa, curso)); break;
        default: break;
      }
    });

    /* --- escritura en los campos (sin repintar, para no perder el foco) ---- */
    cuerpo.addEventListener('input', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;

      var campoLec = t.getAttribute('data-campo');
      if (campoLec) {
        var bloqueLec = ancestroConDato(t, 'data-idx', cuerpo);
        if (bloqueLec) {
          var li = parseInt(bloqueLec.getAttribute('data-idx'), 10);
          if (estado.lecciones[li]) estado.lecciones[li][campoLec] = t.value;
        }
        return;
      }

      var campoP = t.getAttribute('data-campo-p');
      if (campoP && campoP !== 'leccion_id') {
        var bloqueQ = ancestroConDato(t, 'data-qidx', cuerpo);
        if (!bloqueQ) return;
        var q = estado.preguntas[parseInt(bloqueQ.getAttribute('data-qidx'), 10)];
        if (!q) return;
        if (campoP === 'opcion') {
          var oi = parseInt(t.getAttribute('data-oidx'), 10);
          q.opciones[oi] = t.value;
        } else {
          q[campoP] = t.value;
        }
        marcarSucias(capa);
      }
    });

    /* --- selects y radios -------------------------------------------------- */
    cuerpo.addEventListener('change', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute) return;
      var bloqueQ = ancestroConDato(t, 'data-qidx', cuerpo);
      if (!bloqueQ) return;
      var qi = parseInt(bloqueQ.getAttribute('data-qidx'), 10);
      var q = estado.preguntas[qi];
      if (!q) return;

      if (t.getAttribute('data-campo-p') === 'leccion_id') {
        q.leccion_id = t.value || null;
        marcarSucias(capa);
      } else if (t.getAttribute('data-accion') === 'marcar-correcta') {
        q.respuesta_correcta = parseInt(t.value, 10);
        // Repintamos solo las clases, sin rehacer el bloque (no se pierde nada)
        var filas = bloqueQ.querySelectorAll('.quiz-opt');
        for (var i = 0; i < filas.length; i++) {
          if (i === q.respuesta_correcta) filas[i].classList.add('is-picked');
          else filas[i].classList.remove('is-picked');
        }
        marcarSucias(capa);
      }
    });

    /* --- pegado del embed de Wistia: valida y monta la vista previa -------- */
    cuerpo.addEventListener('paste', function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || t.getAttribute('data-campo') !== 'wistia_embed') return;
      var bloqueLec = ancestroConDato(t, 'data-idx', cuerpo);
      if (!bloqueLec) return;
      var idx = parseInt(bloqueLec.getAttribute('data-idx'), 10);
      // Esperamos a que el navegador inserte el texto pegado
      setTimeout(function () { validarWistia(capa, idx, true); }, 0);
    });
  }

  /* ------------------------------------------------------------- lecciones */

  function renderLecciones(capa) {
    var zona = capa.panel.querySelector('#zona-lecciones');
    if (!zona) return;

    if (!estado.lecciones.length) {
      zona.innerHTML = vacioHtml('&#127916;', 'Todavía no hay lecciones',
        'Pulsa <strong>Añadir Lección</strong> para crear la primera.');
      return;
    }

    var html = '';
    for (var i = 0; i < estado.lecciones.length; i++) html += tarjetaLeccion(estado.lecciones[i], i);
    zona.innerHTML = html;
  }

  function tarjetaLeccion(l, idx) {
    var embed = texto(l.wistia_embed).trim();
    var estadoW = '';
    if (embed && window.WistiaLMS) {
      var info = window.WistiaLMS.parsearEmbed(embed);
      estadoW = info.ok ? badgeWistiaHtml(info) : alertaHtml('Código de Wistia no válido: ' + info.error, 'danger');
    }
    var orden = (l.orden === null || l.orden === undefined || l.orden === '') ? (idx + 1) : l.orden;

    return '' +
      '<div class="card card-flat" data-idx="' + idx + '">' +
        '<div class="row-between mb-2">' +
          '<strong>Lección ' + (idx + 1) + '</strong>' +
          (l.id ? '<span class="badge badge-ok"><span class="badge-dot"></span>Guardada</span>'
                : '<span class="badge badge-warn"><span class="badge-dot"></span>Sin guardar</span>') +
        '</div>' +

        '<label class="field"><span class="label">Título de la Lección <span class="req">*</span></span>' +
          '<input class="input" type="text" data-campo="titulo" autocomplete="off" ' +
          'placeholder="Ej. Introducción" value="' + h(l.titulo) + '"></label>' +

        '<label class="field"><span class="label">Descripción</span>' +
          '<textarea class="textarea textarea-plain" data-campo="descripcion" ' +
          'placeholder="Qué se aprende en esta lección (opcional).">' + h(l.descripcion) + '</textarea></label>' +

        '<label class="field"><span class="label">Código Embed de Wistia</span>' +
          '<textarea class="textarea textarea-lg" data-campo="wistia_embed" spellcheck="false" ' +
          'placeholder="Pega aquí el embed de Wistia tal cual te lo da (o solo el ID de 10 caracteres).">' +
          h(embed) + '</textarea>' +
          '<span class="hint">Se detecta solo si el embed es Aurora o Legacy, y se guarda el ID del vídeo. ' +
          'Puedes dejarlo vacío y añadirlo más tarde.</span></label>' +

        '<div class="row mb-4">' +
          '<button class="btn btn-secondary btn-sm" type="button" data-accion="validar-wistia">' +
            'Validar y ver vista previa</button>' +
        '</div>' +

        '<div id="wistia-estado-' + idx + '">' + estadoW + '</div>' +
        '<div class="video-shell hidden mt-4" id="wistia-preview-' + idx + '"></div>' +
        '<div class="text-xs text-faint mt-4 hidden" id="wistia-progreso-' + idx + '"></div>' +

        '<div class="field-row mt-4">' +
          '<label class="field mb-0"><span class="label">Orden <span class="req">*</span></span>' +
            '<input class="input" type="number" min="1" step="1" inputmode="numeric" ' +
            'data-campo="orden" value="' + h(orden) + '">' +
            '<span class="hint">No puede repetirse dentro del curso.</span></label>' +
        '</div>' +

        '<div class="row mt-4">' +
          '<button class="btn btn-primary btn-sm" type="button" data-accion="guardar-leccion">Guardar lección</button>' +
          '<button class="btn btn-danger btn-sm" type="button" data-accion="borrar-leccion">Borrar lección</button>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-accion="preguntas-de-leccion">Gestionar preguntas</button>' +
        '</div>' +
      '</div>';
  }

  function anadirLeccion(capa) {
    var maxOrden = 0;
    for (var i = 0; i < estado.lecciones.length; i++) {
      var o = parseInt(estado.lecciones[i].orden, 10);
      if (isFinite(o) && o > maxOrden) maxOrden = o;
    }
    estado.lecciones.push({
      id: null, titulo: '', descripcion: '', wistia_embed: '', wistia_video_id: null, orden: maxOrden + 1
    });
    renderLecciones(capa);

    var zona = capa.panel.querySelector('#zona-lecciones');
    var tarjetas = zona.querySelectorAll('[data-idx]');
    var ultima = tarjetas[tarjetas.length - 1];
    if (ultima) {
      var campo = ultima.querySelector('[data-campo="titulo"]');
      try { ultima.scrollIntoView({ block: 'center' }); } catch (e) { /* navegador antiguo */ }
      if (campo) campo.focus();
    }
  }

  function traducirErrorLeccion(e) {
    var m = texto(e && e.message ? e.message : e);
    if (/duplicate key|23505|unique/i.test(m)) {
      return 'Ya hay otra lección con ese número de orden en este curso. Cambia el orden e inténtalo otra vez.';
    }
    if (/row-level security|permission denied|violates row-level/i.test(m)) {
      return 'Tu cuenta no tiene permisos para modificar las lecciones de este curso.';
    }
    return A.traducirError(e);
  }

  async function guardarLeccion(capa, idx) {
    var l = estado.lecciones[idx];
    if (!l) return;

    var zonaEstado = capa.panel.querySelector('#wistia-estado-' + idx);
    var titulo = texto(l.titulo).trim();
    if (!titulo) {
      A.aviso('El título de la lección es obligatorio.', 'warn');
      var campo = capa.panel.querySelector('[data-idx="' + idx + '"] [data-campo="titulo"]');
      if (campo) campo.focus();
      return;
    }

    var orden = parseInt(l.orden, 10);
    if (!isFinite(orden) || orden < 1) {
      A.aviso('El orden debe ser un número entero mayor o igual que 1.', 'warn');
      return;
    }
    for (var i = 0; i < estado.lecciones.length; i++) {
      if (i !== idx && parseInt(estado.lecciones[i].orden, 10) === orden) {
        A.aviso('Ya hay otra lección con el orden ' + orden + '. Cada lección necesita un orden distinto.', 'warn');
        return;
      }
    }

    var embed = texto(l.wistia_embed).trim();
    var videoId = null;
    if (embed) {
      if (!window.WistiaLMS) {
        A.aviso('No se cargó el módulo de Wistia: no se puede comprobar el embed.', 'error');
        return;
      }
      var info = window.WistiaLMS.parsearEmbed(embed);
      if (!info.ok) {
        if (zonaEstado) zonaEstado.innerHTML = alertaHtml('Código de Wistia no válido: ' + info.error, 'danger');
        A.aviso('El código de Wistia no es válido. Corrígelo o bórralo antes de guardar.', 'error');
        return;
      }
      videoId = info.mediaId;
    }

    var datos = {
      titulo: titulo,
      descripcion: texto(l.descripcion).trim() || null,
      wistia_embed: embed || null,
      wistia_video_id: videoId,
      orden: orden
    };

    A.cargando(true, 'Guardando la lección…');
    try {
      if (l.id) {
        await A.db.actualizarLeccion(l.id, datos);
      } else {
        datos.curso_id = estado.cursoActual.id;
        var creada = await A.db.crearLeccion(datos);
        l.id = creada ? creada.id : null;
      }
      A.aviso('Lección guardada.', 'ok');
      await recargarLecciones(capa);
    } catch (e) {
      A.aviso(traducirErrorLeccion(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  async function borrarLeccion(capa, idx) {
    var l = estado.lecciones[idx];
    if (!l) return;

    var nombre = texto(l.titulo).trim() || ('Lección ' + (idx + 1));
    var extra = l.id ? ' También se borrará el progreso que los alumnos tengan en ella.' : '';
    if (!window.confirm('¿Borrar la lección «' + nombre + '»?' + extra)) return;

    if (!l.id) {
      // Una lección sin guardar no existe en la base de datos, así que ninguna
      // pregunta puede estar asociada a ella: basta con quitarla del editor.
      estado.lecciones.splice(idx, 1);
      renderLecciones(capa);
      return;
    }

    var idBorrado = l.id;
    A.cargando(true, 'Borrando la lección…');
    try {
      await A.db.borrarLeccion(idBorrado);
      A.aviso('Lección borrada.', 'ok');
      // Las preguntas asociadas quedan sin lección (ON DELETE SET NULL)
      for (var i = 0; i < estado.preguntas.length; i++) {
        if (estado.preguntas[i].leccion_id === idBorrado) {
          estado.preguntas[i].leccion_id = null;
          estado.preguntasSucias = true;
        }
      }
      await recargarLecciones(capa);
      renderPreguntas(capa);
    } catch (e) {
      A.aviso(A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  async function recargarLecciones(capa) {
    if (!estado.cursoActual) return;
    estado.lecciones = await A.db.lecciones(estado.cursoActual.id);
    renderLecciones(capa);
    await refrescarContadores(estado.cursoActual.id);
  }

  /* ------------------------------------------------------------- Wistia */

  function validarWistia(capa, idx, montar) {
    var l = estado.lecciones[idx];
    if (!l) return;
    var zona = capa.panel.querySelector('#wistia-estado-' + idx);
    var cont = capa.panel.querySelector('#wistia-preview-' + idx);

    if (!window.WistiaLMS) {
      if (zona) zona.innerHTML = alertaHtml('No se cargó el módulo de Wistia (assets/js/wistia-player.js).', 'danger');
      return;
    }

    var codigo = texto(l.wistia_embed).trim();
    if (!codigo) {
      l.wistia_video_id = null;
      if (zona) zona.innerHTML = alertaHtml('Pega el código embed de Wistia para esta lección.', 'info');
      if (cont) { cont.classList.add('hidden'); cont.innerHTML = ''; }
      return;
    }

    var info = window.WistiaLMS.parsearEmbed(codigo);
    if (!info.ok) {
      if (zona) zona.innerHTML = alertaHtml('Código de Wistia no válido: ' + info.error, 'danger');
      if (cont) { cont.classList.add('hidden'); cont.innerHTML = ''; }
      return;
    }

    // Se guarda el ID detectado; el embed se guarda tal cual lo pegó el administrador.
    l.wistia_video_id = info.mediaId;
    if (zona) zona.innerHTML = badgeWistiaHtml(info);
    if (montar && cont) montarPreview(capa, idx, cont, codigo, info);
  }

  function montarPreview(capa, idx, cont, codigo, info) {
    // Solo una vista previa montada a la vez: no tiene sentido cargar 20 reproductores.
    if (previewActiva !== null && previewActiva !== idx) {
      var previo = capa.panel.querySelector('#wistia-preview-' + previewActiva);
      if (previo) { previo.innerHTML = ''; previo.classList.add('hidden'); }
      var progPrevio = capa.panel.querySelector('#wistia-progreso-' + previewActiva);
      if (progPrevio) progPrevio.classList.add('hidden');
    }
    previewActiva = idx;

    cont.classList.remove('hidden');
    var prog = capa.panel.querySelector('#wistia-progreso-' + idx);
    if (prog) {
      prog.classList.remove('hidden');
      prog.textContent = 'Reproductor ' + (info.motor === 'legacy' ? 'Legacy' : 'Aurora') +
        ' montado. Reprodúcelo para comprobar que se ve bien.';
    }

    window.WistiaLMS.montar(cont, codigo, {
      color: 'FF6B00',
      onProgreso: function (pct) {
        if (prog) prog.textContent = 'Progreso de la vista previa: ' + Math.round(pct) + '%';
      },
      onFin: function () {
        if (prog) prog.textContent = 'El vídeo ha terminado: el reproductor funciona correctamente.';
      }
    }).then(function (manejador) {
      if (prog && manejador && manejador.advertencias && manejador.advertencias.length) {
        prog.textContent = manejador.advertencias.join(' ');
      }
    }).catch(function (e) {
      if (prog) prog.textContent = '';
      var zona = capa.panel.querySelector('#wistia-estado-' + idx);
      if (zona) zona.innerHTML = alertaHtml('No se pudo montar la vista previa: ' + A.traducirError(e), 'danger');
    });
  }

  function irAPreguntasDeLeccion(capa, idx) {
    var l = estado.lecciones[idx];
    if (!l) return;
    if (!l.id) {
      A.aviso('Guarda la lección primero: las preguntas se asocian a lecciones ya guardadas.', 'warn');
      return;
    }
    var asociadas = 0;
    for (var i = 0; i < estado.preguntas.length; i++) {
      if (estado.preguntas[i].leccion_id === l.id) asociadas++;
    }
    if (asociadas === 0) {
      anadirPregunta(capa, l.id);
      A.aviso('No había preguntas de esta lección: te he creado una en blanco ya asociada.', 'info');
    } else {
      A.aviso('Esta lección tiene ' + asociadas + ' pregunta(s). Se muestran marcadas en la lista de abajo.', 'info');
    }
    var zona = capa.panel.querySelector('#zona-preguntas');
    if (zona) { try { zona.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* opcional */ } }
  }

  /* ------------------------------------------------------------- preguntas */

  function marcarSucias(capa) {
    estado.preguntasSucias = true;
    actualizarContadorPreguntas(capa);
  }

  function actualizarContadorPreguntas(capa) {
    var el = capa.panel.querySelector('#contador-preguntas');
    if (!el) return;
    var n = estado.preguntas.length;
    el.textContent = n + (n === 1 ? ' pregunta cargada' : ' preguntas cargadas') +
      (estado.preguntasSucias ? ' · sin guardar' : '');
    var clases = 'badge';
    if (estado.preguntasSucias) clases += ' badge-warn';
    else if (n) clases += ' badge-ok';
    el.className = clases;
  }

  function renderPreguntas(capa, foco) {
    var zona = capa.panel.querySelector('#zona-preguntas');
    if (!zona) return;

    if (!estado.preguntas.length) {
      zona.innerHTML = vacioHtml('&#10067;', 'Todavía no hay preguntas',
        'Añádelas a mano o genera un borrador con IA a partir del texto de la lección.');
    } else {
      var html = '';
      for (var i = 0; i < estado.preguntas.length; i++) html += tarjetaPregunta(estado.preguntas[i], i);
      zona.innerHTML = html;
    }
    actualizarContadorPreguntas(capa);

    if (foco) {
      var bloque = zona.querySelector('[data-qidx="' + foco.qidx + '"]');
      if (bloque) {
        var campo = null;
        if (foco.campo === 'opcion') {
          var opciones = bloque.querySelectorAll('[data-campo-p="opcion"]');
          campo = opciones[foco.oidx] || null;
        } else {
          campo = bloque.querySelector('[data-campo-p="' + foco.campo + '"]');
        }
        if (campo) {
          try {
            campo.focus();
            if (campo.setSelectionRange && typeof campo.value === 'string') {
              campo.setSelectionRange(campo.value.length, campo.value.length);
            }
          } catch (e) { /* el campo puede no admitir selección */ }
        }
      }
    }
  }

  function tarjetaPregunta(q, qi) {
    var ops = '';
    for (var i = 0; i < q.opciones.length; i++) {
      var letra = String.fromCharCode(65 + i);
      var marcada = (Number(q.respuesta_correcta) === i);
      ops +=
        '<div class="quiz-opt' + (marcada ? ' is-picked' : '') + '" data-oidx="' + i + '">' +
          '<input type="radio" name="correcta-' + qi + '" value="' + i + '" data-accion="marcar-correcta"' +
            (marcada ? ' checked' : '') + ' aria-label="Marcar la opción ' + letra + ' como la correcta">' +
          '<span class="quiz-opt-key">' + letra + '</span>' +
          '<span style="flex:1 1 auto;min-width:0">' +
            '<input class="input" type="text" data-campo-p="opcion" data-oidx="' + i + '" ' +
            'value="' + h(q.opciones[i]) + '" aria-label="Texto de la opción ' + letra + '" ' +
            'placeholder="Texto de la opción ' + letra + '">' +
          '</span>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-accion="quitar-opcion" data-oidx="' + i + '"' +
            (q.opciones.length <= 2 ? ' disabled' : '') +
            ' aria-label="Quitar la opción ' + letra + '">&times;</button>' +
        '</div>';
    }

    var seleccion = '<option value="">— Sin lección concreta —</option>';
    for (var k = 0; k < estado.lecciones.length; k++) {
      var l = estado.lecciones[k];
      if (!l.id) continue;
      var etiqueta = texto(l.titulo).trim() || ('Lección ' + (l.orden || (k + 1)));
      seleccion += '<option value="' + h(l.id) + '"' + (q.leccion_id === l.id ? ' selected' : '') + '>' +
        h(etiqueta) + '</option>';
    }

    return '' +
      '<div class="quiz-q" data-qidx="' + qi + '">' +
        '<div class="quiz-q-head">' +
          '<span class="quiz-q-num">' + (qi + 1) + '</span>' +
          '<div style="flex:1 1 auto;min-width:0">' +
            '<label class="field mb-0"><span class="label">Enunciado <span class="req">*</span></span>' +
              '<input class="input" type="text" data-campo-p="pregunta" value="' + h(q.pregunta) + '" ' +
              'placeholder="¿Qué…?"></label>' +
          '</div>' +
          '<div class="row" style="align-items:flex-start">' +
            '<button class="btn btn-ghost btn-sm" type="button" data-accion="subir-pregunta"' +
              (qi === 0 ? ' disabled' : '') + ' aria-label="Subir la pregunta ' + (qi + 1) + '">&uarr;</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-accion="bajar-pregunta"' +
              (qi === estado.preguntas.length - 1 ? ' disabled' : '') +
              ' aria-label="Bajar la pregunta ' + (qi + 1) + '">&darr;</button>' +
            '<button class="btn btn-danger btn-sm" type="button" data-accion="borrar-pregunta" ' +
              'aria-label="Borrar la pregunta ' + (qi + 1) + '">&times;</button>' +
          '</div>' +
        '</div>' +

        '<div class="label">Opciones <span class="text-faint">(marca con el círculo cuál es la correcta)</span></div>' +
        ops +

        '<div class="row-between mt-4">' +
          '<button class="btn btn-ghost btn-sm" type="button" data-accion="anadir-opcion">+ Añadir opción</button>' +
          '<label class="field mb-0" style="min-width:240px">' +
            '<span class="label">Lección relacionada (opcional)</span>' +
            '<select class="select" data-campo-p="leccion_id">' + seleccion + '</select>' +
            '<span class="hint">Sirve para decirle al alumno qué repasar si falla.</span>' +
          '</label>' +
        '</div>' +

        '<label class="field mb-0 mt-4"><span class="label">Explicación (opcional)</span>' +
          '<textarea class="textarea textarea-plain" data-campo-p="explicacion" ' +
          'placeholder="Por qué la respuesta correcta lo es.">' + h(q.explicacion) + '</textarea></label>' +
      '</div>';
  }

  function preguntaVacia(leccionId) {
    return {
      id: null,
      leccion_id: leccionId || null,
      pregunta: '',
      opciones: ['', '', '', ''],
      respuesta_correcta: 0,
      explicacion: ''
    };
  }

  function anadirPregunta(capa, leccionId) {
    estado.preguntas.push(preguntaVacia(leccionId));
    marcarSucias(capa);
    renderPreguntas(capa, { qidx: estado.preguntas.length - 1, campo: 'pregunta' });
  }

  function borrarPregunta(capa, qi) {
    if (qi < 0 || !estado.preguntas[qi]) return;
    if (!window.confirm('¿Borrar la pregunta ' + (qi + 1) + '? Se quitará del editor (aún no está guardada).')) return;
    estado.preguntas.splice(qi, 1);
    marcarSucias(capa);
    renderPreguntas(capa);
  }

  function moverPregunta(capa, qi, delta) {
    var destino = qi + delta;
    if (qi < 0 || destino < 0 || destino >= estado.preguntas.length) return;
    var tmp = estado.preguntas[qi];
    estado.preguntas[qi] = estado.preguntas[destino];
    estado.preguntas[destino] = tmp;
    marcarSucias(capa);
    renderPreguntas(capa, { qidx: destino, campo: 'pregunta' });
  }

  function anadirOpcion(capa, qi) {
    var q = estado.preguntas[qi];
    if (!q) return;
    if (q.opciones.length >= 8) {
      A.aviso('Ocho opciones por pregunta es más que suficiente.', 'warn');
      return;
    }
    q.opciones.push('');
    marcarSucias(capa);
    renderPreguntas(capa, { qidx: qi, campo: 'opcion', oidx: q.opciones.length - 1 });
  }

  function quitarOpcion(capa, qi, oi) {
    var q = estado.preguntas[qi];
    if (!q) return;
    if (!(oi >= 0 && oi < q.opciones.length)) return;
    if (q.opciones.length <= 2) {
      A.aviso('Una pregunta necesita al menos 2 opciones.', 'warn');
      return;
    }
    q.opciones.splice(oi, 1);
    // Reajustamos cuál es la correcta para no apuntar a una opción que ya no existe
    if (Number(q.respuesta_correcta) === oi) q.respuesta_correcta = 0;
    else if (Number(q.respuesta_correcta) > oi) q.respuesta_correcta = Number(q.respuesta_correcta) - 1;
    marcarSucias(capa);
    renderPreguntas(capa);
  }

  function mostrarErroresEnEditor(capa, errores) {
    var zona = capa.panel.querySelector('#zona-preguntas');
    if (!zona) return;
    var previo = zona.querySelector('#errores-preguntas');
    if (previo && previo.parentNode) previo.parentNode.removeChild(previo);

    var lis = '';
    var max = Math.min(errores.length, 15);
    for (var i = 0; i < max; i++) lis += '<li>' + h(errores[i]) + '</li>';
    if (errores.length > max) lis += '<li>…y ' + (errores.length - max) + ' problema(s) más.</li>';

    var div = document.createElement('div');
    div.id = 'errores-preguntas';
    div.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
      '<strong>No se guardó nada.</strong> Corrige esto y vuelve a intentarlo:' +
      '<ul style="margin:8px 0 0;padding-left:20px">' + lis + '</ul></div></div>';
    zona.insertBefore(div, zona.firstChild);
    try { zona.scrollIntoView({ block: 'start', behavior: 'smooth' }); } catch (e) { /* opcional */ }
  }

  async function guardarPreguntas(capa, curso) {
    if (!estado.preguntas.length) {
      A.aviso('No hay preguntas en el editor. Si quieres dejar el examen vacío, usa «Borrar todas».', 'warn');
      return;
    }

    // Validación completa ANTES de tocar la base de datos: o todas o ninguna.
    var errores = [];
    var filas = [];
    for (var i = 0; i < estado.preguntas.length; i++) {
      var q = estado.preguntas[i];
      var n = i + 1;
      var preg = texto(q.pregunta).trim();
      if (!preg) errores.push('Pregunta ' + n + ': falta el enunciado.');

      var ops = [];
      for (var j = 0; j < q.opciones.length; j++) {
        var o = texto(q.opciones[j]).trim();
        if (!o) errores.push('Pregunta ' + n + ': la opción ' + String.fromCharCode(65 + j) + ' está vacía.');
        ops.push(o);
      }
      if (ops.length < 2) errores.push('Pregunta ' + n + ': necesita al menos 2 opciones.');

      var rc = Number(q.respuesta_correcta);
      if (!(rc >= 0 && rc < ops.length)) errores.push('Pregunta ' + n + ': no has marcado cuál es la opción correcta.');

      filas.push({
        curso_id: curso.id,
        leccion_id: q.leccion_id || null,
        pregunta: preg,
        opciones: ops,
        respuesta_correcta: rc,
        explicacion: texto(q.explicacion).trim() || null,
        orden: n
      });
    }

    if (errores.length) {
      mostrarErroresEnEditor(capa, errores);
      A.aviso('Revisa las preguntas: hay ' + errores.length + ' problema(s). No se guardó nada.', 'error');
      return;
    }

    // Aviso nacido de probar el flujo real contra la base de datos:
    // si una pregunta no esta vinculada a una leccion, el alumno que suspenda por
    // ella NO recibira el boton "Repasar Leccion", porque el servidor no sabe a que
    // video mandarlo (calificar_test solo devuelve leccion_repaso si leccion_id
    // tiene valor). No lo bloqueamos, porque tener preguntas generales es legitimo,
    // pero el administrador tiene que enterarse.
    var sinLeccion = 0;
    for (var k = 0; k < filas.length; k++) { if (!filas[k].leccion_id) sinLeccion++; }

    var preguntaConfirmacion = 'Se guardaran ' + filas.length +
      ' preguntas y se sustituiran las anteriores de este curso. ¿Continuar?';

    if (sinLeccion > 0) {
      preguntaConfirmacion =
        sinLeccion + ' de las ' + filas.length + ' preguntas no estan vinculadas a ninguna leccion.\n\n' +
        'Si un alumno suspende por una de esas preguntas NO vera el boton «Repasar Leccion», ' +
        'porque el sistema no sabe a que video mandarlo.\n\n' +
        'Se vinculan desde «Gestionar preguntas» dentro de cada leccion.\n\n' +
        '¿Guardar de todas formas?';
    }

    if (!window.confirm(preguntaConfirmacion)) return;

    A.cargando(true, 'Guardando las preguntas…');
    var borrado = false;
    try {
      await A.db.borrarPreguntasDeCurso(curso.id);
      borrado = true;
      await A.db.crearPreguntas(filas);
      estado.preguntasSucias = false;
      A.aviso('Se guardaron ' + filas.length + ' preguntas.', 'ok');
      if (sinLeccion > 0) {
        A.aviso(sinLeccion + ' pregunta(s) sin leccion vinculada: si un alumno suspende por ' +
                'ellas no vera el boton para repasar el video.', 'warn', 9000);
      }
      await cargarDatosCurso(capa, curso);   // recargamos para tener los ids reales
    } catch (e) {
      var msg = A.traducirError(e);
      if (borrado) {
        msg = 'Se borraron las preguntas anteriores pero NO se pudieron guardar las nuevas: ' + msg +
              ' Tus preguntas siguen en el editor, pulsa «Guardar preguntas» otra vez.';
      }
      A.aviso(msg, 'error');
    } finally {
      A.cargando(false);
    }
  }

  async function borrarTodasPreguntas(capa, curso) {
    if (!estado.preguntas.length) {
      A.aviso('No hay preguntas que borrar.', 'info');
      return;
    }
    if (!window.confirm('¿Borrar TODAS las preguntas del examen de este curso? No se puede deshacer.')) return;
    if (!window.confirm('Confirma otra vez: se borrarán ' + estado.preguntas.length +
      ' preguntas de la base de datos y del editor.')) return;

    A.cargando(true, 'Borrando las preguntas…');
    try {
      await A.db.borrarPreguntasDeCurso(curso.id);
      estado.preguntas = [];
      estado.preguntasSucias = false;
      renderPreguntas(capa);
      A.aviso('Se borraron todas las preguntas del curso.', 'ok');
    } catch (e) {
      A.aviso(A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  /* ============================================================
     GENERAR PREGUNTAS CON IA
     ============================================================ */

  /**
   * Dos vías, honestas y sin claves en el navegador:
   *   1. Si APRENDO.cfg.AI_ENDPOINT está definido, se le pide a ese servicio.
   *   2. Si no está (o si falla), se entrega la instrucción lista para pegar en
   *      la IA del administrador y se valida el JSON que devuelva.
   * Nunca se generan preguntas desde el código.
   */
  function abrirGeneradorIA(capaLecciones) {
    var ta = capaLecciones.panel.querySelector('#ia-texto');
    var fuente = ta ? texto(ta.value).trim() : '';
    if (!fuente) {
      A.aviso('Pega primero el texto de la lección o el tema.', 'warn');
      if (ta) ta.focus();
      return;
    }

    var opcionesLeccion = '<option value="">— Sin lección concreta —</option>';
    for (var i = 0; i < estado.lecciones.length; i++) {
      var l = estado.lecciones[i];
      if (!l.id) continue;
      var etiqueta = texto(l.titulo).trim() || ('Lección ' + (l.orden || (i + 1)));
      opcionesLeccion += '<option value="' + h(l.id) + '">' + h(etiqueta) + '</option>';
    }

    var html =
      '<h2>Generar Preguntas con IA</h2>' +
      '<p class="text-muted text-sm">Objetivo: unas 30 preguntas de opción múltiple a partir del texto que has pegado.</p>' +
      '<label class="field"><span class="label">Asociar las preguntas a una lección (opcional)</span>' +
        '<select class="select" id="ia-leccion">' + opcionesLeccion + '</select>' +
        '<span class="hint">Es lo que le dice al alumno qué lección repasar si falla la pregunta.</span></label>' +
      '<div id="ia-cuerpo"></div>' +
      '<div class="text-center mt-4">' +
        '<button class="btn-link text-faint" type="button" data-accion="cerrar-ia">Cerrar</button>' +
      '</div>';

    var capa = crearCapa({
      tipo: 'modal',
      titulo: 'Generar Preguntas con IA',
      html: html
    });

    // El texto se guarda en la capa: el cuerpo se repinta si el endpoint falla.
    capa.fuenteIA = fuente;
    // Las preguntas se cargan en el editor del drawer, no en este modal.
    capa.capaEditor = capaLecciones;

    // Un único listener de clics, aunque el cuerpo se repinte.
    capa.panel.addEventListener('click', function (e) {
      var b = ancestroConAccion(e.target, capa.panel);
      if (!b) return;
      var accion = b.getAttribute('data-accion');
      if (accion === 'copiar-prompt') {
        copiarAlPortapapeles(construirPromptIA(capa.fuenteIA))
          .then(function () { A.aviso('Instrucción copiada. Pégala en tu IA y trae de vuelta el JSON.', 'ok'); })
          .catch(function () { A.aviso('No se pudo copiar solo: selecciona el texto y cópialo a mano.', 'warn'); });
      } else if (accion === 'cargar-json') {
        cargarJsonIA(capa);
      } else if (accion === 'cerrar-ia') {
        capa.cerrar(true);
      }
    });

    var cuerpo = capa.panel.querySelector('#ia-cuerpo');
    var endpoint = (A.cfg && A.cfg.AI_ENDPOINT) ? String(A.cfg.AI_ENDPOINT) : '';

    if (endpoint) {
      cuerpo.innerHTML = '<div class="alert alert-info mb-4"><span class="alert-icon">&#9881;</span>' +
        '<div class="alert-body">Consultando el servicio de IA configurado…</div></div>' +
        '<div class="text-center"><span class="spinner spinner-lg" style="display:inline-block"></span></div>';
      pedirAlEndpoint(endpoint, capa, cuerpo);
    } else {
      cuerpo.innerHTML = vistaManualIA('sin-endpoint', '');
    }
  }

  function pedirAlEndpoint(endpoint, capa, cuerpo) {
    var leccionId = valorSelect(capa.panel, '#ia-leccion');
    var curso = estado.cursoActual;
    var cuerpoPeticion = {
      texto: capa.fuenteIA,
      cantidad: 30,
      curso: curso ? { id: curso.id, nombre: curso.nombre, slug: curso.slug } : null,
      leccion: leccionId || null
    };

    // Sin fetch (navegador muy antiguo) se va directo a la vía manual.
    if (!window.fetch) {
      cuerpo.innerHTML = vistaManualIA('fallo-endpoint', 'este navegador no soporta fetch');
      return;
    }

    window.fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpoPeticion)
    }).then(function (r) {
      if (!r.ok) throw new Error('el servicio respondió con HTTP ' + r.status);
      return r.json();
    }).then(function (datos) {
      // El servicio puede devolver el objeto ya parseado o el JSON como texto.
      var analisis;
      if (typeof datos === 'string') {
        analisis = analizarPreguntas(extraerJson(datos));
      } else {
        analisis = analizarPreguntas(datos);
      }
      if (!analisis.ok) {
        throw new Error('las preguntas recibidas no pasan la validación (' + analisis.errores[0] + ')');
      }
      // Las preguntas se cargan en el editor del drawer, no en este modal.
      aplicarPreguntasIA(analisis.preguntas, leccionId, capa.capaEditor);
      capa.cerrar(true);
    }).catch(function (e) {
      // Vía 2: siempre queda el camino manual.
      cuerpo.innerHTML = vistaManualIA('fallo-endpoint', texto(e && e.message ? e.message : e));
    });
  }

  function valorSelect(raiz, sel) {
    var el = raiz.querySelector(sel);
    return el ? el.value : '';
  }

  function vistaManualIA(motivo, detalle) {
    var aviso = '';
    if (motivo === 'sin-endpoint') {
      aviso = '<div class="alert alert-info mb-4"><span class="alert-icon">&#8505;</span><div class="alert-body">' +
        'No hay ningún servicio de IA configurado (<code>APRENDO.cfg.AI_ENDPOINT</code>), y una clave de IA ' +
        'en el navegador sería un fallo de seguridad. Usa la vía manual: funciona hoy mismo y no cuesta nada.' +
        '</div></div>';
    } else if (motivo === 'fallo-endpoint') {
      aviso = '<div class="alert alert-warn mb-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
        'El servicio de IA no sirvió las preguntas' + (detalle ? ': ' + h(detalle) : '') +
        '. Usa la vía manual.</div></div>';
    }

    return aviso +
      '<div class="card card-inset card-pad-sm mb-4">' +
        '<div class="label">Cómo se hace</div>' +
        '<ol class="text-sm text-muted" style="margin:0;padding-left:22px">' +
          '<li>Pulsa <strong>Copiar instrucción para la IA</strong>.</li>' +
          '<li>Pégala en tu IA (ChatGPT, Claude, Cursor…).</li>' +
          '<li>Copia la respuesta JSON que te devuelva.</li>' +
          '<li>Pégala aquí abajo y pulsa <strong>Cargar preguntas</strong>.</li>' +
        '</ol>' +
        '<button class="btn btn-primary btn-block mt-4" type="button" data-accion="copiar-prompt">' +
          'Copiar instrucción para la IA</button>' +
      '</div>' +

      '<label class="field"><span class="label">Pega aquí la respuesta JSON de la IA</span>' +
        '<textarea class="textarea textarea-lg" id="ia-respuesta" spellcheck="false" ' +
        'placeholder=\'{"preguntas":[{"pregunta":"...","opciones":["a","b","c","d"],"respuesta_correcta":0,"explicacion":"..."}]}\'>' +
        '</textarea>' +
        '<span class="hint">Se aceptan cercos de Markdown, un objeto {"preguntas":[…]} o un array […]. ' +
        'Se validan <strong>todas</strong> antes de cargar ninguna: si una falla, no se carga nada.</span></label>' +

      '<div id="ia-errores"></div>' +
      '<button class="btn btn-primary btn-block" type="button" data-accion="cargar-json">Cargar preguntas</button>';
  }

  function construirPromptIA(fuente) {
    return [
      'Actúa como diseñador instruccional. A partir del TEXTO del final, genera exactamente 30 preguntas de opción múltiple en español.',
      '',
      'REGLAS',
      '1. Cada pregunta tiene 4 opciones y una sola respuesta correcta.',
      '2. Cubre todo el texto, en el mismo orden en que aparecen los contenidos.',
      '3. No repitas preguntas ni uses "todas las anteriores" / "ninguna de las anteriores".',
      '4. Las opciones incorrectas deben ser verosímiles, no absurdas.',
      '5. Añade una explicación breve (1-2 frases) de por qué la opción correcta lo es.',
      '6. Devuelve ÚNICAMENTE el JSON: sin texto antes ni después y sin cercos de código.',
      '',
      'FORMATO EXACTO',
      '{"preguntas":[{"pregunta":"...","opciones":["a","b","c","d"],"respuesta_correcta":0,"explicacion":"..."}]}',
      '',
      'IMPORTANTE: "respuesta_correcta" es el ÍNDICE (base 0) de la opción correcta dentro del array "opciones" ' +
      '(0 = primera, 1 = segunda, 2 = tercera, 3 = cuarta). No pongas la letra ni el texto de la opción.',
      '',
      'TEXTO:',
      '"""',
      fuente,
      '"""'
    ].join('\n');
  }

  function copiarAlPortapapeles(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(t);
    }
    // Respaldo para contextos donde la API de portapapeles no está disponible
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = t;
        ta.setAttribute('readonly', 'readonly');
        ta.style.cssText = 'position:fixed;top:-1000px;left:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        if (ok) resolve(); else reject(new Error('El navegador bloqueó la copia.'));
      } catch (e) {
        reject(e);
      }
    });
  }

  function cargarJsonIA(capa) {
    var ta = capa.panel.querySelector('#ia-respuesta');
    var zonaErr = capa.panel.querySelector('#ia-errores');
    var bruto = ta ? ta.value : '';
    if (!texto(bruto).trim()) {
      zonaErr.innerHTML = alertaHtml('Pega primero la respuesta JSON de la IA.', 'danger');
      return;
    }

    var datos;
    try {
      datos = extraerJson(bruto);
    } catch (e) {
      zonaErr.innerHTML = alertaHtml(e.message, 'danger');
      return;
    }

    var analisis = analizarPreguntas(datos);
    if (!analisis.ok) {
      var lis = '';
      var max = Math.min(analisis.errores.length, 12);
      for (var i = 0; i < max; i++) lis += '<li>' + h(analisis.errores[i]) + '</li>';
      var resto = analisis.errores.length - max;

      zonaErr.innerHTML =
        '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
        '<strong>No se cargó ninguna pregunta.</strong><br>' +
        analisis.validas + ' de ' + analisis.total + ' preguntas eran válidas y ' + analisis.errores.length +
        ' tenían problemas:' +
        '<ul style="margin:8px 0 0;padding-left:20px">' + lis +
        (resto > 0 ? '<li>…y ' + resto + ' problema(s) más.</li>' : '') +
        '</ul></div></div>';
      A.aviso('El JSON tiene ' + analisis.errores.length + ' problema(s): no se cargó nada.', 'error');
      return;
    }

    var leccionId = valorSelect(capa.panel, '#ia-leccion');
    aplicarPreguntasIA(analisis.preguntas, leccionId, capa.capaEditor);
    capa.cerrar(true);
  }

  /** Quita cercos de Markdown y recorta hasta el primer { o [ y el último } o ]. */
  function limpiarJson(t) {
    var s = texto(t).replace(/```[a-zA-Z]*/g, '').replace(/```/g, '');
    var iLlave = s.indexOf('{');
    var iCorchete = s.indexOf('[');
    var ini = -1;
    if (iLlave > -1 && iCorchete > -1) ini = Math.min(iLlave, iCorchete);
    else if (iLlave > -1) ini = iLlave;
    else ini = iCorchete;

    var fLlave = s.lastIndexOf('}');
    var fCorchete = s.lastIndexOf(']');
    var fin = Math.max(fLlave, fCorchete);

    if (ini === -1 || fin === -1 || fin < ini) return null;
    return s.slice(ini, fin + 1);
  }

  function extraerJson(t) {
    var recorte = limpiarJson(t);
    if (!recorte) {
      throw new Error('No se encontró ningún JSON en el texto pegado: falta la llave { … } o el corchete [ … ].');
    }
    try {
      return JSON.parse(recorte);
    } catch (e) {
      throw new Error('El JSON pegado no es válido (' + (e && e.message ? e.message : 'error de sintaxis') + ').');
    }
  }

  function describirValor(v) {
    var s;
    try { s = JSON.stringify(v); } catch (e) { s = texto(v); }
    if (s === undefined) s = texto(v);
    if (s.length > 40) s = s.slice(0, 40) + '…';
    return s;
  }

  /**
   * Acepta 0 (índice), "2" (índice en texto), "A" (letra) o el texto exacto de
   * una opción. Devuelve -1 si no se puede resolver.
   */
  function indiceRespuesta(valor, opciones) {
    var n = opciones.length;
    if (typeof valor === 'number' && isFinite(valor) && Math.floor(valor) === valor && valor >= 0 && valor < n) {
      return valor;
    }
    if (typeof valor === 'string') {
      var v = valor.trim();
      if (/^[A-Za-z]$/.test(v)) {
        var porLetra = v.toUpperCase().charCodeAt(0) - 65;
        return (porLetra >= 0 && porLetra < n) ? porLetra : -1;
      }
      if (/^\d+$/.test(v)) {
        var k = parseInt(v, 10);
        return (k >= 0 && k < n) ? k : -1;
      }
      for (var i = 0; i < n; i++) {
        if (opciones[i].toLowerCase() === v.toLowerCase()) return i;
      }
    }
    return -1;
  }

  /**
   * Valida la lista de preguntas. Todo o nada: solo devuelve ok=true si TODAS
   * son válidas. Cada error dice la pregunta y el campo que falla.
   */
  function analizarPreguntas(datos) {
    var res = { ok: false, preguntas: [], errores: [], total: 0, validas: 0 };
    var lista = null;

    if (esArray(datos)) lista = datos;
    else if (datos && esArray(datos.preguntas)) lista = datos.preguntas;

    if (!lista) {
      res.errores.push('La estructura no es la esperada: se esperaba {"preguntas":[…]} o un array […].');
      return res;
    }
    res.total = lista.length;
    if (!lista.length) {
      res.errores.push('La lista de preguntas está vacía.');
      return res;
    }

    for (var i = 0; i < lista.length; i++) {
      var n = i + 1;
      var cruda = lista[i];

      if (!cruda || typeof cruda !== 'object') {
        res.errores.push('Pregunta ' + n + ': no es un objeto.');
        continue;
      }

      var pregunta = typeof cruda.pregunta === 'string' ? cruda.pregunta.trim() : '';
      if (!pregunta) {
        res.errores.push('Pregunta ' + n + ': el campo «pregunta» está vacío o no es texto.');
        continue;
      }

      if (!esArray(cruda.opciones)) {
        res.errores.push('Pregunta ' + n + ': el campo «opciones» debe ser un array de textos.');
        continue;
      }

      var opciones = [];
      var opcionMala = false;
      for (var j = 0; j < cruda.opciones.length; j++) {
        if (typeof cruda.opciones[j] !== 'string' || !cruda.opciones[j].trim()) { opcionMala = true; break; }
        opciones.push(cruda.opciones[j].trim());
      }
      if (opcionMala) {
        res.errores.push('Pregunta ' + n + ': «opciones» contiene un valor vacío o que no es texto.');
        continue;
      }
      if (opciones.length < 2) {
        res.errores.push('Pregunta ' + n + ': «opciones» necesita al menos 2 opciones (tiene ' + opciones.length + ').');
        continue;
      }

      var idx = indiceRespuesta(cruda.respuesta_correcta, opciones);
      if (idx === -1) {
        res.errores.push('Pregunta ' + n + ': «respuesta_correcta» (' + describirValor(cruda.respuesta_correcta) +
          ') no es un índice entre 0 y ' + (opciones.length - 1) + ', ni la letra ni el texto de una opción.');
        continue;
      }

      var explicacion = typeof cruda.explicacion === 'string' ? cruda.explicacion.trim() : '';
      var leccionId = (typeof cruda.leccion_id === 'string' && cruda.leccion_id.trim()) ? cruda.leccion_id.trim() : null;

      res.preguntas.push({
        id: null,
        leccion_id: leccionId,
        pregunta: pregunta,
        opciones: opciones,
        respuesta_correcta: idx,
        explicacion: explicacion
      });
    }

    res.validas = res.preguntas.length;
    res.ok = res.errores.length === 0 && res.validas > 0;

    // Todo o nada, garantizado aquí mismo: si algo falló no se devuelve ninguna
    // pregunta, así ningún llamador puede cargar media lista por descuido.
    if (!res.ok) res.preguntas = [];
    return res;
  }

  /** capaEditor es el drawer de lecciones: ahí vive el editor de preguntas. */
  function aplicarPreguntasIA(lista, leccionId, capaEditor) {
    for (var i = 0; i < lista.length; i++) {
      var p = lista[i];
      estado.preguntas.push({
        id: null,
        leccion_id: p.leccion_id || leccionId || null,
        pregunta: p.pregunta,
        opciones: p.opciones.slice(),
        respuesta_correcta: p.respuesta_correcta,
        explicacion: p.explicacion || ''
      });
    }
    estado.preguntasSucias = true;
    renderPreguntas(capaEditor);
    A.aviso('Se cargaron ' + lista.length + ' preguntas en el editor. Revísalas y pulsa «Guardar preguntas».', 'ok');
  }

  /* ============================================================
     DRAWER: INSCRIBIR ALUMNOS
     ============================================================ */

  function abrirInscritos(curso) {
    var html =
      '<div class="alert alert-info mb-4"><span class="alert-icon">&#8505;</span><div class="alert-body">' +
        'La inscripción es lo que da acceso: <strong>sin inscripción activa, el alumno no puede ver las lecciones.</strong><br>' +
        'Escribe el <strong>UUID</strong> del alumno o el <strong>correo</strong> con el que se registró.' +
      '</div></div>' +

      '<label class="field"><span class="label">UUID del alumno o correo electrónico</span>' +
        '<input class="input" type="text" id="in-quien" autocomplete="off" spellcheck="false" ' +
        'placeholder="alumno@correo.com  ·  00000000-0000-0000-0000-000000000000"></label>' +
      '<div id="in-error"></div>' +
      '<div id="in-lista" class="mt-4">' + cargaHtml('Cargando inscritos…') + '</div>';

    var pie =
      '<button class="btn btn-ghost" type="button" data-accion="cerrar-capa">Cerrar</button>' +
      '<button class="btn btn-primary" type="button" data-accion="inscribir">Inscribir alumno</button>';

    var capa = crearCapa({
      tipo: 'drawer',
      titulo: 'Inscribir alumnos · ' + (texto(curso.nombre).trim() || texto(curso.slug)),
      html: html,
      pieHtml: pie
    });

    capa.panel.addEventListener('click', function (e) {
      var b = ancestroConAccion(e.target, capa.panel);
      if (!b) return;
      if (b.getAttribute('data-accion') === 'inscribir') inscribirAlumno(capa, curso);
    });

    var inp = capa.panel.querySelector('#in-quien');
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); inscribirAlumno(capa, curso); }
    });

    cargarInscritos(capa, curso);
  }

  async function cargarInscritos(capa, curso) {
    var zona = capa.panel.querySelector('#in-lista');
    try {
      var lista = await A.db.listarInscritos(curso.id);
      estado.inscritosPorCurso[curso.id] = lista.length;
      pintarStats();
      renderCursos();
      zona.innerHTML = tablaInscritos(lista);
    } catch (e) {
      zona.innerHTML = alertaHtml('No se pudieron cargar los inscritos: ' + A.traducirError(e), 'danger');
      A.aviso(A.traducirError(e), 'error');
    }
  }

  function tablaInscritos(lista) {
    if (!lista.length) {
      return vacioHtml('&#128100;', 'Todavía no hay nadie inscrito',
        'Escribe arriba un correo o un UUID y pulsa <strong>Inscribir alumno</strong>.');
    }

    var filas = '';
    for (var i = 0; i < lista.length; i++) {
      var ins = lista[i] || {};
      var perfil = ins.perfiles || {};
      var nombre = texto(perfil.nombre_completo).trim() || '(sin nombre)';
      var correo = texto(perfil.email).trim() || '—';
      var st = texto(ins.estado) || 'activa';
      var clase = st === 'activa' ? 'badge-ok' : (st === 'pausada' ? 'badge-warn' : 'badge-danger');

      filas += '<tr>' +
        '<td>' + h(nombre) + '</td>' +
        '<td>' + h(correo) + '</td>' +
        '<td><span class="badge ' + clase + '"><span class="badge-dot"></span>' + h(st) + '</span></td>' +
        '<td class="nowrap">' + h(A.formatearFecha(ins.creado_en)) + '</td>' +
        '</tr>';
    }

    return '<div class="table-wrap"><table class="data">' +
      '<thead><tr><th>Alumno</th><th>Correo</th><th>Estado</th><th>Fecha</th></tr></thead>' +
      '<tbody>' + filas + '</tbody>' +
      '</table></div>' +
      '<p class="text-faint text-xs mt-4">Para pausar o reembolsar una inscripción, cámbialo en la tabla ' +
      '<code>inscripciones</code> de Supabase.</p>';
  }

  async function inscribirAlumno(capa, curso) {
    var inp = capa.panel.querySelector('#in-quien');
    var zonaError = capa.panel.querySelector('#in-error');
    var quien = inp.value.trim();
    zonaError.innerHTML = '';

    if (!quien) {
      zonaError.innerHTML = alertaHtml('Escribe un UUID o un correo electrónico.', 'danger');
      inp.focus();
      return;
    }
    if (quien.indexOf('@') === -1 && !/^[0-9a-fA-F-]{36}$/.test(quien)) {
      zonaError.innerHTML = alertaHtml('Eso no parece ni un correo ni un UUID de usuario. Revísalo.', 'danger');
      inp.focus();
      return;
    }

    A.cargando(true, 'Inscribiendo al alumno…');
    try {
      await A.db.inscribir(quien, curso.id);
      inp.value = '';
      A.aviso('Alumno inscrito: ya tiene acceso al curso.', 'ok');
      await cargarInscritos(capa, curso);
    } catch (e) {
      var msg = A.traducirError(e);
      zonaError.innerHTML = alertaHtml(msg, 'danger');
      A.aviso(msg, 'error');
    } finally {
      A.cargando(false);
    }
  }

  /* ============================================================
     AJUSTES
     ============================================================ */

  function renderAjustes() {
    var a = estado.ajustes || {};
    var nombre = document.getElementById('aj-nombre');
    var firma = document.getElementById('aj-firma');
    var logo = document.getElementById('aj-logo');
    if (nombre) nombre.value = texto(a.nombre_academia);
    if (firma) firma.value = texto(a.firma_url);
    if (logo) logo.value = texto(a.logo_url);
    actualizarPreview('prev-firma', a.firma_url);
    actualizarPreview('prev-logo', a.logo_url);
  }

  /** Muestra la imagen solo si carga; si no, la oculta sin romper nada. */
  function actualizarPreview(id, url) {
    var img = document.getElementById(id);
    if (!img) return;
    var limpia = texto(url).trim();
    if (!limpia) {
      img.classList.add('hidden');
      img.removeAttribute('src');
      return;
    }
    img.onload = function () { img.classList.remove('hidden'); };
    img.onerror = function () { img.classList.add('hidden'); };
    img.src = limpia;
  }

  async function guardarAjustes(e) {
    e.preventDefault();
    var nombre = document.getElementById('aj-nombre');
    var firma = document.getElementById('aj-firma');
    var logo = document.getElementById('aj-logo');
    var btn = document.getElementById('btn-guardar-ajustes');

    var valorNombre = nombre.value.trim();
    if (!valorNombre) {
      A.aviso('El nombre de la academia es obligatorio: sale en el certificado.', 'warn');
      nombre.focus();
      return;
    }

    var cambios = {
      nombre_academia: valorNombre,
      firma_url: firma.value.trim() || null,
      logo_url: logo.value.trim() || null
    };

    var textoBoton = btn ? btn.textContent : '';
    if (btn) { btn.setAttribute('disabled', 'disabled'); btn.textContent = 'Guardando…'; }
    A.cargando(true, 'Guardando los ajustes…');
    try {
      estado.ajustes = await A.db.actualizarAjustes(cambios);
      // La cabecera y el pie usan cfg.ACADEMY_NAME: lo actualizamos en memoria.
      if (A.cfg) A.cfg.ACADEMY_NAME = valorNombre;
      if (window.UI) window.UI.header({ activo: 'admin' });
      A.aviso('Ajustes guardados.', 'ok');
    } catch (err) {
      A.aviso(A.traducirError(err), 'error');
    } finally {
      A.cargando(false);
      if (btn) { btn.removeAttribute('disabled'); btn.textContent = textoBoton; }
    }
  }

  /* ============================================================
     ARRANQUE
     ============================================================ */

  function conectarEventos() {
    var btnNuevo = document.getElementById('btn-nuevo-curso');
    if (btnNuevo) btnNuevo.addEventListener('click', function () { abrirCurso(null); });

    var tabCursos = document.getElementById('tab-cursos');
    if (tabCursos) tabCursos.addEventListener('click', function () { cambiarTab('cursos'); });
    var tabAjustes = document.getElementById('tab-ajustes');
    if (tabAjustes) tabAjustes.addEventListener('click', function () { cambiarTab('ajustes'); });

    var lista = document.getElementById('lista-cursos');
    if (lista) lista.addEventListener('click', alClicEnCursos);

    var form = document.getElementById('form-ajustes');
    if (form) form.addEventListener('submit', guardarAjustes);

    var firma = document.getElementById('aj-firma');
    if (firma) firma.addEventListener('input', function () { actualizarPreview('prev-firma', firma.value); });
    var logo = document.getElementById('aj-logo');
    if (logo) logo.addEventListener('input', function () { actualizarPreview('prev-logo', logo.value); });
  }

  document.addEventListener('DOMContentLoaded', async function () {
    // Si falta config.js o supabase-client.js, esos scripts ya avisan en pantalla.
    if (!window.APRENDO || !window.APRENDO.db || !window.UI) return;

    A = window.APRENDO;

    var sesion = await UI.exigirAdmin();   // redirige o muestra "sin permisos" si no es admin
    if (!sesion) return;
    await UI.iniciar('admin');

    conectarEventos();

    try {
      A.cargando(true, 'Cargando el panel…');
      await cargarPanel();
    } catch (e) {
      A.aviso(A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  });
  /* ------------------------------------------------- enganche para las pruebas */
  // Expone UNICAMENTE funciones puras (sin estado, sin tocar la interfaz ni la
  // base de datos) para que _tools/test-admin.js pueda probarlas.
  //
  // Solo se activa si la prueba lo pide expresamente, asi que al abrir el panel
  // en el navegador no existe nada de esto. Se limita a las dos partes mas
  // delicadas: la normalizacion del slug y la validacion del JSON que devuelve
  // la IA, que es donde un fallo silencioso haria mas dano.
  if (window.__APRENDO_EXPONER_PARA_PRUEBAS__) {
    window.__PRUEBAS_ADMIN__ = {
      sinAcentos: sinAcentos,
      normalizarSlug: normalizarSlug,
      normalizarSlugSuave: normalizarSlugSuave,
      slugValido: slugValido,
      limpiarJson: limpiarJson,
      extraerJson: extraerJson,
      indiceRespuesta: indiceRespuesta,
      analizarPreguntas: analizarPreguntas,
      esArray: esArray,
      texto: texto
    };
  }
})();
