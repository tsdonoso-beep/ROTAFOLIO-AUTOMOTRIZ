-- La carpeta madre de importaciones, junto a la de compras nacionales
--
-- `scripts/carpetas-oc.mts` ahora lee también la carpeta de importaciones
-- (PROCEDENCIA=importacion), donde la OC va con 3 dígitos («172-2026»), como
-- en el cuadro de aprobaciones. Cada carpeta madre se carga por separado:
-- una corrida completa de una no debe borrar lo de la otra.
--   · oc_carpeta lleva la procedencia;
--   · cargar_carpetas_oc() la recibe en cada fila («procedencia») y, al
--     empezar de cero, borra solo lo de esa procedencia (en oc_archivo, por
--     los dígitos de la OC). La firma no cambia;
--   · vinculos_oc() busca el legajo de la OC según su procedencia.

alter table oc_carpeta add column if not exists procedencia text not null default 'Nacional'
  check (procedencia in ('Nacional', 'Importación'));

/**
 * Como en 045, con la procedencia de la carpeta madre en cada fila
 * («Nacional» si no viene). Todas las filas de una carga son de la misma.
 */
create or replace function cargar_carpetas_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
  p_procedencia text := coalesce(nullif(p_filas->0->>'procedencia', ''), 'Nacional');
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga las carpetas de OC.';
  end if;

  if p_procedencia not in ('Nacional', 'Importación') then
    raise exception 'Procedencia desconocida: %. Se espera Nacional o Importación.', p_procedencia;
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      -- Solo lo de su carpeta madre: la OC nacional tiene 4 dígitos, la de importación 3.
      delete from oc_archivo
       where empresa_ruc = p_empresa_ruc and origen = 'CARPETA'
         and oc ~ case when p_procedencia = 'Importación' then '^\d{3}-' else '^\d{4}-' end;
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'CARPETA', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serie'), ''),
           null, null, null
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'CARPETAS' then
    if p_desde_cero then
      delete from oc_carpeta where empresa_ruc = p_empresa_ruc and procedencia = p_procedencia;
    end if;
    insert into oc_carpeta (
      empresa_ruc, oc, carpeta_url, carpeta_nombre, tipo, proveedor, proyecto, proyecto_carpeta,
      archivos, comprobantes, series, rucs, procedencia
    )
    select distinct on (f->>'oc', f->>'carpetaUrl')
           p_empresa_ruc, f->>'oc', f->>'carpetaUrl', nullif(f->>'carpetaNombre', ''), nullif(f->>'tipo', ''),
           nullif(f->>'proveedor', ''), nullif(f->>'proyecto', ''), nullif(f->>'proyectoCarpeta', ''),
           nullif(f->>'archivos', '')::integer, nullif(f->>'comprobantes', '')::integer,
           nullif(f->>'series', ''), nullif(f->>'rucs', ''), p_procedencia
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'carpetaUrl', '') is not null
    on conflict (empresa_ruc, oc, carpeta_url) do update set
      carpeta_nombre = excluded.carpeta_nombre, tipo = excluded.tipo, proveedor = excluded.proveedor,
      proyecto = excluded.proyecto, proyecto_carpeta = excluded.proyecto_carpeta,
      archivos = excluded.archivos, comprobantes = excluded.comprobantes,
      series = excluded.series, rucs = excluded.rucs, procedencia = excluded.procedencia, cargado_en = now();
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera CARPETAS o ARCHIVOS.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_carpetas_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_carpetas_oc(text, text, jsonb, boolean) to authenticated;

-- ── El cruce factura ↔ OC, con la carpeta madre como fuente ──
-- Igual que en 045, salvo el legajo y la fuente de una OC de la carpeta de importaciones.
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text,
  situacion_pago text, comprador text, area text, legajo text, carpeta_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez (ver 040).
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, a.origen, a.carpeta_url,
           -- La OC del legajo ya viene distinguida (importación con 3 dígitos):
           -- no se normaliza, o se juntaría con la nacional del mismo número.
           -- La de la carpeta madre ya viene como «0200-2026».
           case when a.origen in ('LEGAJO', 'CARPETA') then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           -- A la carpeta madre el RUC se lo dan los nombres de archivo y, si
           -- no, la base de nacionales (oc_legajo) por el número de la OC.
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') || coalesce(lr.rucs, '{}') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
      left join lateral (
        select array_agg(distinct x) rucs
          from oc_legajo l
          cross join lateral unnest(string_to_array(l.proveedor_ruc, ' / ')) x
         where a.origen = 'CARPETA' and l.empresa_ruc = a.empresa_ruc and l.oc = o.oc1
      ) lr on true
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.proveedor_ruc = a.ruc_leido
                  and s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 2 prioridad,
           case a.origen when 'LEGAJO' then 'Legajo (nombre o lectura del archivo)'
                         when 'CARPETA' then case when a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (nombre del archivo)'
                                                  else 'Carpeta de compras nacionales (nombre del archivo)' end
                         else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad,
           case when a.origen = 'CARPETA' and a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (número sin serie)'
                when a.origen = 'CARPETA' then 'Carpeta de compras nacionales (número sin serie)'
                else 'Nombre del archivo (número sin serie)' end fuente
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
  -- Un comprobante por OC, con la manera más segura; a igual manera, el
  -- legajo (sabe más de la OC), después la carpeta madre, después la captura.
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              case t.origen when 'LEGAJO' then 0 when 'CARPETA' then 1 else 2 end, t.url
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
     where b.empresa_ruc = p_empresa_ruc and (select ok from permiso)
     group by b.oc
  ),
  leg as (
    select l.*, count(*) over (partition by l.oc) n_mismo_numero
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  con_legajo as (
    -- El legajo de la OC: el de su carpeta si el archivo vino del legajo; si
    -- vino de la captura, el del mismo número solo si no hay duda (uno solo y
    -- nacional: la captura no distingue las importaciones). Desde una carpeta
    -- madre, el de su procedencia (3 dígitos = importación); si hay varios
    -- (los gastos de una importación llevan su número), el de la misma carpeta.
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta
      from mejor m
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional')
                or (m.origen = 'CARPETA'
                    and l.procedencia = case when m.oc_n ~ '^\d{3}-' then 'Importación' else 'Nacional' end))
         order by position(split_part(split_part(coalesce(m.carpeta_url, ''), '/folders/', 2), '?', 1) in l.carpeta_url) > 0 desc,
                  l.carpeta_url
         limit 1
      ) l on true
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         coalesce(m.l_cc_codigo, r.cc_codigo), coalesce(m.l_cc_nombre, r.cc_nombre),
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null and m.l_cc_codigo is null and m.l_cc_nombre is null
                then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 and m.l_cc_nombre is null then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end,
           case when m.l_situacion = 'ANULADA' then 'la OC está anulada en el cuadro de aprobaciones' end
         ), ''),
         m.l_situacion, m.l_comprador, m.l_area,
         texto_del_legajo(m.l_estado, m.l_falta),
         -- La carpeta madre es donde Compras guarda la OC: esa manda.
         case when m.origen = 'CARPETA' then m.carpeta_url else coalesce(nullif(m.l_carpeta, ''), m.carpeta_url) end
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;
