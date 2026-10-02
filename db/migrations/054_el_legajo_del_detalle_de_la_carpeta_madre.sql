-- El legajo del DETALLE, de la carpeta madre
--
-- Hasta acá la columna «Legajo de la OC» venía primero del legajo por OC de
-- la hoja GENERAL (LegajoPorOC.gs: revisa cada 7 días y pide también la
-- cotización) y la carpeta madre solo llenaba lo que aquel no tenía. Ahora
-- manda la carpeta madre, que el robot lee dos veces al día: «Completo»,
-- «Falta: Guía de remisión», «Carpeta vacía». El de GENERAL queda para las OC
-- que la carpeta madre no tiene. Misma firma: no cambia la hoja.

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
           case k.estado when 'OK' then 'Completo' when 'VACÍA' then 'Carpeta vacía'
                else 'Falta: ' || coalesce(nullif(k.le_falta, ''), '—') end legajo,
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
           string_agg(distinct nullif(c.documentos, ''), ' / ') documentos,
           string_agg(distinct c.legajo, ' / ') legajo
      from claves x
      join carpetas c
        on c.oc = any(string_to_array(x.oc_carpeta, ' / '))
       and (c.n = 1 or c.carpeta_url = any(string_to_array(coalesce(x.carpeta_oc_url, ''), ' / ')))
     group by 1, 2
  )
  -- El legajo, de la carpeta madre (la lee el robot dos veces al día); el del
  -- legajo por OC de GENERAL solo si la carpeta madre no tiene esa OC.
  select d.periodo,
         d.origen,
         d.proveedor_ruc,
         d.proveedor_nombre,
         d.tipo_comprobante,
         d.serie,
         d.numero,
         d.fecha_emision,
         d.moneda,
         d.linea,
         d.descripcion,
         d.cantidad,
         d.unidad,
         d.precio_unitario,
         d.importe,
         d.total_comprobante,
         d.enlace_xml,
         d.enlace_pdf,
         d.forma_pago,
         d.guia_remision,
         d.orden_compra,
         d.detraccion_porcentaje,
         d.detraccion_monto,
         d.detraccion_cuenta_banco,
         d.detraccion_codigo_bien_servicio,
         d.anticipo_aplicado,
         d.documento_relacionado,
         d.tipo_documento_relacionado,
         d.oc_carpeta,
         d.centro_costo_cg,
         d.codigo_concar,
         d.archivo_oc,
         d.archivo_oc_url,
         d.situacion_pago_oc,
         d.comprador_oc,
         d.area_oc,
         coalesce(i.legajo, d.legajo_oc),
         d.carpeta_oc_url,
         i.proyecto,
         case when d.centro_costo_cg is null then null else coalesce(i.segun, 'Control de Gestión') end,
         i.documentos
    from d
    left join info i
      on i.oc_carpeta = d.oc_carpeta and i.carpeta_oc_url is not distinct from d.carpeta_oc_url
   order by d.fecha_emision, d.serie, d.numero, d.linea;
$$;
