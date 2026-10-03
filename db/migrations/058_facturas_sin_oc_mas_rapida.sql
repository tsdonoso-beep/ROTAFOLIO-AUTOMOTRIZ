-- Facturas sin OC más rápida, y la vista pide cada lista en una sola consulta
--
-- La vista ejecutiva se cortaba con «canceling statement due to statement
-- timeout»: la base corta a los 8 s cada consulta de la cuenta del robot, y
-- facturas_sin_oc() tardaba ~5,6 s; pedida en dos páginas a la vez (y junto
-- a las carpetas), pasaba los 8 s. Dos cambios:
--
--   1. facturas_sin_oc(): el «gasto típico sin OC» (una cadena de
--      expresiones regulares sobre el nombre) se calculaba por cada factura y
--      dos veces (para mostrarlo y para ordenar): ~11 700 × 2. Ahora una vez
--      por proveedor (~2 100) y se reusa; lo que depende del monto (persona
--      natural con menos de S/ 1 000) se mira aparte. Mismo resultado.
--   2. facturas_sin_oc_json() y carpetas_madre_fuentes_json(): la lista
--      entera en UNA fila (jsonb), en el mismo orden. PostgREST entrega como
--      mucho 1000 filas por consulta y cada página volvía a calcular todo;
--      una sola fila no tiene ese tope. Las usan la vista y CarpetaMadre.gs.

create or replace function facturas_sin_oc(p_empresa_ruc text default '20512201611', p_desde date default '2026-01-01')
returns table (
  senal text, razon text, gasto_tipico text, area_probable text, comprador_probable text,
  periodo text, fecha_emision date, proveedor_ruc text, proveedor_nombre text, serie text, numero text,
  moneda text, total numeric, facturas_del_proveedor integer, con_oc_del_proveedor integer,
  ocs_del_proveedor text, enlace_pdf text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with v as materialized (
    select * from vinculos_oc(p_empresa_ruc)
  ),
  unidas as (
    select distinct v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero from v
  ),
  c as materialized (
    select c.periodo, c.fecha_emision, c.proveedor_ruc, c.proveedor_nombre, c.serie, c.numero, c.moneda, c.total,
           c.pdf_drive_url, (u.serie is not null) unida
      from cpe_comprobante c
      left join unidas u
        on u.proveedor_ruc = c.proveedor_ruc and u.tipo_comprobante = c.tipo_comprobante
       and u.serie = upper(c.serie) and u.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
     where c.empresa_ruc = p_empresa_ruc and c.origen = 'RECIBIDO' and c.tipo_comprobante = '01'
       and c.fecha_emision >= p_desde and (select seguridad.puede_ver_todo())
  ),
  p as (
    select c.proveedor_ruc, count(*)::integer n, count(*) filter (where c.unida)::integer con_oc
      from c group by 1
  ),
  -- El gasto típico por el NOMBRE, una vez por proveedor (con un monto alto, para que no
  -- entre la regla de la persona natural, que depende de cada factura y se mira abajo).
  tipo as materialized (
    select d.proveedor_ruc, d.proveedor_nombre, gasto_tipico_sin_oc(d.proveedor_nombre, d.proveedor_ruc, 1e12) tipico
      from (select distinct c.proveedor_ruc, c.proveedor_nombre from c where not c.unida) d
  ),
  quien as (
    select distinct on (v.proveedor_ruc) v.proveedor_ruc, v.area, v.comprador
      from v where coalesce(v.comprador, v.area) is not null
     group by v.proveedor_ruc, v.area, v.comprador
     order by v.proveedor_ruc, count(*) desc
  ),
  area_madre as (
    select v.proveedor_ruc,
           mode() within group (order by case k.procedencia when 'Importación' then 'COMEX (importaciones)' else 'Compras nacionales' end) area
      from v join oc_carpeta k on k.empresa_ruc = p_empresa_ruc and k.oc = v.oc
     group by 1
  ),
  ocs as (
    select v.proveedor_ruc, string_agg(distinct v.oc, ', ') lista from v group by 1
  ),
  s as materialized (
    select c.*, p.n, p.con_oc,
           x.motivo manual,
           coalesce(t.tipico,
             case when c.proveedor_ruc like '10%' and coalesce(c.total, 0) < 1000 then 'Persona natural, monto menor (movilidad / viáticos)' end) tipico,
           c.total * case when c.moneda = 'USD' then 3.75 else 1 end soles
      from c join p using (proveedor_ruc)
      left join tipo t on t.proveedor_ruc = c.proveedor_ruc and t.proveedor_nombre is not distinct from c.proveedor_nombre
      left join proveedor_sin_oc x on x.empresa_ruc = p_empresa_ruc and x.proveedor_ruc = c.proveedor_ruc
     where not c.unida
  )
  select case when s.manual is not null then ''
              when s.con_oc > 0 then 'ALTA'
              when s.tipico is null and s.soles >= 2000 then 'MEDIA'
              else '' end,
         case when s.manual is not null then 'Contabilidad: ' || s.manual
              when s.con_oc > 0 then 'El proveedor trabaja con OC: ' || s.con_oc || ' de sus ' || s.n || ' facturas están unidas a una OC. Falta la OC o subir esta factura a su carpeta.'
              when s.tipico is null and s.soles >= 2000 then 'Monto alto y no es un gasto típico sin OC.'
              when s.tipico is not null then 'Gasto típico sin OC.'
              else 'Monto menor.' end,
         coalesce(s.manual, s.tipico, ''),
         coalesce(nullif(q.area, ''), a.area, ''), coalesce(q.comprador, ''),
         s.periodo, s.fecha_emision, s.proveedor_ruc, s.proveedor_nombre, s.serie, s.numero, s.moneda, s.total,
         s.n, s.con_oc, coalesce(o.lista, ''), s.pdf_drive_url
    from s
    left join quien q on q.proveedor_ruc = s.proveedor_ruc
    left join area_madre a on a.proveedor_ruc = s.proveedor_ruc
    left join ocs o on o.proveedor_ruc = s.proveedor_ruc
   order by case when s.manual is not null then 3 when s.con_oc > 0 then 0 when s.tipico is null and s.soles >= 2000 then 1 else 2 end,
            s.soles desc, s.proveedor_ruc, s.serie, s.numero;
$$;

-- Las facturas sin OC de las señales pedidas (por omisión ALTA y MEDIA), en una sola fila.
create or replace function facturas_sin_oc_json(p_empresa_ruc text default '20512201611', p_senales text[] default array['ALTA', 'MEDIA'])
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.f order by x.n), '[]'::jsonb)
    from (select to_jsonb(f) f, row_number() over () n from facturas_sin_oc(p_empresa_ruc) f where f.senal = any(p_senales)) x;
$$;

revoke execute on function facturas_sin_oc_json(text, text[]) from public, anon;
grant execute on function facturas_sin_oc_json(text, text[]) to authenticated;

-- Las carpetas madre con sus fuentes, en una sola fila.
create or replace function carpetas_madre_fuentes_json(p_empresa_ruc text default '20512201611')
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.f order by x.n), '[]'::jsonb)
    from (select to_jsonb(c) f, row_number() over () n from carpetas_madre_fuentes(p_empresa_ruc) c) x;
$$;

revoke execute on function carpetas_madre_fuentes_json(text) from public, anon;
grant execute on function carpetas_madre_fuentes_json(text) to authenticated;
