/* ============================================================================
   APRENDO LMS — Cliente de Supabase y acceso a datos
   Requiere que se hayan cargado antes:
     1. assets/js/config.js          (window.APRENDO_CONFIG)
     2. el UMD de supabase-js        (window.supabase)
   Expone el objeto global  window.APRENDO
   ============================================================================ */
(function () {
  'use strict';

  var cfg = window.APRENDO_CONFIG || {};

  /* ------------------------------------------------------------ validación */
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML =
        '<div class="container" style="padding-top:80px">' +
        '<div class="alert alert-danger"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
        '<strong>Falta la configuración de Supabase.</strong><br>' +
        'Ejecuta <code>_tools\\set-credentials.cmd</code> con tu Project URL y tu anon key. ' +
        'Eso genera <code>assets/js/config.js</code>.' +
        '</div></div></div>';
    });
    return;
  }
  if (!window.supabase || !window.supabase.createClient) {
    document.addEventListener('DOMContentLoaded', function () {
      document.body.innerHTML =
        '<div class="container" style="padding-top:80px">' +
        '<div class="alert alert-danger"><span class="alert-icon">&#9888;</span><div class="alert-body">' +
        '<strong>No se pudo cargar la librería de Supabase.</strong><br>' +
        'Comprueba tu conexión a internet y recarga la página.' +
        '</div></div></div>';
    });
    return;
  }

  /* ------------------------------------------------------------ cliente */
  var client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'aprendo-lms-auth'
    }
  });

  /* ------------------------------------------------------------ utilidades */
  function qs(name) {
    return new URLSearchParams(location.search).get(name);
  }

  /**
   * Resuelve el slug del curso desde:
   *   1. ?slug=ventadechicha          (funciona en local y en cualquier hosting)
   *   2. ?curso=ventadechicha         (alias)
   *   3. el subdominio: ventadechicha.midominio.com
   *   4. la ruta: /c/ventadechicha/
   * Devuelve null si no encuentra ninguno.
   */
  function resolverSlug() {
    var s = qs('slug') || qs('curso');
    if (s) return s.trim().toLowerCase();

    var host = location.hostname;

    // Rutas tipo /c/slug/ o /curso/slug/
    var m = location.pathname.match(/\/(?:c|curso)\/([^\/]+)/i);
    if (m) return decodeURIComponent(m[1]).toLowerCase();

    // Subdominio: solo si hay al menos 3 etiquetas (evita tocar github.io, localhost, etc.)
    var partes = host.split('.');
    var esLocal = host === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(host);
    var esHostingGenerico = /\.(github\.io|netlify\.app|vercel\.app|pages\.dev)$/i.test(host);

    if (!esLocal && !esHostingGenerico && partes.length >= 3) {
      var sub = partes[0].toLowerCase();
      if (sub !== 'www') return sub;
    }
    return null;
  }

  function escaparHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function formatearFecha(iso, opciones) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleDateString('es-ES', opciones || { year: 'numeric', month: 'long', day: 'numeric' });
    } catch (e) { return ''; }
  }

  function traducirError(err) {
    if (!err) return 'Ocurrió un error inesperado.';
    var m = String(err.message || err.error_description || err || '');
    var mapa = [
      [/Invalid login credentials/i,        'Correo o contraseña incorrectos.'],
      [/Email not confirmed/i,              'Debes confirmar tu correo antes de entrar. Revisa tu bandeja.'],
      [/User already registered/i,          'Ese correo ya tiene una cuenta. Inicia sesión.'],
      [/Password should be at least/i,      'La contraseña es demasiado corta (mínimo 6 caracteres).'],
      [/Unable to validate email address/i, 'El correo no tiene un formato válido.'],
      [/Email rate limit exceeded/i,        'Demasiados intentos. Espera unos minutos.'],
      [/Sin acceso a este curso/i,          'No tienes acceso a este curso.'],
      [/JWT expired/i,                      'Tu sesión caducó. Vuelve a entrar.'],
      [/Failed to fetch|NetworkError/i,     'No hay conexión con el servidor. Revisa tu internet.']
    ];
    for (var i = 0; i < mapa.length; i++) { if (mapa[i][0].test(m)) return mapa[i][1]; }
    return m || 'Ocurrió un error inesperado.';
  }

  /* ------------------------------------------------------------ autenticación */
  var auth = {
    async sesion() {
      var r = await client.auth.getSession();
      return r.data ? r.data.session : null;
    },
    async usuario() {
      var s = await auth.sesion();
      return s ? s.user : null;
    },
    async registrar(email, password, nombreCompleto) {
      return client.auth.signUp({
        email: email,
        password: password,
        options: { data: { nombre_completo: nombreCompleto } }
      });
    },
    async entrar(email, password) {
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    async salir() {
      return client.auth.signOut();
    },
    onCambio(cb) {
      return client.auth.onAuthStateChange(function (_evento, sesion) { cb(sesion); });
    },
    /** Exige sesión. Si no la hay, manda a la portada guardando el destino. */
    async exigirSesion() {
      var s = await auth.sesion();
      if (!s) {
        location.href = 'index.html?destino=' + encodeURIComponent(location.pathname + location.search);
        return null;
      }
      return s;
    },
    /** true si el usuario actual está en public.admins */
    async esAdmin() {
      var u = await auth.usuario();
      if (!u) return false;
      var r = await client.from('admins').select('user_id').eq('user_id', u.id).maybeSingle();
      return !r.error && !!r.data;
    }
  };

  /* ------------------------------------------------------------ datos */
  var db = {
    async ajustes() {
      var r = await client.from('ajustes').select('*').eq('id', 1).maybeSingle();
      return r.data || { nombre_academia: cfg.ACADEMY_NAME || 'Mi Academia', firma_url: null, logo_url: null };
    },
    async cursosPublicados() {
      var r = await client.from('cursos').select('*').eq('publicado', true).order('creado_en', { ascending: false });
      if (r.error) throw r.error;
      return r.data || [];
    },
    async todosLosCursos() {
      var r = await client.from('cursos').select('*').order('creado_en', { ascending: false });
      if (r.error) throw r.error;
      return r.data || [];
    },
    async cursoPorSlug(slug) {
      var r = await client.from('cursos').select('*').eq('slug', slug).maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
    async cursoPorId(id) {
      var r = await client.from('cursos').select('*').eq('id', id).maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
    async lecciones(cursoId) {
      var r = await client.from('lecciones').select('*').eq('curso_id', cursoId).order('orden');
      if (r.error) throw r.error;
      return r.data || [];
    },
    async miProgreso(cursoId) {
      var u = await auth.usuario();
      if (!u) return [];
      var r = await client.from('progress').select('*').eq('curso_id', cursoId).eq('user_id', u.id);
      if (r.error) throw r.error;
      return r.data || [];
    },
    async tengoAcceso(cursoId) {
      var u = await auth.usuario();
      if (!u) return false;
      if (await auth.esAdmin()) return true;
      var r = await client.from('inscripciones').select('id')
        .eq('curso_id', cursoId).eq('user_id', u.id).eq('estado', 'activa').maybeSingle();
      return !r.error && !!r.data;
    },
    /** Guarda progreso. Solo mejora: nunca baja el porcentaje ya alcanzado. */
    async guardarProgreso(cursoId, leccionId, porcentaje, completado) {
      var u = await auth.usuario();
      if (!u) return null;
      var pct = Math.max(0, Math.min(100, Number(porcentaje) || 0));
      var payload = {
        user_id: u.id, leccion_id: leccionId, curso_id: cursoId,
        porcentaje: pct, completado: !!completado,
        actualizado_en: new Date().toISOString()
      };
      var r = await client.from('progress')
        .upsert(payload, { onConflict: 'user_id,leccion_id' })
        .select().maybeSingle();
      if (r.error) throw r.error;
      return r.data;
    },
    async inscripciones() {
      var u = await auth.usuario();
      if (!u) return [];
      var r = await client.from('inscripciones').select('curso_id, estado').eq('user_id', u.id);
      return r.data || [];
    },
    async misCursosComprados() {
      var u = await auth.usuario();
      if (!u) return [];
      var r = await client.from('inscripciones').select('curso_id, cursos(*)').eq('user_id', u.id).eq('estado', 'activa');
      if (r.error) throw r.error;
      return (r.data || []).map(function (x) { return x.cursos; }).filter(Boolean);
    },
    /* --- examen: siempre a través de las funciones seguras --- */
    async obtenerPreguntas(cursoId) {
      var r = await client.rpc('obtener_preguntas', { p_curso_id: cursoId });
      if (r.error) throw r.error;
      return r.data || [];
    },
    async calificar(cursoId, respuestas) {
      var r = await client.rpc('calificar_test', { p_curso_id: cursoId, p_respuestas: respuestas });
      if (r.error) throw r.error;
      return r.data;
    },
    async intentos(cursoId) {
      var u = await auth.usuario();
      if (!u) return [];
      var r = await client.from('intentos_test').select('*')
        .eq('curso_id', cursoId).eq('user_id', u.id).order('creado_en', { ascending: false });
      return r.data || [];
    },
    async miCertificado(cursoId) {
      var u = await auth.usuario();
      if (!u) return null;
      var r = await client.from('certificados').select('*')
        .eq('curso_id', cursoId).eq('user_id', u.id).maybeSingle();
      return r.error ? null : r.data;
    },
    async verificarCertificado(codigo) {
      var r = await client.rpc('verificar_certificado', { p_codigo: codigo });
      if (r.error) throw r.error;
      return (r.data && r.data[0]) || null;
    },
    /* --- administración --- */
    async crearCurso(curso) {
      var r = await client.from('cursos').insert(curso).select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async actualizarCurso(id, cambios) {
      var r = await client.from('cursos').update(cambios).eq('id', id).select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async borrarCurso(id) {
      var r = await client.from('cursos').delete().eq('id', id);
      if (r.error) throw r.error;
      return true;
    },
    async crearLeccion(leccion) {
      var r = await client.from('lecciones').insert(leccion).select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async actualizarLeccion(id, cambios) {
      var r = await client.from('lecciones').update(cambios).eq('id', id).select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async borrarLeccion(id) {
      var r = await client.from('lecciones').delete().eq('id', id);
      if (r.error) throw r.error;
      return true;
    },
    async crearPreguntas(lista) {
      if (!lista || !lista.length) return [];
      var r = await client.from('preguntas_test').insert(lista).select();
      if (r.error) throw r.error;
      return r.data || [];
    },
    async preguntasDeCurso(cursoId) {
      var r = await client.from('preguntas_test').select('*').eq('curso_id', cursoId).order('orden');
      if (r.error) throw r.error;
      return r.data || [];
    },
    async borrarPreguntasDeCurso(cursoId) {
      var r = await client.from('preguntas_test').delete().eq('curso_id', cursoId);
      if (r.error) throw r.error;
      return true;
    },
    async inscribir(userIdOEmail, cursoId) {
      // Acepta un UUID o un correo: si es correo, busca el perfil.
      var uid = userIdOEmail;
      if (String(userIdOEmail).indexOf('@') > -1) {
        var p = await client.from('perfiles').select('id').eq('email', userIdOEmail.trim()).maybeSingle();
        if (p.error || !p.data) throw new Error('No existe ningún alumno con ese correo.');
        uid = p.data.id;
      }
      var r = await client.from('inscripciones')
        .upsert({ user_id: uid, curso_id: cursoId, estado: 'activa' }, { onConflict: 'user_id,curso_id' })
        .select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async listarInscritos(cursoId) {
      // Vía normal: PostgREST resuelve el anidamiento por la clave foránea
      // inscripciones.user_id -> perfiles.id (la crea el esquema).
      var r = await client.from('inscripciones')
        .select('id, estado, creado_en, user_id, perfiles(nombre_completo, email)')
        .eq('curso_id', cursoId).order('creado_en', { ascending: false });
      if (!r.error) return r.data || [];

      // Si esa clave foránea no existe, PostgREST responde que no encuentra la
      // relación. En vez de dejar la tabla de inscritos vacía, se une a mano.
      var esFaltaDeRelacion = /relationship|schema cache/i.test(String(r.error.message || ''));
      if (!esFaltaDeRelacion) throw r.error;

      var base = await client.from('inscripciones')
        .select('id, estado, creado_en, user_id')
        .eq('curso_id', cursoId).order('creado_en', { ascending: false });
      if (base.error) throw base.error;

      var filas = base.data || [];
      var ids = filas.map(function (f) { return f.user_id; });
      var porId = {};
      if (ids.length) {
        var p = await client.from('perfiles').select('id, nombre_completo, email').in('id', ids);
        (p.data || []).forEach(function (x) { porId[x.id] = x; });
      }
      return filas.map(function (f) {
        return Object.assign({}, f, { perfiles: porId[f.user_id] || null });
      });
    },
    async actualizarAjustes(cambios) {
      var r = await client.from('ajustes').update(cambios).eq('id', 1).select().single();
      if (r.error) throw r.error;
      return r.data;
    },

    /* ------------------------------------------------ cobro manual de cursos */

    /** Todos los métodos de cobro (el administrador los ve aunque estén apagados). */
    async metodosPago() {
      var r = await client.from('metodos_pago').select('*').order('orden').order('creado_en');
      if (r.error) throw r.error;
      return r.data || [];
    },
    async crearMetodoPago(datos) {
      var r = await client.from('metodos_pago').insert(datos).select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async actualizarMetodoPago(id, cambios) {
      var r = await client.from('metodos_pago').update(cambios).eq('id', id).select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async borrarMetodoPago(id) {
      var r = await client.from('metodos_pago').delete().eq('id', id);
      if (r.error) throw r.error;
      return true;
    },

    /** Precios de un curso, con el método ya resuelto para poder pintarlo. */
    async preciosDeCurso(cursoId) {
      var r = await client.from('curso_metodos_pago')
        .select('id, monto, activo, metodo_id, metodos_pago(etiqueta, moneda, activo)')
        .eq('curso_id', cursoId);
      if (r.error) throw r.error;
      return r.data || [];
    },
    async guardarPrecioCurso(cursoId, metodoId, monto) {
      var r = await client.from('curso_metodos_pago')
        .upsert({ curso_id: cursoId, metodo_id: metodoId, monto: monto }, { onConflict: 'curso_id,metodo_id' })
        .select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async borrarPrecioCurso(cursoId, metodoId) {
      var r = await client.from('curso_metodos_pago').delete()
        .eq('curso_id', cursoId).eq('metodo_id', metodoId);
      if (r.error) throw r.error;
      return true;
    },

    /**
     * Métodos de cobro disponibles para un curso, ya con el precio de ESE curso.
     * Es lo que ve el alumno al pulsar «Inscríbete».
     */
    async metodosDeCurso(cursoId) {
      var r = await client.from('curso_metodos_pago')
        .select('monto, metodo_id, metodos_pago(etiqueta, moneda, instrucciones, campos, activo)')
        .eq('curso_id', cursoId).eq('activo', true);
      if (r.error) throw r.error;
      return (r.data || []).filter(function (f) {
        return f.metodos_pago && f.metodos_pago.activo !== false;
      });
    },

    /** Pagos para la pantalla de verificación. El administrador los ve todos. */
    async pagos(limite) {
      // duplicado_de apunta a otro pago, así que se puede anidar: en UNA sola
      // consulta viene el detalle del pago anterior con esa misma referencia.
      var r = await client.from('pagos')
        .select('id, estado, referencia, monto, moneda, metodo_etiqueta, captura_url, motivo, ' +
                'duplicado_de, creado_en, revisado_en, user_id, curso_id, ' +
                'perfiles(nombre_completo, email), cursos(nombre, slug), ' +
                'duplicado:pagos!duplicado_de(id, referencia, creado_en, estado, cursos(nombre, slug))')
        .order('creado_en', { ascending: false })
        .limit(limite || 200);
      if (!r.error) return r.data || [];

      // Si ese anidamiento no se puede resolver, se pide lo básico; el detalle
      // del duplicado se consulta aparte Solo cuando hace falta (detalleDuplicado).
      var base = await client.from('pagos')
        .select('id, estado, referencia, monto, moneda, metodo_etiqueta, captura_url, motivo, ' +
                'duplicado_de, creado_en, revisado_en, user_id, curso_id, ' +
                'perfiles(nombre_completo, email), cursos(nombre, slug)')
        .order('creado_en', { ascending: false })
        .limit(limite || 200);
      if (base.error) throw base.error;
      return base.data || [];
    },
    async crearPago(datos) {
      var r = await client.from('pagos').insert(datos).select().single();
      if (r.error) throw r.error;
      return r.data;
    },
    async misPagos() {
      var r = await client.from('pagos')
        .select('id, estado, referencia, motivo, monto, moneda, metodo_etiqueta, creado_en, revisado_en, ' +
                'duplicado_de, curso_id, cursos(nombre, slug)')
        .order('creado_en', { ascending: false });
      if (r.error) throw r.error;
      return r.data || [];
    },
    /** Aprobar o rechazar vive en el servidor: aquí solo se llama. */
    async aprobarPago(pagoId, nota) {
      var r = await client.rpc('aprobar_pago', { p_pago_id: pagoId, p_nota: nota || null });
      if (r.error) throw r.error;
      return r.data;
    },
    async rechazarPago(pagoId, motivo) {
      var r = await client.rpc('rechazar_pago', { p_pago_id: pagoId, p_motivo: motivo });
      if (r.error) throw r.error;
      return r.data;
    },
    async detalleDuplicado(pagoId) {
      var r = await client.rpc('detalle_duplicado', { p_pago_id: pagoId });
      if (r.error) throw r.error;
      return r.data;
    },

    /* ------------------------------------------------- comprobantes (capturas) */

    /**
     * Sube la captura al almacén privado y devuelve su ruta.
     * Cada archivo va dentro de la carpeta del propio alumno, que es lo que
     * exige la política del almacén: capturas/<uuid-del-alumno>/<aleatorio>.jpg
     */
    async subirCaptura(archivo, userId) {
      var ext = (String(archivo.name || '').split('.').pop() || 'jpg').toLowerCase();
      if (!/^(jpg|jpeg|png|webp|heic|heif)$/.test(ext)) ext = 'jpg';
      var azar = (window.crypto && window.crypto.randomUUID)
        ? window.crypto.randomUUID()
        : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
      var ruta = userId + '/' + azar + '.' + ext;

      var r = await client.storage.from('capturas').upload(ruta, archivo, {
        cacheControl: '3600',
        upsert: false,
        contentType: archivo.type || 'image/jpeg'
      });
      if (r.error) throw r.error;
      return ruta;
    },
    /**
     * Enlace temporal para ver una captura. El cubo es privado a propósito:
     * el comprobante de un alumno no puede quedar en una dirección pública.
     */
    async urlCaptura(ruta, segundos) {
      if (!ruta) return null;
      var r = await client.storage.from('capturas').createSignedUrl(ruta, segundos || 3600);
      if (r.error) throw r.error;
      return r.data ? r.data.signedUrl : null;
    }
  };

  /* ------------------------------------------------------------ UI: toasts */
  function aviso(mensaje, tipo, ms) {
    var cont = document.getElementById('aprendo-toasts');
    if (!cont) {
      cont = document.createElement('div');
      cont.id = 'aprendo-toasts';
      cont.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:200;display:flex;flex-direction:column;gap:8px;max-width:min(380px,92vw)';
      document.body.appendChild(cont);
    }
    var colores = { ok: 'var(--ok)', error: 'var(--danger)', warn: 'var(--warn)', info: 'var(--info)' };
    var el = document.createElement('div');
    el.className = 'alert';
    el.style.cssText = 'background:var(--surface-2);box-shadow:var(--shadow-lg);border-left:3px solid ' + (colores[tipo] || colores.info) + ';animation:none';
    el.setAttribute('role', tipo === 'error' ? 'alert' : 'status');
    el.innerHTML = '<div class="alert-body">' + escaparHtml(mensaje) + '</div>';
    cont.appendChild(el);
    setTimeout(function () {
      el.style.transition = 'opacity .3s, transform .3s';
      el.style.opacity = '0';
      el.style.transform = 'translateX(12px)';
      setTimeout(function () { el.remove(); }, 320);
    }, ms || (tipo === 'error' ? 6500 : 3800));
  }

  function cargando(mostrar, texto) {
    var el = document.getElementById('aprendo-loading');
    if (!mostrar) { if (el) el.remove(); return; }
    if (el) return;
    el = document.createElement('div');
    el.id = 'aprendo-loading';
    el.className = 'loading-overlay';
    el.innerHTML = '<div class="text-center"><div class="spinner spinner-lg" style="margin:0 auto 12px"></div>' +
                   '<div class="text-muted text-sm">' + escaparHtml(texto || 'Cargando...') + '</div></div>';
    document.body.appendChild(el);
  }

  /* ------------------------------------------------------------ exportar */
  window.APRENDO = {
    client: client,
    cfg: cfg,
    auth: auth,
    db: db,
    resolverSlug: resolverSlug,
    qs: qs,
    escaparHtml: escaparHtml,
    formatearFecha: formatearFecha,
    traducirError: traducirError,
    aviso: aviso,
    cargando: cargando
  };
})();
