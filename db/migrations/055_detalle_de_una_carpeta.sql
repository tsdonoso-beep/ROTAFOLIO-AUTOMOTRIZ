-- El detalle de una carpeta de OC, para la vista ejecutiva
--
-- Lo que mostraba el tablero del legajo por OC (TableroLegajo.html) al abrir
-- una OC, pero de la carpeta madre: los 11 documentos con el enlace a CADA
-- archivo (por su nombre o por lo leído por dentro), los datos de la OC del
-- legajo por OC (comprador, fecha, monto, pago), las facturas de SUNAT
-- unidas, lo que cambió y las otras carpetas con el mismo número. La vista
-- lo pide al abrir una fila (Legajo por OC → clic).
--
-- p_carpeta: el enlace de la carpeta o solo su ID de Drive.

create or replace function documentos_de_archivo(p_parece text, p_claves_leidas text)
returns text[]
language sql
immutable
set search_path = pg_temp
as $$
  select array(select distinct c from (
    select case
      when p ~ '^(FACTURA|COMPROBANTE|RECIBO POR|BOLETA|NOTA DE|XML$|INVOICE)' then 'FACTURA'
      when p = 'ORDEN DE COMPRA/SERVICIO' then 'OC'
      when p = 'SWIFT' then 'SWIFT'
      when p = 'GUÍA' then 'GUIA'
      when p in ('DAM', 'DOCUMENTO DE IMPORTACIÓN') then 'DAM'
      when p = 'REQUERIMIENTO' then 'REQ'
      when p = 'CONTRATO' then 'CONTRATO'
      when p = 'COTIZACIÓN' then 'COTIZACION'
      when p = 'PROFORMA' then 'PROFORMA'
      when p = 'CORREO / CAPTURA' then 'CORREO'
      when p = 'ACTA DE CONFORMIDAD' then 'ACTA'
    end c
    from (select regexp_replace(coalesce(p_parece, ''), ' \(por la carpeta\)$', '') p) x
    union all
    select trim(l) from unnest(string_to_array(coalesce(p_claves_leidas, ''), ',')) l
     where trim(l) in ('FACTURA', 'OC', 'SWIFT', 'GUIA', 'DAM', 'REQ', 'CONTRATO', 'COTIZACION', 'PROFORMA', 'CORREO', 'ACTA')
  ) y where c is not null);
$$;

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
       from oc_carpeta o, k where o.empresa_ruc = k.empresa_ruc and o.oc = k.oc and o.carpeta_url <> k.carpeta_url), '[]'::jsonb)
  ) end;
$$;

revoke execute on function detalle_de_carpeta(text, text) from public, anon;
grant execute on function detalle_de_carpeta(text, text) to authenticated;
