-- 011 · Que cada rol pueda hacer lo suyo, y que se note cuando no
--
-- Tercera vez que aparece el mismo problema, así que esta vez se arregla la
-- clase entera en lugar del caso.
--
-- `memos_escritura` solo deja escribir memos a ADMIN_MEMOS y ADMIN_SISTEMA.
-- Una política de fila que no se cumple no da error: filtra. El update
-- afecta cero filas, PostgREST responde 200, y la aplicación informa que
-- todo salió bien. Ya había pasado con presentar una rendición. Probando la
-- liquidación apareció que pasaba también con Contabilidad:
--
--   Rosa (CONTABILIDAD)  APROBADA → CONTABILIZADA   0 filas, sin error
--   Rosa (CONTABILIDAD)  APROBADA → OBSERVADA       0 filas, sin error
--
-- Es decir que Contabilidad nunca pudo contabilizar. No se había notado
-- porque Alonzo, que es quien venía probando, además de REVISOR_COSTOS es
-- ADMIN_MEMOS, y por eso a él sí le funcionaba.
--
-- La salida no es abrir `memos_escritura`: las políticas de fila son todo o
-- nada sobre la fila, así que dejar que Contabilidad haga UPDATE también le
-- permitiría cambiar el monto autorizado. Lo que hace falta es autorizar
-- transiciones concretas, y eso es una función que corre con los
-- privilegios del dueño y comprueba ella misma quién llama.
--
-- La tabla de transiciones se guarda como datos y no como condicionales,
-- igual que en la aplicación. Son dos copias de la misma verdad —una en
-- TypeScript, otra en SQL— y eso se paga con una prueba que las compara:
-- lib/dominio/__tests__/transiciones.test.ts lee este archivo y falla si
-- se separan.

create table if not exists transiciones_memo (
  desde   estado_memo not null,
  hacia   estado_memo not null,
  roles   rol_usuario[] not null,
  primary key (desde, hacia)
);

comment on table transiciones_memo is
  'Espejo de TRANSICIONES_MEMO en lib/dominio/estados.ts. Una prueba compara las dos tablas para que no se separen.';

alter table transiciones_memo enable row level security;

-- Es un catálogo: saber qué transiciones existen no revela nada.
drop policy if exists transiciones_lectura on transiciones_memo;
create policy transiciones_lectura on transiciones_memo for select using (true);

delete from transiciones_memo;
insert into transiciones_memo (desde, hacia, roles) values
  ('BORRADOR',      'ABIERTO',       '{ADMIN_MEMOS,ADMIN_SISTEMA}'),
  ('BORRADOR',      'ANULADO',       '{ADMIN_MEMOS,ADMIN_SISTEMA}'),
  ('ABIERTO',       'ANULADO',       '{ADMIN_MEMOS,ADMIN_SISTEMA}'),
  ('EN_RENDICION',  'PRESENTADA',    '{RENDIDOR,ADMIN_MEMOS,ADMIN_SISTEMA}'),
  ('EN_RENDICION',  'ANULADO',       '{ADMIN_MEMOS,ADMIN_SISTEMA}'),
  ('PRESENTADA',    'OBSERVADA',     '{REVISOR_COSTOS,CONTABILIDAD,ADMIN_SISTEMA}'),
  ('PRESENTADA',    'APROBADA',      '{REVISOR_COSTOS,ADMIN_SISTEMA}'),
  ('OBSERVADA',     'EN_RENDICION',  '{RENDIDOR,ADMIN_MEMOS,ADMIN_SISTEMA}'),
  ('APROBADA',      'OBSERVADA',     '{CONTABILIDAD,ADMIN_SISTEMA}'),
  ('APROBADA',      'CONTABILIZADA', '{CONTABILIDAD,ADMIN_SISTEMA}');

-- Las dos transiciones automáticas (ABIERTO → EN_RENDICION al cargar el
-- primer gasto, CONTABILIZADA → CERRADO al saldar la liquidación) no están
-- acá a propósito: no las pide una persona, así que no tienen roles.

create or replace function public.cambiar_estado_memo(
  p_memo uuid, p_hacia estado_memo, p_observacion text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  yo uuid := seguridad.usuario_actual();
  v_desde estado_memo;
  v_roles rol_usuario[];
  v_permitido boolean;
begin
  if yo is null then
    raise exception 'Sesion no valida.';
  end if;

  select estado into v_desde from memos where id = p_memo;
  if not found then
    raise exception 'El memo no existe.';
  end if;

  -- Pedir el estado que ya tiene no es un error: es una doble pulsación.
  if v_desde = p_hacia then
    return true;
  end if;

  select roles into v_roles from transiciones_memo where desde = v_desde and hacia = p_hacia;
  if v_roles is null then
    raise exception 'No se puede pasar de % a %.', v_desde, p_hacia;
  end if;

  select exists (
    select 1 from roles_usuario ru
    where ru.usuario_id = yo and ru.rol = any(v_roles)
  ) into v_permitido;

  if not v_permitido then
    raise exception 'Tu rol no permite pasar el memo a %.', p_hacia;
  end if;

  update memos
  set estado = p_hacia,
      aprobado_por = case when p_hacia = 'APROBADA' then yo else aprobado_por end,
      aprobado_en  = case when p_hacia = 'APROBADA' then now() else aprobado_en end,
      contabilizado_en = case when p_hacia = 'CONTABILIZADA' then now() else contabilizado_en end,
      observacion_actual = case
        when p_hacia = 'OBSERVADA' then nullif(trim(coalesce(p_observacion, '')), '')
        when p_hacia in ('EN_RENDICION','APROBADA','CONTABILIZADA') then null
        else observacion_actual
      end
  where id = p_memo;

  -- Los gastos acompañan al memo en la misma llamada. Estaba suelto en la
  -- acción del servidor, y así el memo podía quedar aprobado con sus gastos
  -- todavía en PRESENTADO si algo fallaba entre las dos escrituras.
  if p_hacia = 'APROBADA' then
    update gastos set estado = 'APROBADO'
    where memo_id = p_memo and estado = 'PRESENTADO';
  elsif p_hacia = 'CONTABILIZADA' then
    update gastos set estado = 'CONTABILIZADO'
    where memo_id = p_memo and estado = 'APROBADO';
  end if;

  return true;
end;
$$;

revoke execute on function public.cambiar_estado_memo(uuid, estado_memo, text) from public, anon;
grant execute on function public.cambiar_estado_memo(uuid, estado_memo, text) to authenticated;
