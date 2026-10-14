/* ============================================================================
   APRENDO LMS — UI compartida: cabecera, sesión y guardas de acceso
   Requiere: config.js, supabase UMD, supabase-client.js
   Expone:   window.UI
   ============================================================================ */
(function () {
  'use strict';

  function h(s) { return window.APRENDO.escaparHtml(s); }

  /* ------------------------------------------------------------ cabecera */
  function header(opciones) {
    opciones = opciones || {};
    var activo = opciones.activo || '';
    var cfg = window.APRENDO.cfg;
    var marca = cfg.ACADEMY_NAME || 'Aprendo LMS';
    var inicial = marca.trim().charAt(0).toUpperCase() || 'A';

    var html =
      '<header class="site-header">' +
      '<div class="container container-wide">' +
      '<a class="brand" href="index.html">' +
      '<span class="brand-mark">' + h(inicial) + '</span>' +
      '<span>' + h(marca) + '<span class="brand-sub" style="display:block">Aprendo LMS</span></span>' +
      '</a>' +
      '<nav class="nav-links" style="margin-left:18px">' +
      '<a href="index.html"' + (activo === 'cursos' ? ' class="active"' : '') + '>Cursos</a>' +
      '<a href="verificar.html"' + (activo === 'verificar' ? ' class="active"' : '') + '>Verificar certificado</a>' +
      '<a href="admin.html" id="nav-admin" class="hidden">Administración</a>' +
      '</nav>' +
      '<span class="spacer"></span>' +
      '<div id="zona-sesion" class="row" style="gap:8px"></div>' +
      '</div></header>';

    var mount = document.getElementById('header-mount');
    if (mount) mount.innerHTML = html;
    pintarSesion();
  }

  /* ------------------------------------------------------------ zona de sesión */
  async function pintarSesion() {
    var zona = document.getElementById('zona-sesion');
    if (!zona) return;
    var A = window.APRENDO;

    var sesion = await A.auth.sesion();

    if (!sesion) {
      zona.innerHTML =
        '<button class="btn btn-ghost btn-sm" id="btn-entrar">Iniciar sesión</button>' +
        '<button class="btn btn-primary btn-sm" id="btn-registro">Crear cuenta</button>';
      document.getElementById('btn-entrar').addEventListener('click', function () { abrirAuth('entrar'); });
      document.getElementById('btn-registro').addEventListener('click', function () { abrirAuth('registro'); });
      var na = document.getElementById('nav-admin');
      if (na) na.classList.add('hidden');
      return;
    }

    var perfil = null;
    try {
      var r = await A.client.from('perfiles').select('nombre_completo').eq('id', sesion.user.id).maybeSingle();
      perfil = r.data;
    } catch (e) { /* noop */ }

    var nombre = (perfil && perfil.nombre_completo) || sesion.user.email || 'Alumno';
    var inicial = nombre.trim().charAt(0).toUpperCase();

    zona.innerHTML =
      '<span class="badge" title="' + h(sesion.user.email || '') + '">' +
      '<span class="brand-mark" style="width:20px;height:20px;font-size:11px;border-radius:6px;box-shadow:none">' + h(inicial) + '</span>' +
      h(nombre.length > 22 ? nombre.slice(0, 22) + '…' : nombre) + '</span>' +
      '<button class="btn btn-ghost btn-sm" id="btn-salir">Salir</button>';

    document.getElementById('btn-salir').addEventListener('click', async function () {
      await A.auth.salir();
      location.href = 'index.html';
    });

    // Mostrar "Administración" solo a los admins
    var esAdmin = false;
    try { esAdmin = await A.auth.esAdmin(); } catch (e) { /* noop */ }
    var na = document.getElementById('nav-admin');
    if (na && esAdmin) na.classList.remove('hidden');
  }

  /* ------------------------------------------------------------ modal de auth */
  var modoActual = 'entrar';

  function abrirAuth(modo) {
    modoActual = modo || 'entrar';
    var existente = document.getElementById('modal-auth');
    if (existente) existente.remove();

    var esRegistro = modoActual === 'registro';

    var cont = document.createElement('div');
    cont.className = 'modal-backdrop';
    cont.id = 'modal-auth';
    cont.innerHTML =
      '<div class="modal" role="dialog" aria-modal="true" aria-labelledby="auth-titulo">' +
      '<h2 id="auth-titulo">' + (esRegistro ? 'Crear tu cuenta' : 'Iniciar sesión') + '</h2>' +
      '<p class="text-muted text-sm">' + (esRegistro
        ? 'Regístrate para acceder a tus cursos.'
        : 'Entra para continuar donde lo dejaste.') + '</p>' +
      '<div id="auth-error"></div>' +
      '<form id="auth-form" novalidate>' +
      (esRegistro
        ? '<label class="field"><span class="label">Nombre completo <span class="req">*</span></span>' +
          '<input class="input" type="text" name="nombre" required autocomplete="name" placeholder="Como quieres que salga en tu certificado">' +
          '<span class="hint">Este nombre aparecerá en tu certificado.</span></label>'
        : '') +
      '<label class="field"><span class="label">Correo electrónico <span class="req">*</span></span>' +
      '<input class="input" type="email" name="email" required autocomplete="email" placeholder="tu@correo.com"></label>' +
      '<label class="field"><span class="label">Contraseña <span class="req">*</span></span>' +
      '<input class="input" type="password" name="password" required minlength="6" ' +
      'autocomplete="' + (esRegistro ? 'new-password' : 'current-password') + '" placeholder="Mínimo 6 caracteres"></label>' +
      '<button type="submit" class="btn btn-primary btn-block btn-lg" id="auth-enviar">' +
      (esRegistro ? 'Crear cuenta' : 'Entrar') + '</button>' +
      '</form>' +
      '<div class="text-center mt-4">' +
      '<button class="btn-link" id="auth-cambiar">' +
      (esRegistro ? '¿Ya tienes cuenta? Inicia sesión' : '¿No tienes cuenta? Regístrate') +
      '</button></div>' +
      '<div class="text-center mt-2"><button class="btn-link text-faint" id="auth-cerrar">Cerrar</button></div>' +
      '</div>';

    document.body.appendChild(cont);
    requestAnimationFrame(function () { cont.classList.add('open'); });

    function alPulsarTecla(e) {
      if (e.key === 'Escape') cerrar();
    }

    function cerrar() {
      document.removeEventListener('keydown', alPulsarTecla);   // sin fugas de escuchadores
      cont.classList.remove('open');
      setTimeout(function () { cont.remove(); }, 260);
    }

    cont.addEventListener('click', function (e) { if (e.target === cont) cerrar(); });
    cont.querySelector('#auth-cerrar').addEventListener('click', cerrar);
    cont.querySelector('#auth-cambiar').addEventListener('click', function () {
      cerrar();
      setTimeout(function () { abrirAuth(esRegistro ? 'entrar' : 'registro'); }, 200);
    });
    document.addEventListener('keydown', alPulsarTecla);

    var primerCampo = cont.querySelector('input');
    if (primerCampo) setTimeout(function () { primerCampo.focus(); }, 120);

    cont.querySelector('#auth-form').addEventListener('submit', async function (e) {
      e.preventDefault();
      var A = window.APRENDO;
      var form = e.target;
      var btn = cont.querySelector('#auth-enviar');
      var zonaError = cont.querySelector('#auth-error');

      var email = form.email.value.trim();
      var password = form.password.value;

      if (!email || !password) {
        zonaError.innerHTML = '<div class="alert alert-danger mb-4">Completa todos los campos.</div>';
        return;
      }
      if (password.length < 6) {
        zonaError.innerHTML = '<div class="alert alert-danger mb-4">La contraseña debe tener al menos 6 caracteres.</div>';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> ' + (esRegistro ? 'Creando…' : 'Entrando…');
      zonaError.innerHTML = '';

      try {
        if (esRegistro) {
          var nombre = form.nombre ? form.nombre.value.trim() : '';
          if (!nombre) throw new Error('Escribe tu nombre completo: aparecerá en el certificado.');
          var r = await A.auth.registrar(email, password, nombre);
          if (r.error) throw r.error;
          // Si el proyecto exige confirmar el correo, no habrá sesión todavía.
          if (!r.data.session) {
            cont.querySelector('.modal').innerHTML =
              '<h2>Revisa tu correo</h2>' +
              '<div class="alert alert-info"><span class="alert-icon">&#9993;</span><div class="alert-body">' +
              'Te enviamos un enlace de confirmación a <strong>' + h(email) + '</strong>. ' +
              'Confírmalo y luego inicia sesión.</div></div>' +
              '<button class="btn btn-secondary btn-block mt-4" id="auth-ok">Entendido</button>';
            cont.querySelector('#auth-ok').addEventListener('click', function () { location.reload(); });
            return;
          }
        } else {
          var r2 = await A.auth.entrar(email, password);
          if (r2.error) throw r2.error;
        }

        // Navegar al destino guardado, o recargar para que la sesión surta efecto.
        // OJO: asignar location.href y ADEMÁS llamar a reload() se pisaría entre sí.
        var destino = A.qs('destino');
        if (destino) {
          location.href = destino;
        } else {
          location.reload();
        }
      } catch (err) {
        zonaError.innerHTML = '<div class="alert alert-danger mb-4"><span class="alert-icon">&#9888;</span>' +
          '<div class="alert-body">' + h(A.traducirError(err)) + '</div></div>';
        btn.disabled = false;
        btn.textContent = esRegistro ? 'Crear cuenta' : 'Entrar';
      }
    });
  }

  /* ------------------------------------------------------------ guardas */
  async function exigirAdmin() {
    var A = window.APRENDO;
    var sesion = await A.auth.sesion();
    if (!sesion) {
      location.href = 'index.html?destino=' + encodeURIComponent('admin.html');
      return null;
    }
    var es = await A.auth.esAdmin();
    if (!es) {
      document.body.innerHTML =
        '<div class="container container-narrow" style="padding-top:72px">' +
        '<div class="card text-center" style="padding:48px">' +
        '<div style="font-size:3rem;margin-bottom:16px">&#128274;</div>' +
        '<h2>Zona de administración</h2>' +
        '<p class="text-muted">Tu cuenta no tiene permisos de administrador.</p>' +
        '<div class="alert alert-info text-left mt-4"><span class="alert-icon">&#8505;</span><div class="alert-body">' +
        'Para darte de alta, ejecuta esto en el SQL Editor de Supabase, con tu UUID:<br>' +
        '<code>insert into public.admins (user_id) values (\'TU-UUID\');</code>' +
        '</div></div>' +
        '<a class="btn btn-secondary mt-4" href="index.html">Volver al inicio</a>' +
        '</div></div>';
      return null;
    }
    return sesion;
  }

  /* ------------------------------------------------------------ pie */
  function footer() {
    var mount = document.getElementById('footer-mount');
    if (!mount) return;
    var cfg = window.APRENDO.cfg;
    mount.innerHTML =
      '<footer class="site-footer"><div class="container container-wide">' +
      '<div class="row-between">' +
      '<div>' + h(cfg.ACADEMY_NAME || 'Aprendo LMS') + ' · Plataforma de cursos en línea</div>' +
      '<div class="row" style="gap:16px">' +
      '<a href="index.html">Cursos</a>' +
      '<a href="verificar.html">Verificar certificado</a>' +
      '</div></div></div></footer>';
  }

  window.UI = {
    header: header,
    footer: footer,
    abrirAuth: abrirAuth,
    exigirAdmin: exigirAdmin,
    pintarSesion: pintarSesion,
    /** Arranque típico: cabecera + pie + redirección si venimos de un login pendiente */
    async iniciar(activo) {
      header({ activo: activo });
      footer();
    }
  };
})();
