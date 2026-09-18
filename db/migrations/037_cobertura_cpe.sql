-- Cobertura: qué de lo que SUNAT dice que existe ya tiene detalle
--
-- `comprobantes_sunat` (RCE/SIRE) trae TODO lo declarado —13 mil comprobantes,
-- cabecera nomás—. `cpe_comprobante` trae detalle línea por línea, pero solo
-- de lo que el scraper ya bajó —un puñado, mes por mes—. Nadie podía ver, sin
-- consultar la base a mano, cuánto de lo primero ya tiene lo segundo.
--
-- El cruce es el mismo que ya usa el resto del sistema: por
-- proveedor+tipo+serie+número, sin llave dura (`cpe_comprobante_identidad_idx`
-- ya cubre esas cuatro columnas, así que no hace falta un índice nuevo).
--
-- Solo entran los tipos que de verdad tienen un XML en «Consultar Factura y
-- Nota» —01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito—: los
-- demás códigos que trae el RCE (recibos por servicios públicos, DUAs...) no
-- tienen representación ahí, y contarlos como «pendientes» sería mentir sobre
-- cuánto falta.

/** El detalle, comprobante por comprobante: qué hay en el RCE y si ya tiene su XML. */
create or replace function cobertura_cpe(p_periodo text default null)
returns table (
  periodo text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  total_sire numeric, estado text, total_detalle numeric, diferencia numeric, items bigint
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    s.periodo, s.proveedor_ruc, s.proveedor_nombre,
    s.tipo_comprobante, s.serie, s.numero, s.fecha_emision, s.moneda,
    s.total,
    case when c.id is null then 'Sin detalle' else 'Con detalle' end,
    c.total,
    -- La diferencia solo tiene sentido si hay algo con qué comparar.
    case when c.id is null then null else round(s.total - c.total, 2) end,
    coalesce(i.cuantos, 0)
  from comprobantes_sunat s
  left join cpe_comprobante c
    on c.empresa_ruc    = s.empresa_ruc
   and c.proveedor_ruc  = s.proveedor_ruc
   and c.tipo_comprobante = s.tipo_comprobante
   and c.serie          = s.serie
   and c.numero         = s.numero
  left join lateral (
    select count(*) cuantos from cpe_item where comprobante_id = c.id
  ) i on true
  where seguridad.puede_ver_todo()
    and s.tipo_comprobante in ('01', '03', '07', '08')
    and (p_periodo is null or s.periodo = p_periodo)
  order by s.fecha_emision desc, s.serie, s.numero;
$$;

/** El resumen por período: cuántos hay, cuántos con detalle, y el % de avance. */
create or replace function resumen_cobertura_cpe()
returns table (
  periodo text, en_sire bigint, con_detalle bigint, sin_detalle bigint, pct_cobertura numeric
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    s.periodo,
    count(*) en_sire,
    count(c.id) con_detalle,
    count(*) - count(c.id) sin_detalle,
    round(count(c.id)::numeric / nullif(count(*), 0) * 100, 1) pct_cobertura
  from comprobantes_sunat s
  left join cpe_comprobante c
    on c.empresa_ruc    = s.empresa_ruc
   and c.proveedor_ruc  = s.proveedor_ruc
   and c.tipo_comprobante = s.tipo_comprobante
   and c.serie          = s.serie
   and c.numero         = s.numero
  where seguridad.puede_ver_todo()
    and s.tipo_comprobante in ('01', '03', '07', '08')
  group by s.periodo
  order by s.periodo desc;
$$;

revoke execute on function cobertura_cpe(text)      from anon;
grant  execute on function cobertura_cpe(text)      to authenticated;
revoke execute on function resumen_cobertura_cpe()  from anon;
grant  execute on function resumen_cobertura_cpe()  to authenticated;
