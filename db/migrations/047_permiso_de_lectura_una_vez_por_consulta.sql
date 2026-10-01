-- El permiso de lectura de las tablas de OC, mirado una vez por consulta
--
-- Las políticas decían `using (seguridad.puede_ver_todo())`: Postgres la
-- evaluaba en CADA fila (~1 ms por fila). Leer oc_archivo entera (10 mil
-- filas, de a 1000) tardaba ~10 s por página y la consulta se cortaba por
-- tiempo («canceling statement due to statement timeout»): le pasó a la
-- comparación con CG de scripts/carpetas-oc.mts el 01/10/2026.
--
-- Con `(select …)` se evalúa una sola vez por consulta (un InitPlan). El
-- permiso es el mismo: quien no puede ver todo sigue sin ver ninguna fila.
-- La última página de oc_archivo pasó de ~10 s a 0,15 s.

alter policy oc_archivo_lectura on oc_archivo using ((select seguridad.puede_ver_todo()));
alter policy oc_base_cg_lectura on oc_base_cg using ((select seguridad.puede_ver_todo()));
alter policy oc_legajo_lectura on oc_legajo using ((select seguridad.puede_ver_todo()));
alter policy oc_carpeta_lectura on oc_carpeta using ((select seguridad.puede_ver_todo()));
