-- La bitácora nunca recibía inserciones: faltaba la política de INSERT.
--
-- Con RLS activo y ninguna política que cubra el comando, la orden se
-- deniega en silencio para el rol autenticado — y `registrarEvento`
-- (app/acciones/memos.ts) no revisaba el `error` de la respuesta, así que
-- nada lo delataba. Confirmado contra la base real: 0 filas en `eventos`
-- pese a memos ya creados, presentados y aprobados en las pruebas. Todo el
-- historial de "quién hizo qué y cuándo" —la razón de ser de esta tabla—
-- llevaba desde el inicio sin registrarse.
--
-- `usuario_id = usuario_actual()` impide que alguien registre un evento a
-- nombre de otra persona; update y delete siguen bloqueados por las reglas
-- ya existentes (`eventos_sin_update`, `eventos_sin_delete`), así que la
-- bitácora sigue siendo de solo-agregar.
create policy eventos_insercion on eventos for insert
  with check (usuario_id = seguridad.usuario_actual());
