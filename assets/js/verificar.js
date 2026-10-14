/* ============================================================================
   APRENDO LMS — Verificación pública de un certificado por su código
   Usa la función verificar_certificado(), accesible incluso sin iniciar sesión.
   ============================================================================ */
(function () {
  'use strict';

  var A;
  function $(id) { return document.getElementById(id); }
  function h(s) { return A.escaparHtml(s); }

  async function verificar(codigo) {
    var zona = $('resultado');
    codigo = String(codigo || '').trim().toUpperCase();

    if (!codigo) {
      zona.innerHTML = '<div class="alert alert-warn"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">Escribe un código para verificar.</div></div>';
      return;
    }

    var btn = $('btn-verificar');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Comprobando…';
    zona.innerHTML = '';

    try {
      var cert = await A.db.verificarCertificado(codigo);

      if (!cert) {
        zona.innerHTML =
          '<div class="card" style="border-color:rgba(239,68,68,.4)">' +
          '<div class="row" style="gap:14px;align-items:flex-start">' +
          '<div style="font-size:2.2rem">&#10060;</div>' +
          '<div><h3 class="mb-2">Certificado no encontrado</h3>' +
          '<p class="text-muted mb-0">No existe ningún certificado con el código <code>' + h(codigo) + '</code>. ' +
          'Comprueba que lo copiaste completo, o contacta con la academia.</p></div>' +
          '</div></div>';
        return;
      }

      zona.innerHTML =
        '<div class="card" style="border-color:rgba(34,197,94,.45);background:linear-gradient(180deg,rgba(34,197,94,.06),transparent)">' +
        '<div class="row" style="gap:14px;align-items:flex-start">' +
        '<div style="font-size:2.2rem">&#9989;</div>' +
        '<div style="min-width:0;flex:1">' +
        '<div class="row" style="gap:10px;margin-bottom:10px">' +
        '<span class="badge badge-ok"><span class="badge-dot"></span>Certificado auténtico</span>' +
        '</div>' +
        '<h3 class="mb-4">Este certificado fue emitido por la academia</h3>' +
        '<div class="table-wrap"><table class="data"><tbody>' +
        '<tr><th style="width:180px">Alumno</th><td><strong>' + h(cert.nombre_alumno) + '</strong></td></tr>' +
        '<tr><th>Curso</th><td>' + h(cert.nombre_curso) + '</td></tr>' +
        '<tr><th>Fecha de emisión</th><td>' + h(A.formatearFecha(cert.emitido_en)) + '</td></tr>' +
        '<tr><th>Código</th><td><code>' + h(codigo) + '</code></td></tr>' +
        '</tbody></table></div>' +
        '</div></div></div>';
    } catch (e) {
      zona.innerHTML = '<div class="alert alert-danger"><span class="alert-icon">&#9888;</span>' +
        '<div class="alert-body">No se pudo verificar: ' + h(A.traducirError(e)) + '</div></div>';
    } finally {
      btn.disabled = false;
      btn.textContent = 'Verificar certificado';
    }
  }

  document.addEventListener('DOMContentLoaded', async function () {
    A = window.APRENDO;
    if (!A) return;
    await UI.iniciar('verificar');

    $('form-verificar').addEventListener('submit', function (e) {
      e.preventDefault();
      verificar($('codigo').value);
    });

    // Si llegan con ?codigo=XXXX desde el certificado, verificamos de una vez
    var pre = A.qs('codigo');
    if (pre) {
      $('codigo').value = pre.toUpperCase();
      verificar(pre);
    }
  });
})();
