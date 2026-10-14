-- ============================================================================
--  APRENDO LMS — Migración 003: cobro manual con pago móvil y otros métodos
--  Proyecto: wkqmgkevttvmbqrpxguk   (NO toca COMARCA ni GUARDIANKYC)
--
--  CÓMO USARLA
--    SQL Editor -> pegar todo -> RUN.  Es idempotente.
--
--  QUÉ RESUELVE
--    1. El administrador escribe SUS DATOS DE COBRO una sola vez (teléfono,
--       banco, cédula, wallet…), no en cada curso.
--    2. En cada curso solo pone CUÁNTO cuesta por cada método (1000 Bs por pago
--       móvil, 1 USDT, 1 USD por Zinli…).
--    3. El alumno manda su pago: método, monto, referencia y captura.
--    4. El administrador lo aprueba (se le abre el curso) o lo rechaza con un
--       motivo que el alumno lee.
--    5. Si alguien reutiliza una referencia de pago, el sistema lo marca SOLO y
--       guarda con qué pago y en qué curso se usó antes.
--    6. Guarda las suscripciones de notificaciones push de los administradores.
-- ============================================================================


-- ============================================================================
-- 1. MÉTODOS DE PAGO (se configuran UNA vez para toda la plataforma)
-- ============================================================================
create table if not exists public.metodos_pago (
  id            uuid primary key default gen_random_uuid(),
  etiqueta      text not null,                             -- 'Pago Móvil', 'USDT (TRC20)', 'Zinli'
  moneda        text not null default 'Bs',                 -- moneda habitual del método
  instrucciones text,                                      -- pasos que lee el alumno
  -- Datos que el alumno copia con un toque. Lista de {etiqueta, valor}:
  --   [{"etiqueta":"Banco","valor":"Banesco"},
  --    {"etiqueta":"Teléfono","valor":"0414-1234567"},
  --    {"etiqueta":"Cédula","valor":"V-12345678"}]
  campos        jsonb not null default '[]'::jsonb,
  activo        boolean not null default true,
  orden         int not null default 1,
  creado_en     timestamptz not null default now()
);
comment on table public.metodos_pago is
  'Datos de cobro del administrador, escritos una sola vez. El monto va por curso en curso_metodos_pago.';


-- ============================================================================
-- 2. CUÁNTO CUESTA CADA CURSO EN CADA MÉTODO
-- ============================================================================
create table if not exists public.curso_metodos_pago (
  id         uuid primary key default gen_random_uuid(),
  curso_id   uuid not null references public.cursos(id) on delete cascade,
  metodo_id  uuid not null references public.metodos_pago(id) on delete cascade,
  monto      numeric(12,2) not null check (monto > 0),
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),
  unique (curso_id, metodo_id)
);
comment on table public.curso_metodos_pago is
  'El precio de UN curso en UN método de pago. Ej: Venta de chicha -> Pago Móvil = 1000 Bs.';


-- ============================================================================
-- 3. PAGOS ENVIADOS POR LOS ALUMNOS
-- ============================================================================
create table if not exists public.pagos (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  curso_id        uuid not null references public.cursos(id) on delete cascade,
  metodo_id       uuid references public.metodos_pago(id) on delete set null,
  metodo_etiqueta text,                    -- copia: si borras el método, el historial sigue entendiéndose
  monto           numeric(12,2),
  moneda          text,
  referencia      text not null,           -- lo que escribió el alumno, tal cual
  referencia_norm text not null,           -- normalizada, para comparar duplicados
  captura_url     text,                    -- ruta del comprobante en el almacén
  estado          text not null default 'pendiente'
                    check (estado in ('pendiente','aprobado','rechazado')),
  motivo          text,                    -- por qué se rechazó; lo lee el alumno
  duplicado_de    uuid references public.pagos(id) on delete set null,
  revisado_por    uuid references auth.users(id) on delete set null,
  revisado_en     timestamptz,
  creado_en       timestamptz not null default now()
);
comment on table public.pagos is
  'Pago declarado por un alumno. duplicado_de apunta al pago anterior con la misma referencia.';

-- ----------------------------------------------------------------------------
-- 3.b CLAVE FORÁNEA HACIA perfiles
-- El panel muestra los pagos con el nombre del alumno, y para eso PostgREST
-- necesita una clave foránea DIRECTA entre pagos y perfiles. Sin ella responde
-- "Could not find a relationship…" (es el mismo fallo que ya se corrigió una vez
-- en inscripciones; check_embeds.py lo vigila).
-- ----------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'pagos_user_id_perfiles_fkey'
      and conrelid = 'public.pagos'::regclass
  ) then
    alter table public.pagos
      add constraint pagos_user_id_perfiles_fkey
      foreign key (user_id) references public.perfiles(id) on delete cascade;
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 3.c MARCAR REFERENCIAS REPETIDAS — en la base de datos, no en el navegador
-- Si alguien vuelve a mandar una referencia ya usada, queda registrado a qué
-- pago anterior corresponde. Se hace con un disparador para que no dependa de
-- que el navegador se acuerde de comprobarlo.
-- ----------------------------------------------------------------------------
create or replace function public.pagos_antes_de_insertar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Normalizar: mayúsculas y solo letras y números, para que "abc-123" y
  -- "ABC 123" cuenten como la misma referencia.
  new.referencia_norm := upper(regexp_replace(coalesce(new.referencia, ''), '[^a-zA-Z0-9]', '', 'g'));

  if new.duplicado_de is null then
    select p.id into new.duplicado_de
    from public.pagos p
    where p.referencia_norm = new.referencia_norm
      and p.id <> new.id
    order by p.creado_en
    limit 1;
  end if;

  return new;
end $$;

drop trigger if exists pagos_antes_de_insertar on public.pagos;
create trigger pagos_antes_de_insertar
  before insert on public.pagos
  for each row execute function public.pagos_antes_de_insertar();


-- ============================================================================
-- 4. SUSCRIPCIONES A NOTIFICACIONES PUSH (administradores)
-- ============================================================================
create table if not exists public.suscripciones_push (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,          -- dirección que da el navegador
  p256dh     text not null,
  auth       text not null,
  creado_en  timestamptz not null default now()
);
comment on table public.suscripciones_push is
  'Un registro por teléfono o navegador del administrador. Sirve para mandarle el aviso de pago nuevo.';


-- ============================================================================
-- 5. PERMISOS
-- ============================================================================
grant select on public.metodos_pago       to anon, authenticated;
grant select on public.curso_metodos_pago to anon, authenticated;
grant select, insert on public.pagos      to authenticated;
grant select, insert, delete on public.suscripciones_push to authenticated;

grant insert, update, delete on public.metodos_pago       to authenticated;
grant insert, update, delete on public.curso_metodos_pago to authenticated;
grant update on public.pagos                              to authenticated;

grant usage on schema public to anon, authenticated;


-- ============================================================================
-- 6. ROW LEVEL SECURITY
-- ============================================================================
alter table public.metodos_pago       enable row level security;
alter table public.curso_metodos_pago enable row level security;
alter table public.pagos              enable row level security;
alter table public.suscripciones_push enable row level security;

-- ---- metodos_pago: los lee cualquiera (el alumno necesita verlos para pagar);
--      solo el administrador los escribe.
drop policy if exists metodos_pago_leer on public.metodos_pago;
create policy metodos_pago_leer on public.metodos_pago
  for select using (activo = true or public.es_admin());

drop policy if exists metodos_pago_admin on public.metodos_pago;
create policy metodos_pago_admin on public.metodos_pago
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- curso_metodos_pago: igual, los precios se ven y solo el admin los toca.
drop policy if exists curso_metodos_pago_leer on public.curso_metodos_pago;
create policy curso_metodos_pago_leer on public.curso_metodos_pago
  for select using (activo = true or public.es_admin());

drop policy if exists curso_metodos_pago_admin on public.curso_metodos_pago;
create policy curso_metodos_pago_admin on public.curso_metodos_pago
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- pagos: cada alumno ve y crea los SUYOS; el administrador ve todos.
drop policy if exists pagos_leer on public.pagos;
create policy pagos_leer on public.pagos
  for select using (user_id = auth.uid() or public.es_admin());

drop policy if exists pagos_crear on public.pagos;
create policy pagos_crear on public.pagos
  for insert with check (
    user_id = auth.uid()
    and estado = 'pendiente'          -- un alumno no puede darse el pago por aprobado
    and revisado_por is null
    and revisado_en is null
  );

-- El alumno NO puede modificar su pago (ni cambiar el estado). Solo el admin,
-- y en la practica lo hace a traves de aprobar_pago / rechazar_pago.
drop policy if exists pagos_admin_actualiza on public.pagos;
create policy pagos_admin_actualiza on public.pagos
  for update using (public.es_admin()) with check (public.es_admin());

drop policy if exists pagos_admin_borra on public.pagos;
create policy pagos_admin_borra on public.pagos
  for delete using (public.es_admin());

-- ---- suscripciones_push: cada uno solo las suyas.
drop policy if exists push_propias on public.suscripciones_push;
create policy push_propias on public.suscripciones_push
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ============================================================================
-- 7. ALMACÉN DE COMPROBANTES (capturas de pago)
--    Cubo PRIVADO: el comprobante solo lo ve su dueño y el administrador.
-- ============================================================================
insert into storage.buckets (id, name, public)
values ('capturas', 'capturas', false)
on conflict (id) do nothing;

-- Subir: solo dentro de tu propia carpeta (capturas/<tu-uuid>/archivo.jpg)
drop policy if exists capturas_subir on storage.objects;
create policy capturas_subir on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'capturas'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- Leer: tu comprobante o cualquiera si eres administrador.
drop policy if exists capturas_leer on storage.objects;
create policy capturas_leer on storage.objects
  for select to authenticated
  using (
    bucket_id = 'capturas'
    and ((storage.foldername(name))[1] = auth.uid()::text or public.es_admin())
  );

-- Borrar: solo el administrador (para poder limpiar comprobantes viejos).
drop policy if exists capturas_borrar on storage.objects;
create policy capturas_borrar on storage.objects
  for delete to authenticated
  using (bucket_id = 'capturas' and public.es_admin());


-- ============================================================================
-- 8. APROBAR Y RECHAZAR (funciones del servidor: el navegador no puede falsearlas)
-- ============================================================================

-- Aprobar: marca el pago y ABRE EL CURSO al alumno, todo junto.
create or replace function public.aprobar_pago(p_pago_id uuid, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.pagos%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede aprobar pagos';
  end if;

  select * into v_pago from public.pagos where id = p_pago_id for update;
  if not found then
    raise exception 'Ese pago no existe';
  end if;

  update public.pagos
     set estado = 'aprobado',
         revisado_por = auth.uid(),
         revisado_en = now(),
         motivo = p_nota
   where id = p_pago_id;

  -- Aqui esta lo importante: se le abre el curso.
  insert into public.inscripciones (user_id, curso_id, estado, origen)
  values (v_pago.user_id, v_pago.curso_id, 'activa', 'pago')
  on conflict (user_id, curso_id)
    do update set estado = 'activa';

  return jsonb_build_object(
    'ok', true,
    'pago_id', p_pago_id,
    'alumno', v_pago.user_id,
    'curso', v_pago.curso_id
  );
end $$;

-- Rechazar: marca el pago con el motivo que vera el alumno. No abre nada.
create or replace function public.rechazar_pago(p_pago_id uuid, p_motivo text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pago public.pagos%rowtype;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede rechazar pagos';
  end if;

  if p_motivo is null or length(trim(p_motivo)) = 0 then
    raise exception 'Hay que explicar por que se rechaza: el alumno lee ese motivo';
  end if;

  select * into v_pago from public.pagos where id = p_pago_id for update;
  if not found then
    raise exception 'Ese pago no existe';
  end if;

  update public.pagos
     set estado = 'rechazado',
         revisado_por = auth.uid(),
         revisado_en = now(),
         motivo = trim(p_motivo)
   where id = p_pago_id;

  return jsonb_build_object('ok', true, 'pago_id', p_pago_id);
end $$;

-- Motivo listo para un pago duplicado: a que pago y curso corresponde.
create or replace function public.detalle_duplicado(p_pago_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'pago_id',      p2.id,
    'curso',        c.nombre,
    'curso_slug',   c.slug,
    'cuando',       p2.creado_en,
    'estado',       p2.estado,
    'referencia',   p2.referencia
  )
  from public.pagos p1
  join public.pagos p2 on p2.id = p1.duplicado_de
  join public.cursos  c on c.id = p2.curso_id
  where p1.id = p_pago_id;
$$;

grant execute on function public.aprobar_pago(uuid, text)   to authenticated;
grant execute on function public.rechazar_pago(uuid, text)  to authenticated;
grant execute on function public.detalle_duplicado(uuid)    to authenticated;


-- ============================================================================
-- 9. COMPROBACIÓN
-- ============================================================================
select
  (select count(*) from public.metodos_pago)       as metodos,
  (select count(*) from public.curso_metodos_pago) as precios_por_curso,
  (select count(*) from public.pagos)              as pagos,
  (select count(*) from public.suscripciones_push) as suscripciones_push,
  (select count(*) from pg_trigger where tgname = 'pagos_antes_de_insertar') as disparador_duplicados,
  (select count(*) from storage.buckets where id = 'capturas')               as cubo_capturas;
