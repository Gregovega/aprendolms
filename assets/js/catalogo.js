/* ============================================================================
   APRENDO LMS — Portada: catálogo de cursos y "mis cursos"
   ============================================================================ */
(function () {
  'use strict';

  var A;

  /* Cursos publicados por slug: permite abrir la inscripción desde la tarjeta sin
     volver a pedirlos a la base de datos. */
  var porSlug = {};

  function $(id) { return document.getElementById(id); }
  function h(s) { return A.escaparHtml(s); }

  /**
   * Precio listo para mostrar. El curso puede no tener precio (0 o vacio), en
   * cuyo caso se anuncia como gratis.
   */
  function textoPrecio(curso) {
    var n = Number(curso.precio);
    var moneda = (curso.moneda || 'Bs').trim();
    if (!isFinite(n) || n <= 0) return { html: '<span class="course-precio gratis">Gratis</span>', hay: false };
    // Sin decimales si son .00, y con separador de miles
    var num = (Math.round(n * 100) / 100).toLocaleString('es-VE', { maximumFractionDigits: 2 });
    return {
      html: '<span class="course-precio">' + h(num) + '<span class="moneda">' + h(moneda) + '</span></span>',
      hay: true
    };
  }

  /**
   * Limpia una URL de imagen para poder usarla dentro de url(...) en un atributo
   * style. Se queda solo con caracteres propios de una URL: asi la direccion no
   * puede cerrar el parentesis, romper el atributo ni inyectar CSS.
   */
  function urlSegura(u) {
    return String(u || '').trim().replace(/[^\w\-./:%?=&#+~@[\]]/g, '');
  }

  function tarjetaCurso(curso, opciones) {
    opciones = opciones || {};
    var inicial = (curso.nombre || 'C').trim().charAt(0).toUpperCase();
    var url = 'curso.html?slug=' + encodeURIComponent(curso.slug);
    var foto = urlSegura(curso.imagen_url);
    var precio = textoPrecio(curso);

    // Con foto se pinta como fondo y se oculta la letra; sin foto queda la letra
    // sobre el degradado, que sigue siendo un respaldo digno.
    var portada = '<div class="course-cover' + (foto ? ' tiene-foto' : '') + '"' +
      (foto ? ' style="background-image:url(' + h(foto) + ')"' : '') +
      ' aria-hidden="true">' + h(inicial) + '</div>';

    // El boton cambia segun la situacion del alumno:
    //   - ya inscrito            -> enlace directo al curso
    //   - curso de pago          -> abre la inscripcion (registro + pago), que es
    //                               lo que se pidio: sin salir de la portada
    //   - curso gratis o sin precio -> enlace directo, no hay nada que cobrar
    var etiqueta, accion;
    if (opciones.inscrito) {
      etiqueta = 'Continuar el curso';
      accion = ' href="' + url + '"';
    } else if (precio.hay) {
      etiqueta = 'Inscríbete';
      accion = ' type="button" data-inscribir="' + h(curso.slug) + '"';
    } else {
      etiqueta = 'Ver el curso';
      accion = ' href="' + url + '"';
    }

    return '<article class="card card-hover course-card" data-curso="' + h(curso.slug) + '">' +
      portada +
      '<div class="course-cuerpo">' +
      '<h3 class="card-title">' + h(curso.nombre) + '</h3>' +
      '<p class="course-desc">' + h(curso.descripcion || 'Sin descripción.') + '</p>' +
      '</div>' +
      '<div class="course-pie">' +
      '<div class="row-between mb-2">' +
      precio.html +
      (opciones.inscrito
        ? '<span class="badge badge-ok"><span class="badge-dot"></span>Inscrito</span>'
        : '<span class="badge">' + h(curso.slug) + '</span>') +
      '</div>' +
      '<a class="btn btn-primary btn-block"' + accion + '>' + h(etiqueta) + '</a>' +
      '</div>' +
      '</article>';
  }

  function pintarCatalogo(cursos, inscritos) {
    var zona = $('zona-catalogo');
    $('cat-contador').textContent = cursos.length + (cursos.length === 1 ? ' curso' : ' cursos');

    if (!cursos.length) {
      zona.innerHTML =
        '<div class="card empty-state">' +
        '<div class="empty-state-icon">&#128218;</div>' +
        '<h3>Todavía no hay cursos publicados</h3>' +
        '<p class="text-muted">Cuando el administrador publique un curso, aparecerá aquí.</p>' +
        '</div>';
      return;
    }

    // Los cursos donde el alumno ya está inscrito se marcan para que su botón
    // lleve directo al curso en vez de volver a ofrecerle inscribirse.
    var yaEsta = {};
    (inscritos || []).forEach(function (c) { yaEsta[c.slug] = true; });

    zona.innerHTML = '<div class="catalogo-grid">' +
      cursos.map(function (c) {
        return tarjetaCurso(c, { cerrado: true, inscrito: !!yaEsta[c.slug] });
      }).join('') + '</div>';
  }

  function pintarMisCursos(cursos) {
    if (!cursos.length) return false;
    $('seccion-mis').hidden = false;
    $('mis-contador').textContent = cursos.length;
    $('mis-cursos').innerHTML = cursos.map(function (c) {
      return tarjetaCurso(c, { inscrito: true });
    }).join('');
    return true;
  }

  document.addEventListener('DOMContentLoaded', async function () {
    A = window.APRENDO;
    if (!A) return;
    await UI.iniciar('cursos');

    var sesion = await A.auth.sesion();

    // Ajustar el texto del héroe si ya hay sesión
    if (sesion) {
      $('hero-titulo').innerHTML = 'Hola de nuevo,<br>sigamos aprendiendo.';
      $('hero-lead').textContent = 'Retoma tus cursos donde los dejaste. Tu progreso está guardado.';
      var b = $('hero-acceder');
      b.classList.remove('hidden');
      b.textContent = 'Ir a mis cursos';
      b.addEventListener('click', function () { $('seccion-mis').scrollIntoView({ behavior: 'smooth' }); });
    }

    // Los cursos del alumno se piden ANTES de pintar el catálogo: así el botón de
    // cada tarjeta sale ya con el texto correcto, sin parpadeos ni dos pintadas.
    var mios = [];
    if (sesion) {
      try { mios = await A.db.misCursosComprados(); }
      catch (e) { console.warn('No se pudieron cargar los cursos del alumno:', e); }
    }

    /* ---- catálogo ---- */
    try {
      var cursos = await A.db.cursosPublicados();
      porSlug = {};
      cursos.forEach(function (c) { porSlug[c.slug] = c; });
      pintarCatalogo(cursos, mios);
    } catch (e) {
      $('zona-catalogo').innerHTML =
        '<div class="alert alert-danger"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">No se pudo cargar el catálogo: ' + h(A.traducirError(e)) + '</div></div>';
    }

    /* ---- mis cursos ---- */
    if (sesion && mios.length) pintarMisCursos(mios);

    /* ---- inscribirse sin salir de la portada ---- */
    $('zona-catalogo').addEventListener('click', function (e) {
      var boton = e.target.closest ? e.target.closest('[data-inscribir]') : null;
      if (!boton) return;
      e.preventDefault();
      var curso = porSlug[boton.getAttribute('data-inscribir')];
      if (!curso) return;
      window.Inscripcion.abrir(curso, { onInscrito: function () { location.reload(); } });
    });
  });
})();
