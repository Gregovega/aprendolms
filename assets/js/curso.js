/* ============================================================================
   APRENDO LMS — Página del curso (experiencia del alumno)
   ============================================================================
   Implementa los requisitos 2 y 3 del prompt maestro:
     1. Control de acceso: solo alumnos con inscripción activa (o admin).
     2. Desbloqueo secuencial: la lección N+1 se abre al completar la N.
        "Completar" = haber visto >= 90% del video.
     3. Progreso guardado en la tabla progress de Supabase.
     4. Examen al final; >= 80% desbloquea el certificado.
   ============================================================================ */
(function () {
  'use strict';

  var UMBRAL_VISTO = 90;   // % de video necesario para dar la lección por vista
  var A, curso, lecciones = [], progreso = {}, ajustes = null, alumno = null;
  var idxActual = 0, esAdmin = false, montajeActual = null, guardadoPendiente = null;

  function $(id) { return document.getElementById(id); }
  function h(s) { return A ? A.escaparHtml(s) : String(s == null ? '' : s); }

  /* ============================================================ arranque */
  document.addEventListener('DOMContentLoaded', async function () {
    A = window.APRENDO;
    if (!A) return;
    await UI.iniciar('cursos');

    var slug = A.resolverSlug();
    if (!slug) {
      return errorFatal('No se indicó ningún curso.',
        'Abre el curso desde su enlace: <code>curso.html?slug=nombre-del-curso</code>, ' +
        'o desde el subdominio del curso.');
    }

    try {
      curso = await A.db.cursoPorSlug(slug);
    } catch (e) {
      return errorFatal('No se pudo cargar el curso', A.traducirError(e));
    }

    if (!curso) {
      return errorFatal('Ese curso no existe',
        'No encontramos ningún curso con la dirección <code>' + h(slug) + '</code>.');
    }

    document.title = curso.nombre + ' · Aprendo LMS';
    $('titulo-curso').textContent = curso.nombre;
    $('desc-curso').textContent = curso.descripcion || '';
    if (!curso.descripcion) $('desc-curso').hidden = true;

    /* ---- sesión ---- */
    var sesion = await A.auth.sesion();
    if (!sesion) {
      return exigirLogin();
    }

    esAdmin = await A.auth.esAdmin();

    /* ---- control de acceso ---- */
    var tieneAcceso = esAdmin || await A.db.tengoAcceso(curso.id);
    if (!tieneAcceso) {
      return sinAcceso();
    }

    /* ---- datos del alumno y ajustes ---- */
    try {
      var rp = await A.client.from('perfiles').select('nombre_completo, email').eq('id', sesion.user.id).maybeSingle();
      alumno = rp.data || { nombre_completo: sesion.user.email, email: sesion.user.email };
      ajustes = await A.db.ajustes();
    } catch (e) { /* no es bloqueante */ }

    /* ---- lecciones y progreso ---- */
    try {
      lecciones = await A.db.lecciones(curso.id);
      var filas = await A.db.miProgreso(curso.id);
      filas.forEach(function (f) { progreso[f.leccion_id] = f; });
    } catch (e) {
      return errorFatal('No se pudieron cargar las lecciones', A.traducirError(e));
    }

    if (!lecciones.length) {
      return errorFatal('Este curso todavía no tiene lecciones',
        'El administrador debe añadirlas desde el panel de administración.');
    }

    $('cargando-zona').hidden = true;
    $('hero-curso').hidden = false;
    $('layout').hidden = false;
    $('badge-lecciones').textContent = lecciones.length + (lecciones.length === 1 ? ' lección' : ' lecciones');
    $('caja-examen').hidden = false;

    pintarLista();
    actualizarProgresoUI();

    // Abrir la primera lección desbloqueada que no esté completada
    var inicial = 0;
    for (var i = 0; i < lecciones.length; i++) {
      if (!estaCompletada(i) && estaDesbloqueada(i)) { inicial = i; break; }
      if (estaCompletada(i)) inicial = Math.min(i + 1, lecciones.length - 1);
    }
    abrirLeccion(inicial);

    $('btn-ir-examen').addEventListener('click', irAExamen);

    if (esAdmin) {
      avisoZona('info', 'Estás viendo este curso como administrador: tienes todas las lecciones desbloqueadas y el progreso no se guarda.');
    }
  });

  /* ============================================================ estados de bloqueo */
  function avisoZona(tipo, mensaje) {
    var iconos = { info: '&#8505;', warn: '&#9888;', ok: '&#10004;', danger: '&#9888;' };
    $('aviso-zona').innerHTML =
      '<div class="alert alert-' + tipo + ' mb-4"><span class="alert-icon">' + iconos[tipo] + '</span>' +
      '<div class="alert-body">' + mensaje + '</div></div>';
  }

  function errorFatal(titulo, detalle) {
    $('cargando-zona').hidden = true;
    $('layout').hidden = true;
    $('aviso-zona').innerHTML =
      '<div class="card text-center" style="padding:56px 24px;margin-top:40px">' +
      '<div style="font-size:2.6rem;margin-bottom:14px">&#128533;</div>' +
      '<h2>' + h(titulo) + '</h2>' +
      '<p class="text-muted">' + (detalle || '') + '</p>' +
      '<a class="btn btn-secondary mt-4" href="index.html">Ver todos los cursos</a>' +
      '</div>';
  }

  function exigirLogin() {
    $('cargando-zona').hidden = true;
    $('aviso-zona').innerHTML =
      '<div class="card text-center" style="padding:56px 24px;margin-top:40px">' +
      '<div style="font-size:2.6rem;margin-bottom:14px">&#128274;</div>' +
      '<h2>Necesitas iniciar sesión</h2>' +
      '<p class="text-muted">Este curso es para alumnos registrados. Entra o crea tu cuenta para continuar.</p>' +
      '<div class="row mt-4" style="justify-content:center">' +
      '<button class="btn btn-primary btn-lg" id="btn-login-curso">Iniciar sesión</button>' +
      '<button class="btn btn-secondary btn-lg" id="btn-reg-curso">Crear cuenta</button>' +
      '</div></div>';
    $('btn-login-curso').addEventListener('click', function () { UI.abrirAuth('entrar'); });
    $('btn-reg-curso').addEventListener('click', function () { UI.abrirAuth('registro'); });
  }

  function sinAcceso() {
    $('cargando-zona').hidden = true;

    // Si el curso tiene precio, lo mas util es dejarle inscribirse aqui mismo en
    // vez de mandarle a la portada: paga, sube el comprobante y ya queda en cola.
    var precio = Number(curso.precio);
    var dePago = isFinite(precio) && precio > 0;

    $('aviso-zona').innerHTML =
      '<div class="card text-center" style="padding:56px 24px;margin-top:40px">' +
      '<div style="font-size:2.6rem;margin-bottom:14px">&#128274;</div>' +
      '<h2>Aún no tienes acceso a este curso</h2>' +
      '<p class="text-muted">Tu cuenta está activa, pero no figuras como alumno de <strong>' + h(curso.nombre) + '</strong>.</p>' +
      (dePago
        ? '<button class="btn btn-primary btn-lg mt-4" type="button" id="btn-inscribirme">' +
          'Inscríbete y paga ' + h(precio.toLocaleString('es-VE', { maximumFractionDigits: 2 })) +
          ' ' + h(curso.moneda || 'Bs') + '</button>' +
          '<p class="text-faint text-xs mt-2">Copia los datos, paga y sube tu comprobante aquí mismo.</p>'
        : '') +
      '<div class="alert alert-info text-left mt-4" style="max-width:620px;margin-left:auto;margin-right:auto">' +
      '<span class="alert-icon">&#8505;</span><div class="alert-body">' +
      (dePago
        ? 'Si ya pagaste, el administrador lo está comprobando. Escríbele indicando el correo con el que te registraste: <strong>'
        : 'Escribe a la academia indicando el correo con el que te registraste: <strong>') +
      h((alumno && alumno.email) || '') + '</strong> y te darán de alta.' +
      '</div></div>' +
      '<a class="btn btn-secondary mt-4" href="index.html">Ver todos los cursos</a>' +
      '</div>';

    var b = $('btn-inscribirme');
    if (b) {
      b.addEventListener('click', function () {
        window.Inscripcion.abrir(curso, { onInscrito: function () { location.reload(); } });
      });
    }
  }

  /* ============================================================ desbloqueo secuencial */
  function estaCompletada(i) {
    var l = lecciones[i];
    if (!l) return false;
    var p = progreso[l.id];
    return !!(p && p.completado);
  }

  /**
   * La regla del prompt: la lección 1 se ve directamente; cada lección siguiente
   * se desbloquea al COMPLETAR la anterior.
   */
  function estaDesbloqueada(i) {
    if (esAdmin) return true;
    if (i === 0) return true;
    return estaCompletada(i - 1);
  }

  function primerBloqueada() {
    for (var i = 0; i < lecciones.length; i++) { if (!estaDesbloqueada(i)) return i; }
    return -1;
  }

  function todasCompletadas() {
    for (var i = 0; i < lecciones.length; i++) { if (!estaCompletada(i)) return false; }
    return true;
  }

  /* ============================================================ lista lateral */
  function pintarLista() {
    var html = '';
    lecciones.forEach(function (l, i) {
      var done = estaCompletada(i);
      var abierta = estaDesbloqueada(i);
      var clases = 'lesson-item';
      if (i === idxActual) clases += ' is-active';
      if (done) clases += ' is-done';
      if (!abierta) clases += ' is-locked';

      var pct = progreso[l.id] ? Math.round(progreso[l.id].porcentaje) : 0;
      var sub = done ? 'Completada'
              : (!abierta ? 'Bloqueada'
              : (pct > 0 ? 'Vista al ' + pct + '%' : 'Sin empezar'));
      var icono = done ? '&#10004;' : (abierta ? '&#9654;' : '&#128274;');

      html += '<button type="button" class="' + clases + '" data-idx="' + i + '"' +
        (!abierta ? ' disabled aria-disabled="true"' : '') + '>' +
        '<span class="lesson-num">' + (i + 1) + '</span>' +
        '<span class="lesson-main">' +
        '<span class="lesson-title">' + h(l.titulo) + '</span>' +
        '<span class="lesson-sub">' + sub + '</span>' +
        '</span>' +
        '<span class="lesson-state">' + icono + '</span>' +
        '</button>';
    });
    $('lista-lecciones').innerHTML = html;

    $('lista-lecciones').querySelectorAll('.lesson-item').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var i = parseInt(btn.dataset.idx, 10);
        if (!estaDesbloqueada(i)) {
          A.aviso('Primero tienes que completar la lección ' + i + '.', 'warn');
          return;
        }
        abrirLeccion(i);
      });
    });
  }

  function actualizarProgresoUI() {
    var total = lecciones.length;
    var hechas = 0;
    lecciones.forEach(function (l, i) { if (estaCompletada(i)) hechas++; });
    var pct = total ? Math.round((hechas / total) * 100) : 0;

    $('sidebar-contador').textContent = hechas + '/' + total;
    $('sidebar-barra').style.width = pct + '%';
    $('anillo-progreso').style.setProperty('--p', pct);
    $('anillo-texto').textContent = pct + '%';
    $('progreso-detalle').textContent = hechas + ' de ' + total + ' lecciones completadas';

    var listo = todasCompletadas();
    var btn = $('btn-ir-examen');
    btn.disabled = !listo;
    $('examen-estado').textContent = listo
      ? 'Ya puedes rendir el examen final.'
      : 'Completa todas las lecciones para habilitarlo.';
  }

  /* ============================================================ abrir lección */
  function abrirLeccion(i) {
    if (i < 0 || i >= lecciones.length) return;
    if (!estaDesbloqueada(i)) return;
    idxActual = i;
    var l = lecciones[i];

    // Si cambiamos de lección, descartamos cualquier guardado pendiente de la anterior
    if (guardadoPendiente) { clearTimeout(guardadoPendiente); guardadoPendiente = null; }
    montajeActual = null;

    pintarLista();
    $('zona-examen').innerHTML = '';   // al volver a una lección, se oculta el examen

    var pctGuardado = progreso[l.id] ? Number(progreso[l.id].porcentaje) || 0 : 0;
    var yaCompleta = estaCompletada(i);

    var html =
      '<div class="card" style="padding:0;overflow:hidden">' +
      '<div class="video-shell" id="video-shell">' +
      '<div class="video-lock"><div><div class="video-lock-icon">&#9203;</div>' +
      '<div class="text-muted">Preparando el reproductor…</div></div></div>' +
      '</div>' +
      '<div style="padding:20px 22px">' +
      '<div class="row-between mb-2">' +
      '<h2 style="margin:0;font-size:1.3rem">' + (i + 1) + '. ' + h(l.titulo) + '</h2>' +
      '<span class="badge' + (yaCompleta ? ' badge-ok' : '') + '" id="badge-estado">' +
      (yaCompleta ? '&#10004; Completada' : 'En curso') + '</span>' +
      '</div>' +
      (l.descripcion ? '<p class="text-muted" style="margin:0 0 14px">' + h(l.descripcion) + '</p>' : '') +
      '<div class="watch-meter">' +
      '<span class="text-sm text-muted nowrap">Visto</span>' +
      '<div class="progress"><div class="progress-bar" id="barra-visto" style="width:' + Math.min(pctGuardado, 100) + '%"></div></div>' +
      '<strong class="text-sm nowrap" id="texto-visto">' + Math.round(pctGuardado) + '%</strong>' +
      '</div>' +
      '<div class="text-xs text-faint mt-2" id="pista-visto">Necesitas ver el ' + UMBRAL_VISTO + '% del video para completar la lección.</div>' +
      '</div>' +
      '<div class="drawer-footer" style="border-top:1px solid var(--line);background:var(--surface-2)" id="pie-leccion">' +
      '<button class="btn btn-ghost btn-sm" id="btn-anterior"' + (i === 0 ? ' disabled' : '') + '>&#8592; Anterior</button>' +
      '<span class="spacer"></span>' +
      '<button class="btn btn-secondary" id="btn-siguiente"' + (i >= lecciones.length - 1 ? ' disabled' : '') + '>Siguiente lección &#8594;</button>' +
      '</div>' +
      '</div>';

    $('zona-video').innerHTML = html;

    $('btn-anterior').addEventListener('click', function () { abrirLeccion(i - 1); });
    $('btn-siguiente').addEventListener('click', function () {
      if (!estaCompletada(i)) {
        A.aviso('Completa esta lección antes de pasar a la siguiente.', 'warn');
        return;
      }
      if (i < lecciones.length - 1) abrirLeccion(i + 1);
    });

    pintarLista();

    /* ---- sin video: se puede continuar directamente ---- */
    if (!l.wistia_embed && !l.wistia_video_id) {
      $('video-shell').innerHTML =
        '<div class="video-lock"><div class="text-center">' +
        '<div class="video-lock-icon">&#128196;</div>' +
        '<p class="text-muted">Esta lección no tiene video.</p>' +
        '<button class="btn btn-primary" id="btn-continuar">Marcar como completada y continuar</button>' +
        '</div></div>';
      $('btn-continuar').addEventListener('click', function () { completarLeccion(i, 100); });
      return;
    }

    montarVideo(l, i, pctGuardado);
  }

  /* ============================================================ reproductor */
  function montarVideo(leccion, i, pctGuardado) {
    var codigo = leccion.wistia_embed || leccion.wistia_video_id;
    var shell = $('video-shell');

    var info = WistiaLMS.parsearEmbed(codigo);
    if (!info.ok) {
      shell.innerHTML =
        '<div class="video-lock"><div class="text-center">' +
        '<div class="video-lock-icon">&#9888;</div>' +
        '<p class="text-muted">El video de esta lección está mal configurado.</p>' +
        '<p class="text-xs text-faint">' + h(info.error) + '</p>' +
        '</div></div>';
      return;
    }

    var progresoMax = Math.max(0, Number(pctGuardado) || 0);
    var metricasVivas = false;   // ¿el reproductor llegó a informar del avance alguna vez?

    WistiaLMS.montar(shell, codigo, {
      color: 'FF6B00',
      radio: 12,

      onProgreso: function (pct) {
        metricasVivas = true;
        if (pct > progresoMax) progresoMax = pct;
        pintarMedidor(progresoMax);

        // Guardado con retardo: no escribimos en la base de datos en cada segundo
        if (guardadoPendiente) clearTimeout(guardadoPendiente);
        guardadoPendiente = setTimeout(function () {
          guardarProgreso(i, progresoMax, progresoMax >= UMBRAL_VISTO);
        }, 2500);
      },

      onFin: function () {
        // OJO: el evento de fin TAMBIÉN se dispara si el alumno arrastra la barra
        // hasta el final. Dar la lección por vista solo porque el video terminó
        // abriría un agujero: bastaría con saltar al final de cada video.
        // Por eso exigimos el mismo 90% que pide el prompt.
        if (progresoMax >= UMBRAL_VISTO) {
          completarLeccion(i, 100);
        } else if (!metricasVivas) {
          // El reproductor nunca informó del avance (otra versión de la API, un
          // bloqueador o un fallo de red). No castigamos al alumno por un fallo nuestro.
          completarLeccion(i, 100);
        } else {
          guardarProgreso(i, progresoMax, false);
          A.aviso('Para completar la lección necesitas ver al menos el ' + UMBRAL_VISTO +
                  '% del video. Ahora mismo llevas el ' + Math.round(progresoMax) + '%.',
                  'warn', 7000);
        }
      },

      onListo: function (handle) {
        montajeActual = handle;
        if (handle.advertencias && handle.advertencias.length) {
          handle.advertencias.forEach(function (a) { A.aviso(a, 'info', 7000); });
        }
        // Si ya estaba completa, reflejarlo visualmente
        if (progresoMax >= UMBRAL_VISTO) pintarMedidor(progresoMax);
      }
    }).catch(function (e) {
      shell.innerHTML =
        '<div class="video-lock"><div class="text-center">' +
        '<div class="video-lock-icon">&#9888;</div>' +
        '<p class="text-muted">No se pudo cargar el reproductor.</p>' +
        '<p class="text-xs text-faint">' + h(e.message || String(e)) + '</p>' +
        '<button class="btn btn-secondary btn-sm mt-4" onclick="location.reload()">Reintentar</button>' +
        '</div></div>';
    });
  }

  function pintarMedidor(pct) {
    pct = Math.max(0, Math.min(100, pct));
    var barra = $('barra-visto'), texto = $('texto-visto'), pista = $('pista-visto');
    if (!barra) return;
    barra.style.width = pct + '%';
    texto.textContent = Math.round(pct) + '%';
    if (pct >= UMBRAL_VISTO) {
      barra.classList.add('is-ok');
      pista.innerHTML = '<span class="text-ok">&#10004; ¡Lección completada! Ya puedes pasar a la siguiente.</span>';
    }
  }

  /* ============================================================ progreso */
  async function guardarProgreso(i, pct, completada) {
    if (esAdmin) return;                    // el admin no ensucia el progreso
    var l = lecciones[i];
    if (!l) return;
    var previo = progreso[l.id];
    var pctPrevio = previo ? Number(previo.porcentaje) || 0 : 0;
    // Nunca empeoramos una marca ya lograda
    if (previo && previo.completado) { pct = 100; completada = true; }
    if (pct <= pctPrevio && !completada) return;

    try {
      var fila = await A.db.guardarProgreso(curso.id, l.id, pct, completada);
      if (fila) progreso[l.id] = fila;
      actualizarProgresoUI();
    } catch (e) {
      console.warn('No se pudo guardar el progreso:', e);
    }
  }

  async function completarLeccion(i, pct) {
    if (guardadoPendiente) { clearTimeout(guardadoPendiente); guardadoPendiente = null; }
    var l = lecciones[i];
    if (!l) return;
    var yaEstaba = estaCompletada(i);

    pintarMedidor(100);
    var badge = $('badge-estado');
    if (badge) { badge.className = 'badge badge-ok'; badge.innerHTML = '&#10004; Completada'; }

    if (esAdmin) {
      // En modo admin no escribimos, pero desbloqueamos visualmente
      if (!progreso[l.id]) progreso[l.id] = { leccion_id: l.id, porcentaje: 100, completado: true };
      else { progreso[l.id].porcentaje = 100; progreso[l.id].completado = true; }
      actualizarProgresoUI();
      pintarLista();
      return;
    }

    progreso[l.id] = Object.assign({}, progreso[l.id] || {}, {
      leccion_id: l.id, curso_id: curso.id, user_id: (progreso[l.id] || {}).user_id,
      porcentaje: 100, completado: true
    });

    try {
      var fila = await A.db.guardarProgreso(curso.id, l.id, 100, true);
      if (fila) progreso[l.id] = fila;
    } catch (e) {
      A.aviso('No se pudo guardar tu progreso: ' + A.traducirError(e), 'error');
    }

    actualizarProgresoUI();
    pintarLista();

    if (!yaEstaba) {
      var siguiente = i + 1;
      if (siguiente < lecciones.length) {
        A.aviso('¡Lección ' + (i + 1) + ' completada! Se desbloqueó la lección ' + (siguiente + 1) + '.', 'ok');
        var btnSig = $('btn-siguiente');
        if (btnSig) btnSig.classList.add('btn-primary');
      } else {
        A.aviso('¡Completaste todas las lecciones! Ya puedes rendir el examen final.', 'ok', 6000);
      }
    }
  }

  /* ============================================================ examen */
  function irAExamen() {
    if (!todasCompletadas()) {
      A.aviso('Completa todas las lecciones antes de rendir el examen.', 'warn');
      return;
    }
    var zona = $('zona-examen');
    zona.scrollIntoView({ behavior: 'smooth', block: 'start' });

    Quiz.render(zona, curso, {
      lecciones: lecciones,
      onRepasar: function (leccionId) {
        var idx = -1;
        lecciones.forEach(function (l, i) { if (l.id === leccionId) idx = i; });
        if (idx >= 0) {
          abrirLeccion(idx);
          $('zona-video').scrollIntoView({ behavior: 'smooth', block: 'start' });
        } else {
          A.aviso('Vuelve a repasar las lecciones antes de reintentar.', 'info');
        }
      },
      onAprobar: function () { mostrarCertificado(); }
    });
  }

  /* ============================================================ certificado */
  async function mostrarCertificado() {
    A.cargando(true, 'Preparando tu certificado…');
    try {
      var cert = await A.db.miCertificado(curso.id);
      var nombre = (alumno && alumno.nombre_completo) || 'Alumno';
      var datos = {
        alumno: nombre,
        curso: curso.nombre,
        academia: (ajustes && ajustes.nombre_academia) || A.cfg.ACADEMY_NAME || 'Mi Academia',
        firmaUrl: ajustes ? ajustes.firma_url : null,
        codigo: cert ? cert.codigo : null
      };

      var zona = $('zona-examen');
      var previa = zona.querySelector('#cert-zona');
      if (!previa) {
        previa = document.createElement('div');
        previa.id = 'cert-zona';
        previa.className = 'mt-6';
        zona.appendChild(previa);
      }

      // Vista previa con HTML (ligera) + botón para generar el PDF
      previa.innerHTML =
        '<div class="card">' +
        '<div class="row-between mb-4">' +
        '<h3 class="mb-0">&#127942; Tu certificado</h3>' +
        (cert ? '<span class="badge badge-accent">' + h(cert.codigo) + '</span>' : '') +
        '</div>' +
        '<div class="cert-frame"><div class="cert-preview">' +
        '<div class="cp-kicker">Certificado de finalización</div>' +
        '<div class="cp-title">Se otorga el presente certificado a</div>' +
        '<div class="cp-name">' + h(nombre) + '</div>' +
        '<div class="cp-course">por haber completado satisfactoriamente el curso<br><strong>' + h(curso.nombre) + '</strong></div>' +
        '<div class="cp-foot">' +
        '<div><div class="cp-line">' + h(datos.academia) + '</div>Institución</div>' +
        '<div><div class="cp-line">' + h(new Date().toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' })) + '</div>Fecha</div>' +
        '</div></div></div>' +
        '<div class="row mt-4">' +
        '<button class="btn btn-gold btn-xl" id="btn-pdf">&#128196; Descargar en PDF</button>' +
        '<button class="btn btn-secondary btn-xl" id="btn-pdf-ver">Ver el PDF</button>' +
        (cert ? '<a class="btn btn-ghost btn-xl" href="verificar.html?codigo=' + h(cert.codigo) + '">Verificar</a>' : '') +
        '</div>' +
        '<p class="text-xs text-faint mt-3">Si tu nombre no es correcto, cámbialo en tu perfil: aparecerá así en el certificado.</p>' +
        '</div>';

      $('btn-pdf').addEventListener('click', async function () {
        var b = this; b.disabled = true; b.innerHTML = '<span class="spinner"></span> Generando…';
        try {
          await Certificado.descargar(datos);
          A.aviso('Certificado descargado.', 'ok');
        } catch (e) {
          A.aviso('No se pudo generar el PDF: ' + (e.message || e), 'error');
        }
        b.disabled = false; b.innerHTML = '&#128196; Descargar en PDF';
      });

      $('btn-pdf-ver').addEventListener('click', async function () {
        try { await Certificado.abrir(datos); }
        catch (e) { A.aviso('No se pudo abrir el PDF: ' + (e.message || e), 'error'); }
      });

      previa.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) {
      A.aviso('No se pudo preparar el certificado: ' + A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }
})();
