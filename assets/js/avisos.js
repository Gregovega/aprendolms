/* ============================================================================
   AVISOS AL TELÉFONO (notificaciones push)
   ----------------------------------------------------------------------------
   Dos formas de enterarse de un pago, y se complementan:

     1. EL SONIDO (en cobros.js) — suena mientras la pantalla de Cobros está
        abierta. Es inmediato y no depende de nada externo.

     2. LA NOTIFICACIÓN (esto) — llega al teléfono aunque la página esté CERRADA.
        Es lo que hace que no se te escape un pago de madrugada.

   Aquí se guarda la suscripción del teléfono. La clave PRIVADA que firma los
   avisos NO está aquí ni puede estarlo: vive como secreto en Supabase, dentro de
   la función «avisar-pago». El navegador solo conoce la clave PÚBLICA.

   Expone: window.Avisos
   ============================================================================ */
(function () {
  'use strict';

  var A = window.APRENDO;

  if (!A) return;   // sin configuración, supabase-client.js ya avisa en pantalla

  function h(s) { return A.escaparHtml(s); }

  /**
   * La clave pública viaja en base64 para URL y el navegador la quiere en bytes.
   * Es una conversión obligatoria: sin ella, subscribe() falla sin explicar por qué.
   */
  function claveABytes(base64) {
    var relleno = new Array(4 - (base64.length % 4)).join('=');
    var limpio = (base64 + relleno).replace(/-/g, '+').replace(/_/g, '/');
    var crudo = window.atob(limpio);
    var bytes = new Uint8Array(crudo.length);
    for (var i = 0; i < crudo.length; i++) bytes[i] = crudo.charCodeAt(i);
    return bytes;
  }

  function hayServiceWorker() {
    return 'serviceWorker' in navigator;
  }

  function hayPush() {
    return 'PushManager' in window;
  }

  /** Se puede usar aquí? (Safari antiguo y los navegadores dentro de apps no) */
  function soportado() {
    return hayServiceWorker() && hayPush() && 'Notification' in window;
  }

  function claveConfigurada() {
    return !!(A.cfg && A.cfg.VAPID_PUBLICA && A.cfg.VAPID_PUBLICA.length > 20);
  }

  /**
   * Estado actual, para pintar el botón.
   *   'no-soportado'  el navegador no puede
   *   'sin-clave'     falta configurar la clave pública
   *   'permiso-no'    el usuario dijo que no (hay que cambiarlo en los ajustes)
   *   'apagado'       se puede activar
   *   'encendido'     ya está suscrito en este teléfono
   */
  async function estado() {
    if (!soportado()) return 'no-soportado';
    if (!claveConfigurada()) return 'sin-clave';

    if (Notification.permission === 'denied') return 'permiso-no';
    if (Notification.permission === 'default') return 'apagado';

    try {
      var reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return 'apagado';
      var sub = await reg.pushManager.getSubscription();
      return sub ? 'encendido' : 'apagado';
    } catch (e) {
      return 'apagado';
    }
  }

  /**
   * Activa los avisos en ESTE teléfono.
   * Debe llamarse desde un toque del usuario: los navegadores exigen un gesto
   * real para pedir permiso de notificaciones.
   */
  async function activar() {
    if (!soportado()) {
      throw new Error('Este navegador no admite avisos en el teléfono. El aviso sonoro sí funciona.');
    }
    if (!claveConfigurada()) {
      throw new Error('Falta la clave pública de los avisos en config.js.');
    }

    var permiso = await Notification.requestPermission();
    if (permiso !== 'granted') {
      throw new Error('No diste permiso para las notificaciones. Puedes activarlo en los ajustes del navegador.');
    }

    var reg = await navigator.serviceWorker.register('sw.js');
    await navigator.serviceWorker.ready;

    var sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        // En Chrome es obligatorio que sea true: un aviso silencioso no sirve
        // para enterarse de que entró dinero.
        userVisibleOnly: true,
        applicationServerKey: claveABytes(A.cfg.VAPID_PUBLICA)
      });
    }

    await guardar(sub);
    return sub;
  }

  /** Guarda (o actualiza) la suscripción de este teléfono en la base de datos. */
  async function guardar(sub) {
    var sesion = await A.auth.sesion();
    if (!sesion) throw new Error('Se cerró tu sesión. Vuelve a entrar.');

    var json = sub.toJSON();
    var fila = {
      user_id: sesion.user.id,
      endpoint: json.endpoint,
      p256dh: json.keys && json.keys.p256dh,
      auth: json.keys && json.keys.auth
    };

    // El endpoint es único: si el mismo teléfono vuelve a suscribirse, se
    // actualiza en vez de duplicar.
    var r = await A.client.from('suscripciones_push')
      .upsert(fila, { onConflict: 'endpoint' })
      .select().single();
    if (r.error) throw r.error;
    return r.data;
  }

  /** Apaga los avisos en este teléfono y borra su suscripción. */
  async function desactivar() {
    try {
      var reg = await navigator.serviceWorker.getRegistration();
      if (!reg) return true;
      var sub = await reg.pushManager.getSubscription();
      if (!sub) return true;

      var endpoint = sub.toJSON().endpoint;
      await sub.unsubscribe();

      // Se borra por endpoint: la política solo deja tocar las propias.
      var r = await A.client.from('suscripciones_push').delete().eq('endpoint', endpoint);
      if (r.error) throw r.error;
      return true;
    } catch (e) {
      throw new Error(A.traducirError(e));
    }
  }

  /** Cuántos teléfonos hay suscritos ahora mismo (para que el admin lo vea). */
  async function cuantos() {
    try {
      var r = await A.client.from('suscripciones_push').select('id');
      if (r.error) throw r.error;
      return (r.data || []).length;
    } catch (e) {
      return null;
    }
  }

  window.Avisos = {
    soportado: soportado,
    estado: estado,
    activar: activar,
    desactivar: desactivar,
    cuantos: cuantos
  };
})();
