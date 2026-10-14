/**
 * APRENDO LMS — Aviso de pago nuevo por notificación push
 * ============================================================================
 * POR QUÉ HACE FALTA UNA FUNCIÓN Y NO BASTA CON LA PÁGINA
 *
 * Una página web no puede enviar una notificación por sí sola: el navegador
 * entrega los avisos a través de un servicio externo (el de Google, en Android),
 * y para hablar con ese servicio hay que firmar cada envío con una clave privada.
 * Si esa clave estuviera en la página, cualquiera podría leerla y suplantarnos.
 *
 * Por eso la clave privada vive aquí, como secreto de Supabase, y esta función
 * es la única que la usa. El navegador solo guarda la clave PÚBLICA.
 *
 * QUIÉN LA LLAMA
 *   Un disparador de la base de datos, cada vez que entra un pago nuevo
 *   (ver supabase/005_avisos_push.sql). Le manda el pago y un secreto compartido.
 *
 * SI ALGO FALLA
 *   Nunca debe impedir que el pago se guarde. El disparador lanza la llamada y
 *   sigue; si esta función contesta con error, el pago igualmente queda guardado
 *   y el administrador lo ve en la pantalla de Cobros.
 */

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const VAPID_PUBLICA = Deno.env.get('VAPID_PUBLICA') ?? '';
const VAPID_PRIVADA = Deno.env.get('VAPID_PRIVADA') ?? '';
const VAPID_ASUNTO  = Deno.env.get('VAPID_ASUNTO') ?? 'mailto:admin@example.com';
const AVISO_SECRETO = Deno.env.get('AVISO_SECRETO') ?? '';

function json(cuerpo: unknown, estado = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: { 'Content-Type': 'application/json' },
  });
}

function texto(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);

  // ------------------------------------------------------------------ estado
  // Una consulta sencilla para poder comprobar desde fuera que la función está
  // desplegada y que sus claves están puestas. NO revela ningún secreto: solo
  // dice si están o no.
  if (req.method === 'GET') {
    return json({
      ok: true,
      funcion: 'avisar-pago',
      clave_publica_puesta: VAPID_PUBLICA.length > 20,
      clave_privada_puesta: VAPID_PRIVADA.length > 20,
      secreto_compartido_puesto: AVISO_SECRETO.length > 0,
      asunto: VAPID_ASUNTO,
    });
  }

  if (req.method !== 'POST') return json({ ok: false, error: 'Usa POST' }, 405);

  // ------------------------------------------------------------- autenticación
  // El disparador manda el secreto en la cabecera. Así, aunque alguien descubra
  // la dirección de la función, no puede usarla para enviar avisos falsos.
  if (AVISO_SECRETO) {
    const recibido = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (recibido !== AVISO_SECRETO) {
      return json({ ok: false, error: 'No autorizado' }, 401);
    }
  }

  if (!VAPID_PUBLICA || !VAPID_PRIVADA) {
    return json({ ok: false, error: 'Faltan las claves VAPID en los secretos' }, 500);
  }

  let datos: Record<string, unknown> = {};
  try {
    datos = await req.json();
  } catch {
    return json({ ok: false, error: 'El cuerpo no es JSON' }, 400);
  }

  const monto = texto(datos.monto);
  const moneda = texto(datos.moneda);
  const curso = texto(datos.curso);
  const alumno = texto(datos.alumno);

  const titulo = '💰 Pago nuevo por revisar';
  const cuerpo = [
    monto ? `${monto} ${moneda}`.trim() : 'Nuevo pago',
    curso ? `· ${curso}` : '',
    alumno ? `· ${alumno}` : '',
  ].filter(Boolean).join(' ');

  const carga = JSON.stringify({
    titulo,
    cuerpo,
    pago_id: texto(datos.pago_id),
    // El mismo tag reemplaza el aviso anterior en vez de apilar veinte.
    tag: 'aprendo-pago',
    url: '/cobros.html',
  });

  // ------------------------------------------------------ suscripciones
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  const { data: subs, error } = await supabase
    .from('suscripciones_push')
    .select('id, endpoint, p256dh, auth');

  if (error) return json({ ok: false, error: error.message }, 500);
  if (!subs || subs.length === 0) return json({ ok: true, enviados: 0, nota: 'No hay teléfonos suscritos' });

  webpush.setVapidDetails(VAPID_ASUNTO, VAPID_PUBLICA, VAPID_PRIVADA);

  let enviados = 0;
  const fallos: string[] = [];
  const caducadas: string[] = [];

  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        carga,
      );
      enviados++;
    } catch (e) {
      const codigo = (e as { statusCode?: number }).statusCode;
      // 404 y 410 significan que ese teléfono ya no existe (app desinstalada,
      // permiso retirado...). Se borra para no intentarlo en cada pago.
      if (codigo === 404 || codigo === 410) {
        caducadas.push(s.id);
      } else {
        fallos.push(`${codigo ?? '?'}: ${(e as Error).message}`);
      }
    }
  }));

  if (caducadas.length) {
    await supabase.from('suscripciones_push').delete().in('id', caducadas);
  }

  return json({
    ok: true,
    suscripciones: subs.length,
    enviados,
    caducadas_borradas: caducadas.length,
    fallos,
  });
});
