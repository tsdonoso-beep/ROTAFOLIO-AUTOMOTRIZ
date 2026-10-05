-- La hoja COMPROBANTES SUNAT se arma por período
--
-- sunat-diario no publicaba la hoja desde el 02/10/2026: «No se pudo leer el
-- histórico para la hoja: canceling statement due to statement timeout». La
-- base corta a los 8 s cada consulta del robot, y historico_comprobantes_sunat()
-- arma los ~18 000 comprobantes en un solo bloque (~5 s sin carga; con la
-- base ocupada por los otros flujos de la mañana, más de 8).
--
--   1. periodos_comprobantes_sunat(): los períodos que hay, para pedir el
--      histórico de a uno (sunat-diario lo junta).
--   2. historico_comprobantes_sunat(): ordena por las columnas (no volviendo a
--      leer el jsonb de cada fila) y, si se pide un período, solo agrupa los
--      vínculos con OC de ese período. Mismo resultado.

create or replace function periodos_comprobantes_sunat()
returns text[]
language sql
stable
set search_path = public, pg_temp
as $$
  select coalesce(array_agg(distinct c.periodo order by c.periodo), '{}') from comprobantes_sunat c where c.periodo is not null;
$$;

grant execute on function periodos_comprobantes_sunat() to authenticated;

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
           string_agg(distinct v.archivo_url, ' / ') archivo_url,
           string_agg(distinct v.situacion_pago, ' / ') situacion_pago,
           string_agg(distinct v.comprador, ' / ') comprador,
           string_agg(distinct v.area, ' / ') area,
           string_agg(distinct v.legajo, ' / ') legajo,
           string_agg(distinct v.carpeta_url, ' / ') carpeta_url
      from vinculos_oc() v
     -- Solo los comprobantes del período pedido (si se pidió uno): no hace falta agrupar los de todo el año.
     where p_periodo is null or exists (
       select 1 from comprobantes_sunat c
        where c.periodo = p_periodo and c.proveedor_ruc = v.proveedor_ruc and c.tipo_comprobante = v.tipo_comprobante
          and upper(c.serie) = v.serie and coalesce(nullif(ltrim(c.numero, '0'), ''), '0') = v.numero)
     group by 1, 2, 3, 4
  )
  select coalesce(jsonb_agg(fila order by fecha, numero), '[]'::jsonb)
  from (
    select c.fecha_emision::text fecha, c.numero, jsonb_build_object(
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
      'base',             nullif(coalesce(c.base_dg,0) + coalesce(c.base_dgng,0) + coalesce(c.base_dng,0), 0),
      'igv',              nullif(coalesce(c.igv_dg,0) + coalesce(c.igv_dgng,0) + coalesce(c.igv_dng,0), 0),
      'detraccion',       c.detraccion,
      'tipoCambio',       c.tipo_cambio,
      'ocCarpeta',        v.oc,
      'centroCostoCg',    v.cc,
      'codigoConcar',     v.concar,
      'alertasOc',        v.alertas,
      'archivoOc',        v.archivo,
      'archivoOcUrl',     v.archivo_url,
      'situacionPagoOc',  v.situacion_pago,
      'compradorOc',      v.comprador,
      'areaOc',           v.area,
      'legajoOc',         v.legajo,
      'carpetaOcUrl',     v.carpeta_url
    ) as fila
    from comprobantes_sunat c
    left join cambios x on x.comprobante_id = c.id
    left join vinc v
           on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
          and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
    where p_periodo is null or c.periodo = p_periodo
  ) t;
$$;
