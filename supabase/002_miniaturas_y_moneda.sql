-- ============================================================================
--  APRENDO LMS — Migración 002: miniatura y moneda del curso
--  Proyecto: wkqmgkevttvmbqrpxguk   (NO toca COMARCA ni GUARDIANKYC)
--
--  CÓMO USARLA
--    SQL Editor del proyecto APRENDO LMS -> pegar todo -> RUN
--    Es idempotente: se puede volver a ejecutar sin romper nada.
--
--  POR QUÉ
--    En el catálogo la tarjeta del curso solo mostraba una letra gigante sobre un
--    degradado, y no había forma de poner una foto ni de saber en qué moneda está
--    el precio. Esta migración añade las dos cosas.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- 1. Foto de miniatura de la tarjeta en el catálogo
-- ----------------------------------------------------------------------------
alter table public.cursos
  add column if not exists imagen_url text;

comment on column public.cursos.imagen_url is
  'URL de la foto que se ve en la tarjeta del catálogo. Si está vacía, se pinta la inicial del curso sobre un degradado.';


-- ----------------------------------------------------------------------------
-- 2. Moneda del precio
--    El precio se guarda en cursos.precio (numérico). Sin moneda, "1000" no
--    significa nada: puede ser 1000 Bs, 1 USD, etc.
-- ----------------------------------------------------------------------------
alter table public.cursos
  add column if not exists moneda text not null default 'Bs';

comment on column public.cursos.moneda is
  'Moneda del precio, como se escribe para el alumno (Bs, USD, USDT...). Solo es la etiqueta.';


-- ----------------------------------------------------------------------------
-- 3. Índice para ordenar el catálogo
-- ----------------------------------------------------------------------------
create index if not exists idx_cursos_publicado_creado
  on public.cursos (publicado, creado_en desc);


-- ----------------------------------------------------------------------------
-- 4. COMPROBACIÓN
--    Debe listar las dos columnas nuevas.
-- ----------------------------------------------------------------------------
select column_name as columna, data_type as tipo, column_default as por_defecto
from information_schema.columns
where table_schema = 'public' and table_name = 'cursos'
order by ordinal_position;
