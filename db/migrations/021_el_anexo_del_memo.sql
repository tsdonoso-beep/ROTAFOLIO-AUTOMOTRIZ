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
