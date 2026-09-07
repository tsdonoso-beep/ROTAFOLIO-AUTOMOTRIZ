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
