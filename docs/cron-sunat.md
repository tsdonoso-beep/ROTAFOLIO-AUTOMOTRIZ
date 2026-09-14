# La consulta diaria a SUNAT

Corre en GitHub Actions una vez al día y consulta **dos períodos**: el mes en
curso y el anterior.

El anterior porque los proveedores siguen declarando después del cierre: un
mes «terminado» sigue cambiando durante semanas. El actual, para ver lo que va
entrando.

## Por qué no está en Vercel

El plan Hobby permite **un cron al día** y corta cada ejecución **al minuto**.
SUNAT encola el pedido y devuelve un ticket que tarda entre uno y tres
minutos. No entra. GitHub Actions no tiene ese límite y el repositorio ya
está ahí.

## Lo que hay que poner una vez

### 1. La cuenta del robot

Consulta con su propia cuenta, no con la de una persona. Así la bitácora dice
quién consultó, y la clave de nadie vive en un servidor.

En Supabase · Authentication · Users · **Add user**:

- Correo: `robot.sunat@sin-correo.local`
- Contraseña: una larga, que nadie más use
- Marcar **Auto Confirm User**

Después, en el SQL Editor, darle el rol (una sola vez):

```sql
-- Crea la persona del robot y le da el rol que necesita para consultar.
with a as (
  select id from auth.users where email = 'robot.sunat@sin-correo.local'
),
u as (
  insert into usuarios (auth_id, email, nombre, activo)
  select a.id, 'robot.sunat@sin-correo.local', 'Robot SUNAT', true from a
  on conflict (email) do update set auth_id = excluded.auth_id, activo = true
  returning id
)
insert into roles_usuario (usuario_id, rol)
select u.id, 'ADMIN_SISTEMA' from u
on conflict do nothing;
```

### 2. Los secretos

En el repositorio: **Settings · Secrets and variables · Actions · New
repository secret**. Ocho, uno por uno:

| Secreto | De dónde sale |
|---|---|
| `SUPABASE_URL` | el mismo valor que `NEXT_PUBLIC_SUPABASE_URL` en Vercel |
| `SUPABASE_ANON_KEY` | el mismo que `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `ROBOT_CORREO` | `robot.sunat@sin-correo.local` |
| `ROBOT_CLAVE` | la contraseña del paso 1 |
| `SUNAT_INROPRIN_CLIENT_ID` | el mismo que en Vercel |
| `SUNAT_INROPRIN_CLIENT_SECRET` | ídem |
| `SUNAT_INROPRIN_USUARIO` | ídem |
| `SUNAT_INROPRIN_CLAVE` | ídem |

Los cuatro de SUNAT son los que ya están en Vercel. Si no los tienes a mano,
se vuelven a copiar desde ahí.

### 3. Probarlo sin esperar al día siguiente

Pestaña **Actions** · **SUNAT diario** · **Run workflow**. Tarda unos minutos
y el registro dice cuántos comprobantes entraron y cuántos llegaron distintos.

## Qué esperar

- **La primera vez** va a decir que hay muchos nuevos si el mes en curso no se
  había consultado.
- **Los días siguientes**, casi siempre cero nuevos y cero cambios. Eso es lo
  normal y significa que está funcionando.
- **Un día aparece un cambio**: eso es lo que se está buscando.

## Si falla

- **HTTP 429** — SUNAT frenó el pedido por insistirle. Se resuelve solo al día
  siguiente; no hay que hacer nada.
- **Falta la variable X** — se olvidó un secreto. El registro dice cuál.
- **El robot no pudo entrar** — la contraseña del secreto no coincide con la
  de la cuenta, o falta el rol del paso 1.

Si falla un período pero el otro entra, el trabajo no se marca como fallido:
perder los dos porque SUNAT limitó uno sería perder el día entero.
