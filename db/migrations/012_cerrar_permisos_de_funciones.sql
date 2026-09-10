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
