-- El padrón de condición del RUC — Buen Contribuyente / Agente de Retención
--
-- Si a una compra le corresponde o no la retención del IGV depende, entre
-- otras cosas, de si el proveedor es Buen Contribuyente o Agente de
-- Retención/Percepción. Eso no lo trae ni el registro de compras (RCE) ni el
-- XML del comprobante: solo la Consulta RUC pública de SUNAT.
--
-- Esa consulta tiene reCAPTCHA v3 —lo resuelve un navegador de verdad al
-- hacer clic en «Buscar», nunca una petición suelta—, así que la trae el
-- mismo scraper de Playwright que ya baja los XML (`scripts/consultar-padron-ruc.mts`).
--
-- Es una tabla SIN empresa_ruc a propósito: la condición de un RUC ante
-- SUNAT es un dato público del RUC, no algo distinto para cada empresa del
-- grupo que lo consulte. Consultarlo una vez sirve para todas.

create table padron_ruc (
  ruc                 text primary key,
  razon_social        text,

  -- Tal como los devuelve la Consulta RUC: "ACTIVO"/"BAJA...", "HABIDO"/"NO HABIDO".
  estado              text,
  condicion           text,

  buen_contribuyente  boolean not null default false,
  agente_retencion    boolean not null default false,
  agente_percepcion   boolean not null default false,

  -- El texto tal cual bajo «Padrones:», para el caso —resolución, fecha—
  -- que los tres booleanos no alcanzan a explicar. Vacío si es "NINGUNO".
  padrones_detalle    text,

  consultado_en       timestamptz not null default now()
);

comment on table padron_ruc is
  'La condición de cada RUC ante SUNAT (Buen Contribuyente, Agente de Retención/Percepción, Habido), tal como la trae la Consulta RUC pública. No decide si corresponde retener: solo informa la condición del proveedor.';

alter table padron_ruc enable row level security;

-- Lo mismo que el resto de datos de SUNAT: es del estado tributario de un
-- RUC, no de una persona. Lo ve quien puede ver todos los gastos.
create policy padron_ruc_lectura on padron_ruc for select using (
  seguridad.puede_ver_todo()
);

/**
 * Guarda (o actualiza) la condición de uno o varios RUC.
 *
 * Recibe el lote entero de una corrida del scraper, no RUC por RUC: así una
 * corrida de cuarenta RUC es una sola llamada, no cuarenta.
 */
create or replace function guardar_padron_ruc(p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_guardados integer := 0;
  f           jsonb;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema actualiza el padrón de RUC.';
  end if;

  for f in select * from jsonb_array_elements(p_filas)
  loop
    insert into padron_ruc (
      ruc, razon_social, estado, condicion,
      buen_contribuyente, agente_retencion, agente_percepcion,
      padrones_detalle, consultado_en
    ) values (
      f->>'ruc', nullif(f->>'razonSocial', ''), nullif(f->>'estado', ''), nullif(f->>'condicion', ''),
      coalesce((f->>'buenContribuyente')::boolean, false),
      coalesce((f->>'agenteRetencion')::boolean, false),
      coalesce((f->>'agentePercepcion')::boolean, false),
      nullif(f->>'padronesTexto', ''), now()
    )
    on conflict (ruc) do update set
      razon_social       = excluded.razon_social,
      estado             = excluded.estado,
      condicion          = excluded.condicion,
      buen_contribuyente = excluded.buen_contribuyente,
      agente_retencion   = excluded.agente_retencion,
      agente_percepcion  = excluded.agente_percepcion,
      padrones_detalle   = excluded.padrones_detalle,
      consultado_en      = now();
    v_guardados := v_guardados + 1;
  end loop;

  return v_guardados;
end;
$$;

/**
 * Los RUC de proveedor que hay en el registro de compras y todavía no están
 * en el padrón, o llevan más de `p_dias_vigencia` sin consultarse.
 *
 * La usa el scraper para saber a quién consultar, sin traer el padrón
 * completo ni repetir en SQL la lista de proveedores que ya vive en
 * `comprobantes_sunat`.
 */
create or replace function rucs_por_actualizar_en_padron(p_dias_vigencia int default 30)
returns table (ruc text)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select distinct c.proveedor_ruc as ruc
  from comprobantes_sunat c
  left join padron_ruc p on p.ruc = c.proveedor_ruc
  where seguridad.puede_ver_todo()
    and c.proveedor_ruc is not null
    and (p.ruc is null or p.consultado_en < now() - (p_dias_vigencia || ' days')::interval)
  order by 1;
$$;

revoke all on padron_ruc from anon;
revoke insert, update, delete, truncate, references, trigger
  on padron_ruc from authenticated;

revoke execute on function guardar_padron_ruc(jsonb)             from public, anon;
grant  execute on function guardar_padron_ruc(jsonb)             to authenticated;
revoke execute on function rucs_por_actualizar_en_padron(int)    from anon;
grant  execute on function rucs_por_actualizar_en_padron(int)    to authenticated;
