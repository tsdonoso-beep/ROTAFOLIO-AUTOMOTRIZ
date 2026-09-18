-- Corrige la cuenta de detracción y agrega anticipo/documento relacionado
--
-- Un XML real (factura de INROPRIN con detracción y un anticipo aplicado)
-- mostró dos cosas que la migración anterior tenía mal:
--
-- 1. `detraccion_cuenta_banco` se llenaba con el código del bien/servicio
--    sujeto a detracción (catálogo 54 de SUNAT, ej. "037"), no con una
--    cuenta. La cuenta de verdad —la del Banco de la Nación— vive en un
--    bloque distinto del XML (`cac:PaymentMeans`, no `PaymentTerms`). Se
--    agrega una columna aparte para el código, y de ahora en más
--    `detraccion_cuenta_banco` sí trae la cuenta.
--
-- 2. El parser (`lib/sunat/cpe-xml.ts`) tenía un bug de verdad: la cuota de
--    un crédito comparte el mismo `cbc:ID` "FormaPago" que la cabecera, así
--    que la forma de pago quedaba pisada por el valor de la última cuota, y
--    las cuotas nunca se guardaban. Ya está corregido en el parser; esta
--    migración solo trae las columnas para lo que ahora sí se lee bien.
--
-- De paso se agrega el anticipo aplicado y el documento que un comprobante
-- referencia (típico en valorizaciones de obra: "esta factura descuenta el
-- anticipo de la factura E001-1714").

alter table cpe_comprobante
  add column if not exists detraccion_codigo_bien_servicio text,
  add column if not exists anticipo_aplicado                numeric(14,2),
  add column if not exists documento_relacionado             text,
  add column if not exists tipo_documento_relacionado        text;

comment on column cpe_comprobante.detraccion_cuenta_banco is
  'La cuenta del Banco de la Nación (cac:PaymentMeans), no un código. null si no hay detracción.';
comment on column cpe_comprobante.detraccion_codigo_bien_servicio is
  'El código del bien/servicio detraído, catálogo 54 de SUNAT (ej. "037").';

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
  cu              jsonb;
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
        origen                        = d->>'origen',
        proveedor_nombre              = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc               = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre            = nullif(d->>'adquirienteNombre', ''),
        fecha_emision                 = nullif(d->>'fechaEmision', '')::date,
        moneda                        = nullif(d->>'moneda', ''),
        subtotal                      = nullif(d->>'subtotal', '')::numeric,
        igv                           = nullif(d->>'igv', '')::numeric,
        total                         = nullif(d->>'total', '')::numeric,
        periodo                       = nullif(d->>'periodo', ''),
        xml_drive_url                 = coalesce(nullif(d->>'xmlDriveUrl', ''), xml_drive_url),
        pdf_drive_url                 = coalesce(nullif(d->>'pdfDriveUrl', ''), pdf_drive_url),
        forma_pago                    = nullif(d->>'formaPago', ''),
        detraccion_cuenta_banco       = nullif(d->>'detraccionCuentaBanco', ''),
        detraccion_codigo_bien_servicio = nullif(d->>'detraccionCodigoBienServicio', ''),
        detraccion_porcentaje         = nullif(d->>'detraccionPorcentaje', '')::numeric,
        detraccion_monto              = nullif(d->>'detraccionMonto', '')::numeric,
        guia_remision                 = nullif(d->>'guiaRemision', ''),
        orden_compra                  = nullif(d->>'ordenCompra', ''),
        anticipo_aplicado             = nullif(d->>'anticipoAplicado', '')::numeric,
        documento_relacionado         = nullif(d->>'documentoRelacionado', ''),
        tipo_documento_relacionado    = nullif(d->>'tipoDocumentoRelacionado', ''),
        actualizado_en                = now()
      where id = v_id;
      delete from cpe_item where comprobante_id = v_id;
      delete from cpe_cuota where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo,
        xml_drive_url, pdf_drive_url,
        forma_pago, detraccion_cuenta_banco, detraccion_codigo_bien_servicio,
        detraccion_porcentaje, detraccion_monto,
        guia_remision, orden_compra,
        anticipo_aplicado, documento_relacionado, tipo_documento_relacionado
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', ''),
        nullif(d->>'xmlDriveUrl', ''), nullif(d->>'pdfDriveUrl', ''),
        nullif(d->>'formaPago', ''), nullif(d->>'detraccionCuentaBanco', ''),
        nullif(d->>'detraccionCodigoBienServicio', ''),
        nullif(d->>'detraccionPorcentaje', '')::numeric, nullif(d->>'detraccionMonto', '')::numeric,
        nullif(d->>'guiaRemision', ''), nullif(d->>'ordenCompra', ''),
        nullif(d->>'anticipoAplicado', '')::numeric,
        nullif(d->>'documentoRelacionado', ''), nullif(d->>'tipoDocumentoRelacionado', '')
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

    for cu in select * from jsonb_array_elements(coalesce(d->'cuotas', '[]'::jsonb))
    loop
      insert into cpe_cuota (comprobante_id, numero, monto, fecha_vencimiento)
      values (
        v_id,
        (cu->>'numero')::int,
        nullif(cu->>'monto', '')::numeric,
        nullif(cu->>'fechaVencimiento', '')::date
      );
    end loop;
  end loop;

  nuevos := v_nuevos;
  actualizados := v_actualizados;
  items := v_items;
  return next;
end;
$$;

drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric,
  detraccion_cuenta_banco text, detraccion_codigo_bien_servicio text,
  anticipo_aplicado numeric, documento_relacionado text, tipo_documento_relacionado text
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
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto,
    c.detraccion_cuenta_banco, c.detraccion_codigo_bien_servicio,
    c.anticipo_aplicado, c.documento_relacionado, c.tipo_documento_relacionado
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from anon;
grant  execute on function detalle_cpe(text) to authenticated;
