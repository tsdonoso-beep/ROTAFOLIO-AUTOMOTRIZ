-- El cargo, que el memo firma y el anexo nombra
--
-- El memo va firmado por alguien con un cargo: en el 594-2026, José Haertel
-- como Project Manager. Y el anexo de caja chica nombra el rol con todas sus
-- letras, «Ejecutor y Administrador de Caja Chica». Un memo generado sin
-- cargo sale con el nombre solo, que no es como se firma un documento
-- dirigido a la Gerencia de Administración y Finanzas.
--
-- El dato ya existía: la hoja «4. Estados Contrato Personal Pa» del
-- seguimiento lo trae por persona, y el lector de la carga ya lo extraía.
-- Solo que no tenía dónde guardarse.

alter table usuarios add column cargo text;

comment on column usuarios.cargo is
  'Como firma y como se le nombra en el anexo. Sale del seguimiento de Control de Gestión.';
