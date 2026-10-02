-- Las fuentes de Compras, COMEX y Almacén junto a cada carpeta de OC
--
-- Contabilidad copia dos veces al día, a una hoja privada (CopiarFuentes.gs),
-- la base de compras nacionales, la de importaciones, el STATUS y las DUA de
-- COMEX y los ingresos del kardex de Almacén. El robot (scripts/fuentes-compras.mts)
-- la lee, la junta por OC y por vale (lib/drive/fuentes-compras.ts) y la sube acá:
--
--   fuente_compra_oc  una fila por OC de la base de Compras (nacional o
--                     importación): quién la hizo, cuándo, cuánto, cómo se paga.
--   fuente_comex_oc   una por OC del STATUS de COMEX: llegada, agente, DAM,
--                     costeo y sus DUA.
--   kardex_vale       una por vale de Almacén: el ingreso por compra con la
--                     guía (o factura) del proveedor y su escaneo.
--   fuente_cambio     lo que cambió de una lectura a otra: el monto de una OC,
--                     una DAM nueva, un vale corregido, anulado o eliminado.
--   fuente_copia      cuándo se copió cada pestaña (COPIA - ESTADO).
--
-- Con eso:
--   1. carpetas_madre_fuentes(): lo mismo que carpetas_madre() más los datos de
--      la OC (fecha, monto, comprador si el legajo no lo sabe) y, de lo que le
--      falta a cada carpeta, qué ya EXISTE en otro lado y solo falta subirlo:
--      la guía que Almacén registró, la DAM o el costeo que COMEX ya tiene, la
--      factura que ya está en SUNAT. Sigue contando como incompleta (el legajo
--      no lo tiene), pero se ve distinto: «Por subir» en vez de «Falta».
--   2. detalle_de_carpeta(): con un bloque «fuentes» (Compras, COMEX, Almacén,
--      lo que cambió en ellas y lo que está por subir).

create table fuente_compra_oc (
  empresa_ruc text not null,
  procedencia text not null,
  oc text not null,
  oc_original text, empresa text, tipo_documento text, fecha date, requerimiento text,
  proveedor_ruc text, proveedor text, pais text, proyecto text, concepto text, moneda text,
  total numeric, total_soles numeric, forma_pago text, condicion_pago text, incoterm text,
  lugar_entrega text, tiempo_entrega text, solicitado text, elaborado text, items integer,
  cargado_en timestamptz not null default now(),
  primary key (empresa_ruc, procedencia, oc)
);

create table fuente_comex_oc (
  empresa_ruc text not null,
  oc text not null,
  oc_original text, empresa text, comprador text, estado_compra text, fecha_oc date, proveedor text,
  origen text, incoterm text, modalidad text, operador text, awb_bl text, etd text, eta text, ata text,
  fecha_aprox_planta text, fecha_real_planta text, documentos_enviados text, agente_aduanas text,
  dam text, costeo text, observaciones text, embarques integer, duas jsonb not null default '[]',
  cargado_en timestamptz not null default now(),
  primary key (empresa_ruc, oc)
);

create table kardex_vale (
  empresa_ruc text not null,
  id text not null,
  vale text, fecha_registro date, fecha_operacion date, movimiento text, operacion text, proveedor text,
  tipo_documento text, numero_documento text, tipo_orden text, numero_orden text, oc text, procedencia text,
  proyecto text, sede text, responsable text, recepcionado text, documento_ruta text, documento_url text,
  vale_url text, items integer, cantidad numeric,
  -- Desde cuándo lo ve el robot (la primera lectura en que apareció).
  visto_desde timestamptz not null default now(),
  cargado_en timestamptz not null default now(),
  primary key (empresa_ruc, id)
);
create index kardex_vale_oc on kardex_vale (empresa_ruc, procedencia, oc);

create table fuente_cambio (
  id bigserial primary key,
  empresa_ruc text not null,
  fuente text not null,          -- COMPRAS, COMEX, ALMACEN
  clave text not null,           -- la OC o el ID del vale
  oc text, procedencia text,
  campo text not null,           -- la columna que cambió, o NUEVO / ELIMINADO
  antes text, despues text,
  fecha timestamptz not null default now()
);
create index fuente_cambio_oc on fuente_cambio (empresa_ruc, oc, fecha desc);

create table fuente_copia (
  empresa_ruc text not null,
  pestana text not null,
  origen text, filas integer, inicio text, fin text, resultado text,
  leido_en timestamptz not null default now(),
  primary key (empresa_ruc, pestana)
);

alter table fuente_compra_oc enable row level security;
alter table fuente_comex_oc enable row level security;
alter table kardex_vale enable row level security;
alter table fuente_cambio enable row level security;
alter table fuente_copia enable row level security;
create policy fuente_compra_oc_lectura on fuente_compra_oc for select using ((select seguridad.puede_ver_todo()));
create policy fuente_comex_oc_lectura on fuente_comex_oc for select using ((select seguridad.puede_ver_todo()));
create policy kardex_vale_lectura on kardex_vale for select using ((select seguridad.puede_ver_todo()));
create policy fuente_cambio_lectura on fuente_cambio for select using ((select seguridad.puede_ver_todo()));
create policy fuente_copia_lectura on fuente_copia for select using ((select seguridad.puede_ver_todo()));
grant select on fuente_compra_oc, fuente_comex_oc, kardex_vale, fuente_cambio, fuente_copia to authenticated;

-- ── La carga ──
--
-- Una fuente por llamada (COMPRAS, COMEX, ALMACEN o COPIA), con todas sus
-- filas: reemplaza lo anterior y anota lo que cambió. Si la fuente ya tenía
-- datos y ahora llegan menos de la mitad (una copia que falló a medias), no
-- borra nada: solo actualiza y lo avisa. La primera carga no anota cambios.

create or replace function cargar_fuentes_compras(p_empresa_ruc text, p_fuente text, p_filas jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  antes integer;
  llegan integer := jsonb_array_length(coalesce(p_filas, '[]'::jsonb));
  cambios integer := 0;
  n integer := 0;
  borrar boolean;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga las fuentes de compras.';
  end if;

  if p_fuente = 'COMPRAS' then
    select count(*) into antes from fuente_compra_oc where empresa_ruc = p_empresa_ruc;
    borrar := antes = 0 or llegan >= antes / 2;
    create temp table nuevo on commit drop as
      select distinct on (x.procedencia, x.oc) x.* from jsonb_populate_recordset(null::fuente_compra_oc, p_filas) x
       where nullif(x.oc, '') is not null and x.procedencia in ('Nacional', 'Importación');
    if antes > 0 then
      insert into fuente_cambio (empresa_ruc, fuente, clave, oc, procedencia, campo, antes, despues)
      select p_empresa_ruc, 'COMPRAS', o.oc, o.oc, o.procedencia, c, to_jsonb(o)->>c, to_jsonb(x)->>c
        from nuevo x join fuente_compra_oc o on o.empresa_ruc = p_empresa_ruc and o.procedencia = x.procedencia and o.oc = x.oc
       cross join unnest(array['total_soles', 'moneda', 'proveedor_ruc', 'proveedor', 'forma_pago', 'elaborado', 'items']) c
       where coalesce(to_jsonb(o)->>c, '') is distinct from coalesce(to_jsonb(x)->>c, '')
         and not (c = 'total_soles' and abs(coalesce(o.total_soles, 0) - coalesce(x.total_soles, 0)) < 0.5);
      get diagnostics n = row_count; cambios := cambios + n;
      if borrar then
        insert into fuente_cambio (empresa_ruc, fuente, clave, oc, procedencia, campo, antes, despues)
        select p_empresa_ruc, 'COMPRAS', o.oc, o.oc, o.procedencia, 'ELIMINADO', o.proveedor || ' · S/ ' || coalesce(o.total_soles::text, '—'), null
          from fuente_compra_oc o
         where o.empresa_ruc = p_empresa_ruc and not exists (select 1 from nuevo x where x.procedencia = o.procedencia and x.oc = o.oc);
        get diagnostics n = row_count; cambios := cambios + n;
      end if;
    end if;
    if borrar then
      delete from fuente_compra_oc o where o.empresa_ruc = p_empresa_ruc
         and not exists (select 1 from nuevo x where x.procedencia = o.procedencia and x.oc = o.oc);
    end if;
    insert into fuente_compra_oc (empresa_ruc, procedencia, oc, oc_original, empresa, tipo_documento, fecha, requerimiento,
           proveedor_ruc, proveedor, pais, proyecto, concepto, moneda, total, total_soles, forma_pago, condicion_pago, incoterm,
           lugar_entrega, tiempo_entrega, solicitado, elaborado, items, cargado_en)
    select p_empresa_ruc, x.procedencia, x.oc, x.oc_original, x.empresa, x.tipo_documento, x.fecha, x.requerimiento,
           x.proveedor_ruc, x.proveedor, x.pais, x.proyecto, x.concepto, x.moneda, x.total, x.total_soles, x.forma_pago,
           x.condicion_pago, x.incoterm, x.lugar_entrega, x.tiempo_entrega, x.solicitado, x.elaborado, x.items, now()
      from nuevo x
    on conflict (empresa_ruc, procedencia, oc) do update set
      oc_original = excluded.oc_original, empresa = excluded.empresa, tipo_documento = excluded.tipo_documento,
      fecha = excluded.fecha, requerimiento = excluded.requerimiento, proveedor_ruc = excluded.proveedor_ruc,
      proveedor = excluded.proveedor, pais = excluded.pais, proyecto = excluded.proyecto, concepto = excluded.concepto,
      moneda = excluded.moneda, total = excluded.total, total_soles = excluded.total_soles, forma_pago = excluded.forma_pago,
      condicion_pago = excluded.condicion_pago, incoterm = excluded.incoterm, lugar_entrega = excluded.lugar_entrega,
      tiempo_entrega = excluded.tiempo_entrega, solicitado = excluded.solicitado, elaborado = excluded.elaborado,
      items = excluded.items, cargado_en = excluded.cargado_en;
    get diagnostics n = row_count;

  elsif p_fuente = 'COMEX' then
    select count(*) into antes from fuente_comex_oc where empresa_ruc = p_empresa_ruc;
    borrar := antes = 0 or llegan >= antes / 2;
    create temp table nuevo on commit drop as
      select distinct on (x.oc) x.* from jsonb_populate_recordset(null::fuente_comex_oc, p_filas) x
       where nullif(x.oc, '') is not null;
    if antes > 0 then
      insert into fuente_cambio (empresa_ruc, fuente, clave, oc, procedencia, campo, antes, despues)
      select p_empresa_ruc, 'COMEX', o.oc, o.oc, 'Importación', c,
             case c when 'duas' then (select string_agg(d->>'dua', ' / ') from jsonb_array_elements(o.duas) d) else to_jsonb(o)->>c end,
             case c when 'duas' then (select string_agg(d->>'dua', ' / ') from jsonb_array_elements(coalesce(x.duas, '[]')) d) else to_jsonb(x)->>c end
        from nuevo x join fuente_comex_oc o on o.empresa_ruc = p_empresa_ruc and o.oc = x.oc
       cross join unnest(array['estado_compra', 'fecha_real_planta', 'agente_aduanas', 'dam', 'costeo', 'comprador', 'duas']) c
       where case c when 'duas' then (select coalesce(string_agg(d->>'dua', ' / '), '') from jsonb_array_elements(o.duas) d)
                               is distinct from (select coalesce(string_agg(d->>'dua', ' / '), '') from jsonb_array_elements(coalesce(x.duas, '[]')) d)
                    else coalesce(to_jsonb(o)->>c, '') is distinct from coalesce(to_jsonb(x)->>c, '') end;
      get diagnostics n = row_count; cambios := cambios + n;
    end if;
    if borrar then
      delete from fuente_comex_oc o where o.empresa_ruc = p_empresa_ruc and not exists (select 1 from nuevo x where x.oc = o.oc);
    end if;
    insert into fuente_comex_oc (empresa_ruc, oc, oc_original, empresa, comprador, estado_compra, fecha_oc, proveedor, origen,
           incoterm, modalidad, operador, awb_bl, etd, eta, ata, fecha_aprox_planta, fecha_real_planta, documentos_enviados,
           agente_aduanas, dam, costeo, observaciones, embarques, duas, cargado_en)
    select p_empresa_ruc, x.oc, x.oc_original, x.empresa, x.comprador, x.estado_compra, x.fecha_oc, x.proveedor, x.origen,
           x.incoterm, x.modalidad, x.operador, x.awb_bl, x.etd, x.eta, x.ata, x.fecha_aprox_planta, x.fecha_real_planta,
           x.documentos_enviados, x.agente_aduanas, x.dam, x.costeo, x.observaciones, x.embarques, coalesce(x.duas, '[]'), now()
      from nuevo x
    on conflict (empresa_ruc, oc) do update set
      oc_original = excluded.oc_original, empresa = excluded.empresa, comprador = excluded.comprador,
      estado_compra = excluded.estado_compra, fecha_oc = excluded.fecha_oc, proveedor = excluded.proveedor,
      origen = excluded.origen, incoterm = excluded.incoterm, modalidad = excluded.modalidad, operador = excluded.operador,
      awb_bl = excluded.awb_bl, etd = excluded.etd, eta = excluded.eta, ata = excluded.ata,
      fecha_aprox_planta = excluded.fecha_aprox_planta, fecha_real_planta = excluded.fecha_real_planta,
      documentos_enviados = excluded.documentos_enviados, agente_aduanas = excluded.agente_aduanas, dam = excluded.dam,
      costeo = excluded.costeo, observaciones = excluded.observaciones, embarques = excluded.embarques,
      duas = excluded.duas, cargado_en = excluded.cargado_en;
    get diagnostics n = row_count;

  elsif p_fuente = 'ALMACEN' then
    select count(*) into antes from kardex_vale where empresa_ruc = p_empresa_ruc;
    borrar := antes = 0 or llegan >= antes / 2;
    create temp table nuevo on commit drop as
      select distinct on (x.id) x.* from jsonb_populate_recordset(null::kardex_vale, p_filas) x
       where nullif(x.id, '') is not null;
    if antes > 0 then
      -- Un vale corregido: otra guía, otra OC, anulado, otra fecha, otras cantidades.
      insert into fuente_cambio (empresa_ruc, fuente, clave, oc, procedencia, campo, antes, despues)
      select p_empresa_ruc, 'ALMACEN', o.id, coalesce(nullif(x.oc, ''), o.oc), coalesce(nullif(x.procedencia, ''), o.procedencia),
             c, to_jsonb(o)->>c, to_jsonb(x)->>c
        from nuevo x join kardex_vale o on o.empresa_ruc = p_empresa_ruc and o.id = x.id
       cross join unnest(array['movimiento', 'operacion', 'tipo_documento', 'numero_documento', 'numero_orden', 'fecha_operacion',
                               'items', 'cantidad', 'documento_ruta']) c
       where coalesce(to_jsonb(o)->>c, '') is distinct from coalesce(to_jsonb(x)->>c, '');
      get diagnostics n = row_count; cambios := cambios + n;
      -- Un ingreso nuevo de una OC.
      insert into fuente_cambio (empresa_ruc, fuente, clave, oc, procedencia, campo, antes, despues)
      select p_empresa_ruc, 'ALMACEN', x.id, x.oc, x.procedencia, 'NUEVO', null,
             'Vale ' || x.vale || ' · ' || coalesce(nullif(x.tipo_documento, ''), 'documento') || ' ' || coalesce(x.numero_documento, '')
        from nuevo x
       where nullif(x.oc, '') is not null and not exists (select 1 from kardex_vale o where o.empresa_ruc = p_empresa_ruc and o.id = x.id);
      get diagnostics n = row_count; cambios := cambios + n;
      if borrar then
        insert into fuente_cambio (empresa_ruc, fuente, clave, oc, procedencia, campo, antes, despues)
        select p_empresa_ruc, 'ALMACEN', o.id, o.oc, o.procedencia, 'ELIMINADO',
               'Vale ' || o.vale || ' · ' || coalesce(nullif(o.tipo_documento, ''), 'documento') || ' ' || coalesce(o.numero_documento, ''), null
          from kardex_vale o
         where o.empresa_ruc = p_empresa_ruc and not exists (select 1 from nuevo x where x.id = o.id);
        get diagnostics n = row_count; cambios := cambios + n;
      end if;
    end if;
    if borrar then
      delete from kardex_vale o where o.empresa_ruc = p_empresa_ruc and not exists (select 1 from nuevo x where x.id = o.id);
    end if;
    insert into kardex_vale (empresa_ruc, id, vale, fecha_registro, fecha_operacion, movimiento, operacion, proveedor,
           tipo_documento, numero_documento, tipo_orden, numero_orden, oc, procedencia, proyecto, sede, responsable,
           recepcionado, documento_ruta, documento_url, vale_url, items, cantidad, cargado_en)
    select p_empresa_ruc, x.id, x.vale, x.fecha_registro, x.fecha_operacion, x.movimiento, x.operacion, x.proveedor,
           x.tipo_documento, x.numero_documento, x.tipo_orden, x.numero_orden, nullif(x.oc, ''), nullif(x.procedencia, ''),
           x.proyecto, x.sede, x.responsable, x.recepcionado, x.documento_ruta, x.documento_url, x.vale_url, x.items,
           x.cantidad, now()
      from nuevo x
    on conflict (empresa_ruc, id) do update set
      vale = excluded.vale, fecha_registro = excluded.fecha_registro, fecha_operacion = excluded.fecha_operacion,
      movimiento = excluded.movimiento, operacion = excluded.operacion, proveedor = excluded.proveedor,
      tipo_documento = excluded.tipo_documento, numero_documento = excluded.numero_documento,
      tipo_orden = excluded.tipo_orden, numero_orden = excluded.numero_orden, oc = excluded.oc,
      procedencia = excluded.procedencia, proyecto = excluded.proyecto, sede = excluded.sede,
      responsable = excluded.responsable, recepcionado = excluded.recepcionado, documento_ruta = excluded.documento_ruta,
      -- Un enlace que ya se halló no se pierde si esta copia no lo trae.
      documento_url = coalesce(nullif(excluded.documento_url, ''), kardex_vale.documento_url),
      vale_url = coalesce(nullif(excluded.vale_url, ''), kardex_vale.vale_url),
      items = excluded.items, cantidad = excluded.cantidad, cargado_en = excluded.cargado_en;
    get diagnostics n = row_count;

  elsif p_fuente = 'COPIA' then
    borrar := true;
    antes := 0;
    insert into fuente_copia (empresa_ruc, pestana, origen, filas, inicio, fin, resultado, leido_en)
    select p_empresa_ruc, x->>'pestana', x->>'origen', nullif(x->>'filas', '')::numeric::integer, x->>'inicio', x->>'fin',
           x->>'resultado', now()
      from jsonb_array_elements(coalesce(p_filas, '[]')) x
     where nullif(x->>'pestana', '') is not null
    on conflict (empresa_ruc, pestana) do update set
      origen = excluded.origen, filas = excluded.filas, inicio = excluded.inicio, fin = excluded.fin,
      resultado = excluded.resultado, leido_en = excluded.leido_en;
    get diagnostics n = row_count;
  else
    raise exception 'Fuente desconocida: %', p_fuente;
  end if;

  return jsonb_build_object('filas', n, 'antes', antes, 'cambios', cambios, 'borro', borrar);
end;
$$;

revoke execute on function cargar_fuentes_compras(text, text, jsonb) from public, anon;
grant execute on function cargar_fuentes_compras(text, text, jsonb) to authenticated;

-- ── Lo que ya existe en otro lado: por OC y por documento ──
--
-- Una fila por documento que la fuente demuestra que existe:
--   GUIA    Almacén registró el ingreso por compra (o por orden de servicio)
--           con la guía del proveedor, o con su factura si llegó sin guía.
--   DAM     COMEX anotó la DAM en el STATUS o la DUA en DUAS-SUNAT.
--   COSTEO  COMEX marcó la OC como COSTEADO.
-- (La factura que ya está en SUNAT la pone carpetas_madre_fuentes: la sabe por
-- el cruce factura ↔ OC.)

create or replace function evidencias_de_fuentes(p_empresa_ruc text default '20512201611')
returns table (procedencia text, oc text, doc text, evidencia text, enlace text, fecha date)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with permiso as (select seguridad.puede_ver_todo() ok)
  select v.procedencia, v.oc, 'GUIA'::text,
         'Almacén: ' || string_agg(
           case when v.tipo_documento like 'FACTURA%' then 'ingresó con factura ' else 'guía ' end ||
           coalesce(nullif(v.numero_documento, ''), 's/n') || ' (vale ' || v.vale || ', ' ||
           coalesce(to_char(coalesce(v.fecha_operacion, v.fecha_registro), 'DD/MM/YYYY'), 's/f') || ')',
           '; ' order by v.fecha_operacion, v.vale),
         (array_agg(nullif(v.documento_url, '') order by v.fecha_operacion desc) filter (where nullif(v.documento_url, '') is not null))[1],
         min(coalesce(v.fecha_operacion, v.fecha_registro))
    from kardex_vale v, permiso
   where permiso.ok and v.empresa_ruc = p_empresa_ruc and v.oc is not null
     and v.movimiento = 'INGRESO' and v.operacion ~ '(COMPRA|ORDEN DE SERVICIO)'
   group by v.procedencia, v.oc
  union all
  select 'Importación', x.oc, 'DAM',
         'COMEX: ' || concat_ws(' · ', nullif('DAM ' || nullif(x.dam, ''), ''),
           (select 'DUA ' || string_agg(d->>'dua', ' / ') from jsonb_array_elements(x.duas) d)),
         null, (select min((d->>'fecha')::date) from jsonb_array_elements(x.duas) d where nullif(d->>'fecha', '') is not null)
    from fuente_comex_oc x, permiso
   where permiso.ok and x.empresa_ruc = p_empresa_ruc and (nullif(x.dam, '') is not null or jsonb_array_length(x.duas) > 0)
  union all
  select 'Importación', x.oc, 'COSTEO', 'COMEX: ' || x.costeo, null, null
    from fuente_comex_oc x, permiso
   where permiso.ok and x.empresa_ruc = p_empresa_ruc and x.costeo ~* 'COSTEAD';
$$;

revoke execute on function evidencias_de_fuentes(text) from public, anon;
grant execute on function evidencias_de_fuentes(text) to authenticated;

-- ── Las carpetas madre con sus fuentes ──

create or replace function carpetas_madre_fuentes(p_empresa_ruc text default '20512201611')
returns table (
  procedencia text, area_responsable text, comprador text, comprador_segun text, situacion_pago text, forma_pago text,
  oc text, tipo text, proveedor text, proveedor_ruc text, proyecto_carpeta text, carpeta_nombre text,
  carpeta_url text, estado text, estado_detalle text, le_falta text, por_subir text, falta_sin_rastro text,
  documentos text, archivos integer, comprobantes integer,
  series text, cc_codigo text, cc_nombre text, centro_costo_segun text, en_cg boolean,
  facturas_sunat text, facturas_sunat_n integer, ultimo_cambio text, ultimo_cambio_fecha timestamptz,
  misma_oc_en_otra_carpeta text, cargado_en timestamptz,
  fecha_oc date, moneda text, monto numeric, monto_soles numeric, solicitado text, requerimiento text,
  ingreso_almacen date, estado_comex text, llegada_planta text, cambios_fuentes integer
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with c as materialized (select * from carpetas_madre(p_empresa_ruc)),
  e as materialized (select * from evidencias_de_fuentes(p_empresa_ruc)),
  f as (select * from fuente_compra_oc f where f.empresa_ruc = p_empresa_ruc and (select seguridad.puede_ver_todo())),
  x as (select * from fuente_comex_oc x where x.empresa_ruc = p_empresa_ruc and (select seguridad.puede_ver_todo())),
  cam as (
    select k.oc, k.procedencia, count(*)::integer n from fuente_cambio k
     where k.empresa_ruc = p_empresa_ruc and k.fecha > now() - interval '30 days' and (select seguridad.puede_ver_todo())
     group by 1, 2
  ),
  -- Cada documento que le falta a la carpeta, con su evidencia si la hay.
  falta as (
    select c.procedencia, c.oc, c.carpeta_url, d.nombre, d.orden,
           case d.nombre
             when 'Guía de remisión' then (select e.evidencia from e where e.procedencia = c.procedencia and e.oc = c.oc and e.doc = 'GUIA')
             when 'DAM' then (select e.evidencia from e where e.procedencia = c.procedencia and e.oc = c.oc and e.doc = 'DAM')
             when 'Cuadro de costeo' then (select e.evidencia from e where e.procedencia = c.procedencia and e.oc = c.oc and e.doc = 'COSTEO')
             when 'Factura' then case when c.facturas_sunat_n > 0 then 'SUNAT: ' || c.facturas_sunat end
           end evidencia
      from c, unnest(string_to_array(nullif(c.le_falta, ''), ', ')) with ordinality d(nombre, orden)
  ),
  resumen as (
    select falta.carpeta_url, falta.oc,
           string_agg(falta.nombre || ' (' || falta.evidencia || ')', ' | ' order by falta.orden) filter (where falta.evidencia is not null) por_subir,
           string_agg(falta.nombre, ', ' order by falta.orden) filter (where falta.evidencia is null) sin_rastro
      from falta group by 1, 2
  )
  select c.procedencia, c.area_responsable,
         coalesce(nullif(c.comprador, ''), nullif(x.comprador, ''), nullif(f.elaborado, ''), ''),
         case when nullif(c.comprador, '') is not null then 'Legajo por OC'
              when nullif(x.comprador, '') is not null then 'STATUS de COMEX'
              when nullif(f.elaborado, '') is not null then 'Base de Compras' else '' end,
         c.situacion_pago,
         coalesce(nullif(c.forma_pago, ''), nullif(concat_ws(' · ', nullif(f.forma_pago, ''), nullif(f.condicion_pago, '')), ''), ''),
         c.oc, c.tipo, c.proveedor, coalesce(nullif(f.proveedor_ruc, ''), ''), c.proyecto_carpeta, c.carpeta_nombre,
         c.carpeta_url, c.estado,
         case when c.estado = 'OK' then 'Completo'
              when c.estado = 'VACÍA' then 'Carpeta vacía'
              when r.sin_rastro is null and r.por_subir is not null then 'Por subir'
              when r.por_subir is not null then 'Falta y por subir'
              else 'Falta' end,
         c.le_falta, coalesce(r.por_subir, ''), coalesce(r.sin_rastro, ''),
         c.documentos, c.archivos, c.comprobantes, c.series, c.cc_codigo, c.cc_nombre, c.centro_costo_segun, c.en_cg,
         c.facturas_sunat, c.facturas_sunat_n, c.ultimo_cambio, c.ultimo_cambio_fecha, c.misma_oc_en_otra_carpeta, c.cargado_en,
         coalesce(f.fecha, x.fecha_oc), nullif(f.moneda, ''), f.total, f.total_soles, nullif(f.solicitado, ''), nullif(f.requerimiento, ''),
         (select e.fecha from e where e.procedencia = c.procedencia and e.oc = c.oc and e.doc = 'GUIA'),
         nullif(x.estado_compra, ''), nullif(x.fecha_real_planta, ''),
         coalesce(cam.n, 0)
    from c
    left join f on f.procedencia = c.procedencia and f.oc = c.oc
    left join x on c.procedencia = 'Importación' and x.oc = c.oc
    left join resumen r on r.carpeta_url = c.carpeta_url and r.oc = c.oc
    left join cam on cam.procedencia = c.procedencia and cam.oc = c.oc
   order by c.procedencia desc, split_part(c.oc, '-', 2), c.oc, c.carpeta_url;
$$;

revoke execute on function carpetas_madre_fuentes(text) from public, anon;
grant execute on function carpetas_madre_fuentes(text) to authenticated;

-- ── El detalle de una carpeta, con sus fuentes ──
-- Como en 055, más el bloque «fuentes».

create or replace function detalle_de_carpeta(p_carpeta text, p_empresa_ruc text default '20512201611')
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with k as (
    select * from oc_carpeta c
     where c.empresa_ruc = p_empresa_ruc and (select seguridad.puede_ver_todo())
       and (c.carpeta_url = p_carpeta or c.carpeta_url like '%/' || p_carpeta || '%')
     limit 1
  ),
  a as (
    select a.nombre, a.url, a.parece, coalesce(a.serie_leida, a.serie_en_nombre) serie, a.estado_lectura,
           documentos_de_archivo(a.parece, l.claves) docs
      from oc_archivo a
      join k on a.empresa_ruc = k.empresa_ruc and a.origen = 'CARPETA' and a.carpeta_url = k.carpeta_url
      left join lectura_archivo l on l.archivo_id = substring(a.url from '/d/([\w-]+)')
  ),
  fc as (
    select f.* from fuente_compra_oc f, k where f.empresa_ruc = k.empresa_ruc and f.procedencia = k.procedencia and f.oc = k.oc
  ),
  fx as (
    select x.* from fuente_comex_oc x, k where x.empresa_ruc = k.empresa_ruc and k.procedencia = 'Importación' and x.oc = k.oc
  ),
  ev as (
    select e.* from evidencias_de_fuentes(p_empresa_ruc) e, k where e.procedencia = k.procedencia and e.oc = k.oc
  ),
  l as (
    select l.* from oc_legajo l, k
     where l.empresa_ruc = k.empresa_ruc and l.oc = k.oc
     order by (l.carpeta_url = k.carpeta_url) desc, l.cargado_en desc limit 1
  )
  select case when not exists (select 1 from k) then null else jsonb_build_object(
    'carpeta', (select jsonb_build_object('oc', k.oc, 'tipo', k.tipo, 'procedencia', k.procedencia, 'proveedor', k.proveedor,
       'proyecto', trim(k.proyecto_carpeta), 'nombre', k.carpeta_nombre, 'url', k.carpeta_url, 'estado', k.estado,
       'le_falta', k.le_falta, 'documentos', k.documentos, 'cc_codigo', k.cc_codigo, 'cc_nombre', k.cc_nombre,
       'cc_segun', texto_cc_segun(k.cc_fuente, k.procedencia), 'series', k.series, 'leida', k.cargado_en) from k),
    'archivos', coalesce((select jsonb_agg(jsonb_build_object('nombre', a.nombre, 'url', a.url, 'parece', a.parece,
       'serie', a.serie, 'docs', to_jsonb(a.docs)) order by a.nombre) from a), '[]'::jsonb),
    'legajo', (select jsonb_build_object('comprador', l.comprador, 'area', l.area, 'situacion_pago', l.situacion_pago,
       'estatus', l.estatus, 'estado_aprobacion', l.estado_aprobacion, 'fecha_oc', l.fecha_oc, 'monto_soles', l.monto_soles,
       'forma_pago', l.forma_pago, 'proveedor_ruc', l.proveedor_ruc, 'unidad', l.unidad, 'proyecto', l.proyecto) from l),
    'facturas', coalesce((select jsonb_agg(distinct jsonb_build_object('comprobante', v.serie || '-' || v.numero, 'ruc', v.proveedor_ruc,
       'tipo', v.tipo_comprobante, 'fuente', v.fuente, 'archivo', v.archivo, 'archivo_url', v.archivo_url))
       from vinculos_oc(p_empresa_ruc) v, k
      where v.oc = k.oc and (v.carpeta_url = k.carpeta_url
            or (select count(*) from oc_carpeta o where o.empresa_ruc = k.empresa_ruc and o.oc = k.oc) = 1)), '[]'::jsonb),
    'cambios', coalesce((select jsonb_agg(jsonb_build_object('fecha', x.fecha, 'tipo', x.tipo, 'detalle', x.detalle) order by x.fecha desc)
       from (select x.* from carpeta_cambio x, k where x.empresa_ruc = k.empresa_ruc and x.carpeta_url = k.carpeta_url
              order by x.fecha desc, x.id desc limit 20) x), '[]'::jsonb),
    'otras', coalesce((select jsonb_agg(jsonb_build_object('nombre', o.carpeta_nombre, 'proyecto', trim(o.proyecto_carpeta), 'url', o.carpeta_url))
       from oc_carpeta o, k where o.empresa_ruc = k.empresa_ruc and o.oc = k.oc and o.carpeta_url <> k.carpeta_url), '[]'::jsonb),
    -- Lo que dicen Compras, COMEX y Almacén de esta OC (la hoja privada de Contabilidad).
    'fuentes', jsonb_build_object(
      'compras', (select to_jsonb(fc) - 'empresa_ruc' from fc),
      'comex', (select to_jsonb(fx) - 'empresa_ruc' from fx),
      'almacen', coalesce((select jsonb_agg(jsonb_build_object('vale', v.vale, 'fecha', coalesce(v.fecha_operacion, v.fecha_registro),
         'registrado', v.fecha_registro, 'movimiento', v.movimiento, 'operacion', v.operacion, 'tipo_documento', v.tipo_documento,
         'numero_documento', v.numero_documento, 'proveedor', v.proveedor, 'items', v.items, 'cantidad', v.cantidad,
         'recepcionado', v.recepcionado, 'responsable', v.responsable, 'documento_url', nullif(v.documento_url, ''),
         'tiene_escaneo', nullif(v.documento_ruta, '') is not null) order by coalesce(v.fecha_operacion, v.fecha_registro), v.vale)
         from kardex_vale v, k where v.empresa_ruc = k.empresa_ruc and v.procedencia = k.procedencia and v.oc = k.oc), '[]'::jsonb),
      'por_subir', coalesce((select jsonb_agg(jsonb_build_object('doc', ev.doc, 'evidencia', ev.evidencia, 'enlace', ev.enlace)) from ev), '[]'::jsonb),
      'cambios', coalesce((select jsonb_agg(jsonb_build_object('fecha', y.fecha, 'fuente', y.fuente, 'campo', y.campo, 'antes', y.antes,
         'despues', y.despues) order by y.fecha desc)
         from (select y.* from fuente_cambio y, k where y.empresa_ruc = k.empresa_ruc and y.oc = k.oc
                 and (y.procedencia is null or y.procedencia = k.procedencia) order by y.fecha desc, y.id desc limit 30) y), '[]'::jsonb),
      'copia', (select max(c.leido_en) from fuente_copia c where c.empresa_ruc = p_empresa_ruc)
    )
  ) end;
$$;

revoke execute on function detalle_de_carpeta(text, text) from public, anon;
grant execute on function detalle_de_carpeta(text, text) to authenticated;
