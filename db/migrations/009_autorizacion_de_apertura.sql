-- 009 · El visto bueno del jefe para abrir plata nueva
--
-- §7.3 dice que no se le entrega un memo nuevo a quien no rindió el
-- anterior. La regla ya se evalúa (migración anterior la conectó), pero
-- faltaba la salida: qué pasa cuando igual hay que abrirlo.
--
-- La decisión del equipo fue que la excepción la da el jefe, y que le
-- llegue como una solicitud en vez de ser una casilla que marca quien
-- redacta el memo. Es la diferencia entre una firma y un formulario que
-- dice que alguien firmó.
--
-- Tres cosas que valen la pena explicar:
--
-- 1. La solicitud se cuenta a sí misma. Guarda el correlativo, el monto,
--    el destino y el motivo en el momento de pedirla. El jefe no puede
--    leer el memo —un BORRADOR no es visible para él, y está bien: un memo
--    sin abrir todavía no es un compromiso de nadie—, pero sobre todo
--    porque así queda registrado QUÉ autorizó. Si después alguien cambia
--    el monto del borrador, el visto bueno sigue diciendo por cuánto fue.
--
-- 2. La apertura la impide un disparador, no la aplicación. Un ADMIN_MEMOS
--    ya puede escribir memos: si el control viviera solo en la acción del
--    servidor, bastaría llamar a la API directamente para saltárselo.
--
-- 3. Una sola solicitud por memo y por jefe. Si el memo va para tres
--    personas que reportan al mismo jefe, es una sola pregunta.

create table if not exists autorizaciones_memo (
  id              uuid primary key default gen_random_uuid(),
  memo_id         uuid not null references memos(id) on delete cascade,
  jefe_id         uuid not null references usuarios(id),
  solicitada_por  uuid not null references usuarios(id),

  -- Lo que el jefe está autorizando, congelado al momento de pedirlo.
  correlativo     text not null,
  monto           numeric(12,2) not null,
  destino         text,
  motivo          text not null,

  estado          text not null default 'PENDIENTE'
                    check (estado in ('PENDIENTE','CONCEDIDA','RECHAZADA')),
  respuesta       text,
  resuelta_por    uuid references usuarios(id),
  resuelta_en     timestamptz,
  creado_en       timestamptz not null default now(),

  unique (memo_id, jefe_id)
);

create index if not exists autorizaciones_memo_jefe
  on autorizaciones_memo (jefe_id, estado);

alter table autorizaciones_memo enable row level security;

-- ── Quién ve qué ──
--
-- El jefe ve lo que le toca decidir; quien administra memos ve todo para
-- saber en qué quedó lo que pidió.
drop policy if exists autorizaciones_lectura on autorizaciones_memo;
create policy autorizaciones_lectura on autorizaciones_memo for select using (
  jefe_id = seguridad.usuario_actual()
  or solicitada_por = seguridad.usuario_actual()
  or seguridad.tiene_rol('ADMIN_MEMOS')
  or seguridad.tiene_rol('ADMIN_SISTEMA')
);

-- Nadie escribe directo: se pasa por las funciones de abajo, que son las
-- que comprueban el estado y la identidad. Las políticas de fila no saben
-- restringir columnas, y acá importa que un jefe no pueda mover la
-- solicitud a otro memo ni cambiar el monto que está autorizando.

-- ════════════════════════════════════════════════════════════════
-- Pedir el visto bueno

create or replace function public.solicitar_autorizacion_memo(
  p_memo uuid, p_jefes uuid[], p_motivo text
)
returns int
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  yo uuid := seguridad.usuario_actual();
  m record;
  v_jefe uuid;
  v_creadas int := 0;
begin
  if yo is null then
    raise exception 'Sesión no válida.';
  end if;

  if not (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA')) then
    raise exception 'Tu rol no puede pedir autorizaciones de apertura.';
  end if;

  select correlativo, monto_autorizado, destino, estado
    into m from memos where id = p_memo;
  if not found then
    raise exception 'El memo no existe.';
  end if;

  if m.estado <> 'BORRADOR' then
    raise exception 'Solo un memo en borrador puede quedar a la espera del visto bueno.';
  end if;

  foreach v_jefe in array coalesce(p_jefes, '{}')
  loop
    -- Si ya se le preguntó a este jefe por este memo, no se le vuelve a
    -- preguntar: la respuesta anterior sigue valiendo.
    insert into autorizaciones_memo (
      memo_id, jefe_id, solicitada_por, correlativo, monto, destino, motivo
    ) values (
      p_memo, v_jefe, yo, m.correlativo, m.monto_autorizado, m.destino,
      coalesce(nullif(trim(p_motivo), ''), 'Rendiciones vencidas.')
    )
    on conflict (memo_id, jefe_id) do nothing;

    if found then v_creadas := v_creadas + 1; end if;
  end loop;

  return v_creadas;
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- Responder

create or replace function public.responder_autorizacion_memo(
  p_autorizacion uuid, p_conceder boolean, p_respuesta text
)
returns boolean
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  yo uuid := seguridad.usuario_actual();
  a record;
begin
  if yo is null then
    raise exception 'Sesión no válida.';
  end if;

  select * into a from autorizaciones_memo where id = p_autorizacion;
  if not found then
    raise exception 'La solicitud no existe.';
  end if;

  -- Se responde solo lo propio. Un ADMIN_SISTEMA tampoco contesta por otro:
  -- el sentido de esto es que la firma sea de quien decide.
  if a.jefe_id <> yo then
    raise exception 'Esta solicitud no es tuya.';
  end if;

  if a.estado <> 'PENDIENTE' then
    raise exception 'Esta solicitud ya fue respondida (%).', a.estado;
  end if;

  update autorizaciones_memo
  set estado      = case when p_conceder then 'CONCEDIDA' else 'RECHAZADA' end,
      respuesta   = nullif(trim(coalesce(p_respuesta, '')), ''),
      resuelta_por = yo,
      resuelta_en = now()
  where id = p_autorizacion;

  return true;
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- El candado sobre la apertura
--
-- Vive en la base y no en la aplicación: quien administra memos ya puede
-- escribirlos, así que un control que solo estuviera en la acción del
-- servidor se saltaría llamando a la API directamente.

create or replace function public.verificar_autorizacion_apertura()
returns trigger
language plpgsql
as $$
declare
  v_pendientes int;
  v_rechazadas int;
  v_firmado numeric(12,2);
begin
  if old.estado = 'BORRADOR' and new.estado = 'ABIERTO' then
    select
      count(*) filter (where estado = 'PENDIENTE'),
      count(*) filter (where estado = 'RECHAZADA'),
      max(monto) filter (where estado = 'CONCEDIDA')
    into v_pendientes, v_rechazadas, v_firmado
    from autorizaciones_memo where memo_id = new.id;

    if v_rechazadas > 0 then
      raise exception 'Jefatura rechazó la apertura de este memo.';
    end if;
    if v_pendientes > 0 then
      raise exception 'Este memo espera el visto bueno de Jefatura.';
    end if;

    -- El visto bueno vale por el monto que se firmó, no por el memo.
    -- Sin esto, la solicitud sería una constancia y no un control: se pide
    -- autorización por S/ 800, se concede, y después se abre por S/ 5000.
    if v_firmado is not null and v_firmado <> new.monto_autorizado then
      raise exception 'Jefatura autorizó S/ %, y el memo ahora dice S/ %. Vuelve a pedir el visto bueno.',
        to_char(v_firmado, 'FM999999990.00'), to_char(new.monto_autorizado, 'FM999999990.00');
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists memos_autorizacion_apertura on memos;
create trigger memos_autorizacion_apertura
  before update on memos
  for each row execute function public.verificar_autorizacion_apertura();

-- ════════════════════════════════════════════════════════════════
-- Quién puede llamarlas

revoke execute on function public.solicitar_autorizacion_memo(uuid, uuid[], text) from public, anon;
revoke execute on function public.responder_autorizacion_memo(uuid, boolean, text) from public, anon;

grant execute on function public.solicitar_autorizacion_memo(uuid, uuid[], text) to authenticated;
grant execute on function public.responder_autorizacion_memo(uuid, boolean, text) to authenticated;
