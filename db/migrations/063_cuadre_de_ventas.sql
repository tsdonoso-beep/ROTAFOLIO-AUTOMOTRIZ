-- El cuadre de ventas e IGV por mes, como se arma el PDT 621
--
-- Reunión con Contabilidad (06/10/2026): el IGV de ventas de la vista «no
-- cuadraba» con lo declarado. Lo que se dijo en la reunión y se confirmó con
-- los XML:
--   · Una factura que aplica un anticipo trae el valor de venta y el IGV ya
--     NETOS del anticipo (el anticipo pagó su IGV el mes en que se facturó).
--     Si el anticipo cubre todo, la factura sale en cero (29 así en 2026).
--     PrepaidAmount (anticipo_aplicado) dice cuánto se descontó.
--   · Las notas de crédito restan, y en abril hay una de S/ 8 millones.
--   · Lo no gravado (exportación, inafecto, exonerado) no lleva IGV: va aparte.
-- Este cuadre separa cada pieza por mes para que Contabilidad lo compare con
-- su PDT casilla por casilla, en vez de mirar un solo total.
--
-- Todo en soles: lo que está en dólares se convierte con el tipo de cambio de
-- ese día que trae el SIRE de compras (el mismo criterio que la migración 053).
-- Los comprobantes de baja (comunicación de baja) no están en los XML: si hay
-- alguno, es una diferencia que este cuadre no ve.

create or replace function cuadre_ventas_json(p_empresa_ruc text default '20512201611', p_anio text default to_char(now(), 'YYYY'))
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with tc as (
    select s.moneda, s.fecha_emision, mode() within group (order by s.tipo_cambio) tc
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.moneda <> 'PEN' and s.tipo_cambio > 1
       and (select seguridad.puede_ver_todo())
     group by 1, 2
  ),
  v as (
    select c.periodo, c.tipo_comprobante t,
           case when c.tipo_comprobante = '07' then -1 else 1 end signo,
           case when c.moneda = 'PEN' then 1
                else coalesce((select t.tc from tc t where t.moneda = c.moneda and t.fecha_emision <= c.fecha_emision
                                order by t.fecha_emision desc limit 1), 1) end tc,
           c.moneda, coalesce(c.subtotal, 0) subtotal, coalesce(c.igv, 0) igv, coalesce(c.total, 0) total,
           coalesce(c.anticipo_aplicado, 0) anticipo
      from cpe_comprobante c
     where c.empresa_ruc = p_empresa_ruc and c.origen = 'EMITIDO' and c.periodo like p_anio || '%'
       and c.tipo_comprobante in ('01', '03', '07', '08')
       and (select seguridad.puede_ver_todo())
  ),
  s as (
    select v.*,
           round(v.igv / 0.18 * v.tc, 2) base_gravada,
           round(greatest(v.subtotal - v.igv / 0.18, 0) * v.tc, 2) no_gravado,
           round(v.igv * v.tc, 2) igv_soles,
           round(v.total * v.tc, 2) total_soles,
           round(v.anticipo * v.tc, 2) anticipo_soles
      from v
  ),
  m as (
    select s.periodo,
           count(*) filter (where s.t in ('01', '03', '08'))                                   n_ventas,
           sum(s.base_gravada) filter (where s.t in ('01', '03', '08'))                        base_ventas,
           sum(s.igv_soles) filter (where s.t in ('01', '03', '08'))                           igv_ventas,
           count(*) filter (where s.t = '07')                                                  n_notas,
           sum(s.base_gravada) filter (where s.t = '07')                                       base_notas,
           sum(s.igv_soles) filter (where s.t = '07')                                          igv_notas,
           sum(s.signo * s.no_gravado)                                                         no_gravado,
           sum(s.signo * s.total_soles)                                                        total_neto,
           count(*) filter (where s.t <> '07' and s.anticipo > 0)                              n_anticipos,
           sum(s.anticipo_soles) filter (where s.t <> '07')                                    anticipos,
           count(*) filter (where s.t <> '07' and s.anticipo > 0 and s.total = 0)              cubiertas_por_anticipo,
           count(*) filter (where s.moneda <> 'PEN')                                           en_dolares
      from s group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'periodo', m.periodo,
           'n_ventas', m.n_ventas, 'base_ventas', coalesce(m.base_ventas, 0), 'igv_ventas', coalesce(m.igv_ventas, 0),
           'n_notas', m.n_notas, 'base_notas', coalesce(m.base_notas, 0), 'igv_notas', coalesce(m.igv_notas, 0),
           'base_neta', coalesce(m.base_ventas, 0) - coalesce(m.base_notas, 0),
           'igv_neto', coalesce(m.igv_ventas, 0) - coalesce(m.igv_notas, 0),
           'no_gravado', coalesce(m.no_gravado, 0), 'total_neto', coalesce(m.total_neto, 0),
           'n_anticipos', m.n_anticipos, 'anticipos', coalesce(m.anticipos, 0),
           'cubiertas_por_anticipo', m.cubiertas_por_anticipo, 'en_dolares', m.en_dolares
         ) order by m.periodo), '[]'::jsonb)
    from m;
$$;

revoke execute on function cuadre_ventas_json(text, text) from public, anon;
grant execute on function cuadre_ventas_json(text, text) to authenticated;
