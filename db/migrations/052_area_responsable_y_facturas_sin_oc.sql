-- A quién le toca cada carpeta de OC y qué facturas aparentan no tener OC
--
-- 1. carpetas_madre(): lo mismo que legajo_de_carpetas() (migración 051) más
--    a quién le toca completar el legajo: el área (por la carpeta madre de
--    donde salió: nacionales → Compras nacionales; importaciones → COMEX) y,
--    si el legajo por OC lo sabe, el comprador, la situación del pago y la
--    forma de pago. Es una función nueva porque cambiar las columnas de una
--    función obliga a borrarla, y la hoja GENERAL usa la anterior hasta que
--    se pegue la nueva versión de CarpetaMadre.gs. legajo_de_carpetas() queda
--    sin uso desde entonces y se puede borrar.
-- 2. facturas_sin_oc(): las facturas recibidas (SUNAT) que no están unidas a
--    ninguna OC, con una señal de si APARENTA que debería tenerla:
--      ALTA  el proveedor trabaja con OC (otras de sus facturas sí están
--            unidas a una OC): falta la OC o falta subir la factura a su
--            carpeta. Dice qué área y comprador suelen comprarle.
--      MEDIA monto alto (S/ 2 000 o más) de un proveedor que no es un gasto
--            típico sin OC.
--      (vacía) gasto típico sin OC —bancos, seguros, combustible, pasajes,
--            hospedaje, comida, peajes, servicios— o monto menor.
-- 3. proveedor_sin_oc: los proveedores que Contabilidad marca a mano como
--    «nunca llevan OC» (viáticos, alquileres, suscripciones…): sus facturas
--    no se alertan.

create table proveedor_sin_oc (
  empresa_ruc text not null,
  proveedor_ruc text not null,
  motivo text not null,
  marcado_por text,
  marcado_en timestamptz not null default now(),
  primary key (empresa_ruc, proveedor_ruc)
);
alter table proveedor_sin_oc enable row level security;
create policy proveedor_sin_oc_lectura on proveedor_sin_oc for select using ((select seguridad.puede_ver_todo()));
grant select on proveedor_sin_oc to authenticated;

-- El gasto típico sin OC, por el nombre del proveedor (y el monto, para las
-- personas naturales: movilidad y viáticos). Nulo si no lo parece.
create or replace function gasto_tipico_sin_oc(p_nombre text, p_ruc text, p_monto numeric)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  with n as (select ' ' || upper(translate(coalesce(p_nombre, ''), 'áéíóúÁÉÍÓÚñÑ', 'aeiouAEIOUnN')) || ' ' t)
  select case
    when t ~ '(BANCO|FINANCIERA|CAJA MUNICIPAL|CAJA RURAL|SCOTIABANK|INTERBANK)' then 'Banco (comisiones)'
    when t ~ '(SEGUROS|REASEGUROS|PRESTADORA DE SALUD| EPS |SANITAS|INSUR S)' then 'Seguro / EPS'
    when t ~ '(COMBUSTIBLE|GRIFO|REPSOL|PRIMAX|PECSA|COESTI|PETRO|LLAMA GAS| GAS S)' then 'Combustible'
    when t ~ '(HOTEL|HOSTAL|HOSPEDAJE|HOTELERA| HTL |ALOJAMIENTO|RESORT)' then 'Hospedaje'
    when t ~ '(PEAJE|RED VIAL|LIMA EXPRESA|CONCESIONARIA VIAL|RUTAS DE LIMA|COVIPERU|PARQUEO|ESTACIONAMIENTO|URBANISTICAS OPERADORA)' then 'Peaje / estacionamiento'
    when t !~ 'CARGA' and t ~ '(TURISMO|TOURS?|TRAVEL|BUS |EXPRESO|CRUZERO|CIVA|ORMENO|FLECHA|LATAM|JETSMART|SKY AIRLINE|AVIANCA|TAXI|TRANSPORTES? .*(PASAJ|TURIS)|EMPRESA DE TRANSPORTES)' then 'Pasajes / movilidad'
    when t ~ '(RESTAURANT|CHIFA|POLLO|CHICKEN|POLLERIA|CAFE|JUGUERIA|SANGUCHE|SANDWICH|PASTELERIA|BAKERY|PANADERIA|BAGUETERIA|FOOD|GOURMET|BEMBOS|ARCOS DORADOS|DELOSI|SNACK|DELIVERY HERO|CEVICHERIA|PARRILLA|PIZZ|BURGER|KFC|STARBUCKS|FRANQUICIAS|SUCULENTO|SABOR)' then 'Comida'
    when t ~ '(TAMBO|OXXO|MAYORSA|HARD DISCOUNT|SUPERMERCADO|CENCOSUD|PLAZA VEA|HIPERMERCADO|MARKET |MARTKET |BODEGA|CADENA DE COMERCIO|C\.H\. RETAIL|FOOD RETAIL)' then 'Tienda / supermercado'
    when t ~ '(BOTICA|FARMACIA|MIFARMA|INKAFARMA|CLINICA)' then 'Farmacia / salud'
    when t ~ '(TELEFONICA|MOVISTAR|CLARO |AMERICA MOVIL|ENTEL|LUZ DEL SUR|ENEL |SEDAPAL|CALIDDA|HIDRANDINA|ELECTRO ?(NORTE|SUR|CENTRO|ORIENTE|DUNAS|UCAYALI|PERU))' then 'Servicios (luz, agua, teléfono)'
    when t ~ '(MUNICIPALIDAD|SERPAR|SOCIEDAD NACIONAL DE INDUSTRIAS|UNIVERSIDAD|NOTARIA|COLEGIO DE|CAMARA DE COMERCIO|SUNAT|REGISTROS PUBLICOS|SUNARP)' then 'Institución / trámite'
    when t ~ '(SHALOM|OLVA|MARVISUR)' then 'Envíos (encomiendas)'
    when p_ruc like '10%' and coalesce(p_monto, 0) < 1000 then 'Persona natural, monto menor (movilidad / viáticos)'
  end
  from n;
$$;

create or replace function carpetas_madre(p_empresa_ruc text default '20512201611')
returns table (
  procedencia text, area_responsable text, comprador text, situacion_pago text, forma_pago text,
  oc text, tipo text, proveedor text, proyecto_carpeta text, carpeta_nombre text,
  carpeta_url text, estado text, le_falta text, documentos text, archivos integer, comprobantes integer,
  series text, cc_codigo text, cc_nombre text, centro_costo_segun text, en_cg boolean,
  facturas_sunat text, facturas_sunat_n integer, ultimo_cambio text, ultimo_cambio_fecha timestamptz,
  misma_oc_en_otra_carpeta text, cargado_en timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with l as materialized (
    select distinct on (l.oc) l.oc, l.area, l.comprador, l.situacion_pago, l.forma_pago
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select seguridad.puede_ver_todo())
     order by l.oc, l.cargado_en desc
  )
  select c.procedencia,
         coalesce(nullif(l.area, ''), case c.procedencia when 'Importación' then 'COMEX (importaciones)' else 'Compras nacionales' end),
         coalesce(nullif(l.comprador, ''), ''), coalesce(l.situacion_pago, ''), coalesce(l.forma_pago, ''),
         c.oc, c.tipo, c.proveedor, c.proyecto_carpeta, c.carpeta_nombre, c.carpeta_url, c.estado, c.le_falta,
         c.documentos, c.archivos, c.comprobantes, c.series, c.cc_codigo, c.cc_nombre, c.centro_costo_segun,
         c.en_cg, c.facturas_sunat, c.facturas_sunat_n, c.ultimo_cambio, c.ultimo_cambio_fecha,
         c.misma_oc_en_otra_carpeta, c.cargado_en
    from legajo_de_carpetas(p_empresa_ruc) c
    left join l on l.oc = c.oc
   order by c.procedencia desc, split_part(c.oc, '-', 2), c.oc, c.carpeta_url;
$$;

revoke execute on function carpetas_madre(text) from public, anon;
grant execute on function carpetas_madre(text) to authenticated;

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
    select c.*, (u.serie is not null) unida
      from cpe_comprobante c
      left join unidas u
        on u.proveedor_ruc = c.proveedor_ruc and u.tipo_comprobante = c.tipo_comprobante
       and u.serie = upper(c.serie) and u.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
     where c.empresa_ruc = p_empresa_ruc and c.origen = 'RECIBIDO' and c.tipo_comprobante = '01'
       and c.fecha_emision >= p_desde and (select seguridad.puede_ver_todo())
  ),
  -- Lo que se sabe de cada proveedor: cuántas facturas, cuántas con OC y
  -- quién suele comprarle (el área y el comprador más frecuentes).
  p as (
    select c.proveedor_ruc, count(*)::integer n, count(*) filter (where c.unida)::integer con_oc
      from c group by 1
  ),
  quien as (
    select distinct on (v.proveedor_ruc) v.proveedor_ruc, v.area, v.comprador
      from v where coalesce(v.comprador, v.area) is not null
     group by v.proveedor_ruc, v.area, v.comprador
     order by v.proveedor_ruc, count(*) desc
  ),
  -- Si el vínculo no sabe el área, la de la carpeta madre de sus OC.
  area_madre as (
    select v.proveedor_ruc,
           mode() within group (order by case k.procedencia when 'Importación' then 'COMEX (importaciones)' else 'Compras nacionales' end) area
      from v join oc_carpeta k on k.empresa_ruc = p_empresa_ruc and k.oc = v.oc
     group by 1
  ),
  ocs as (
    select v.proveedor_ruc, string_agg(distinct v.oc, ', ') lista from v group by 1
  ),
  s as (
    select c.*, p.n, p.con_oc,
           x.motivo manual,
           gasto_tipico_sin_oc(c.proveedor_nombre, c.proveedor_ruc, c.total) tipico,
           c.total * case when c.moneda = 'USD' then 3.75 else 1 end soles
      from c join p using (proveedor_ruc)
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
            s.soles desc;
$$;

revoke execute on function facturas_sin_oc(text, date) from public, anon;
grant execute on function facturas_sin_oc(text, date) to authenticated;
