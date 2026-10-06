-- La empresa de cada OC y el pago de las OC nacionales
--
-- Reunión con Contabilidad (06/10/2026):
--   1. «La contabilidad se lleva por cada empresa»: las carpetas madre mezclan
--      OC de INROPRIN con OC de consorcios (Talleres Especializados I,
--      INROPRIN - INROPLAS, INNOVAPUCP…). La Base de Compras ya dice de qué
--      empresa es cada OC (columna EMPRESA); se la pasa a la vista y a GENERAL
--      para poder filtrar (INROPRIN por defecto).
--   2. En nacionales no hay SWIFT (eso es de pagos al exterior): lo que hay es
--      el comprobante de pago con su N.º de operación, el que se usa en la
--      conciliación bancaria. En nacionales se muestra «Pago de OC».
--
-- No se cambia carpetas_madre_fuentes() (cambiar sus columnas obliga a
-- borrarla y recrearla): la empresa se agrega en carpetas_madre_fuentes_json(),
-- que es lo que leen la vista y GENERAL.

-- «INDUSTRIAS ROLAND PRINT S.A.C.» → «INROPRIN»; los consorcios, con los
-- nombres cortos («CONSORCIO INROPRIN - INROPLAS»).
create or replace function empresa_corta(p_empresa text)
returns text
language sql
immutable
set search_path = pg_temp
as $$
  select trim(regexp_replace(regexp_replace(regexp_replace(regexp_replace(
           upper(coalesce(p_empresa, '')),
           'INDUSTRIAS ROLAND PRINT S\.?A\.?C\.?', 'INROPRIN', 'g'),
           'INRO ?PL[AÁ]STICOS S\.?A\.?C\.?', 'INROPLAS', 'g'),
           '\mROLAND PRINT\M', 'INROPRIN', 'g'),
           '\s+', ' ', 'g'));
$$;

create or replace function carpetas_madre_fuentes_json(p_empresa_ruc text default '20512201611')
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(x.f order by x.n), '[]'::jsonb)
    from (
      select to_jsonb(c) - 'ordinality' || jsonb_build_object(
               'empresa', coalesce(nullif(empresa_corta(coalesce(nullif(f.empresa, ''), nullif(cx.empresa, ''))), ''), 'INROPRIN'),
               'empresa_segun', case when nullif(f.empresa, '') is not null then 'Base de Compras'
                                     when nullif(cx.empresa, '') is not null then 'STATUS de COMEX'
                                     else 'Sin dato en Compras ni COMEX: se asume INROPRIN' end,
               'documentos', case when c.procedencia = 'Nacional' then regexp_replace(coalesce(c.documentos, ''), '\mSWIFT\M', 'Pago de OC', 'g')
                                  else c.documentos end
             ) f,
             c.ordinality n
        from carpetas_madre_fuentes(p_empresa_ruc) with ordinality c
        left join fuente_compra_oc f
          on f.empresa_ruc = p_empresa_ruc and f.procedencia = c.procedencia and f.oc = c.oc and (select seguridad.puede_ver_todo())
        left join fuente_comex_oc cx
          on cx.empresa_ruc = p_empresa_ruc and c.procedencia = 'Importación' and cx.oc = c.oc and (select seguridad.puede_ver_todo())
    ) x;
$$;

revoke execute on function carpetas_madre_fuentes_json(text) from public, anon;
grant execute on function carpetas_madre_fuentes_json(text) to authenticated;
