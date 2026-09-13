-- Leer el histórico sin toparse con el límite de filas
--
-- PostgREST corta cualquier lectura en 1000 filas y no avisa: devuelve 200 y
-- mil registros. Con 13 083 comprobantes guardados, la pantalla decía «1000
-- comprobantes, 2 períodos» y la hoja se habría publicado con una fracción,
-- sin que nada fallara. Un tope silencioso es peor que un error.
--
-- La salida de estas funciones es UN valor —un jsonb—, no un conjunto de
-- filas, y a un valor no se le aplica ese tope. El formato de la hoja se
-- sigue armando en la aplicación, donde está probado; acá solo se reúne.
--
-- Además la consulta anterior expiraba: contar los cambios por comprobante
-- desde PostgREST, anidado, no aguantaba ese volumen. Agrupar una vez en SQL
-- y unir lo resuelve.

create or replace function periodos_de_comprobantes_sunat()
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select coalesce(
    jsonb_agg(jsonb_build_object('periodo', periodo, 'cuantos', n) order by periodo desc),
    '[]'::jsonb
  )
  from (
    select periodo, count(*) n
    from comprobantes_sunat
    group by periodo
  ) t;
$$;

comment on function periodos_de_comprobantes_sunat is
  'Períodos guardados con su conteo. Devuelve un solo valor para esquivar el límite de 1000 filas de PostgREST.';

/**
 * El histórico entero, listo para armar la hoja.
 *
 * `security invoker` a propósito: la política de comprobantes_sunat decide
 * quién ve qué, igual que en una lectura normal. Si esto fuera definer,
 * cualquiera con sesión leería el registro de compras completo.
 */
create or replace function historico_comprobantes_sunat(p_periodo text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with cambios as (
    select comprobante_id, count(*) n
    from cambios_comprobante_sunat
    group by comprobante_id
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
      'cambios',          coalesce(x.n, 0)
    ) as fila
    from comprobantes_sunat c
    left join cambios x on x.comprobante_id = c.id
    where p_periodo is null or c.periodo = p_periodo
  ) t;
$$;

comment on function historico_comprobantes_sunat is
  'Histórico completo como un solo valor. Sin esto, PostgREST devuelve 1000 filas de 13 000 sin avisar.';

revoke execute on function periodos_de_comprobantes_sunat() from public, anon;
revoke execute on function historico_comprobantes_sunat(text) from public, anon;
grant execute on function periodos_de_comprobantes_sunat() to authenticated;
grant execute on function historico_comprobantes_sunat(text) to authenticated;

-- La política se evaluaba una vez POR FILA
--
-- puede_ver_todo() es STABLE, pero en una política de RLS eso no basta:
-- Postgres la llama por cada fila salvo que se la envuelva en un select, que
-- la convierte en un InitPlan calculado una sola vez por consulta.
--
-- Con 13 083 comprobantes eso eran trece mil llamadas, y cada una consulta
-- roles_usuario cuatro veces. La lectura completa expiraba; después del
-- cambio tarda 1,3 segundos. Es el mismo arreglo que la migración 013 aplicó
-- a usuarios, que a estas tablas se pasó por alto al crearlas.

drop policy if exists comprobantes_sunat_lectura on comprobantes_sunat;
create policy comprobantes_sunat_lectura on comprobantes_sunat for select using (
  (select seguridad.puede_ver_todo())
);

drop policy if exists cambios_comprobante_sunat_lectura on cambios_comprobante_sunat;
create policy cambios_comprobante_sunat_lectura on cambios_comprobante_sunat for select using (
  (select seguridad.puede_ver_todo())
);

drop policy if exists consultas_sunat_lectura on consultas_sunat;
create policy consultas_sunat_lectura on consultas_sunat for select using (
  (select seguridad.puede_ver_todo())
);
