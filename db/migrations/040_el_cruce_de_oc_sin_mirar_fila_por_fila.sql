-- El cruce de OC, sin mirar el permiso fila por fila
--
-- vinculos_oc() corría con las políticas de fila de quien lo llamaba: para
-- cada fila de oc_archivo, comprobantes_sunat y oc_base_cg se volvía a
-- preguntar si el usuario puede ver todo (cuatro consultas por fila). Como
-- dueño de la base tardaba 0,6 s; como la cuenta ROBOT, 15 s, y la petición se
-- cortaba por tiempo («canceling statement due to statement timeout»). Como
-- historico_comprobantes_sunat la llama, también habría tumbado la hoja diaria.
--
-- Ahora es security definer —igual que detalle_cpe— y el permiso se mira una
-- sola vez al comienzo: quien no puede ver todo recibe cero filas.

create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez. Con las políticas de fila, se miraba en cada
  -- fila de cada tabla —cuatro consultas por fila, sobre decenas de miles— y
  -- el cruce pasaba de 0,6 s a 15 s, más que el límite de una petición.
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, oc_normalizada(o.oc1) oc_n,
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           -- el OCR lee «FO01» por «F001»: la O dentro de la serie es un cero
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  -- Cuántos emisores tienen cada serie-número: si es uno solo, el número
  -- basta para saber de quién es aunque no sea el proveedor de la OC.
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.proveedor_ruc = a.ruc_leido
                  and s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, s.*, 2 prioridad, 'Nombre del archivo'::text fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, s.*, 3 prioridad, 'Nombre del archivo (número sin serie)'::text fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  mejor as (
    -- Un comprobante por OC, con la manera más segura en que se encontró.
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc
     group by b.oc
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         r.cc_codigo, r.cc_nombre,
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end
         ), '')
    from mejor m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when r.cc_codigo <> '-' then r.cc_codigo else r.cc_nombre end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;
