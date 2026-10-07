-- La Consulta RUC también para los RUC que no vienen del SIRE de compras
--
-- La pestaña PADRÓN RUC de INROCONTA mostraba ~180 RUC «Sin consultar»: tienen
-- domicilio (padrón reducido, migración 062) pero la Consulta RUC solo miraba
-- a los proveedores del SIRE de compras (comprobantes_sunat). Ahora entran
-- también los clientes y proveedores de los XML (cpe_comprobante), los de la
-- Base de Compras (fuente_compra_oc) y los que ya tienen domicilio
-- (ruc_domicilio). Los nunca consultados van primero.

create or replace function rucs_por_actualizar_en_padron(p_dias_vigencia int default 30)
returns table (ruc text)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select x.r as ruc
  from (
    select c.proveedor_ruc r from comprobantes_sunat c
    union select c.proveedor_ruc from cpe_comprobante c
    union select c.adquiriente_ruc from cpe_comprobante c
    union select f.proveedor_ruc from fuente_compra_oc f
    union select d.ruc from ruc_domicilio d
  ) x
  left join padron_ruc p on p.ruc = x.r
  where seguridad.puede_ver_todo()
    and x.r ~ '^\d{11}$'
    and x.r <> '20512201611'
    and (p.ruc is null or p.consultado_en < now() - (p_dias_vigencia || ' days')::interval)
  order by (p.ruc is null) desc, x.r;
$$;

revoke execute on function rucs_por_actualizar_en_padron(int) from anon;
grant  execute on function rucs_por_actualizar_en_padron(int) to authenticated;
