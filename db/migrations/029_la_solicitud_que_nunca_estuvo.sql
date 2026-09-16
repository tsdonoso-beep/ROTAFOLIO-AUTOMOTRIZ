-- La solicitud: el primer paso del flujo, que vivía fuera de todo sistema
--
-- Hasta acá la aplicación empezaba en el memo, y el memo lo crea
-- Administración. Pero el proceso real no empieza ahí:
--
--   «el personal solicita el memo, internamente le pide su autorización a su
--    jefatura, y la jefatura lo comunica para que se pueda aprobar»
--
-- Esa autorización ocurría «por fuera de todo sistema, en una conversación
-- que no deja rastro», y una de dos personas la convertía en memo. El
-- resultado es que la aplicación no sabía por qué existe cada memo ni quién
-- lo pidió: solo quién lo tecleó.
--
-- Una solicitud NO es un memo todavía. No tiene correlativo, no compromete
-- plata y no aparece en la contabilidad. Es un pedido con un visto bueno, y
-- por eso vive en su propia tabla en vez de como un estado más de `memos`:
-- un memo rechazado que nunca existió no debería consumir un correlativo.

create type estado_solicitud as enum (
  'PENDIENTE',    -- esperando a la jefatura
  'APROBADA',     -- la jefatura dio el visto bueno; falta emitir el memo
  'RECHAZADA',
  'CONVERTIDA',   -- ya es un memo
  'ANULADA'       -- la retiró quien la pidió
);

create table solicitudes_memo (
  id              uuid primary key default gen_random_uuid(),
  tipo            tipo_memo not null,
  centro_costo_id uuid not null references centros_costo(id),

  -- Quién lo pide. Puede ser el propio interesado o su jefatura pidiendo
  -- por su gente; las dos cosas pasan.
  solicitante_id  uuid not null references usuarios(id),
  -- A quién le toca dar el visto bueno. Se congela al crear la solicitud:
  -- si mañana cambia la jefatura de la persona, la firma que se pidió sigue
  -- siendo la que se pidió.
  jefatura_id     uuid references usuarios(id),

  estado          estado_solicitud not null default 'PENDIENTE',

  destino         text,
  motivo          text not null,
  monto_estimado  numeric(12,2) check (monto_estimado is null or monto_estimado > 0),
  fecha_desde     date,
  fecha_hasta     date,

  respuesta       text,
  respondido_por  uuid references usuarios(id),
  respondido_en   timestamptz,

  -- El memo que salió de acá, cuando Administración la emite.
  memo_id         uuid references memos(id) on delete set null,

  creado_en       timestamptz not null default now(),

  constraint solicitud_tramo_coherente
    check (fecha_desde is null or fecha_hasta is null or fecha_hasta >= fecha_desde)
);

comment on table solicitudes_memo is
  'El pedido y su visto bueno, antes de que exista el memo. Sin correlativo: un pedido rechazado no debe consumir uno.';
comment on column solicitudes_memo.jefatura_id is
  'A quién se le pidió la firma, congelado al crear la solicitud.';

create index on solicitudes_memo (solicitante_id);
create index on solicitudes_memo (jefatura_id) where estado = 'PENDIENTE';
create index on solicitudes_memo (estado);

-- A quién cubre el pedido, con lo que se estima para cada quien. Tiene la
-- misma forma que `memo_asignados` a propósito: al aprobarse, el anexo del
-- memo sale de acá sin traducir nada.
create table solicitud_personas (
  solicitud_id uuid not null references solicitudes_memo(id) on delete cascade,
  usuario_id   uuid not null references usuarios(id),
  monto        numeric(12,2) check (monto is null or monto > 0),
  fecha_desde  date,
  fecha_hasta  date,
  primary key (solicitud_id, usuario_id),
  constraint solicitud_persona_tramo_coherente
    check (fecha_desde is null or fecha_hasta is null or fecha_hasta >= fecha_desde)
);

comment on table solicitud_personas is
  'A quién cubre el pedido. Misma forma que memo_asignados: al aprobar, el anexo sale de acá.';

alter table solicitudes_memo enable row level security;
alter table solicitud_personas enable row level security;

-- La ve quien la pidió, a quién cubre, la jefatura a la que se le pidió, y
-- quien administra.
create policy solicitudes_lectura on solicitudes_memo for select
  using (
    solicitante_id = (select seguridad.usuario_actual())
    or jefatura_id = (select seguridad.usuario_actual())
    or exists (
      select 1 from solicitud_personas sp
      where sp.solicitud_id = solicitudes_memo.id
        and sp.usuario_id = (select seguridad.usuario_actual())
    )
    or seguridad.puede_ver_todo()
  );

-- Cualquiera puede pedir: ese es justamente el punto. Lo que no puede es
-- responderse a sí mismo, y de eso se encarga la acción.
create policy solicitudes_alta on solicitudes_memo for insert
  with check (solicitante_id = (select seguridad.usuario_actual()));

create policy solicitudes_cambio on solicitudes_memo for update
  using (
    solicitante_id = (select seguridad.usuario_actual())
    or jefatura_id = (select seguridad.usuario_actual())
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  );

create policy solicitud_personas_lectura on solicitud_personas for select
  using (
    usuario_id = (select seguridad.usuario_actual())
    or exists (
      select 1 from solicitudes_memo s
      where s.id = solicitud_personas.solicitud_id
        and (s.solicitante_id = (select seguridad.usuario_actual())
             or s.jefatura_id = (select seguridad.usuario_actual()))
    )
    or seguridad.puede_ver_todo()
  );

create policy solicitud_personas_escritura on solicitud_personas for all
  using (
    exists (
      select 1 from solicitudes_memo s
      where s.id = solicitud_personas.solicitud_id
        and s.solicitante_id = (select seguridad.usuario_actual())
    )
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  )
  with check (
    exists (
      select 1 from solicitudes_memo s
      where s.id = solicitud_personas.solicitud_id
        and s.solicitante_id = (select seguridad.usuario_actual())
    )
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  );
