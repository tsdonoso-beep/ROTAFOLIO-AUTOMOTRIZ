-- Los períodos del detalle, para pedir la hoja DETALLE de a uno
--
-- La hoja DETALLE se pedía entera, paginada de a 1000: cada página volvía a
-- calcular los ~27 000 ítems (~6 s) y alguna pasaba los 8 s que la base da a
-- cada consulta del robot («statement timeout», 05/10/2026, en la
-- computadora de Contabilidad). detalleCpeCompleto() (lib/export/items-sunat.ts)
-- ahora pide la lista de períodos y el detalle de cada uno (~1 s).

create or replace function periodos_detalle_cpe()
returns table (periodo text)
language sql
stable
set search_path = public, pg_temp
as $$
  select distinct c.periodo from cpe_comprobante c where c.periodo is not null order by 1;
$$;

grant execute on function periodos_detalle_cpe() to authenticated;
