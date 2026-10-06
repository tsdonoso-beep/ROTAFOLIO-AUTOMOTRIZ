-- El domicilio fiscal de cada RUC (padrón reducido de SUNAT) y la ficha del
-- proveedor para la vista
--
-- Reunión con Contabilidad (06/10/2026): Georgina pidió ver en la búsqueda
-- del proveedor si es Buen Contribuyente —sin entrar a SUNAT ni a la
-- Consulta RUC—, y su domicilio fiscal, que después sirve para ubicar cada
-- OC.
--
--   · La condición (Buen Contribuyente, Agente de Retención/Percepción) ya
--     está en padron_ruc (migración 038, la trae la Consulta RUC con
--     Playwright).
--   · El domicilio sale del padrón reducido que SUNAT publica cada día
--     (scripts/padron-domicilios.mts): un archivo con todos los RUC del país,
--     del que se guardan solo los que nos importan (proveedores, clientes y
--     los de la Base de Compras).
--
-- Tabla aparte de padron_ruc a propósito: si el domicilio entrara a
-- padron_ruc, un RUC nuevo aparecería «consultado» y la Consulta RUC no le
-- traería la condición de Buen Contribuyente.

create table if not exists ruc_domicilio (
  ruc            text primary key,
  razon_social   text,
  estado         text,
  condicion      text,
  ubigeo         text,
  departamento   text,
  provincia      text,
  distrito       text,
  direccion      text,
  cargado_en     timestamptz not null default now()
);

comment on table ruc_domicilio is
  'Domicilio fiscal de cada RUC según el padrón reducido de SUNAT (www2.sunat.gob.pe/padron_reducido_ruc.zip). Solo los RUC que aparecen en compras, ventas o la Base de Compras. Las personas naturales vienen sin dirección.';

alter table ruc_domicilio enable row level security;

create policy ruc_domicilio_lectura on ruc_domicilio for select using (seguridad.puede_ver_todo());

revoke all on ruc_domicilio from anon;
revoke insert, update, delete, truncate, references, trigger on ruc_domicilio from authenticated;

-- Los RUC de los que interesa el domicilio: proveedores y clientes de los
-- comprobantes, los de la Base de Compras y los ya consultados en padron_ruc.
create or replace function rucs_para_domicilio()
returns table (ruc text)
language sql
stable
security definer
set search_path = public, seguridad, pg_temp
as $$
  select r from (
    select c.proveedor_ruc r from cpe_comprobante c
    union select c.adquiriente_ruc from cpe_comprobante c
    union select f.proveedor_ruc from fuente_compra_oc f
    union select p.ruc from padron_ruc p
  ) x
  where seguridad.puede_ver_todo() and r ~ '^\d{11}$'
  order by 1;
$$;

-- Guarda el lote de una corrida (una llamada por cada mil RUC).
create or replace function guardar_domicilios_ruc(p_filas jsonb)
returns integer
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v integer;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema actualiza el domicilio de los RUC.';
  end if;
  insert into ruc_domicilio as d (ruc, razon_social, estado, condicion, ubigeo, departamento, provincia, distrito, direccion, cargado_en)
  select f->>'ruc', nullif(f->>'razonSocial', ''), nullif(f->>'estado', ''), nullif(f->>'condicion', ''),
         nullif(f->>'ubigeo', ''), nullif(f->>'departamento', ''), nullif(f->>'provincia', ''), nullif(f->>'distrito', ''),
         nullif(f->>'direccion', ''), now()
    from jsonb_array_elements(p_filas) f
   where f->>'ruc' ~ '^\d{11}$'
  on conflict (ruc) do update set
    razon_social = excluded.razon_social, estado = excluded.estado, condicion = excluded.condicion,
    ubigeo = excluded.ubigeo, departamento = excluded.departamento, provincia = excluded.provincia,
    distrito = excluded.distrito, direccion = excluded.direccion, cargado_en = excluded.cargado_en;
  get diagnostics v = row_count;
  return v;
end;
$$;

-- La ficha de cada RUC para la vista, en una sola fila:
-- [ruc, buen contribuyente, agente de retención, agente de percepción, estado, condición,
--  dirección, distrito, provincia, departamento, consultado el (padrón de condición)].
create or replace function fichas_ruc_json()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(jsonb_build_array(
           r.ruc, coalesce(p.buen_contribuyente, false), coalesce(p.agente_retencion, false), coalesce(p.agente_percepcion, false),
           coalesce(nullif(d.estado, ''), p.estado, ''), coalesce(nullif(d.condicion, ''), p.condicion, ''),
           coalesce(d.direccion, ''), coalesce(d.distrito, ''), coalesce(d.provincia, ''), coalesce(d.departamento, ''),
           case when p.ruc is null then '' else to_char(p.consultado_en at time zone 'America/Lima', 'YYYY-MM-DD') end
         ) order by r.ruc), '[]'::jsonb)
    from (select ruc from padron_ruc union select ruc from ruc_domicilio) r
    left join padron_ruc p on p.ruc = r.ruc
    left join ruc_domicilio d on d.ruc = r.ruc
   where (select seguridad.puede_ver_todo());
$$;

revoke execute on function rucs_para_domicilio() from public, anon;
grant execute on function rucs_para_domicilio() to authenticated;
revoke execute on function guardar_domicilios_ruc(jsonb) from public, anon;
grant execute on function guardar_domicilios_ruc(jsonb) to authenticated;
revoke execute on function fichas_ruc_json() from public, anon;
grant execute on function fichas_ruc_json() to authenticated;
