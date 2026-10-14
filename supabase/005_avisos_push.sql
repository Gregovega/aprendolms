-- ============================================================================
--  APRENDO LMS — Migración 005: avisar al teléfono cuando entra un pago
--  Proyecto: wkqmgkevttvmbqrpxguk   (NO toca COMARCA ni GUARDIANKYC)
--
--  CÓMO USARLA
--    SQL Editor -> pegar todo -> RUN.  Es idempotente.
--
--  QUÉ HACE
--    Al entrar un pago nuevo, llama a la función «avisar-pago» de Supabase, que
--    manda la notificación al teléfono de cada administrador suscrito.
--
--    La llamada es ASÍNCRONA (pg_net la encola): el pago se guarda igual de
--    rápido y no depende de que el aviso salga bien. Si la función fallara, el
--    pago queda guardado y se ve igualmente en la pantalla de Cobros.
--
--  ANTES DE QUE ESTO SIRVA: LOS DOS SECRETOS
--    El disparador necesita saber a qué dirección llamar y con qué secreto. No
--    se escriben aquí (este archivo va al repositorio), sino que se guardan
--    cifrados en Vault. Se hace una sola vez con estas dos órdenes, sustituyendo
--    los valores:
--
--      select vault.create_secret(
--        'https://wkqmgkevttvmbqrpxguk.supabase.co/functions/v1/avisar-pago',
--        'aviso_pago_url', 'Direccion de la funcion que envia los avisos');
--
--      select vault.create_secret(
--        'EL_MISMO_SECRETO_QUE_AVISO_SECRETO',
--        'aviso_pago_secreto', 'Secreto compartido con la funcion');
--
--    Si aún no están puestos, el disparador no hace nada y no da error.
-- ============================================================================


-- ============================================================================
-- 1. pg_net: permite llamar por HTTP desde un disparador de la base de datos
-- ============================================================================
create extension if not exists pg_net;


-- ============================================================================
-- 2. EL DISPARADOR
-- ============================================================================
create or replace function public.avisar_pago_nuevo()
returns trigger
language plpgsql
security definer
set search_path = public, net, vault
as $$
declare
  v_url     text;
  v_secreto text;
begin
  -- Solo los pagos que esperan revisión. Si algún día se insertara un pago ya
  -- aprobado (por ejemplo al importar histórico), no se avisa de nada.
  if new.estado <> 'pendiente' then
    return new;
  end if;

  select decrypted_secret into v_url
    from vault.decrypted_secrets where name = 'aviso_pago_url' limit 1;
  select decrypted_secret into v_secreto
    from vault.decrypted_secrets where name = 'aviso_pago_secreto' limit 1;

  -- Sin configurar: no es un error, simplemente no hay avisos al teléfono.
  -- El administrador sigue viendo el pago en la pantalla de Cobros.
  if v_url is null or v_url = '' then
    return new;
  end if;

  perform net.http_post(
    url := v_url,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || coalesce(v_secreto, '')
    ),
    body := jsonb_build_object(
      'pago_id', new.id,
      'monto',   new.monto,
      'moneda',  new.moneda,
      'curso',   (select nombre from public.cursos  where id = new.curso_id),
      'alumno',  (select nombre_completo from public.perfiles where id = new.user_id)
    ),
    timeout_milliseconds := 8000
  );

  return new;
end $$;

drop trigger if exists avisar_pago_nuevo on public.pagos;
create trigger avisar_pago_nuevo
  after insert on public.pagos
  for each row execute function public.avisar_pago_nuevo();


-- ============================================================================
-- 3. COMPROBACIÓN
-- ============================================================================
select
  (select count(*) from pg_extension where extname = 'pg_net')                  as pg_net,
  (select count(*) from pg_trigger where tgname = 'avisar_pago_nuevo')          as disparador,
  (select count(*) from vault.secrets where name in ('aviso_pago_url','aviso_pago_secreto')) as secretos_guardados;
