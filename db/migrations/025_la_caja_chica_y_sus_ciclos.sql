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
