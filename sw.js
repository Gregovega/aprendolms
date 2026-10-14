/* ============================================================================
   APRENDO LMS — Trabajador de servicio (service worker)
   ----------------------------------------------------------------------------
   Es la pieza que permite recibir el aviso CON LA PÁGINA CERRADA.

   Un service worker es un pequeño programa que el navegador mantiene vivo en
   segundo plano, aparte de la pestaña. Cuando llega una notificación push, el
   navegador lo despierta, le entrega el mensaje, y él la muestra.

   Sin esto, la página solo puede avisar MIENTRAS está abierta (con el sonido).
   ============================================================================ */

'use strict';

/* Al instalar, se activa enseguida sin esperar a que se cierren las pestañas
   viejas: si no, el aviso tardaría días en funcionar tras una actualización. */
self.addEventListener('install', function (evento) {
  self.skipWaiting();
});

self.addEventListener('activate', function (evento) {
  evento.waitUntil(self.clients.claim());
});

/* ------------------------------------------------------------- aviso recibido */
self.addEventListener('push', function (evento) {
  var datos = {};
  try {
    datos = evento.data ? evento.data.json() : {};
  } catch (e) {
    // Si el mensaje no venía en JSON, se muestra tal cual en vez de perderlo.
    datos = { titulo: 'Pago nuevo por revisar', cuerpo: evento.data ? evento.data.text() : '' };
  }

  var titulo = datos.titulo || '💰 Pago nuevo por revisar';

  var opciones = {
    body: datos.cuerpo || 'Entra en Cobros para revisarlo.',
    // El mismo tag reemplaza el aviso anterior en vez de apilar veinte iguales.
    tag: datos.tag || 'aprendo-pago',
    renotify: true,
    // Un pago es dinero: el aviso se queda hasta que lo toquen o lo descarten.
    requireInteraction: true,
    data: { url: datos.url || '/cobros.html', pago_id: datos.pago_id || null }
  };

  evento.waitUntil(self.registration.showNotification(titulo, opciones));
});

/* --------------------------------------------------------------- al tocarlo */
self.addEventListener('notificationclick', function (evento) {
  evento.notification.close();

  var destino = (evento.notification.data && evento.notification.data.url) || '/cobros.html';

  evento.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (lista) {
      // Si la pantalla de Cobros ya está abierta, se trae al frente en vez de
      // abrir otra pestaña: en el teléfono, veinte pestañas son un estorbo.
      for (var i = 0; i < lista.length; i++) {
        if (lista[i].url.indexOf('/cobros.html') > -1 && 'focus' in lista[i]) {
          return lista[i].focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(destino);
    })
  );
});
