-- Bitácora de lo que se le ha preguntado a SUNAT
--
-- Cada consulta al registro de compras deja una línea. No guarda los
-- comprobantes —son miles por período y ya viven en SUNAT— sino el resultado:
-- cuántos cuadraron, cuántos no, y por cuánto.
--
-- Por qué una tabla y no una hoja de cálculo: una hoja es una foto de un
-- momento. Esto crece todos los meses y hay que poder preguntarle cosas
-- («¿desde cuándo no consultamos este período?», «¿empeoró el mes pasado?»),
-- que es justo lo que una hoja hace mal a los seis meses.
--
-- Se guarda también la salud de la lectura: si SUNAT cambió el formato del
-- archivo, un cruce puede salir tranquilizador y no significar nada. Sin
-- dejar constancia de eso, un cero en «no están en SUNAT» se lee como buena
-- noticia cuando en realidad es que no se leyó nada.

create table consultas_sunat (
  id                    uuid primary key default gen_random_uuid(),

  -- Qué se preguntó
  empresa_ruc           text        not null,
  periodo               text        not null,
  consultado_por        uuid        not null references usuarios(id),
  consultado_en         timestamptz not null default now(),
  ticket                text,
  archivo               text,

  -- Qué contestó
  comprobantes_sunat    integer     not null default 0,
  comprobantes_nuestros integer     not null default 0,
  cuadran               integer     not null default 0,
  monto_distinto        integer     not null default 0,
  no_estan_en_sunat     integer     not null default 0,
  no_comparables        integer     not null default 0,
  solo_en_sunat         integer     not null default 0,
  monto_solo_en_sunat   numeric(14,2) not null default 0,

  -- Si se puede confiar en lo de arriba
  columnas_faltantes    text[]      not null default '{}',
  identidad_sospechosa  text,
  segundos              integer,

  constraint periodo_yyyymm check (periodo ~ '^[0-9]{4}(0[1-9]|1[0-2])$')
);

comment on column consultas_sunat.identidad_sospechosa is
  'Motivo por el que la lectura no es confiable. Si no es null, los conteos de esa fila no valen.';

-- Se consulta «lo último de este período» y «las últimas consultas».
create index consultas_sunat_periodo_idx
  on consultas_sunat (empresa_ruc, periodo, consultado_en desc);
create index consultas_sunat_recientes_idx
  on consultas_sunat (consultado_en desc);

alter table consultas_sunat enable row level security;

-- Lo ve quien ya puede ver todos los gastos: Contabilidad, quien revisa,
-- Administración de memos y Administración del sistema. No es información
-- de una persona, es del estado tributario de la empresa.
create policy consultas_sunat_lectura on consultas_sunat for select using (
  seguridad.puede_ver_todo()
);

-- Nadie escribe a mano: solo la función que registra una consulta real.
-- Una bitácora que se puede editar deja de ser una bitácora.
create policy consultas_sunat_sin_escritura on consultas_sunat for insert with check (false);

/**
 * Deja constancia de una consulta.
 *
 * SECURITY DEFINER porque la política de inserción está cerrada a propósito:
 * la única forma de escribir aquí es habiendo consultado a SUNAT de verdad.
 */
create or replace function registrar_consulta_sunat(
  p_empresa_ruc           text,
  p_periodo               text,
  p_ticket                text,
  p_archivo               text,
  p_comprobantes_sunat    integer,
  p_comprobantes_nuestros integer,
  p_cuadran               integer,
  p_monto_distinto        integer,
  p_no_estan_en_sunat     integer,
  p_no_comparables        integer,
  p_solo_en_sunat         integer,
  p_monto_solo_en_sunat   numeric,
  p_columnas_faltantes    text[],
  p_identidad_sospechosa  text,
  p_segundos              integer
) returns uuid
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_usuario uuid;
  v_id      uuid;
begin
  v_usuario := seguridad.usuario_actual();
  if v_usuario is null then
    raise exception 'No hay sesión: no se puede registrar la consulta.';
  end if;

  -- Consultar a SUNAT es cosa de Administración del sistema, igual que la
  -- pantalla desde donde se hace.
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema registra consultas a SUNAT.';
  end if;

  insert into consultas_sunat (
    empresa_ruc, periodo, consultado_por, ticket, archivo,
    comprobantes_sunat, comprobantes_nuestros, cuadran, monto_distinto,
    no_estan_en_sunat, no_comparables, solo_en_sunat, monto_solo_en_sunat,
    columnas_faltantes, identidad_sospechosa, segundos
  ) values (
    p_empresa_ruc, p_periodo, v_usuario, p_ticket, p_archivo,
    coalesce(p_comprobantes_sunat, 0), coalesce(p_comprobantes_nuestros, 0),
    coalesce(p_cuadran, 0), coalesce(p_monto_distinto, 0),
    coalesce(p_no_estan_en_sunat, 0), coalesce(p_no_comparables, 0),
    coalesce(p_solo_en_sunat, 0), coalesce(p_monto_solo_en_sunat, 0),
    coalesce(p_columnas_faltantes, '{}'), p_identidad_sospechosa, p_segundos
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Por omisión Postgres da EXECUTE a public, y eso incluye a anon.
revoke execute on function registrar_consulta_sunat(
  text, text, text, text, integer, integer, integer, integer, integer,
  integer, integer, numeric, text[], text, integer
) from public, anon;
grant execute on function registrar_consulta_sunat(
  text, text, text, text, integer, integer, integer, integer, integer,
  integer, integer, numeric, text[], text, integer
) to authenticated;

-- Supabase concede todo a anon y authenticated por omisión al crear una
-- tabla. RLS ya lo frena, pero conviene no depender de una sola defensa:
-- si mañana alguien agrega una política de escritura por descuido, esto
-- sigue sosteniendo que la bitácora no se edita a mano.
revoke all on consultas_sunat from anon;
revoke insert, update, delete, truncate, references, trigger
  on consultas_sunat from authenticated;
grant select on consultas_sunat to authenticated;
