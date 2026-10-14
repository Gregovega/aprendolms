-- ============================================================================
--  APRENDO LMS — Migración 004: invitar administradores por correo
--  Proyecto: wkqmgkevttvmbqrpxguk   (NO toca COMARCA ni GUARDIANKYC)
--
--  CÓMO USARLA
--    SQL Editor -> pegar todo -> RUN.  Es idempotente.
--
--  QUÉ RESUELVE
--    Dar de alta a otro administrador exigía buscar su UUID a mano y ejecutar un
--    INSERT en el SQL Editor. Eso significa que el dueño de la academia dependía
--    de que alguien técnico se lo hiciera cada vez.
--
--    Ahora se escribe el correo en el panel y queda invitado. En cuanto esa
--    persona se registre, entra como administradora sola. Y si ya tenía cuenta
--    de alumno, se la asciende en el momento.
-- ============================================================================


-- ============================================================================
-- 1. CORREOS INVITADOS A SER ADMINISTRADORES
-- ============================================================================
create table if not exists public.admins_invitados (
  email       text primary key,                 -- se guarda en minúsculas
  nota        text,                             -- para qué o quién es
  invitado_por uuid references auth.users(id) on delete set null,
  creado_en   timestamptz not null default now()
);
comment on table public.admins_invitados is
  'Correos con permiso para ser administradores. Al registrarse (o al invitarlos, si ya tienen cuenta) se les da de alta en admins.';


-- ============================================================================
-- 2. CLAVE FORÁNEA HACIA perfiles
-- El panel lista los administradores con su nombre y su correo, y para eso
-- PostgREST necesita una clave foránea DIRECTA entre admins y perfiles. Sin ella
-- responde "Could not find a relationship…". Es el mismo detalle que ya se
-- corrigió en inscripciones y en pagos; check_embeds.py lo vigila.
-- ============================================================================
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'admins_user_id_perfiles_fkey'
      and conrelid = 'public.admins'::regclass
  ) then
    alter table public.admins
      add constraint admins_user_id_perfiles_fkey
      foreign key (user_id) references public.perfiles(id) on delete cascade;
  end if;
end $$;


-- ============================================================================
-- 3. PERMISOS Y RLS
-- ============================================================================
grant select, insert, delete on public.admins_invitados to authenticated;
alter table public.admins_invitados enable row level security;

-- Solo un administrador ve y toca la lista de invitados.
drop policy if exists admins_invitados_leer on public.admins_invitados;
create policy admins_invitados_leer on public.admins_invitados
  for select using (public.es_admin());

drop policy if exists admins_invitados_escribir on public.admins_invitados;
create policy admins_invitados_escribir on public.admins_invitados
  for all using (public.es_admin()) with check (public.es_admin());


-- ============================================================================
-- 4. PROMOCIÓN AUTOMÁTICA AL REGISTRARSE
--    Se dispara al crearse el perfil, que es lo que hace el registro.
-- ============================================================================
create or replace function public.promover_admin_invitado()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.email is not null and exists (
    select 1 from public.admins_invitados i
    where lower(i.email) = lower(new.email)
  ) then
    insert into public.admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;
  return new;
end $$;

drop trigger if exists promover_admin_invitado on public.perfiles;
create trigger promover_admin_invitado
  after insert on public.perfiles
  for each row execute function public.promover_admin_invitado();


-- ============================================================================
-- 5. INVITAR DESDE EL PANEL
--    Además de apuntar el correo, si esa persona YA tiene cuenta se la asciende
--    en el acto: no hay que esperar a que se registre otra vez.
-- ============================================================================
create or replace function public.invitar_admin(p_email text, p_nota text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(coalesce(p_email, '')));
  v_uid   uuid;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede añadir administradores';
  end if;

  if v_email = '' or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Ese correo no parece una dirección válida';
  end if;

  insert into public.admins_invitados (email, nota, invitado_por)
  values (v_email, nullif(trim(coalesce(p_nota, '')), ''), auth.uid())
  on conflict (email) do update set nota = coalesce(excluded.nota, public.admins_invitados.nota);

  -- Si ya tiene cuenta, se le da el permiso ya mismo.
  select id into v_uid from public.perfiles where lower(email) = v_email limit 1;
  if v_uid is not null then
    insert into public.admins (user_id) values (v_uid) on conflict (user_id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'email', v_email,
    'ya_tenia_cuenta', v_uid is not null
  );
end $$;


-- ============================================================================
-- 6. QUITAR EL PERMISO
--    Dos protecciones para no quedarse fuera de la propia academia:
--      - no puedes quitarte el permiso a ti mismo
--      - siempre tiene que quedar al menos un administrador
-- ============================================================================
create or replace function public.quitar_admin(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email   text;
  v_cuantos int;
begin
  if not public.es_admin() then
    raise exception 'Solo un administrador puede quitar administradores';
  end if;

  if p_user_id = auth.uid() then
    raise exception 'No puedes quitarte el permiso a ti mismo: pídeselo al otro administrador';
  end if;

  select count(*) into v_cuantos from public.admins;
  if v_cuantos <= 1 then
    raise exception 'Tiene que quedar al menos un administrador';
  end if;

  select email into v_email from public.perfiles where id = p_user_id;

  delete from public.admins where user_id = p_user_id;
  if v_email is not null then
    delete from public.admins_invitados where lower(email) = lower(v_email);
  end if;

  return jsonb_build_object('ok', true, 'quitado', p_user_id);
end $$;


grant execute on function public.invitar_admin(text, text) to authenticated;
grant execute on function public.quitar_admin(uuid)        to authenticated;


-- ============================================================================
-- 7. COMPROBACIÓN
-- ============================================================================
select
  (select count(*) from public.admins_invitados) as invitados,
  (select count(*) from public.admins)           as administradores,
  (select count(*) from pg_trigger where tgname = 'promover_admin_invitado') as disparador;
