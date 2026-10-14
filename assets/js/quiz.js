/* ============================================================================
   APRENDO LMS — Examen final
   ============================================================================
   Reglas del prompt maestro:
     · Opción múltiple.
     · Aprueba con >= 80%.
     · Si reprueba: "Ups, no aprobaste. Te recomendamos volver a ver la lección
       [X] para reforzar." + botón grande "Repasar Lección".
     · No se bloquea: se puede reintentar de inmediato.
     · Al aprobar se desbloquea el certificado.

   SEGURIDAD: las preguntas llegan por la función obtener_preguntas(), que NO
   incluye la respuesta correcta. La corrección ocurre en el servidor con
   calificar_test(). El alumno no puede ver las respuestas en el navegador.
   ============================================================================ */
(function () {
  'use strict';

  var UMBRAL = 80;

  function h(s) { return window.APRENDO.escaparHtml(s); }
  function letra(i) { return String.fromCharCode(65 + i); }

  function normalizarOpciones(op) {
    if (Array.isArray(op)) return op.map(String);
    if (op && typeof op === 'object') return Object.keys(op).sort().map(function (k) { return String(op[k]); });
    if (typeof op === 'string') {
      try { var p = JSON.parse(op); if (Array.isArray(p)) return p.map(String); } catch (e) { /* noop */ }
    }
    return [];
  }

  /**
   * contenedor : elemento donde pintar
   * curso      : fila de la tabla cursos
   * opciones   : { onAprobar(datos), onRepasar(leccionId), onIntento(datos) }
   */
  async function render(contenedor, curso, opciones) {
    opciones = opciones || {};
    var A = window.APRENDO;

    contenedor.innerHTML = '<div class="text-center" style="padding:48px 0">' +
      '<div class="spinner spinner-lg" style="margin:0 auto 12px"></div>' +
      '<div class="text-muted">Cargando el examen…</div></div>';

    var preguntas;
    try {
      preguntas = await A.db.obtenerPreguntas(curso.id);
    } catch (e) {
      contenedor.innerHTML = '<div class="alert alert-danger"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">No se pudo cargar el examen: ' + h(A.traducirError(e)) + '</div></div>';
      return;
    }

    if (!preguntas.length) {
      contenedor.innerHTML = '<div class="card card-inset text-center" style="padding:40px">' +
        '<div style="font-size:2.2rem;margin-bottom:12px">&#128221;</div>' +
        '<h3>Este curso todavía no tiene examen</h3>' +
        '<p class="text-muted mb-0">El administrador debe añadir las preguntas desde el panel.</p></div>';
      return;
    }

    /* ------------------------------------------------ estado */
    var respuestas = {};   // pregunta_id -> indice
    var intentoNum = 0;

    function pintarFormulario() {
      var html = '';
      html += '<div class="card card-inset mb-4">' +
        '<div class="row-between">' +
        '<div><h3 class="mb-0">Examen final</h3>' +
        '<div class="text-muted text-sm">' + preguntas.length + ' preguntas · necesitas ' + UMBRAL + '% para aprobar</div></div>' +
        '<div class="badge badge-accent">' + (intentoNum > 0 ? 'Intento ' + (intentoNum + 1) : 'Primer intento') + '</div>' +
        '</div></div>';

      preguntas.forEach(function (p, i) {
        var ops = normalizarOpciones(p.opciones);
        html += '<div class="quiz-q" data-qid="' + h(p.id) + '">' +
          '<div class="quiz-q-head"><div class="quiz-q-num">' + (i + 1) + '</div>' +
          '<div class="quiz-q-text">' + h(p.pregunta) + '</div></div>';
        ops.forEach(function (texto, j) {
          html += '<label class="quiz-opt" data-opt="' + j + '">' +
            '<input type="radio" name="q_' + h(p.id) + '" value="' + j + '">' +
            '<span class="quiz-opt-key">' + letra(j) + '</span>' +
            '<span>' + h(texto) + '</span></label>';
        });
        html += '</div>';
      });

      html += '<div class="row-between mt-6">' +
        '<div class="text-muted text-sm" id="quiz-progreso">0 de ' + preguntas.length + ' respondidas</div>' +
        '<button class="btn btn-primary btn-lg" id="quiz-enviar" disabled>Enviar examen</button>' +
        '</div>';

      contenedor.innerHTML = html;

      /* ---- interacción ---- */
      contenedor.querySelectorAll('.quiz-opt input').forEach(function (radio) {
        radio.addEventListener('change', function () {
          var qid = radio.name.replace('q_', '');
          respuestas[qid] = parseInt(radio.value, 10);
          var caja = contenedor.querySelector('[data-qid="' + qid + '"]');
          caja.querySelectorAll('.quiz-opt').forEach(function (o) { o.classList.remove('is-picked'); });
          radio.closest('.quiz-opt').classList.add('is-picked');

          var n = Object.keys(respuestas).length;
          contenedor.querySelector('#quiz-progreso').textContent = n + ' de ' + preguntas.length + ' respondidas';
          contenedor.querySelector('#quiz-enviar').disabled = (n < preguntas.length);
        });
      });

      contenedor.querySelector('#quiz-enviar').addEventListener('click', enviar);
    }

    function pintarResultado(res, leccionRepaso) {
      var aprobado = !!res.aprobado;
      var nota = Number(res.nota || 0);

      var html = '<div class="card" style="padding:0;overflow:hidden">' +
        '<div class="score-hero">' +
        '<div class="text-muted text-sm mb-2">' + (aprobado ? 'Aprobado' : 'No aprobado') + '</div>' +
        '<div class="score-value ' + (aprobado ? 'pass' : 'fail') + '">' + Math.round(nota) + '%</div>' +
        '<div class="text-muted mt-3">' + res.aciertos + ' de ' + res.total + ' respuestas correctas</div>' +
        '</div></div>';

      if (aprobado) {
        html += '<div class="alert alert-ok mt-4"><span class="alert-icon">&#127942;</span>' +
          '<div class="alert-body"><strong>¡Felicitaciones!</strong> Has completado el curso. ' +
          'Tu certificado ya está disponible.</div></div>' +
          '<div class="mt-4"><button class="btn btn-gold btn-xl btn-block" id="quiz-certificado">' +
          '&#128196; Descargar mi certificado</button></div>';
      } else {
        // Texto EXACTO que pide el prompt
        var mensaje = 'Ups, no aprobaste.';
        if (leccionRepaso && leccionRepaso.titulo) {
          mensaje += ' Te recomendamos volver a ver la lección ' + leccionRepaso.titulo + ' para reforzar.';
        } else {
          mensaje += ' Te recomendamos repasar las lecciones antes de volver a intentarlo.';
        }

        html += '<div class="alert alert-warn mt-4"><span class="alert-icon">&#128218;</span>' +
          '<div class="alert-body">' + h(mensaje) + '</div></div>' +
          '<div class="row mt-4">';

        if (leccionRepaso && leccionRepaso.id) {
          html += '<button class="btn btn-primary btn-xl" id="quiz-repasar" data-leccion="' + h(leccionRepaso.id) + '">' +
            '&#9654; Repasar Lección</button>';
        }
        html += '<button class="btn btn-secondary btn-xl" id="quiz-reintentar">Volver a intentarlo</button>' +
          '</div>';
      }

      contenedor.innerHTML = html;

      var bCert = contenedor.querySelector('#quiz-certificado');
      if (bCert) bCert.addEventListener('click', function () { if (opciones.onAprobar) opciones.onAprobar(res); });

      var bRep = contenedor.querySelector('#quiz-repasar');
      if (bRep) bRep.addEventListener('click', function () {
        if (opciones.onRepasar) opciones.onRepasar(bRep.dataset.leccion);
      });

      var bRei = contenedor.querySelector('#quiz-reintentar');
      if (bRei) bRei.addEventListener('click', function () {
        respuestas = {};
        intentoNum++;
        pintarFormulario();
        contenedor.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }

    async function enviar() {
      var btn = contenedor.querySelector('#quiz-enviar');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Corrigiendo…';

      var res;
      try {
        res = await A.db.calificar(curso.id, respuestas);
      } catch (e) {
        A.aviso(A.traducirError(e), 'error');
        btn.disabled = false;
        btn.textContent = 'Enviar examen';
        return;
      }

      if (opciones.onIntento) { try { opciones.onIntento(res); } catch (e) { /* noop */ } }

      // Localizar la lección a repasar si el servidor nos dio su id
      var leccionRepaso = null;
      if (!res.aprobado && res.leccion_repaso && opciones.lecciones) {
        leccionRepaso = opciones.lecciones.filter(function (l) { return l.id === res.leccion_repaso; })[0] || null;
      }

      pintarResultado(res, leccionRepaso);
      contenedor.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    pintarFormulario();
  }

  window.Quiz = { render: render, UMBRAL: UMBRAL };
})();
