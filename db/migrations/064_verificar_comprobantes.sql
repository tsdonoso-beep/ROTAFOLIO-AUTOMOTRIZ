-- Verificar contra SUNAT una lista de comprobantes antes de cargarla al CONCAR
--
-- Reunión con Contabilidad (06/10/2026): la tabla que arma la IA con los
-- correos de rendiciones (para la carga masiva de setiembre al CONCAR) tiene
-- que cruzarse con el SIRE antes de subirla: que la factura siga emitida, que
-- no tenga una nota de crédito y que el monto sea el de SUNAT. La duplicidad
-- contra lo ya cargado al CONCAR se mira en la misma hoja (VerificarComprobantes.gs),
-- sin subir el registro del CONCAR a la base.
--
-- verificar_comprobantes_json(p_filas): recibe [{i, ruc, tipo, serie, numero, total}, …]
-- y devuelve, por cada i, lo que dice SUNAT:
--   en_sire        está en el registro de compras del SIRE
--   en_xml         su XML ya se bajó (cpe_comprobante)
--   total_sunat    el total según SUNAT (SIRE, si no el XML)
--   notas          las notas de crédito que lo modifican («E001-12 S/ 300.00»)
--   ya_no_esta     estuvo en el SIRE y en la última lectura de ese mes ya no (¿de baja?)
--   alerta         un resumen para la columna de la hoja

create or replace function tipo_comprobante_codigo(p text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
    when t ~ '^\d{1,2}$' then lpad(t, 2, '0')
    when t ~ '^(F|FACT|FACTURA)' then '01'
    when t ~ '^(B|BV|BOL|BOLETA)' then '03'
    when t ~ '^(NC|NOTA DE CR|NOTA CR)' then '07'
    when t ~ '^(ND|NOTA DE D|NOTA D)' then '08'
    when t ~ '^(RH|RXH|R X H|RECIBO POR HON|HONORARIOS)' then '02'
    when t ~ '^(TK|TICKET)' then '12'
    else t end
  from (select upper(trim(coalesce(p, ''))) t) x;
$$;

create or replace function verificar_comprobantes_json(p_filas jsonb)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with f as (
    select (e->>'i')::int i,
           regexp_replace(coalesce(e->>'ruc', ''), '\D', '', 'g') ruc,
           tipo_comprobante_codigo(e->>'tipo') tipo,
           upper(trim(coalesce(e->>'serie', ''))) serie,
           coalesce(nullif(ltrim(regexp_replace(coalesce(e->>'numero', ''), '\D', '', 'g'), '0'), ''), '0') numero,
           nullif(regexp_replace(coalesce(e->>'total', ''), '[^\d.\-]', '', 'g'), '')::numeric total
      from jsonb_array_elements(p_filas) e
     where (select seguridad.puede_ver_todo())
  ),
  -- La última lectura del SIRE de cada mes: lo que no se vio en ella ya no está.
  lect as (
    select s.periodo, max(s.ultima_vez) ultima from comprobantes_sunat s
     where s.empresa_ruc = '20512201611' group by 1
  ),
  r as (
    select f.*,
           s.total s_total, s.periodo s_periodo, s.ultima_vez s_ultima, l.ultima l_ultima,
           x.total x_total
      from f
      left join lateral (
        select s.* from comprobantes_sunat s
         where s.empresa_ruc = '20512201611' and s.proveedor_ruc = f.ruc and upper(s.serie) = f.serie
           and coalesce(nullif(ltrim(s.numero, '0'), ''), '0') = f.numero
           and (f.tipo = '' or s.tipo_comprobante = f.tipo)
         order by s.ultima_vez desc nulls last limit 1) s on true
      left join lect l on l.periodo = s.periodo
      left join lateral (
        select c.total from cpe_comprobante c
         where c.empresa_ruc = '20512201611' and c.origen = 'RECIBIDO' and c.proveedor_ruc = f.ruc and upper(c.serie) = f.serie
           and coalesce(nullif(ltrim(c.numero, '0'), ''), '0') = f.numero
           and (f.tipo = '' or c.tipo_comprobante = f.tipo)
         limit 1) x on true
  ),
  n as (
    select r.i, string_agg(distinct s.serie || '-' || ltrim(s.numero, '0') || ' ' || s.moneda || ' ' || to_char(s.total, 'FM999G999G990D00'), ' | ') notas
      from r join comprobantes_sunat s
        on s.empresa_ruc = '20512201611' and s.tipo_comprobante = '07' and s.proveedor_ruc = r.ruc
       and upper(s.modifica_serie) = r.serie and coalesce(nullif(ltrim(s.modifica_numero, '0'), ''), '0') = r.numero
     group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'i', r.i,
           'en_sire', r.s_total is not null,
           'en_xml', r.x_total is not null,
           'total_sunat', coalesce(r.s_total, r.x_total),
           'notas', coalesce(n.notas, ''),
           'ya_no_esta', r.s_ultima is not null and r.l_ultima > r.s_ultima + interval '2 days',
           'alerta', case
             when r.ruc !~ '^\d{11}$' or r.serie = '' then 'Revisar: falta RUC o serie'
             when r.s_ultima is not null and r.l_ultima > r.s_ultima + interval '2 days'
               then 'Ojo: ya no aparece en el SIRE (¿dada de baja?)'
             when n.notas is not null then 'Ojo: tiene nota de crédito'
             when coalesce(r.s_total, r.x_total) is not null and r.total is not null
                  and abs(abs(coalesce(r.s_total, r.x_total)) - abs(r.total)) > 1
               then 'Ojo: el monto de SUNAT es otro'
             when r.s_total is not null or r.x_total is not null then 'OK: emitida en SUNAT'
             when r.tipo in ('02', '12') then 'No va al SIRE de compras (RxH / ticket)'
             else 'No está en SUNAT (todavía)' end
         ) order by r.i), '[]'::jsonb)
    from r left join n on n.i = r.i;
$$;

revoke execute on function verificar_comprobantes_json(jsonb) from public, anon;
grant execute on function verificar_comprobantes_json(jsonb) to authenticated;
