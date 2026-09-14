-- Qué columnas trajo el archivo y no se usaron
--
-- Hizo falta al no poder decidir si la detracción viene vacía de verdad o si
-- el lector no la encuentra: la diferencia son dos minutos de arreglo o nada
-- que arreglar, y sin este dato solo se puede averiguar mirando la pantalla
-- en el momento justo de una consulta.
--
-- Anotarlo en cada consulta convierte una pregunta puntual en algo que se
-- responde solo, también la próxima vez que SUNAT cambie el archivo: si un
-- día aparece «Base imponible» entre las no usadas, es que le cambiaron el
-- nombre y el número que muestra la hoja dejó de significar lo que dice.

alter table consultas_sunat
  add column columnas_sin_usar text[] not null default '{}';

comment on column consultas_sunat.columnas_sin_usar is
  'Títulos que trajo el archivo y el lector no supo mapear. Sirve para notar que SUNAT cambió el formato.';

-- registrar_consulta_sunat se redefine con un parámetro más al final,
-- p_columnas_sin_usar, con valor por omisión para no romper a quien la llame
-- sin él. El cuerpo se aplicó con la migración «anotar_las_columnas_sin_usar».
