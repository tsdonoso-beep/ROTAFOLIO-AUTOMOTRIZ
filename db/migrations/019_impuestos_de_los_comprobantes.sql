-- Los impuestos, que es lo que Contabilidad necesita para el crédito fiscal
--
-- Venían en el archivo del RCE desde el principio y se estaban descartando.
-- Con solo el total no se puede verificar el IGV, que es el trabajo de Rosa.
--
-- El archivo no trae UN igv sino tres, según a qué se destine la compra:
-- gravadas (DG), gravadas y no gravadas (DGNG) y no gravadas (DNG). Esa
-- distinción decide la prorrata del crédito fiscal. Se guardan separados
-- aunque la hoja muestre la suma: juntarlos al guardar perdería el dato para
-- siempre, y separarlos después obligaría a volver a consultar los nueve
-- períodos, con SUNAT limitando cuántas consultas seguidas acepta.

alter table comprobantes_sunat
  add column base_dg    numeric(14,2),
  add column igv_dg     numeric(14,2),
  add column base_dgng  numeric(14,2),
  add column igv_dgng   numeric(14,2),
  add column base_dng   numeric(14,2),
  add column igv_dng    numeric(14,2),
  add column detraccion numeric(14,2),
  add column tipo_cambio numeric(10,4);

comment on column comprobantes_sunat.igv_dg is
  'IGV de compras destinadas a operaciones gravadas: el que da crédito fiscal pleno.';
comment on column comprobantes_sunat.igv_dgng is
  'IGV de compras destinadas a gravadas y no gravadas: va a prorrata.';
comment on column comprobantes_sunat.igv_dng is
  'IGV de compras destinadas a no gravadas: no da crédito fiscal.';
comment on column comprobantes_sunat.detraccion is
  'Monto detraído. En Perú decide si el crédito fiscal se puede usar o se pierde.';

-- Las dos funciones se redefinen para guardar y devolver estos campos. El
-- cuerpo completo se aplicó con la migración «guardar_y_leer_los_impuestos»;
-- lo relevante de aquel cambio:
--
--   · guardar_comprobantes_sunat inserta y actualiza las ocho columnas.
--     Los impuestos NO se anotan como cambio: los comprobantes guardados
--     antes de esta migración los tienen en null, y llenarlos por primera vez
--     marcaría trece mil cambios falsos.
--
--   · historico_comprobantes_sunat devuelve `base` e `igv` como la suma de
--     los tres destinos, más la detracción y el tipo de cambio. El desglose
--     queda en la tabla por si Contabilidad lo pide: separarlo después sería
--     cambiar una columna, no volver a consultar nueve meses.
