-- El detalle de los comprobantes, línea por línea
--
-- El registro de compras (RCE) y la tabla `comprobantes_sunat` traen la
-- cabecera: cuánto, de quién, cuándo. No traen en qué se gastó. Ese detalle
-- —«4 CONTENEDOR DE BASURA 240L a 287.29 c/u»— vive solo en el XML del
-- comprobante, que se baja de la pantalla «Consultar Factura y Nota →
-- Descarga masiva» y se importa acá.
--
-- Es un almacén aparte del de `comprobantes_sunat` a propósito: aquel se
-- llena con lo que SUNAT declaró CONTRA la empresa (compras); este se llena
-- con los XML que alguien bajó, que pueden ser recibidos O emitidos, y que
-- pueden no estar en el registro —una boleta, o una factura emitida—. No se
-- fuerza que el comprobante exista en el otro almacén: se enlazan cuando
-- coinciden, por proveedor, tipo, serie y número, no por una llave dura.
--
-- El XML no trae el CAR SUNAT —ese lo asigna SUNAT en el registro, no el
-- emisor—, así que acá la identidad es proveedor + tipo + serie + número.

-- ── El comprobante, uno por XML importado ──
create table cpe_comprobante (
  id                uuid primary key default gen_random_uuid(),

  empresa_ruc       text not null,

  -- De cara a quién se emitió: si el adquiriente es la empresa es recibido
  -- (una compra), si el emisor es la empresa es emitido (una venta). Se
  -- calcula al importar, no se recibe.
  origen            text not null check (origen in ('RECIBIDO', 'EMITIDO', 'OTRO')),

  proveedor_ruc     text,
  proveedor_nombre  text,
  adquiriente_ruc   text,
  adquiriente_nombre text,

  tipo_comprobante  text,
  serie             text,
  -- Sin ceros de relleno, para que calce con `comprobantes_sunat`.
  numero            text,
  fecha_emision     date,
  moneda            text,

  subtotal          numeric(14,2),
  igv               numeric(14,2),
  total             numeric(14,2),

  -- El período tributario en formato yyyymm, derivado de la fecha de emisión,
  -- para poder filtrar la hoja por mes como en el histórico.
  periodo           text,

  -- Dónde quedó archivado el XML físico, si se subió a Drive (fase 2).
  xml_drive_url     text,

  importado_en      timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- La identidad de un comprobante para esta empresa. El proveedor entra en
  -- la llave porque una misma serie-número se repite entre emisores distintos.
  constraint cpe_comprobante_unico
    unique (empresa_ruc, tipo_comprobante, serie, numero, proveedor_ruc)
);

comment on table cpe_comprobante is
  'Comprobantes cuyo XML se importó desde la descarga masiva de SUNAT. Trae el detalle de ítems, que el registro de compras no tiene.';

create index cpe_comprobante_periodo_idx
  on cpe_comprobante (empresa_ruc, periodo, fecha_emision);
create index cpe_comprobante_proveedor_idx
  on cpe_comprobante (empresa_ruc, proveedor_ruc);
-- Para enlazar con comprobantes_sunat sin una llave dura.
create index cpe_comprobante_identidad_idx
  on cpe_comprobante (empresa_ruc, proveedor_ruc, tipo_comprobante, serie, numero);

-- ── Las líneas de cada comprobante ──
create table cpe_item (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references cpe_comprobante(id) on delete cascade,
  -- El orden de la línea dentro del comprobante.
  linea           int not null,
  descripcion     text,
  cantidad        numeric(14,4),
  -- Código de unidad de SUNAT: NIU (unidad), GLL (galón), ZZ (servicio)...
  unidad          text,
  precio_unitario numeric(14,4),
  importe         numeric(14,2),

  constraint cpe_item_unico unique (comprobante_id, linea)
);

create index cpe_item_del_comprobante_idx on cpe_item (comprobante_id, linea);

alter table cpe_comprobante enable row level security;
alter table cpe_item        enable row level security;

-- Lo mismo que el resto de datos de SUNAT: es del estado tributario de la
-- empresa, no de una persona. Lo ve quien puede ver todos los gastos.
create policy cpe_comprobante_lectura on cpe_comprobante for select using (
  seguridad.puede_ver_todo()
);
create policy cpe_item_lectura on cpe_item for select using (
  seguridad.puede_ver_todo()
);

/**
 * Guarda un lote de comprobantes con sus ítems.
 *
 * Recibe todo junto —cabecera e ítems por comprobante— porque un ZIP de
 * descarga masiva trae cientos, y uno por uno no entraría en el minuto de
 * vida de una petición.
 *
 * Un comprobante que ya estaba se actualiza y se le reemplazan los ítems: la
 * fuente de verdad es el XML recién importado, no lo que hubiera antes. Así
 * reimportar el mismo ZIP no duplica nada.
 */
create or replace function guardar_cpe(
  p_empresa_ruc text,
  p_docs        jsonb
) returns table (nuevos integer, actualizados integer, items integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos        integer := 0;
  v_actualizados  integer := 0;
  v_items         integer := 0;
  d               jsonb;
  it              jsonb;
  v_id            uuid;
  v_existe        boolean;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema importa comprobantes de SUNAT.';
  end if;

  for d in select * from jsonb_array_elements(p_docs)
  loop
    select id into v_id from cpe_comprobante
     where empresa_ruc      = p_empresa_ruc
       and tipo_comprobante is not distinct from nullif(d->>'tipoComprobante', '')
       and serie            is not distinct from nullif(d->>'serie', '')
       and numero           is not distinct from nullif(d->>'numero', '')
       and proveedor_ruc    is not distinct from nullif(d->>'proveedorRuc', '');

    v_existe := v_id is not null;

    if v_existe then
      update cpe_comprobante set
        origen             = d->>'origen',
        proveedor_nombre   = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc    = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre = nullif(d->>'adquirienteNombre', ''),
        fecha_emision      = nullif(d->>'fechaEmision', '')::date,
        moneda             = nullif(d->>'moneda', ''),
        subtotal           = nullif(d->>'subtotal', '')::numeric,
        igv                = nullif(d->>'igv', '')::numeric,
        total              = nullif(d->>'total', '')::numeric,
        periodo            = nullif(d->>'periodo', ''),
        actualizado_en     = now()
      where id = v_id;
      -- Los ítems se reescriben enteros: es más simple y más correcto que
      -- adivinar cuáles cambiaron línea por línea.
      delete from cpe_item where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', '')
      ) returning id into v_id;
      v_nuevos := v_nuevos + 1;
    end if;

    for it in select * from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb))
    loop
      insert into cpe_item (
        comprobante_id, linea, descripcion, cantidad, unidad, precio_unitario, importe
      ) values (
        v_id,
        coalesce((it->>'linea')::int, 0),
        nullif(it->>'descripcion', ''),
        nullif(it->>'cantidad', '')::numeric,
        nullif(it->>'unidad', ''),
        nullif(it->>'precioUnitario', '')::numeric,
        nullif(it->>'importe', '')::numeric
      )
      on conflict (comprobante_id, linea) do nothing;
      v_items := v_items + 1;
    end loop;
  end loop;

  nuevos := v_nuevos;
  actualizados := v_actualizados;
  items := v_items;
  return next;
end;
$$;

/**
 * El detalle entero como filas planas, una por ítem, para sacarlo a una hoja.
 *
 * Por función y no leyendo las tablas: son miles de líneas y PostgREST corta
 * en mil sin avisar. Trae la cabecera del comprobante repetida en cada línea,
 * que es como una hoja de cálculo lo quiere.
 */
create or replace function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

/** Cuántos comprobantes importados hay y de qué períodos. */
create or replace function periodos_de_cpe()
returns table (periodo text, cuantos bigint)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select periodo, count(*)
  from cpe_comprobante
  where seguridad.puede_ver_todo() and periodo is not null
  group by periodo
  order by periodo desc;
$$;

-- Permisos: Supabase concede todo por omisión al crear una tabla.
revoke all on cpe_comprobante from anon;
revoke all on cpe_item        from anon;
revoke insert, update, delete, truncate, references, trigger
  on cpe_comprobante from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on cpe_item from authenticated;

revoke execute on function guardar_cpe(text, jsonb)   from public, anon;
grant  execute on function guardar_cpe(text, jsonb)   to authenticated;
revoke execute on function detalle_cpe(text)          from anon;
grant  execute on function detalle_cpe(text)          to authenticated;
revoke execute on function periodos_de_cpe()          from anon;
grant  execute on function periodos_de_cpe()          to authenticated;
