/* ============================================================================
   APRENDO LMS — Portada: catálogo de cursos y "mis cursos"
   ============================================================================ */
(function () {
  'use strict';

  var A;

  function $(id) { return document.getElementById(id); }
  function h(s) { return A.escaparHtml(s); }

  function tarjetaCurso(curso, opciones) {
    opciones = opciones || {};
    var inicial = (curso.nombre || 'C').trim().charAt(0).toUpperCase();
    var url = 'curso.html?slug=' + encodeURIComponent(curso.slug);

    return '<article class="card card-hover course-card">' +
      '<div class="course-cover">' + h(inicial) + '</div>' +
      '<div>' +
      '<h3 class="card-title">' + h(curso.nombre) + '</h3>' +
      '<p class="course-desc">' + h(curso.descripcion || 'Sin descripción.') + '</p>' +
      '</div>' +
      '<div class="row-between" style="margin-top:auto">' +
      '<span class="card-meta">' + h(curso.slug) + '</span>' +
      (opciones.inscrito
        ? '<span class="badge badge-ok"><span class="badge-dot"></span>Inscrito</span>'
        : (opciones.cerrado
            ? '<span class="badge badge-warn">Requiere inscripción</span>'
            : '<span class="badge badge-accent">Ver curso</span>')) +
      '</div>' +
      '<a class="btn ' + (opciones.inscrito ? 'btn-primary' : 'btn-secondary') + ' btn-block" href="' + url + '">' +
      (opciones.inscrito ? 'Continuar' : 'Ver el curso') + '</a>' +
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

    zona.innerHTML = '<div class="grid grid-3">' +
      cursos.map(function (c) {
        return tarjetaCurso(c, { cerrado: true });
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

    /* ---- catálogo ---- */
    try {
      var cursos = await A.db.cursosPublicados();
      pintarCatalogo(cursos, []);
    } catch (e) {
      $('zona-catalogo').innerHTML =
        '<div class="alert alert-danger"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">No se pudo cargar el catálogo: ' + h(A.traducirError(e)) + '</div></div>';
    }

    /* ---- mis cursos ---- */
    if (!sesion) return;
    try {
      var mios = await A.db.misCursosComprados();
      pintarMisCursos(mios);
    } catch (e) {
      console.warn('No se pudieron cargar los cursos del alumno:', e);
    }
  });
})();
