-- A nombre de quién se emitió el comprobante
--
-- Administración lo revisa hoy papel por papel: "algunos dicen que
-- pidieron factura, pero cuando reviso el físico está a nombre del
-- trabajador". Una factura emitida a otro RUC no sustenta el gasto de la
-- empresa ni da derecho a crédito fiscal, y eso recién se descubre al
-- final, con la persona ya de vuelta y el proveedor lejos.
--
-- Guardarlo permite avisarlo en el momento de la captura y, después,
-- exportarlo para que Contabilidad pueda cruzarlo.
alter table gastos add column adquiriente_ruc text;

comment on column gastos.adquiriente_ruc is
  'RUC a nombre de quien se emitió el comprobante. Debe coincidir con el de la empresa para que sirva como sustento.';
