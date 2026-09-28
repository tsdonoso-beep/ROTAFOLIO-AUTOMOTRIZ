-- La OC de cada comprobante, y su centro de costo
--
-- Las facturas de compra se guardan en Drive, en la carpeta de su orden de
-- compra (el «LINK DE CARPETA» de la base de Control de Gestión). Encontrar
-- la factura dentro de la carpeta une un comprobante de SUNAT con su OC, y por
-- la OC, con el centro de costo que Control de Gestión le asignó. Es lo que la
-- carga a CONCAR necesita y lo que ningún XML trae.
--
-- La captura la hace un Apps Script en una hoja aparte (docs/appscript:
-- CapturaCarpetasOC.gs + LecturaFacturas.gs), que sube aquí lo que vio. El
-- cruce con SUNAT se hace AQUÍ y no en la hoja, y en vivo: una factura que
-- SUNAT reporta días después de que su archivo se capturó se une sola, sin
-- volver a correr nada.
--
-- Tres almacenes:
--   · oc_archivo                  cada archivo visto en una carpeta de OC
--   · oc_base_cg                  el centro de costo de cada OC, según CG
--   · equivalencia_centro_costo   el código de CONCAR de cada centro de costo,
--                                 SOLO si alguien lo confirmó
-- Y una función, vinculos_oc(), que los cruza con comprobantes_sunat.

/** «OC 0115-2026», «115-2026», «2026-0115», «OC2026-0115» → «0115-2026». */
create or replace function oc_normalizada(p text)
returns text
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  m text[];
begin
  m := regexp_match(coalesce(p, ''), '(\d{1,6})\s*-\s*(20\d\d)(?!\d)');
  if m is not null then
    return lpad(m[1]::int::text, 4, '0') || '-' || m[2];
  end if;
  m := regexp_match(coalesce(p, ''), '(20\d\d)\s*-\s*(\d{1,6})(?!\d)');
  if m is not null then
    return lpad(m[2]::int::text, 4, '0') || '-' || m[1];
  end if;
  return null;
end;
$$;

-- ── Cada archivo visto en una carpeta de OC ──
create table oc_archivo (
  empresa_ruc       text not null,
  -- Tal como viene de la base: puede ser «0115-2026» o, si varias OC
  -- comparten carpeta, «0001-2026 / 0002-2026».
  oc                text not null,
  proveedor_ruc_cg  text,           -- también puede traer varios, con « / »
  proveedor_cg      text,
  carpeta_url       text,
  nombre            text,
  url               text not null,
  tipo_archivo      text,           -- PDF, Imagen, Excel…
  parece            text,           -- FACTURA, GUÍA, PAGO… según el nombre
  serie_en_nombre   text,           -- «F001-18178» si el nombre la trae
  -- Lo que se leyó del documento (LecturaFacturas.gs), si se leyó.
  estado_lectura    text,
  ruc_leido         text,
  serie_leida       text,
  cargado_en        timestamptz not null default now(),
  primary key (empresa_ruc, oc, url)
);

comment on table oc_archivo is
  'Archivos encontrados en las carpetas de OC de Drive, tal como los subió la captura. Se reemplaza entero en cada carga.';

-- ── El centro de costo de cada OC, según la base de Control de Gestión ──
create table oc_base_cg (
  empresa_ruc    text not null,
  oc             text not null,      -- normalizada: «0115-2026»
  cc_codigo      text not null,      -- «PROY-2025-079-5», o «-» en las áreas
  cc_nombre      text not null,
  proveedor_ruc  text,
  fecha_oc       date,
  moneda         text,
  monto          numeric(16,2),      -- suma de MONTO TOTAL de sus líneas, sin IGV
  lineas         int,
  primary key (empresa_ruc, oc, cc_codigo, cc_nombre)
);

comment on table oc_base_cg is
  'Resumen de la base de OC de Control de Gestión: por OC y centro de costo, cuántas líneas, desde cuándo y por cuánto.';

-- ── El código de CONCAR de cada centro de costo ──
-- La llave es el código del proyecto; en las áreas, que no tienen código
-- («-»), es el nombre. Solo lo CONFIRMADO se publica: si hay duda, en blanco.
create table equivalencia_centro_costo (
  cc_clave        text primary key,
  cc_nombre       text,
  concar_codigo   text,
  estado          text not null check (estado in ('CONFIRMADO', 'POR DEFINIR')),
  nota            text,
  actualizado_en  timestamptz not null default now()
);

comment on table equivalencia_centro_costo is
  'Centro de costo de la base de CG → código de CONCAR (tabla T.G. 05). Solo lo CONFIRMADO sale en las hojas.';

insert into equivalencia_centro_costo (cc_clave, cc_nombre, concar_codigo, estado, nota) values
  ('PROY-2025-077-3', 'PRONIED - TALLERES EPT I y II', '30015', 'CONFIRMADO',
   'Confirmado el 24/09/2026. No usar 30017.'),
  ('PROY-2025-079-5', 'PRONIED - TALLERES ESPECIALIZADO', '30016', 'CONFIRMADO',
   'Confirmado el 28/09/2026.');

alter table oc_archivo                enable row level security;
alter table oc_base_cg                enable row level security;
alter table equivalencia_centro_costo enable row level security;

create policy oc_archivo_lectura on oc_archivo for select using (seguridad.puede_ver_todo());
create policy oc_base_cg_lectura on oc_base_cg for select using (seguridad.puede_ver_todo());
create policy equivalencia_cc_lectura on equivalencia_centro_costo for select using (seguridad.puede_ver_todo());

revoke all on oc_archivo, oc_base_cg, equivalencia_centro_costo from anon;
revoke insert, update, delete, truncate, references, trigger
  on oc_archivo, oc_base_cg, equivalencia_centro_costo from authenticated;
grant select on oc_archivo, oc_base_cg, equivalencia_centro_costo to authenticated;

/**
 * Sube una parte de la captura: 'ARCHIVOS' (oc_archivo) o 'BASE_CG'
 * (oc_base_cg). Va por lotes, porque son miles de filas y una petición tiene
 * un minuto de vida: el primer lote llega con p_desde_cero = true y borra lo
 * anterior de esa parte; los siguientes solo agregan. Así una carga nueva
 * reemplaza a la anterior entera y no quedan archivos que ya no existen.
 */
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
      delete from oc_archivo where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_archivo (
      empresa_ruc, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    -- distinct on: un mismo archivo dos veces en el lote haría fallar el insert.
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serieEnNombre'), ''),
           nullif(f->>'estadoLectura', ''), nullif(f->>'rucLeido', ''), nullif(upper(f->>'serieLeida'), '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, oc, url) do update set
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
    -- Se agrupa antes: «115-2026» y «0115-2026» son la misma OC, y dos filas
    -- con la misma llave en un lote harían fallar el insert.
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

revoke execute on function cargar_captura_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_captura_oc(text, text, jsonb, boolean) to authenticated;

/**
 * El cruce: qué comprobante de SUNAT está en la carpeta de qué OC.
 *
 * Tres maneras, de la más segura a la menos:
 *   1. Lo leído del documento: RUC emisor + serie-número exactos.
 *   2. La serie-número del nombre del archivo, con el RUC del proveedor de la
 *      OC; o, si ese número lo tiene un solo emisor en SUNAT, ese (flete,
 *      aduana: otro proveedor dentro de la carpeta de la OC).
 *   3. Un nombre de factura sin serie («FT 9852.pdf»): un número que solo un
 *      comprobante del proveedor de la OC tiene.
 *
 * Una fila por comprobante y OC, con el centro de costo principal de la OC
 * (el de más líneas), su código CONCAR si está confirmado, y alertas para
 * revisar: factura anterior a la OC, más cara que la OC, de otro proveedor,
 * o un RUC mal escrito en la base.
 */
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with arch as (
    select a.url, a.nombre, a.parece, oc_normalizada(o.oc1) oc_n,
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           -- el OCR lee «FO01» por «F001»: la O dentro de la serie es un cero
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
     where a.empresa_ruc = p_empresa_ruc
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
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

-- ── Las dos hojas publicadas, con la OC al final ──
--
-- Las columnas nuevas van AL FINAL, para no correr las que alguien ya tenga
-- referenciadas. Si un comprobante está en más de una OC, van juntas con « / ».

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
           string_agg(distinct v.alertas, '; ') alertas
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
      -- La suma de los tres destinos. El desglose queda en la tabla por si
      -- Contabilidad lo pide: separarlo despues seria cambiar una columna, no
      -- volver a consultar nueve meses.
      'base',             nullif(coalesce(c.base_dg,0) + coalesce(c.base_dgng,0) + coalesce(c.base_dng,0), 0),
      'igv',              nullif(coalesce(c.igv_dg,0) + coalesce(c.igv_dgng,0) + coalesce(c.igv_dng,0), 0),
      'detraccion',       c.detraccion,
      'tipoCambio',       c.tipo_cambio,
      'ocCarpeta',        v.oc,
      'centroCostoCg',    v.cc,
      'codigoConcar',     v.concar,
      'alertasOc',        v.alertas
    ) as fila
    from comprobantes_sunat c
    left join cambios x on x.comprobante_id = c.id
    left join vinc v
           on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
          and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
    where p_periodo is null or c.periodo = p_periodo
  ) t;
$$;

-- detalle_cpe cambia las columnas que devuelve: hay que borrarla y crearla.
drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text,
  serie text, numero text, fecha_emision date, moneda text, linea integer, descripcion text,
  cantidad numeric, unidad text, precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text, forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text,
  detraccion_codigo_bien_servicio text, anticipo_aplicado numeric, documento_relacionado text,
  tipo_documento_relacionado text,
  oc_carpeta text, centro_costo_cg text, codigo_concar text
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
           string_agg(distinct v.concar_codigo, ' / ') concar
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
    v.oc, v.cc, v.concar
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
