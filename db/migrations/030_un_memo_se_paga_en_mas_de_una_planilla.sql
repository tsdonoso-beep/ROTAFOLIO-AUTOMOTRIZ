-- Un memo se paga en más de una planilla: una por banco
--
-- El memo 594-2026 autoriza S/ 9,064.00 a once personas. La planilla de
-- haberes 1439 del BCP pagó S/ 5,292.00 a siete — las siete que tienen
-- cuenta BCP, que es de donde sale la planilla. Las cuatro restantes tienen
-- Interbank y su plata, S/ 3,772.00, salió por otra operación contra el CCI.
--
-- Leer una sola constancia y dar el memo por pagado deja a cuatro personas
-- esperando sin que nadie lo sepa. Hay que sumarlas hasta cubrir el memo, y
-- mientras no lo cubran, decir quién falta.
--
-- La constancia trae además el estado por fila: PROCESADA o RECHAZADA. Una
-- fila rechazada es alguien que NO cobró, y que por lo tanto no tiene nada
-- que rendir. Contarla como pagada es pedirle cuentas de una plata que
-- nunca recibió.

create table pagos (
  id           uuid primary key default gen_random_uuid(),
  memo_id      uuid not null references memos(id) on delete cascade,
  -- El banco de donde sale la planilla. Es lo que parte el pago en varios:
  -- una planilla de haberes paga a las cuentas de su propio banco.
  banco        text not null,
  -- El número de planilla de haberes, tal como lo imprime el banco. La del
  -- 594-2026 es la 1439.
  planilla     text,
  fecha        date,
  archivo_url  text,
  registrado_por uuid references usuarios(id),
  registrado_en  timestamptz not null default now()
);

comment on table pagos is
  'Una constancia de pago. Un memo tiene tantas como bancos haya entre sus beneficiarios.';

create index on pagos (memo_id);

create unique index pagos_planilla_unica
  on pagos (banco, planilla) where planilla is not null;

-- Una fila de la constancia: a quién, cuánto y si cobró.
create table pago_lineas (
  id         uuid primary key default gen_random_uuid(),
  pago_id    uuid not null references pagos(id) on delete cascade,
  usuario_id uuid not null references usuarios(id),
  monto      numeric(12,2) not null check (monto > 0),
  -- PROCESADA o RECHAZADA, como lo dice la constancia. Una rechazada no es
  -- plata entregada.
  procesada  boolean not null default true,
  motivo     text,
  unique (pago_id, usuario_id)
);

comment on column pago_lineas.procesada is
  'False es una fila rechazada: esa persona no cobró y no tiene nada que rendir.';

create index on pago_lineas (usuario_id);

-- Cuánto cobró de verdad cada persona de este memo. Solo las filas
-- procesadas: se calcula, no se guarda.
create or replace function cobrado_por_persona(p_memo_id uuid)
returns table (usuario_id uuid, cobrado numeric)
language sql stable security definer set search_path = public as $$
  select l.usuario_id, sum(l.monto)
  from pagos p
  join pago_lineas l on l.pago_id = p.id
  where p.memo_id = p_memo_id and l.procesada
  group by l.usuario_id
$$;

comment on function cobrado_por_persona(uuid) is
  'Lo que cada quien cobró de verdad. Las filas rechazadas no cuentan: esa plata no salió.';

revoke all on function cobrado_por_persona(uuid) from public;
grant execute on function cobrado_por_persona(uuid) to authenticated;

alter table pagos enable row level security;
alter table pago_lineas enable row level security;

create policy pagos_lectura on pagos for select
  using (
    seguridad.puede_ver_todo()
    or exists (
      select 1 from memo_asignados a
      where a.memo_id = pagos.memo_id
        and a.usuario_id = (select seguridad.usuario_actual())
    )
  );

create policy pagos_escritura on pagos for all
  using (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'))
  with check (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'));

create policy pago_lineas_lectura on pago_lineas for select
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.puede_ver_todo()
  );

create policy pago_lineas_escritura on pago_lineas for all
  using (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'))
  with check (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'));
