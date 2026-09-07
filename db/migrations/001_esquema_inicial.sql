-- Foto-Grama v2 — esquema inicial
-- Referencia: SPEC §5 (modelo de datos) y §10.2 (reglas de acceso a nivel de fila)
--
-- Principio: doble capa. Estas políticas son la segunda barrera; las rutas de
-- API comprueban rol por su cuenta. Si una falla, la otra contiene.

create extension if not exists "pgcrypto";

-- ════════════════════════════════════════════════════════════════
-- IDENTIDAD Y ORGANIZACIÓN
-- ════════════════════════════════════════════════════════════════

create table areas (
  id              uuid primary key default gen_random_uuid(),
  nombre          text not null,
  responsable_id  uuid,                       -- FK diferida: apunta a usuarios
  creado_en       timestamptz not null default now()
);

create table usuarios (
  id           uuid primary key default gen_random_uuid(),
  -- Coincide con auth.users.id del proveedor de identidad.
  auth_id      uuid unique,
  email        text unique not null,
  nombre       text not null,
  activo       boolean not null default true,
  area_id      uuid references areas(id),
  jefatura_id  uuid references usuarios(id),  -- escalamiento del semáforo (§11)
  creado_en    timestamptz not null default now()
);

alter table areas
  add constraint areas_responsable_fk
  foreign key (responsable_id) references usuarios(id);

create type rol_usuario as enum (
  'RENDIDOR', 'ADMIN_MEMOS', 'REVISOR_COSTOS',
  'CONTABILIDAD', 'JEFATURA', 'ADMIN_SISTEMA'
);

create table roles_usuario (
  usuario_id  uuid not null references usuarios(id) on delete cascade,
  rol         rol_usuario not null,
  primary key (usuario_id, rol)
);

create index on usuarios (auth_id);
create index on usuarios (area_id);
create index on roles_usuario (usuario_id);

-- ════════════════════════════════════════════════════════════════
-- CATÁLOGOS
-- ════════════════════════════════════════════════════════════════

create table empresas (
  id            uuid primary key default gen_random_uuid(),
  ruc           text unique not null check (ruc ~ '^[0-9]{11}$'),
  razon_social  text not null,
  activo        boolean not null default true,
  -- Credenciales de la API de SUNAT: son por RUC (§8.1).
  -- Se guardan cifradas fuera de esta tabla; aquí solo la referencia.
  sunat_secret_ref text,
  creado_en     timestamptz not null default now()
);

create table centros_costo (
  id            uuid primary key default gen_random_uuid(),
  codigo        text unique not null,
  nombre        text not null,
  empresa_id    uuid references empresas(id),
  activo        boolean not null default true,
  -- Nombre EXACTO de la carpeta en Drive. Si no coincide, la app crea una
  -- carpeta nueva en vez de usar la existente.
  drive_folder  text,
  creado_en     timestamptz not null default now()
);

create type estado_proyecto as enum ('ACTIVO', 'MANTENIMIENTO', 'CERRADO');

create table proyectos (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique not null,
  nombre              text not null,
  centro_costo_id     uuid not null references centros_costo(id),
  estado              estado_proyecto not null default 'ACTIVO',
  fecha_inicio        date,
  fecha_fin_estimada  date,
  creado_en           timestamptz not null default now()
);

create index on centros_costo (empresa_id) where activo;
create index on proyectos (centro_costo_id);

-- ════════════════════════════════════════════════════════════════
-- MEMOS
-- ════════════════════════════════════════════════════════════════

create type tipo_memo   as enum ('VIATICOS', 'PASAJES', 'CAJA_CHICA', 'OTRO');
create type estado_memo as enum (
  'BORRADOR', 'ABIERTO', 'EN_RENDICION', 'PRESENTADA',
  'OBSERVADA', 'APROBADA', 'CONTABILIZADA', 'CERRADO', 'ANULADO'
);

create table memos (
  id                  uuid primary key default gen_random_uuid(),
  -- Generado por el servidor con secuencia por empresa y año (§7.1).
  correlativo         text unique not null,
  tipo                tipo_memo not null,
  empresa_id          uuid not null references empresas(id),
  centro_costo_id     uuid not null references centros_costo(id),
  proyecto_id         uuid references proyectos(id),
  destino             text,
  fecha_salida        date,
  fecha_retorno_prev  date,
  fecha_retorno_real  date,
  monto_autorizado    numeric(12,2) not null check (monto_autorizado >= 0),
  moneda              text not null default 'PEN',
  estado              estado_memo not null default 'BORRADOR',
  observacion_actual  text,
  drive_folder_id     text,                   -- creada al abrir el memo (§8.2)
  creado_por          uuid not null references usuarios(id),
  creado_en           timestamptz not null default now(),
  presentado_en       timestamptz,
  aprobado_por        uuid references usuarios(id),
  aprobado_en         timestamptz,
  contabilizado_en    timestamptz
);

create table memo_asignados (
  memo_id     uuid not null references memos(id) on delete cascade,
  usuario_id  uuid not null references usuarios(id),
  primary key (memo_id, usuario_id)
);

-- Un memo repartido entre proyectos (§7.2). Los porcentajes deben sumar 100:
-- se valida en la aplicación porque un CHECK no puede abarcar varias filas.
create table memo_distribucion (
  id           uuid primary key default gen_random_uuid(),
  memo_id      uuid not null references memos(id) on delete cascade,
  proyecto_id  uuid not null references proyectos(id),
  porcentaje   numeric(5,2) not null check (porcentaje > 0 and porcentaje <= 100),
  unique (memo_id, proyecto_id)
);

-- Secuencia del correlativo. Una fila por empresa/año/tipo.
create table memo_secuencias (
  empresa_id  uuid not null references empresas(id),
  anio        int  not null,
  tipo        tipo_memo not null,
  ultimo      int  not null default 0,
  primary key (empresa_id, anio, tipo)
);

create index on memos (estado);
create index on memos (centro_costo_id);
create index on memos (fecha_retorno_prev) where estado in ('ABIERTO', 'EN_RENDICION');
create index on memo_asignados (usuario_id);

-- ════════════════════════════════════════════════════════════════
-- GASTOS
-- ════════════════════════════════════════════════════════════════

create type estado_gasto as enum (
  'CAPTURADO', 'EXTRAIDO', 'ERROR_EXTRACCION', 'CON_ALERTA',
  'VALIDADO', 'PRESENTADO', 'OBSERVADO', 'APROBADO', 'CONTABILIZADO'
);
create type clase_gasto  as enum ('COMPROBANTE', 'DECLARACION_JURADA', 'MOVILIDAD');

create table gastos (
  id                uuid primary key default gen_random_uuid(),
  -- Generado en el dispositivo. Hace idempotente la sincronización (§9.2).
  client_id         text unique not null,
  memo_id           uuid references memos(id),   -- null = bandeja sin asignar (§2.3)
  proyecto_id       uuid references proyectos(id),
  usuario_id        uuid not null references usuarios(id),
  estado            estado_gasto not null default 'CAPTURADO',
  clase             clase_gasto  not null default 'COMPROBANTE',
  categoria         text,

  -- Extraído del comprobante
  proveedor_ruc     text,
  proveedor_nombre  text,
  tipo_comprobante  text,          -- código SUNAT: 01 factura, 03 boleta, 07 NC, 12 ticket
  serie             text,
  numero            text,
  fecha_emision     date,
  moneda            text default 'PEN',
  tipo_cambio       numeric(8,4),
  subtotal          numeric(12,2),
  igv               numeric(12,2),
  total             numeric(12,2),
  forma_pago        text,
  detalle           text,

  -- Campos propios de declaración jurada y movilidad (§7.6)
  dj_motivo         text,
  dj_lugar          text,
  mov_origen        text,
  mov_destino       text,

  -- Control
  confianza_extraccion jsonb,      -- {campo: 0.0-1.0}  (§7.5)
  alertas              jsonb not null default '[]'::jsonb,
  alertas_confirmadas  boolean not null default false,
  validacion_sunat     jsonb,      -- (§8.1)
  hash_imagen          text,       -- sha256, para deduplicar
  observacion          text,

  -- Archivos
  storage_key       text,
  drive_url         text,
  drive_error       text,

  capturado_en      timestamptz,   -- reloj del dispositivo
  sincronizado_en   timestamptz,   -- reloj del servidor
  registrado_en     timestamptz,
  creado_en         timestamptz not null default now()
);

-- Los dos bloqueantes de §7.4, garantizados por la base y no solo por la app.
-- Índice parcial: solo aplica a comprobantes con serie y número reales.
create unique index gastos_comprobante_unico
  on gastos (proveedor_ruc, serie, numero)
  where clase = 'COMPROBANTE'
    and proveedor_ruc is not null
    and serie is not null
    and numero is not null;

create unique index gastos_imagen_unica
  on gastos (hash_imagen)
  where hash_imagen is not null;

create index on gastos (memo_id);
create index on gastos (usuario_id);
create index on gastos (estado);
create index on gastos (memo_id, clase);

-- ════════════════════════════════════════════════════════════════
-- AUDITORÍA — append-only (§10.3)
-- ════════════════════════════════════════════════════════════════

create table eventos (
  id             bigserial primary key,
  entidad        text not null,               -- MEMO | GASTO | USUARIO | PARAMETRO
  entidad_id     uuid,
  accion         text not null,
  usuario_id     uuid references usuarios(id),
  datos_antes    jsonb,
  datos_despues  jsonb,
  -- SIEMPRE del servidor: no se acepta del cliente.
  ocurrido_en    timestamptz not null default now()
);

create index on eventos (entidad, entidad_id);
create index on eventos (ocurrido_en desc);

-- Nadie modifica ni borra la bitácora, ni siquiera con rol de servicio.
create rule eventos_sin_update as on update to eventos do instead nothing;
create rule eventos_sin_delete as on delete to eventos do instead nothing;

-- ════════════════════════════════════════════════════════════════
-- PARÁMETROS CONFIGURABLES (§5)
-- ════════════════════════════════════════════════════════════════

create table parametros (
  clave            text primary key,
  valor            jsonb not null,
  descripcion      text,
  actualizado_por  uuid references usuarios(id),
  actualizado_en   timestamptz not null default now()
);

-- Los valores marcados como null están pendientes de definición (§15).
-- La aplicación debe tratar null como "sin tope" y avisarlo, nunca inventar.
insert into parametros (clave, valor, descripcion) values
  ('tope_declaracion_jurada_dia', 'null',
   'Máximo por día sin comprobante. PENDIENTE §15 pregunta 2 — Contabilidad'),
  ('tope_movilidad_dia', 'null',
   'Tope diario de la planilla de movilidad. PENDIENTE §15 pregunta 1 — Control de Gestión'),
  ('plazo_rendicion_dias', 'null',
   'Días desde el retorno para rendir. PENDIENTE §15 pregunta 3 — Dirección'),
  ('bloquear_memo_con_pendientes', 'false',
   'Bloquea abrir memos si hay vencidos. Arranca apagado en el piloto (§7.3)'),
  ('dias_gracia_bloqueo', '15',
   'Días de tolerancia antes de bloquear'),
  ('igv_porcentaje', '18',
   'Porcentaje de IGV para la validación aritmética'),
  ('umbral_confianza_alerta', '0.75',
   'Bajo esta confianza se exige confirmación explícita');

-- ════════════════════════════════════════════════════════════════
-- SEGURIDAD A NIVEL DE FILA (§10.2)
-- ════════════════════════════════════════════════════════════════

alter table usuarios          enable row level security;
alter table roles_usuario     enable row level security;
alter table areas             enable row level security;
alter table empresas          enable row level security;
alter table centros_costo     enable row level security;
alter table proyectos         enable row level security;
alter table memos             enable row level security;
alter table memo_asignados    enable row level security;
alter table memo_distribucion enable row level security;
alter table gastos            enable row level security;
alter table eventos           enable row level security;
alter table parametros        enable row level security;

-- Identidad del solicitante, resuelta desde el token del proveedor.
create or replace function usuario_actual() returns uuid
language sql stable security definer set search_path = public as $$
  select id from usuarios where auth_id = auth.uid() and activo
$$;

create or replace function tiene_rol(r rol_usuario) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from roles_usuario ru
    join usuarios u on u.id = ru.usuario_id
    where u.auth_id = auth.uid() and u.activo and ru.rol = r
  )
$$;

-- Roles que pueden ver cualquier memo y cualquier gasto.
create or replace function puede_ver_todo() returns boolean
language sql stable security definer set search_path = public as $$
  select tiene_rol('ADMIN_MEMOS') or tiene_rol('REVISOR_COSTOS')
      or tiene_rol('CONTABILIDAD') or tiene_rol('ADMIN_SISTEMA')
$$;

-- ── Usuarios ────────────────────────────────────────────────────
create policy usuarios_lectura on usuarios for select
  using (auth_id = auth.uid() or puede_ver_todo() or tiene_rol('JEFATURA'));

create policy usuarios_admin on usuarios for all
  using (tiene_rol('ADMIN_SISTEMA')) with check (tiene_rol('ADMIN_SISTEMA'));

create policy roles_lectura on roles_usuario for select
  using (usuario_id = usuario_actual() or puede_ver_todo());

create policy roles_admin on roles_usuario for all
  using (tiene_rol('ADMIN_SISTEMA')) with check (tiene_rol('ADMIN_SISTEMA'));

-- ── Catálogos: los lee cualquiera autenticado, los edita ADMIN_SISTEMA ──
create policy areas_lectura     on areas         for select using (usuario_actual() is not null);
create policy empresas_lectura  on empresas      for select using (usuario_actual() is not null);
create policy centros_lectura   on centros_costo for select using (usuario_actual() is not null);
create policy proyectos_lectura on proyectos     for select using (usuario_actual() is not null);

create policy areas_admin     on areas         for all using (tiene_rol('ADMIN_SISTEMA')) with check (tiene_rol('ADMIN_SISTEMA'));
create policy empresas_admin  on empresas      for all using (tiene_rol('ADMIN_SISTEMA')) with check (tiene_rol('ADMIN_SISTEMA'));
create policy centros_admin   on centros_costo for all using (tiene_rol('ADMIN_SISTEMA')) with check (tiene_rol('ADMIN_SISTEMA'));
create policy proyectos_admin on proyectos     for all using (tiene_rol('ADMIN_SISTEMA')) with check (tiene_rol('ADMIN_SISTEMA'));

-- ── Memos ───────────────────────────────────────────────────────
-- El rendidor ve solo los memos que le fueron asignados. Un memo en BORRADOR
-- todavía no es visible para él (§4.1).
create policy memos_lectura on memos for select using (
  puede_ver_todo()
  or (
    estado <> 'BORRADOR'
    and exists (
      select 1 from memo_asignados ma
      where ma.memo_id = memos.id and ma.usuario_id = usuario_actual()
    )
  )
);

create policy memos_escritura on memos for all
  using (tiene_rol('ADMIN_MEMOS') or tiene_rol('ADMIN_SISTEMA'))
  with check (tiene_rol('ADMIN_MEMOS') or tiene_rol('ADMIN_SISTEMA'));

create policy asignados_lectura on memo_asignados for select
  using (usuario_id = usuario_actual() or puede_ver_todo());

create policy asignados_escritura on memo_asignados for all
  using (tiene_rol('ADMIN_MEMOS') or tiene_rol('ADMIN_SISTEMA'))
  with check (tiene_rol('ADMIN_MEMOS') or tiene_rol('ADMIN_SISTEMA'));

create policy distribucion_lectura on memo_distribucion for select
  using (
    puede_ver_todo()
    or exists (
      select 1 from memo_asignados ma
      where ma.memo_id = memo_distribucion.memo_id
        and ma.usuario_id = usuario_actual()
    )
  );

create policy distribucion_escritura on memo_distribucion for all
  using (tiene_rol('ADMIN_MEMOS') or tiene_rol('ADMIN_SISTEMA'))
  with check (tiene_rol('ADMIN_MEMOS') or tiene_rol('ADMIN_SISTEMA'));

-- ── Gastos ──────────────────────────────────────────────────────
-- Criterio de aceptación §14: un RENDIDOR que pide por API el gasto de otro
-- recibe 403, no el dato. Esta política lo garantiza aunque la ruta falle.
create policy gastos_lectura on gastos for select
  using (usuario_id = usuario_actual() or puede_ver_todo());

create policy gastos_insercion on gastos for insert
  with check (usuario_id = usuario_actual());

-- Solo se edita lo propio y mientras no esté presentado o cerrado. Un gasto
-- OBSERVADO vuelve a ser editable: es la vuelta atrás parcial de §4.1.
create policy gastos_edicion_propia on gastos for update
  using (
    usuario_id = usuario_actual()
    and estado in ('CAPTURADO','EXTRAIDO','ERROR_EXTRACCION','CON_ALERTA','VALIDADO','OBSERVADO')
  )
  with check (usuario_id = usuario_actual());

create policy gastos_revision on gastos for update
  using (tiene_rol('REVISOR_COSTOS') or tiene_rol('CONTABILIDAD') or tiene_rol('ADMIN_SISTEMA'))
  with check (tiene_rol('REVISOR_COSTOS') or tiene_rol('CONTABILIDAD') or tiene_rol('ADMIN_SISTEMA'));

create policy gastos_borrado on gastos for delete
  using (
    (usuario_id = usuario_actual() and estado in ('CAPTURADO','EXTRAIDO','ERROR_EXTRACCION','CON_ALERTA','VALIDADO'))
    or tiene_rol('ADMIN_SISTEMA')
  );

-- ── Eventos ─────────────────────────────────────────────────────
-- Se leen para auditar; insertar queda para el servidor con rol de servicio.
create policy eventos_lectura on eventos for select
  using (puede_ver_todo() or usuario_id = usuario_actual());

-- ── Parámetros ──────────────────────────────────────────────────
create policy parametros_lectura on parametros for select
  using (usuario_actual() is not null);

create policy parametros_admin on parametros for all
  using (tiene_rol('ADMIN_SISTEMA')) with check (tiene_rol('ADMIN_SISTEMA'));
