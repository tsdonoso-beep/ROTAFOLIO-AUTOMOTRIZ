-- El legajo de la OC, en las dos hojas de SUNAT
--
-- La captura de carpetas (039) cruza cada factura con su OC usando los
-- enlaces de la base de Control de Gestión. El legajo por OC
-- (docs/appscript/LegajoPorOC.gs) hace lo mismo pero mejor y con más:
--   · parte del cuadro de aprobaciones 2026, que está en vivo, y se actualiza
--     cada noche;
--   · sube a la carpeta de la OC cuando el enlace apunta a una subcarpeta;
--   · lee por dentro (OCR) los PDF escaneados y saca la serie-número;
--   · distingue las OC nacionales (0172-2026) de las de importación
--     (172-2026), que la normalización de 039 junta en una;
--   · y sabe de cada OC la situación del pago, el comprador, el área que la
--     completa y qué documento le falta.
--
-- Los archivos del legajo entran a oc_archivo con su propio ORIGEN, junto a
-- los de la captura: cada carga reemplaza solo lo suyo. Lo que el legajo sabe
-- de cada OC va a oc_legajo. vinculos_oc() usa los dos, y las hojas suman al
-- final: situación del pago, comprador, área, legajo y carpeta de la OC.

-- ── Los archivos, de dos orígenes ──
alter table oc_archivo add column if not exists origen text not null default 'CAPTURA'
  check (origen in ('CAPTURA', 'LEGAJO'));
alter table oc_archivo drop constraint if exists oc_archivo_pkey;
alter table oc_archivo add primary key (empresa_ruc, origen, oc, url);

comment on column oc_archivo.origen is
  'CAPTURA: CapturaCarpetasOC.gs (enlaces de CG). LEGAJO: LegajoPorOC.gs (cuadro de aprobaciones). Cada carga reemplaza solo su origen.';

-- ── Lo que el legajo sabe de cada OC ──
create table if not exists oc_legajo (
  empresa_ruc       text not null,
  -- Ya distinguida: nacional con 4 dígitos (0172-2026), importación con 3
  -- (172-2026). No pasa por oc_normalizada.
  oc                text not null,
  -- El mismo número puede ser de dos OC distintas (los gastos de una
  -- importación llevan su número): la carpeta las separa.
  carpeta_url       text not null default '',
  unidad            text,
  proyecto          text,
  proveedor         text,
  proveedor_ruc     text,
  comprador         text,
  area              text,            -- Compras nacionales / COMEX (importaciones)
  procedencia       text,            -- Nacional / Importación
  situacion_pago    text,            -- PAGADA, APROBADA PAGO PENDIENTE, FALTA APROBACIÓN…
  estatus           text,            -- tal cual en el cuadro de aprobaciones
  estado_aprobacion text,
  fecha_oc          text,
  monto_soles       numeric(16,2),
  forma_pago        text,
  cc_codigo         text,            -- de Control de Gestión, cruzado con la procedencia
  cc_nombre         text,
  estado_revision   text,            -- OK, PENDIENTE, SIN ACCESO…
  le_falta          text,            -- «Guía de remisión, DAM», vacío si está completo
  documentos        jsonb,           -- {"1. Factura": "✓ 1 · F001-123", …}
  revisado_en       timestamptz,
  cargado_en        timestamptz not null default now(),
  primary key (empresa_ruc, oc, carpeta_url)
);

comment on table oc_legajo is
  'Una fila por OC del legajo (LegajoPorOC.gs): situación del pago, comprador, área, documentos que le faltan. Se reemplaza entero en cada carga.';

alter table oc_legajo enable row level security;
drop policy if exists oc_legajo_lectura on oc_legajo;
create policy oc_legajo_lectura on oc_legajo for select using (seguridad.puede_ver_todo());
revoke all on oc_legajo from anon;
revoke insert, update, delete, truncate, references, trigger on oc_legajo from authenticated;
grant select on oc_legajo to authenticated;

-- ── La carga de la captura: ahora solo reemplaza su propio origen ──
create or replace function cargar_captura_oc(
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
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga la captura de OC.';
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      delete from oc_archivo where empresa_ruc = p_empresa_ruc and origen = 'CAPTURA';
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'CAPTURA', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serieEnNombre'), ''),
           nullif(f->>'estadoLectura', ''), nullif(f->>'rucLeido', ''), nullif(upper(f->>'serieLeida'), '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, estado_lectura = excluded.estado_lectura,
      ruc_leido = excluded.ruc_leido, serie_leida = excluded.serie_leida, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'BASE_CG' then
    if p_desde_cero then
      delete from oc_base_cg where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_base_cg (empresa_ruc, oc, cc_codigo, cc_nombre, proveedor_ruc, fecha_oc, moneda, monto, lineas)
    select p_empresa_ruc, k.oc, k.cc_codigo, k.cc_nombre, max(k.ruc), min(k.fecha),
           max(k.moneda), sum(k.monto), sum(k.lineas)
      from (
        select oc_normalizada(f->>'oc') oc, coalesce(nullif(f->>'ccCodigo', ''), '-') cc_codigo,
               coalesce(f->>'ccNombre', '') cc_nombre, nullif(f->>'proveedorRuc', '') ruc,
               nullif(f->>'fechaOc', '')::date fecha, nullif(f->>'moneda', '') moneda,
               nullif(f->>'monto', '')::numeric monto, coalesce(nullif(f->>'lineas', '')::int, 1) lineas
          from jsonb_array_elements(p_filas) f
      ) k
     where k.oc is not null
     group by k.oc, k.cc_codigo, k.cc_nombre
    on conflict (empresa_ruc, oc, cc_codigo, cc_nombre) do update set
      proveedor_ruc = coalesce(excluded.proveedor_ruc, oc_base_cg.proveedor_ruc),
      fecha_oc = least(excluded.fecha_oc, oc_base_cg.fecha_oc),
      moneda = coalesce(excluded.moneda, oc_base_cg.moneda),
      monto = coalesce(oc_base_cg.monto, 0) + coalesce(excluded.monto, 0),
      lineas = oc_base_cg.lineas + excluded.lineas;
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera ARCHIVOS o BASE_CG.', p_parte;
  end if;

  return n;
end;
$$;

/**
 * Sube una parte del legajo: 'LEGAJO' (oc_legajo, una fila por OC) o
 * 'ARCHIVOS' (oc_archivo con origen LEGAJO). Por lotes, como la captura: el
 * primero con p_desde_cero = true borra lo anterior de esa parte.
 */
create or replace function cargar_legajo_oc(
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
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga el legajo de OC.';
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      delete from oc_archivo where empresa_ruc = p_empresa_ruc and origen = 'LEGAJO';
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'LEGAJO', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
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

  elsif p_parte = 'LEGAJO' then
    if p_desde_cero then
      delete from oc_legajo where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_legajo (
      empresa_ruc, oc, carpeta_url, unidad, proyecto, proveedor, proveedor_ruc, comprador, area,
      procedencia, situacion_pago, estatus, estado_aprobacion, fecha_oc, monto_soles, forma_pago,
      cc_codigo, cc_nombre, estado_revision, le_falta, documentos, revisado_en
    )
    select distinct on (f->>'oc', coalesce(f->>'carpetaUrl', ''))
           p_empresa_ruc, f->>'oc', coalesce(f->>'carpetaUrl', ''), nullif(f->>'unidad', ''),
           nullif(f->>'proyecto', ''), nullif(f->>'proveedor', ''), nullif(f->>'proveedorRuc', ''),
           nullif(f->>'comprador', ''), nullif(f->>'area', ''), nullif(f->>'procedencia', ''),
           nullif(f->>'situacionPago', ''), nullif(f->>'estatus', ''), nullif(f->>'estadoAprobacion', ''),
           nullif(f->>'fechaOc', ''), nullif(f->>'montoSoles', '')::numeric, nullif(f->>'formaPago', ''),
           nullif(f->>'ccCodigo', ''), nullif(f->>'ccNombre', ''), nullif(f->>'estadoRevision', ''),
           nullif(f->>'leFalta', ''), f->'documentos', nullif(f->>'revisadoEn', '')::timestamptz
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null
    on conflict (empresa_ruc, oc, carpeta_url) do update set
      unidad = excluded.unidad, proyecto = excluded.proyecto, proveedor = excluded.proveedor,
      proveedor_ruc = excluded.proveedor_ruc, comprador = excluded.comprador, area = excluded.area,
      procedencia = excluded.procedencia, situacion_pago = excluded.situacion_pago,
      estatus = excluded.estatus, estado_aprobacion = excluded.estado_aprobacion,
      fecha_oc = excluded.fecha_oc, monto_soles = excluded.monto_soles, forma_pago = excluded.forma_pago,
      cc_codigo = excluded.cc_codigo, cc_nombre = excluded.cc_nombre,
      estado_revision = excluded.estado_revision, le_falta = excluded.le_falta,
      documentos = excluded.documentos, revisado_en = excluded.revisado_en, cargado_en = now();
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera LEGAJO o ARCHIVOS.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_legajo_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_legajo_oc(text, text, jsonb, boolean) to authenticated;

/** Lo que las hojas dicen del legajo de una OC, en una frase. */
create or replace function texto_del_legajo(p_estado text, p_le_falta text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
    when p_estado is null then null
    when p_estado ~ '^PENDIENTE' then 'Por revisar'
    when p_estado ~ '^SIN ACCESO' then 'Sin acceso a la carpeta'
    when p_estado ~ '^SIN CARPETA' then 'Sin enlace de carpeta'
    when coalesce(p_le_falta, '') = '' then 'Completo'
    else 'Falta: ' || p_le_falta
  end;
$$;

-- ── El cruce, con los dos orígenes y el legajo ──
-- Cambian las columnas que devuelve: se borra y se vuelve a crear, y con él
-- las dos funciones que lo usan (más abajo).
drop function if exists vinculos_oc(text);

create function vinculos_oc(p_empresa_ruc text default '20512201611')
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
           case when a.origen = 'LEGAJO' then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
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
           case when a.origen = 'LEGAJO' then 'Legajo (nombre o lectura del archivo)' else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad, 'Nombre del archivo (número sin serie)'::text fuente
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
  -- legajo antes que la captura (sabe más de la OC).
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              (t.origen = 'LEGAJO') desc, t.url
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
    -- nacional: la captura no distingue las importaciones).
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta
      from mejor m
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional'))
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
         coalesce(nullif(m.l_carpeta, ''), m.carpeta_url)
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;

-- ── Las dos hojas, con el legajo al final ──
drop function if exists detalle_cpe(text);

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
     group by 1, 2, 3, 4
  )
  select coalesce(jsonb_agg(fila order by fila->>'fechaEmision', fila->>'numero'), '[]'::jsonb)
  from (
    select jsonb_build_object(
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

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text,
  serie text, numero text, fecha_emision date, moneda text, linea integer, descripcion text,
  cantidad numeric, unidad text, precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text, forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text,
  detraccion_codigo_bien_servicio text, anticipo_aplicado numeric, documento_relacionado text,
  tipo_documento_relacionado text,
  oc_carpeta text, centro_costo_cg text, codigo_concar text,
  archivo_oc text, archivo_oc_url text,
  situacion_pago_oc text, comprador_oc text, area_oc text, legajo_oc text, carpeta_oc_url text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  with vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.archivo, ' / ') archivo,
           string_agg(distinct v.archivo_url, ' / ') archivo_url,
           string_agg(distinct v.situacion_pago, ' / ') situacion_pago,
           string_agg(distinct v.comprador, ' / ') comprador,
           string_agg(distinct v.area, ' / ') area,
           string_agg(distinct v.legajo, ' / ') legajo,
           string_agg(distinct v.carpeta_url, ' / ') carpeta_url
      from vinculos_oc() v
     group by 1, 2, 3, 4
  )
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto,
    c.detraccion_cuenta_banco, c.detraccion_codigo_bien_servicio,
    c.anticipo_aplicado, c.documento_relacionado, c.tipo_documento_relacionado,
    v.oc, v.cc, v.concar,
    v.archivo, v.archivo_url,
    v.situacion_pago, v.comprador, v.area, v.legajo, v.carpeta_url
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  left join vinc v
         on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
        and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from public, anon;
grant execute on function detalle_cpe(text) to authenticated, service_role;
