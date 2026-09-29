-- El archivo que confirmó el vínculo con la OC, en las dos hojas
--
-- vinculos_oc() ya trae `archivo` (el nombre) y `archivo_url` (el enlace de
-- Drive) del archivo que hizo match con el comprobante —es la evidencia de
-- POR QUÉ se unió con esa OC—, pero ni historico_comprobantes_sunat() ni
-- detalle_cpe() los pasaban a la hoja: se quedaban en el camino. Sin eso,
-- revisar una alerta («RUC mal escrito», «factura mayor que la OC») obliga a
-- ir a buscar a mano en la hoja de captura de OC cuál archivo fue.
--
-- De paso, sirve como seguimiento REFERENCIAL de qué OC no tienen nada
-- subido a Drive todavía: si estas dos columnas salen vacías para un
-- comprobante que sí tiene «OC (carpeta)» en blanco, es porque no hay ningún
-- archivo en Drive que la captura haya podido cruzar con él —no reemplaza
-- una auditoría real de la carpeta, pero avisa dónde mirar—.

drop function if exists detalle_cpe(text);

create or replace function historico_comprobantes_sunat(p_periodo text default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with cambios as (
    select comprobante_id, count(*) n
    from cambios_comprobante_sunat
    group by comprobante_id
  ),
  vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.alertas, '; ') alertas,
           string_agg(distinct v.archivo, ' / ') archivo,
           string_agg(distinct v.archivo_url, ' / ') archivo_url
      from vinculos_oc() v
     group by 1, 2, 3, 4
  )
  select coalesce(jsonb_agg(fila order by fila->>'fechaEmision', fila->>'numero'), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'periodo',          c.periodo,
      'proveedorRuc',     c.proveedor_ruc,
      'proveedorNombre',  c.proveedor_nombre,
      'tipoComprobante',  c.tipo_comprobante,
      'serie',            c.serie,
      'numero',           c.numero,
      'fechaEmision',     c.fecha_emision,
      'total',            c.total,
      'moneda',           c.moneda,
      'estado',           c.estado,
      'tipoNota',         c.tipo_nota,
      'modificaTipo',     c.modifica_tipo,
      'modificaSerie',    c.modifica_serie,
      'modificaNumero',   c.modifica_numero,
      'carSunat',         c.car_sunat,
      'primeraVez',       c.primera_vez,
      'ultimaVez',        c.ultima_vez,
      'cambios',          coalesce(x.n, 0),
      -- La suma de los tres destinos. El desglose queda en la tabla por si
      -- Contabilidad lo pide: separarlo despues seria cambiar una columna, no
      -- volver a consultar nueve meses.
      'base',             nullif(coalesce(c.base_dg,0) + coalesce(c.base_dgng,0) + coalesce(c.base_dng,0), 0),
      'igv',              nullif(coalesce(c.igv_dg,0) + coalesce(c.igv_dgng,0) + coalesce(c.igv_dng,0), 0),
      'detraccion',       c.detraccion,
      'tipoCambio',       c.tipo_cambio,
      'ocCarpeta',        v.oc,
      'centroCostoCg',    v.cc,
      'codigoConcar',     v.concar,
      'alertasOc',        v.alertas,
      'archivoOc',        v.archivo,
      'archivoOcUrl',     v.archivo_url
    ) as fila
    from comprobantes_sunat c
    left join cambios x on x.comprobante_id = c.id
    left join vinc v
           on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
          and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
    where p_periodo is null or c.periodo = p_periodo
  ) t;
$$;

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text,
  serie text, numero text, fecha_emision date, moneda text, linea integer, descripcion text,
  cantidad numeric, unidad text, precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text, forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text,
  detraccion_codigo_bien_servicio text, anticipo_aplicado numeric, documento_relacionado text,
  tipo_documento_relacionado text,
  oc_carpeta text, centro_costo_cg text, codigo_concar text,
  archivo_oc text, archivo_oc_url text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  with vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.archivo, ' / ') archivo,
           string_agg(distinct v.archivo_url, ' / ') archivo_url
      from vinculos_oc() v
     group by 1, 2, 3, 4
  )
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto,
    c.detraccion_cuenta_banco, c.detraccion_codigo_bien_servicio,
    c.anticipo_aplicado, c.documento_relacionado, c.tipo_documento_relacionado,
    v.oc, v.cc, v.concar,
    v.archivo, v.archivo_url
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  left join vinc v
         on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
        and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from public, anon;
grant execute on function detalle_cpe(text) to authenticated, service_role;
