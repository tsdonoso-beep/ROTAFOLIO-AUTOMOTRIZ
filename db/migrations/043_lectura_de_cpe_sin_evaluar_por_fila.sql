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
