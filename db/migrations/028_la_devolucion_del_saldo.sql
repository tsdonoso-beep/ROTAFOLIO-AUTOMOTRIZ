-- La devolución del saldo, que hoy vive en una captura de pantalla
--
-- Wilmer Zamora recibió S/ 212.00, rindió S/ 201.80 y devolvió S/ 10.20 con
-- la operación 10394730 del 27/08 a las 12:08. La transferencia la hace la
-- persona desde su propia cuenta de ahorros a la de la empresa, y manda la
-- captura por WhatsApp. Ahí muere: no hay dónde anotarla, así que el memo
-- queda para siempre con un saldo pendiente que ya se pagó.
--
-- Va por persona y no por memo porque el saldo es de cada quien: en el
-- 594-2026 hay once saldos distintos, y que uno devuelva no salda a los
-- demás.
--
-- No confundir con el reembolso: acá la plata vuelve a la empresa. El
-- seguimiento de Control de Gestión las llama «devolución de saldo» y
-- «reintegro de efectivo», y las dos son esto.

create table devoluciones (
  id             uuid primary key default gen_random_uuid(),
  memo_id        uuid not null references memos(id) on delete cascade,
  usuario_id     uuid not null references usuarios(id),
  monto          numeric(12,2) not null check (monto > 0),
  -- El número de operación es el comprobante del banco. Texto, porque
  -- puede traer ceros delante y no es una cuenta nuestra.
  operacion      text,
  fecha          date not null,
  -- La captura. Es lo único que hoy existe del hecho.
  imagen_url     text,
  nota           text,
  registrado_por uuid references usuarios(id),
  registrado_en  timestamptz not null default now()
);

comment on table devoluciones is
  'Plata que vuelve a la empresa. Va por persona: en un memo de cuadrilla hay un saldo por cada quien.';
comment on column devoluciones.operacion is
  'El número de operación del banco, como lo imprime la constancia.';

create index on devoluciones (memo_id);
create index on devoluciones (usuario_id);

-- Dos veces la misma operación es la misma captura subida dos veces, y
-- suma un saldo que solo volvió una vez.
create unique index devoluciones_operacion_unica
  on devoluciones (operacion) where operacion is not null;

alter table devoluciones enable row level security;

create policy devoluciones_lectura on devoluciones for select
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.puede_ver_todo()
  );

-- La persona registra la suya: es ella quien tiene la captura. Quien
-- administra puede registrarla por cualquiera, porque a veces la captura
-- llega por WhatsApp y la sube Administración.
create policy devoluciones_escritura on devoluciones for all
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  )
  with check (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  );

-- Cuánto se le devolvió ya a la empresa por este memo, por persona. Se
-- calcula; un acumulado guardado es un número que alguien tiene que
-- acordarse de actualizar.
create or replace function devuelto_por_persona(p_memo_id uuid)
returns table (usuario_id uuid, devuelto numeric)
language sql stable security definer set search_path = public as $$
  select d.usuario_id, sum(d.monto)
  from devoluciones d
  where d.memo_id = p_memo_id
  group by d.usuario_id
$$;

revoke all on function devuelto_por_persona(uuid) from public;
grant execute on function devuelto_por_persona(uuid) to authenticated;
