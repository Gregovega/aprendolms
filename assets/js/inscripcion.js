/* ============================================================================
   INSCRIPCIÓN A UN CURSO — registro, datos de pago, comprobante y referencia
   ----------------------------------------------------------------------------
   Es el camino completo del alumno:

     1. Pulsa «Inscríbete» en la tarjeta del curso.
     2. Se crea la cuenta (o entra, si ya la tiene) SIN salir de la página.
     3. Ve los datos de cobro y los copia con un toque.
     4. Paga por fuera (pago móvil, Zinli, USDT…) y aquí sube la captura y pega
        el número de referencia.
     5. Queda «en revisión» hasta que el administrador comprueba que el dinero
        entró y aprueba. Solo entonces se le abre el curso.

   Nada de esto abre el curso por sí solo: quien lo abre es aprobar_pago en el
   servidor. Aquí solo se declara el pago.

   Expone: window.Inscripcion.abrir(curso, { onInscrito })
   ============================================================================ */
(function () {
  'use strict';
  var A = window.APRENDO;

  // Si falta la configuracion de Supabase, supabase-client.js no llega a definir
  // window.APRENDO y ya muestra su propio aviso en la pagina. Sin esta guarda,
  // cualquier llamada aqui fallaria con un "Cannot read properties of undefined"
  // que no explica nada.
  if (!A) return;
  /** Tamaño máximo de la captura. Más grande no aporta nada y tarda en subir. */
  var MAX_BYTES = 8 * 1024 * 1024;

  function h(s) { return A.escaparHtml(s); }

  function escaparAtributo(s) { return h(String(s === null || s === undefined ? '' : s)); }

  function dinero(monto, moneda) {
    var n = Number(monto);
    var num = isFinite(n)
      ? (Math.round(n * 100) / 100).toLocaleString('es-VE', { maximumFractionDigits: 2 })
      : String(monto === null || monto === undefined ? '' : monto);
    return (num + ' ' + (moneda || '')).trim();
  }

  /* ------------------------------------------------------------- portapapeles */

  /**
   * Copia al portapapeles.
   *
   * navigator.clipboard solo existe en contextos seguros (https o localhost).
   * GitHub Pages es https, así que va bien; el respaldo con textarea es para
   * que también funcione si alguien abre la página de otra forma.
   */
  function copiar(texto) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(texto);
    }
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = texto;
        ta.setAttribute('readonly', '');
        ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('El navegador no dejó copiar'));
      } catch (e) { reject(e); }
    });
  }

  /* ------------------------------------------------------------------- modal */

  var capaActual = null;

  function crearModal(titulo) {
    cerrarModal();
    var fondo = document.createElement('div');
    fondo.className = 'modal-backdrop';
    fondo.id = 'modal-inscripcion';
    fondo.innerHTML =
      '<div class="modal modal-ancho" role="dialog" aria-modal="true" aria-label="' + escaparAtributo(titulo) + '">' +
      '<button class="modal-cerrar" type="button" id="ins-cerrar" aria-label="Cerrar">&times;</button>' +
      '<div id="ins-cuerpo"></div>' +
      '</div>';
    document.body.appendChild(fondo);
    requestAnimationFrame(function () { fondo.classList.add('open'); });

    function alPulsarTecla(e) { if (e.key === 'Escape') cerrarModal(); }
    document.addEventListener('keydown', alPulsarTecla);
    fondo.addEventListener('click', function (e) { if (e.target === fondo) cerrarModal(); });
    fondo.querySelector('#ins-cerrar').addEventListener('click', cerrarModal);

    capaActual = {
      fondo: fondo,
      cuerpo: fondo.querySelector('#ins-cuerpo'),
      limpiar: function () { document.removeEventListener('keydown', alPulsarTecla); }
    };
    return capaActual;
  }

  function cerrarModal() {
    if (!capaActual) return;
    var c = capaActual;
    capaActual = null;
    c.limpiar();
    c.fondo.classList.remove('open');
    setTimeout(function () { if (c.fondo.parentNode) c.fondo.parentNode.removeChild(c.fondo); }, 260);
  }

  /* ------------------------------------------------------------------ estados */

  function vistaCargando() {
    var c = crearModal('Inscripción');
    c.cuerpo.innerHTML = '<h2>Un momento…</h2><p class="text-muted">' +
      '<span class="spinner"></span> Comprobando tu acceso al curso.</p>';
    return c;
  }

  function vistaSinMetodos(curso) {
    var c = crearModal('Inscripción');
    c.cuerpo.innerHTML =
      '<h2>' + h(curso.nombre) + '</h2>' +
      '<div class="alert alert-warn mt-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
      'Este curso todavía no tiene formas de pago configuradas. ' +
      'Escríbele al administrador para que las active.' +
      '</div></div>' +
      '<button class="btn btn-secondary btn-block mt-4" type="button" id="ins-ok">Entendido</button>';
    c.cuerpo.querySelector('#ins-ok').addEventListener('click', cerrarModal);
  }

  function vistaYaTieneAcceso(curso) {
    var c = crearModal('Inscripción');
    c.cuerpo.innerHTML =
      '<h2>Ya tienes acceso</h2>' +
      '<p class="text-muted">Tu inscripción a «' + h(curso.nombre) + '» está activa.</p>' +
      '<a class="btn btn-primary btn-block btn-lg mt-4" href="curso.html?slug=' +
      encodeURIComponent(curso.slug) + '">Ir al curso</a>' +
      '<div class="text-center mt-4"><button class="btn-link" type="button" id="ins-ok">Cerrar</button></div>';
    c.cuerpo.querySelector('#ins-ok').addEventListener('click', cerrarModal);
  }

  function vistaPendiente(curso, pago) {
    var c = crearModal('Inscripción');
    c.cuerpo.innerHTML =
      '<h2>Pago en revisión</h2>' +
      '<p class="text-muted">Ya recibimos tu pago para «' + h(curso.nombre) + '». ' +
      'El administrador lo está comprobando.</p>' +
      '<div class="card card-inset card-pad-sm mt-4">' +
      '<div class="row-between mb-2"><span class="text-faint text-sm">Monto</span>' +
      '<strong>' + h(dinero(pago.monto, pago.moneda)) + '</strong></div>' +
      '<div class="row-between mb-2"><span class="text-faint text-sm">Método</span>' +
      '<strong>' + h(pago.metodo_etiqueta || '—') + '</strong></div>' +
      '<div class="row-between"><span class="text-faint text-sm">Referencia</span>' +
      '<code>' + h(pago.referencia) + '</code></div>' +
      '</div>' +
      '<div class="alert alert-info mt-4"><span class="alert-icon">&#8505;</span><div class="alert-body">' +
      'En cuanto lo apruebe, este curso aparecerá en <strong>Mis cursos</strong>. ' +
      'No hace falta que envíes el pago otra vez.' +
      '</div></div>' +
      '<button class="btn btn-secondary btn-block mt-4" type="button" id="ins-ok">Entendido</button>';
    c.cuerpo.querySelector('#ins-ok').addEventListener('click', cerrarModal);
  }

  function vistaRechazado(curso, pago, alReintentar) {
    var c = crearModal('Inscripción');
    c.cuerpo.innerHTML =
      '<h2>Tu pago no se pudo aceptar</h2>' +
      '<div class="alert alert-danger mt-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
      '<strong>Lo que dijo el administrador:</strong><br>' + h(pago.motivo || 'Sin motivo indicado.') +
      '</div></div>' +
      '<p class="text-muted text-sm">Si crees que es un error, escríbele. ' +
      'Si te equivocaste en la referencia, puedes enviarlo otra vez.</p>' +
      '<button class="btn btn-primary btn-block btn-lg mt-4" type="button" id="ins-reintentar">' +
      'Enviar el pago otra vez</button>' +
      '<div class="text-center mt-4"><button class="btn-link" type="button" id="ins-ok">Cerrar</button></div>';
    c.cuerpo.querySelector('#ins-ok').addEventListener('click', cerrarModal);
    c.cuerpo.querySelector('#ins-reintentar').addEventListener('click', function () {
      cerrarModal();
      setTimeout(alReintentar, 240);
    });
  }

  /* -------------------------------------------------------- formulario de pago */

  function vistaPago(curso, metodos, opciones) {
    var c = crearModal('Inscripción');
    var elegido = 0;

    function pintar() {
      var m = metodos[elegido];
      var metodo = m.metodos_pago || {};

      var selectores = metodos.map(function (x, i) {
        var et = (x.metodos_pago || {}).etiqueta || 'Método';
        return '<button class="btn ' + (i === elegido ? 'btn-primary' : 'btn-ghost') + ' btn-sm" ' +
          'type="button" data-metodo="' + i + '">' + h(et) + '</button>';
      }).join(' ');

      var campos = (metodo.campos || []).map(function (cpo, i) {
        return '<div class="row-between pago-campo">' +
          '<span class="text-faint text-sm">' + h(cpo.etiqueta || '') + '</span>' +
          '<code class="pago-valor">' + h(cpo.valor || '') + '</code>' +
          '<button class="btn btn-ghost btn-sm" type="button" data-copiar="' + i + '">Copiar</button>' +
          '</div>';
      }).join('');

      var todoElTexto = (metodo.campos || []).map(function (cpo) {
        return (cpo.etiqueta || '') + ': ' + (cpo.valor || '');
      }).join('\n');

      c.cuerpo.innerHTML =
        '<h2>Inscríbete en «' + h(curso.nombre) + '»</h2>' +
        '<p class="text-muted">Paga por fuera y luego sube aquí tu comprobante.</p>' +

        '<div class="card card-inset card-pad-sm mt-4 text-center">' +
        '<div class="text-faint text-xs">TIENES QUE PAGAR</div>' +
        '<div class="course-precio" style="font-size:1.8rem">' + h(dinero(m.monto, metodo.moneda)) + '</div>' +
        '</div>' +

        (metodos.length > 1
          ? '<div class="label mt-4 mb-2">¿Cómo vas a pagar?</div><div class="row mb-2">' + selectores + '</div>'
          : '') +

        '<div class="label mt-4 mb-2">Datos para el pago</div>' +
        '<div class="card card-inset card-pad-sm">' +
        (campos || '<p class="text-faint text-sm mb-0">Este método no tiene datos que copiar.</p>') +
        '</div>' +

        (todoElTexto
          ? '<button class="btn btn-secondary btn-block mt-2" type="button" data-copiar-todo="1">' +
            'Copiar todos los datos</button>'
          : '') +

        (metodo.instrucciones
          ? '<div class="alert alert-info mt-4"><span class="alert-icon">&#8505;</span><div class="alert-body">' +
            h(metodo.instrucciones) + '</div></div>'
          : '') +

        '<hr class="divider">' +

        '<div class="label mb-2">Ahora sube tu comprobante</div>' +
        '<div id="ins-aviso"></div>' +

        '<label class="field"><span class="label">Número de referencia <span class="req">*</span></span>' +
        '<input class="input" type="text" id="ins-referencia" autocomplete="off" ' +
        'placeholder="El número que te dio tu banco" maxlength="40">' +
        '<span class="hint">Es lo que nos permite comprobar que el pago es tuyo.</span></label>' +

        '<label class="field"><span class="label">Captura del pago <span class="req">*</span></span>' +
        '<input class="input" type="file" id="ins-archivo" accept="image/*">' +
        '<span class="hint">Una foto o captura de pantalla donde se vea el pago. Máximo 8 MB.</span></label>' +
        '<div id="ins-previa"></div>' +

        '<button class="btn btn-primary btn-block btn-lg mt-4" type="button" id="ins-enviar">' +
        'Enviar el pago para revisión</button>' +
        '<p class="text-faint text-xs text-center mt-2">' +
        'El curso se te abre en cuanto el administrador compruebe que el dinero entró.</p>';

      // --- eventos del formulario
      c.cuerpo.querySelectorAll('[data-metodo]').forEach(function (b) {
        b.addEventListener('click', function () {
          elegido = Number(b.getAttribute('data-metodo'));
          pintar();   // se repinta con el método elegido
        });
      });

      c.cuerpo.querySelectorAll('[data-copiar]').forEach(function (b) {
        b.addEventListener('click', function () {
          var cpo = (metodo.campos || [])[Number(b.getAttribute('data-copiar'))];
          if (!cpo) return;
          copiar(String(cpo.valor || '')).then(function () {
            var antes = b.textContent;
            b.textContent = '¡Copiado!';
            setTimeout(function () { b.textContent = antes; }, 1400);
          }).catch(function () {
            A.aviso('No se pudo copiar solo. Mantén pulsado el dato para copiarlo a mano.', 'warn', 7000);
          });
        });
      });

      var btnTodo = c.cuerpo.querySelector('[data-copiar-todo]');
      if (btnTodo) {
        btnTodo.addEventListener('click', function () {
          copiar(todoElTexto).then(function () {
            btnTodo.textContent = '¡Datos copiados!';
            setTimeout(function () { btnTodo.textContent = 'Copiar todos los datos'; }, 1600);
          }).catch(function () {
            A.aviso('No se pudo copiar solo. Mantén pulsado cada dato para copiarlo a mano.', 'warn', 7000);
          });
        });
      }

      var archivo = c.cuerpo.querySelector('#ins-archivo');
      archivo.addEventListener('change', function () {
        var previa = c.cuerpo.querySelector('#ins-previa');
        var f = archivo.files && archivo.files[0];
        previa.innerHTML = '';
        if (!f) return;
        if (!/^image\//.test(f.type)) {
          previa.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
            '<div class="alert-body">Ese archivo no es una imagen. Sube una foto o una captura de pantalla.</div></div>';
          archivo.value = '';
          return;
        }
        if (f.size > MAX_BYTES) {
          previa.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
            '<div class="alert-body">La imagen pesa ' + Math.round(f.size / 1024 / 1024) +
            ' MB y el máximo son 8 MB. Haz una captura más pequeña.</div></div>';
          archivo.value = '';
          return;
        }
        // Vista previa: el alumno confirma que subió la imagen correcta.
        var url = URL.createObjectURL(f);
        previa.innerHTML = '<img alt="Vista previa de tu comprobante" src="' + escaparAtributo(url) + '" ' +
          'style="width:100%;max-height:260px;object-fit:contain;border-radius:10px;border:1px solid var(--line)">';
      });

      c.cuerpo.querySelector('#ins-enviar').addEventListener('click', function () {
        enviar(c, curso, m, metodo, opciones);
      });
    }

    c.cuerpo.innerHTML = '<h2>Un momento…</h2><p class="text-muted"><span class="spinner"></span></p>';
    pintar();
    return c;
  }

  async function enviar(c, curso, filaMetodo, metodo, opciones) {
    var zona = c.cuerpo.querySelector('#ins-aviso');
    var btn = c.cuerpo.querySelector('#ins-enviar');
    var referencia = (c.cuerpo.querySelector('#ins-referencia').value || '').trim();
    var archivo = c.cuerpo.querySelector('#ins-archivo').files[0];

    zona.innerHTML = '';
    if (!referencia) {
      zona.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">Escribe el número de referencia que te dio tu banco.</div></div>';
      c.cuerpo.querySelector('#ins-referencia').focus();
      return;
    }
    if (!archivo) {
      zona.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">Sube la captura del pago: es lo que nos deja comprobarlo.</div></div>';
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Enviando tu pago…';

    try {
      var sesion = await A.auth.sesion();
      if (!sesion) throw new Error('Se cerró tu sesión. Vuelve a entrar e inténtalo otra vez.');

      // 1) La captura al almacén privado, dentro de la carpeta del alumno
      var ruta = await A.db.subirCaptura(archivo, sesion.user.id);

      // 2) El pago
      var pago = await A.db.crearPago({
        user_id: sesion.user.id,
        curso_id: curso.id,
        metodo_id: filaMetodo.metodo_id,
        metodo_etiqueta: metodo.etiqueta || null,
        monto: filaMetodo.monto,
        moneda: metodo.moneda || 'Bs',
        referencia: referencia,
        captura_url: ruta,
        estado: 'pendiente'
      });

      // El disparador de la base de datos marca las referencias repetidas. Si la
      // nuestra lo es, se avisa sin destapar datos de otros alumnos.
      var repetida = pago && pago.duplicado_de;

      // OJO: crearModal reemplaza el modal actual, asi que hay que quedarse con
      // el NUEVO. Usar `c.cuerpo` aqui apuntaria a un modal ya destruido.
      var fin = crearModal('Inscripción');
      fin.cuerpo.innerHTML =
        '<h2>&#9989; Pago enviado</h2>' +
        '<p class="text-muted">Ya está en manos del administrador. ' +
        'En cuanto compruebe que el dinero entró, se te abre el curso.</p>' +
        (repetida
          ? '<div class="alert alert-warn mt-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
            'Esa referencia ya se había registrado antes. Si te equivocaste al escribirla, ' +
            'avísale al administrador: podría tardar más en revisarlo.</div></div>'
          : '') +
        '<div class="card card-inset card-pad-sm mt-4">' +
        '<div class="row-between mb-2"><span class="text-faint text-sm">Curso</span>' +
        '<strong>' + h(curso.nombre) + '</strong></div>' +
        '<div class="row-between mb-2"><span class="text-faint text-sm">Pagaste</span>' +
        '<strong>' + h(dinero(filaMetodo.monto, metodo.moneda)) + '</strong></div>' +
        '<div class="row-between"><span class="text-faint text-sm">Referencia</span>' +
        '<code>' + h(referencia) + '</code></div>' +
        '</div>' +
        '<button class="btn btn-secondary btn-block mt-4" type="button" id="ins-ok">Entendido</button>';
      fin.cuerpo.querySelector('#ins-ok').addEventListener('click', function () {
        cerrarModal();
        if (typeof opciones.onInscrito === 'function') opciones.onInscrito();
      });
    } catch (e) {
      zona.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">' + h(A.traducirError(e)) + '</div></div>';
      btn.disabled = false;
      btn.textContent = 'Enviar el pago para revisión';
    }
  }

  /* -------------------------------------------------------------------- abrir */

  async function abrir(curso, opciones) {
    opciones = opciones || {};

    if (!curso || !curso.id) {
      A.aviso('No se pudo identificar el curso.', 'error');
      return;
    }

    var sesion = await A.auth.sesion();

    // Sin cuenta: se pide primero, y al terminarlo se sigue con el pago sin
    // salir de aquí. Ese «sin salir» es justo lo que se pidió.
    if (!sesion) {
      window.UI.abrirAuth('registro', {
        titulo: 'Crea tu cuenta',
        lead: 'Un momento y sigues con el pago de «' + curso.nombre + '».',
        onExito: function () { abrir(curso, opciones); }
      });
      return;
    }

    var c = vistaCargando();
    try {
      var tieneAcceso = await A.db.tengoAcceso(curso.id);
      if (capaActual === c) {
        if (tieneAcceso) { vistaYaTieneAcceso(curso); return; }
      }

      // ¿Ya mandó un pago para este curso?
      var mios = await A.db.misPagos();
      var deEste = (mios || []).filter(function (p) { return p.curso_id === curso.id; });
      var pendiente = deEste.filter(function (p) { return p.estado === 'pendiente'; })[0];
      var rechazado = deEste.filter(function (p) { return p.estado === 'rechazado'; })[0];

      if (capaActual !== c) return;   // el alumno cerró mientras cargaba

      if (pendiente) { vistaPendiente(curso, pendiente); return; }
      if (rechazado) {
        vistaRechazado(curso, rechazado, function () { abrir(curso, opciones); });
        return;
      }

      var metodos = await A.db.metodosDeCurso(curso.id);
      if (capaActual !== c) return;
      if (!metodos.length) { vistaSinMetodos(curso); return; }

      vistaPago(curso, metodos, opciones);
    } catch (e) {
      if (capaActual === c) {
        c.cuerpo.innerHTML = '<h2>No se pudo continuar</h2>' +
          '<div class="alert alert-danger mt-4"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
          h(A.traducirError(e)) + '</div></div>' +
          '<button class="btn btn-secondary btn-block mt-4" type="button" id="ins-ok">Cerrar</button>';
        c.cuerpo.querySelector('#ins-ok').addEventListener('click', cerrarModal);
      }
    }
  }

  window.Inscripcion = { abrir: abrir };
})();
