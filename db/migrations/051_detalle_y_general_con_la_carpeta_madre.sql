-- El DETALLE y la hoja GENERAL con lo que se sabe de la carpeta madre
--
-- 1. detalle_cpe_carpeta(): el mismo detalle de ítems de detalle_cpe(), con
--    tres columnas más al final, sacadas de la carpeta de la OC (oc_carpeta):
--    el proyecto, de dónde salió el centro de costo y qué documentos tiene.
--    Es una función nueva (y no un cambio a detalle_cpe) porque agregar
--    columnas a una función obliga a borrarla y recrearla, y la publicación
--    de cada mañana la está usando.
-- 2. legajo_de_carpetas(): una fila por carpeta de OC de las dos carpetas
--    madre, con su legajo, centro de costo, las facturas de SUNAT ya unidas y
--    el último cambio. La trae docs/appscript/CarpetaMadre.gs a la hoja
--    GENERAL (pestaña CARPETA MADRE).

create or replace function texto_cc_segun(p_fuente text, p_procedencia text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case p_fuente
    when 'CG' then 'Control de Gestión'
    when 'CUADRO' then 'Cuadro de aprobaciones'
    when 'PROYECTO' then case when p_procedencia = 'Importación'
                              then 'Su carpeta de proyecto (las demás OC, según el cuadro)'
                              else 'Su carpeta de proyecto (las demás OC, según CG)' end
    when 'NOMBRE' then 'Nombre de la carpeta del proyecto'
    when 'ADMINISTRATIVO' then 'Carpeta administrativa (área general)'
    when 'MANUAL' then 'Corregido a mano'
    when 'SIN ASIGNAR' then 'Sin asignar'
  end;
$$;

create or replace function detalle_cpe_carpeta(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text, serie text,
  numero text, fecha_emision date, moneda text, linea integer, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric, enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text, detraccion_porcentaje numeric, detraccion_monto numeric,
  detraccion_cuenta_banco text, detraccion_codigo_bien_servicio text, anticipo_aplicado numeric,
  documento_relacionado text, tipo_documento_relacionado text, oc_carpeta text, centro_costo_cg text,
  codigo_concar text, archivo_oc text, archivo_oc_url text, situacion_pago_oc text, comprador_oc text,
  area_oc text, legajo_oc text, carpeta_oc_url text,
  proyecto_oc text, centro_costo_segun text, documentos_oc text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (
    select * from detalle_cpe(p_periodo)
  ),
  carpetas as (
    select k.oc, k.carpeta_url, k.proyecto_carpeta, k.cc_fuente, k.documentos, k.procedencia,
           count(*) over (partition by k.oc) n
      from oc_carpeta k
     where k.empresa_ruc = '20512201611' and (select seguridad.puede_ver_todo())
  ),
  -- Cada combinación de OC y carpeta del detalle, una sola vez. Un
  -- comprobante puede ir a varias OC («0200-2026 / 0201-2026»); su carpeta es
  -- la del enlace o, si el enlace es otro (de CG o del cuadro), la única
  -- carpeta madre con ese número.
  claves as (
    select distinct d.oc_carpeta, d.carpeta_oc_url from d where d.oc_carpeta is not null
  ),
  info as (
    select x.oc_carpeta, x.carpeta_oc_url,
           string_agg(distinct c.proyecto_carpeta, ' / ') proyecto,
           string_agg(distinct texto_cc_segun(c.cc_fuente, c.procedencia), ' / ') segun,
           string_agg(distinct nullif(c.documentos, ''), ' / ') documentos
      from claves x
      join carpetas c
        on c.oc = any(string_to_array(x.oc_carpeta, ' / '))
       and (c.n = 1 or c.carpeta_url = any(string_to_array(coalesce(x.carpeta_oc_url, ''), ' / ')))
     group by 1, 2
  )
  select d.*,
         i.proyecto,
         case when d.centro_costo_cg is null then null else coalesce(i.segun, 'Control de Gestión') end,
         i.documentos
    from d
    left join info i
      on i.oc_carpeta = d.oc_carpeta and i.carpeta_oc_url is not distinct from d.carpeta_oc_url
   order by d.fecha_emision, d.serie, d.numero, d.linea;
$$;

revoke execute on function detalle_cpe_carpeta(text) from public, anon;
grant execute on function detalle_cpe_carpeta(text) to authenticated;

create or replace function legajo_de_carpetas(p_empresa_ruc text default '20512201611')
returns table (
  procedencia text, oc text, tipo text, proveedor text, proyecto_carpeta text, carpeta_nombre text,
  carpeta_url text, estado text, le_falta text, documentos text, archivos integer, comprobantes integer,
  series text, cc_codigo text, cc_nombre text, centro_costo_segun text, en_cg boolean,
  facturas_sunat text, facturas_sunat_n integer, ultimo_cambio text, ultimo_cambio_fecha timestamptz,
  misma_oc_en_otra_carpeta text, cargado_en timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with v as materialized (
    select v.oc, v.carpeta_url, v.serie || '-' || v.numero || ' (' || v.proveedor_ruc || ')' cpe
      from vinculos_oc(p_empresa_ruc) v
  ),
  k as (
    select k.*, count(*) over (partition by k.oc) n
      from oc_carpeta k
     where k.empresa_ruc = p_empresa_ruc and (select seguridad.puede_ver_todo())
  )
  select k.procedencia, k.oc, k.tipo, k.proveedor, k.proyecto_carpeta, k.carpeta_nombre, k.carpeta_url,
         k.estado, coalesce(k.le_falta, ''), k.documentos, k.archivos, k.comprobantes, k.series,
         k.cc_codigo, k.cc_nombre, texto_cc_segun(k.cc_fuente, k.procedencia),
         exists (select 1 from oc_base_cg b where b.empresa_ruc = p_empresa_ruc and b.oc = k.oc),
         f.lista, coalesce(f.n, 0), c.texto, c.fecha,
         (select string_agg(o.proyecto_carpeta || ' / ' || o.carpeta_nombre, ' | ')
            from oc_carpeta o where o.empresa_ruc = p_empresa_ruc and o.oc = k.oc and o.carpeta_url <> k.carpeta_url),
         k.cargado_en
    from k
    left join lateral (
      select string_agg(distinct v.cpe, ' / ') lista, count(distinct v.cpe)::integer n
        from v where v.oc = k.oc and (v.carpeta_url = k.carpeta_url or k.n = 1)
    ) f on true
    left join lateral (
      select x.tipo || coalesce(': ' || x.detalle, '') texto, x.fecha
        from carpeta_cambio x
       where x.empresa_ruc = p_empresa_ruc and x.oc = k.oc and x.carpeta_url = k.carpeta_url
       order by x.fecha desc, x.id desc limit 1
    ) c on true
   order by k.procedencia desc, split_part(k.oc, '-', 2), k.oc, k.carpeta_url;
$$;

revoke execute on function legajo_de_carpetas(text) from public, anon;
grant execute on function legajo_de_carpetas(text) to authenticated;
