-- ════════════════════════════════════════════════════════════════
-- database.full.sql — GENERADO, no editar a mano (pnpm db:consolidar)
-- 54 migraciones: 001_esquema_inicial.sql → 054_el_legajo_del_detalle_de_la_carpeta_madre.sql
-- huella: fa2617480bf3a1f4
--
-- Aplicar sobre una base VACÍA (proyecto nuevo de Supabase): SQL Editor →
-- pegar todo → Run. Para una base existente, aplicar solo las migraciones
-- que falten, una por una, desde db/migrations/.
-- ════════════════════════════════════════════════════════════════


-- ┌──────────────────────────────────────────────────────────────
-- │ 001_esquema_inicial.sql
-- └──────────────────────────────────────────────────────────────

-- INRO VIATICOS v2 — esquema inicial (nombre de marca previo: Foto-Grama)
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


-- ┌──────────────────────────────────────────────────────────────
-- │ 002_correcciones.sql
-- └──────────────────────────────────────────────────────────────

-- Correcciones aplicadas tras probar contra la base real.
-- Cada una salió de un fallo observado, no de una revisión teórica.

-- ── 1. Las funciones auxiliares quedaban expuestas como endpoints REST ──
-- El auditor de Supabase las marcaba: `/rest/v1/rpc/tiene_rol` era invocable
-- sin sesión. PostgREST solo publica los esquemas configurados (public), así
-- que moverlas a uno privado las saca de la API.
create schema if not exists seguridad;

alter function public.usuario_actual()       set schema seguridad;
alter function public.tiene_rol(rol_usuario) set schema seguridad;
alter function public.puede_ver_todo()       set schema seguridad;

-- Se necesita poder usar el esquema para que las políticas las resuelvan.
grant usage   on schema seguridad to anon, authenticated;
grant execute on all functions in schema seguridad to anon, authenticated;

-- ── 2. search_path incorrecto tras el traslado ──
-- puede_ver_todo() llamaba a tiene_rol() sin calificar, con search_path
-- apuntando solo a public. Fallaba con "function tiene_rol(unknown) does
-- not exist" en toda consulta a usuarios y roles_usuario.
create or replace function seguridad.puede_ver_todo() returns boolean
language sql stable security definer set search_path = seguridad, public as $$
  select seguridad.tiene_rol('ADMIN_MEMOS')
      or seguridad.tiene_rol('REVISOR_COSTOS')
      or seguridad.tiene_rol('CONTABILIDAD')
      or seguridad.tiene_rol('ADMIN_SISTEMA')
$$;

-- ── 3. Políticas recreadas con las llamadas calificadas ──
-- Las expresiones guardaban el nombre sin esquema, no el OID, así que dejaron
-- de resolver al mover las funciones. Ver 002b_politicas.sql.

-- ── 4. Columnas de token en NULL rompían el inicio de sesión ──
-- GoTrue lee estas columnas como texto no nulo. Al insertar usuarios a mano
-- quedaban en NULL y el login fallaba con "Database error querying schema",
-- aunque el hash de la contraseña fuera correcto.
update auth.users
set confirmation_token = coalesce(confirmation_token, ''),
    recovery_token     = coalesce(recovery_token, ''),
    email_change       = coalesce(email_change, ''),
    email_change_token_new     = coalesce(email_change_token_new, ''),
    email_change_token_current = coalesce(email_change_token_current, ''),
    phone_change       = coalesce(phone_change, ''),
    phone_change_token = coalesce(phone_change_token, ''),
    reauthentication_token = coalesce(reauthentication_token, '')
where confirmation_token is null or recovery_token is null;


-- ┌──────────────────────────────────────────────────────────────
-- │ 003_bitacora_insercion.sql
-- └──────────────────────────────────────────────────────────────

-- La bitácora nunca recibía inserciones: faltaba la política de INSERT.
--
-- Con RLS activo y ninguna política que cubra el comando, la orden se
-- deniega en silencio para el rol autenticado — y `registrarEvento`
-- (app/acciones/memos.ts) no revisaba el `error` de la respuesta, así que
-- nada lo delataba. Confirmado contra la base real: 0 filas en `eventos`
-- pese a memos ya creados, presentados y aprobados en las pruebas. Todo el
-- historial de "quién hizo qué y cuándo" —la razón de ser de esta tabla—
-- llevaba desde el inicio sin registrarse.
--
-- `usuario_id = usuario_actual()` impide que alguien registre un evento a
-- nombre de otra persona; update y delete siguen bloqueados por las reglas
-- ya existentes (`eventos_sin_update`, `eventos_sin_delete`), así que la
-- bitácora sigue siendo de solo-agregar.
create policy eventos_insercion on eventos for insert
  with check (usuario_id = seguridad.usuario_actual());


-- ┌──────────────────────────────────────────────────────────────
-- │ 004_identidad_por_dni.sql
-- └──────────────────────────────────────────────────────────────

-- Identidad por documento, no por correo
--
-- La reunión con Finanzas, Control de Gestión y Administración dejó claro
-- que buena parte del personal no tiene correo corporativo: los técnicos
-- usan correo personal y varios no usan correo en absoluto. Había 224
-- cuentas activas contra ~300 personas entre planilla y otras modalidades.
-- Amarrar la identidad al correo dejaba fuera justamente a quienes más
-- rinden viáticos.
--
-- El documento pasa a ser el identificador de negocio. La llave primaria
-- sigue siendo el uuid: todas las tablas ya apuntan a él y un documento
-- puede corregirse (un dígito mal tipeado, un carnet de extranjería que
-- reemplaza a un DNI). Un identificador que puede cambiar no sirve como
-- llave primaria.

alter table usuarios add column dni text;

-- 8 dígitos es el DNI peruano; se admite hasta 12 para no bloquear el alta
-- de un carnet de extranjería, que es más largo.
alter table usuarios add constraint usuarios_dni_formato
  check (dni is null or dni ~ '^[0-9]{8,12}$');

-- Marca los documentos que todavía son de relleno, a la espera del dato
-- real de RRHH. Sin esto, al llegar la lista verdadera no habría forma de
-- distinguir un documento por reemplazar de uno ya confirmado.
alter table usuarios add column dni_provisional boolean not null default false;

-- El correo deja de ser obligatorio: es un dato de contacto, no la
-- identidad. Sigue siendo único cuando existe (Postgres permite varios
-- nulos bajo una restricción de unicidad).
alter table usuarios alter column email drop not null;

comment on column usuarios.dni is
  'Documento de identidad: identificador de negocio, único. Es lo que la persona teclea para entrar y lo que permite cruzar con la planilla de RRHH.';
comment on column usuarios.dni_provisional is
  'true = documento de relleno, pendiente de reemplazo por el dato real de RRHH.';
comment on column usuarios.email is
  'Correo de contacto. Nulo para quien no tiene: no todos en la empresa tienen cuenta.';

-- Documentos de relleno para los usuarios ya existentes. Van marcados como
-- provisionales para que el reemplazo posterior sea dirigido, no adivinado.
update usuarios
set dni = lpad(((random() * 89999999)::bigint + 10000000)::text, 8, '0'),
    dni_provisional = true
where dni is null;

alter table usuarios alter column dni set not null;
alter table usuarios add constraint usuarios_dni_key unique (dni);


-- ┌──────────────────────────────────────────────────────────────
-- │ 005_alias_de_acceso.sql
-- └──────────────────────────────────────────────────────────────

-- Un solo formato de cuenta para todos: <documento>@sin-correo.local
--
-- El servidor de autenticación identifica cuentas por correo, siempre. Para
-- que alguien sin correo pueda entrar con su documento, su cuenta se crea
-- con un correo sintético. Y para que la respuesta no delate nada, TODAS
-- las cuentas usan ese formato, tengan correo corporativo o no.
--
-- El dominio .local está reservado justamente para no resolver fuera: a esa
-- dirección nunca llega ni sale nada. El correo corporativo sigue guardado
-- en `usuarios.email` como dato de contacto, pero deja de ser credencial.

update auth.users au
set email = u.dni || '@sin-correo.local'
from usuarios u
where u.auth_id = au.id and au.email is distinct from u.dni || '@sin-correo.local';

update auth.identities i
set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(u.dni || '@sin-correo.local'))
from usuarios u
where u.auth_id = i.user_id and i.provider = 'email';

-- Traduce lo que la persona teclea —documento o correo— al alias con el que
-- la cuenta existe.
--
-- Va en `public` a propósito, al revés que los helpers de `seguridad`:
-- necesita ser invocable por un visitante todavía no autenticado. Por eso
-- está escrita para ser segura estando expuesta.
--
-- Dos filtraciones que hubo que cerrar durante la construcción, ambas
-- detectadas probando la función contra la base real:
--
--   1. Devolver el correo corporativo real permitía obtener el correo de
--      una persona a partir de su DNI. Por eso el alias es uniforme.
--   2. Devolver el documento tecleado cuando existía, y otro derivado
--      cuando no, dejaba comparar entrada contra salida: si coincidían, el
--      documento estaba dado de alta. Por eso ahora un documento se
--      devuelve siempre tal cual, exista o no.
--
-- El resultado: la respuesta es idéntica para un usuario dado de alta y
-- para uno inexistente, y el intento falla por contraseña en ambos casos.
create or replace function public.correo_de_acceso(identificador text)
returns text
language plpgsql
stable
security definer
set search_path = public, auth
as $$
declare
  limpio text := lower(trim(coalesce(identificador, '')));
  hallado text;
begin
  select u.dni into hallado
  from usuarios u
  where u.activo
    and (u.dni = limpio or lower(u.email) = limpio)
  limit 1;

  if hallado is null then
    if limpio ~ '^[0-9]{8,12}$' then
      hallado := limpio;
    else
      hallado := lpad(
        ((('x' || substr(md5(limpio), 1, 8))::bit(32)::bigint % 90000000) + 10000000)::text,
        8, '0'
      );
    end if;
  end if;

  return hallado || '@sin-correo.local';
end;
$$;

revoke all on function public.correo_de_acceso(text) from public;
grant execute on function public.correo_de_acceso(text) to anon, authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 006_visibilidad_del_lider.sql
-- └──────────────────────────────────────────────────────────────

-- Un líder ve a su gente
--
-- De la reunión: "acá están tus cinco personas que están yendo, es la
-- responsabilidad de tu área — eso a ustedes los libera, ya monitorean al
-- líder y no a cada persona". Hoy Administración persigue de a uno a unas
-- ciento cincuenta personas.
--
-- La columna `usuarios.jefatura_id` existía desde el esquema inicial y no
-- la usaba nadie. Peor: la matriz de permisos de la aplicación concede a
-- JEFATURA ver memos ajenos de su área, pero `puede_ver_todo()` nunca
-- incluyó ese rol, así que la base le devolvía únicamente lo propio. La
-- aplicación y la base decían cosas distintas; mandaba la base, y el
-- tablero de una jefatura salía vacío.
--
-- Se resuelve por reporte directo y no por área, que es como lo describió
-- el equipo: el líder responde por personas concretas, no por un casillero
-- organizacional.

create or replace function seguridad.es_mi_reporte(id_usuario uuid)
returns boolean
language sql
stable
security definer
set search_path = seguridad, public
as $$
  select exists (
    select 1 from usuarios u
    where u.id = id_usuario
      and u.activo
      and u.jefatura_id = seguridad.usuario_actual()
  )
$$;

comment on function seguridad.es_mi_reporte(uuid) is
  'true si esa persona reporta directamente a quien hace la consulta.';

-- ── Memos de la gente a cargo ──
drop policy if exists memos_lectura on memos;
create policy memos_lectura on memos for select using (
  seguridad.puede_ver_todo()
  or (
    estado <> 'BORRADOR'
    and exists (
      select 1 from memo_asignados ma
      where ma.memo_id = memos.id and ma.usuario_id = seguridad.usuario_actual()
    )
  )
  or (
    -- El líder ve los memos de quienes le reportan, pero no los borradores:
    -- un memo sin abrir todavía no es un compromiso de nadie.
    estado <> 'BORRADOR'
    and exists (
      select 1 from memo_asignados ma
      where ma.memo_id = memos.id and seguridad.es_mi_reporte(ma.usuario_id)
    )
  )
);

-- ── Sus gastos, para poder calcular cuánto llevan rendido ──
drop policy if exists gastos_lectura on gastos;
create policy gastos_lectura on gastos for select using (
  usuario_id = seguridad.usuario_actual()
  or seguridad.puede_ver_todo()
  or seguridad.es_mi_reporte(usuario_id)
);

-- ── Y quién está asignado a cada memo, para poder nombrarlos ──
drop policy if exists asignados_lectura on memo_asignados;
create policy asignados_lectura on memo_asignados for select using (
  usuario_id = seguridad.usuario_actual()
  or seguridad.puede_ver_todo()
  or seguridad.es_mi_reporte(usuario_id)
);


-- ┌──────────────────────────────────────────────────────────────
-- │ 007_adquiriente_del_comprobante.sql
-- └──────────────────────────────────────────────────────────────

-- A nombre de quién se emitió el comprobante
--
-- Administración lo revisa hoy papel por papel: "algunos dicen que
-- pidieron factura, pero cuando reviso el físico está a nombre del
-- trabajador". Una factura emitida a otro RUC no sustenta el gasto de la
-- empresa ni da derecho a crédito fiscal, y eso recién se descubre al
-- final, con la persona ya de vuelta y el proveedor lejos.
--
-- Guardarlo permite avisarlo en el momento de la captura y, después,
-- exportarlo para que Contabilidad pueda cruzarlo.
alter table gastos add column adquiriente_ruc text;

comment on column gastos.adquiriente_ruc is
  'RUC a nombre de quien se emitió el comprobante. Debe coincidir con el de la empresa para que sirva como sustento.';


-- ┌──────────────────────────────────────────────────────────────
-- │ 008_rendidor_presenta_y_caja_chica.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 009_autorizacion_de_apertura.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 010_liquidacion_que_se_paga.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 011_transiciones_de_memo_por_rol.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 012_cerrar_permisos_de_funciones.sql
-- └──────────────────────────────────────────────────────────────

-- 012 · Cerrar lo que quedó abierto por omisión
--
-- De una barrida al esquema con el linter de Supabase. Ninguno de estos era
-- una puerta abierta de par en par, pero tres eran puertas que no tenían por
-- qué estar entornadas.
--
-- El detalle que las explica a todas: PostgreSQL concede EXECUTE a `public`
-- por defecto al crear una función, y Supabase además concede a `anon` y
-- `authenticated` sobre lo que aparece en el esquema `public`. O sea que una
-- función nace accesible salvo que uno diga lo contrario, y `public` incluye
-- a quien no inició sesión.
--
-- La más seria era `siguiente_correlativo`: consume un número de la
-- secuencia cada vez que se la llama. Cualquiera sin sesión podía llamarla
-- en bucle y abrir huecos en una numeración que va a Contabilidad.
--
-- Las otras dos son funciones de disparador. No se llaman a mano nunca, y
-- estaban expuestas por la API. Quitarles el permiso NO impide que el
-- disparador las ejecute: eso se comprobó contra la base, y las tres siguen
-- frenando lo que tienen que frenar.

-- ── search_path fijo en las de disparador ──
--
-- Corren como quien invoca, así que un search_path mutable no escala
-- privilegios; pero es una puerta que tampoco tiene por qué estar abierta.

create or replace function public.verificar_autorizacion_apertura()
returns trigger
language plpgsql
set search_path = public
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

    if v_firmado is not null and v_firmado <> new.monto_autorizado then
      raise exception 'Jefatura autorizó S/ %, y el memo ahora dice S/ %. Vuelve a pedir el visto bueno.',
        to_char(v_firmado, 'FM999999990.00'), to_char(new.monto_autorizado, 'FM999999990.00');
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.verificar_memo_no_liquidado()
returns trigger
language plpgsql
set search_path = public
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

-- ── Quitar de la API lo que no se llama a mano ──

revoke execute on function public.verificar_autorizacion_apertura() from public, anon, authenticated;
revoke execute on function public.verificar_memo_no_liquidado()     from public, anon, authenticated;
revoke execute on function public.cerrar_al_contabilizar()          from public, anon, authenticated;

-- Ayudante interno de registrar_pago_liquidacion. Se le había revocado de
-- public y anon al crearla, pero los privilegios por defecto de Supabase la
-- habían concedido a authenticated igual.
revoke execute on function public.cerrar_memos_saldados(uuid) from public, anon, authenticated;

-- ── El correlativo, solo con sesión ──

revoke execute on function public.siguiente_correlativo(uuid, integer, public.tipo_memo) from public, anon;
grant  execute on function public.siguiente_correlativo(uuid, integer, public.tipo_memo) to authenticated;

-- `correo_de_acceso` sigue abierta a anon a propósito: es el paso de
-- ingreso, y quien la llama todavía no tiene sesión. Ya se le quitaron sus
-- dos filtraciones en la migración 005.


-- ┌──────────────────────────────────────────────────────────────
-- │ 013_indices_y_rls_de_usuarios.sql
-- └──────────────────────────────────────────────────────────────

-- 013 · Que la visibilidad del jefe no cueste una lectura de tabla
--
-- `seguridad.es_mi_reporte()` consulta `usuarios.jefatura_id` en CADA fila
-- que lee un jefe: sus memos, sus gastos, sus liquidaciones. Esa columna no
-- tenía índice. Con siete personas da igual; con las ciento cincuenta de las
-- que habló el equipo, y una obra de varios meses, no.

create index if not exists usuarios_jefatura_idx on usuarios (jefatura_id);

-- Las demás claves foráneas que se consultan de verdad. El linter reporta
-- catorce; estas son las que se filtran. Las otras —aprobado_por,
-- pagada_por, resuelta_por— son de auditoría: se escriben una vez y nadie
-- busca por ellas.
create index if not exists eventos_usuario_idx           on eventos (usuario_id);
create index if not exists memos_empresa_idx             on memos (empresa_id);
create index if not exists memos_creado_por_idx          on memos (creado_por);
create index if not exists autorizaciones_solicitante_idx on autorizaciones_memo (solicitada_por);

-- `auth.uid()` sin envolver se re-evalúa una vez por fila. Envuelto en un
-- select, PostgreSQL lo calcula una sola vez por consulta. La condición es
-- exactamente la misma.
drop policy if exists usuarios_lectura on usuarios;
create policy usuarios_lectura on usuarios for select using (
  auth_id = (select auth.uid())
  or seguridad.puede_ver_todo()
  or seguridad.tiene_rol('JEFATURA')
);


-- ┌──────────────────────────────────────────────────────────────
-- │ 014_cuentas_del_padron_real.sql
-- └──────────────────────────────────────────────────────────────

-- 014 · Cuentas de acceso para el padrón real
--
-- Acompaña a la carga del padrón (db/carga/). El alias de acceso es
-- <dni>@sin-correo.local, según la migración 005. Al entrar los DNI
-- verdaderos cambiaron los de seis personas que ya existían en la base con
-- documentos provisionales, y su alias quedó apuntando al documento viejo:
-- dejaron de poder entrar hasta correr esto.
--
-- Se hace por conjunto y no persona por persona, así vale igual para 90
-- que para 900. Es idempotente: se puede volver a correr cuando entre
-- gente nueva.
--
-- Las cuentas se crean directamente en auth.users porque signUp rechaza el
-- dominio .local, que es justamente el que usamos para que quien no tiene
-- correo corporativo pueda entrar con su documento.
--
-- La clave inicial NO va escrita aquí: este repositorio es público. Se pasa
-- al correr la migración y la sentencia falla sola si no está:
--
--   set local app.clave_inicial = '<la clave>';
--
-- Es una clave compartida y provisional. Lo correcto antes de abrir el
-- piloto de verdad es obligar a cambiarla en el primer ingreso.

-- ── 1. Cuenta para quien todavía no tiene ──
with nuevos as (
  select id as usuario_id, dni from usuarios where auth_id is null
), creados as (
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, confirmation_token, recovery_token, email_change,
    email_change_token_new, email_change_token_current, phone_change,
    phone_change_token, reauthentication_token, raw_app_meta_data, raw_user_meta_data,
    is_sso_user, is_anonymous
  )
  select '00000000-0000-0000-0000-000000000000', gen_random_uuid(), 'authenticated', 'authenticated',
         n.dni || '@sin-correo.local', crypt(current_setting('app.clave_inicial'), gen_salt('bf')), now(),
         now(), now(), '', '', '', '', '', '', '', '',
         '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb, false, false
  from nuevos n
  returning id as auth_id, email
)
update usuarios u
set auth_id = c.auth_id
from creados c
where u.dni || '@sin-correo.local' = c.email and u.auth_id is null;

-- ── 2. Identidad de correo para cada cuenta que no la tenga ──
insert into auth.identities (id, provider_id, user_id, identity_data, provider, created_at, updated_at, last_sign_in_at)
select gen_random_uuid(), au.id::text, au.id,
       jsonb_build_object('sub', au.id::text, 'email', au.email, 'email_verified', true, 'phone_verified', false),
       'email', now(), now(), now()
from auth.users au
where not exists (select 1 from auth.identities i where i.user_id = au.id and i.provider = 'email');

-- ── 3. Realinear los alias con el DNI vigente ──
update auth.users au
set email = u.dni || '@sin-correo.local', updated_at = now()
from usuarios u
where u.auth_id = au.id and au.email is distinct from u.dni || '@sin-correo.local';

update auth.identities i
set identity_data = jsonb_set(i.identity_data, '{email}', to_jsonb(u.dni || '@sin-correo.local')),
    updated_at = now()
from usuarios u
where u.auth_id = i.user_id and i.provider = 'email'
  and i.identity_data->>'email' is distinct from u.dni || '@sin-correo.local';

-- ── 4. GoTrue lee estas columnas como texto no nulo ──
update auth.users
set confirmation_token = coalesce(confirmation_token,''), recovery_token = coalesce(recovery_token,''),
    email_change = coalesce(email_change,''), email_change_token_new = coalesce(email_change_token_new,''),
    email_change_token_current = coalesce(email_change_token_current,''),
    phone_change = coalesce(phone_change,''), phone_change_token = coalesce(phone_change_token,''),
    reauthentication_token = coalesce(reauthentication_token,'')
where confirmation_token is null or recovery_token is null or email_change is null;


-- ┌──────────────────────────────────────────────────────────────
-- │ 015_bitacora_de_consultas_a_sunat.sql
-- └──────────────────────────────────────────────────────────────

-- Bitácora de lo que se le ha preguntado a SUNAT
--
-- Cada consulta al registro de compras deja una línea. No guarda los
-- comprobantes —son miles por período y ya viven en SUNAT— sino el resultado:
-- cuántos cuadraron, cuántos no, y por cuánto.
--
-- Por qué una tabla y no una hoja de cálculo: una hoja es una foto de un
-- momento. Esto crece todos los meses y hay que poder preguntarle cosas
-- («¿desde cuándo no consultamos este período?», «¿empeoró el mes pasado?»),
-- que es justo lo que una hoja hace mal a los seis meses.
--
-- Se guarda también la salud de la lectura: si SUNAT cambió el formato del
-- archivo, un cruce puede salir tranquilizador y no significar nada. Sin
-- dejar constancia de eso, un cero en «no están en SUNAT» se lee como buena
-- noticia cuando en realidad es que no se leyó nada.

create table consultas_sunat (
  id                    uuid primary key default gen_random_uuid(),

  -- Qué se preguntó
  empresa_ruc           text        not null,
  periodo               text        not null,
  consultado_por        uuid        not null references usuarios(id),
  consultado_en         timestamptz not null default now(),
  ticket                text,
  archivo               text,

  -- Qué contestó
  comprobantes_sunat    integer     not null default 0,
  comprobantes_nuestros integer     not null default 0,
  cuadran               integer     not null default 0,
  monto_distinto        integer     not null default 0,
  no_estan_en_sunat     integer     not null default 0,
  no_comparables        integer     not null default 0,
  solo_en_sunat         integer     not null default 0,
  monto_solo_en_sunat   numeric(14,2) not null default 0,

  -- Si se puede confiar en lo de arriba
  columnas_faltantes    text[]      not null default '{}',
  identidad_sospechosa  text,
  segundos              integer,

  constraint periodo_yyyymm check (periodo ~ '^[0-9]{4}(0[1-9]|1[0-2])$')
);

comment on column consultas_sunat.identidad_sospechosa is
  'Motivo por el que la lectura no es confiable. Si no es null, los conteos de esa fila no valen.';

-- Se consulta «lo último de este período» y «las últimas consultas».
create index consultas_sunat_periodo_idx
  on consultas_sunat (empresa_ruc, periodo, consultado_en desc);
create index consultas_sunat_recientes_idx
  on consultas_sunat (consultado_en desc);

alter table consultas_sunat enable row level security;

-- Lo ve quien ya puede ver todos los gastos: Contabilidad, quien revisa,
-- Administración de memos y Administración del sistema. No es información
-- de una persona, es del estado tributario de la empresa.
create policy consultas_sunat_lectura on consultas_sunat for select using (
  seguridad.puede_ver_todo()
);

-- Nadie escribe a mano: solo la función que registra una consulta real.
-- Una bitácora que se puede editar deja de ser una bitácora.
create policy consultas_sunat_sin_escritura on consultas_sunat for insert with check (false);

/**
 * Deja constancia de una consulta.
 *
 * SECURITY DEFINER porque la política de inserción está cerrada a propósito:
 * la única forma de escribir aquí es habiendo consultado a SUNAT de verdad.
 */
create or replace function registrar_consulta_sunat(
  p_empresa_ruc           text,
  p_periodo               text,
  p_ticket                text,
  p_archivo               text,
  p_comprobantes_sunat    integer,
  p_comprobantes_nuestros integer,
  p_cuadran               integer,
  p_monto_distinto        integer,
  p_no_estan_en_sunat     integer,
  p_no_comparables        integer,
  p_solo_en_sunat         integer,
  p_monto_solo_en_sunat   numeric,
  p_columnas_faltantes    text[],
  p_identidad_sospechosa  text,
  p_segundos              integer
) returns uuid
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_usuario uuid;
  v_id      uuid;
begin
  v_usuario := seguridad.usuario_actual();
  if v_usuario is null then
    raise exception 'No hay sesión: no se puede registrar la consulta.';
  end if;

  -- Consultar a SUNAT es cosa de Administración del sistema, igual que la
  -- pantalla desde donde se hace.
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema registra consultas a SUNAT.';
  end if;

  insert into consultas_sunat (
    empresa_ruc, periodo, consultado_por, ticket, archivo,
    comprobantes_sunat, comprobantes_nuestros, cuadran, monto_distinto,
    no_estan_en_sunat, no_comparables, solo_en_sunat, monto_solo_en_sunat,
    columnas_faltantes, identidad_sospechosa, segundos
  ) values (
    p_empresa_ruc, p_periodo, v_usuario, p_ticket, p_archivo,
    coalesce(p_comprobantes_sunat, 0), coalesce(p_comprobantes_nuestros, 0),
    coalesce(p_cuadran, 0), coalesce(p_monto_distinto, 0),
    coalesce(p_no_estan_en_sunat, 0), coalesce(p_no_comparables, 0),
    coalesce(p_solo_en_sunat, 0), coalesce(p_monto_solo_en_sunat, 0),
    coalesce(p_columnas_faltantes, '{}'), p_identidad_sospechosa, p_segundos
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- Por omisión Postgres da EXECUTE a public, y eso incluye a anon.
revoke execute on function registrar_consulta_sunat(
  text, text, text, text, integer, integer, integer, integer, integer,
  integer, integer, numeric, text[], text, integer
) from public, anon;
grant execute on function registrar_consulta_sunat(
  text, text, text, text, integer, integer, integer, integer, integer,
  integer, integer, numeric, text[], text, integer
) to authenticated;

-- Supabase concede todo a anon y authenticated por omisión al crear una
-- tabla. RLS ya lo frena, pero conviene no depender de una sola defensa:
-- si mañana alguien agrega una política de escritura por descuido, esto
-- sigue sosteniendo que la bitácora no se edita a mano.
revoke all on consultas_sunat from anon;
revoke insert, update, delete, truncate, references, trigger
  on consultas_sunat from authenticated;
grant select on consultas_sunat to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 016_comprobantes_de_sunat.sql
-- └──────────────────────────────────────────────────────────────

-- Los comprobantes que SUNAT tiene a nombre de la empresa
--
-- Hasta ahora cada consulta se miraba y se cerraba. Guardarlos permite dos
-- cosas que sin historia no existen: sacar el histórico a una hoja, y notar
-- que un comprobante cambió —que lo anularon, que le movieron el importe—
-- entre una consulta y la siguiente.
--
-- Un comprobante se identifica por su CAR SUNAT cuando viene; si no, por
-- proveedor, tipo, serie y número. La serie y el número solos no alcanzan:
-- los pone el proveedor y se repiten entre proveedores distintos. E001-100
-- salió dos veces en agosto de 2026, de dos empresas que no tienen nada que
-- ver entre sí.

create table comprobantes_sunat (
  id                uuid primary key default gen_random_uuid(),

  empresa_ruc       text not null,
  periodo           text not null,

  -- Con qué se reconoce. Se calcula al guardar, no se recibe de afuera.
  llave             text not null,
  car_sunat         text,

  proveedor_ruc     text,
  proveedor_nombre  text,
  tipo_comprobante  text,
  serie             text,
  numero            text,
  fecha_emision     date,
  total             numeric(14,2),
  moneda            text,
  estado            text,

  -- Cuando es nota de crédito o débito, a qué comprobante corrige.
  tipo_nota         text,
  modifica_tipo     text,
  modifica_serie    text,
  modifica_numero   text,
  modifica_fecha    date,

  primera_vez       timestamptz not null default now(),
  ultima_vez        timestamptz not null default now(),

  constraint comprobantes_sunat_unico unique (empresa_ruc, llave)
);

comment on table comprobantes_sunat is
  'Comprobantes que SUNAT tiene registrados a nombre de la empresa. Una fila por comprobante, actualizada en cada consulta.';
comment on column comprobantes_sunat.llave is
  'CAR SUNAT si vino; si no, proveedor|tipo|serie|número. Serie y número solos se repiten entre proveedores.';

create index comprobantes_sunat_periodo_idx
  on comprobantes_sunat (empresa_ruc, periodo, fecha_emision);
create index comprobantes_sunat_proveedor_idx
  on comprobantes_sunat (empresa_ruc, proveedor_ruc);
-- Para encontrar rápido la nota que corrige a una factura dada.
create index comprobantes_sunat_modifica_idx
  on comprobantes_sunat (empresa_ruc, proveedor_ruc, modifica_serie, modifica_numero)
  where modifica_numero is not null;

-- Cuando un comprobante llega distinto de como estaba
--
-- Es la respuesta a «esta factura ahora está anulada». Sin dejar constancia
-- del antes, un comprobante anulado se ve igual que uno que siempre lo
-- estuvo, y nadie se entera de que cambió.
create table cambios_comprobante_sunat (
  id            uuid primary key default gen_random_uuid(),
  comprobante_id uuid not null references comprobantes_sunat(id) on delete cascade,
  notado_en     timestamptz not null default now(),
  campo         text not null,
  antes         text,
  despues       text
);

create index cambios_comprobante_sunat_recientes_idx
  on cambios_comprobante_sunat (notado_en desc);
create index cambios_comprobante_sunat_del_comprobante_idx
  on cambios_comprobante_sunat (comprobante_id, notado_en desc);

alter table comprobantes_sunat        enable row level security;
alter table cambios_comprobante_sunat enable row level security;

-- Lo mismo que la bitácora: es información del estado tributario de la
-- empresa, no de una persona.
create policy comprobantes_sunat_lectura on comprobantes_sunat for select using (
  seguridad.puede_ver_todo()
);
create policy cambios_comprobante_sunat_lectura on cambios_comprobante_sunat for select using (
  seguridad.puede_ver_todo()
);

/**
 * Guarda lo que devolvió una consulta.
 *
 * Recibe las filas juntas porque son miles por período y una por una no
 * entraría en el minuto de vida que tiene una petición.
 *
 * Devuelve cuántas eran nuevas y cuántas llegaron distintas. Lo segundo es
 * lo que importa: son las que cambiaron desde la última vez.
 */
create or replace function guardar_comprobantes_sunat(
  p_empresa_ruc text,
  p_periodo     text,
  p_filas       jsonb
) returns table (nuevos integer, cambiados integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos    integer := 0;
  v_cambiados integer := 0;
  f           jsonb;
  v_llave     text;
  v_id        uuid;
  v_antes     comprobantes_sunat%rowtype;
  v_total     numeric(14,2);
  v_estado    text;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema guarda comprobantes de SUNAT.';
  end if;

  for f in select * from jsonb_array_elements(p_filas)
  loop
    -- La llave se arma acá y no se recibe: si viniera de afuera, un error
    -- del lado de la aplicación duplicaría comprobantes en silencio.
    v_llave := coalesce(
      nullif(trim(f->>'carSunat'), ''),
      concat_ws('|',
        coalesce(f->>'ruc', ''), coalesce(f->>'tipoComprobante', ''),
        upper(coalesce(f->>'serie', '')), coalesce(f->>'numero', '')
      )
    );

    v_total  := nullif(f->>'total', '')::numeric;
    v_estado := nullif(trim(f->>'estado'), '');

    select * into v_antes from comprobantes_sunat
     where empresa_ruc = p_empresa_ruc and llave = v_llave;

    if not found then
      insert into comprobantes_sunat (
        empresa_ruc, periodo, llave, car_sunat, proveedor_ruc, proveedor_nombre,
        tipo_comprobante, serie, numero, fecha_emision, total, moneda, estado,
        tipo_nota, modifica_tipo, modifica_serie, modifica_numero, modifica_fecha
      ) values (
        p_empresa_ruc, p_periodo, v_llave, nullif(trim(f->>'carSunat'), ''),
        nullif(f->>'ruc', ''), nullif(f->>'razonSocial', ''),
        nullif(f->>'tipoComprobante', ''), nullif(f->>'serie', ''), nullif(f->>'numero', ''),
        nullif(f->>'fechaEmision', '')::date, v_total, nullif(f->>'moneda', ''), v_estado,
        nullif(f->>'tipoNota', ''),
        nullif(f#>>'{modifica,tipo}', ''), nullif(f#>>'{modifica,serie}', ''),
        nullif(f#>>'{modifica,numero}', ''), nullif(f#>>'{modifica,fechaEmision}', '')::date
      );
      v_nuevos := v_nuevos + 1;
      continue;
    end if;

    v_id := v_antes.id;

    -- Solo se anota lo que de verdad cambió. Una consulta repetida del mismo
    -- período no debe llenar la historia de filas que dicen lo mismo.
    if v_antes.estado is distinct from v_estado then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'estado', v_antes.estado, v_estado);
      v_cambiados := v_cambiados + 1;
    end if;

    if v_antes.total is distinct from v_total then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'total', v_antes.total::text, v_total::text);
      v_cambiados := v_cambiados + 1;
    end if;

    update comprobantes_sunat
       set estado = v_estado,
           total = v_total,
           proveedor_nombre = coalesce(nullif(f->>'razonSocial', ''), proveedor_nombre),
           ultima_vez = now()
     where id = v_id;
  end loop;

  nuevos := v_nuevos;
  cambiados := v_cambiados;
  return next;
end;
$$;

revoke execute on function guardar_comprobantes_sunat(text, text, jsonb) from public, anon;
grant execute on function guardar_comprobantes_sunat(text, text, jsonb) to authenticated;

-- Supabase concede todo por omisión al crear una tabla.
revoke all on comprobantes_sunat        from anon;
revoke all on cambios_comprobante_sunat from anon;
revoke insert, update, delete, truncate, references, trigger
  on comprobantes_sunat from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on cambios_comprobante_sunat from authenticated;
grant select on comprobantes_sunat        to authenticated;
grant select on cambios_comprobante_sunat to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 017_leer_el_historico_sin_topes.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 018_un_comprobante_por_periodo.sql
-- └──────────────────────────────────────────────────────────────

-- El mismo comprobante puede estar anotado en varios períodos
--
-- Las tres primeras alertas que dio esta función eran falsas. Se vieron
-- porque los tiempos no cuadraban: un comprobante «cambió» 22 segundos
-- después de guardarse, justo mientras se consultaba OTRO mes.
--
--   guardado 03:28:59 (consultando 202603)
--   «cambió» 03:29:21 (consultando 202602)
--
-- Los tres eran tipo 53 —declaraciones de importación, con RUC de proveedor
-- «0»—, y ese documento se anota en más de un período a medida que se aplica
-- el crédito fiscal. Es normal en un registro de compras.
--
-- El error estaba en la llave: identificaba al comprobante por empresa y CAR,
-- sin el período. Dos anotaciones legítimas del mismo documento colapsaban en
-- una fila, y el importe de la segunda parecía un cambio de la primera.
--
-- El RCE es un registro POR PERÍODO. Un comprobante anotado en dos meses son
-- dos anotaciones, no una que cambia. Un cambio de verdad es el mismo
-- comprobante, en el mismo período, distinto entre dos consultas de ese mes.
--
-- Una alerta falsa cuesta más que no alertar: a la tercera nadie las mira, y
-- entonces tampoco se ve la verdadera.

alter table comprobantes_sunat
  drop constraint comprobantes_sunat_unico;

alter table comprobantes_sunat
  add constraint comprobantes_sunat_unico unique (empresa_ruc, periodo, llave);

-- Los tres cambios registrados son de este error, no de SUNAT.
delete from cambios_comprobante_sunat
where comprobante_id in (
  select id from comprobantes_sunat where tipo_comprobante = '53'
);

-- La función se redefine entera: el único cambio es que la búsqueda del
-- comprobante anterior incluye el período.
--
--   select * into v_antes from comprobantes_sunat
--    where empresa_ruc = p_empresa_ruc
--      and periodo = p_periodo        -- <- esto faltaba
--      and llave = v_llave;
--
-- (el cuerpo completo está en 016_comprobantes_de_sunat.sql; acá solo se
--  cambia esa condición)

create or replace function guardar_comprobantes_sunat(
  p_empresa_ruc text,
  p_periodo     text,
  p_filas       jsonb
) returns table (nuevos integer, cambiados integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos    integer := 0;
  v_cambiados integer := 0;
  f           jsonb;
  v_llave     text;
  v_id        uuid;
  v_antes     comprobantes_sunat%rowtype;
  v_total     numeric(14,2);
  v_estado    text;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema guarda comprobantes de SUNAT.';
  end if;

  for f in select * from jsonb_array_elements(p_filas)
  loop
    -- La llave se arma acá y no se recibe: si viniera de afuera, un error
    -- del lado de la aplicación duplicaría comprobantes en silencio.
    v_llave := coalesce(
      nullif(trim(f->>'carSunat'), ''),
      concat_ws('|',
        coalesce(f->>'ruc', ''), coalesce(f->>'tipoComprobante', ''),
        upper(coalesce(f->>'serie', '')), coalesce(f->>'numero', '')
      )
    );

    v_total  := nullif(f->>'total', '')::numeric;
    v_estado := nullif(trim(f->>'estado'), '');

    -- Con el período en la búsqueda: la anotación de agosto y la de
    -- setiembre del mismo documento son dos filas, y ninguna se lee como
    -- cambio de la otra.
    select * into v_antes from comprobantes_sunat
     where empresa_ruc = p_empresa_ruc and periodo = p_periodo and llave = v_llave;

    if not found then
      insert into comprobantes_sunat (
        empresa_ruc, periodo, llave, car_sunat, proveedor_ruc, proveedor_nombre,
        tipo_comprobante, serie, numero, fecha_emision, total, moneda, estado,
        tipo_nota, modifica_tipo, modifica_serie, modifica_numero, modifica_fecha
      ) values (
        p_empresa_ruc, p_periodo, v_llave, nullif(trim(f->>'carSunat'), ''),
        nullif(f->>'ruc', ''), nullif(f->>'razonSocial', ''),
        nullif(f->>'tipoComprobante', ''), nullif(f->>'serie', ''), nullif(f->>'numero', ''),
        nullif(f->>'fechaEmision', '')::date, v_total, nullif(f->>'moneda', ''), v_estado,
        nullif(f->>'tipoNota', ''),
        nullif(f#>>'{modifica,tipo}', ''), nullif(f#>>'{modifica,serie}', ''),
        nullif(f#>>'{modifica,numero}', ''), nullif(f#>>'{modifica,fechaEmision}', '')::date
      );
      v_nuevos := v_nuevos + 1;
      continue;
    end if;

    v_id := v_antes.id;

    -- Solo se anota lo que de verdad cambió. Una consulta repetida del mismo
    -- período no debe llenar la historia de filas que dicen lo mismo.
    if v_antes.estado is distinct from v_estado then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'estado', v_antes.estado, v_estado);
      v_cambiados := v_cambiados + 1;
    end if;

    if v_antes.total is distinct from v_total then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'total', v_antes.total::text, v_total::text);
      v_cambiados := v_cambiados + 1;
    end if;

    update comprobantes_sunat
       set estado = v_estado,
           total = v_total,
           proveedor_nombre = coalesce(nullif(f->>'razonSocial', ''), proveedor_nombre),
           ultima_vez = now()
     where id = v_id;
  end loop;

  nuevos := v_nuevos;
  cambiados := v_cambiados;
  return next;
end;
$$;

revoke execute on function guardar_comprobantes_sunat(text, text, jsonb) from public, anon;
grant execute on function guardar_comprobantes_sunat(text, text, jsonb) to authenticated;

-- Supabase concede todo por omisión al crear una tabla.


-- ┌──────────────────────────────────────────────────────────────
-- │ 019_impuestos_de_los_comprobantes.sql
-- └──────────────────────────────────────────────────────────────

-- Los impuestos, que es lo que Contabilidad necesita para el crédito fiscal
--
-- Venían en el archivo del RCE desde el principio y se estaban descartando.
-- Con solo el total no se puede verificar el IGV, que es el trabajo de Rosa.
--
-- El archivo no trae UN igv sino tres, según a qué se destine la compra:
-- gravadas (DG), gravadas y no gravadas (DGNG) y no gravadas (DNG). Esa
-- distinción decide la prorrata del crédito fiscal. Se guardan separados
-- aunque la hoja muestre la suma: juntarlos al guardar perdería el dato para
-- siempre, y separarlos después obligaría a volver a consultar los nueve
-- períodos, con SUNAT limitando cuántas consultas seguidas acepta.

alter table comprobantes_sunat
  add column base_dg    numeric(14,2),
  add column igv_dg     numeric(14,2),
  add column base_dgng  numeric(14,2),
  add column igv_dgng   numeric(14,2),
  add column base_dng   numeric(14,2),
  add column igv_dng    numeric(14,2),
  add column detraccion numeric(14,2),
  add column tipo_cambio numeric(10,4);

comment on column comprobantes_sunat.igv_dg is
  'IGV de compras destinadas a operaciones gravadas: el que da crédito fiscal pleno.';
comment on column comprobantes_sunat.igv_dgng is
  'IGV de compras destinadas a gravadas y no gravadas: va a prorrata.';
comment on column comprobantes_sunat.igv_dng is
  'IGV de compras destinadas a no gravadas: no da crédito fiscal.';
comment on column comprobantes_sunat.detraccion is
  'Monto detraído. En Perú decide si el crédito fiscal se puede usar o se pierde.';

-- Las dos funciones se redefinen para guardar y devolver estos campos. El
-- cuerpo completo se aplicó con la migración «guardar_y_leer_los_impuestos»;
-- lo relevante de aquel cambio:
--
--   · guardar_comprobantes_sunat inserta y actualiza las ocho columnas.
--     Los impuestos NO se anotan como cambio: los comprobantes guardados
--     antes de esta migración los tienen en null, y llenarlos por primera vez
--     marcaría trece mil cambios falsos.
--
--   · historico_comprobantes_sunat devuelve `base` e `igv` como la suma de
--     los tres destinos, más la detracción y el tipo de cambio. El desglose
--     queda en la tabla por si Contabilidad lo pide: separarlo después sería
--     cambiar una columna, no volver a consultar nueve meses.


-- ┌──────────────────────────────────────────────────────────────
-- │ 020_anotar_las_columnas_sin_usar.sql
-- └──────────────────────────────────────────────────────────────

-- Qué columnas trajo el archivo y no se usaron
--
-- Hizo falta al no poder decidir si la detracción viene vacía de verdad o si
-- el lector no la encuentra: la diferencia son dos minutos de arreglo o nada
-- que arreglar, y sin este dato solo se puede averiguar mirando la pantalla
-- en el momento justo de una consulta.
--
-- Anotarlo en cada consulta convierte una pregunta puntual en algo que se
-- responde solo, también la próxima vez que SUNAT cambie el archivo: si un
-- día aparece «Base imponible» entre las no usadas, es que le cambiaron el
-- nombre y el número que muestra la hoja dejó de significar lo que dice.

alter table consultas_sunat
  add column columnas_sin_usar text[] not null default '{}';

comment on column consultas_sunat.columnas_sin_usar is
  'Títulos que trajo el archivo y el lector no supo mapear. Sirve para notar que SUNAT cambió el formato.';

-- registrar_consulta_sunat se redefine con un parámetro más al final,
-- p_columnas_sin_usar, con valor por omisión para no romper a quien la llame
-- sin él. El cuerpo se aplicó con la migración «anotar_las_columnas_sin_usar».


-- ┌──────────────────────────────────────────────────────────────
-- │ 021_el_anexo_del_memo.sql
-- └──────────────────────────────────────────────────────────────

-- El anexo del memo: cuánto le toca a cada persona y por cuántos días
--
-- `memo_asignados` guardaba solo el par memo-persona. El memo real guarda
-- mucho más, y lo guarda en un anexo dentro del Word que nadie abre.
--
-- El memo 594-2026 tiene ONCE personas con TRES montos y TRES tramos de fecha
-- distintos, en el mismo memo:
--
--     4 personas   09/08 al 10/08   S/   212.00
--     6 personas   09/08 al 19/08   S/ 1,164.00
--     1 persona    10/08 al 19/08   S/ 1,232.00
--                                   ───────────
--                                   S/ 9,064.00
--
-- Sin estos campos no se puede hacer casi nada de lo que la aplicación
-- promete: ni generar el memo, ni calcular el saldo de cada quien, ni cruzar
-- lo asignado contra lo que el banco pagó de verdad.
--
-- El tramo importa además por una razón que nadie estaba mirando: la
-- validación de «la fecha del comprobante cae dentro del viaje» se estaba
-- haciendo contra las fechas del memo, que abarcan del 9 al 19. Para quien
-- viajó el 9 y el 10, eso deja pasar nueve días que no le corresponden.

alter table memo_asignados
  add column monto       numeric(12,2),
  add column fecha_desde date,
  add column fecha_hasta date,
  add column descripcion text;

-- Un monto de cero o negativo no es un dato incompleto: es un dato falso.
-- Se prefiere null, que dice «no se sabe», a un cero que dice «no le toca».
alter table memo_asignados
  add constraint memo_asignados_monto_positivo
  check (monto is null or monto > 0);

alter table memo_asignados
  add constraint memo_asignados_tramo_coherente
  check (fecha_desde is null or fecha_hasta is null or fecha_hasta >= fecha_desde);

comment on column memo_asignados.monto is
  'Lo que el anexo del memo le asigna a esta persona. Null en los memos creados antes de que existiera el anexo.';
comment on column memo_asignados.fecha_desde is
  'Inicio del tramo de ESTA persona, que puede no ser el del memo.';
comment on column memo_asignados.fecha_hasta is
  'Fin del tramo de ESTA persona. Es contra esta fecha que se mide si la rendición está vencida.';
comment on column memo_asignados.descripcion is
  'La columna del anexo que en viáticos dice DESCRIPCIÓN y en caja chica ENTREGA A RENDIR.';

-- ────────────────────────────────────────────────────────────────
-- La invariante que ningún CHECK puede expresar
-- ────────────────────────────────────────────────────────────────
--
-- El monto que el memo declara en su párrafo tiene que ser la suma del anexo.
-- Un CHECK no puede abarcar varias filas, así que se expone como función y la
-- aplicación la consulta antes de emitir.
--
-- Esto no es teórico. El memo 194-2026 dice «solicito la asignación de
-- S/ 500.00» en el párrafo y S/ 1,500.00 en la tabla. El seguimiento de
-- Control de Gestión confirma que se abonaron 1,500: el párrafo era el
-- equivocado. Salió, se aprobó y se pagó con esa contradicción encima, y
-- nadie la notó, porque el mismo número hay que escribirlo dos veces a mano.

create or replace function memo_cuadra(p_memo_id uuid)
returns table (
  monto_autorizado numeric,
  suma_anexo       numeric,
  personas         integer,
  sin_monto        integer,
  cuadra           boolean
)
language sql stable security definer set search_path = public as $$
  select
    m.monto_autorizado,
    coalesce(sum(a.monto), 0)                           as suma_anexo,
    count(a.usuario_id)::int                            as personas,
    count(*) filter (where a.monto is null)::int        as sin_monto,
    count(*) filter (where a.monto is null) = 0
      and abs(m.monto_autorizado - coalesce(sum(a.monto), 0)) < 0.005 as cuadra
  from memos m
  left join memo_asignados a on a.memo_id = m.id
  where m.id = p_memo_id
  group by m.id, m.monto_autorizado
$$;

comment on function memo_cuadra(uuid) is
  'El monto del memo contra la suma de su anexo. La aplicación lo consulta antes de emitir: si no cuadra, el memo no sale.';

revoke all on function memo_cuadra(uuid) from public;
grant execute on function memo_cuadra(uuid) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 022_hospedaje_es_un_tipo_de_memo.sql
-- └──────────────────────────────────────────────────────────────

-- Hospedaje: el tipo de memo más frecuente que existe, y no estaba
--
-- Se venía tratando como un viático. No lo es, y los números lo dicen:
--
--   · De los 125 memos que administra Annie: 65 son hospedaje, 45 viáticos
--     y 15 caja chica.
--   · De los 423 asuntos del MemoTracker, 189 dicen HOSPEDAJE y 150 VIÁTICOS.
--
-- Se diferencia del viático en quién gasta: el hospedaje de todo el personal
-- que viaja lo gestiona Administración de forma centralizada, no cada persona
-- por su cuenta. Meterlo en la misma bolsa que los viáticos hacía que el
-- memo más común del año no se pudiera ni contar aparte.
--
-- Va solo en esta migración: PostgreSQL no deja usar un valor de enum recién
-- agregado dentro de la misma transacción que lo agrega.

alter type tipo_memo add value if not exists 'HOSPEDAJE';


-- ┌──────────────────────────────────────────────────────────────
-- │ 023_datos_bancarios_de_la_persona.sql
-- └──────────────────────────────────────────────────────────────

-- La cuenta bancaria vive en la persona, no en el memo
--
-- El anexo del memo imprime el banco, la cuenta y el CCI de cada asignado, así
-- que la aplicación no puede generarlo sin ese dato. La pregunta nunca fue si
-- guardarlo, sino dónde: el número de cuenta no cambia de un memo a otro.
-- Es de la persona, igual que su DNI.
--
-- Hoy vive copiado en cada Word. El anexo del memo 594-2026 lleva las cuentas
-- completas y los CCI de once personas, en un archivo que circula por correo y
-- queda en una carpeta compartida. Concentrarlo en un solo lugar con permisos
-- no es solo más ordenado: son menos copias dando vueltas.
--
-- Va en su propia tabla y no como columnas de `usuarios` por una razón
-- concreta: las políticas de RLS son por FILA, no por columna. La política de
-- lectura de `usuarios` deja ver a toda persona con rol JEFATURA, y una
-- jefatura no tiene por qué ver cuentas bancarias. Separando la tabla, el
-- permiso se puede acotar de verdad.

create table datos_bancarios (
  usuario_id       uuid primary key references usuarios(id) on delete cascade,
  banco            text not null,
  cuenta           text not null,
  -- El código interbancario. Es el que hace falta cuando el pago NO sale por
  -- la planilla de haberes: esa solo alcanza a quien tiene cuenta en el mismo
  -- banco que la empresa. En el memo 594-2026, cuatro de las once personas
  -- tenían Interbank y su plata salió por otra vía, contra este código.
  cci              text,
  actualizado_por  uuid references usuarios(id),
  actualizado_en   timestamptz not null default now()
);

comment on table datos_bancarios is
  'Dónde cobra cada persona. Tabla aparte de usuarios porque RLS es por fila y esto necesita un permiso más estrecho.';

alter table datos_bancarios enable row level security;

-- Quien arma memos lo necesita para generar el anexo. Nadie más: ni la
-- jefatura que aprueba, ni quien revisa la rendición, ni Contabilidad.
-- Si Tesorería llega a necesitarlo dentro de la aplicación, se le agrega su
-- propio rol en vez de ensanchar este.
create policy datos_bancarios_lectura on datos_bancarios for select
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.tiene_rol('ADMIN_MEMOS')
    or seguridad.tiene_rol('ADMIN_SISTEMA')
  );

create policy datos_bancarios_escritura on datos_bancarios for all
  using (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'))
  with check (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'));


-- ┌──────────────────────────────────────────────────────────────
-- │ 024_abreviatura_y_los_ceco_que_faltaban.sql
-- └──────────────────────────────────────────────────────────────

-- La abreviatura del centro de costo, y los tres que no estaban
--
-- Al cruzar el catálogo de Control de Gestión contra la base aparecieron dos
-- cosas.
--
-- La primera: los centros de costo de la base YA SON los proyectos. Sus
-- códigos son PROY-2025-079-5, PROY-2025-146… los mismos que usa Control de
-- Gestión. En su vocabulario «código de proyecto» y «centro de costo» son
-- las dos columnas del mismo renglón: el código y el nombre.
--
-- La segunda: faltaban tres, y entre ellos el más grande.
--
--     PROY-2025-077-3   PRONIED - TALLERES EPT I y II
--     PROY-2025-164-2   TALLERES ESPECIALIZADOS LIMA PROVINCIAS
--     PROY-2025-164-3   LIMA PROVINCIAS - BTD
--
-- El primero es el proyecto del memo de caja chica 194-2026 y el de buena
-- parte de los memos del año. Sin él, esos memos no tenían dónde imputarse.
--
-- La abreviatura no es decoración: es como Control de Gestión los nombra en
-- sus reportes y en las conversaciones. Un memo que dice «TALLERES EPT» se
-- reconoce; uno que dice «PROY-2025-077-3» hay que ir a buscarlo.

alter table centros_costo add column abreviatura text;

comment on column centros_costo.abreviatura is
  'Como lo nombra Control de Gestión en sus reportes. Sale de su catálogo, no se inventa.';

insert into centros_costo (codigo, nombre, empresa_id, activo)
select v.codigo, v.nombre, (select id from empresas where ruc = '20512201611'), true
from (values
  ('PROY-2025-077-3', 'PRONIED - TALLERES EPT I y II'),
  ('PROY-2025-164-2', 'TALLERES ESPECIALIZADOS LIMA PROVINCIAS'),
  ('PROY-2025-164-3', 'LIMA PROVINCIAS - BTD')
) as v(codigo, nombre)
where not exists (select 1 from centros_costo c where c.codigo = v.codigo);

update centros_costo c set abreviatura = v.abreviatura
from (values
  ('PROY-2025-077-3', 'TALLERES EPT'),
  ('PROY-2025-079-5', 'TALLERES ESP'),
  ('PROY-2025-196',   'TALLER ESP - IE JUAN ESPINOZA'),
  ('PROY-2025-164-2', 'TALLER ESP - IE PEDRO PAULET'),
  ('PROY-2025-164-3', 'TALLER ESP - 11 IE'),
  ('PROY-2025-146',   'LPI - PMESUT - PULIDORA'),
  ('PROY-2025-011-1', 'PAQ 08 - TEC'),
  ('PROY-2025-011-2', 'PAQ 08 - INT')
) as v(codigo, abreviatura)
where c.codigo = v.codigo;

-- El catálogo de Control de Gestión usa «TALLER ESP - IE PEDRO PAULET» para
-- PROY-2025-196 y para PROY-2025-164-2. Dos proyectos, una sola abreviatura.
-- Acá se deja la del 196 apuntando al colegio que su propio nombre declara
-- —IE Juan Espinoza Medrano— y queda anotado para confirmarlo con ellos:
-- si la abreviatura es lo que sale en los reportes, dos iguales significa que
-- alguien está sumando cosas distintas en la misma fila.
create unique index centros_costo_abreviatura_unica
  on centros_costo (abreviatura) where abreviatura is not null;


-- ┌──────────────────────────────────────────────────────────────
-- │ 025_la_caja_chica_y_sus_ciclos.sql
-- └──────────────────────────────────────────────────────────────

-- La caja chica no se cierra: se repone
--
-- Un memo de viáticos nace, se rinde y se cierra. Una caja chica no: cuando
-- se agota, se rinde lo gastado y se vuelve a depositar el mismo fondo. En el
-- seguimiento de Control de Gestión hay 175 de esos ciclos entre 2025 y 2026,
-- repartidos entre seis administradores de caja.
--
-- Y no es mensual, como se dijo en la sesión de trabajo. Los seis ciclos de
-- Gestión de Proyectos se repusieron cada 8 a 12 días: el 11 y el 23 de
-- julio, el 4, el 13 y el 25 de agosto, y el 3 de setiembre. Es el memo más
-- frecuente que existe.
--
-- El modelo separa dos cosas que hoy se confunden:
--
--   · La CAJA es el fondo. Dura, tiene un responsable y una cuenta.
--   · El MEMO es un ciclo de esa caja. Nace, se rinde y se cierra, y el
--     siguiente ciclo es un memo nuevo que apunta al anterior.
--
-- Así cada ciclo queda cerrado y auditable —cuánto se repuso y cuándo— en vez
-- de reabrir algo ya cerrado y perder la historia.

create table cajas_chicas (
  id             uuid primary key default gen_random_uuid(),
  codigo         text not null,
  nombre         text not null,
  empresa_id     uuid not null references empresas(id),
  -- Quien la administra y rinde por ella. En el memo 194-2026 el anexo lo
  -- dice con todas sus letras: «Ejecutor y Administrador de Caja Chica».
  responsable_id uuid not null references usuarios(id),
  activa         boolean not null default true,
  creado_en      timestamptz not null default now(),
  unique (empresa_id, codigo)
);

comment on table cajas_chicas is
  'El fondo, que dura. Los ciclos son los memos que lo reponen.';

create index on cajas_chicas (responsable_id) where activa;

-- ────────────────────────────────────────────────────────────────
-- El memo como ciclo
-- ────────────────────────────────────────────────────────────────

alter table memos
  add column caja_id          uuid references cajas_chicas(id),
  add column ciclo            text,
  add column memo_referido_id uuid references memos(id);

-- El número del ciclo se guarda como texto, tal como está escrito, y NO se
-- usa para ordenar. Hay dos numeraciones dando vueltas sin reconciliar: el
-- memo 194-2026 escribe «CAJA CHICA N° 36» y el seguimiento usa 001-2025,
-- 002-2025… Mientras Control de Gestión no unifique, cualquier código que
-- intente interpretarlas se va a equivocar con una de las dos.
comment on column memos.ciclo is
  'El número del ciclo tal como está escrito. Es una etiqueta, no un orden: hay dos numeraciones sin reconciliar.';

-- La cadena es la que ordena de verdad. Vale para los dos casos que existen:
-- un memo de pasajes que apunta a su viático padre —los 6 del MemoTracker lo
-- hacen— y una reposición que apunta al ciclo anterior.
comment on column memos.memo_referido_id is
  'El memo del que este depende: su viático padre si es de pasajes, o el ciclo anterior si es una reposición.';

create index on memos (caja_id) where caja_id is not null;
create index on memos (memo_referido_id) where memo_referido_id is not null;

-- Un memo no puede apuntarse a sí mismo. No previene un ciclo largo, pero sí
-- el error de un clic que deja un memo colgando de su propio identificador.
alter table memos
  add constraint memos_no_se_refieren_a_si_mismos
  check (memo_referido_id is null or memo_referido_id <> id);

-- Un memo de caja chica sin caja es un memo que no se puede reponer ni
-- auditar. Se marca NOT VALID a propósito: hay cinco memos de prueba
-- anteriores a esto, con montos como 1,000,000.00 y 0.00 y correlativos del
-- formato que quedó descartado. La regla rige de acá en adelante; esas cinco
-- filas quedan a la vista para limpiarlas, en vez de bloquear la migración o
-- inventarles una caja.
alter table memos
  add constraint memos_caja_chica_tiene_caja
  check (tipo <> 'CAJA_CHICA' or caja_id is not null) not valid;

-- ────────────────────────────────────────────────────────────────
-- El saldo del ciclo
-- ────────────────────────────────────────────────────────────────
--
-- No se guarda: se calcula. Un saldo almacenado es un número que alguien
-- tiene que acordarse de actualizar, y que el primer día que nadie actualiza
-- empieza a mentir con toda confianza.

create or replace function saldo_de_caja(p_memo_id uuid)
returns table (
  fondo     numeric,
  rendido   numeric,
  saldo     numeric,
  gastos    integer
)
language sql stable security definer set search_path = public as $$
  select
    m.monto_autorizado,
    coalesce(sum(g.total), 0),
    m.monto_autorizado - coalesce(sum(g.total), 0),
    count(g.id)::int
  from memos m
  left join gastos g on g.memo_id = m.id
  where m.id = p_memo_id
  group by m.id, m.monto_autorizado
$$;

comment on function saldo_de_caja(uuid) is
  'Cuánto queda del ciclo. Se calcula sobre los gastos, nunca se almacena.';

revoke all on function saldo_de_caja(uuid) from public;
grant execute on function saldo_de_caja(uuid) to authenticated;

alter table cajas_chicas enable row level security;

create policy cajas_lectura on cajas_chicas for select
  using (
    responsable_id = (select seguridad.usuario_actual())
    or seguridad.puede_ver_todo()
  );

create policy cajas_escritura on cajas_chicas for all
  using (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'))
  with check (seguridad.tiene_rol('ADMIN_MEMOS') or seguridad.tiene_rol('ADMIN_SISTEMA'));

-- La tabla queda vacía a propósito. Se conocen seis administradores de caja
-- por nombre —Mell Ferrer, Annie Mantilla, Camila GR, Fernando Aroni, Manuel
-- Flores y Allison Solano— pero no sus cuentas ni su correspondencia con los
-- usuarios de la base. Y hay una contradicción sin resolver: el memo 194-2026
-- da la cuenta 260-04033962-0-50 para la caja de Annie y el estado de cuentas
-- del seguimiento anota 570-78577468-0-32. Sembrar datos inventados es peor
-- que una tabla vacía: una tabla vacía se nota.


-- ┌──────────────────────────────────────────────────────────────
-- │ 026_la_planilla_de_movilidad.sql
-- └──────────────────────────────────────────────────────────────

-- La planilla de movilidad, que trae su propia ley al pie
--
-- Las «reglas no escritas» de las entrevistas resultaron estar escritas, en
-- letra chica, en el pie del propio formulario. La base legal es el inciso
-- a1) del artículo 37° del TUO de la Ley del Impuesto a la Renta y el inciso
-- v) del artículo 21° de su Reglamento, y enumera qué hace válido cada
-- desplazamiento: fecha en que se incurrió en el gasto, nombres y apellidos
-- del trabajador, DNI, motivo, destino y monto.
--
-- Y da la regla de qué pasa si falta uno: «sólo inhabilita la planilla para
-- la sustentación del gasto que corresponde a TAL DESPLAZAMIENTO». Se cae la
-- fila, no la planilla. Es exactamente cómo la aplicación trata los gastos.
--
-- La planilla es un contenedor con una fila por desplazamiento. Hoy la
-- rendición la registra como UNA línea con el total —«PLANILLA DE MOVILIDAD
-- 010212, S/ 20.90»— y así se pierde justo el detalle que la ley exige. Acá
-- cada desplazamiento es un gasto y la planilla los agrupa; el total sale de
-- sumar, no de escribir.

create table planillas_movilidad (
  id             uuid primary key default gen_random_uuid(),
  -- El número impreso del talonario. La 009979 es de Kory Sobrino y la
  -- 010212 la usó Wilmer Zamora: es una serie física, comprada, numerada de
  -- fábrica. Va como texto porque no es una cuenta nuestra, y admite null
  -- para el día que se decida emitir con una serie propia.
  numero         text unique,
  usuario_id     uuid not null references usuarios(id),
  memo_id        uuid references memos(id) on delete set null,
  periodo        text,
  fecha_emision  date,
  -- El formulario tiene dos firmas: la del trabajador y una casilla
  -- AUTORIZADO que firma la jefatura. En la sesión de trabajo se dio por
  -- hecho que la movilidad no necesitaba aprobación; el papel dice lo
  -- contrario, y lo firma el mismo Project Manager que firma los memos.
  autorizado_por uuid references usuarios(id),
  autorizado_en  timestamptz,
  creado_por     uuid references usuarios(id),
  creado_en      timestamptz not null default now()
);

comment on table planillas_movilidad is
  'El contenedor firmado. Cada desplazamiento es un gasto de clase MOVILIDAD que apunta acá.';
comment on column planillas_movilidad.numero is
  'El número impreso del talonario. Null si algún día se emite con serie propia.';

create index on planillas_movilidad (usuario_id);
create index on planillas_movilidad (memo_id) where memo_id is not null;

alter table gastos
  add column planilla_movilidad_id uuid references planillas_movilidad(id) on delete set null,
  -- La columna MOTIVO del formulario, que la ley nombra aparte del destino.
  -- En la planilla 009979: motivo «MOVILIDAD OFICINA - DOMICILIO (VISITA
  -- TÉCNICA)», destino «OFICINA - DOMICILIO». El motivo es el porqué; el
  -- destino, el recorrido.
  add column mov_motivo text;

create index on gastos (planilla_movilidad_id) where planilla_movilidad_id is not null;

-- ────────────────────────────────────────────────────────────────
-- Los seis datos que la ley exige, por desplazamiento
-- ────────────────────────────────────────────────────────────────
--
-- No va como CHECK porque dos de los seis —nombres y DNI— no están en la
-- fila del gasto sino en la persona, y porque la aplicación necesita poder
-- guardar un desplazamiento a medio llenar y avisar, no rechazarlo de plano.
-- Devuelve qué falta, para poder decirlo en castellano.

create or replace function faltas_de_movilidad(p_gasto_id uuid)
returns text[]
language sql stable security definer set search_path = public as $$
  select array_remove(array[
    case when g.fecha_emision is null                       then 'la fecha del gasto' end,
    case when coalesce(u.nombre, '') = ''                   then 'el nombre del trabajador' end,
    case when coalesce(u.dni, '') = '' or u.dni_provisional then 'el DNI del trabajador' end,
    case when coalesce(g.mov_motivo, '') = ''               then 'el motivo del desplazamiento' end,
    case when coalesce(g.mov_destino, '') = ''              then 'el destino del desplazamiento' end,
    case when g.total is null or g.total <= 0               then 'el monto gastado' end
  ], null)
  from gastos g
  left join planillas_movilidad p on p.id = g.planilla_movilidad_id
  left join usuarios u on u.id = coalesce(p.usuario_id, g.usuario_id)
  where g.id = p_gasto_id and g.clase = 'MOVILIDAD'
$$;

comment on function faltas_de_movilidad(uuid) is
  'Cuáles de los seis datos que exige el art. 37° a1) le faltan a este desplazamiento. Vacío = sustenta.';

revoke all on function faltas_de_movilidad(uuid) from public;
grant execute on function faltas_de_movilidad(uuid) to authenticated;

alter table planillas_movilidad enable row level security;

create policy planillas_lectura on planillas_movilidad for select
  using (
    usuario_id = (select seguridad.usuario_actual())
    or seguridad.puede_ver_todo()
  );

create policy planillas_escritura on planillas_movilidad for all
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

-- El tope diario ya existía como parámetro pendiente. Se le corrige la
-- descripción con lo que el formulario declara: no es un número que fije
-- Control de Gestión, es un porcentaje de la Remuneración Mínima Vital por
-- trabajador y por día, fijado en el mismo inciso de la Ley del Impuesto a la
-- Renta. El porcentaje y la RMV vigente los confirma Contabilidad, y quedan
-- acá y no en el código porque los dos cambian.
update parametros set
  descripcion = 'Tope diario por trabajador de la planilla de movilidad. Es un porcentaje de la RMV fijado en el art. 37° a1) de la LIR. PENDIENTE: el porcentaje y la RMV vigente los confirma Contabilidad.'
where clave = 'tope_movilidad_dia';


-- ┌──────────────────────────────────────────────────────────────
-- │ 027_el_reembolso_el_tipo_al_reves.sql
-- └──────────────────────────────────────────────────────────────

-- El reembolso, el único tipo que va al revés
--
-- Los otros cuatro tipos entregan plata y después piden cuentas. El
-- reembolso empieza por las cuentas: la persona ya pagó de su bolsillo y
-- pide que le devuelvan. Los comprobantes van ANTES de la aprobación, no
-- después.
--
-- Entra al enum con una advertencia escrita: no hay ni un solo documento de
-- respaldo. Se buscó en las diecisiete hojas del seguimiento y lo que hay es
-- «devolución de saldo» y «reintegro de efectivo», que son plata que vuelve
-- a la empresa —exactamente lo contrario—. El tipo existe porque la jefatura
-- lo nombró en la pizarra, y hasta que aparezca un caso real el modelo es
-- una hipótesis, no un hecho.

alter type tipo_memo add value if not exists 'REEMBOLSO';


-- ┌──────────────────────────────────────────────────────────────
-- │ 028_la_devolucion_del_saldo.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 029_la_solicitud_que_nunca_estuvo.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 030_un_memo_se_paga_en_mas_de_una_planilla.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 031_el_cargo_de_la_persona.sql
-- └──────────────────────────────────────────────────────────────

-- El cargo, que el memo firma y el anexo nombra
--
-- El memo va firmado por alguien con un cargo: en el 594-2026, José Haertel
-- como Project Manager. Y el anexo de caja chica nombra el rol con todas sus
-- letras, «Ejecutor y Administrador de Caja Chica». Un memo generado sin
-- cargo sale con el nombre solo, que no es como se firma un documento
-- dirigido a la Gerencia de Administración y Finanzas.
--
-- El dato ya existía: la hoja «4. Estados Contrato Personal Pa» del
-- seguimiento lo trae por persona, y el lector de la carga ya lo extraía.
-- Solo que no tenía dónde guardarse.

alter table usuarios add column cargo text;

comment on column usuarios.cargo is
  'Como firma y como se le nombra en el anexo. Sale del seguimiento de Control de Gestión.';


-- ┌──────────────────────────────────────────────────────────────
-- │ 032_el_detalle_de_los_comprobantes.sql
-- └──────────────────────────────────────────────────────────────

-- El detalle de los comprobantes, línea por línea
--
-- El registro de compras (RCE) y la tabla `comprobantes_sunat` traen la
-- cabecera: cuánto, de quién, cuándo. No traen en qué se gastó. Ese detalle
-- —«4 CONTENEDOR DE BASURA 240L a 287.29 c/u»— vive solo en el XML del
-- comprobante, que se baja de la pantalla «Consultar Factura y Nota →
-- Descarga masiva» y se importa acá.
--
-- Es un almacén aparte del de `comprobantes_sunat` a propósito: aquel se
-- llena con lo que SUNAT declaró CONTRA la empresa (compras); este se llena
-- con los XML que alguien bajó, que pueden ser recibidos O emitidos, y que
-- pueden no estar en el registro —una boleta, o una factura emitida—. No se
-- fuerza que el comprobante exista en el otro almacén: se enlazan cuando
-- coinciden, por proveedor, tipo, serie y número, no por una llave dura.
--
-- El XML no trae el CAR SUNAT —ese lo asigna SUNAT en el registro, no el
-- emisor—, así que acá la identidad es proveedor + tipo + serie + número.

-- ── El comprobante, uno por XML importado ──
create table cpe_comprobante (
  id                uuid primary key default gen_random_uuid(),

  empresa_ruc       text not null,

  -- De cara a quién se emitió: si el adquiriente es la empresa es recibido
  -- (una compra), si el emisor es la empresa es emitido (una venta). Se
  -- calcula al importar, no se recibe.
  origen            text not null check (origen in ('RECIBIDO', 'EMITIDO', 'OTRO')),

  proveedor_ruc     text,
  proveedor_nombre  text,
  adquiriente_ruc   text,
  adquiriente_nombre text,

  tipo_comprobante  text,
  serie             text,
  -- Sin ceros de relleno, para que calce con `comprobantes_sunat`.
  numero            text,
  fecha_emision     date,
  moneda            text,

  subtotal          numeric(14,2),
  igv               numeric(14,2),
  total             numeric(14,2),

  -- El período tributario en formato yyyymm, derivado de la fecha de emisión,
  -- para poder filtrar la hoja por mes como en el histórico.
  periodo           text,

  -- Dónde quedó archivado el XML físico, si se subió a Drive (fase 2).
  xml_drive_url     text,

  importado_en      timestamptz not null default now(),
  actualizado_en    timestamptz not null default now(),

  -- La identidad de un comprobante para esta empresa. El proveedor entra en
  -- la llave porque una misma serie-número se repite entre emisores distintos.
  constraint cpe_comprobante_unico
    unique (empresa_ruc, tipo_comprobante, serie, numero, proveedor_ruc)
);

comment on table cpe_comprobante is
  'Comprobantes cuyo XML se importó desde la descarga masiva de SUNAT. Trae el detalle de ítems, que el registro de compras no tiene.';

create index cpe_comprobante_periodo_idx
  on cpe_comprobante (empresa_ruc, periodo, fecha_emision);
create index cpe_comprobante_proveedor_idx
  on cpe_comprobante (empresa_ruc, proveedor_ruc);
-- Para enlazar con comprobantes_sunat sin una llave dura.
create index cpe_comprobante_identidad_idx
  on cpe_comprobante (empresa_ruc, proveedor_ruc, tipo_comprobante, serie, numero);

-- ── Las líneas de cada comprobante ──
create table cpe_item (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references cpe_comprobante(id) on delete cascade,
  -- El orden de la línea dentro del comprobante.
  linea           int not null,
  descripcion     text,
  cantidad        numeric(14,4),
  -- Código de unidad de SUNAT: NIU (unidad), GLL (galón), ZZ (servicio)...
  unidad          text,
  precio_unitario numeric(14,4),
  importe         numeric(14,2),

  constraint cpe_item_unico unique (comprobante_id, linea)
);

create index cpe_item_del_comprobante_idx on cpe_item (comprobante_id, linea);

alter table cpe_comprobante enable row level security;
alter table cpe_item        enable row level security;

-- Lo mismo que el resto de datos de SUNAT: es del estado tributario de la
-- empresa, no de una persona. Lo ve quien puede ver todos los gastos.
create policy cpe_comprobante_lectura on cpe_comprobante for select using (
  seguridad.puede_ver_todo()
);
create policy cpe_item_lectura on cpe_item for select using (
  seguridad.puede_ver_todo()
);

/**
 * Guarda un lote de comprobantes con sus ítems.
 *
 * Recibe todo junto —cabecera e ítems por comprobante— porque un ZIP de
 * descarga masiva trae cientos, y uno por uno no entraría en el minuto de
 * vida de una petición.
 *
 * Un comprobante que ya estaba se actualiza y se le reemplazan los ítems: la
 * fuente de verdad es el XML recién importado, no lo que hubiera antes. Así
 * reimportar el mismo ZIP no duplica nada.
 */
create or replace function guardar_cpe(
  p_empresa_ruc text,
  p_docs        jsonb
) returns table (nuevos integer, actualizados integer, items integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos        integer := 0;
  v_actualizados  integer := 0;
  v_items         integer := 0;
  d               jsonb;
  it              jsonb;
  v_id            uuid;
  v_existe        boolean;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema importa comprobantes de SUNAT.';
  end if;

  for d in select * from jsonb_array_elements(p_docs)
  loop
    select id into v_id from cpe_comprobante
     where empresa_ruc      = p_empresa_ruc
       and tipo_comprobante is not distinct from nullif(d->>'tipoComprobante', '')
       and serie            is not distinct from nullif(d->>'serie', '')
       and numero           is not distinct from nullif(d->>'numero', '')
       and proveedor_ruc    is not distinct from nullif(d->>'proveedorRuc', '');

    v_existe := v_id is not null;

    if v_existe then
      update cpe_comprobante set
        origen             = d->>'origen',
        proveedor_nombre   = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc    = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre = nullif(d->>'adquirienteNombre', ''),
        fecha_emision      = nullif(d->>'fechaEmision', '')::date,
        moneda             = nullif(d->>'moneda', ''),
        subtotal           = nullif(d->>'subtotal', '')::numeric,
        igv                = nullif(d->>'igv', '')::numeric,
        total              = nullif(d->>'total', '')::numeric,
        periodo            = nullif(d->>'periodo', ''),
        actualizado_en     = now()
      where id = v_id;
      -- Los ítems se reescriben enteros: es más simple y más correcto que
      -- adivinar cuáles cambiaron línea por línea.
      delete from cpe_item where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', '')
      ) returning id into v_id;
      v_nuevos := v_nuevos + 1;
    end if;

    for it in select * from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb))
    loop
      insert into cpe_item (
        comprobante_id, linea, descripcion, cantidad, unidad, precio_unitario, importe
      ) values (
        v_id,
        coalesce((it->>'linea')::int, 0),
        nullif(it->>'descripcion', ''),
        nullif(it->>'cantidad', '')::numeric,
        nullif(it->>'unidad', ''),
        nullif(it->>'precioUnitario', '')::numeric,
        nullif(it->>'importe', '')::numeric
      )
      on conflict (comprobante_id, linea) do nothing;
      v_items := v_items + 1;
    end loop;
  end loop;

  nuevos := v_nuevos;
  actualizados := v_actualizados;
  items := v_items;
  return next;
end;
$$;

/**
 * El detalle entero como filas planas, una por ítem, para sacarlo a una hoja.
 *
 * Por función y no leyendo las tablas: son miles de líneas y PostgREST corta
 * en mil sin avisar. Trae la cabecera del comprobante repetida en cada línea,
 * que es como una hoja de cálculo lo quiere.
 */
create or replace function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

/** Cuántos comprobantes importados hay y de qué períodos. */
create or replace function periodos_de_cpe()
returns table (periodo text, cuantos bigint)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select periodo, count(*)
  from cpe_comprobante
  where seguridad.puede_ver_todo() and periodo is not null
  group by periodo
  order by periodo desc;
$$;

-- Permisos: Supabase concede todo por omisión al crear una tabla.
revoke all on cpe_comprobante from anon;
revoke all on cpe_item        from anon;
revoke insert, update, delete, truncate, references, trigger
  on cpe_comprobante from authenticated;
revoke insert, update, delete, truncate, references, trigger
  on cpe_item from authenticated;

revoke execute on function guardar_cpe(text, jsonb)   from public, anon;
grant  execute on function guardar_cpe(text, jsonb)   to authenticated;
revoke execute on function detalle_cpe(text)          from anon;
grant  execute on function detalle_cpe(text)          to authenticated;
revoke execute on function periodos_de_cpe()          from anon;
grant  execute on function periodos_de_cpe()          to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 033_el_enlace_de_cada_comprobante.sql
-- └──────────────────────────────────────────────────────────────

-- El enlace de cada comprobante, en la hoja del detalle
--
-- `cpe_comprobante.xml_drive_url` ya existía, pero nadie lo llenaba ni lo
-- devolvía: era la «fase 2» que quedó pendiente. Ahora el scraper archiva
-- cada XML en una carpeta ordenada de Drive y guarda ese enlace; falta que
-- `guardar_cpe` lo acepte y que `detalle_cpe` lo entregue, para que la hoja de
-- Contabilidad tenga, junto a cada línea, el enlace al comprobante del que
-- salió.

create or replace function guardar_cpe(
  p_empresa_ruc text,
  p_docs        jsonb
) returns table (nuevos integer, actualizados integer, items integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos        integer := 0;
  v_actualizados  integer := 0;
  v_items         integer := 0;
  d               jsonb;
  it              jsonb;
  v_id            uuid;
  v_existe        boolean;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema importa comprobantes de SUNAT.';
  end if;

  for d in select * from jsonb_array_elements(p_docs)
  loop
    select id into v_id from cpe_comprobante
     where empresa_ruc      = p_empresa_ruc
       and tipo_comprobante is not distinct from nullif(d->>'tipoComprobante', '')
       and serie            is not distinct from nullif(d->>'serie', '')
       and numero           is not distinct from nullif(d->>'numero', '')
       and proveedor_ruc    is not distinct from nullif(d->>'proveedorRuc', '');

    v_existe := v_id is not null;

    if v_existe then
      update cpe_comprobante set
        origen             = d->>'origen',
        proveedor_nombre   = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc    = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre = nullif(d->>'adquirienteNombre', ''),
        fecha_emision      = nullif(d->>'fechaEmision', '')::date,
        moneda             = nullif(d->>'moneda', ''),
        subtotal           = nullif(d->>'subtotal', '')::numeric,
        igv                = nullif(d->>'igv', '')::numeric,
        total              = nullif(d->>'total', '')::numeric,
        periodo            = nullif(d->>'periodo', ''),
        -- Solo se pisa si el lote trae uno nuevo: reimportar sin Drive (el
        -- ZIP a mano, sin `xmlDriveUrl`) no debe borrar el enlace que ya
        -- había quedado de una corrida del scraper.
        xml_drive_url      = coalesce(nullif(d->>'xmlDriveUrl', ''), xml_drive_url),
        actualizado_en     = now()
      where id = v_id;
      -- Los ítems se reescriben enteros: es más simple y más correcto que
      -- adivinar cuáles cambiaron línea por línea.
      delete from cpe_item where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo, xml_drive_url
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', ''), nullif(d->>'xmlDriveUrl', '')
      ) returning id into v_id;
      v_nuevos := v_nuevos + 1;
    end if;

    for it in select * from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb))
    loop
      insert into cpe_item (
        comprobante_id, linea, descripcion, cantidad, unidad, precio_unitario, importe
      ) values (
        v_id,
        coalesce((it->>'linea')::int, 0),
        nullif(it->>'descripcion', ''),
        nullif(it->>'cantidad', '')::numeric,
        nullif(it->>'unidad', ''),
        nullif(it->>'precioUnitario', '')::numeric,
        nullif(it->>'importe', '')::numeric
      )
      on conflict (comprobante_id, linea) do nothing;
      v_items := v_items + 1;
    end loop;
  end loop;

  nuevos := v_nuevos;
  actualizados := v_actualizados;
  items := v_items;
  return next;
end;
$$;

-- El detalle entero, ahora con el enlace al XML archivado en Drive. El tipo
-- de retorno cambia (una columna más), así que hay que soltar la función
-- antes de recrearla: `create or replace` no permite eso.
drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from anon;
grant  execute on function detalle_cpe(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 034_el_enlace_al_pdf.sql
-- └──────────────────────────────────────────────────────────────

-- El enlace al PDF, junto al del XML
--
-- La hoja de detalle solo traía el enlace al XML: técnicamente correcto —es
-- de ahí que sale el detalle de ítems— pero nadie en Contabilidad quiere
-- abrir un XML para mirar un comprobante. El PDF es la representación visual,
-- y el scraper ya lo archiva junto al XML: falta guardar ese segundo enlace y
-- devolverlo.

alter table cpe_comprobante add column if not exists pdf_drive_url text;

comment on column cpe_comprobante.pdf_drive_url is
  'El PDF del comprobante archivado en Drive, junto al XML. Es el que de verdad se abre para mirarlo.';

create or replace function guardar_cpe(
  p_empresa_ruc text,
  p_docs        jsonb
) returns table (nuevos integer, actualizados integer, items integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos        integer := 0;
  v_actualizados  integer := 0;
  v_items         integer := 0;
  d               jsonb;
  it              jsonb;
  v_id            uuid;
  v_existe        boolean;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema importa comprobantes de SUNAT.';
  end if;

  for d in select * from jsonb_array_elements(p_docs)
  loop
    select id into v_id from cpe_comprobante
     where empresa_ruc      = p_empresa_ruc
       and tipo_comprobante is not distinct from nullif(d->>'tipoComprobante', '')
       and serie            is not distinct from nullif(d->>'serie', '')
       and numero           is not distinct from nullif(d->>'numero', '')
       and proveedor_ruc    is not distinct from nullif(d->>'proveedorRuc', '');

    v_existe := v_id is not null;

    if v_existe then
      update cpe_comprobante set
        origen             = d->>'origen',
        proveedor_nombre   = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc    = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre = nullif(d->>'adquirienteNombre', ''),
        fecha_emision      = nullif(d->>'fechaEmision', '')::date,
        moneda             = nullif(d->>'moneda', ''),
        subtotal           = nullif(d->>'subtotal', '')::numeric,
        igv                = nullif(d->>'igv', '')::numeric,
        total              = nullif(d->>'total', '')::numeric,
        periodo            = nullif(d->>'periodo', ''),
        xml_drive_url      = coalesce(nullif(d->>'xmlDriveUrl', ''), xml_drive_url),
        pdf_drive_url      = coalesce(nullif(d->>'pdfDriveUrl', ''), pdf_drive_url),
        actualizado_en     = now()
      where id = v_id;
      delete from cpe_item where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo,
        xml_drive_url, pdf_drive_url
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', ''),
        nullif(d->>'xmlDriveUrl', ''), nullif(d->>'pdfDriveUrl', '')
      ) returning id into v_id;
      v_nuevos := v_nuevos + 1;
    end if;

    for it in select * from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb))
    loop
      insert into cpe_item (
        comprobante_id, linea, descripcion, cantidad, unidad, precio_unitario, importe
      ) values (
        v_id,
        coalesce((it->>'linea')::int, 0),
        nullif(it->>'descripcion', ''),
        nullif(it->>'cantidad', '')::numeric,
        nullif(it->>'unidad', ''),
        nullif(it->>'precioUnitario', '')::numeric,
        nullif(it->>'importe', '')::numeric
      )
      on conflict (comprobante_id, linea) do nothing;
      v_items := v_items + 1;
    end loop;
  end loop;

  nuevos := v_nuevos;
  actualizados := v_actualizados;
  items := v_items;
  return next;
end;
$$;

drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from anon;
grant  execute on function detalle_cpe(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 035_forma_de_pago_y_detraccion.sql
-- └──────────────────────────────────────────────────────────────

-- Forma de pago, cuotas, detracción, guía y orden de compra
--
-- El XML trae más de lo que se estaba leyendo: la detracción (a qué cuenta,
-- qué porcentaje, cuánto), si el comprobante es al contado o al crédito —y
-- si es al crédito, sus cuotas—, y las referencias a la guía de remisión y
-- la orden de compra. Nada de esto lo trae el registro de compras (RCE):
-- vive solo en el XML, así que solo lo tenemos para lo que el scraper baja.

alter table cpe_comprobante
  add column if not exists forma_pago             text,
  add column if not exists detraccion_cuenta_banco text,
  add column if not exists detraccion_porcentaje   numeric(6,4),
  add column if not exists detraccion_monto        numeric(14,2),
  add column if not exists guia_remision           text,
  add column if not exists orden_compra            text;

comment on column cpe_comprobante.forma_pago is
  '"Contado" o "Credito", tal como lo declara el emisor.';
comment on column cpe_comprobante.detraccion_cuenta_banco is
  'null si el comprobante no está sujeto a detracción.';

-- Las cuotas, una por fila, igual que los ítems: un comprobante al contado
-- no tiene ninguna.
create table cpe_cuota (
  id              uuid primary key default gen_random_uuid(),
  comprobante_id  uuid not null references cpe_comprobante(id) on delete cascade,
  numero          int,
  monto           numeric(14,2),
  fecha_vencimiento date
);

create index cpe_cuota_del_comprobante_idx on cpe_cuota (comprobante_id, numero);

alter table cpe_cuota enable row level security;
create policy cpe_cuota_lectura on cpe_cuota for select using (
  seguridad.puede_ver_todo()
);
revoke all on cpe_cuota from anon;
revoke insert, update, delete, truncate, references, trigger on cpe_cuota from authenticated;

create or replace function guardar_cpe(
  p_empresa_ruc text,
  p_docs        jsonb
) returns table (nuevos integer, actualizados integer, items integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos        integer := 0;
  v_actualizados  integer := 0;
  v_items         integer := 0;
  d               jsonb;
  it              jsonb;
  cu              jsonb;
  v_id            uuid;
  v_existe        boolean;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema importa comprobantes de SUNAT.';
  end if;

  for d in select * from jsonb_array_elements(p_docs)
  loop
    select id into v_id from cpe_comprobante
     where empresa_ruc      = p_empresa_ruc
       and tipo_comprobante is not distinct from nullif(d->>'tipoComprobante', '')
       and serie            is not distinct from nullif(d->>'serie', '')
       and numero           is not distinct from nullif(d->>'numero', '')
       and proveedor_ruc    is not distinct from nullif(d->>'proveedorRuc', '');

    v_existe := v_id is not null;

    if v_existe then
      update cpe_comprobante set
        origen                  = d->>'origen',
        proveedor_nombre        = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc         = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre      = nullif(d->>'adquirienteNombre', ''),
        fecha_emision           = nullif(d->>'fechaEmision', '')::date,
        moneda                  = nullif(d->>'moneda', ''),
        subtotal                = nullif(d->>'subtotal', '')::numeric,
        igv                     = nullif(d->>'igv', '')::numeric,
        total                   = nullif(d->>'total', '')::numeric,
        periodo                 = nullif(d->>'periodo', ''),
        xml_drive_url           = coalesce(nullif(d->>'xmlDriveUrl', ''), xml_drive_url),
        pdf_drive_url           = coalesce(nullif(d->>'pdfDriveUrl', ''), pdf_drive_url),
        forma_pago              = nullif(d->>'formaPago', ''),
        detraccion_cuenta_banco = nullif(d->>'detraccionCuentaBanco', ''),
        detraccion_porcentaje   = nullif(d->>'detraccionPorcentaje', '')::numeric,
        detraccion_monto        = nullif(d->>'detraccionMonto', '')::numeric,
        guia_remision           = nullif(d->>'guiaRemision', ''),
        orden_compra            = nullif(d->>'ordenCompra', ''),
        actualizado_en          = now()
      where id = v_id;
      -- Ítems y cuotas se reescriben enteros: es más simple y más correcto
      -- que adivinar cuáles cambiaron uno por uno.
      delete from cpe_item where comprobante_id = v_id;
      delete from cpe_cuota where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo,
        xml_drive_url, pdf_drive_url,
        forma_pago, detraccion_cuenta_banco, detraccion_porcentaje, detraccion_monto,
        guia_remision, orden_compra
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', ''),
        nullif(d->>'xmlDriveUrl', ''), nullif(d->>'pdfDriveUrl', ''),
        nullif(d->>'formaPago', ''), nullif(d->>'detraccionCuentaBanco', ''),
        nullif(d->>'detraccionPorcentaje', '')::numeric, nullif(d->>'detraccionMonto', '')::numeric,
        nullif(d->>'guiaRemision', ''), nullif(d->>'ordenCompra', '')
      ) returning id into v_id;
      v_nuevos := v_nuevos + 1;
    end if;

    for it in select * from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb))
    loop
      insert into cpe_item (
        comprobante_id, linea, descripcion, cantidad, unidad, precio_unitario, importe
      ) values (
        v_id,
        coalesce((it->>'linea')::int, 0),
        nullif(it->>'descripcion', ''),
        nullif(it->>'cantidad', '')::numeric,
        nullif(it->>'unidad', ''),
        nullif(it->>'precioUnitario', '')::numeric,
        nullif(it->>'importe', '')::numeric
      )
      on conflict (comprobante_id, linea) do nothing;
      v_items := v_items + 1;
    end loop;

    for cu in select * from jsonb_array_elements(coalesce(d->'cuotas', '[]'::jsonb))
    loop
      insert into cpe_cuota (comprobante_id, numero, monto, fecha_vencimiento)
      values (
        v_id,
        (cu->>'numero')::int,
        nullif(cu->>'monto', '')::numeric,
        nullif(cu->>'fechaVencimiento', '')::date
      );
    end loop;
  end loop;

  nuevos := v_nuevos;
  actualizados := v_actualizados;
  items := v_items;
  return next;
end;
$$;

-- El detalle entero, con los datos de pago y detracción repetidos en cada
-- ítem —igual que ya se repiten proveedor, tipo, serie—: es una hoja plana,
-- una fila por ítem, y así es como la quiere.
drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto, c.detraccion_cuenta_banco
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from anon;
grant  execute on function detalle_cpe(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 036_corregir_detraccion_y_anticipo.sql
-- └──────────────────────────────────────────────────────────────

-- Corrige la cuenta de detracción y agrega anticipo/documento relacionado
--
-- Un XML real (factura de INROPRIN con detracción y un anticipo aplicado)
-- mostró dos cosas que la migración anterior tenía mal:
--
-- 1. `detraccion_cuenta_banco` se llenaba con el código del bien/servicio
--    sujeto a detracción (catálogo 54 de SUNAT, ej. "037"), no con una
--    cuenta. La cuenta de verdad —la del Banco de la Nación— vive en un
--    bloque distinto del XML (`cac:PaymentMeans`, no `PaymentTerms`). Se
--    agrega una columna aparte para el código, y de ahora en más
--    `detraccion_cuenta_banco` sí trae la cuenta.
--
-- 2. El parser (`lib/sunat/cpe-xml.ts`) tenía un bug de verdad: la cuota de
--    un crédito comparte el mismo `cbc:ID` "FormaPago" que la cabecera, así
--    que la forma de pago quedaba pisada por el valor de la última cuota, y
--    las cuotas nunca se guardaban. Ya está corregido en el parser; esta
--    migración solo trae las columnas para lo que ahora sí se lee bien.
--
-- De paso se agrega el anticipo aplicado y el documento que un comprobante
-- referencia (típico en valorizaciones de obra: "esta factura descuenta el
-- anticipo de la factura E001-1714").

alter table cpe_comprobante
  add column if not exists detraccion_codigo_bien_servicio text,
  add column if not exists anticipo_aplicado                numeric(14,2),
  add column if not exists documento_relacionado             text,
  add column if not exists tipo_documento_relacionado        text;

comment on column cpe_comprobante.detraccion_cuenta_banco is
  'La cuenta del Banco de la Nación (cac:PaymentMeans), no un código. null si no hay detracción.';
comment on column cpe_comprobante.detraccion_codigo_bien_servicio is
  'El código del bien/servicio detraído, catálogo 54 de SUNAT (ej. "037").';

create or replace function guardar_cpe(
  p_empresa_ruc text,
  p_docs        jsonb
) returns table (nuevos integer, actualizados integer, items integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos        integer := 0;
  v_actualizados  integer := 0;
  v_items         integer := 0;
  d               jsonb;
  it              jsonb;
  cu              jsonb;
  v_id            uuid;
  v_existe        boolean;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema importa comprobantes de SUNAT.';
  end if;

  for d in select * from jsonb_array_elements(p_docs)
  loop
    select id into v_id from cpe_comprobante
     where empresa_ruc      = p_empresa_ruc
       and tipo_comprobante is not distinct from nullif(d->>'tipoComprobante', '')
       and serie            is not distinct from nullif(d->>'serie', '')
       and numero           is not distinct from nullif(d->>'numero', '')
       and proveedor_ruc    is not distinct from nullif(d->>'proveedorRuc', '');

    v_existe := v_id is not null;

    if v_existe then
      update cpe_comprobante set
        origen                        = d->>'origen',
        proveedor_nombre              = nullif(d->>'proveedorNombre', ''),
        adquiriente_ruc               = nullif(d->>'adquirienteRuc', ''),
        adquiriente_nombre            = nullif(d->>'adquirienteNombre', ''),
        fecha_emision                 = nullif(d->>'fechaEmision', '')::date,
        moneda                        = nullif(d->>'moneda', ''),
        subtotal                      = nullif(d->>'subtotal', '')::numeric,
        igv                           = nullif(d->>'igv', '')::numeric,
        total                         = nullif(d->>'total', '')::numeric,
        periodo                       = nullif(d->>'periodo', ''),
        xml_drive_url                 = coalesce(nullif(d->>'xmlDriveUrl', ''), xml_drive_url),
        pdf_drive_url                 = coalesce(nullif(d->>'pdfDriveUrl', ''), pdf_drive_url),
        forma_pago                    = nullif(d->>'formaPago', ''),
        detraccion_cuenta_banco       = nullif(d->>'detraccionCuentaBanco', ''),
        detraccion_codigo_bien_servicio = nullif(d->>'detraccionCodigoBienServicio', ''),
        detraccion_porcentaje         = nullif(d->>'detraccionPorcentaje', '')::numeric,
        detraccion_monto              = nullif(d->>'detraccionMonto', '')::numeric,
        guia_remision                 = nullif(d->>'guiaRemision', ''),
        orden_compra                  = nullif(d->>'ordenCompra', ''),
        anticipo_aplicado             = nullif(d->>'anticipoAplicado', '')::numeric,
        documento_relacionado         = nullif(d->>'documentoRelacionado', ''),
        tipo_documento_relacionado    = nullif(d->>'tipoDocumentoRelacionado', ''),
        actualizado_en                = now()
      where id = v_id;
      delete from cpe_item where comprobante_id = v_id;
      delete from cpe_cuota where comprobante_id = v_id;
      v_actualizados := v_actualizados + 1;
    else
      insert into cpe_comprobante (
        empresa_ruc, origen, proveedor_ruc, proveedor_nombre,
        adquiriente_ruc, adquiriente_nombre, tipo_comprobante, serie, numero,
        fecha_emision, moneda, subtotal, igv, total, periodo,
        xml_drive_url, pdf_drive_url,
        forma_pago, detraccion_cuenta_banco, detraccion_codigo_bien_servicio,
        detraccion_porcentaje, detraccion_monto,
        guia_remision, orden_compra,
        anticipo_aplicado, documento_relacionado, tipo_documento_relacionado
      ) values (
        p_empresa_ruc, d->>'origen', nullif(d->>'proveedorRuc', ''), nullif(d->>'proveedorNombre', ''),
        nullif(d->>'adquirienteRuc', ''), nullif(d->>'adquirienteNombre', ''),
        nullif(d->>'tipoComprobante', ''), nullif(d->>'serie', ''), nullif(d->>'numero', ''),
        nullif(d->>'fechaEmision', '')::date, nullif(d->>'moneda', ''),
        nullif(d->>'subtotal', '')::numeric, nullif(d->>'igv', '')::numeric,
        nullif(d->>'total', '')::numeric, nullif(d->>'periodo', ''),
        nullif(d->>'xmlDriveUrl', ''), nullif(d->>'pdfDriveUrl', ''),
        nullif(d->>'formaPago', ''), nullif(d->>'detraccionCuentaBanco', ''),
        nullif(d->>'detraccionCodigoBienServicio', ''),
        nullif(d->>'detraccionPorcentaje', '')::numeric, nullif(d->>'detraccionMonto', '')::numeric,
        nullif(d->>'guiaRemision', ''), nullif(d->>'ordenCompra', ''),
        nullif(d->>'anticipoAplicado', '')::numeric,
        nullif(d->>'documentoRelacionado', ''), nullif(d->>'tipoDocumentoRelacionado', '')
      ) returning id into v_id;
      v_nuevos := v_nuevos + 1;
    end if;

    for it in select * from jsonb_array_elements(coalesce(d->'items', '[]'::jsonb))
    loop
      insert into cpe_item (
        comprobante_id, linea, descripcion, cantidad, unidad, precio_unitario, importe
      ) values (
        v_id,
        coalesce((it->>'linea')::int, 0),
        nullif(it->>'descripcion', ''),
        nullif(it->>'cantidad', '')::numeric,
        nullif(it->>'unidad', ''),
        nullif(it->>'precioUnitario', '')::numeric,
        nullif(it->>'importe', '')::numeric
      )
      on conflict (comprobante_id, linea) do nothing;
      v_items := v_items + 1;
    end loop;

    for cu in select * from jsonb_array_elements(coalesce(d->'cuotas', '[]'::jsonb))
    loop
      insert into cpe_cuota (comprobante_id, numero, monto, fecha_vencimiento)
      values (
        v_id,
        (cu->>'numero')::int,
        nullif(cu->>'monto', '')::numeric,
        nullif(cu->>'fechaVencimiento', '')::date
      );
    end loop;
  end loop;

  nuevos := v_nuevos;
  actualizados := v_actualizados;
  items := v_items;
  return next;
end;
$$;

drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  linea int, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric,
  detraccion_cuenta_banco text, detraccion_codigo_bien_servicio text,
  anticipo_aplicado numeric, documento_relacionado text, tipo_documento_relacionado text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto,
    c.detraccion_cuenta_banco, c.detraccion_codigo_bien_servicio,
    c.anticipo_aplicado, c.documento_relacionado, c.tipo_documento_relacionado
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from anon;
grant  execute on function detalle_cpe(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 037_cobertura_cpe.sql
-- └──────────────────────────────────────────────────────────────

-- Cobertura: qué de lo que SUNAT dice que existe ya tiene detalle
--
-- `comprobantes_sunat` (RCE/SIRE) trae TODO lo declarado —13 mil comprobantes,
-- cabecera nomás—. `cpe_comprobante` trae detalle línea por línea, pero solo
-- de lo que el scraper ya bajó —un puñado, mes por mes—. Nadie podía ver, sin
-- consultar la base a mano, cuánto de lo primero ya tiene lo segundo.
--
-- El cruce es el mismo que ya usa el resto del sistema: por
-- proveedor+tipo+serie+número, sin llave dura (`cpe_comprobante_identidad_idx`
-- ya cubre esas cuatro columnas, así que no hace falta un índice nuevo).
--
-- Solo entran los tipos que de verdad tienen un XML en «Consultar Factura y
-- Nota» —01 factura, 03 boleta, 07 nota de crédito, 08 nota de débito—: los
-- demás códigos que trae el RCE (recibos por servicios públicos, DUAs...) no
-- tienen representación ahí, y contarlos como «pendientes» sería mentir sobre
-- cuánto falta.

/** El detalle, comprobante por comprobante: qué hay en el RCE y si ya tiene su XML. */
create or replace function cobertura_cpe(p_periodo text default null)
returns table (
  periodo text, proveedor_ruc text, proveedor_nombre text,
  tipo_comprobante text, serie text, numero text, fecha_emision date, moneda text,
  total_sire numeric, estado text, total_detalle numeric, diferencia numeric, items bigint
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    s.periodo, s.proveedor_ruc, s.proveedor_nombre,
    s.tipo_comprobante, s.serie, s.numero, s.fecha_emision, s.moneda,
    s.total,
    case when c.id is null then 'Sin detalle' else 'Con detalle' end,
    c.total,
    -- La diferencia solo tiene sentido si hay algo con qué comparar.
    case when c.id is null then null else round(s.total - c.total, 2) end,
    coalesce(i.cuantos, 0)
  from comprobantes_sunat s
  left join cpe_comprobante c
    on c.empresa_ruc    = s.empresa_ruc
   and c.proveedor_ruc  = s.proveedor_ruc
   and c.tipo_comprobante = s.tipo_comprobante
   and c.serie          = s.serie
   and c.numero         = s.numero
  left join lateral (
    select count(*) cuantos from cpe_item where comprobante_id = c.id
  ) i on true
  where seguridad.puede_ver_todo()
    and s.tipo_comprobante in ('01', '03', '07', '08')
    and (p_periodo is null or s.periodo = p_periodo)
  order by s.fecha_emision desc, s.serie, s.numero;
$$;

/** El resumen por período: cuántos hay, cuántos con detalle, y el % de avance. */
create or replace function resumen_cobertura_cpe()
returns table (
  periodo text, en_sire bigint, con_detalle bigint, sin_detalle bigint, pct_cobertura numeric
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select
    s.periodo,
    count(*) en_sire,
    count(c.id) con_detalle,
    count(*) - count(c.id) sin_detalle,
    round(count(c.id)::numeric / nullif(count(*), 0) * 100, 1) pct_cobertura
  from comprobantes_sunat s
  left join cpe_comprobante c
    on c.empresa_ruc    = s.empresa_ruc
   and c.proveedor_ruc  = s.proveedor_ruc
   and c.tipo_comprobante = s.tipo_comprobante
   and c.serie          = s.serie
   and c.numero         = s.numero
  where seguridad.puede_ver_todo()
    and s.tipo_comprobante in ('01', '03', '07', '08')
  group by s.periodo
  order by s.periodo desc;
$$;

revoke execute on function cobertura_cpe(text)      from anon;
grant  execute on function cobertura_cpe(text)      to authenticated;
revoke execute on function resumen_cobertura_cpe()  from anon;
grant  execute on function resumen_cobertura_cpe()  to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 038_padron_de_ruc.sql
-- └──────────────────────────────────────────────────────────────

-- El padrón de condición del RUC — Buen Contribuyente / Agente de Retención
--
-- Si a una compra le corresponde o no la retención del IGV depende, entre
-- otras cosas, de si el proveedor es Buen Contribuyente o Agente de
-- Retención/Percepción. Eso no lo trae ni el registro de compras (RCE) ni el
-- XML del comprobante: solo la Consulta RUC pública de SUNAT.
--
-- Esa consulta tiene reCAPTCHA v3 —lo resuelve un navegador de verdad al
-- hacer clic en «Buscar», nunca una petición suelta—, así que la trae el
-- mismo scraper de Playwright que ya baja los XML (`scripts/consultar-padron-ruc.mts`).
--
-- Es una tabla SIN empresa_ruc a propósito: la condición de un RUC ante
-- SUNAT es un dato público del RUC, no algo distinto para cada empresa del
-- grupo que lo consulte. Consultarlo una vez sirve para todas.

create table padron_ruc (
  ruc                 text primary key,
  razon_social        text,

  -- Tal como los devuelve la Consulta RUC: "ACTIVO"/"BAJA...", "HABIDO"/"NO HABIDO".
  estado              text,
  condicion           text,

  buen_contribuyente  boolean not null default false,
  agente_retencion    boolean not null default false,
  agente_percepcion   boolean not null default false,

  -- El texto tal cual bajo «Padrones:», para el caso —resolución, fecha—
  -- que los tres booleanos no alcanzan a explicar. Vacío si es "NINGUNO".
  padrones_detalle    text,

  consultado_en       timestamptz not null default now()
);

comment on table padron_ruc is
  'La condición de cada RUC ante SUNAT (Buen Contribuyente, Agente de Retención/Percepción, Habido), tal como la trae la Consulta RUC pública. No decide si corresponde retener: solo informa la condición del proveedor.';

alter table padron_ruc enable row level security;

-- Lo mismo que el resto de datos de SUNAT: es del estado tributario de un
-- RUC, no de una persona. Lo ve quien puede ver todos los gastos.
create policy padron_ruc_lectura on padron_ruc for select using (
  seguridad.puede_ver_todo()
);

/**
 * Guarda (o actualiza) la condición de uno o varios RUC.
 *
 * Recibe el lote entero de una corrida del scraper, no RUC por RUC: así una
 * corrida de cuarenta RUC es una sola llamada, no cuarenta.
 */
create or replace function guardar_padron_ruc(p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_guardados integer := 0;
  f           jsonb;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema actualiza el padrón de RUC.';
  end if;

  for f in select * from jsonb_array_elements(p_filas)
  loop
    insert into padron_ruc (
      ruc, razon_social, estado, condicion,
      buen_contribuyente, agente_retencion, agente_percepcion,
      padrones_detalle, consultado_en
    ) values (
      f->>'ruc', nullif(f->>'razonSocial', ''), nullif(f->>'estado', ''), nullif(f->>'condicion', ''),
      coalesce((f->>'buenContribuyente')::boolean, false),
      coalesce((f->>'agenteRetencion')::boolean, false),
      coalesce((f->>'agentePercepcion')::boolean, false),
      nullif(f->>'padronesTexto', ''), now()
    )
    on conflict (ruc) do update set
      razon_social       = excluded.razon_social,
      estado             = excluded.estado,
      condicion          = excluded.condicion,
      buen_contribuyente = excluded.buen_contribuyente,
      agente_retencion   = excluded.agente_retencion,
      agente_percepcion  = excluded.agente_percepcion,
      padrones_detalle   = excluded.padrones_detalle,
      consultado_en      = now();
    v_guardados := v_guardados + 1;
  end loop;

  return v_guardados;
end;
$$;

/**
 * Los RUC de proveedor que hay en el registro de compras y todavía no están
 * en el padrón, o llevan más de `p_dias_vigencia` sin consultarse.
 *
 * La usa el scraper para saber a quién consultar, sin traer el padrón
 * completo ni repetir en SQL la lista de proveedores que ya vive en
 * `comprobantes_sunat`.
 */
create or replace function rucs_por_actualizar_en_padron(p_dias_vigencia int default 30)
returns table (ruc text)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select distinct c.proveedor_ruc as ruc
  from comprobantes_sunat c
  left join padron_ruc p on p.ruc = c.proveedor_ruc
  where seguridad.puede_ver_todo()
    and c.proveedor_ruc is not null
    and (p.ruc is null or p.consultado_en < now() - (p_dias_vigencia || ' days')::interval)
  order by 1;
$$;

revoke all on padron_ruc from anon;
revoke insert, update, delete, truncate, references, trigger
  on padron_ruc from authenticated;

revoke execute on function guardar_padron_ruc(jsonb)             from public, anon;
grant  execute on function guardar_padron_ruc(jsonb)             to authenticated;
revoke execute on function rucs_por_actualizar_en_padron(int)    from anon;
grant  execute on function rucs_por_actualizar_en_padron(int)    to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 039_la_oc_de_cada_comprobante.sql
-- └──────────────────────────────────────────────────────────────

-- La OC de cada comprobante, y su centro de costo
--
-- Las facturas de compra se guardan en Drive, en la carpeta de su orden de
-- compra (el «LINK DE CARPETA» de la base de Control de Gestión). Encontrar
-- la factura dentro de la carpeta une un comprobante de SUNAT con su OC, y por
-- la OC, con el centro de costo que Control de Gestión le asignó. Es lo que la
-- carga a CONCAR necesita y lo que ningún XML trae.
--
-- La captura la hace un Apps Script en una hoja aparte (docs/appscript:
-- CapturaCarpetasOC.gs + LecturaFacturas.gs), que sube aquí lo que vio. El
-- cruce con SUNAT se hace AQUÍ y no en la hoja, y en vivo: una factura que
-- SUNAT reporta días después de que su archivo se capturó se une sola, sin
-- volver a correr nada.
--
-- Tres almacenes:
--   · oc_archivo                  cada archivo visto en una carpeta de OC
--   · oc_base_cg                  el centro de costo de cada OC, según CG
--   · equivalencia_centro_costo   el código de CONCAR de cada centro de costo,
--                                 SOLO si alguien lo confirmó
-- Y una función, vinculos_oc(), que los cruza con comprobantes_sunat.

/** «OC 0115-2026», «115-2026», «2026-0115», «OC2026-0115» → «0115-2026». */
create or replace function oc_normalizada(p text)
returns text
language plpgsql
immutable
set search_path = pg_temp
as $$
declare
  m text[];
begin
  m := regexp_match(coalesce(p, ''), '(\d{1,6})\s*-\s*(20\d\d)(?!\d)');
  if m is not null then
    return lpad(m[1]::int::text, 4, '0') || '-' || m[2];
  end if;
  m := regexp_match(coalesce(p, ''), '(20\d\d)\s*-\s*(\d{1,6})(?!\d)');
  if m is not null then
    return lpad(m[2]::int::text, 4, '0') || '-' || m[1];
  end if;
  return null;
end;
$$;

-- ── Cada archivo visto en una carpeta de OC ──
create table oc_archivo (
  empresa_ruc       text not null,
  -- Tal como viene de la base: puede ser «0115-2026» o, si varias OC
  -- comparten carpeta, «0001-2026 / 0002-2026».
  oc                text not null,
  proveedor_ruc_cg  text,           -- también puede traer varios, con « / »
  proveedor_cg      text,
  carpeta_url       text,
  nombre            text,
  url               text not null,
  tipo_archivo      text,           -- PDF, Imagen, Excel…
  parece            text,           -- FACTURA, GUÍA, PAGO… según el nombre
  serie_en_nombre   text,           -- «F001-18178» si el nombre la trae
  -- Lo que se leyó del documento (LecturaFacturas.gs), si se leyó.
  estado_lectura    text,
  ruc_leido         text,
  serie_leida       text,
  cargado_en        timestamptz not null default now(),
  primary key (empresa_ruc, oc, url)
);

comment on table oc_archivo is
  'Archivos encontrados en las carpetas de OC de Drive, tal como los subió la captura. Se reemplaza entero en cada carga.';

-- ── El centro de costo de cada OC, según la base de Control de Gestión ──
create table oc_base_cg (
  empresa_ruc    text not null,
  oc             text not null,      -- normalizada: «0115-2026»
  cc_codigo      text not null,      -- «PROY-2025-079-5», o «-» en las áreas
  cc_nombre      text not null,
  proveedor_ruc  text,
  fecha_oc       date,
  moneda         text,
  monto          numeric(16,2),      -- suma de MONTO TOTAL de sus líneas, sin IGV
  lineas         int,
  primary key (empresa_ruc, oc, cc_codigo, cc_nombre)
);

comment on table oc_base_cg is
  'Resumen de la base de OC de Control de Gestión: por OC y centro de costo, cuántas líneas, desde cuándo y por cuánto.';

-- ── El código de CONCAR de cada centro de costo ──
-- La llave es el código del proyecto; en las áreas, que no tienen código
-- («-»), es el nombre. Solo lo CONFIRMADO se publica: si hay duda, en blanco.
create table equivalencia_centro_costo (
  cc_clave        text primary key,
  cc_nombre       text,
  concar_codigo   text,
  estado          text not null check (estado in ('CONFIRMADO', 'POR DEFINIR')),
  nota            text,
  actualizado_en  timestamptz not null default now()
);

comment on table equivalencia_centro_costo is
  'Centro de costo de la base de CG → código de CONCAR (tabla T.G. 05). Solo lo CONFIRMADO sale en las hojas.';

insert into equivalencia_centro_costo (cc_clave, cc_nombre, concar_codigo, estado, nota) values
  ('PROY-2025-077-3', 'PRONIED - TALLERES EPT I y II', '30015', 'CONFIRMADO',
   'Confirmado el 24/09/2026. No usar 30017.'),
  ('PROY-2025-079-5', 'PRONIED - TALLERES ESPECIALIZADO', '30016', 'CONFIRMADO',
   'Confirmado el 28/09/2026.');

alter table oc_archivo                enable row level security;
alter table oc_base_cg                enable row level security;
alter table equivalencia_centro_costo enable row level security;

create policy oc_archivo_lectura on oc_archivo for select using (seguridad.puede_ver_todo());
create policy oc_base_cg_lectura on oc_base_cg for select using (seguridad.puede_ver_todo());
create policy equivalencia_cc_lectura on equivalencia_centro_costo for select using (seguridad.puede_ver_todo());

revoke all on oc_archivo, oc_base_cg, equivalencia_centro_costo from anon;
revoke insert, update, delete, truncate, references, trigger
  on oc_archivo, oc_base_cg, equivalencia_centro_costo from authenticated;
grant select on oc_archivo, oc_base_cg, equivalencia_centro_costo to authenticated;

/**
 * Sube una parte de la captura: 'ARCHIVOS' (oc_archivo) o 'BASE_CG'
 * (oc_base_cg). Va por lotes, porque son miles de filas y una petición tiene
 * un minuto de vida: el primer lote llega con p_desde_cero = true y borra lo
 * anterior de esa parte; los siguientes solo agregan. Así una carga nueva
 * reemplaza a la anterior entera y no quedan archivos que ya no existen.
 */
create or replace function cargar_captura_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga la captura de OC.';
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      delete from oc_archivo where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_archivo (
      empresa_ruc, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    -- distinct on: un mismo archivo dos veces en el lote haría fallar el insert.
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serieEnNombre'), ''),
           nullif(f->>'estadoLectura', ''), nullif(f->>'rucLeido', ''), nullif(upper(f->>'serieLeida'), '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, estado_lectura = excluded.estado_lectura,
      ruc_leido = excluded.ruc_leido, serie_leida = excluded.serie_leida, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'BASE_CG' then
    if p_desde_cero then
      delete from oc_base_cg where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_base_cg (empresa_ruc, oc, cc_codigo, cc_nombre, proveedor_ruc, fecha_oc, moneda, monto, lineas)
    -- Se agrupa antes: «115-2026» y «0115-2026» son la misma OC, y dos filas
    -- con la misma llave en un lote harían fallar el insert.
    select p_empresa_ruc, k.oc, k.cc_codigo, k.cc_nombre, max(k.ruc), min(k.fecha),
           max(k.moneda), sum(k.monto), sum(k.lineas)
      from (
        select oc_normalizada(f->>'oc') oc, coalesce(nullif(f->>'ccCodigo', ''), '-') cc_codigo,
               coalesce(f->>'ccNombre', '') cc_nombre, nullif(f->>'proveedorRuc', '') ruc,
               nullif(f->>'fechaOc', '')::date fecha, nullif(f->>'moneda', '') moneda,
               nullif(f->>'monto', '')::numeric monto, coalesce(nullif(f->>'lineas', '')::int, 1) lineas
          from jsonb_array_elements(p_filas) f
      ) k
     where k.oc is not null
     group by k.oc, k.cc_codigo, k.cc_nombre
    on conflict (empresa_ruc, oc, cc_codigo, cc_nombre) do update set
      proveedor_ruc = coalesce(excluded.proveedor_ruc, oc_base_cg.proveedor_ruc),
      fecha_oc = least(excluded.fecha_oc, oc_base_cg.fecha_oc),
      moneda = coalesce(excluded.moneda, oc_base_cg.moneda),
      monto = coalesce(oc_base_cg.monto, 0) + coalesce(excluded.monto, 0),
      lineas = oc_base_cg.lineas + excluded.lineas;
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera ARCHIVOS o BASE_CG.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_captura_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_captura_oc(text, text, jsonb, boolean) to authenticated;

/**
 * El cruce: qué comprobante de SUNAT está en la carpeta de qué OC.
 *
 * Tres maneras, de la más segura a la menos:
 *   1. Lo leído del documento: RUC emisor + serie-número exactos.
 *   2. La serie-número del nombre del archivo, con el RUC del proveedor de la
 *      OC; o, si ese número lo tiene un solo emisor en SUNAT, ese (flete,
 *      aduana: otro proveedor dentro de la carpeta de la OC).
 *   3. Un nombre de factura sin serie («FT 9852.pdf»): un número que solo un
 *      comprobante del proveedor de la OC tiene.
 *
 * Una fila por comprobante y OC, con el centro de costo principal de la OC
 * (el de más líneas), su código CONCAR si está confirmado, y alertas para
 * revisar: factura anterior a la OC, más cara que la OC, de otro proveedor,
 * o un RUC mal escrito en la base.
 */
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text
)
language sql
stable
set search_path = public, pg_temp
as $$
  with arch as (
    select a.url, a.nombre, a.parece, oc_normalizada(o.oc1) oc_n,
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           -- el OCR lee «FO01» por «F001»: la O dentro de la serie es un cero
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
     where a.empresa_ruc = p_empresa_ruc
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
  ),
  -- Cuántos emisores tienen cada serie-número: si es uno solo, el número
  -- basta para saber de quién es aunque no sea el proveedor de la OC.
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.proveedor_ruc = a.ruc_leido
                  and s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, s.*, 2 prioridad, 'Nombre del archivo'::text fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, s.*, 3 prioridad, 'Nombre del archivo (número sin serie)'::text fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  mejor as (
    -- Un comprobante por OC, con la manera más segura en que se encontró.
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc
     group by b.oc
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         r.cc_codigo, r.cc_nombre,
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end
         ), '')
    from mejor m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when r.cc_codigo <> '-' then r.cc_codigo else r.cc_nombre end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;

-- ── Las dos hojas publicadas, con la OC al final ──
--
-- Las columnas nuevas van AL FINAL, para no correr las que alguien ya tenga
-- referenciadas. Si un comprobante está en más de una OC, van juntas con « / ».

create or replace function historico_comprobantes_sunat(p_periodo text default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with cambios as (
    select comprobante_id, count(*) n
    from cambios_comprobante_sunat
    group by comprobante_id
  ),
  vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.alertas, '; ') alertas
      from vinculos_oc() v
     group by 1, 2, 3, 4
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
      'cambios',          coalesce(x.n, 0),
      -- La suma de los tres destinos. El desglose queda en la tabla por si
      -- Contabilidad lo pide: separarlo despues seria cambiar una columna, no
      -- volver a consultar nueve meses.
      'base',             nullif(coalesce(c.base_dg,0) + coalesce(c.base_dgng,0) + coalesce(c.base_dng,0), 0),
      'igv',              nullif(coalesce(c.igv_dg,0) + coalesce(c.igv_dgng,0) + coalesce(c.igv_dng,0), 0),
      'detraccion',       c.detraccion,
      'tipoCambio',       c.tipo_cambio,
      'ocCarpeta',        v.oc,
      'centroCostoCg',    v.cc,
      'codigoConcar',     v.concar,
      'alertasOc',        v.alertas
    ) as fila
    from comprobantes_sunat c
    left join cambios x on x.comprobante_id = c.id
    left join vinc v
           on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
          and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
    where p_periodo is null or c.periodo = p_periodo
  ) t;
$$;

-- detalle_cpe cambia las columnas que devuelve: hay que borrarla y crearla.
drop function if exists detalle_cpe(text);

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text,
  serie text, numero text, fecha_emision date, moneda text, linea integer, descripcion text,
  cantidad numeric, unidad text, precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text, forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text,
  detraccion_codigo_bien_servicio text, anticipo_aplicado numeric, documento_relacionado text,
  tipo_documento_relacionado text,
  oc_carpeta text, centro_costo_cg text, codigo_concar text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  with vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar
      from vinculos_oc() v
     group by 1, 2, 3, 4
  )
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto,
    c.detraccion_cuenta_banco, c.detraccion_codigo_bien_servicio,
    c.anticipo_aplicado, c.documento_relacionado, c.tipo_documento_relacionado,
    v.oc, v.cc, v.concar
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  left join vinc v
         on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
        and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from public, anon;
grant execute on function detalle_cpe(text) to authenticated, service_role;


-- ┌──────────────────────────────────────────────────────────────
-- │ 040_el_cruce_de_oc_sin_mirar_fila_por_fila.sql
-- └──────────────────────────────────────────────────────────────

-- El cruce de OC, sin mirar el permiso fila por fila
--
-- vinculos_oc() corría con las políticas de fila de quien lo llamaba: para
-- cada fila de oc_archivo, comprobantes_sunat y oc_base_cg se volvía a
-- preguntar si el usuario puede ver todo (cuatro consultas por fila). Como
-- dueño de la base tardaba 0,6 s; como la cuenta ROBOT, 15 s, y la petición se
-- cortaba por tiempo («canceling statement due to statement timeout»). Como
-- historico_comprobantes_sunat la llama, también habría tumbado la hoja diaria.
--
-- Ahora es security definer —igual que detalle_cpe— y el permiso se mira una
-- sola vez al comienzo: quien no puede ver todo recibe cero filas.

create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez. Con las políticas de fila, se miraba en cada
  -- fila de cada tabla —cuatro consultas por fila, sobre decenas de miles— y
  -- el cruce pasaba de 0,6 s a 15 s, más que el límite de una petición.
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, oc_normalizada(o.oc1) oc_n,
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           -- el OCR lee «FO01» por «F001»: la O dentro de la serie es un cero
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  -- Cuántos emisores tienen cada serie-número: si es uno solo, el número
  -- basta para saber de quién es aunque no sea el proveedor de la OC.
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.proveedor_ruc = a.ruc_leido
                  and s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, s.*, 2 prioridad, 'Nombre del archivo'::text fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, s.*, 3 prioridad, 'Nombre del archivo (número sin serie)'::text fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  mejor as (
    -- Un comprobante por OC, con la manera más segura en que se encontró.
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc
     group by b.oc
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         r.cc_codigo, r.cc_nombre,
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end
         ), '')
    from mejor m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when r.cc_codigo <> '-' then r.cc_codigo else r.cc_nombre end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 041_el_archivo_que_confirmo_el_vinculo.sql
-- └──────────────────────────────────────────────────────────────

-- El archivo que confirmó el vínculo con la OC, en las dos hojas
--
-- vinculos_oc() ya trae `archivo` (el nombre) y `archivo_url` (el enlace de
-- Drive) del archivo que hizo match con el comprobante —es la evidencia de
-- POR QUÉ se unió con esa OC—, pero ni historico_comprobantes_sunat() ni
-- detalle_cpe() los pasaban a la hoja: se quedaban en el camino. Sin eso,
-- revisar una alerta («RUC mal escrito», «factura mayor que la OC») obliga a
-- ir a buscar a mano en la hoja de captura de OC cuál archivo fue.
--
-- De paso, sirve como seguimiento REFERENCIAL de qué OC no tienen nada
-- subido a Drive todavía: si estas dos columnas salen vacías para un
-- comprobante que sí tiene «OC (carpeta)» en blanco, es porque no hay ningún
-- archivo en Drive que la captura haya podido cruzar con él —no reemplaza
-- una auditoría real de la carpeta, pero avisa dónde mirar—.

drop function if exists detalle_cpe(text);

create or replace function historico_comprobantes_sunat(p_periodo text default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with cambios as (
    select comprobante_id, count(*) n
    from cambios_comprobante_sunat
    group by comprobante_id
  ),
  vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.alertas, '; ') alertas,
           string_agg(distinct v.archivo, ' / ') archivo,
           string_agg(distinct v.archivo_url, ' / ') archivo_url
      from vinculos_oc() v
     group by 1, 2, 3, 4
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
      'cambios',          coalesce(x.n, 0),
      -- La suma de los tres destinos. El desglose queda en la tabla por si
      -- Contabilidad lo pide: separarlo despues seria cambiar una columna, no
      -- volver a consultar nueve meses.
      'base',             nullif(coalesce(c.base_dg,0) + coalesce(c.base_dgng,0) + coalesce(c.base_dng,0), 0),
      'igv',              nullif(coalesce(c.igv_dg,0) + coalesce(c.igv_dgng,0) + coalesce(c.igv_dng,0), 0),
      'detraccion',       c.detraccion,
      'tipoCambio',       c.tipo_cambio,
      'ocCarpeta',        v.oc,
      'centroCostoCg',    v.cc,
      'codigoConcar',     v.concar,
      'alertasOc',        v.alertas,
      'archivoOc',        v.archivo,
      'archivoOcUrl',     v.archivo_url
    ) as fila
    from comprobantes_sunat c
    left join cambios x on x.comprobante_id = c.id
    left join vinc v
           on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
          and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
    where p_periodo is null or c.periodo = p_periodo
  ) t;
$$;

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text,
  serie text, numero text, fecha_emision date, moneda text, linea integer, descripcion text,
  cantidad numeric, unidad text, precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text, forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text,
  detraccion_codigo_bien_servicio text, anticipo_aplicado numeric, documento_relacionado text,
  tipo_documento_relacionado text,
  oc_carpeta text, centro_costo_cg text, codigo_concar text,
  archivo_oc text, archivo_oc_url text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  with vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.archivo, ' / ') archivo,
           string_agg(distinct v.archivo_url, ' / ') archivo_url
      from vinculos_oc() v
     group by 1, 2, 3, 4
  )
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto,
    c.detraccion_cuenta_banco, c.detraccion_codigo_bien_servicio,
    c.anticipo_aplicado, c.documento_relacionado, c.tipo_documento_relacionado,
    v.oc, v.cc, v.concar,
    v.archivo, v.archivo_url
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  left join vinc v
         on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
        and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from public, anon;
grant execute on function detalle_cpe(text) to authenticated, service_role;


-- ┌──────────────────────────────────────────────────────────────
-- │ 042_el_legajo_de_la_oc.sql
-- └──────────────────────────────────────────────────────────────

-- El legajo de la OC, en las dos hojas de SUNAT
--
-- La captura de carpetas (039) cruza cada factura con su OC usando los
-- enlaces de la base de Control de Gestión. El legajo por OC
-- (docs/appscript/LegajoPorOC.gs) hace lo mismo pero mejor y con más:
--   · parte del cuadro de aprobaciones 2026, que está en vivo, y se actualiza
--     cada noche;
--   · sube a la carpeta de la OC cuando el enlace apunta a una subcarpeta;
--   · lee por dentro (OCR) los PDF escaneados y saca la serie-número;
--   · distingue las OC nacionales (0172-2026) de las de importación
--     (172-2026), que la normalización de 039 junta en una;
--   · y sabe de cada OC la situación del pago, el comprador, el área que la
--     completa y qué documento le falta.
--
-- Los archivos del legajo entran a oc_archivo con su propio ORIGEN, junto a
-- los de la captura: cada carga reemplaza solo lo suyo. Lo que el legajo sabe
-- de cada OC va a oc_legajo. vinculos_oc() usa los dos, y las hojas suman al
-- final: situación del pago, comprador, área, legajo y carpeta de la OC.

-- ── Los archivos, de dos orígenes ──
alter table oc_archivo add column if not exists origen text not null default 'CAPTURA'
  check (origen in ('CAPTURA', 'LEGAJO'));
alter table oc_archivo drop constraint if exists oc_archivo_pkey;
alter table oc_archivo add primary key (empresa_ruc, origen, oc, url);

comment on column oc_archivo.origen is
  'CAPTURA: CapturaCarpetasOC.gs (enlaces de CG). LEGAJO: LegajoPorOC.gs (cuadro de aprobaciones). Cada carga reemplaza solo su origen.';

-- ── Lo que el legajo sabe de cada OC ──
create table if not exists oc_legajo (
  empresa_ruc       text not null,
  -- Ya distinguida: nacional con 4 dígitos (0172-2026), importación con 3
  -- (172-2026). No pasa por oc_normalizada.
  oc                text not null,
  -- El mismo número puede ser de dos OC distintas (los gastos de una
  -- importación llevan su número): la carpeta las separa.
  carpeta_url       text not null default '',
  unidad            text,
  proyecto          text,
  proveedor         text,
  proveedor_ruc     text,
  comprador         text,
  area              text,            -- Compras nacionales / COMEX (importaciones)
  procedencia       text,            -- Nacional / Importación
  situacion_pago    text,            -- PAGADA, APROBADA PAGO PENDIENTE, FALTA APROBACIÓN…
  estatus           text,            -- tal cual en el cuadro de aprobaciones
  estado_aprobacion text,
  fecha_oc          text,
  monto_soles       numeric(16,2),
  forma_pago        text,
  cc_codigo         text,            -- de Control de Gestión, cruzado con la procedencia
  cc_nombre         text,
  estado_revision   text,            -- OK, PENDIENTE, SIN ACCESO…
  le_falta          text,            -- «Guía de remisión, DAM», vacío si está completo
  documentos        jsonb,           -- {"1. Factura": "✓ 1 · F001-123", …}
  revisado_en       timestamptz,
  cargado_en        timestamptz not null default now(),
  primary key (empresa_ruc, oc, carpeta_url)
);

comment on table oc_legajo is
  'Una fila por OC del legajo (LegajoPorOC.gs): situación del pago, comprador, área, documentos que le faltan. Se reemplaza entero en cada carga.';

alter table oc_legajo enable row level security;
drop policy if exists oc_legajo_lectura on oc_legajo;
create policy oc_legajo_lectura on oc_legajo for select using (seguridad.puede_ver_todo());
revoke all on oc_legajo from anon;
revoke insert, update, delete, truncate, references, trigger on oc_legajo from authenticated;
grant select on oc_legajo to authenticated;

-- ── La carga de la captura: ahora solo reemplaza su propio origen ──
create or replace function cargar_captura_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga la captura de OC.';
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      delete from oc_archivo where empresa_ruc = p_empresa_ruc and origen = 'CAPTURA';
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'CAPTURA', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serieEnNombre'), ''),
           nullif(f->>'estadoLectura', ''), nullif(f->>'rucLeido', ''), nullif(upper(f->>'serieLeida'), '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, estado_lectura = excluded.estado_lectura,
      ruc_leido = excluded.ruc_leido, serie_leida = excluded.serie_leida, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'BASE_CG' then
    if p_desde_cero then
      delete from oc_base_cg where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_base_cg (empresa_ruc, oc, cc_codigo, cc_nombre, proveedor_ruc, fecha_oc, moneda, monto, lineas)
    select p_empresa_ruc, k.oc, k.cc_codigo, k.cc_nombre, max(k.ruc), min(k.fecha),
           max(k.moneda), sum(k.monto), sum(k.lineas)
      from (
        select oc_normalizada(f->>'oc') oc, coalesce(nullif(f->>'ccCodigo', ''), '-') cc_codigo,
               coalesce(f->>'ccNombre', '') cc_nombre, nullif(f->>'proveedorRuc', '') ruc,
               nullif(f->>'fechaOc', '')::date fecha, nullif(f->>'moneda', '') moneda,
               nullif(f->>'monto', '')::numeric monto, coalesce(nullif(f->>'lineas', '')::int, 1) lineas
          from jsonb_array_elements(p_filas) f
      ) k
     where k.oc is not null
     group by k.oc, k.cc_codigo, k.cc_nombre
    on conflict (empresa_ruc, oc, cc_codigo, cc_nombre) do update set
      proveedor_ruc = coalesce(excluded.proveedor_ruc, oc_base_cg.proveedor_ruc),
      fecha_oc = least(excluded.fecha_oc, oc_base_cg.fecha_oc),
      moneda = coalesce(excluded.moneda, oc_base_cg.moneda),
      monto = coalesce(oc_base_cg.monto, 0) + coalesce(excluded.monto, 0),
      lineas = oc_base_cg.lineas + excluded.lineas;
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera ARCHIVOS o BASE_CG.', p_parte;
  end if;

  return n;
end;
$$;

/**
 * Sube una parte del legajo: 'LEGAJO' (oc_legajo, una fila por OC) o
 * 'ARCHIVOS' (oc_archivo con origen LEGAJO). Por lotes, como la captura: el
 * primero con p_desde_cero = true borra lo anterior de esa parte.
 */
create or replace function cargar_legajo_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga el legajo de OC.';
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      delete from oc_archivo where empresa_ruc = p_empresa_ruc and origen = 'LEGAJO';
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'LEGAJO', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serie'), ''),
           null, null, null
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'LEGAJO' then
    if p_desde_cero then
      delete from oc_legajo where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_legajo (
      empresa_ruc, oc, carpeta_url, unidad, proyecto, proveedor, proveedor_ruc, comprador, area,
      procedencia, situacion_pago, estatus, estado_aprobacion, fecha_oc, monto_soles, forma_pago,
      cc_codigo, cc_nombre, estado_revision, le_falta, documentos, revisado_en
    )
    select distinct on (f->>'oc', coalesce(f->>'carpetaUrl', ''))
           p_empresa_ruc, f->>'oc', coalesce(f->>'carpetaUrl', ''), nullif(f->>'unidad', ''),
           nullif(f->>'proyecto', ''), nullif(f->>'proveedor', ''), nullif(f->>'proveedorRuc', ''),
           nullif(f->>'comprador', ''), nullif(f->>'area', ''), nullif(f->>'procedencia', ''),
           nullif(f->>'situacionPago', ''), nullif(f->>'estatus', ''), nullif(f->>'estadoAprobacion', ''),
           nullif(f->>'fechaOc', ''), nullif(f->>'montoSoles', '')::numeric, nullif(f->>'formaPago', ''),
           nullif(f->>'ccCodigo', ''), nullif(f->>'ccNombre', ''), nullif(f->>'estadoRevision', ''),
           nullif(f->>'leFalta', ''), f->'documentos', nullif(f->>'revisadoEn', '')::timestamptz
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null
    on conflict (empresa_ruc, oc, carpeta_url) do update set
      unidad = excluded.unidad, proyecto = excluded.proyecto, proveedor = excluded.proveedor,
      proveedor_ruc = excluded.proveedor_ruc, comprador = excluded.comprador, area = excluded.area,
      procedencia = excluded.procedencia, situacion_pago = excluded.situacion_pago,
      estatus = excluded.estatus, estado_aprobacion = excluded.estado_aprobacion,
      fecha_oc = excluded.fecha_oc, monto_soles = excluded.monto_soles, forma_pago = excluded.forma_pago,
      cc_codigo = excluded.cc_codigo, cc_nombre = excluded.cc_nombre,
      estado_revision = excluded.estado_revision, le_falta = excluded.le_falta,
      documentos = excluded.documentos, revisado_en = excluded.revisado_en, cargado_en = now();
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera LEGAJO o ARCHIVOS.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_legajo_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_legajo_oc(text, text, jsonb, boolean) to authenticated;

/** Lo que las hojas dicen del legajo de una OC, en una frase. */
create or replace function texto_del_legajo(p_estado text, p_le_falta text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case
    when p_estado is null then null
    when p_estado ~ '^PENDIENTE' then 'Por revisar'
    when p_estado ~ '^SIN ACCESO' then 'Sin acceso a la carpeta'
    when p_estado ~ '^SIN CARPETA' then 'Sin enlace de carpeta'
    when coalesce(p_le_falta, '') = '' then 'Completo'
    else 'Falta: ' || p_le_falta
  end;
$$;

-- ── El cruce, con los dos orígenes y el legajo ──
-- Cambian las columnas que devuelve: se borra y se vuelve a crear, y con él
-- las dos funciones que lo usan (más abajo).
drop function if exists vinculos_oc(text);

create function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text,
  situacion_pago text, comprador text, area text, legajo text, carpeta_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez (ver 040).
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, a.origen, a.carpeta_url,
           -- La OC del legajo ya viene distinguida (importación con 3 dígitos):
           -- no se normaliza, o se juntaría con la nacional del mismo número.
           case when a.origen = 'LEGAJO' then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.proveedor_ruc = a.ruc_leido
                  and s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 2 prioridad,
           case when a.origen = 'LEGAJO' then 'Legajo (nombre o lectura del archivo)' else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad, 'Nombre del archivo (número sin serie)'::text fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  -- Un comprobante por OC, con la manera más segura; a igual manera, el
  -- legajo antes que la captura (sabe más de la OC).
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              (t.origen = 'LEGAJO') desc, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc and (select ok from permiso)
     group by b.oc
  ),
  leg as (
    select l.*, count(*) over (partition by l.oc) n_mismo_numero
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  con_legajo as (
    -- El legajo de la OC: el de su carpeta si el archivo vino del legajo; si
    -- vino de la captura, el del mismo número solo si no hay duda (uno solo y
    -- nacional: la captura no distingue las importaciones).
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta
      from mejor m
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional'))
         limit 1
      ) l on true
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         coalesce(m.l_cc_codigo, r.cc_codigo), coalesce(m.l_cc_nombre, r.cc_nombre),
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null and m.l_cc_codigo is null and m.l_cc_nombre is null
                then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 and m.l_cc_nombre is null then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end,
           case when m.l_situacion = 'ANULADA' then 'la OC está anulada en el cuadro de aprobaciones' end
         ), ''),
         m.l_situacion, m.l_comprador, m.l_area,
         texto_del_legajo(m.l_estado, m.l_falta),
         coalesce(nullif(m.l_carpeta, ''), m.carpeta_url)
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;

-- ── Las dos hojas, con el legajo al final ──
drop function if exists detalle_cpe(text);

create or replace function historico_comprobantes_sunat(p_periodo text default null)
returns jsonb
language sql
stable
set search_path = public, pg_temp
as $$
  with cambios as (
    select comprobante_id, count(*) n
    from cambios_comprobante_sunat
    group by comprobante_id
  ),
  vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.alertas, '; ') alertas,
           string_agg(distinct v.archivo, ' / ') archivo,
           string_agg(distinct v.archivo_url, ' / ') archivo_url,
           string_agg(distinct v.situacion_pago, ' / ') situacion_pago,
           string_agg(distinct v.comprador, ' / ') comprador,
           string_agg(distinct v.area, ' / ') area,
           string_agg(distinct v.legajo, ' / ') legajo,
           string_agg(distinct v.carpeta_url, ' / ') carpeta_url
      from vinculos_oc() v
     group by 1, 2, 3, 4
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
      'cambios',          coalesce(x.n, 0),
      'base',             nullif(coalesce(c.base_dg,0) + coalesce(c.base_dgng,0) + coalesce(c.base_dng,0), 0),
      'igv',              nullif(coalesce(c.igv_dg,0) + coalesce(c.igv_dgng,0) + coalesce(c.igv_dng,0), 0),
      'detraccion',       c.detraccion,
      'tipoCambio',       c.tipo_cambio,
      'ocCarpeta',        v.oc,
      'centroCostoCg',    v.cc,
      'codigoConcar',     v.concar,
      'alertasOc',        v.alertas,
      'archivoOc',        v.archivo,
      'archivoOcUrl',     v.archivo_url,
      'situacionPagoOc',  v.situacion_pago,
      'compradorOc',      v.comprador,
      'areaOc',           v.area,
      'legajoOc',         v.legajo,
      'carpetaOcUrl',     v.carpeta_url
    ) as fila
    from comprobantes_sunat c
    left join cambios x on x.comprobante_id = c.id
    left join vinc v
           on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
          and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
    where p_periodo is null or c.periodo = p_periodo
  ) t;
$$;

create function detalle_cpe(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text,
  serie text, numero text, fecha_emision date, moneda text, linea integer, descripcion text,
  cantidad numeric, unidad text, precio_unitario numeric, importe numeric, total_comprobante numeric,
  enlace_xml text, enlace_pdf text, forma_pago text, guia_remision text, orden_compra text,
  detraccion_porcentaje numeric, detraccion_monto numeric, detraccion_cuenta_banco text,
  detraccion_codigo_bien_servicio text, anticipo_aplicado numeric, documento_relacionado text,
  tipo_documento_relacionado text,
  oc_carpeta text, centro_costo_cg text, codigo_concar text,
  archivo_oc text, archivo_oc_url text,
  situacion_pago_oc text, comprador_oc text, area_oc text, legajo_oc text, carpeta_oc_url text
)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  with vinc as (
    select v.proveedor_ruc, v.tipo_comprobante, v.serie, v.numero,
           string_agg(distinct v.oc, ' / ') oc,
           string_agg(distinct nullif(concat_ws(' ', nullif(v.cc_codigo, '-'), v.cc_nombre), ''), ' / ') cc,
           string_agg(distinct v.concar_codigo, ' / ') concar,
           string_agg(distinct v.archivo, ' / ') archivo,
           string_agg(distinct v.archivo_url, ' / ') archivo_url,
           string_agg(distinct v.situacion_pago, ' / ') situacion_pago,
           string_agg(distinct v.comprador, ' / ') comprador,
           string_agg(distinct v.area, ' / ') area,
           string_agg(distinct v.legajo, ' / ') legajo,
           string_agg(distinct v.carpeta_url, ' / ') carpeta_url
      from vinculos_oc() v
     group by 1, 2, 3, 4
  )
  select
    c.periodo, c.origen, c.proveedor_ruc, c.proveedor_nombre,
    c.tipo_comprobante, c.serie, c.numero, c.fecha_emision, c.moneda,
    i.linea, i.descripcion, i.cantidad, i.unidad, i.precio_unitario, i.importe,
    c.total, c.xml_drive_url, c.pdf_drive_url,
    c.forma_pago, c.guia_remision, c.orden_compra,
    c.detraccion_porcentaje, c.detraccion_monto,
    c.detraccion_cuenta_banco, c.detraccion_codigo_bien_servicio,
    c.anticipo_aplicado, c.documento_relacionado, c.tipo_documento_relacionado,
    v.oc, v.cc, v.concar,
    v.archivo, v.archivo_url,
    v.situacion_pago, v.comprador, v.area, v.legajo, v.carpeta_url
  from cpe_comprobante c
  join cpe_item i on i.comprobante_id = c.id
  left join vinc v
         on v.proveedor_ruc = c.proveedor_ruc and v.tipo_comprobante = c.tipo_comprobante
        and v.serie = upper(c.serie) and v.numero = coalesce(nullif(ltrim(c.numero, '0'), ''), '0')
  where seguridad.puede_ver_todo()
    and (p_periodo is null or c.periodo = p_periodo)
  order by c.fecha_emision, c.serie, c.numero, i.linea;
$$;

revoke execute on function detalle_cpe(text) from public, anon;
grant execute on function detalle_cpe(text) to authenticated, service_role;


-- ┌──────────────────────────────────────────────────────────────
-- │ 043_lectura_de_cpe_sin_evaluar_por_fila.sql
-- └──────────────────────────────────────────────────────────────

-- Leer cpe_comprobante / cpe_item / cpe_cuota sin evaluar la regla por fila
--
-- Las políticas de lectura llamaban a seguridad.puede_ver_todo() tal cual:
-- Postgres la evalúa UNA VEZ POR FILA revisada (4 consultas a roles cada vez).
-- Con ~12 700 comprobantes (30/09/2026) cualquier select directo a
-- cpe_comprobante —incluso de a 50 filas— pasaba el statement_timeout de
-- Supabase («canceling statement due to statement timeout», 57014).
--
-- Envolverla en (select …) la vuelve un «initplan»: se evalúa una sola vez por
-- consulta. Mismo resultado (no depende de la fila), costo constante. Es la
-- recomendación de Supabase para RLS con funciones.
--
-- Mientras no se aplique, scripts/local lee lo ya guardado vía detalle_cpe
-- (security definer), así que nada depende de esta migración para funcionar.

drop policy if exists cpe_comprobante_lectura on cpe_comprobante;
create policy cpe_comprobante_lectura on cpe_comprobante for select using (
  (select seguridad.puede_ver_todo())
);

drop policy if exists cpe_item_lectura on cpe_item;
create policy cpe_item_lectura on cpe_item for select using (
  (select seguridad.puede_ver_todo())
);

drop policy if exists cpe_cuota_lectura on cpe_cuota;
create policy cpe_cuota_lectura on cpe_cuota for select using (
  (select seguridad.puede_ver_todo())
);


-- ┌──────────────────────────────────────────────────────────────
-- │ 044_quitar_cpe_leidos_de_la_constancia.sql
-- └──────────────────────────────────────────────────────────────

-- Quitar los comprobantes guardados desde la constancia (CDR) en vez de la factura
--
-- Algunos emisores que envían por un OSE (COESTI vía Carvajal, entre otros)
-- entregan un zip con DOS XML: la constancia de recepción («R-…xml», un
-- ApplicationResponse) y la factura. Los scripts tomaban el primero, y
-- guardar_cpe recibió la constancia: filas sin RUC del emisor, sin tipo, sin
-- total y sin ítems (109 al 30/09/2026). Desde el mismo día los scripts eligen
-- el XML del comprobante (lib/sunat/cpe-xml.ts → documentoPrincipal) y se
-- niegan a guardar uno sin RUC/serie/número.
--
-- Estas filas no se pueden corregir en el lugar (su identidad es justo lo que
-- falta): se borran, y la próxima corrida de `pnpm cpe:local` vuelve a bajar
-- esos comprobantes —siguen pendientes contra el SIRE— y los guarda bien. Sus
-- archivos en Drive se reconocen por nombre y no se duplican.
--
-- Idempotente: en una base nueva, o ya limpia, no borra nada.

delete from cpe_cuota
 where comprobante_id in (select id from cpe_comprobante where proveedor_ruc is null and tipo_comprobante is null);

delete from cpe_item
 where comprobante_id in (select id from cpe_comprobante where proveedor_ruc is null and tipo_comprobante is null);

delete from cpe_comprobante
 where proveedor_ruc is null and tipo_comprobante is null;


-- ┌──────────────────────────────────────────────────────────────
-- │ 045_la_carpeta_madre_de_compras_nacionales.sql
-- └──────────────────────────────────────────────────────────────

-- La carpeta madre de compras nacionales («5. Ordenes de Compra»)
--
-- Compras guarda cada OC nacional en una carpeta con nombre fijo —«OC 2026 -
-- 0200 COMERCIALIZADORA LUCY - TALLERES ESPECIALIZADOS»— dentro de la
-- carpeta de su proyecto. `scripts/carpetas-oc.mts` (workflow «Carpetas de
-- OC nacionales», cada noche) la recorre con la cuenta de servicio, solo
-- nombres, y sube:
--   · oc_carpeta: una fila por carpeta de OC (OC, proveedor, proyecto, cuántos
--     archivos y comprobantes tiene);
--   · oc_archivo con ORIGEN 'CARPETA': cada archivo, con lo que parece y la
--     serie del comprobante si el nombre la trae.
--
-- vinculos_oc() la usa como una fuente más para unir cada factura de SUNAT
-- con su OC: después del legajo y antes de la captura de CG. Como la carpeta
-- madre es solo de nacionales, la OC ya viene con 4 dígitos y no pasa por
-- oc_normalizada; el RUC del proveedor sale de los nombres de archivo o, si
-- no, de la base de nacionales (oc_legajo).

-- ── Un origen más para los archivos ──
alter table oc_archivo drop constraint if exists oc_archivo_origen_check;
alter table oc_archivo add constraint oc_archivo_origen_check
  check (origen in ('CAPTURA', 'LEGAJO', 'CARPETA'));

comment on column oc_archivo.origen is
  'CAPTURA: CapturaCarpetasOC.gs (enlaces de CG). LEGAJO: LegajoPorOC.gs (cuadro de aprobaciones). CARPETA: scripts/carpetas-oc.mts (carpeta madre de compras nacionales). Cada carga reemplaza solo su origen.';

-- ── Las carpetas de OC de la carpeta madre ──
create table if not exists oc_carpeta (
  empresa_ruc       text not null,
  oc                text not null,     -- «0200-2026» (nacional, 4 dígitos)
  carpeta_url       text not null,
  carpeta_nombre    text,
  tipo              text,              -- OC / OS (comparten la numeración)
  proveedor         text,              -- como está en el nombre de la carpeta
  proyecto          text,              -- lo que va después del último « - »
  proyecto_carpeta  text,              -- la carpeta de proyecto («01) TALLERES ESPECIALIZADOS»)
  archivos          integer,
  comprobantes      integer,
  series            text,              -- «F001-260 / F001-261»
  rucs              text,
  cargado_en        timestamptz not null default now(),
  primary key (empresa_ruc, oc, carpeta_url)
);

comment on table oc_carpeta is
  'Una fila por carpeta de OC en la carpeta madre de compras nacionales (scripts/carpetas-oc.mts). Se reemplaza entera en cada corrida completa.';

alter table oc_carpeta enable row level security;
drop policy if exists oc_carpeta_lectura on oc_carpeta;
create policy oc_carpeta_lectura on oc_carpeta for select using (seguridad.puede_ver_todo());
revoke all on oc_carpeta from anon;
revoke insert, update, delete, truncate, references, trigger on oc_carpeta from authenticated;
grant select on oc_carpeta to authenticated;

/**
 * Sube una parte de la carpeta madre: 'CARPETAS' (oc_carpeta) o 'ARCHIVOS'
 * (oc_archivo con origen CARPETA). Por lotes: el primero con
 * p_desde_cero = true borra lo anterior de esa parte. Una corrida parcial
 * (una sola subcarpeta, o con carpetas que no se pudieron leer) manda
 * siempre false y solo suma.
 */
create or replace function cargar_carpetas_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga las carpetas de OC.';
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      delete from oc_archivo where empresa_ruc = p_empresa_ruc and origen = 'CARPETA';
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'CARPETA', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serie'), ''),
           null, null, null
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'CARPETAS' then
    if p_desde_cero then
      delete from oc_carpeta where empresa_ruc = p_empresa_ruc;
    end if;
    insert into oc_carpeta (
      empresa_ruc, oc, carpeta_url, carpeta_nombre, tipo, proveedor, proyecto, proyecto_carpeta,
      archivos, comprobantes, series, rucs
    )
    select distinct on (f->>'oc', f->>'carpetaUrl')
           p_empresa_ruc, f->>'oc', f->>'carpetaUrl', nullif(f->>'carpetaNombre', ''), nullif(f->>'tipo', ''),
           nullif(f->>'proveedor', ''), nullif(f->>'proyecto', ''), nullif(f->>'proyectoCarpeta', ''),
           nullif(f->>'archivos', '')::integer, nullif(f->>'comprobantes', '')::integer,
           nullif(f->>'series', ''), nullif(f->>'rucs', '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'carpetaUrl', '') is not null
    on conflict (empresa_ruc, oc, carpeta_url) do update set
      carpeta_nombre = excluded.carpeta_nombre, tipo = excluded.tipo, proveedor = excluded.proveedor,
      proyecto = excluded.proyecto, proyecto_carpeta = excluded.proyecto_carpeta,
      archivos = excluded.archivos, comprobantes = excluded.comprobantes,
      series = excluded.series, rucs = excluded.rucs, cargado_en = now();
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera CARPETAS o ARCHIVOS.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_carpetas_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_carpetas_oc(text, text, jsonb, boolean) to authenticated;

-- ── El cruce factura ↔ OC, con la carpeta madre como fuente ──
-- Igual que en 042, con los cambios marcados para el origen CARPETA.
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text,
  situacion_pago text, comprador text, area text, legajo text, carpeta_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez (ver 040).
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, a.origen, a.carpeta_url,
           -- La OC del legajo ya viene distinguida (importación con 3 dígitos):
           -- no se normaliza, o se juntaría con la nacional del mismo número.
           -- La de la carpeta madre ya viene como «0200-2026».
           case when a.origen in ('LEGAJO', 'CARPETA') then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           -- A la carpeta madre el RUC se lo dan los nombres de archivo y, si
           -- no, la base de nacionales (oc_legajo) por el número de la OC.
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') || coalesce(lr.rucs, '{}') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
      left join lateral (
        select array_agg(distinct x) rucs
          from oc_legajo l
          cross join lateral unnest(string_to_array(l.proveedor_ruc, ' / ')) x
         where a.origen = 'CARPETA' and l.empresa_ruc = a.empresa_ruc and l.oc = o.oc1
      ) lr on true
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.proveedor_ruc = a.ruc_leido
                  and s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 2 prioridad,
           case a.origen when 'LEGAJO' then 'Legajo (nombre o lectura del archivo)'
                         when 'CARPETA' then 'Carpeta de compras nacionales (nombre del archivo)'
                         else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad,
           case when a.origen = 'CARPETA' then 'Carpeta de compras nacionales (número sin serie)'
                else 'Nombre del archivo (número sin serie)' end fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  -- Un comprobante por OC, con la manera más segura; a igual manera, el
  -- legajo (sabe más de la OC), después la carpeta madre, después la captura.
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              case t.origen when 'LEGAJO' then 0 when 'CARPETA' then 1 else 2 end, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc and (select ok from permiso)
     group by b.oc
  ),
  leg as (
    select l.*, count(*) over (partition by l.oc) n_mismo_numero
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  con_legajo as (
    -- El legajo de la OC: el de su carpeta si el archivo vino del legajo; si
    -- vino de la captura, el del mismo número solo si no hay duda (uno solo y
    -- nacional: la captura no distingue las importaciones). La carpeta madre
    -- es solo de nacionales: el nacional de ese número.
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta
      from mejor m
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional')
                or (m.origen = 'CARPETA' and l.procedencia = 'Nacional'))
         order by l.carpeta_url
         limit 1
      ) l on true
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         coalesce(m.l_cc_codigo, r.cc_codigo), coalesce(m.l_cc_nombre, r.cc_nombre),
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null and m.l_cc_codigo is null and m.l_cc_nombre is null
                then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 and m.l_cc_nombre is null then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end,
           case when m.l_situacion = 'ANULADA' then 'la OC está anulada en el cuadro de aprobaciones' end
         ), ''),
         m.l_situacion, m.l_comprador, m.l_area,
         texto_del_legajo(m.l_estado, m.l_falta),
         -- La carpeta madre es donde Compras guarda la OC: esa manda.
         case when m.origen = 'CARPETA' then m.carpeta_url else coalesce(nullif(m.l_carpeta, ''), m.carpeta_url) end
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 046_la_carpeta_madre_de_importaciones.sql
-- └──────────────────────────────────────────────────────────────

-- La carpeta madre de importaciones, junto a la de compras nacionales
--
-- `scripts/carpetas-oc.mts` ahora lee también la carpeta de importaciones
-- (PROCEDENCIA=importacion), donde la OC va con 3 dígitos («172-2026»), como
-- en el cuadro de aprobaciones. Cada carpeta madre se carga por separado:
-- una corrida completa de una no debe borrar lo de la otra.
--   · oc_carpeta lleva la procedencia;
--   · cargar_carpetas_oc() la recibe en cada fila («procedencia») y, al
--     empezar de cero, borra solo lo de esa procedencia (en oc_archivo, por
--     los dígitos de la OC). La firma no cambia;
--   · vinculos_oc() busca el legajo de la OC según su procedencia.

alter table oc_carpeta add column if not exists procedencia text not null default 'Nacional'
  check (procedencia in ('Nacional', 'Importación'));

/**
 * Como en 045, con la procedencia de la carpeta madre en cada fila
 * («Nacional» si no viene). Todas las filas de una carga son de la misma.
 */
create or replace function cargar_carpetas_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
  p_procedencia text := coalesce(nullif(p_filas->0->>'procedencia', ''), 'Nacional');
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga las carpetas de OC.';
  end if;

  if p_procedencia not in ('Nacional', 'Importación') then
    raise exception 'Procedencia desconocida: %. Se espera Nacional o Importación.', p_procedencia;
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      -- Solo lo de su carpeta madre: la OC nacional tiene 4 dígitos, la de importación 3.
      delete from oc_archivo
       where empresa_ruc = p_empresa_ruc and origen = 'CARPETA'
         and oc ~ case when p_procedencia = 'Importación' then '^\d{3}-' else '^\d{4}-' end;
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'CARPETA', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serie'), ''),
           null, null, null
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'CARPETAS' then
    if p_desde_cero then
      delete from oc_carpeta where empresa_ruc = p_empresa_ruc and procedencia = p_procedencia;
    end if;
    insert into oc_carpeta (
      empresa_ruc, oc, carpeta_url, carpeta_nombre, tipo, proveedor, proyecto, proyecto_carpeta,
      archivos, comprobantes, series, rucs, procedencia
    )
    select distinct on (f->>'oc', f->>'carpetaUrl')
           p_empresa_ruc, f->>'oc', f->>'carpetaUrl', nullif(f->>'carpetaNombre', ''), nullif(f->>'tipo', ''),
           nullif(f->>'proveedor', ''), nullif(f->>'proyecto', ''), nullif(f->>'proyectoCarpeta', ''),
           nullif(f->>'archivos', '')::integer, nullif(f->>'comprobantes', '')::integer,
           nullif(f->>'series', ''), nullif(f->>'rucs', ''), p_procedencia
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'carpetaUrl', '') is not null
    on conflict (empresa_ruc, oc, carpeta_url) do update set
      carpeta_nombre = excluded.carpeta_nombre, tipo = excluded.tipo, proveedor = excluded.proveedor,
      proyecto = excluded.proyecto, proyecto_carpeta = excluded.proyecto_carpeta,
      archivos = excluded.archivos, comprobantes = excluded.comprobantes,
      series = excluded.series, rucs = excluded.rucs, procedencia = excluded.procedencia, cargado_en = now();
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera CARPETAS o ARCHIVOS.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_carpetas_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_carpetas_oc(text, text, jsonb, boolean) to authenticated;

-- ── El cruce factura ↔ OC, con la carpeta madre como fuente ──
-- Igual que en 045, salvo el legajo y la fuente de una OC de la carpeta de importaciones.
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text,
  situacion_pago text, comprador text, area text, legajo text, carpeta_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez (ver 040).
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, a.origen, a.carpeta_url,
           -- La OC del legajo ya viene distinguida (importación con 3 dígitos):
           -- no se normaliza, o se juntaría con la nacional del mismo número.
           -- La de la carpeta madre ya viene como «0200-2026».
           case when a.origen in ('LEGAJO', 'CARPETA') then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           -- A la carpeta madre el RUC se lo dan los nombres de archivo y, si
           -- no, la base de nacionales (oc_legajo) por el número de la OC.
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') || coalesce(lr.rucs, '{}') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
      left join lateral (
        select array_agg(distinct x) rucs
          from oc_legajo l
          cross join lateral unnest(string_to_array(l.proveedor_ruc, ' / ')) x
         where a.origen = 'CARPETA' and l.empresa_ruc = a.empresa_ruc and l.oc = o.oc1
      ) lr on true
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.proveedor_ruc = a.ruc_leido
                  and s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 2 prioridad,
           case a.origen when 'LEGAJO' then 'Legajo (nombre o lectura del archivo)'
                         when 'CARPETA' then case when a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (nombre del archivo)'
                                                  else 'Carpeta de compras nacionales (nombre del archivo)' end
                         else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad,
           case when a.origen = 'CARPETA' and a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (número sin serie)'
                when a.origen = 'CARPETA' then 'Carpeta de compras nacionales (número sin serie)'
                else 'Nombre del archivo (número sin serie)' end fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  -- Un comprobante por OC, con la manera más segura; a igual manera, el
  -- legajo (sabe más de la OC), después la carpeta madre, después la captura.
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              case t.origen when 'LEGAJO' then 0 when 'CARPETA' then 1 else 2 end, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc and (select ok from permiso)
     group by b.oc
  ),
  leg as (
    select l.*, count(*) over (partition by l.oc) n_mismo_numero
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  con_legajo as (
    -- El legajo de la OC: el de su carpeta si el archivo vino del legajo; si
    -- vino de la captura, el del mismo número solo si no hay duda (uno solo y
    -- nacional: la captura no distingue las importaciones). Desde una carpeta
    -- madre, el de su procedencia (3 dígitos = importación); si hay varios
    -- (los gastos de una importación llevan su número), el de la misma carpeta.
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta
      from mejor m
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional')
                or (m.origen = 'CARPETA'
                    and l.procedencia = case when m.oc_n ~ '^\d{3}-' then 'Importación' else 'Nacional' end))
         order by position(split_part(split_part(coalesce(m.carpeta_url, ''), '/folders/', 2), '?', 1) in l.carpeta_url) > 0 desc,
                  l.carpeta_url
         limit 1
      ) l on true
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         coalesce(m.l_cc_codigo, r.cc_codigo), coalesce(m.l_cc_nombre, r.cc_nombre),
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null and m.l_cc_codigo is null and m.l_cc_nombre is null
                then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 and m.l_cc_nombre is null then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end,
           case when m.l_situacion = 'ANULADA' then 'la OC está anulada en el cuadro de aprobaciones' end
         ), ''),
         m.l_situacion, m.l_comprador, m.l_area,
         texto_del_legajo(m.l_estado, m.l_falta),
         -- La carpeta madre es donde Compras guarda la OC: esa manda.
         case when m.origen = 'CARPETA' then m.carpeta_url else coalesce(nullif(m.l_carpeta, ''), m.carpeta_url) end
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 047_permiso_de_lectura_una_vez_por_consulta.sql
-- └──────────────────────────────────────────────────────────────

-- El permiso de lectura de las tablas de OC, mirado una vez por consulta
--
-- Las políticas decían `using (seguridad.puede_ver_todo())`: Postgres la
-- evaluaba en CADA fila (~1 ms por fila). Leer oc_archivo entera (10 mil
-- filas, de a 1000) tardaba ~10 s por página y la consulta se cortaba por
-- tiempo («canceling statement due to statement timeout»): le pasó a la
-- comparación con CG de scripts/carpetas-oc.mts el 01/10/2026.
--
-- Con `(select …)` se evalúa una sola vez por consulta (un InitPlan). El
-- permiso es el mismo: quien no puede ver todo sigue sin ver ninguna fila.
-- La última página de oc_archivo pasó de ~10 s a 0,15 s.

alter policy oc_archivo_lectura on oc_archivo using ((select seguridad.puede_ver_todo()));
alter policy oc_base_cg_lectura on oc_base_cg using ((select seguridad.puede_ver_todo()));
alter policy oc_legajo_lectura on oc_legajo using ((select seguridad.puede_ver_todo()));
alter policy oc_carpeta_lectura on oc_carpeta using ((select seguridad.puede_ver_todo()));


-- ┌──────────────────────────────────────────────────────────────
-- │ 048_lo_que_dicen_los_archivos_por_dentro.sql
-- └──────────────────────────────────────────────────────────────

-- Lo que dicen POR DENTRO los archivos de las carpetas madre
--
-- `scripts/carpetas-oc.mts` abre los archivos que el nombre no explica
-- («scan001.pdf», «FACTURA LUCY.pdf» sin número, una «INVOICE») y lee qué
-- comprobante traen: el XML o el ZIP, el texto del PDF o, si es un escaneo
-- o una foto, OCR (lib/drive/lectura.ts).
--   · lectura_archivo guarda lo leído de cada archivo de Drive, con la fecha
--     de modificación: la noche siguiente no se vuelve a leer, salvo que el
--     archivo haya cambiado o que la vez anterior diera error;
--   · cargar_carpetas_oc() guarda en oc_archivo el estado, el RUC y la serie
--     leídos, que vinculos_oc() ya usa como la fuente más segura
--     («Lectura del documento»);
--   · vinculos_oc(): una lectura con serie pero sin RUC también vale (ver abajo).

create table if not exists lectura_archivo (
  archivo_id     text primary key,      -- id del archivo en Drive
  modificado     text not null default '',  -- modifiedTime de Drive cuando se leyó
  estado         text not null check (estado in ('LEÍDO', 'SIN COMPROBANTE', 'SIN TEXTO', 'ERROR')),
  metodo         text,                  -- XML, ZIP, TEXTO DEL PDF, OCR, DOCUMENTO DE GOOGLE
  tipo           text,                  -- FACTURA, BOLETA, NOTA DE CRÉDITO…, INVOICE
  serie          text,                  -- F001-260
  ruc            text,                  -- RUC del emisor, validado
  claves         text,                  -- documentos que trae: FACTURA,GUIA,DAM…
  oc_referencia  text,                  -- la OC que cita el XML
  detalle        text,
  leido_en       timestamptz not null default now()
);

comment on table lectura_archivo is
  'Lo leído por dentro de cada archivo de las carpetas madre (scripts/carpetas-oc.mts), para no leerlo dos veces.';

alter table lectura_archivo enable row level security;
create policy lectura_archivo_lectura on lectura_archivo for select using ((select seguridad.puede_ver_todo()));
revoke all on lectura_archivo from anon;
revoke insert, update, delete, truncate, references, trigger on lectura_archivo from authenticated;
grant select on lectura_archivo to authenticated;

/** Guarda (o reemplaza) lo leído de cada archivo. */
create or replace function guardar_lecturas_archivo(p_filas jsonb) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema guarda lecturas de archivos.';
  end if;
  insert into lectura_archivo (archivo_id, modificado, estado, metodo, tipo, serie, ruc, claves, oc_referencia, detalle, leido_en)
  select distinct on (f->>'archivo_id')
         f->>'archivo_id', coalesce(f->>'modificado', ''), f->>'estado', nullif(f->>'metodo', ''),
         nullif(f->>'tipo', ''), nullif(f->>'serie', ''), nullif(f->>'ruc', ''), nullif(f->>'claves', ''),
         nullif(f->>'oc_referencia', ''), nullif(f->>'detalle', ''), now()
    from jsonb_array_elements(p_filas) f
   where nullif(f->>'archivo_id', '') is not null
     and f->>'estado' in ('LEÍDO', 'SIN COMPROBANTE', 'SIN TEXTO', 'ERROR')
  on conflict (archivo_id) do update set
    modificado = excluded.modificado, estado = excluded.estado, metodo = excluded.metodo, tipo = excluded.tipo,
    serie = excluded.serie, ruc = excluded.ruc, claves = excluded.claves, oc_referencia = excluded.oc_referencia,
    detalle = excluded.detalle, leido_en = now();
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function guardar_lecturas_archivo(jsonb) from public, anon;
grant execute on function guardar_lecturas_archivo(jsonb) to authenticated;

/**
 * Como en 046, guardando además lo leído por dentro (estado, RUC y serie).
 */
create or replace function cargar_carpetas_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
  p_procedencia text := coalesce(nullif(p_filas->0->>'procedencia', ''), 'Nacional');
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga las carpetas de OC.';
  end if;

  if p_procedencia not in ('Nacional', 'Importación') then
    raise exception 'Procedencia desconocida: %. Se espera Nacional o Importación.', p_procedencia;
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      -- Solo lo de su carpeta madre: la OC nacional tiene 4 dígitos, la de importación 3.
      delete from oc_archivo
       where empresa_ruc = p_empresa_ruc and origen = 'CARPETA'
         and oc ~ case when p_procedencia = 'Importación' then '^\d{3}-' else '^\d{4}-' end;
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'CARPETA', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serie'), ''),
           nullif(f->>'estadoLectura', ''), nullif(f->>'rucLeido', ''), nullif(upper(f->>'serieLeida'), '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, estado_lectura = excluded.estado_lectura,
      ruc_leido = excluded.ruc_leido, serie_leida = excluded.serie_leida, cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'CARPETAS' then
    if p_desde_cero then
      delete from oc_carpeta where empresa_ruc = p_empresa_ruc and procedencia = p_procedencia;
    end if;
    insert into oc_carpeta (
      empresa_ruc, oc, carpeta_url, carpeta_nombre, tipo, proveedor, proyecto, proyecto_carpeta,
      archivos, comprobantes, series, rucs, procedencia
    )
    select distinct on (f->>'oc', f->>'carpetaUrl')
           p_empresa_ruc, f->>'oc', f->>'carpetaUrl', nullif(f->>'carpetaNombre', ''), nullif(f->>'tipo', ''),
           nullif(f->>'proveedor', ''), nullif(f->>'proyecto', ''), nullif(f->>'proyectoCarpeta', ''),
           nullif(f->>'archivos', '')::integer, nullif(f->>'comprobantes', '')::integer,
           nullif(f->>'series', ''), nullif(f->>'rucs', ''), p_procedencia
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'carpetaUrl', '') is not null
    on conflict (empresa_ruc, oc, carpeta_url) do update set
      carpeta_nombre = excluded.carpeta_nombre, tipo = excluded.tipo, proveedor = excluded.proveedor,
      proyecto = excluded.proyecto, proyecto_carpeta = excluded.proyecto_carpeta,
      archivos = excluded.archivos, comprobantes = excluded.comprobantes,
      series = excluded.series, rucs = excluded.rucs, procedencia = excluded.procedencia, cargado_en = now();
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera CARPETAS o ARCHIVOS.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_carpetas_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_carpetas_oc(text, text, jsonb, boolean) to authenticated;

-- ── El cruce factura ↔ OC, con la carpeta madre como fuente ──
-- Igual que en 046, salvo «por_lectura»: si la lectura encontró la serie pero
-- no el RUC (un escaneo borroso), vale igual que una serie en el nombre: con
-- el RUC del proveedor de la OC, o si ese número lo emitió uno solo.
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text,
  situacion_pago text, comprador text, area text, legajo text, carpeta_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez (ver 040).
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, a.origen, a.carpeta_url,
           -- La OC del legajo ya viene distinguida (importación con 3 dígitos):
           -- no se normaliza, o se juntaría con la nacional del mismo número.
           -- La de la carpeta madre ya viene como «0200-2026».
           case when a.origen in ('LEGAJO', 'CARPETA') then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           -- A la carpeta madre el RUC se lo dan los nombres de archivo y, si
           -- no, la base de nacionales (oc_legajo) por el número de la OC.
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') || coalesce(lr.rucs, '{}') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
      left join lateral (
        select array_agg(distinct x) rucs
          from oc_legajo l
          cross join lateral unnest(string_to_array(l.proveedor_ruc, ' / ')) x
         where a.origen = 'CARPETA' and l.empresa_ruc = a.empresa_ruc and l.oc = o.oc1
      ) lr on true
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
       and (s.proveedor_ruc = a.ruc_leido
            or (a.ruc_leido is null
                and (s.proveedor_ruc = any(a.rucs_cg)
                     or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))))
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 2 prioridad,
           case a.origen when 'LEGAJO' then 'Legajo (nombre o lectura del archivo)'
                         when 'CARPETA' then case when a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (nombre del archivo)'
                                                  else 'Carpeta de compras nacionales (nombre del archivo)' end
                         else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad,
           case when a.origen = 'CARPETA' and a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (número sin serie)'
                when a.origen = 'CARPETA' then 'Carpeta de compras nacionales (número sin serie)'
                else 'Nombre del archivo (número sin serie)' end fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  -- Un comprobante por OC, con la manera más segura; a igual manera, el
  -- legajo (sabe más de la OC), después la carpeta madre, después la captura.
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              case t.origen when 'LEGAJO' then 0 when 'CARPETA' then 1 else 2 end, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc and (select ok from permiso)
     group by b.oc
  ),
  leg as (
    select l.*, count(*) over (partition by l.oc) n_mismo_numero
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  con_legajo as (
    -- El legajo de la OC: el de su carpeta si el archivo vino del legajo; si
    -- vino de la captura, el del mismo número solo si no hay duda (uno solo y
    -- nacional: la captura no distingue las importaciones). Desde una carpeta
    -- madre, el de su procedencia (3 dígitos = importación); si hay varios
    -- (los gastos de una importación llevan su número), el de la misma carpeta.
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta
      from mejor m
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional')
                or (m.origen = 'CARPETA'
                    and l.procedencia = case when m.oc_n ~ '^\d{3}-' then 'Importación' else 'Nacional' end))
         order by position(split_part(split_part(coalesce(m.carpeta_url, ''), '/folders/', 2), '?', 1) in l.carpeta_url) > 0 desc,
                  l.carpeta_url
         limit 1
      ) l on true
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         coalesce(m.l_cc_codigo, r.cc_codigo), coalesce(m.l_cc_nombre, r.cc_nombre),
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null and m.l_cc_codigo is null and m.l_cc_nombre is null
                then 'OC no está en la base de CG' end,
           case when r.n_cc > 1 and m.l_cc_nombre is null then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end,
           case when m.l_situacion = 'ANULADA' then 'la OC está anulada en el cuadro de aprobaciones' end
         ), ''),
         m.l_situacion, m.l_comprador, m.l_area,
         texto_del_legajo(m.l_estado, m.l_falta),
         -- La carpeta madre es donde Compras guarda la OC: esa manda.
         case when m.origen = 'CARPETA' then m.carpeta_url else coalesce(nullif(m.l_carpeta, ''), m.carpeta_url) end
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 049_la_carpeta_madre_como_legajo.sql
-- └──────────────────────────────────────────────────────────────

-- La carpeta madre como legajo: centro de costo, documentos y cambios
--
-- `scripts/carpetas-oc.mts` ya sabía de cada OC sus archivos y comprobantes.
-- Ahora además:
--   · qué documentos tiene y cuál le FALTA (la regla del legajo de
--     LegajoPorOC.gs: factura; guía si es bien; acta si es servicio; DAM si
--     es importación), en oc_carpeta (documentos, le_falta, estado);
--   · su centro de costo: el de la OC en CG (o en el cuadro, si es
--     importación) y, si no está, el de su carpeta de proyecto
--     (lib/drive/legajo-carpeta.ts). La regla por carpeta queda en
--     proyecto_centro_costo, donde Contabilidad puede corregirla: una fila
--     con fuente MANUAL no la vuelve a pisar el script;
--   · qué cambió desde la corrida anterior (OC nuevas o que ya no están,
--     archivos nuevos, eliminados, modificados, OC que se completaron), en
--     carpeta_cambio. Para eso oc_archivo guarda la fecha de modificación.
-- vinculos_oc() usa el centro de costo y el «le falta» de la carpeta cuando
-- la OC no está en CG ni en el legajo del cuadro.

alter table oc_archivo add column modificado text;

alter table oc_carpeta add column cc_codigo text;
alter table oc_carpeta add column cc_nombre text;
alter table oc_carpeta add column cc_fuente text;     -- CG, CUADRO, NOMBRE, ADMINISTRATIVO, MANUAL, SIN ASIGNAR
alter table oc_carpeta add column documentos text;    -- «Factura 2 · OC 1 · Guía 1»
alter table oc_carpeta add column le_falta text;      -- «Guía, DAM»; vacío = completo
alter table oc_carpeta add column estado text;        -- OK, INCOMPLETA, VACÍA

-- ── El centro de costo de cada carpeta de proyecto ──
create table if not exists proyecto_centro_costo (
  empresa_ruc       text not null,
  procedencia       text not null check (procedencia in ('Nacional', 'Importación')),
  proyecto_carpeta  text not null,
  cc_codigo         text,
  cc_nombre         text,
  fuente            text not null,   -- CG, NOMBRE, ADMINISTRATIVO, SIN ASIGNAR (del script) o MANUAL (de Contabilidad)
  detalle           text,
  revisar           boolean not null default false,
  ocs               integer,
  ocs_en_cg         integer,
  actualizado_en    timestamptz not null default now(),
  primary key (empresa_ruc, procedencia, proyecto_carpeta)
);

comment on table proyecto_centro_costo is
  'Centro de costo de cada carpeta de proyecto de las carpetas madre, para las OC que no están en CG. El script no pisa las filas con fuente MANUAL.';

alter table proyecto_centro_costo enable row level security;
create policy proyecto_centro_costo_lectura on proyecto_centro_costo for select using ((select seguridad.puede_ver_todo()));
revoke all on proyecto_centro_costo from anon;
revoke insert, update, delete, truncate, references, trigger on proyecto_centro_costo from authenticated;
grant select on proyecto_centro_costo to authenticated;

/** Guarda la regla de cada carpeta de proyecto, sin pisar las corregidas a mano (MANUAL). */
create or replace function guardar_centro_costo_proyectos(p_empresa_ruc text, p_filas jsonb) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema guarda centros de costo de proyectos.';
  end if;
  insert into proyecto_centro_costo (empresa_ruc, procedencia, proyecto_carpeta, cc_codigo, cc_nombre, fuente,
                                     detalle, revisar, ocs, ocs_en_cg, actualizado_en)
  select distinct on (f->>'procedencia', f->>'proyectoCarpeta')
         p_empresa_ruc, f->>'procedencia', f->>'proyectoCarpeta', nullif(f->>'ccCodigo', ''), nullif(f->>'ccNombre', ''),
         f->>'fuente', nullif(f->>'detalle', ''), coalesce((f->>'revisar')::boolean, false),
         nullif(f->>'ocs', '')::integer, nullif(f->>'ocsEnCg', '')::integer, now()
    from jsonb_array_elements(p_filas) f
   where nullif(f->>'proyectoCarpeta', '') is not null and f->>'procedencia' in ('Nacional', 'Importación')
  on conflict (empresa_ruc, procedencia, proyecto_carpeta) do update set
    cc_codigo = excluded.cc_codigo, cc_nombre = excluded.cc_nombre, fuente = excluded.fuente,
    detalle = excluded.detalle, revisar = excluded.revisar, ocs = excluded.ocs, ocs_en_cg = excluded.ocs_en_cg,
    actualizado_en = now()
   where proyecto_centro_costo.fuente <> 'MANUAL';
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function guardar_centro_costo_proyectos(text, jsonb) from public, anon;
grant execute on function guardar_centro_costo_proyectos(text, jsonb) to authenticated;

-- ── Qué cambió entre una corrida y la siguiente ──
create table if not exists carpeta_cambio (
  id            bigint generated always as identity primary key,
  empresa_ruc   text not null,
  procedencia   text not null,
  fecha         timestamptz not null default now(),
  oc            text not null,
  tipo          text not null,       -- OC NUEVA, OC YA NO ESTÁ, ARCHIVO NUEVO, ARCHIVO ELIMINADO, COMPLETÓ…
  detalle       text,
  enlace        text,
  carpeta_url   text
);

create index if not exists carpeta_cambio_fecha on carpeta_cambio (empresa_ruc, procedencia, fecha desc);

comment on table carpeta_cambio is
  'Lo que cambió en las carpetas madre entre dos corridas completas de scripts/carpetas-oc.mts.';

alter table carpeta_cambio enable row level security;
create policy carpeta_cambio_lectura on carpeta_cambio for select using ((select seguridad.puede_ver_todo()));
revoke all on carpeta_cambio from anon;
revoke insert, update, delete, truncate, references, trigger on carpeta_cambio from authenticated;
grant select on carpeta_cambio to authenticated;

create or replace function guardar_cambios_carpetas(p_empresa_ruc text, p_procedencia text, p_filas jsonb) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema guarda cambios de carpetas.';
  end if;
  insert into carpeta_cambio (empresa_ruc, procedencia, oc, tipo, detalle, enlace, carpeta_url)
  select p_empresa_ruc, p_procedencia, f->>'oc', f->>'tipo', nullif(f->>'detalle', ''), nullif(f->>'enlace', ''),
         nullif(f->>'carpetaUrl', '')
    from jsonb_array_elements(p_filas) f
   where nullif(f->>'oc', '') is not null and nullif(f->>'tipo', '') is not null;
  get diagnostics n = row_count;
  return n;
end;
$$;

revoke execute on function guardar_cambios_carpetas(text, text, jsonb) from public, anon;
grant execute on function guardar_cambios_carpetas(text, text, jsonb) to authenticated;

/**
 * Como en 048, con la fecha de modificación de cada archivo y, en cada
 * carpeta de OC, su centro de costo, sus documentos y lo que le falta.
 */
create or replace function cargar_carpetas_oc(
  p_empresa_ruc  text,
  p_parte        text,
  p_filas        jsonb,
  p_desde_cero   boolean default false
) returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  n integer := 0;
  p_procedencia text := coalesce(nullif(p_filas->0->>'procedencia', ''), 'Nacional');
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema carga las carpetas de OC.';
  end if;

  if p_procedencia not in ('Nacional', 'Importación') then
    raise exception 'Procedencia desconocida: %. Se espera Nacional o Importación.', p_procedencia;
  end if;

  if p_parte = 'ARCHIVOS' then
    if p_desde_cero then
      -- Solo lo de su carpeta madre: la OC nacional tiene 4 dígitos, la de importación 3.
      delete from oc_archivo
       where empresa_ruc = p_empresa_ruc and origen = 'CARPETA'
         and oc ~ case when p_procedencia = 'Importación' then '^\d{3}-' else '^\d{4}-' end;
    end if;
    insert into oc_archivo (
      empresa_ruc, origen, oc, proveedor_ruc_cg, proveedor_cg, carpeta_url, nombre, url,
      tipo_archivo, parece, serie_en_nombre, estado_lectura, ruc_leido, serie_leida, modificado
    )
    select distinct on (f->>'oc', f->>'url')
           p_empresa_ruc, 'CARPETA', f->>'oc', nullif(f->>'proveedorRuc', ''), nullif(f->>'proveedor', ''),
           nullif(f->>'carpetaUrl', ''), f->>'nombre', f->>'url',
           nullif(f->>'tipoArchivo', ''), nullif(f->>'parece', ''), nullif(upper(f->>'serie'), ''),
           nullif(f->>'estadoLectura', ''), nullif(f->>'rucLeido', ''), nullif(upper(f->>'serieLeida'), ''),
           nullif(f->>'modificado', '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'url', '') is not null
    on conflict (empresa_ruc, origen, oc, url) do update set
      proveedor_ruc_cg = excluded.proveedor_ruc_cg, proveedor_cg = excluded.proveedor_cg,
      carpeta_url = excluded.carpeta_url, nombre = excluded.nombre,
      tipo_archivo = excluded.tipo_archivo, parece = excluded.parece,
      serie_en_nombre = excluded.serie_en_nombre, estado_lectura = excluded.estado_lectura,
      ruc_leido = excluded.ruc_leido, serie_leida = excluded.serie_leida, modificado = excluded.modificado,
      cargado_en = now();
    get diagnostics n = row_count;

  elsif p_parte = 'CARPETAS' then
    if p_desde_cero then
      delete from oc_carpeta where empresa_ruc = p_empresa_ruc and procedencia = p_procedencia;
    end if;
    insert into oc_carpeta (
      empresa_ruc, oc, carpeta_url, carpeta_nombre, tipo, proveedor, proyecto, proyecto_carpeta,
      archivos, comprobantes, series, rucs, procedencia,
      cc_codigo, cc_nombre, cc_fuente, documentos, le_falta, estado
    )
    select distinct on (f->>'oc', f->>'carpetaUrl')
           p_empresa_ruc, f->>'oc', f->>'carpetaUrl', nullif(f->>'carpetaNombre', ''), nullif(f->>'tipo', ''),
           nullif(f->>'proveedor', ''), nullif(f->>'proyecto', ''), nullif(f->>'proyectoCarpeta', ''),
           nullif(f->>'archivos', '')::integer, nullif(f->>'comprobantes', '')::integer,
           nullif(f->>'series', ''), nullif(f->>'rucs', ''), p_procedencia,
           nullif(f->>'ccCodigo', ''), nullif(f->>'ccNombre', ''), nullif(f->>'ccFuente', ''),
           nullif(f->>'documentos', ''), coalesce(f->>'leFalta', ''), nullif(f->>'estado', '')
      from jsonb_array_elements(p_filas) f
     where nullif(f->>'oc', '') is not null and nullif(f->>'carpetaUrl', '') is not null
    on conflict (empresa_ruc, oc, carpeta_url) do update set
      carpeta_nombre = excluded.carpeta_nombre, tipo = excluded.tipo, proveedor = excluded.proveedor,
      proyecto = excluded.proyecto, proyecto_carpeta = excluded.proyecto_carpeta,
      archivos = excluded.archivos, comprobantes = excluded.comprobantes,
      series = excluded.series, rucs = excluded.rucs, procedencia = excluded.procedencia,
      cc_codigo = excluded.cc_codigo, cc_nombre = excluded.cc_nombre, cc_fuente = excluded.cc_fuente,
      documentos = excluded.documentos, le_falta = excluded.le_falta, estado = excluded.estado, cargado_en = now();
    get diagnostics n = row_count;

  else
    raise exception 'Parte desconocida: %. Se espera CARPETAS o ARCHIVOS.', p_parte;
  end if;

  return n;
end;
$$;

revoke execute on function cargar_carpetas_oc(text, text, jsonb, boolean) from public, anon;
grant execute on function cargar_carpetas_oc(text, text, jsonb, boolean) to authenticated;


-- ── El cruce factura ↔ OC ──
-- Igual que en 048, con el centro de costo y el legajo de la carpeta madre
-- para las OC que no están en CG ni en el legajo del cuadro.
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text,
  situacion_pago text, comprador text, area text, legajo text, carpeta_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez (ver 040).
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, a.origen, a.carpeta_url,
           -- La OC del legajo ya viene distinguida (importación con 3 dígitos):
           -- no se normaliza, o se juntaría con la nacional del mismo número.
           -- La de la carpeta madre ya viene como «0200-2026».
           case when a.origen in ('LEGAJO', 'CARPETA') then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           -- A la carpeta madre el RUC se lo dan los nombres de archivo y, si
           -- no, la base de nacionales (oc_legajo) por el número de la OC.
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') || coalesce(lr.rucs, '{}') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
      left join lateral (
        select array_agg(distinct x) rucs
          from oc_legajo l
          cross join lateral unnest(string_to_array(l.proveedor_ruc, ' / ')) x
         where a.origen = 'CARPETA' and l.empresa_ruc = a.empresa_ruc and l.oc = o.oc1
      ) lr on true
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
       and (s.proveedor_ruc = a.ruc_leido
            or (a.ruc_leido is null
                and (s.proveedor_ruc = any(a.rucs_cg)
                     or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))))
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 2 prioridad,
           case a.origen when 'LEGAJO' then 'Legajo (nombre o lectura del archivo)'
                         when 'CARPETA' then case when a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (nombre del archivo)'
                                                  else 'Carpeta de compras nacionales (nombre del archivo)' end
                         else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad,
           case when a.origen = 'CARPETA' and a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (número sin serie)'
                when a.origen = 'CARPETA' then 'Carpeta de compras nacionales (número sin serie)'
                else 'Nombre del archivo (número sin serie)' end fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  -- Un comprobante por OC, con la manera más segura; a igual manera, el
  -- legajo (sabe más de la OC), después la carpeta madre, después la captura.
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              case t.origen when 'LEGAJO' then 0 when 'CARPETA' then 1 else 2 end, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc and (select ok from permiso)
     group by b.oc
  ),
  leg as (
    select l.*, count(*) over (partition by l.oc) n_mismo_numero
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  con_legajo as (
    -- El legajo de la OC: el de su carpeta si el archivo vino del legajo; si
    -- vino de la captura, el del mismo número solo si no hay duda (uno solo y
    -- nacional: la captura no distingue las importaciones). Desde una carpeta
    -- madre, el de su procedencia (3 dígitos = importación); si hay varios
    -- (los gastos de una importación llevan su número), el de la misma carpeta.
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta,
           k.cc_codigo k_cc_codigo, k.cc_nombre k_cc_nombre, k.cc_fuente k_cc_fuente, k.le_falta k_falta, k.estado k_estado
      from mejor m
      -- La carpeta de la OC en la carpeta madre: su centro de costo (por CG,
      -- por el cuadro o por la carpeta del proyecto) y lo que le falta.
      left join oc_carpeta k
             on m.origen = 'CARPETA' and k.empresa_ruc = p_empresa_ruc
            and k.oc = m.oc_n and k.carpeta_url = m.carpeta_url
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional')
                or (m.origen = 'CARPETA'
                    and l.procedencia = case when m.oc_n ~ '^\d{3}-' then 'Importación' else 'Nacional' end))
         order by position(split_part(split_part(coalesce(m.carpeta_url, ''), '/folders/', 2), '?', 1) in l.carpeta_url) > 0 desc,
                  l.carpeta_url
         limit 1
      ) l on true
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         coalesce(m.l_cc_codigo, r.cc_codigo, m.k_cc_codigo), coalesce(m.l_cc_nombre, r.cc_nombre, m.k_cc_nombre),
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null and m.l_cc_codigo is null and m.l_cc_nombre is null
                then case when m.k_cc_fuente in ('NOMBRE', 'ADMINISTRATIVO', 'MANUAL')
                          then 'OC no está en la base de CG (centro de costo por la carpeta del proyecto)'
                          when m.k_cc_nombre is null then 'OC no está en la base de CG' end end,
           case when r.n_cc > 1 and m.l_cc_nombre is null then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end,
           case when m.l_situacion = 'ANULADA' then 'la OC está anulada en el cuadro de aprobaciones' end
         ), ''),
         m.l_situacion, m.l_comprador, m.l_area,
         coalesce(texto_del_legajo(m.l_estado, m.l_falta),
                  case when m.k_estado = 'VACÍA' then 'Carpeta vacía'
                       when m.k_estado is not null and coalesce(m.k_falta, '') = '' then 'Completo'
                       when m.k_estado is not null then 'Falta: ' || m.k_falta end),
         -- La carpeta madre es donde Compras guarda la OC: esa manda.
         case when m.origen = 'CARPETA' then m.carpeta_url else coalesce(nullif(m.l_carpeta, ''), m.carpeta_url) end
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo, m.k_cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo, m.k_cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre, m.k_cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 050_centro_de_costo_por_la_carpeta.sql
-- └──────────────────────────────────────────────────────────────

-- El centro de costo «por su carpeta de proyecto», aparte de «por CG»
--
-- Hasta 049, una OC que no está en CG pero cuya carpeta de proyecto tiene
-- sus demás OC en CG con un mismo centro de costo quedaba con fuente «CG»,
-- igual que las que sí están: no se distinguía. Ahora es «PROYECTO», y el
-- cruce lo avisa como el resto de lo que sale de la carpeta.
--
-- Además el legajo de la carpeta dice «Guía de remisión», como el de
-- LegajoPorOC.gs (antes «Guía»). Lo ya cargado se pasa a la forma nueva para
-- que la próxima corrida no lo cuente como un cambio en las carpetas.

update oc_carpeta
   set le_falta = array_to_string(array(
         select case when x = 'Guía' then 'Guía de remisión' else x end
           from unnest(string_to_array(le_falta, ', ')) with ordinality u(x, i) order by i), ', '),
       documentos = regexp_replace(documentos, '(^| · )Guía (\d)', '\1Guía de remisión \2', 'g')
 where le_falta ~ '(^|, )Guía(,|$)' or documentos ~ '(^| · )Guía \d';

update oc_carpeta k
   set cc_fuente = 'PROYECTO'
 where cc_fuente = 'CG'
   and (procedencia = 'Importación'
        or not exists (select 1 from oc_base_cg b where b.empresa_ruc = k.empresa_ruc and b.oc = k.oc));

-- ── El cruce factura ↔ OC ──
-- Igual que en 049, con PROYECTO entre las fuentes «por la carpeta».
create or replace function vinculos_oc(p_empresa_ruc text default '20512201611')
returns table (
  proveedor_ruc text, tipo_comprobante text, serie text, numero text,
  oc text, cc_codigo text, cc_nombre text, concar_codigo text,
  fuente text, archivo text, archivo_url text, alertas text,
  situacion_pago text, comprador text, area text, legajo text, carpeta_url text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- El permiso se mira UNA vez (ver 040).
  with permiso as (
    select seguridad.puede_ver_todo() ok
  ),
  arch as (
    select a.url, a.nombre, a.parece, a.origen, a.carpeta_url,
           -- La OC del legajo ya viene distinguida (importación con 3 dígitos):
           -- no se normaliza, o se juntaría con la nacional del mismo número.
           -- La de la carpeta madre ya viene como «0200-2026».
           case when a.origen in ('LEGAJO', 'CARPETA') then o.oc1 else oc_normalizada(o.oc1) end oc_n,
           -- A la carpeta madre el RUC se lo dan los nombres de archivo y, si
           -- no, la base de nacionales (oc_legajo) por el número de la OC.
           string_to_array(coalesce(a.proveedor_ruc_cg, ''), ' / ') || coalesce(lr.rucs, '{}') rucs_cg,
           a.serie_en_nombre, a.estado_lectura, a.ruc_leido,
           case when a.serie_leida ~ '^[FBE][A-Z0-9]{3}-\d+$'
                then left(a.serie_leida, 1) || translate(substr(split_part(a.serie_leida, '-', 1), 2), 'O', '0')
                     || '-' || split_part(a.serie_leida, '-', 2) end serie_leida
      from oc_archivo a
      cross join lateral unnest(string_to_array(a.oc, ' / ')) o(oc1)
      left join lateral (
        select array_agg(distinct x) rucs
          from oc_legajo l
          cross join lateral unnest(string_to_array(l.proveedor_ruc, ' / ')) x
         where a.origen = 'CARPETA' and l.empresa_ruc = a.empresa_ruc and l.oc = o.oc1
      ) lr on true
     where a.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  sunat as (
    select s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie,
           coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero, s.fecha_emision, s.total, s.moneda
      from comprobantes_sunat s
     where s.empresa_ruc = p_empresa_ruc and s.tipo_comprobante in ('01', '03', '07', '08')
       and (select ok from permiso)
  ),
  emisores as (
    select serie, numero, count(*) n from sunat group by 1, 2
  ),
  por_lectura as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 1 prioridad, 'Lectura del documento'::text fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_leida, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_leida, '-', 2), '0'), ''), '0')
     where a.estado_lectura = 'LEÍDO'
       and (s.proveedor_ruc = a.ruc_leido
            or (a.ruc_leido is null
                and (s.proveedor_ruc = any(a.rucs_cg)
                     or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))))
  ),
  por_nombre as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 2 prioridad,
           case a.origen when 'LEGAJO' then 'Legajo (nombre o lectura del archivo)'
                         when 'CARPETA' then case when a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (nombre del archivo)'
                                                  else 'Carpeta de compras nacionales (nombre del archivo)' end
                         else 'Nombre del archivo' end fuente
      from arch a
      join sunat s on s.serie = split_part(a.serie_en_nombre, '-', 1)
                  and s.numero = coalesce(nullif(ltrim(split_part(a.serie_en_nombre, '-', 2), '0'), ''), '0')
     where a.serie_en_nombre is not null
       and (s.proveedor_ruc = any(a.rucs_cg)
            or exists (select 1 from emisores x where x.serie = s.serie and x.numero = s.numero and x.n = 1))
  ),
  por_numero as (
    select a.oc_n, a.url, a.nombre, a.origen, a.carpeta_url, s.*, 3 prioridad,
           case when a.origen = 'CARPETA' and a.oc_n ~ '^\d{3}-' then 'Carpeta de importaciones (número sin serie)'
                when a.origen = 'CARPETA' then 'Carpeta de compras nacionales (número sin serie)'
                else 'Nombre del archivo (número sin serie)' end fuente
      from arch a
      cross join lateral (
        select distinct ltrim(t[1], '0') tok
          from regexp_matches(regexp_replace(coalesce(a.nombre, ''), '\.[A-Za-z0-9]{2,5}$', ''),
                              '(?:^|\D)(\d{3,8})(?!\d)', 'g') t
      ) tk
      join sunat s on s.proveedor_ruc = any(a.rucs_cg) and s.numero = tk.tok
     where a.serie_en_nombre is null
       and a.parece ~ '^(FACTURA|NOTA DE|BOLETA|RECIBO POR|COMPROBANTE)'
       and tk.tok not in ('2025', '2026', ltrim(split_part(a.oc_n, '-', 1), '0'))
  ),
  por_numero_unico as (
    select * from por_numero p
     where (select count(*) from por_numero q where q.url = p.url and q.oc_n = p.oc_n) = 1
  ),
  todos as (
    select * from por_lectura
    union all select * from por_nombre
    union all select * from por_numero_unico
  ),
  -- Un comprobante por OC, con la manera más segura; a igual manera, el
  -- legajo (sabe más de la OC), después la carpeta madre, después la captura.
  mejor as (
    select distinct on (t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero) t.*
      from todos t
     where t.oc_n is not null
     order by t.oc_n, t.proveedor_ruc, t.tipo_comprobante, t.serie, t.numero, t.prioridad,
              case t.origen when 'LEGAJO' then 0 when 'CARPETA' then 1 else 2 end, t.url
  ),
  oc_resumen as (
    select b.oc,
           (array_agg(b.cc_codigo order by b.lineas desc, b.cc_codigo))[1] cc_codigo,
           (array_agg(b.cc_nombre order by b.lineas desc, b.cc_codigo))[1] cc_nombre,
           count(*) n_cc,
           min(b.fecha_oc) fecha_oc,
           sum(b.monto) monto,
           (array_agg(b.moneda order by b.lineas desc))[1] moneda,
           array_agg(distinct b.proveedor_ruc) filter (where b.proveedor_ruc is not null) rucs
      from oc_base_cg b
     where b.empresa_ruc = p_empresa_ruc and (select ok from permiso)
     group by b.oc
  ),
  leg as (
    select l.*, count(*) over (partition by l.oc) n_mismo_numero
      from oc_legajo l
     where l.empresa_ruc = p_empresa_ruc and (select ok from permiso)
  ),
  con_legajo as (
    -- El legajo de la OC: el de su carpeta si el archivo vino del legajo; si
    -- vino de la captura, el del mismo número solo si no hay duda (uno solo y
    -- nacional: la captura no distingue las importaciones). Desde una carpeta
    -- madre, el de su procedencia (3 dígitos = importación); si hay varios
    -- (los gastos de una importación llevan su número), el de la misma carpeta.
    select m.*, l.cc_codigo l_cc_codigo, l.cc_nombre l_cc_nombre, l.situacion_pago l_situacion,
           l.comprador l_comprador, l.area l_area, l.estado_revision l_estado, l.le_falta l_falta,
           l.carpeta_url l_carpeta,
           k.cc_codigo k_cc_codigo, k.cc_nombre k_cc_nombre, k.cc_fuente k_cc_fuente, k.le_falta k_falta, k.estado k_estado
      from mejor m
      -- La carpeta de la OC en la carpeta madre: su centro de costo (por CG,
      -- por el cuadro o por la carpeta del proyecto) y lo que le falta.
      left join oc_carpeta k
             on m.origen = 'CARPETA' and k.empresa_ruc = p_empresa_ruc
            and k.oc = m.oc_n and k.carpeta_url = m.carpeta_url
      left join lateral (
        select l.* from leg l
         where l.oc = m.oc_n
           and ((m.origen = 'LEGAJO' and l.carpeta_url = coalesce(m.carpeta_url, ''))
                or (m.origen = 'CAPTURA' and l.n_mismo_numero = 1 and l.procedencia = 'Nacional')
                or (m.origen = 'CARPETA'
                    and l.procedencia = case when m.oc_n ~ '^\d{3}-' then 'Importación' else 'Nacional' end))
         order by position(split_part(split_part(coalesce(m.carpeta_url, ''), '/folders/', 2), '?', 1) in l.carpeta_url) > 0 desc,
                  l.carpeta_url
         limit 1
      ) l on true
  )
  select m.proveedor_ruc, m.tipo_comprobante, m.serie, m.numero, m.oc_n,
         coalesce(m.l_cc_codigo, r.cc_codigo, m.k_cc_codigo), coalesce(m.l_cc_nombre, r.cc_nombre, m.k_cc_nombre),
         case when e.estado = 'CONFIRMADO' then e.concar_codigo end,
         m.fuente, m.nombre, m.url,
         nullif(concat_ws('; ',
           case when r.oc is null and m.l_cc_codigo is null and m.l_cc_nombre is null
                then case when m.k_cc_fuente in ('PROYECTO', 'NOMBRE', 'ADMINISTRATIVO', 'MANUAL')
                          then 'OC no está en la base de CG (centro de costo por la carpeta del proyecto)'
                          when m.k_cc_nombre is null then 'OC no está en la base de CG' end end,
           case when r.n_cc > 1 and m.l_cc_nombre is null then 'la OC reparte en ' || r.n_cc || ' centros de costo' end,
           case when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                     and exists (select 1 from unnest(r.rucs) x where length(x) <> 11)
                then 'RUC mal escrito en la base de CG'
                when r.rucs is not null and not (m.proveedor_ruc = any(r.rucs))
                then 'emisor distinto al proveedor de la OC' end,
           case when m.fecha_emision < r.fecha_oc - 7 then 'factura anterior a la OC' end,
           case when m.tipo_comprobante = '01' and r.monto > 0 and m.moneda = r.moneda
                     and m.total > r.monto * (case when m.moneda = 'PEN' then 1.18 else 1 end) * 1.1
                then 'factura mayor que la OC' end,
           case when m.l_situacion = 'ANULADA' then 'la OC está anulada en el cuadro de aprobaciones' end
         ), ''),
         m.l_situacion, m.l_comprador, m.l_area,
         coalesce(texto_del_legajo(m.l_estado, m.l_falta),
                  case when m.k_estado = 'VACÍA' then 'Carpeta vacía'
                       when m.k_estado is not null and coalesce(m.k_falta, '') = '' then 'Completo'
                       when m.k_estado is not null then 'Falta: ' || m.k_falta end),
         -- La carpeta madre es donde Compras guarda la OC: esa manda.
         case when m.origen = 'CARPETA' then m.carpeta_url else coalesce(nullif(m.l_carpeta, ''), m.carpeta_url) end
    from con_legajo m
    left join oc_resumen r on r.oc = m.oc_n
    left join equivalencia_centro_costo e
           on e.cc_clave = case when coalesce(m.l_cc_codigo, r.cc_codigo, m.k_cc_codigo) <> '-'
                                then coalesce(m.l_cc_codigo, r.cc_codigo, m.k_cc_codigo)
                                else coalesce(m.l_cc_nombre, r.cc_nombre, m.k_cc_nombre) end;
$$;

revoke execute on function vinculos_oc(text) from public, anon;
grant execute on function vinculos_oc(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 051_detalle_y_general_con_la_carpeta_madre.sql
-- └──────────────────────────────────────────────────────────────

-- El DETALLE y la hoja GENERAL con lo que se sabe de la carpeta madre
--
-- 1. detalle_cpe_carpeta(): el mismo detalle de ítems de detalle_cpe(), con
--    tres columnas más al final, sacadas de la carpeta de la OC (oc_carpeta):
--    el proyecto, de dónde salió el centro de costo y qué documentos tiene.
--    Es una función nueva (y no un cambio a detalle_cpe) porque agregar
--    columnas a una función obliga a borrarla y recrearla, y la publicación
--    de cada mañana la está usando.
-- 2. legajo_de_carpetas(): una fila por carpeta de OC de las dos carpetas
--    madre, con su legajo, centro de costo, las facturas de SUNAT ya unidas y
--    el último cambio. La trae docs/appscript/CarpetaMadre.gs a la hoja
--    GENERAL (pestaña CARPETA MADRE).

create or replace function texto_cc_segun(p_fuente text, p_procedencia text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select case p_fuente
    when 'CG' then 'Control de Gestión'
    when 'CUADRO' then 'Cuadro de aprobaciones'
    when 'PROYECTO' then case when p_procedencia = 'Importación'
                              then 'Su carpeta de proyecto (las demás OC, según el cuadro)'
                              else 'Su carpeta de proyecto (las demás OC, según CG)' end
    when 'NOMBRE' then 'Nombre de la carpeta del proyecto'
    when 'ADMINISTRATIVO' then 'Carpeta administrativa (área general)'
    when 'MANUAL' then 'Corregido a mano'
    when 'SIN ASIGNAR' then 'Sin asignar'
  end;
$$;

create or replace function detalle_cpe_carpeta(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text, serie text,
  numero text, fecha_emision date, moneda text, linea integer, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric, enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text, detraccion_porcentaje numeric, detraccion_monto numeric,
  detraccion_cuenta_banco text, detraccion_codigo_bien_servicio text, anticipo_aplicado numeric,
  documento_relacionado text, tipo_documento_relacionado text, oc_carpeta text, centro_costo_cg text,
  codigo_concar text, archivo_oc text, archivo_oc_url text, situacion_pago_oc text, comprador_oc text,
  area_oc text, legajo_oc text, carpeta_oc_url text,
  proyecto_oc text, centro_costo_segun text, documentos_oc text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (
    select * from detalle_cpe(p_periodo)
  ),
  carpetas as (
    select k.oc, k.carpeta_url, k.proyecto_carpeta, k.cc_fuente, k.documentos, k.procedencia,
           count(*) over (partition by k.oc) n
      from oc_carpeta k
     where k.empresa_ruc = '20512201611' and (select seguridad.puede_ver_todo())
  ),
  -- Cada combinación de OC y carpeta del detalle, una sola vez. Un
  -- comprobante puede ir a varias OC («0200-2026 / 0201-2026»); su carpeta es
  -- la del enlace o, si el enlace es otro (de CG o del cuadro), la única
  -- carpeta madre con ese número.
  claves as (
    select distinct d.oc_carpeta, d.carpeta_oc_url from d where d.oc_carpeta is not null
  ),
  info as (
    select x.oc_carpeta, x.carpeta_oc_url,
           string_agg(distinct c.proyecto_carpeta, ' / ') proyecto,
           string_agg(distinct texto_cc_segun(c.cc_fuente, c.procedencia), ' / ') segun,
           string_agg(distinct nullif(c.documentos, ''), ' / ') documentos
      from claves x
      join carpetas c
        on c.oc = any(string_to_array(x.oc_carpeta, ' / '))
       and (c.n = 1 or c.carpeta_url = any(string_to_array(coalesce(x.carpeta_oc_url, ''), ' / ')))
     group by 1, 2
  )
  select d.*,
         i.proyecto,
         case when d.centro_costo_cg is null then null else coalesce(i.segun, 'Control de Gestión') end,
         i.documentos
    from d
    left join info i
      on i.oc_carpeta = d.oc_carpeta and i.carpeta_oc_url is not distinct from d.carpeta_oc_url
   order by d.fecha_emision, d.serie, d.numero, d.linea;
$$;

revoke execute on function detalle_cpe_carpeta(text) from public, anon;
grant execute on function detalle_cpe_carpeta(text) to authenticated;

create or replace function legajo_de_carpetas(p_empresa_ruc text default '20512201611')
returns table (
  procedencia text, oc text, tipo text, proveedor text, proyecto_carpeta text, carpeta_nombre text,
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
  with v as materialized (
    select v.oc, v.carpeta_url, v.serie || '-' || v.numero || ' (' || v.proveedor_ruc || ')' cpe
      from vinculos_oc(p_empresa_ruc) v
  ),
  k as (
    select k.*, count(*) over (partition by k.oc) n
      from oc_carpeta k
     where k.empresa_ruc = p_empresa_ruc and (select seguridad.puede_ver_todo())
  )
  select k.procedencia, k.oc, k.tipo, k.proveedor, k.proyecto_carpeta, k.carpeta_nombre, k.carpeta_url,
         k.estado, coalesce(k.le_falta, ''), k.documentos, k.archivos, k.comprobantes, k.series,
         k.cc_codigo, k.cc_nombre, texto_cc_segun(k.cc_fuente, k.procedencia),
         exists (select 1 from oc_base_cg b where b.empresa_ruc = p_empresa_ruc and b.oc = k.oc),
         f.lista, coalesce(f.n, 0), c.texto, c.fecha,
         (select string_agg(o.proyecto_carpeta || ' / ' || o.carpeta_nombre, ' | ')
            from oc_carpeta o where o.empresa_ruc = p_empresa_ruc and o.oc = k.oc and o.carpeta_url <> k.carpeta_url),
         k.cargado_en
    from k
    left join lateral (
      select string_agg(distinct v.cpe, ' / ') lista, count(distinct v.cpe)::integer n
        from v where v.oc = k.oc and (v.carpeta_url = k.carpeta_url or k.n = 1)
    ) f on true
    left join lateral (
      select x.tipo || coalesce(': ' || x.detalle, '') texto, x.fecha
        from carpeta_cambio x
       where x.empresa_ruc = p_empresa_ruc and x.oc = k.oc and x.carpeta_url = k.carpeta_url
       order by x.fecha desc, x.id desc limit 1
    ) c on true
   order by k.procedencia desc, split_part(k.oc, '-', 2), k.oc, k.carpeta_url;
$$;

revoke execute on function legajo_de_carpetas(text) from public, anon;
grant execute on function legajo_de_carpetas(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 052_area_responsable_y_facturas_sin_oc.sql
-- └──────────────────────────────────────────────────────────────

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


-- ┌──────────────────────────────────────────────────────────────
-- │ 053_igv_soles_y_detraccion_en_el_detalle.sql
-- └──────────────────────────────────────────────────────────────

-- El DETALLE con el desglose del IGV, el total en soles y la detracción a revisar
--
-- Pedidos de Contabilidad en la reunión de resultados (octubre 2026):
--   1. Desglosar lo gravado de lo no gravado (inafecto / exonerado) para
--      cuadrar el IGV: base × 18% tiene que dar el IGV.
--   2. Ver todo en soles, con el tipo de cambio de cada comprobante.
--   3. Avisar cuando el % de detracción no es el que corresponde a su código
--      de bien o servicio (el caso del 12%).
--
-- detalle_cpe_hoja(): lo mismo que detalle_cpe_carpeta() (migración 051) más
-- siete columnas por comprobante (se repiten en cada ítem, como la cabecera):
--   base_gravada, igv_comprobante, no_gravado, desglose_segun
--       Del SIRE cuando el comprobante está ahí (las tres bases gravadas y su
--       IGV; lo no gravado es el resto del total: inafecto, exonerado, ISC,
--       ICBPER…). Si no está en el SIRE (las ventas, o una compra que todavía
--       no aparece), del XML: base = IGV / 18%, y el resto del valor de venta
--       es no gravado.
--   tipo_cambio, total_soles
--       El del SIRE; si no, el de otra compra en la misma moneda y la misma
--       fecha (SUNAT publica uno por día); si no, el último anterior.
--   detraccion_revisar
--       Vacío si está bien. Si no: qué % se aplicó y cuál lleva su código
--       según los anexos de la R.S. 183-2004/SUNAT (tabla abajo).
-- Es una función nueva porque cambiar las columnas de una función obliga a
-- borrarla, y la publicación de cada día usa la anterior.

-- El % de detracción de cada código de bien o servicio (anexos 1, 2 y 3 de la
-- R.S. 183-2004/SUNAT, con sus modificatorias). Contabilidad confirma.
create or replace function porcentaje_detraccion(p_codigo text, out porcentaje numeric, out nombre text)
language sql
immutable
set search_path = pg_temp
as $$
  select t.p, t.n from (values
    ('001', 10, 'Azúcar y melaza de caña'),
    ('003', 10, 'Alcohol etílico'),
    ('004', 4, 'Recursos hidrobiológicos'),
    ('005', 4, 'Maíz amarillo duro'),
    ('007', 10, 'Caña de azúcar'),
    ('008', 4, 'Madera'),
    ('009', 10, 'Arena y piedra'),
    ('010', 15, 'Residuos, subproductos, desechos, recortes'),
    ('011', 10, 'Bienes gravados con el IGV por renuncia a la exoneración'),
    ('012', 12, 'Intermediación laboral y tercerización'),
    ('014', 4, 'Carnes y despojos comestibles'),
    ('016', 10, 'Aceite de pescado'),
    ('017', 4, 'Harina, polvo y pellets de pescado'),
    ('019', 10, 'Arrendamiento de bienes muebles'),
    ('020', 12, 'Mantenimiento y reparación de bienes muebles'),
    ('021', 10, 'Movimiento de carga'),
    ('022', 12, 'Otros servicios empresariales'),
    ('024', 10, 'Comisión mercantil'),
    ('025', 10, 'Fabricación de bienes por encargo'),
    ('026', 10, 'Servicio de transporte de personas'),
    ('027', 4, 'Servicio de transporte de carga'),
    ('030', 4, 'Contratos de construcción'),
    ('031', 10, 'Oro gravado con el IGV'),
    ('032', 10, 'Páprika y otros frutos de los géneros capsicum o pimienta'),
    ('034', 10, 'Minerales metálicos no auríferos'),
    ('035', 1.5, 'Bienes exonerados del IGV'),
    ('036', 1.5, 'Oro y demás minerales metálicos exonerados del IGV'),
    ('037', 12, 'Demás servicios gravados con el IGV'),
    ('039', 10, 'Minerales no metálicos'),
    ('040', 4, 'Bien inmueble gravado con el IGV'),
    ('041', 15, 'Plomo')
  ) t(c, p, n)
  where t.c = lpad(trim(p_codigo), 3, '0');
$$;

create or replace function detalle_cpe_hoja(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text, serie text,
  numero text, fecha_emision date, moneda text, linea integer, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric, enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text, detraccion_porcentaje numeric, detraccion_monto numeric,
  detraccion_cuenta_banco text, detraccion_codigo_bien_servicio text, anticipo_aplicado numeric,
  documento_relacionado text, tipo_documento_relacionado text, oc_carpeta text, centro_costo_cg text,
  codigo_concar text, archivo_oc text, archivo_oc_url text, situacion_pago_oc text, comprador_oc text,
  area_oc text, legajo_oc text, carpeta_oc_url text,
  proyecto_oc text, centro_costo_segun text, documentos_oc text,
  base_gravada numeric, igv_comprobante numeric, no_gravado numeric, desglose_segun text,
  tipo_cambio numeric, total_soles numeric, detraccion_revisar text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as materialized (
    select * from detalle_cpe_carpeta(p_periodo)
  ),
  -- Cada comprobante una vez.
  k as (
    select distinct d.origen, d.proveedor_ruc, d.tipo_comprobante, upper(d.serie) serie,
           coalesce(nullif(ltrim(d.numero, '0'), ''), '0') numero, d.fecha_emision, d.moneda, d.total_comprobante,
           d.detraccion_porcentaje, d.detraccion_codigo_bien_servicio
      from d
  ),
  sire as (
    select distinct on (s.proveedor_ruc, s.tipo_comprobante, upper(s.serie), coalesce(nullif(ltrim(s.numero, '0'), ''), '0'))
           s.proveedor_ruc, s.tipo_comprobante, upper(s.serie) serie, coalesce(nullif(ltrim(s.numero, '0'), ''), '0') numero,
           coalesce(s.base_dg, 0) + coalesce(s.base_dgng, 0) + coalesce(s.base_dng, 0) base,
           coalesce(s.igv_dg, 0) + coalesce(s.igv_dgng, 0) + coalesce(s.igv_dng, 0) igv,
           s.total, s.tipo_cambio
      from comprobantes_sunat s
     where s.empresa_ruc = '20512201611' and (select seguridad.puede_ver_todo())
     order by s.proveedor_ruc, s.tipo_comprobante, upper(s.serie), coalesce(nullif(ltrim(s.numero, '0'), ''), '0'), s.ultima_vez desc nulls last
  ),
  -- El tipo de cambio de cada día y moneda (SUNAT publica uno por día).
  tc as (
    select s.moneda, s.fecha_emision, mode() within group (order by s.tipo_cambio) tc
      from comprobantes_sunat s
     where s.empresa_ruc = '20512201611' and s.moneda <> 'PEN' and s.tipo_cambio > 1
       and (select seguridad.puede_ver_todo())
     group by 1, 2
  ),
  xml as (
    select c.proveedor_ruc, c.tipo_comprobante, upper(c.serie) serie, coalesce(nullif(ltrim(c.numero, '0'), ''), '0') numero,
           c.origen, c.subtotal, c.igv
      from cpe_comprobante c
     where c.empresa_ruc = '20512201611' and (select seguridad.puede_ver_todo())
  ),
  r as (
    select k.*,
           s.base s_base, s.igv s_igv, s.total s_total, s.tipo_cambio s_tc,
           x.subtotal x_sub, x.igv x_igv,
           case when k.moneda = 'PEN' then 1
                else coalesce(nullif(s.tipo_cambio, 1),
                              (select t.tc from tc t where t.moneda = k.moneda and t.fecha_emision <= k.fecha_emision
                                order by t.fecha_emision desc limit 1)) end tc,
           pd.porcentaje pct_tabla, pd.nombre det_nombre
      from k
      left join sire s on k.origen = 'RECIBIDO' and s.proveedor_ruc = k.proveedor_ruc and s.tipo_comprobante = k.tipo_comprobante
                      and s.serie = k.serie and s.numero = k.numero
      left join xml x on x.origen = k.origen and x.proveedor_ruc = k.proveedor_ruc and x.tipo_comprobante = k.tipo_comprobante
                     and x.serie = k.serie and x.numero = k.numero
      left join lateral porcentaje_detraccion(k.detraccion_codigo_bien_servicio) pd on true
  ),
  calc as (
    select r.*,
           case when r.s_total is not null then r.s_base
                when r.x_igv is not null then least(round(r.x_igv / 0.18, 2), coalesce(r.x_sub, r.x_igv / 0.18)) end base_g,
           case when r.s_total is not null then r.s_igv else r.x_igv end igv_c,
           case when r.s_total is not null then 'SIRE'
                when r.x_igv is not null then 'XML (IGV al 18%)' end segun
      from r
  )
  select d.*,
         c.base_g, c.igv_c,
         case when c.segun = 'SIRE' then round(c.s_total - c.s_base - c.s_igv, 2)
              when c.segun is not null then greatest(round(coalesce(c.x_sub, 0) - c.base_g, 2), 0) end,
         c.segun,
         c.tc,
         round(d.total_comprobante * c.tc, 2),
         case when coalesce(d.detraccion_porcentaje, 0) <= 0 then ''
              when nullif(trim(d.detraccion_codigo_bien_servicio), '') is null then 'Tiene detracción sin código de bien o servicio'
              when c.pct_tabla is null then ''
              when abs(d.detraccion_porcentaje - c.pct_tabla) > 0.001 then
                'Se aplicó ' || rtrim(to_char(d.detraccion_porcentaje, 'FM990.99'), '.') || '% y el código ' ||
                lpad(trim(d.detraccion_codigo_bien_servicio), 3, '0') || ' (' || c.det_nombre || ') lleva ' ||
                rtrim(to_char(c.pct_tabla, 'FM990.99'), '.') || '%'
              else '' end
    from d
    left join calc c on c.origen = d.origen and c.proveedor_ruc = d.proveedor_ruc and c.tipo_comprobante = d.tipo_comprobante
                    and c.serie = upper(d.serie) and c.numero = coalesce(nullif(ltrim(d.numero, '0'), ''), '0')
   order by d.fecha_emision, d.serie, d.numero, d.linea;
$$;

revoke execute on function detalle_cpe_hoja(text) from public, anon;
grant execute on function detalle_cpe_hoja(text) to authenticated;


-- ┌──────────────────────────────────────────────────────────────
-- │ 054_el_legajo_del_detalle_de_la_carpeta_madre.sql
-- └──────────────────────────────────────────────────────────────

-- El legajo del DETALLE, de la carpeta madre
--
-- Hasta acá la columna «Legajo de la OC» venía primero del legajo por OC de
-- la hoja GENERAL (LegajoPorOC.gs: revisa cada 7 días y pide también la
-- cotización) y la carpeta madre solo llenaba lo que aquel no tenía. Ahora
-- manda la carpeta madre, que el robot lee dos veces al día: «Completo»,
-- «Falta: Guía de remisión», «Carpeta vacía». El de GENERAL queda para las OC
-- que la carpeta madre no tiene. Misma firma: no cambia la hoja.

create or replace function detalle_cpe_carpeta(p_periodo text default null)
returns table (
  periodo text, origen text, proveedor_ruc text, proveedor_nombre text, tipo_comprobante text, serie text,
  numero text, fecha_emision date, moneda text, linea integer, descripcion text, cantidad numeric, unidad text,
  precio_unitario numeric, importe numeric, total_comprobante numeric, enlace_xml text, enlace_pdf text,
  forma_pago text, guia_remision text, orden_compra text, detraccion_porcentaje numeric, detraccion_monto numeric,
  detraccion_cuenta_banco text, detraccion_codigo_bien_servicio text, anticipo_aplicado numeric,
  documento_relacionado text, tipo_documento_relacionado text, oc_carpeta text, centro_costo_cg text,
  codigo_concar text, archivo_oc text, archivo_oc_url text, situacion_pago_oc text, comprador_oc text,
  area_oc text, legajo_oc text, carpeta_oc_url text,
  proyecto_oc text, centro_costo_segun text, documentos_oc text
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with d as (
    select * from detalle_cpe(p_periodo)
  ),
  carpetas as (
    select k.oc, k.carpeta_url, k.proyecto_carpeta, k.cc_fuente, k.documentos, k.procedencia,
           case k.estado when 'OK' then 'Completo' when 'VACÍA' then 'Carpeta vacía'
                else 'Falta: ' || coalesce(nullif(k.le_falta, ''), '—') end legajo,
           count(*) over (partition by k.oc) n
      from oc_carpeta k
     where k.empresa_ruc = '20512201611' and (select seguridad.puede_ver_todo())
  ),
  -- Cada combinación de OC y carpeta del detalle, una sola vez. Un
  -- comprobante puede ir a varias OC («0200-2026 / 0201-2026»); su carpeta es
  -- la del enlace o, si el enlace es otro (de CG o del cuadro), la única
  -- carpeta madre con ese número.
  claves as (
    select distinct d.oc_carpeta, d.carpeta_oc_url from d where d.oc_carpeta is not null
  ),
  info as (
    select x.oc_carpeta, x.carpeta_oc_url,
           string_agg(distinct c.proyecto_carpeta, ' / ') proyecto,
           string_agg(distinct texto_cc_segun(c.cc_fuente, c.procedencia), ' / ') segun,
           string_agg(distinct nullif(c.documentos, ''), ' / ') documentos,
           string_agg(distinct c.legajo, ' / ') legajo
      from claves x
      join carpetas c
        on c.oc = any(string_to_array(x.oc_carpeta, ' / '))
       and (c.n = 1 or c.carpeta_url = any(string_to_array(coalesce(x.carpeta_oc_url, ''), ' / ')))
     group by 1, 2
  )
  -- El legajo, de la carpeta madre (la lee el robot dos veces al día); el del
  -- legajo por OC de GENERAL solo si la carpeta madre no tiene esa OC.
  select d.periodo,
         d.origen,
         d.proveedor_ruc,
         d.proveedor_nombre,
         d.tipo_comprobante,
         d.serie,
         d.numero,
         d.fecha_emision,
         d.moneda,
         d.linea,
         d.descripcion,
         d.cantidad,
         d.unidad,
         d.precio_unitario,
         d.importe,
         d.total_comprobante,
         d.enlace_xml,
         d.enlace_pdf,
         d.forma_pago,
         d.guia_remision,
         d.orden_compra,
         d.detraccion_porcentaje,
         d.detraccion_monto,
         d.detraccion_cuenta_banco,
         d.detraccion_codigo_bien_servicio,
         d.anticipo_aplicado,
         d.documento_relacionado,
         d.tipo_documento_relacionado,
         d.oc_carpeta,
         d.centro_costo_cg,
         d.codigo_concar,
         d.archivo_oc,
         d.archivo_oc_url,
         d.situacion_pago_oc,
         d.comprador_oc,
         d.area_oc,
         coalesce(i.legajo, d.legajo_oc),
         d.carpeta_oc_url,
         i.proyecto,
         case when d.centro_costo_cg is null then null else coalesce(i.segun, 'Control de Gestión') end,
         i.documentos
    from d
    left join info i
      on i.oc_carpeta = d.oc_carpeta and i.carpeta_oc_url is not distinct from d.carpeta_oc_url
   order by d.fecha_emision, d.serie, d.numero, d.linea;
$$;

