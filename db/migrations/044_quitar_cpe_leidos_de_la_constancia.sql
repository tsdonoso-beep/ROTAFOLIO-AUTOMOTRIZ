-- Quitar los comprobantes guardados desde la constancia (CDR) en vez de la factura
--
-- Algunos emisores que envían por un OSE (COESTI vía Carvajal, entre otros)
-- entregan un zip con DOS XML: la constancia de recepción («R-…xml», un
-- ApplicationResponse) y la factura. Los scripts tomaban el primero, y
-- guardar_cpe recibió la constancia: filas sin RUC del emisor, sin tipo, sin
-- total y sin ítems (109 al 30/09/2026). Desde el mismo día los scripts eligen
-- el XML del comprobante (lib/sunat/cpe-xml.ts → documentoPrincipal) y se
-- niegan a guardar uno sin RUC/serie/número.
--
-- Estas filas no se pueden corregir en el lugar (su identidad es justo lo que
-- falta): se borran, y la próxima corrida de `pnpm cpe:local` vuelve a bajar
-- esos comprobantes —siguen pendientes contra el SIRE— y los guarda bien. Sus
-- archivos en Drive se reconocen por nombre y no se duplican.
--
-- Idempotente: en una base nueva, o ya limpia, no borra nada.

delete from cpe_cuota
 where comprobante_id in (select id from cpe_comprobante where proveedor_ruc is null and tipo_comprobante is null);

delete from cpe_item
 where comprobante_id in (select id from cpe_comprobante where proveedor_ruc is null and tipo_comprobante is null);

delete from cpe_comprobante
 where proveedor_ruc is null and tipo_comprobante is null;
