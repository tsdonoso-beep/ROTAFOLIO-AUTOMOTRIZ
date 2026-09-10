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
