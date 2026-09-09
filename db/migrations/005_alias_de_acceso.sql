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
