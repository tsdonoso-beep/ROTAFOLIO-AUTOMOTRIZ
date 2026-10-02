-- El cuadro de costeo de COMEX, un documento más del legajo de importaciones
--
-- Contabilidad pidió ver si cada importación tiene su cuadro de costeo
-- («COSTEO FINAL OC 012-2026.xlsx», «FORMATO DE COSTEO DOLAR Y EURO …»). El
-- robot lo reconoce desde lib/drive/carpetas-oc.ts («CUADRO DE COSTEO») y lo
-- pide en las importaciones (legajo-carpeta.ts), no en nacionales. Acá:
--   1. documentos_de_archivo() lo cuenta como COSTEO;
--   2. se ponen al día los archivos y las carpetas ya leídos, con la misma
--      regla, para que la próxima lectura no anote como cambio («ahora le
--      falta») lo que en realidad es una regla nueva.

create or replace function documentos_de_archivo(p_parece text, p_claves_leidas text)
returns text[]
language sql
immutable
set search_path = pg_temp
as $$
  select array(select distinct c from (
    select case
      when p ~ '^(FACTURA|COMPROBANTE|RECIBO POR|BOLETA|NOTA DE|XML$|INVOICE)' then 'FACTURA'
      when p = 'ORDEN DE COMPRA/SERVICIO' then 'OC'
      when p = 'SWIFT' then 'SWIFT'
      when p = 'GUÍA' then 'GUIA'
      when p in ('DAM', 'DOCUMENTO DE IMPORTACIÓN') then 'DAM'
      when p = 'CUADRO DE COSTEO' then 'COSTEO'
      when p = 'REQUERIMIENTO' then 'REQ'
      when p = 'CONTRATO' then 'CONTRATO'
      when p = 'COTIZACIÓN' then 'COTIZACION'
      when p = 'PROFORMA' then 'PROFORMA'
      when p = 'CORREO / CAPTURA' then 'CORREO'
      when p = 'ACTA DE CONFORMIDAD' then 'ACTA'
    end c
    from (select regexp_replace(coalesce(p_parece, ''), ' \(por la carpeta\)$', '') p) x
    union all
    select trim(l) from unnest(string_to_array(coalesce(p_claves_leidas, ''), ',')) l
     where trim(l) in ('FACTURA', 'OC', 'SWIFT', 'GUIA', 'DAM', 'COSTEO', 'REQ', 'CONTRATO', 'COTIZACION', 'PROFORMA', 'CORREO', 'ACTA')
  ) y where c is not null);
$$;

-- Los archivos de costeo ya leídos.
update oc_archivo set parece = 'CUADRO DE COSTEO'
 where origen = 'CARPETA'
   and upper(nombre) ~ '(^|[^A-ZÁÉÍÓÚÑ])(COSTEO|COSTEOS)([^A-ZÁÉÍÓÚÑ]|$)';

-- Las importaciones sin cuadro de costeo: les falta.
update oc_carpeta k
   set le_falta = case when coalesce(k.le_falta, '') = '' then 'Cuadro de costeo' else k.le_falta || ', Cuadro de costeo' end,
       estado = case when k.estado = 'OK' then 'INCOMPLETA' else k.estado end
 where k.procedencia = 'Importación'
   and coalesce(k.le_falta, '') not like '%Cuadro de costeo%'
   and not exists (select 1 from oc_archivo a
                    where a.empresa_ruc = k.empresa_ruc and a.origen = 'CARPETA' and a.carpeta_url = k.carpeta_url
                      and a.parece = 'CUADRO DE COSTEO');
