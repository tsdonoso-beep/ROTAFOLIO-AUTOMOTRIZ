-- El mismo comprobante puede estar anotado en varios períodos
--
-- Las tres primeras alertas que dio esta función eran falsas. Se vieron
-- porque los tiempos no cuadraban: un comprobante «cambió» 22 segundos
-- después de guardarse, justo mientras se consultaba OTRO mes.
--
--   guardado 03:28:59 (consultando 202603)
--   «cambió» 03:29:21 (consultando 202602)
--
-- Los tres eran tipo 53 —declaraciones de importación, con RUC de proveedor
-- «0»—, y ese documento se anota en más de un período a medida que se aplica
-- el crédito fiscal. Es normal en un registro de compras.
--
-- El error estaba en la llave: identificaba al comprobante por empresa y CAR,
-- sin el período. Dos anotaciones legítimas del mismo documento colapsaban en
-- una fila, y el importe de la segunda parecía un cambio de la primera.
--
-- El RCE es un registro POR PERÍODO. Un comprobante anotado en dos meses son
-- dos anotaciones, no una que cambia. Un cambio de verdad es el mismo
-- comprobante, en el mismo período, distinto entre dos consultas de ese mes.
--
-- Una alerta falsa cuesta más que no alertar: a la tercera nadie las mira, y
-- entonces tampoco se ve la verdadera.

alter table comprobantes_sunat
  drop constraint comprobantes_sunat_unico;

alter table comprobantes_sunat
  add constraint comprobantes_sunat_unico unique (empresa_ruc, periodo, llave);

-- Los tres cambios registrados son de este error, no de SUNAT.
delete from cambios_comprobante_sunat
where comprobante_id in (
  select id from comprobantes_sunat where tipo_comprobante = '53'
);

-- La función se redefine entera: el único cambio es que la búsqueda del
-- comprobante anterior incluye el período.
--
--   select * into v_antes from comprobantes_sunat
--    where empresa_ruc = p_empresa_ruc
--      and periodo = p_periodo        -- <- esto faltaba
--      and llave = v_llave;
--
-- (el cuerpo completo está en 016_comprobantes_de_sunat.sql; acá solo se
--  cambia esa condición)

create or replace function guardar_comprobantes_sunat(
  p_empresa_ruc text,
  p_periodo     text,
  p_filas       jsonb
) returns table (nuevos integer, cambiados integer)
language plpgsql
security definer
set search_path = public, seguridad, pg_temp
as $$
declare
  v_nuevos    integer := 0;
  v_cambiados integer := 0;
  f           jsonb;
  v_llave     text;
  v_id        uuid;
  v_antes     comprobantes_sunat%rowtype;
  v_total     numeric(14,2);
  v_estado    text;
begin
  if seguridad.usuario_actual() is null then
    raise exception 'No hay sesión.';
  end if;
  if not seguridad.tiene_rol('ADMIN_SISTEMA') then
    raise exception 'Solo Administración del sistema guarda comprobantes de SUNAT.';
  end if;

  for f in select * from jsonb_array_elements(p_filas)
  loop
    -- La llave se arma acá y no se recibe: si viniera de afuera, un error
    -- del lado de la aplicación duplicaría comprobantes en silencio.
    v_llave := coalesce(
      nullif(trim(f->>'carSunat'), ''),
      concat_ws('|',
        coalesce(f->>'ruc', ''), coalesce(f->>'tipoComprobante', ''),
        upper(coalesce(f->>'serie', '')), coalesce(f->>'numero', '')
      )
    );

    v_total  := nullif(f->>'total', '')::numeric;
    v_estado := nullif(trim(f->>'estado'), '');

    -- Con el período en la búsqueda: la anotación de agosto y la de
    -- setiembre del mismo documento son dos filas, y ninguna se lee como
    -- cambio de la otra.
    select * into v_antes from comprobantes_sunat
     where empresa_ruc = p_empresa_ruc and periodo = p_periodo and llave = v_llave;

    if not found then
      insert into comprobantes_sunat (
        empresa_ruc, periodo, llave, car_sunat, proveedor_ruc, proveedor_nombre,
        tipo_comprobante, serie, numero, fecha_emision, total, moneda, estado,
        tipo_nota, modifica_tipo, modifica_serie, modifica_numero, modifica_fecha
      ) values (
        p_empresa_ruc, p_periodo, v_llave, nullif(trim(f->>'carSunat'), ''),
        nullif(f->>'ruc', ''), nullif(f->>'razonSocial', ''),
        nullif(f->>'tipoComprobante', ''), nullif(f->>'serie', ''), nullif(f->>'numero', ''),
        nullif(f->>'fechaEmision', '')::date, v_total, nullif(f->>'moneda', ''), v_estado,
        nullif(f->>'tipoNota', ''),
        nullif(f#>>'{modifica,tipo}', ''), nullif(f#>>'{modifica,serie}', ''),
        nullif(f#>>'{modifica,numero}', ''), nullif(f#>>'{modifica,fechaEmision}', '')::date
      );
      v_nuevos := v_nuevos + 1;
      continue;
    end if;

    v_id := v_antes.id;

    -- Solo se anota lo que de verdad cambió. Una consulta repetida del mismo
    -- período no debe llenar la historia de filas que dicen lo mismo.
    if v_antes.estado is distinct from v_estado then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'estado', v_antes.estado, v_estado);
      v_cambiados := v_cambiados + 1;
    end if;

    if v_antes.total is distinct from v_total then
      insert into cambios_comprobante_sunat (comprobante_id, campo, antes, despues)
      values (v_id, 'total', v_antes.total::text, v_total::text);
      v_cambiados := v_cambiados + 1;
    end if;

    update comprobantes_sunat
       set estado = v_estado,
           total = v_total,
           proveedor_nombre = coalesce(nullif(f->>'razonSocial', ''), proveedor_nombre),
           ultima_vez = now()
     where id = v_id;
  end loop;

  nuevos := v_nuevos;
  cambiados := v_cambiados;
  return next;
end;
$$;

revoke execute on function guardar_comprobantes_sunat(text, text, jsonb) from public, anon;
grant execute on function guardar_comprobantes_sunat(text, text, jsonb) to authenticated;

-- Supabase concede todo por omisión al crear una tabla.
