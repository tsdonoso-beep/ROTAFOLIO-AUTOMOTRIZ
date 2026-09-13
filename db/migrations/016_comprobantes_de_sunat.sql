-- Los comprobantes que SUNAT tiene a nombre de la empresa
--
-- Hasta ahora cada consulta se miraba y se cerraba. Guardarlos permite dos
-- cosas que sin historia no existen: sacar el histórico a una hoja, y notar
-- que un comprobante cambió —que lo anularon, que le movieron el importe—
-- entre una consulta y la siguiente.
--
-- Un comprobante se identifica por su CAR SUNAT cuando viene; si no, por
-- proveedor, tipo, serie y número. La serie y el número solos no alcanzan:
-- los pone el proveedor y se repiten entre proveedores distintos. E001-100
-- salió dos veces en agosto de 2026, de dos empresas que no tienen nada que
-- ver entre sí.

create table comprobantes_sunat (
  id                uuid primary key default gen_random_uuid(),

  empresa_ruc       text not null,
  periodo           text not null,

  -- Con qué se reconoce. Se calcula al guardar, no se recibe de afuera.
  llave             text not null,
  car_sunat         text,

  proveedor_ruc     text,
  proveedor_nombre  text,
  tipo_comprobante  text,
  serie             text,
  numero            text,
  fecha_emision     date,
  total             numeric(14,2),
  moneda            text,
  estado            text,

  -- Cuando es nota de crédito o débito, a qué comprobante corrige.
  tipo_nota         text,
  modifica_tipo     text,
  modifica_serie    text,
  modifica_numero   text,
  modifica_fecha    date,

  primera_vez       timestamptz not null default now(),
  ultima_vez        timestamptz not null default now(),

  constraint comprobantes_sunat_unico unique (empresa_ruc, llave)
);

comment on table comprobantes_sunat is
  'Comprobantes que SUNAT tiene registrados a nombre de la empresa. Una fila por comprobante, actualizada en cada consulta.';
comment on column comprobantes_sunat.llave is
  'CAR SUNAT si vino; si no, proveedor|tipo|serie|número. Serie y número solos se repiten entre proveedores.';

create index comprobantes_sunat_periodo_idx
  on comprobantes_sunat (empresa_ruc, periodo, fecha_emision);
create index comprobantes_sunat_proveedor_idx
  on comprobantes_sunat (empresa_ruc, proveedor_ruc);
-- Para encontrar rápido la nota que corrige a una factura dada.
create index comprobantes_sunat_modifica_idx
  on comprobantes_sunat (empresa_ruc, proveedor_ruc, modifica_serie, modifica_numero)
  where modifica_numero is not null;

-- Cuando un comprobante llega distinto de como estaba
--
-- Es la respuesta a «esta factura ahora está anulada». Sin dejar constancia
-- del antes, un comprobante anulado se ve igual que uno que siempre lo
-- estuvo, y nadie se entera de que cambió.
create table cambios_comprobante_sunat (
  id            uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references comprobantes_sunat(id) on delete cascade,
  notado_en     timestamptz not null default now(),
  campo         text not null,
  antes         text,
  despues       text
);

create index cambios_comprobante_sunat_recientes_idx
  on cambios_comprobante_sunat (notado_en desc);
create index cambios_comprobante_sunat_del_comprobante_idx
  on cambios_comprobante_sunat (comprobante_id, notado_en desc);

alter table comprobantes_sunat        enable row level security;
alter table cambios_comprobante_sunat enable row level security;

-- Lo mismo que la bitácora: es información del estado tributario de la
-- empresa, no de una persona.
create policy comprobantes_sunat_lectura on comprobantes_sunat for select using (
  seguridad.puede_ver_todo()
);
create policy cambios_comprobante_sunat_lectura on cambios_comprobante_sunat for select using (
  seguridad.puede_ver_todo()
);

/**
 * Guarda lo que devolvió una consulta.
 *
 * Recibe las filas juntas porque son miles por período y una por una no
 * entraría en el minuto de vida que tiene una petición.
 *
 * Devuelve cuántas eran nuevas y cuántas llegaron distintas. Lo segundo es
 * lo que importa: son las que cambiaron desde la última vez.
 */
create or replace function guardar_comprobantes_sunat(
  p_empresa_ruc text,
  p_periodo     text,
  p_filas       jsonb
) returns table (nuevos integer, cambiados integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos    integer := 0;
  v_cambiados integer := 0;
  f           jsonb;
  v_llave     text;
  v_id        uuid;
  v_antes     comprobantes_sunat%rowtype;
  v_total     numeric(14,2);
  v_estado    text;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema guarda comprobantes de SUNAT.';
  end if;

  for f in select * from jsonb_array_elements(p_filas)
  loop
    -- La llave se arma acá y no se recibe: si viniera de afuera, un error
    -- del lado de la aplicación duplicaría comprobantes en silencio.
    v_llave := coalesce(
      nullif(trim(f->>'carSunat'), ''),
      concat_ws('|',
        coalesce(f->>'ruc', ''), coalesce(f->>'tipoComprobante', ''),
        upper(coalesce(f->>'serie', '')), coalesce(f->>'numero', '')
      )
    );

    v_total  := nullif(f->>'total', '')::numeric;
    v_estado := nullif(trim(f->>'estado'), '');

    select * into v_antes from comprobantes_sunat
     where empresa_ruc = p_empresa_ruc and llave = v_llave;

    if not found then
      insert into comprobantes_sunat (
        empresa_ruc, periodo, llave, car_sunat, proveedor_ruc, proveedor_nombre,
        tipo_comprobante, serie, numero, fecha_emision, total, moneda, estado,
        tipo_nota, modifica_tipo, modifica_serie, modifica_numero, modifica_fecha
      ) values (
        p_empresa_ruc, p_periodo, v_llave, nullif(trim(f->>'carSunat'), ''),
        nullif(f->>'ruc', ''), nullif(f->>'razonSocial', ''),
        nullif(f->>'tipoComprobante', ''), nullif(f->>'serie', ''), nullif(f->>'numero', ''),
        nullif(f->>'fechaEmision', '')::date, v_total, nullif(f->>'moneda', ''), v_estado,
        nullif(f->>'tipoNota', ''),
        nullif(f#>>'{modifica,tipo}', ''), nullif(f#>>'{modifica,serie}', ''),
        nullif(f#>>'{modifica,numero}', ''), nullif(f#>>'{modifica,fechaEmision}', '')::date
      );
      v_nuevos := v_nuevos + 1;
      continue;
    end if;

    v_id := v_antes.id;

    -- Solo se anota lo que de verdad cambió. Una consulta repetida del mismo
    -- período no debe llenar la historia de filas que dicen lo mismo.
    if v_antes.estado is distinct from v_estado then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'estado', v_antes.estado, v_estado);
      v_cambiados := v_cambiados + 1;
    end if;

    if v_antes.total is distinct from v_total then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'total', v_antes.total::text, v_total::text);
      v_cambiados := v_cambiados + 1;
    end if;

    update comprobantes_sunat
       set estado = v_estado,
           total = v_total,
           proveedor_nombre = coalesce(nullif(f->>'razonSocial', ''), proveedor_nombre),
           ultima_vez = now()
     where id = v_id;
  end loop;

  nuevos := v_nuevos;
  cambiados := v_cambiados;
  return next;
end;
$$;

revoke execute on function guardar_comprobantes_sunat(text, text, jsonb) from public, anon;
grant execute on function guardar_comprobantes_sunat(text, text, jsonb) to authenticated;

-- Supabase concede todo por omisión al crear una tabla.
revoke all on comprobantes_sunat        from anon;
revoke all on cambios_comprobante_sunat from anon;
revoke insert, update, delete, truncate, references, trigger
  on comprobantes_sunat from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on cambios_comprobante_sunat from authenticated;
grant select on comprobantes_sunat        to authenticated;
grant select on cambios_comprobante_sunat to authenticated;
