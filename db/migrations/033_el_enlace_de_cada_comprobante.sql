-- El enlace de cada comprobante, en la hoja del detalle
--
-- `cpe_comprobante.xml_drive_url` ya existía, pero nadie lo llenaba ni lo
-- devolvía: era la «fase 2» que quedó pendiente. Ahora el scraper archiva
-- cada XML en una carpeta ordenada de Drive y guarda ese enlace; falta que
-- `guardar_cpe` lo acepte y que `detalle_cpe` lo entregue, para que la hoja de
-- Contabilidad tenga, junto a cada línea, el enlace al comprobante del que
-- salió.

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
        -- Solo se pisa si el lote trae uno nuevo: reimportar sin Drive (el
        -- ZIP a mano, sin `xmlDriveUrl`) no debe borrar el enlace que ya
        -- había quedado de una corrida del scraper.
        xml_drive_url      = coalesce(nullif(d->>'xmlDriveUrl', ''), xml_drive_url),
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
        fecha_emision, moneda, subtotal, igv, total, periodo, xml_drive_url
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', ''), nullif(d->>'xmlDriveUrl', '')
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

-- El detalle entero, ahora con el enlace al XML archivado en Drive. El tipo
-- de retorno cambia (una columna más), así que hay que soltar la función
-- antes de recrearla: `create or replace` no permite eso.
drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace text
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
    c.total, c.xml_drive_url
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from anon;
grant  execute on function detalle_cpe(text) to authenticated;
