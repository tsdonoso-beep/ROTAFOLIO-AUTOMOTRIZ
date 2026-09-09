-- 008 · Que el rendidor pueda presentar, y que exista la caja chica
--
-- Dos cosas que salieron de probar el flujo contra la base real.
--
-- 1. Presentar una rendición no funcionaba para un RENDIDOR, y peor: fallaba
--    en silencio. La política `memos_escritura` solo deja escribir memos a
--    ADMIN_MEMOS y ADMIN_SISTEMA, así que el update del rendidor no daba
--    error —simplemente afectaba cero filas—. La app decía "Rendición
--    presentada. Pasó a revisión." mientras el memo seguía igual.
--
-- 2. Caja chica necesita crear un memo, y crear memos está igual de cerrado.
--
-- La salida no es abrir `memos_escritura`. Las políticas de fila son todo o
-- nada sobre la fila: si dejamos que un rendidor haga UPDATE sobre su memo,
-- también puede subirse su propio `monto_autorizado`. Lo que hace falta es
-- permitir *operaciones* concretas, no columnas, y eso en Postgres son
-- funciones SECURITY DEFINER: corren con los privilegios del dueño y ellas
-- mismas comprueban quién llama y qué puede hacer.
--
-- Por eso las dos funciones vuelven a verificar la identidad con
-- seguridad.usuario_actual() en vez de confiar en el argumento.

-- ════════════════════════════════════════════════════════════════
-- Presentar una rendición

create or replace function public.presentar_memo(p_memo uuid)
returns boolean
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  yo uuid := seguridad.usuario_actual();
  estado_actual estado_memo;
begin
  if yo is null then
    raise exception 'Sesión no válida.';
  end if;

  select estado into estado_actual from memos where id = p_memo;
  if not found then
    raise exception 'El memo no existe.';
  end if;

  if not exists (
    select 1 from memo_asignados
    where memo_id = p_memo and usuario_id = yo
  ) then
    raise exception 'Solo puedes presentar una rendición que te asignaron.';
  end if;

  if estado_actual not in ('ABIERTO', 'EN_RENDICION', 'OBSERVADA') then
    raise exception 'Una rendición en estado % ya no se puede presentar.', estado_actual;
  end if;

  update memos
  set estado = 'PRESENTADA',
      presentado_en = now(),
      observacion_actual = null
  where id = p_memo;

  update gastos
  set estado = 'PRESENTADO'
  where memo_id = p_memo
    and estado in ('VALIDADO', 'CON_ALERTA', 'EXTRAIDO');

  return true;
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- Crear la caja chica a partir de gastos sueltos
--
-- El proceso invertido que describió Franco: los comprobantes existen antes
-- que el memo, y el memo se crea recién cuando la persona los junta y los
-- presenta.

create or replace function public.crear_caja_chica(
  p_centro uuid, p_gastos uuid[], p_descripcion text
)
returns uuid
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  yo uuid := seguridad.usuario_actual();
  v_empresa uuid;
  v_abrev text;
  v_sec bigint;
  v_correlativo text;
  v_memo uuid;
  v_desde date;
  v_hasta date;
  v_ajenos int;
begin
  if yo is null then
    raise exception 'Sesión no válida.';
  end if;

  if p_gastos is null or array_length(p_gastos, 1) is null then
    raise exception 'No seleccionaste ningún comprobante.';
  end if;

  -- Los gastos tienen que ser suyos, estar sueltos y no venir ya presentados.
  select count(*) into v_ajenos
  from gastos g
  where g.id = any(p_gastos)
    and (
      g.usuario_id <> yo
      or g.memo_id is not null
      or g.estado not in ('CAPTURADO','EXTRAIDO','ERROR_EXTRACCION','CON_ALERTA','VALIDADO')
    );

  if v_ajenos > 0 then
    raise exception 'Alguno de los comprobantes no es tuyo, ya pertenece a un memo o ya fue presentado.';
  end if;

  if (select count(*) from gastos where id = any(p_gastos)) <> array_length(p_gastos, 1) then
    raise exception 'No se encontraron todos los comprobantes.';
  end if;

  select empresa_id into v_empresa from centros_costo where id = p_centro;
  if v_empresa is null then
    raise exception 'El centro de costo no existe.';
  end if;
  select abreviatura into v_abrev from empresas where id = v_empresa;

  select min(fecha_emision), max(fecha_emision) into v_desde, v_hasta
  from gastos where id = any(p_gastos);

  v_sec := siguiente_correlativo(v_empresa, extract(year from now())::int, 'CAJA_CHICA');
  v_correlativo := coalesce(v_abrev, 'EMP') || '-' || extract(year from now())::int
                   || '-CCH-' || lpad(v_sec::text, 5, '0');

  -- El monto autorizado va en cero y no es un dato faltante: en caja chica
  -- nadie entregó plata por adelantado, así que todo lo rendido es un
  -- reembolso hacia la persona.
  insert into memos (
    correlativo, tipo, empresa_id, centro_costo_id, destino,
    fecha_salida, fecha_retorno_prev, monto_autorizado, estado, creado_por
  ) values (
    v_correlativo, 'CAJA_CHICA', v_empresa, p_centro,
    nullif(trim(coalesce(p_descripcion, '')), ''),
    v_desde, v_hasta, 0, 'EN_RENDICION', yo
  )
  returning id into v_memo;

  insert into memo_asignados (memo_id, usuario_id) values (v_memo, yo);

  update gastos set memo_id = v_memo where id = any(p_gastos);

  return v_memo;
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- Quién puede llamarlas
--
-- Se revoca antes de conceder por dos motivos distintos: Postgres da EXECUTE
-- a `public` por defecto al crear una función, y Supabase además concede a
-- `anon` —el visitante sin sesión— sobre todo lo que aparece en el esquema
-- public. Ninguna de las dos podría hacer daño real, porque sin sesión
-- seguridad.usuario_actual() devuelve null y la función aborta en la primera
-- línea; pero una función que ni siquiera se puede invocar es una superficie
-- menos que revisar.

revoke execute on function public.presentar_memo(uuid) from public, anon;
revoke execute on function public.crear_caja_chica(uuid, uuid[], text) from public, anon;

grant execute on function public.presentar_memo(uuid) to authenticated;
grant execute on function public.crear_caja_chica(uuid, uuid[], text) to authenticated;
