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
