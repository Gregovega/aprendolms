-- ============================================================================
--  APRENDO LMS — Esquema inicial
--  No toca nada de COMARCA ni de GUARDIANKYC: este archivo se ejecuta
--  ÚNICAMENTE en el proyecto APRENDO LMS (wkqmgkevttvmbqrpxguk).
--
--  CÓMO USARLO:
--   1. Supabase Dashboard del proyecto APRENDO LMS
--   2. Menú lateral -> SQL Editor -> New query
--   3. Pegar TODO este archivo y pulsar RUN
--   4. Al final, ejecutar el bloque "PRIMER ADMINISTRADOR" (paso 9)
--
--  Es idempotente: puedes volver a ejecutarlo sin romper nada.
-- ============================================================================


-- ============================================================================
-- 1. TABLAS
-- ============================================================================

-- Perfil del alumno. Se rellena solo al registrarse (trigger más abajo).
create table if not exists public.perfiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  nombre_completo text,
  email           text,
  creado_en       timestamptz not null default now()
);
comment on table public.perfiles is 'El alumno. El nombre_completo es el que sale en el certificado.';

-- Ajustes de la academia. Fila única (id = 1). Configurable desde el panel.
create table if not exists public.ajustes (
  id               int primary key default 1 check (id = 1),
  nombre_academia  text not null default 'Mi Academia',
  firma_url        text,
  logo_url         text,
  actualizado_en   timestamptz not null default now()
);
comment on table public.ajustes is 'Ajustes globales: nombre de la academia y firma del certificado.';

-- Quién puede administrar. El primer admin se asigna a mano (paso 9).
create table if not exists public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  creado_en  timestamptz not null default now()
);
comment on table public.admins is 'Administradores. Nadie se auto-promociona: se inserta a mano o desde otro admin.';

-- Cursos.
create table if not exists public.cursos (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,
  nombre       text not null,
  descripcion  text,
  precio       numeric(10,2) default 0,
  publicado    boolean not null default false,
  creado_en    timestamptz not null default now()
);
comment on table public.cursos is 'Un curso. slug es el subdominio, ej: ventadechicha';

-- Lecciones.
create table if not exists public.lecciones (
  id              uuid primary key default gen_random_uuid(),
  curso_id        uuid not null references public.cursos(id) on delete cascade,
  titulo          text not null,
  descripcion     text,
  wistia_embed    text,
  wistia_video_id text,
  orden           int  not null default 1,
  creado_en       timestamptz not null default now(),
  unique (curso_id, orden)
);
comment on table public.lecciones is 'Lección de un curso. wistia_video_id alimenta la Player API; wistia_embed es el código pegado.';

-- Preguntas del test. respuesta_correcta NUNCA se expone al alumno (ver paso 5).
create table if not exists public.preguntas_test (
  id                 uuid primary key default gen_random_uuid(),
  curso_id           uuid not null references public.cursos(id) on delete cascade,
  leccion_id         uuid references public.lecciones(id) on delete set null,
  pregunta           text not null,
  opciones           jsonb not null,
  respuesta_correcta int  not null,
  explicacion        text,
  orden              int  not null default 1,
  creado_en          timestamptz not null default now()
);
comment on table public.preguntas_test is 'Preguntas de opción múltiple. respuesta_correcta solo la ve el backend.';

-- Inscripción = derecho de acceso. Es el "compró el curso".
create table if not exists public.inscripciones (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  curso_id   uuid not null references public.cursos(id) on delete cascade,
  estado     text not null default 'activa' check (estado in ('activa','pausada','reembolsada')),
  origen     text default 'manual',
  creado_en  timestamptz not null default now(),
  unique (user_id, curso_id)
);
comment on table public.inscripciones is 'Quién tiene derecho a ver qué curso. Control de acceso del requisito 2.1.';

-- Progreso por lección.
create table if not exists public.progress (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  leccion_id      uuid not null references public.lecciones(id) on delete cascade,
  curso_id        uuid not null references public.cursos(id) on delete cascade,
  completado      boolean not null default false,
  porcentaje      numeric(5,2) not null default 0 check (porcentaje between 0 and 100),
  actualizado_en  timestamptz not null default now(),
  unique (user_id, leccion_id)
);
comment on table public.progress is 'Progreso de aprendizaje. El alumno solo escribe el suyo (RLS).';

-- Intentos de examen (historial).
create table if not exists public.intentos_test (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  curso_id    uuid not null references public.cursos(id) on delete cascade,
  aciertos    int  not null,
  total       int  not null,
  nota        numeric(5,2) not null,
  aprobado    boolean not null,
  respuestas  jsonb,
  creado_en   timestamptz not null default now()
);
comment on table public.intentos_test is 'Cada intento de examen. Lo escribe solo la función calificar_test().';

-- Certificados emitidos.
create table if not exists public.certificados (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  curso_id      uuid not null references public.cursos(id) on delete cascade,
  codigo        text not null unique,
  nombre_alumno text not null,
  nombre_curso  text not null,
  emitido_en    timestamptz not null default now(),
  unique (user_id, curso_id)
);
comment on table public.certificados is 'Certificado emitido. El código permite verificarlo públicamente.';


-- ============================================================================
-- 2. FUNCIONES DE APOYO
-- ============================================================================

-- ¿El usuario actual es administrador?
-- SECURITY DEFINER: evita recursión infinita en las políticas de public.admins.
create or replace function public.es_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

-- ¿El usuario actual tiene acceso a este curso? (admin, o inscripción activa)
create or replace function public.tiene_acceso(p_curso_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.es_admin()
      or exists (
           select 1 from public.inscripciones i
           where i.user_id = auth.uid()
             and i.curso_id = p_curso_id
             and i.estado = 'activa'
         );
$$;

-- Al registrarse un usuario, crear su perfil automáticamente.
create or replace function public.crear_perfil_nuevo_usuario()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfiles (id, nombre_completo, email)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'nombre_completo', new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
    new.email
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.crear_perfil_nuevo_usuario();


-- ============================================================================
-- 3. PERMISOS BASE (Supabase moderno NO los da automáticamente)
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- Lectura pública del catálogo
grant select on public.cursos  to anon, authenticated;
grant select on public.ajustes to anon, authenticated;

-- El alumno autenticado necesita estas
grant select                         on public.lecciones      to authenticated;
grant select, insert, update         on public.progress       to authenticated;
grant select                         on public.inscripciones  to authenticated;
grant select                         on public.perfiles       to authenticated;
grant update                         on public.perfiles       to authenticated;
grant select                         on public.certificados   to authenticated;
grant select                         on public.intentos_test  to authenticated;
grant select, insert, update, delete on public.preguntas_test to authenticated;
grant select, insert, update, delete on public.lecciones      to authenticated;
grant select, insert, update, delete on public.cursos         to authenticated;
grant select, insert, update, delete on public.inscripciones  to authenticated;
grant select, insert, update, delete on public.ajustes        to authenticated;
grant select, insert, delete         on public.admins         to authenticated;
grant insert                         on public.certificados   to authenticated;


-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================

alter table public.perfiles       enable row level security;
alter table public.ajustes        enable row level security;
alter table public.admins         enable row level security;
alter table public.cursos         enable row level security;
alter table public.lecciones      enable row level security;
alter table public.preguntas_test enable row level security;
alter table public.inscripciones  enable row level security;
alter table public.progress       enable row level security;
alter table public.intentos_test  enable row level security;
alter table public.certificados   enable row level security;

-- ---- perfiles ----
drop policy if exists perfiles_select_propio on public.perfiles;
create policy perfiles_select_propio on public.perfiles
  for select using (id = auth.uid() or public.es_admin());

drop policy if exists perfiles_update_propio on public.perfiles;
create policy perfiles_update_propio on public.perfiles
  for update using (id = auth.uid() or public.es_admin())
              with check (id = auth.uid() or public.es_admin());

-- ---- ajustes ----
drop policy if exists ajustes_select_todos on public.ajustes;
create policy ajustes_select_todos on public.ajustes
  for select using (true);

drop policy if exists ajustes_admin_escribe on public.ajustes;
create policy ajustes_admin_escribe on public.ajustes
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- admins ----
drop policy if exists admins_select on public.admins;
create policy admins_select on public.admins
  for select using (user_id = auth.uid() or public.es_admin());

drop policy if exists admins_admin_gestiona on public.admins;
create policy admins_admin_gestiona on public.admins
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- cursos ----
-- El catálogo es público (para la página de inicio); el admin ve también los borradores.
drop policy if exists cursos_select on public.cursos;
create policy cursos_select on public.cursos
  for select using (publicado = true or public.es_admin());

drop policy if exists cursos_admin_escribe on public.cursos;
create policy cursos_admin_escribe on public.cursos
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- lecciones ----
-- Solo las ve quien tiene acceso al curso. El admin ve todas.
drop policy if exists lecciones_select on public.lecciones;
create policy lecciones_select on public.lecciones
  for select using (public.tiene_acceso(curso_id));

drop policy if exists lecciones_admin_escribe on public.lecciones;
create policy lecciones_admin_escribe on public.lecciones
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- preguntas_test ----
-- OJO: el alumno NO puede leer directamente esta tabla, porque vería las respuestas.
-- Usa las funciones del paso 5: obtener_preguntas() y calificar_test().
drop policy if exists preguntas_admin_escribe on public.preguntas_test;
create policy preguntas_admin_escribe on public.preguntas_test
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- inscripciones ----
drop policy if exists inscripciones_select on public.inscripciones;
create policy inscripciones_select on public.inscripciones
  for select using (user_id = auth.uid() or public.es_admin());

drop policy if exists inscripciones_admin_escribe on public.inscripciones;
create policy inscripciones_admin_escribe on public.inscripciones
  for all using (public.es_admin()) with check (public.es_admin());

-- ---- progress ----
-- El corazón del requisito técnico: cada alumno SOLO ve y escribe su propio progreso.
drop policy if exists progress_select_propio on public.progress;
create policy progress_select_propio on public.progress
  for select using (user_id = auth.uid() or public.es_admin());

drop policy if exists progress_insert_propio on public.progress;
create policy progress_insert_propio on public.progress
  for insert with check (user_id = auth.uid() and public.tiene_acceso(curso_id));

drop policy if exists progress_update_propio on public.progress;
create policy progress_update_propio on public.progress
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- intentos_test ----
drop policy if exists intentos_select_propio on public.intentos_test;
create policy intentos_select_propio on public.intentos_test
  for select using (user_id = auth.uid() or public.es_admin());

-- ---- certificados ----
drop policy if exists certificados_select_propio on public.certificados;
create policy certificados_select_propio on public.certificados
  for select using (user_id = auth.uid() or public.es_admin());


-- ============================================================================
-- 5. FUNCIONES DEL EXAMEN (protegen las respuestas correctas)
-- ============================================================================

-- Devuelve las preguntas SIN la respuesta correcta.
create or replace function public.obtener_preguntas(p_curso_id uuid)
returns table (id uuid, pregunta text, opciones jsonb, orden int)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.tiene_acceso(p_curso_id) then
    raise exception 'Sin acceso a este curso';
  end if;

  return query
    select p.id, p.pregunta, p.opciones, p.orden
    from public.preguntas_test p
    where p.curso_id = p_curso_id
    order by p.orden, p.creado_en;
end;
$$;

-- Califica en el servidor. El alumno nunca ve las respuestas.
-- p_respuestas: {"<pregunta_id>": <indice_elegido>, ...}
create or replace function public.calificar_test(p_curso_id uuid, p_respuestas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total      int;
  v_aciertos   int;
  v_nota       numeric(5,2);
  v_aprobado   boolean;
  v_leccion    uuid;
  v_curso      text;
begin
  if not public.tiene_acceso(p_curso_id) then
    raise exception 'Sin acceso a este curso';
  end if;

  select count(*) into v_total
  from public.preguntas_test
  where curso_id = p_curso_id;

  if v_total = 0 then
    raise exception 'Este curso no tiene preguntas cargadas';
  end if;

  -- Aciertos: comparar el índice elegido con la respuesta guardada.
  select count(*) into v_aciertos
  from public.preguntas_test p
  where p.curso_id = p_curso_id
    and (p_respuestas->>p.id::text) is not null
    and (p_respuestas->>p.id::text)::int = p.respuesta_correcta;

  v_nota     := round((v_aciertos::numeric / v_total::numeric) * 100, 2);
  v_aprobado := v_nota >= 80;   -- condición del prompt maestro

  insert into public.intentos_test (user_id, curso_id, aciertos, total, nota, aprobado, respuestas)
  values (auth.uid(), p_curso_id, v_aciertos, v_total, v_nota, v_aprobado, p_respuestas);

  -- Si aprueba, emitir el certificado (una sola vez).
  if v_aprobado then
    select c.nombre into v_curso from public.cursos c where c.id = p_curso_id;

    insert into public.certificados (user_id, curso_id, codigo, nombre_alumno, nombre_curso)
    select
      auth.uid(),
      p_curso_id,
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10)),
      coalesce(pr.nombre_completo, 'Alumno'),
      v_curso
    from public.perfiles pr
    where pr.id = auth.uid()
    on conflict (user_id, curso_id) do nothing;
  end if;

  -- Si reprueba, decir QUÉ lección repasar (la primera pregunta fallada).
  if not v_aprobado then
    select p.leccion_id into v_leccion
    from public.preguntas_test p
    where p.curso_id = p_curso_id
      and p.leccion_id is not null
      and (
        (p_respuestas->>p.id::text) is null
        or (p_respuestas->>p.id::text)::int <> p.respuesta_correcta
      )
    order by p.orden
    limit 1;
  end if;

  return jsonb_build_object(
    'aciertos',      v_aciertos,
    'total',         v_total,
    'nota',          v_nota,
    'aprobado',      v_aprobado,
    'leccion_repaso', v_leccion
  );
end;
$$;

-- Verificación pública de un certificado por su código (para la página /verificar).
create or replace function public.verificar_certificado(p_codigo text)
returns table (nombre_alumno text, nombre_curso text, emitido_en timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select c.nombre_alumno, c.nombre_curso, c.emitido_en
  from public.certificados c
  where upper(c.codigo) = upper(p_codigo)
  limit 1;
$$;

grant execute on function public.obtener_preguntas(uuid)        to authenticated;
grant execute on function public.calificar_test(uuid, jsonb)    to authenticated;
grant execute on function public.verificar_certificado(text)    to anon, authenticated;
grant execute on function public.es_admin()                     to authenticated;
grant execute on function public.tiene_acceso(uuid)             to authenticated;


-- ============================================================================
-- 6. DATOS INICIALES
-- ============================================================================

insert into public.ajustes (id, nombre_academia)
values (1, 'Mi Academia')
on conflict (id) do nothing;

-- Índices útiles
create index if not exists idx_lecciones_curso    on public.lecciones (curso_id, orden);
create index if not exists idx_preguntas_curso    on public.preguntas_test (curso_id, orden);
create index if not exists idx_progress_user      on public.progress (user_id, curso_id);
create index if not exists idx_inscrip_user       on public.inscripciones (user_id, curso_id);
create index if not exists idx_intentos_user      on public.intentos_test (user_id, curso_id);


-- ============================================================================
-- 7. COMPROBACIÓN
-- ============================================================================
-- Debe listar 10 tablas con rls_enabled = true
select tablename as tabla, rowsecurity as rls_activo
from pg_tables
where schemaname = 'public'
order by tablename;


-- ============================================================================
-- 8. PRIMER ADMINISTRADOR
-- ============================================================================
-- PASO A: crea tu usuario desde la app (o en Authentication > Users > Add user).
-- PASO B: averigua su UUID:
--
--   select id, email from auth.users order by created_at;
--
-- PASO C: descomenta y pega el UUID en lugar de 'PEGA-AQUI-EL-UUID':
--
--   insert into public.admins (user_id) values ('PEGA-AQUI-EL-UUID')
--   on conflict (user_id) do nothing;
--
-- Sin este paso el panel de administración no podrá crear cursos.
-- ============================================================================
