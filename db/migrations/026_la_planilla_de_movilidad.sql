-- La planilla de movilidad, que trae su propia ley al pie
--
-- Las «reglas no escritas» de las entrevistas resultaron estar escritas, en
-- letra chica, en el pie del propio formulario. La base legal es el inciso
-- a1) del artículo 37° del TUO de la Ley del Impuesto a la Renta y el inciso
-- v) del artículo 21° de su Reglamento, y enumera qué hace válido cada
-- desplazamiento: fecha en que se incurrió en el gasto, nombres y apellidos
-- del trabajador, DNI, motivo, destino y monto.
--
-- Y da la regla de qué pasa si falta uno: «sólo inhabilita la planilla para
-- la sustentación del gasto que corresponde a TAL DESPLAZAMIENTO». Se cae la
-- fila, no la planilla. Es exactamente cómo la aplicación trata los gastos.
--
-- La planilla es un contenedor con una fila por desplazamiento. Hoy la
-- rendición la registra como UNA línea con el total —«PLANILLA DE MOVILIDAD
-- 010212, S/ 20.90»— y así se pierde justo el detalle que la ley exige. Acá
-- cada desplazamiento es un gasto y la planilla los agrupa; el total sale de
-- sumar, no de escribir.

create table planillas_movilidad (
  id             uuid primary key default gen_random_uuid(),
  -- El número impreso del talonario. La 009979 es de Kory Sobrino y la
  -- 010212 la usó Wilmer Zamora: es una serie física, comprada, numerada de
  -- fábrica. Va como texto porque no es una cuenta nuestra, y admite null
  -- para el día que se decida emitir con una serie propia.
  numero         text unique,
  usuario_id     uuid not null references usuarios(id),
  memo_id        uuid references memos(id) on delete set null,
  periodo        text,
  fecha_emision  date,
  -- El formulario tiene dos firmas: la del trabajador y una casilla
  -- AUTORIZADO que firma la jefatura. En la sesión de trabajo se dio por
  -- hecho que la movilidad no necesitaba aprobación; el papel dice lo
  -- contrario, y lo firma el mismo Project Manager que firma los memos.
  autorizado_por uuid references usuarios(id),
  autorizado_en  timestamptz,
  creado_por     uuid references usuarios(id),
  creado_en      timestamptz not null default now()
);

comment on table planillas_movilidad is
  'El contenedor firmado. Cada desplazamiento es un gasto de clase MOVILIDAD que apunta acá.';
comment on column planillas_movilidad.numero is
  'El número impreso del talonario. Null si algún día se emite con serie propia.';

create index on planillas_movilidad (usuario_id);
create index on planillas_movilidad (memo_id) where memo_id is not null;

alter table gastos
  add column planilla_movilidad_id uuid references planillas_movilidad(id) on delete set null,
  -- La columna MOTIVO del formulario, que la ley nombra aparte del destino.
  -- En la planilla 009979: motivo «MOVILIDAD OFICINA - DOMICILIO (VISITA
  -- TÉCNICA)», destino «OFICINA - DOMICILIO». El motivo es el porqué; el
  -- destino, el recorrido.
  add column mov_motivo text;

create index on gastos (planilla_movilidad_id) where planilla_movilidad_id is not null;

-- ────────────────────────────────────────────────────────────────
-- Los seis datos que la ley exige, por desplazamiento
-- ────────────────────────────────────────────────────────────────
--
-- No va como CHECK porque dos de los seis —nombres y DNI— no están en la
-- fila del gasto sino en la persona, y porque la aplicación necesita poder
-- guardar un desplazamiento a medio llenar y avisar, no rechazarlo de plano.
-- Devuelve qué falta, para poder decirlo en castellano.

create or replace function faltas_de_movilidad(p_gasto_id uuid)
returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when g.fecha_emision is null                       then 'la fecha del gasto' end,
    case when coalesce(u.nombre, '') = ''                   then 'el nombre del trabajador' end,
    case when coalesce(u.dni, '') = '' or u.dni_provisional then 'el DNI del trabajador' end,
    case when coalesce(g.mov_motivo, '') = ''               then 'el motivo del desplazamiento' end,
    case when coalesce(g.mov_destino, '') = ''              then 'el destino del desplazamiento' end,
    case when g.total is null or g.total <= 0               then 'el monto gastado' end
  ], null)
  from gastos g
  left join planillas_movilidad p on p.id = g.planilla_movilidad_id
  left join usuarios u on u.id = coalesce(p.usuario_id, g.usuario_id)
  where g.id = p_gasto_id and g.clase = 'MOVILIDAD'
$$;

comment on function faltas_de_movilidad(uuid) is
  'Cuáles de los seis datos que exige el art. 37° a1) le faltan a este desplazamiento. Vacío = sustenta.';

revoke all on function faltas_de_movilidad(uuid) from public;
grant execute on function faltas_de_movilidad(uuid) to authenticated;

alter table planillas_movilidad enable row level security;

create policy planillas_lectura on planillas_movilidad for select
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.puede_ver_todo()
  );

create policy planillas_escritura on planillas_movilidad for all
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  )
  with check (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  );

-- El tope diario ya existía como parámetro pendiente. Se le corrige la
-- descripción con lo que el formulario declara: no es un número que fije
-- Control de Gestión, es un porcentaje de la Remuneración Mínima Vital por
-- trabajador y por día, fijado en el mismo inciso de la Ley del Impuesto a la
-- Renta. El porcentaje y la RMV vigente los confirma Contabilidad, y quedan
-- acá y no en el código porque los dos cambian.
update parametros set
  descripcion = 'Tope diario por trabajador de la planilla de movilidad. Es un porcentaje de la RMV fijado en el art. 37° a1) de la LIR. PENDIENTE: el porcentaje y la RMV vigente los confirma Contabilidad.'
where clave = 'tope_movilidad_dia';
