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
