-- Forma de pago, cuotas, detracción, guía y orden de compra
--
-- El XML trae más de lo que se estaba leyendo: la detracción (a qué cuenta,
-- qué porcentaje, cuánto), si el comprobante es al contado o al crédito —y
-- si es al crédito, sus cuotas—, y las referencias a la guía de remisión y
-- la orden de compra. Nada de esto lo trae el registro de compras (RCE):
-- vive solo en el XML, así que solo lo tenemos para lo que el scraper baja.

alter table cpe_comprobante
  add column if not exists forma_pago             text,
  add column if not exists detraccion_cuenta_banco text,
  add column if not exists detraccion_porcentaje   numeric(6,4),
  add column if not exists detraccion_monto        numeric(14,2),
  add column if not exists guia_remision           text,
  add column if not exists orden_compra            text;

comment on column cpe_comprobante.forma_pago is
  '"Contado" o "Credito", tal como lo declara el emisor.';
comment on column cpe_comprobante.detraccion_cuenta_banco is
  'null si el comprobante no está sujeto a detracción.';

-- Las cuotas, una por fila, igual que los ítems: un comprobante al contado
-- no tiene ninguna.
create table cpe_cuota (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references cpe_comprobante(id) on delete cascade,
  numero          int,
  monto           numeric(14,2),
  fecha_vencimiento date
);

create index cpe_cuota_del_comprobante_idx on cpe_cuota (comprobante_id, numero);

alter table cpe_cuota enable row level security;
create policy cpe_cuota_lectura on cpe_cuota for select using (
  seguridad.puede_ver_todo()
);
revoke all on cpe_cuota from anon;
revoke insert, update, delete, truncate, references, trigger on cpe_cuota from authenticated;

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
        origen                  = d->>'origen',
        proveedor_nombre        = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc         = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre      = nullif(d->>'adquirienteNombre', ''),
        fecha_emision           = nullif(d->>'fechaEmision', '')::date,
        moneda                  = nullif(d->>'moneda', ''),
        subtotal                = nullif(d->>'subtotal', '')::numeric,
        igv                     = nullif(d->>'igv', '')::numeric,
        total                   = nullif(d->>'total', '')::numeric,
        periodo                 = nullif(d->>'periodo', ''),
        xml_drive_url           = coalesce(nullif(d->>'xmlDriveUrl', ''), xml_drive_url),
        pdf_drive_url           = coalesce(nullif(d->>'pdfDriveUrl', ''), pdf_drive_url),
        forma_pago              = nullif(d->>'formaPago', ''),
        detraccion_cuenta_banco = nullif(d->>'detraccionCuentaBanco', ''),
        detraccion_porcentaje   = nullif(d->>'detraccionPorcentaje', '')::numeric,
        detraccion_monto        = nullif(d->>'detraccionMonto', '')::numeric,
        guia_remision           = nullif(d->>'guiaRemision', ''),
        orden_compra            = nullif(d->>'ordenCompra', ''),
        actualizado_en          = now()
      where id = v_id;
      -- Ítems y cuotas se reescriben enteros: es más simple y más correcto
      -- que adivinar cuáles cambiaron uno por uno.
      delete from cpe_item where comprobante_id = v_id;
      delete from cpe_cuota where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo,
        xml_drive_url, pdf_drive_url,
        forma_pago, detraccion_cuenta_banco, detraccion_porcentaje, detraccion_monto,
        guia_remision, orden_compra
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', ''),
        nullif(d->>'xmlDriveUrl', ''), nullif(d->>'pdfDriveUrl', ''),
        nullif(d->>'formaPago', ''), nullif(d->>'detraccionCuentaBanco', ''),
        nullif(d->>'detraccionPorcentaje', '')::numeric, nullif(d->>'detraccionMonto', '')::numeric,
        nullif(d->>'guiaRemision', ''), nullif(d->>'ordenCompra', '')
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

-- El detalle entero, con los datos de pago y detracción repetidos en cada
-- ítem —igual que ya se repiten proveedor, tipo, serie—: es una hoja plana,
-- una fila por ítem, y así es como la quiere.
drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text
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
    c.detraccion_porcentaje, c.detraccion_monto, c.detraccion_cuenta_banco
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from anon;
grant  execute on function detalle_cpe(text) to authenticated;
