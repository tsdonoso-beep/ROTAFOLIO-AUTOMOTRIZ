-- 010 · La liquidación como el documento que cierra
--
-- Hasta acá ningún memo llegaba nunca a CERRADO. La transición
-- CONTABILIZADA → CERRADO estaba declarada como automática en la máquina de
-- estados y no había nada que la disparara: todo se quedaba en
-- CONTABILIZADA para siempre. Y el movimiento de plata —lo que la persona
-- devuelve o lo que se le reembolsa— no se registraba en ningún lado, así
-- que la pantalla de liquidación mostraba el mismo neto un día tras otro
-- sin que nada dijera si ya se había pagado. En un documento que va a
-- pago, eso es pagar dos veces.
--
-- Finanzas paga por persona y todo junto: se netea lo que debe contra lo
-- que se le debe y se hace un solo movimiento. Entonces la liquidación no
-- es un reporte, es el documento que cierra, y los memos se cierran cuando
-- la liquidación que los incluye se paga.
--
-- Dos cosas que conviene tener presentes:
--
-- 1. Los números se congelan al emitir. Después de emitida, que alguien
--    apruebe otro gasto no cambia lo que se mandó a pagar. Es lo mismo que
--    se hizo con el visto bueno del jefe, y por lo mismo: un documento de
--    pago tiene que decir por cuánto fue.
--
-- 2. Un memo grupal pertenece a cada persona asignada, así que el mismo
--    memo aparece legítimamente en varias liquidaciones. El candado contra
--    pagar dos veces es por persona, no por memo. (Que un memo compartido
--    se cuente entero en la liquidación de cada uno es una pregunta de
--    modelo anterior a esto y sigue abierta.)

create table if not exists liquidaciones (
  id            uuid primary key default gen_random_uuid(),
  usuario_id    uuid not null references usuarios(id),

  -- Congelados al emitir. Positivo: la persona devuelve. Negativo: la
  -- empresa le reembolsa.
  neto          numeric(12,2) not null,
  autorizado    numeric(12,2) not null,
  rendido       numeric(12,2) not null,

  estado        text not null default 'EMITIDA'
                  check (estado in ('EMITIDA','PAGADA','ANULADA')),
  emitida_por   uuid not null references usuarios(id),
  emitida_en    timestamptz not null default now(),

  -- Cómo se movió la plata: número de operación, voucher, lo que sea que
  -- permita encontrarlo después.
  referencia    text,
  pagada_por    uuid references usuarios(id),
  pagada_en     timestamptz,
  observacion   text
);

create index if not exists liquidaciones_persona
  on liquidaciones (usuario_id, estado);

create table if not exists liquidacion_memos (
  liquidacion_id uuid not null references liquidaciones(id) on delete cascade,
  memo_id        uuid not null references memos(id),
  autorizado     numeric(12,2) not null,
  rendido        numeric(12,2) not null,
  saldo          numeric(12,2) not null,
  primary key (liquidacion_id, memo_id)
);

create index if not exists liquidacion_memos_memo on liquidacion_memos (memo_id);

alter table liquidaciones     enable row level security;
alter table liquidacion_memos enable row level security;

-- ── Quién ve qué ──
--
-- La persona ve las suyas: es plata de ella y debería poder consultarla
-- sin pedirle una captura de pantalla a nadie.
drop policy if exists liquidaciones_lectura on liquidaciones;
create policy liquidaciones_lectura on liquidaciones for select using (
  usuario_id = seguridad.usuario_actual()
  or seguridad.es_mi_reporte(usuario_id)
  or seguridad.puede_ver_todo()
);

drop policy if exists liquidacion_memos_lectura on liquidacion_memos;
create policy liquidacion_memos_lectura on liquidacion_memos for select using (
  exists (
    select 1 from liquidaciones l
    where l.id = liquidacion_id
      and (
        l.usuario_id = seguridad.usuario_actual()
        or seguridad.es_mi_reporte(l.usuario_id)
        or seguridad.puede_ver_todo()
      )
  )
);

-- ════════════════════════════════════════════════════════════════
-- El candado contra pagar dos veces
--
-- Vive en un disparador y no en la función que emite, para que valga
-- también si alguien inserta por otro camino.

create or replace function public.verificar_memo_no_liquidado()
returns trigger
language plpgsql
as $$
declare
  v_persona uuid;
  v_choque text;
begin
  select usuario_id into v_persona from liquidaciones where id = new.liquidacion_id;

  select l.id::text into v_choque
  from liquidacion_memos lm
  join liquidaciones l on l.id = lm.liquidacion_id
  where lm.memo_id = new.memo_id
    and l.usuario_id = v_persona
    and l.estado <> 'ANULADA'
    and l.id <> new.liquidacion_id
  limit 1;

  if v_choque is not null then
    raise exception 'Ese memo ya está en otra liquidación vigente de la misma persona (%).', v_choque;
  end if;

  return new;
end;
$$;

drop trigger if exists liquidacion_memos_sin_repetir on liquidacion_memos;
create trigger liquidacion_memos_sin_repetir
  before insert on liquidacion_memos
  for each row execute function public.verificar_memo_no_liquidado();

-- ════════════════════════════════════════════════════════════════
-- Emitir
--
-- Los montos se calculan acá y no se reciben del navegador: es un
-- documento de pago. La regla es la misma que la de la aplicación —cuentan
-- los memos ya revisados, y dentro de ellos los gastos que suman al
-- total—, y hay una prueba que compara las dos.

create or replace function public.emitir_liquidacion(
  p_usuario uuid, p_memos uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  yo uuid := seguridad.usuario_actual();
  v_liq uuid;
  v_autorizado numeric(12,2) := 0;
  v_rendido numeric(12,2) := 0;
  m record;
begin
  if yo is null then
    raise exception 'Sesión no válida.';
  end if;

  if not (
    seguridad.tiene_rol('CONTABILIDAD') or seguridad.tiene_rol('REVISOR_COSTOS')
    or seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA')
  ) then
    raise exception 'Tu rol no puede emitir liquidaciones.';
  end if;

  if p_memos is null or array_length(p_memos, 1) is null then
    raise exception 'No hay rendiciones cerradas que liquidar.';
  end if;

  insert into liquidaciones (usuario_id, neto, autorizado, rendido, emitida_por)
  values (p_usuario, 0, 0, 0, yo)
  returning id into v_liq;

  for m in
    select mm.id, mm.monto_autorizado,
           coalesce((
             select sum(g.total) from gastos g
             where g.memo_id = mm.id
               and g.estado in ('EXTRAIDO','CON_ALERTA','VALIDADO','PRESENTADO','APROBADO','CONTABILIZADO')
           ), 0) as rendido
    from memos mm
    where mm.id = any(p_memos)
      and mm.estado in ('APROBADA','CONTABILIZADA','CERRADO')
      and exists (
        select 1 from memo_asignados ma
        where ma.memo_id = mm.id and ma.usuario_id = p_usuario
      )
  loop
    insert into liquidacion_memos (liquidacion_id, memo_id, autorizado, rendido, saldo)
    values (v_liq, m.id, m.monto_autorizado, m.rendido, m.monto_autorizado - m.rendido);

    v_autorizado := v_autorizado + m.monto_autorizado;
    v_rendido    := v_rendido + m.rendido;
  end loop;

  if not exists (select 1 from liquidacion_memos where liquidacion_id = v_liq) then
    delete from liquidaciones where id = v_liq;
    raise exception 'Ninguna de esas rendiciones se puede liquidar todavía.';
  end if;

  update liquidaciones
  set autorizado = v_autorizado,
      rendido    = v_rendido,
      neto       = v_autorizado - v_rendido
  where id = v_liq;

  return v_liq;
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- Cerrar lo que ya no tiene nada pendiente
--
-- Un memo se cierra cuando está contabilizado Y todas las personas que lo
-- tienen asignado ya cobraron o pagaron su liquidación. Lo segundo importa
-- por los memos grupales: cerrar con una sola liquidación pagada dejaría
-- al resto del equipo con un memo cerrado que todavía no le saldaron.

create or replace function public.cerrar_memos_saldados(p_liquidacion uuid)
returns int
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  v_cerrados int;
begin
  with candidatos as (
    select lm.memo_id
    from liquidacion_memos lm
    where lm.liquidacion_id = p_liquidacion
  ),
  cerrables as (
    select c.memo_id
    from candidatos c
    join memos m on m.id = c.memo_id
    where m.estado = 'CONTABILIZADA'
      and not exists (
        select 1 from memo_asignados ma
        where ma.memo_id = c.memo_id
          and not exists (
            select 1
            from liquidacion_memos lm2
            join liquidaciones l2 on l2.id = lm2.liquidacion_id
            where lm2.memo_id = c.memo_id
              and l2.usuario_id = ma.usuario_id
              and l2.estado = 'PAGADA'
          )
      )
  )
  update memos set estado = 'CERRADO'
  where id in (select memo_id from cerrables);

  get diagnostics v_cerrados = row_count;
  return v_cerrados;
end;
$$;

-- ════════════════════════════════════════════════════════════════
-- Registrar el pago

create or replace function public.registrar_pago_liquidacion(
  p_liquidacion uuid, p_referencia text, p_observacion text
)
returns boolean
language plpgsql
security definer
set search_path = public, seguridad
as $$
declare
  yo uuid := seguridad.usuario_actual();
  l record;
begin
  if yo is null then
    raise exception 'Sesión no válida.';
  end if;

  if not (seguridad.tiene_rol('CONTABILIDAD') or seguridad.tiene_rol('ADMIN_SISTEMA')) then
    raise exception 'Solo Contabilidad registra el movimiento de plata.';
  end if;

  select * into l from liquidaciones where id = p_liquidacion;
  if not found then
    raise exception 'La liquidación no existe.';
  end if;

  if l.estado <> 'EMITIDA' then
    raise exception 'Esta liquidación ya está en estado %.', l.estado;
  end if;

  -- Sin referencia no hay forma de encontrar el movimiento después, que es
  -- justamente para lo que sirve registrarlo.
  if nullif(trim(coalesce(p_referencia, '')), '') is null then
    raise exception 'Falta la referencia del movimiento (operación, voucher o similar).';
  end if;

  update liquidaciones
  set estado      = 'PAGADA',
      referencia  = trim(p_referencia),
      observacion = nullif(trim(coalesce(p_observacion, '')), ''),
      pagada_por  = yo,
      pagada_en   = now()
  where id = p_liquidacion;

  perform public.cerrar_memos_saldados(p_liquidacion);
  return true;
end;
$$;

-- Contabilizar un memo que ya estaba saldado también lo cierra: si no, el
-- orden de los pasos decidiría si un memo termina o se queda colgado.

create or replace function public.cerrar_al_contabilizar()
returns trigger
language plpgsql
security definer
set search_path = public, seguridad
as $$
begin
  if new.estado = 'CONTABILIZADA' and old.estado <> 'CONTABILIZADA' then
    if not exists (
      select 1 from memo_asignados ma
      where ma.memo_id = new.id
        and not exists (
          select 1
          from liquidacion_memos lm
          join liquidaciones l on l.id = lm.liquidacion_id
          where lm.memo_id = new.id
            and l.usuario_id = ma.usuario_id
            and l.estado = 'PAGADA'
        )
    ) and exists (select 1 from memo_asignados where memo_id = new.id)
    then
      new.estado := 'CERRADO';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists memos_cerrar_al_contabilizar on memos;
create trigger memos_cerrar_al_contabilizar
  before update on memos
  for each row execute function public.cerrar_al_contabilizar();

-- ════════════════════════════════════════════════════════════════
-- Quién puede llamarlas

revoke execute on function public.emitir_liquidacion(uuid, uuid[]) from public, anon;
revoke execute on function public.registrar_pago_liquidacion(uuid, text, text) from public, anon;
revoke execute on function public.cerrar_memos_saldados(uuid) from public, anon;

grant execute on function public.emitir_liquidacion(uuid, uuid[]) to authenticated;
grant execute on function public.registrar_pago_liquidacion(uuid, text, text) to authenticated;
