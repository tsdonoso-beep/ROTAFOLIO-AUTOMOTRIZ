-- Hospedaje: el tipo de memo más frecuente que existe, y no estaba
--
-- Se venía tratando como un viático. No lo es, y los números lo dicen:
--
--   · De los 125 memos que administra Annie: 65 son hospedaje, 45 viáticos
--     y 15 caja chica.
--   · De los 423 asuntos del MemoTracker, 189 dicen HOSPEDAJE y 150 VIÁTICOS.
--
-- Se diferencia del viático en quién gasta: el hospedaje de todo el personal
-- que viaja lo gestiona Administración de forma centralizada, no cada persona
-- por su cuenta. Meterlo en la misma bolsa que los viáticos hacía que el
-- memo más común del año no se pudiera ni contar aparte.
--
-- Va solo en esta migración: PostgreSQL no deja usar un valor de enum recién
-- agregado dentro de la misma transacción que lo agrega.

alter type tipo_memo add value if not exists 'HOSPEDAJE';
