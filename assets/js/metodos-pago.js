/* ============================================================================
   MIS DATOS DE COBRO — configuración de los métodos de pago
   ----------------------------------------------------------------------------
   El administrador escribe sus datos UNA sola vez (teléfono, banco, cédula,
   wallet…). Después, en cada curso, solo pone cuánto cuesta.

   Eso es a propósito: si los datos se reescribieran en cada curso, un dígito
   equivocado en uno de ellos haría que ese pago se perdiera y nadie lo notaría
   hasta que un alumno reclamara.

   Expone: window.MetodosPago.abrirDrawer({ onCambio })
   ============================================================================ */
(function () {
  'use strict';

  var A = window.APRENDO;
  function h(s) { return A.escaparHtml(s); }

  var estado = {
    metodos: [],
    editando: null,      // null = lista; {} = formulario
    ocupado: false
  };

  var capa = null;

  /* Un dato de ejemplo ayuda a entender qué se espera en cada casilla. */
  var EJEMPLOS = [
    { etiqueta: 'Banco', valor: 'Banesco' },
    { etiqueta: 'Teléfono', valor: '0414-1234567' },
    { etiqueta: 'Cédula', valor: 'V-12345678' }
  ];

  /* ---------------------------------------------------------------- estructura */

  function crearCapa(titulo) {
    var fondo = document.createElement('div');
    fondo.className = 'drawer-backdrop';
    var panel = document.createElement('aside');
    panel.className = 'drawer drawer-wide';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-modal', 'true');
    panel.setAttribute('aria-label', titulo);
    panel.innerHTML =
      '<div class="drawer-header"><h2>' + h(titulo) + '</h2>' +
      '<button class="drawer-close" type="button" data-accion="cerrar" aria-label="Cerrar">&times;</button></div>' +
      '<div class="drawer-body" id="mp-cuerpo"></div>' +
      '<div class="drawer-footer" id="mp-pie"></div>';

    document.body.appendChild(fondo);
    document.body.appendChild(panel);
    requestAnimationFrame(function () {
      fondo.classList.add('open');
      panel.classList.add('open');
    });

    var obj = {
      panel: panel,
      fondo: fondo,
      cerrar: function () {
        fondo.classList.remove('open');
        panel.classList.remove('open');
        setTimeout(function () {
          if (fondo.parentNode) fondo.parentNode.removeChild(fondo);
          if (panel.parentNode) panel.parentNode.removeChild(panel);
        }, 340);
        // Avisar a quien abrió el panel: los métodos pueden haber cambiado y la
        // pantalla de cobros conviene refrescarla.
        if (obj.onCambio) { try { obj.onCambio(); } catch (e) { /* no es crítico */ } }
      }
    };

    fondo.addEventListener('click', function (e) { if (e.target === fondo) obj.cerrar(); });
    return obj;
  }

  /* ------------------------------------------------------------------- pintado */

  function bloqueCampos(campos) {
    var filas = (campos || []).map(function (c, i) {
      return '<div class="row mb-2" data-fila-campo="' + i + '">' +
        '<input class="input" style="flex:0 0 34%" type="text" data-campo-etiqueta="' + i + '" ' +
          'placeholder="Banco" value="' + h(c.etiqueta || '') + '" maxlength="24">' +
        '<input class="input" style="flex:1 1 auto" type="text" data-campo-valor="' + i + '" ' +
          'placeholder="Banesco" value="' + h(c.valor || '') + '" maxlength="120">' +
        '<button class="btn btn-ghost btn-sm" type="button" data-accion="quitar-campo" data-i="' + i + '" ' +
          'aria-label="Quitar este dato">&times;</button>' +
        '</div>';
    }).join('');

    return '<div class="card card-inset card-pad-sm mb-4">' +
      '<div class="label mb-2">Datos que el alumno copia con un toque</div>' +
      '<div id="mp-campos">' + filas + '</div>' +
      '<button class="btn btn-ghost btn-sm mt-2" type="button" data-accion="anadir-campo">+ Añadir dato</button>' +
      '<div class="text-faint text-xs mt-2">Cada dato sale con su botón de copiar en la pantalla del alumno.</div>' +
      '</div>';
  }

  function formulario(m) {
    m = m || { etiqueta: '', moneda: 'Bs', instrucciones: '', campos: EJEMPLOS.slice() };
    var campos = (m.campos && m.campos.length) ? m.campos : EJEMPLOS.slice();

    return '<div id="mp-error"></div>' +
      '<div class="field-row">' +
        '<label class="field"><span class="label">Nombre del método <span class="req">*</span></span>' +
          '<input class="input" type="text" id="mp-etiqueta" maxlength="40" ' +
          'placeholder="Pago Móvil" value="' + h(m.etiqueta || '') + '">' +
          '<span class="hint">Como quieres que lo lea el alumno: Pago Móvil, Zinli, USDT (TRC20)…</span></label>' +
        '<label class="field"><span class="label">Moneda</span>' +
          '<input class="input" type="text" id="mp-moneda" maxlength="10" ' +
          'placeholder="Bs" value="' + h(m.moneda || 'Bs') + '">' +
          '<span class="hint">Bs, USD, USDT…</span></label>' +
      '</div>' +

      '<label class="field"><span class="label">Instrucciones para el alumno</span>' +
        '<textarea class="textarea textarea-plain" id="mp-instrucciones" ' +
        'placeholder="Ej. Haz el pago móvil y luego sube la captura de tu banco.">' +
        h(m.instrucciones || '') + '</textarea>' +
        '<span class="hint">Opcional. Aparece debajo de tus datos.</span></label>' +

      bloqueCampos(campos);
  }

  function lista() {
    if (!estado.metodos.length) {
      return '<div class="card empty-state">' +
        '<div class="empty-state-icon">&#128179;</div>' +
        '<h3>Todavía no tienes datos de cobro</h3>' +
        '<p class="text-muted">Añade al menos uno (por ejemplo tu Pago Móvil) para que tus alumnos ' +
        'puedan pagarte. Luego, en cada curso, solo tendrás que poner cuánto cuesta.</p>' +
        '</div>';
    }

    return estado.metodos.map(function (m) {
      var campos = (m.campos || []).map(function (c) {
        return '<div class="row-between" style="gap:12px">' +
          '<span class="text-faint text-sm">' + h(c.etiqueta || '') + '</span>' +
          '<code style="flex:1 1 auto;text-align:right">' + h(c.valor || '') + '</code>' +
          '</div>';
      }).join('');

      return '<article class="card mb-4"' + (m.activo === false ? ' style="opacity:.55"' : '') + '>' +
        '<div class="row-between mb-2">' +
          '<h3 class="card-title mb-0">' + h(m.etiqueta) +
            ' <span class="text-faint text-sm">' + h(m.moneda || '') + '</span></h3>' +
          '<div class="row">' +
            '<button class="btn btn-ghost btn-sm" type="button" data-accion="editar" data-id="' + h(m.id) + '">Editar</button>' +
            '<button class="btn btn-ghost btn-sm" type="button" data-accion="borrar" data-id="' + h(m.id) + '">Borrar</button>' +
          '</div>' +
        '</div>' +
        (m.instrucciones ? '<p class="text-muted text-sm">' + h(m.instrucciones) + '</p>' : '') +
        (campos || '<p class="text-faint text-sm mb-0">Sin datos que copiar.</p>') +
        '</article>';
    }).join('');
  }

  function pintar() {
    var cuerpo = capa.panel.querySelector('#mp-cuerpo');
    var pie = capa.panel.querySelector('#mp-pie');

    if (estado.editando) {
      cuerpo.innerHTML = formulario(estado.editando);
      pie.innerHTML =
        '<button class="btn btn-ghost" type="button" data-accion="cancelar">Cancelar</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-primary" type="button" data-accion="guardar">Guardar método</button>';
    } else {
      cuerpo.innerHTML =
        '<div class="alert alert-info mb-4"><span class="alert-icon">&#8505;</span><div class="alert-body">' +
        'Escribe aquí tus datos <strong>una sola vez</strong>. Después, en cada curso, solo pondrás ' +
        'cuánto cuesta en cada método.' +
        '</div></div>' + lista();
      pie.innerHTML =
        '<button class="btn btn-primary" type="button" data-accion="nuevo">+ Añadir método de cobro</button>' +
        '<span class="spacer"></span>' +
        '<button class="btn btn-ghost" type="button" data-accion="cerrar">Cerrar</button>';
    }
  }

  /* ------------------------------------------------------------------ acciones */

  function recogerFormulario() {
    var cuerpo = capa.panel.querySelector('#mp-cuerpo');

    var etiqueta = cuerpo.querySelector('#mp-etiqueta').value.trim();
    var moneda = cuerpo.querySelector('#mp-moneda').value.trim() || 'Bs';
    var instrucciones = cuerpo.querySelector('#mp-instrucciones').value.trim();
    var activoOriginal = estado.editando && estado.editando.activo === false ? false : true;

    var campos = [];
    cuerpo.querySelectorAll('[data-campo-etiqueta]').forEach(function (inp) {
      var i = inp.getAttribute('data-campo-etiqueta');
      var valor = cuerpo.querySelector('[data-campo-valor="' + i + '"]');
      var et = inp.value.trim();
      var va = valor ? valor.value.trim() : '';
      // Una fila a medias se descarta en vez de guardar basura.
      if (et && va) campos.push({ etiqueta: et, valor: va });
    });

    return {
      datos: { etiqueta: etiqueta, moneda: moneda, instrucciones: instrucciones || null, campos: campos, activo: activoOriginal },
      ok: !!etiqueta
    };
  }

  async function guardar() {
    var cuerpo = capa.panel.querySelector('#mp-cuerpo');
    var zonaError = cuerpo.querySelector('#mp-error');
    zonaError.innerHTML = '';

    var r = recogerFormulario();
    if (!r.ok) {
      zonaError.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">Ponle un nombre al método (por ejemplo «Pago Móvil»).</div></div>';
      return;
    }
    if (!r.datos.campos.length) {
      zonaError.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">Añade al menos un dato (banco, teléfono, cédula, wallet…) ' +
        'para que el alumno sepa a dónde pagar.</div></div>';
      return;
    }

    A.cargando(true, 'Guardando…');
    try {
      if (estado.editando && estado.editando.id) {
        await A.db.actualizarMetodoPago(estado.editando.id, r.datos);
        A.aviso('Datos de cobro actualizados.', 'ok');
      } else {
        var orden = estado.metodos.length + 1;
        r.datos.orden = orden;
        await A.db.crearMetodoPago(r.datos);
        A.aviso('Método de cobro añadido.', 'ok');
      }
      estado.editando = null;
      await cargar();
      pintar();
    } catch (e) {
      zonaError.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">' + h(A.traducirError(e)) + '</div></div>';
    } finally {
      A.cargando(false);
    }
  }

  async function borrar(m) {
    if (!window.confirm(
      '¿Borrar «' + m.etiqueta + '»?\n\n' +
      'Los cursos que lo usaran dejarán de ofrecer este método. Los pagos que ya ' +
      'recibiste con él NO se borran: quedan en el historial.')) return;
    A.cargando(true, 'Borrando…');
    try {
      await A.db.borrarMetodoPago(m.id);
      A.aviso('Método borrado.', 'ok');
      await cargar();
      pintar();
    } catch (e) {
      A.aviso('No se pudo borrar: ' + A.traducirError(e), 'error');
    } finally {
      A.cargando(false);
    }
  }

  function anadirCampo() {
    estado.editando = recogerFormulario().datos;
    if (!estado.editando.campos) estado.editando.campos = [];
    estado.editando.campos.push({ etiqueta: '', valor: '' });
    pintar();
    // Enfocar la casilla nueva para poder escribir seguido
    var campos = capa.panel.querySelectorAll('[data-campo-etiqueta]');
    if (campos.length) campos[campos.length - 1].focus();
  }

  function quitarCampo(i) {
    var r = recogerFormulario();
    r.datos.campos.splice(Number(i), 1);
    estado.editando = r.datos;
    if (!estado.editando.etiqueta && !estado.editando.campos.length) estado.editando.campos = [];
    pintar();
  }

  function editar(id) {
    var m = estado.metodos.filter(function (x) { return x.id === id; })[0];
    if (!m) return;
    estado.editando = {
      id: m.id,
      etiqueta: m.etiqueta,
      moneda: m.moneda,
      instrucciones: m.instrucciones,
      campos: (m.campos || []).slice(),
      activo: m.activo
    };
    pintar();
  }

  /* ------------------------------------------------------------------ eventos */

  function conectar() {
    capa.panel.addEventListener('click', function (e) {
      var b = e.target.closest ? e.target.closest('[data-accion]') : null;
      if (!b) return;
      var accion = b.getAttribute('data-accion');
      var id = b.getAttribute('data-id');

      switch (accion) {
        case 'cerrar':
          capa.cerrar();
          break;
        case 'cancelar':
          // Volver a la lista no pierde nada ya guardado: lo que había en el
          // formulario simplemente se descarta.
          estado.editando = null;
          pintar();
          break;
        case 'nuevo':
          estado.editando = {};
          pintar();
          break;
        case 'guardar':
          guardar();
          break;
        case 'editar':
          editar(id);
          break;
        case 'borrar':
          var m = estado.metodos.filter(function (x) { return x.id === id; })[0];
          if (m) borrar(m);
          break;
        case 'anadir-campo':
          anadirCampo();
          break;
        case 'quitar-campo':
          quitarCampo(b.getAttribute('data-i'));
          break;
        default:
          break;
      }
    });
  }

  /* -------------------------------------------------------------------- carga */

  async function cargar() {
    try {
      estado.metodos = await A.db.metodosPago();
    } catch (e) {
      A.aviso('No se pudieron cargar tus datos de cobro: ' + A.traducirError(e), 'error');
      estado.metodos = [];
    }
  }

  async function abrirDrawer(opciones) {
    opciones = opciones || {};
    capa = crearCapa('Mis datos de cobro');
    capa.onCambio = opciones.onCambio || null;
    estado.editando = null;
    conectar();
    pintar();                 // se pinta vacío enseguida para que no parezca colgado
    await cargar();
    pintar();
  }

  window.MetodosPago = { abrirDrawer: abrirDrawer };
})();
