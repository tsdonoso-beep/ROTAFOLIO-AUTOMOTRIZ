-- El DETALLE con el desglose del IGV, el total en soles y la detracción a revisar
--
-- Pedidos de Contabilidad en la reunión de resultados (octubre 2026):
--   1. Desglosar lo gravado de lo no gravado (inafecto / exonerado) para
--      cuadrar el IGV: base × 18% tiene que dar el IGV.
--   2. Ver todo en soles, con el tipo de cambio de cada comprobante.
--   3. Avisar cuando el % de detracción no es el que corresponde a su código
--      de bien o servicio (el caso del 12%).
--
-- detalle_cpe_hoja(): lo mismo que detalle_cpe_carpeta() (migración 051) más
-- siete columnas por comprobante (se repiten en cada ítem, como la cabecera):
--   base_gravada, igv_comprobante, no_gravado, desglose_segun
--       Del SIRE cuando el comprobante está ahí (las tres bases gravadas y su
--       IGV; lo no gravado es el resto del total: inafecto, exonerado, ISC,
--       ICBPER…). Si no está en el SIRE (las ventas, o una compra que todavía
--       no aparece), del XML: base = IGV / 18%, y el resto del valor de venta
--       es no gravado.
--   tipo_cambio, total_soles
--       El del SIRE; si no, el de otra compra en la misma moneda y la misma
--       fecha (SUNAT publica uno por día); si no, el último anterior.
--   detraccion_revisar
--       Vacío si está bien. Si no: qué % se aplicó y cuál lleva su código
--       según los anexos de la R.S. 183-2004/SUNAT (tabla abajo).
-- Es una función nueva porque cambiar las columnas de una función obliga a
-- borrarla, y la publicación de cada día usa la anterior.

-- El % de detracción de cada código de bien o servicio (anexos 1, 2 y 3 de la
-- R.S. 183-2004/SUNAT, con sus modificatorias). Contabilidad confirma.
create or replace function porcentaje_detraccion(p_codigo text, out porcentaje numeric, out nombre text)
language sql
immutable
set search_path = pg_temp
as $$
  select t.p, t.n from (values
    ('001', 10, 'Azúcar y melaza de caña'),
    ('003', 10, 'Alcohol etílico'),
    ('004', 4, 'Recursos hidrobiológicos'),
    ('005', 4, 'Maíz amarillo duro'),
    ('007', 10, 'Caña de azúcar'),
    ('008', 4, 'Madera'),
    ('009', 10, 'Arena y piedra'),
    ('010', 15, 'Residuos, subproductos, desechos, recortes'),
    ('011', 10, 'Bienes gravados con el IGV por renuncia a la exoneración'),
    ('012', 12, 'Intermediación laboral y tercerización'),
    ('014', 4, 'Carnes y despojos comestibles'),
    ('016', 10, 'Aceite de pescado'),
    ('017', 4, 'Harina, polvo y pellets de pescado'),
    ('019', 10, 'Arrendamiento de bienes muebles'),
    ('020', 12, 'Mantenimiento y reparación de bienes muebles'),
    ('021', 10, 'Movimiento de carga'),
    ('022', 12, 'Otros servicios empresariales'),
    ('024', 10, 'Comisión mercantil'),
    ('025', 10, 'Fabricación de bienes por encargo'),
    ('026', 10, 'Servicio de transporte de personas'),
    ('027', 4, 'Servicio de transporte de carga'),
    ('030', 4, 'Contratos de construcción'),
    ('031', 10, 'Oro gravado con el IGV'),
    ('032', 10, 'Páprika y otros frutos de los géneros capsicum o pimienta'),
    ('034', 10, 'Minerales metálicos no auríferos'),
    ('035', 1.5, 'Bienes exonerados del IGV'),
    ('036', 1.5, 'Oro y demás minerales metálicos exonerados del IGV'),
    ('037', 12, 'Demás servicios gravados con el IGV'),
    ('039', 10, 'Minerales no metálicos'),
    ('040', 4, 'Bien inmueble gravado con el IGV'),
    ('041', 15, 'Plomo')
  ) t(c, p, n)
  where t.c = lpad(trim(p_codigo), 3, '0');
$$;

create or replace function detalle_cpe_hoja(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text, serie text,
  numero text, fecha_emision date, moneda text, linea integer, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric, enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text, detraccion_porcentaje numeric, detraccion_monto numeric,
  detraccion_cuenta_banco text, detraccion_codigo_bien_servicio text, anticipo_aplicado numeric,
  documento_relacionado text, tipo_documento_relacionado text, oc_carpeta text, centro_costo_cg text,
  codigo_concar text, archivo_oc text, archivo_oc_url text, situacion_pago_oc text, comprador_oc text,
  area_oc text, legajo_oc text, carpeta_oc_url text,
  proyecto_oc text, centro_costo_segun text, documentos_oc text,
  base_gravada numeric, igv_comprobante numeric, no_gravado numeric, desglose_segun text,
  tipo_cambio numeric, total_soles numeric, detraccion_revisar text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as materialized (
    select * from detalle_cpe_carpeta(p_periodo)
  ),
  -- Cada comprobante una vez.
  k as (
    select distinct d.origen, d.proveedor_ruc, d.tipo_comprobante, upper(d.serie) serie,
           coalesce(nullif(ltrim(d.numero, '0'), ''), '0') numero, d.fecha_emision, d.moneda, d.total_comprobante,
           d.detraccion_porcentaje, d.detraccion_codigo_bien_servicio
      from d
  ),
  sire as (
    select distinct on (s.proveedor_ruc, s.tipo_comprobante, upper(s.serie), coalesce(nullif(ltrim(s.numero, '0'), ''), '0'))
           s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie, coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero,
           coalesce(s.base_dg, 0) + coalesce(s.base_dgng, 0) + coalesce(s.base_dng, 0) base,
           coalesce(s.igv_dg, 0) + coalesce(s.igv_dgng, 0) + coalesce(s.igv_dng, 0) igv,
           s.total, s.tipo_cambio
      from comprobantes_sunat s
     where s.empresa_ruc = '20512201611' and (select seguridad.puede_ver_todo())
     order by s.proveedor_ruc, s.tipo_comprobante, upper(s.serie), coalesce(nullif(ltrim(s.numero, '0'), ''), '0'), s.ultima_vez desc nulls last
  ),
  -- El tipo de cambio de cada día y moneda (SUNAT publica uno por día).
  tc as (
    select s.moneda, s.fecha_emision, mode() within group (order by s.tipo_cambio) tc
      from comprobantes_sunat s
     where s.empresa_ruc = '20512201611' and s.moneda <> 'PEN' and s.tipo_cambio > 1
       and (select seguridad.puede_ver_todo())
     group by 1, 2
  ),
  xml as (
    select c.proveedor_ruc, c.tipo_comprobante, upper(c.serie) serie, coalesce(nullif(ltrim(c.numero, '0'), ''), '0') numero,
           c.origen, c.subtotal, c.igv
      from cpe_comprobante c
     where c.empresa_ruc = '20512201611' and (select seguridad.puede_ver_todo())
  ),
  r as (
    select k.*,
           s.base s_base, s.igv s_igv, s.total s_total, s.tipo_cambio s_tc,
           x.subtotal x_sub, x.igv x_igv,
           case when k.moneda = 'PEN' then 1
                else coalesce(nullif(s.tipo_cambio, 1),
                              (select t.tc from tc t where t.moneda = k.moneda and t.fecha_emision <= k.fecha_emision
                                order by t.fecha_emision desc limit 1)) end tc,
           pd.porcentaje pct_tabla, pd.nombre det_nombre
      from k
      left join sire s on k.origen = 'RECIBIDO' and s.proveedor_ruc = k.proveedor_ruc and s.tipo_comprobante = k.tipo_comprobante
                      and s.serie = k.serie and s.numero = k.numero
      left join xml x on x.origen = k.origen and x.proveedor_ruc = k.proveedor_ruc and x.tipo_comprobante = k.tipo_comprobante
                     and x.serie = k.serie and x.numero = k.numero
      left join lateral porcentaje_detraccion(k.detraccion_codigo_bien_servicio) pd on true
  ),
  calc as (
    select r.*,
           case when r.s_total is not null then r.s_base
                when r.x_igv is not null then least(round(r.x_igv / 0.18, 2), coalesce(r.x_sub, r.x_igv / 0.18)) end base_g,
           case when r.s_total is not null then r.s_igv else r.x_igv end igv_c,
           case when r.s_total is not null then 'SIRE'
                when r.x_igv is not null then 'XML (IGV al 18%)' end segun
      from r
  )
  select d.*,
         c.base_g, c.igv_c,
         case when c.segun = 'SIRE' then round(c.s_total - c.s_base - c.s_igv, 2)
              when c.segun is not null then greatest(round(coalesce(c.x_sub, 0) - c.base_g, 2), 0) end,
         c.segun,
         c.tc,
         round(d.total_comprobante * c.tc, 2),
         case when coalesce(d.detraccion_porcentaje, 0) <= 0 then ''
              when nullif(trim(d.detraccion_codigo_bien_servicio), '') is null then 'Tiene detracción sin código de bien o servicio'
              when c.pct_tabla is null then ''
              when abs(d.detraccion_porcentaje - c.pct_tabla) > 0.001 then
                'Se aplicó ' || rtrim(to_char(d.detraccion_porcentaje, 'FM990.99'), '.') || '% y el código ' ||
                lpad(trim(d.detraccion_codigo_bien_servicio), 3, '0') || ' (' || c.det_nombre || ') lleva ' ||
                rtrim(to_char(c.pct_tabla, 'FM990.99'), '.') || '%'
              else '' end
    from d
    left join calc c on c.origen = d.origen and c.proveedor_ruc = d.proveedor_ruc and c.tipo_comprobante = d.tipo_comprobante
                    and c.serie = upper(d.serie) and c.numero = coalesce(nullif(ltrim(d.numero, '0'), ''), '0')
   order by d.fecha_emision, d.serie, d.numero, d.linea;
$$;

revoke execute on function detalle_cpe_hoja(text) from public, anon;
grant execute on function detalle_cpe_hoja(text) to authenticated;
