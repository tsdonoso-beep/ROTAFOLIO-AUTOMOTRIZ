"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { GASTO_CUENTA_EN_TOTAL, impedimentosParaPresentar, puedeEditarGasto, transicionMemoValida } from "@/lib/dominio/estados";
import { elegibleParaCaja, impedimentosParaRendirCaja, periodoDeCaja, resumirCaja } from "@/lib/dominio/cajachica";
import { leerParametros } from "@/lib/dominio/parametros";
import { validarGasto } from "@/lib/dominio/validaciones";
import type { AccionEvento, EstadoGasto, EstadoMemo, Parametros } from "@/lib/dominio/tipos";

type Resultado = { ok: true; id?: string } | { ok: false; error: string };

/**
 * Toda transición deja rastro. La marca de tiempo la pone la base, no el
 * navegador, y la tabla no admite update ni delete (SPEC §10.3).
 */
async function registrarEvento(
  sb: Awaited<ReturnType<typeof clienteServidor>>,
  entidad: "MEMO" | "GASTO",
  entidadId: string,
  accion: AccionEvento,
  usuarioId: string,
  antes?: unknown,
  despues?: unknown
) {
  const { error } = await sb.from("eventos").insert({
    entidad, entidad_id: entidadId, accion, usuario_id: usuarioId,
    datos_antes: antes ?? null, datos_despues: despues ?? null,
  });
  // La bitácora ya perdió su historial completo una vez por este mismo
  // motivo: un insert que RLS rechazaba en silencio porque nadie miraba
  // el error. No vuelve a pasar inadvertido, aunque tampoco se deja que
  // una falla de auditoría bloquee la transición que ya se aplicó.
  if (error) console.error(`registrarEvento(${entidad}/${accion}) falló:`, error.message);
}

// ════════════════════════════════════════════════════════════════
// Crear memo (ADMIN_MEMOS)
// ════════════════════════════════════════════════════════════════

export async function crearMemo(datos: {
  tipo: string;
  centro_costo_id: string;
  asignados: string[];
  destino: string;
  fecha_salida: string;
  fecha_retorno_prev: string;
  monto_autorizado: number;
  abrir: boolean;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "crear_memo");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!datos.asignados.length) {
    return { ok: false, error: "Asigna al menos una persona al memo." };
  }
  if (!(datos.monto_autorizado > 0)) {
    return { ok: false, error: "El monto autorizado debe ser mayor que cero." };
  }

  const sb = await clienteServidor();

  const { data: cc } = await sb
    .from("centros_costo")
    .select("id, empresa_id, empresas ( abreviatura )")
    .eq("id", datos.centro_costo_id)
    .single();

  if (!cc) return { ok: false, error: "El centro de costo no existe." };

  const abrev = (cc.empresas as unknown as { abreviatura: string } | null)?.abreviatura ?? "EMP";
  const anio = new Date().getFullYear();

  // El correlativo sale de una secuencia en la base. Contar filas daría
  // números repetidos si dos personas crean un memo a la vez.
  const { data: sec, error: errSec } = await sb.rpc("siguiente_correlativo", {
    p_empresa: cc.empresa_id, p_anio: anio, p_tipo: datos.tipo,
  });
  if (errSec) return { ok: false, error: `No se pudo generar el correlativo: ${errSec.message}` };

  const abreviaturaTipo: Record<string, string> = {
    VIATICOS: "VIA", PASAJES: "PAS", CAJA_CHICA: "CCH", OTRO: "OTR",
  };
  const correlativo = `${abrev}-${anio}-${abreviaturaTipo[datos.tipo] ?? "OTR"}-${String(sec).padStart(5, "0")}`;

  const { data: memo, error } = await sb
    .from("memos")
    .insert({
      correlativo,
      tipo: datos.tipo,
      empresa_id: cc.empresa_id,
      centro_costo_id: datos.centro_costo_id,
      destino: datos.destino || null,
      fecha_salida: datos.fecha_salida || null,
      fecha_retorno_prev: datos.fecha_retorno_prev || null,
      monto_autorizado: datos.monto_autorizado,
      estado: datos.abrir ? "ABIERTO" : "BORRADOR",
      creado_por: solicitante.usuarioId,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  const { error: errAsig } = await sb.from("memo_asignados").insert(
    datos.asignados.map(u => ({ memo_id: memo.id, usuario_id: u }))
  );
  if (errAsig) return { ok: false, error: errAsig.message };

  await registrarEvento(sb, "MEMO", memo.id, "CREAR", solicitante.usuarioId, null, {
    correlativo, monto_autorizado: datos.monto_autorizado, asignados: datos.asignados,
  });

  revalidatePath("/administrar");
  revalidatePath("/memos");
  return { ok: true, id: memo.id };
}

// ════════════════════════════════════════════════════════════════
// Presentar rendición (RENDIDOR)
// ════════════════════════════════════════════════════════════════

export async function presentarRendicion(memoId: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const sb = await clienteServidor();

  const { data: memo } = await sb
    .from("memos")
    .select("id, estado, memo_asignados ( usuario_id ), gastos ( estado, alertas, alertas_confirmadas )")
    .eq("id", memoId)
    .single();

  if (!memo) return { ok: false, error: "El memo no existe o no tienes acceso." };

  const esAsignado = (memo.memo_asignados ?? [])
    .some((a: { usuario_id: string }) => a.usuario_id === solicitante.usuarioId);

  const permiso = autoriza(solicitante, "presentar_rendicion", {
    propietarioId: esAsignado ? solicitante.usuarioId : "otro",
  });
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "PRESENTADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  // Se comprueban todos los impedimentos juntos para no ir de uno en uno.
  const impedimentos = impedimentosParaPresentar(memo.gastos ?? []);
  if (impedimentos.length) {
    return {
      ok: false,
      error: impedimentos.map(i => `${i.motivo}${i.cantidad ? ` (${i.cantidad})` : ""}`).join(" "),
    };
  }

  // Va por una función de la base y no por un update directo. Las políticas
  // de fila solo dejan escribir memos a ADMIN_MEMOS y ADMIN_SISTEMA, así que
  // un rendidor veía su update filtrado a cero filas —sin error— y la app le
  // decía que había presentado mientras el memo se quedaba donde estaba.
  //
  // Tampoco se resuelve dándole UPDATE sobre memos: RLS no distingue
  // columnas y con eso podría subirse su propio monto autorizado.
  const { error } = await sb.rpc("presentar_memo", { p_memo: memoId });
  if (error) return { ok: false, error: error.message };

  await registrarEvento(sb, "MEMO", memoId, "PRESENTAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "PRESENTADA" });

  revalidatePath("/memos");
  revalidatePath("/revisar");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Aprobar y observar (REVISOR_COSTOS / CONTABILIDAD)
// ════════════════════════════════════════════════════════════════

export async function aprobarRendicion(memoId: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "aprobar_rendicion");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const sb = await clienteServidor();
  const { data: memo } = await sb.from("memos").select("estado").eq("id", memoId).single();
  if (!memo) return { ok: false, error: "El memo no existe." };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "APROBADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  const { error } = await sb.from("memos").update({
    estado: "APROBADA",
    aprobado_por: solicitante.usuarioId,
    aprobado_en: new Date().toISOString(),
    observacion_actual: null,
  }).eq("id", memoId);
  if (error) return { ok: false, error: error.message };

  await sb.from("gastos").update({ estado: "APROBADO" })
    .eq("memo_id", memoId).eq("estado", "PRESENTADO");

  await registrarEvento(sb, "MEMO", memoId, "APROBAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "APROBADA" });

  revalidatePath("/revisar");
  revalidatePath("/contabilidad");
  return { ok: true };
}

/**
 * Observa gastos concretos, no la rendición entera.
 *
 * Es deliberado (SPEC §4.1): solo los gastos marcados vuelven a ser
 * editables. Devolver todo obligaría a rehacer la rendición completa por
 * una observación menor, que es el reproceso que hoy sufren.
 */
export async function observarGastos(
  memoId: string,
  observaciones: Array<{ gastoId: string; motivo: string }>
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "observar_devolver");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const conMotivo = observaciones.filter(o => o.motivo.trim());
  if (!conMotivo.length) {
    return { ok: false, error: "Cada observación necesita un motivo escrito." };
  }

  const sb = await clienteServidor();
  const { data: memo } = await sb.from("memos").select("estado").eq("id", memoId).single();
  if (!memo) return { ok: false, error: "El memo no existe." };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "OBSERVADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  for (const o of conMotivo) {
    await sb.from("gastos")
      .update({ estado: "OBSERVADO", observacion: o.motivo.trim() })
      .eq("id", o.gastoId).eq("memo_id", memoId);

    await registrarEvento(sb, "GASTO", o.gastoId, "OBSERVAR", solicitante.usuarioId,
      null, { motivo: o.motivo.trim() });
  }

  const resumen = `${conMotivo.length} gasto(s) observado(s).`;
  const { error } = await sb.from("memos")
    .update({ estado: "OBSERVADA", observacion_actual: resumen })
    .eq("id", memoId);
  if (error) return { ok: false, error: error.message };

  await registrarEvento(sb, "MEMO", memoId, "OBSERVAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "OBSERVADA", resumen });

  revalidatePath("/revisar");
  revalidatePath("/memos");
  return { ok: true };
}

export async function marcarContabilizado(memoId: string, asiento: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "marcar_contabilizado");
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const sb = await clienteServidor();
  const { data: memo } = await sb.from("memos").select("estado").eq("id", memoId).single();
  if (!memo) return { ok: false, error: "El memo no existe." };

  const transicion = transicionMemoValida(memo.estado as EstadoMemo, "CONTABILIZADA", solicitante.roles);
  if (!transicion.ok) return { ok: false, error: transicion.motivo };

  const { error } = await sb.from("memos")
    .update({ estado: "CONTABILIZADA", contabilizado_en: new Date().toISOString() })
    .eq("id", memoId);
  if (error) return { ok: false, error: error.message };

  await sb.from("gastos").update({ estado: "CONTABILIZADO" })
    .eq("memo_id", memoId).eq("estado", "APROBADO");

  await registrarEvento(sb, "MEMO", memoId, "CONTABILIZAR", solicitante.usuarioId,
    { estado: memo.estado }, { estado: "CONTABILIZADA", asiento: asiento || null });

  revalidatePath("/contabilidad");
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Editar un gasto (RENDIDOR sobre lo propio, o ADMIN_MEMOS)
// ════════════════════════════════════════════════════════════════
//
// Es la contraparte de la captura: mismos datos, misma revalidación. La
// diferencia es que aquí el gasto ya existe, así que las alertas se
// recalculan sobre lo nuevo y la confirmación anterior queda sin efecto
// —si los datos cambiaron, lo que la persona había confirmado ya no es
// lo que hay—. Corre en el servidor y no en el cliente, a diferencia de
// Captura, porque acá sí importa que el propio cliente no pueda decidir
// con qué alertas se guarda su corrección.

export interface DatosGasto {
  proveedor_ruc: string;
  proveedor_nombre: string;
  adquiriente_ruc: string;
  tipo_comprobante: string;
  serie: string;
  numero: string;
  fecha_emision: string;
  moneda: "PEN" | "USD";
  subtotal: number;
  igv: number;
  total: number;
  forma_pago: string;
  detalle: string;
}

export async function editarGasto(gastoId: string, datos: DatosGasto): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  if (!(datos.total > 0)) {
    return { ok: false, error: "El total debe ser mayor que cero." };
  }

  const sb = await clienteServidor();

  const { data: gasto } = await sb
    .from("gastos")
    .select(`
      id, estado, usuario_id, memo_id, proveedor_ruc, proveedor_nombre,
      adquiriente_ruc, tipo_comprobante, serie, numero, fecha_emision, moneda,
      subtotal, igv, total, forma_pago, detalle, confianza_extraccion,
      memos ( estado, monto_autorizado, fecha_salida, fecha_retorno_prev, empresas ( ruc ) )
    `)
    .eq("id", gastoId)
    .single();
  if (!gasto) return { ok: false, error: "El gasto no existe o no tienes acceso." };

  const permiso = autoriza(solicitante, "editar_gasto_no_presentado", {
    propietarioId: gasto.usuario_id,
  });
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  const memo = gasto.memos as unknown as {
    estado: EstadoMemo; monto_autorizado: number;
    fecha_salida: string | null; fecha_retorno_prev: string | null;
    empresas: { ruc: string } | null;
  } | null;

  // El mismo candado que ya declaraba lib/dominio/estados.ts y que la
  // interfaz nunca había consultado: un memo OBSERVADA solo deja tocar el
  // gasto que efectivamente fue observado, no el resto de la rendición.
  if (!puedeEditarGasto(gasto.estado as EstadoGasto, memo?.estado ?? null)) {
    return { ok: false, error: "Este gasto ya no se puede editar en su estado actual." };
  }

  // Duplicados, excluyendo el propio gasto: el índice único de la base
  // hace la misma comprobación al guardar, pero así el mensaje es claro
  // antes de intentarlo.
  let duplicadoComprobante = false;
  if (datos.proveedor_ruc && datos.serie && datos.numero) {
    const { data: dup } = await sb
      .from("gastos").select("id")
      .eq("proveedor_ruc", datos.proveedor_ruc)
      .eq("serie", datos.serie)
      .eq("numero", datos.numero)
      .neq("id", gastoId)
      .limit(1);
    duplicadoComprobante = !!dup?.length;
  }

  const { data: filasParam } = await sb.from("parametros").select("clave, valor");
  const parametros: Parametros = leerParametros(filasParam);

  // "Lo ya rendido sin contar este gasto": si este gasto todavía sumaba
  // al total (VALIDADO o CON_ALERTA), se descuenta para no contarlo dos
  // veces contra el monto autorizado.
  let rendidoPrevio = 0;
  if (memo) {
    const { data: otros } = await sb
      .from("gastos").select("estado, total")
      .eq("memo_id", gasto.memo_id).neq("id", gastoId);
    rendidoPrevio = (otros ?? [])
      .filter(g => GASTO_CUENTA_EN_TOTAL.includes(g.estado as EstadoGasto))
      .reduce((s, g) => s + Number(g.total ?? 0), 0);
  }

  const alertas = validarGasto(
    {
      clase: "COMPROBANTE",
      proveedor_ruc: datos.proveedor_ruc,
      adquiriente_ruc: datos.adquiriente_ruc,
      tipo_comprobante: datos.tipo_comprobante,
      fecha_emision: datos.fecha_emision,
      subtotal: datos.subtotal, igv: datos.igv, total: datos.total,
      // Editar es en sí mismo un acto de revisión: la confianza de una
      // extracción automática ya no aplica a un valor que la persona
      // acaba de escribir o verificar a mano. Se limpia para no arrastrar
      // una alerta de "poca confianza" sobre un dato recién confirmado.
      confianza_extraccion: null,
    },
    {
      parametros,
      rucEmpresa: (memo?.empresas as unknown as { ruc: string } | null)?.ruc ?? null,
      memo: memo ? {
        monto_autorizado: Number(memo.monto_autorizado),
        fecha_salida: memo.fecha_salida,
        fecha_retorno_prev: memo.fecha_retorno_prev,
        rendido_previo: rendidoPrevio,
      } : undefined,
      duplicadoComprobante,
      duplicadoImagen: false,
    }
  );

  const nuevoEstado: EstadoGasto = alertas.length ? "CON_ALERTA" : "VALIDADO";

  const { error } = await sb.from("gastos").update({
    proveedor_ruc: datos.proveedor_ruc || null,
    proveedor_nombre: datos.proveedor_nombre || null,
    adquiriente_ruc: datos.adquiriente_ruc || null,
    tipo_comprobante: datos.tipo_comprobante || null,
    serie: datos.serie || null,
    numero: datos.numero || null,
    fecha_emision: datos.fecha_emision || null,
    moneda: datos.moneda,
    subtotal: datos.subtotal, igv: datos.igv, total: datos.total,
    forma_pago: datos.forma_pago || null,
    detalle: datos.detalle || null,
    alertas,
    alertas_confirmadas: false,
    confianza_extraccion: null,
    estado: nuevoEstado,
    // La observación ya fue atendida: es lo que esta edición documenta.
    observacion: null,
  }).eq("id", gastoId);

  if (error) {
    return {
      ok: false,
      error: /duplicate key|unique/i.test(error.message)
        ? "Ya existe otro gasto con el mismo RUC, serie y número."
        : error.message,
    };
  }

  await registrarEvento(sb, "GASTO", gastoId, "EDITAR", solicitante.usuarioId,
    {
      proveedor_ruc: gasto.proveedor_ruc, serie: gasto.serie, numero: gasto.numero,
      total: gasto.total, estado: gasto.estado,
    },
    { ...datos, estado: nuevoEstado, alertas });

  revalidatePath("/memos");
  if (gasto.memo_id) revalidatePath(`/memos/${gasto.memo_id}`);
  return { ok: true };
}

// ════════════════════════════════════════════════════════════════
// Caja chica: el memo se crea al final (RENDIDOR sobre lo propio)
// ════════════════════════════════════════════════════════════════
//
// "El proceso es invertido: no hay memo al inicio, hay memo al final. Yo
// presento lo que gasté, lo revisa mi jefe, aprueba, genera un memo y se va
// a pago." Los gastos ya existen sueltos —la bandeja sin asignar—; esta
// acción los junta, crea el memo con lo que efectivamente se gastó y lo
// deja presentado.
//
// El monto autorizado va en cero, y no es un vacío que se llena después:
// es la verdad del caso. Nadie entregó plata por adelantado, así que todo
// lo rendido es un reembolso. El consolidado ya lo calcula así, y por eso
// aparece correctamente en la liquidación como saldo a favor de la persona.

export async function rendirCajaChica(datos: {
  centroCostoId: string;
  gastoIds: string[];
  descripcion: string;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "presentar_rendicion", {
    propietarioId: solicitante.usuarioId,
  });
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (!datos.gastoIds.length) {
    return { ok: false, error: "No seleccionaste ningún comprobante." };
  }

  const sb = await clienteServidor();

  // Se releen de la base en vez de confiar en lo que mandó el navegador:
  // el importe del memo sale de acá y no puede depender del cliente.
  const { data: gastos } = await sb
    .from("gastos")
    .select("id, estado, total, memo_id, usuario_id, alertas, alertas_confirmadas, fecha_emision")
    .in("id", datos.gastoIds);

  if (!gastos?.length) return { ok: false, error: "No se encontraron esos comprobantes." };

  const ajeno = gastos.find(g => g.usuario_id !== solicitante.usuarioId);
  if (ajeno) return { ok: false, error: "Solo puedes rendir comprobantes tuyos." };

  const noElegible = gastos.find(
    g => !elegibleParaCaja({ memo_id: g.memo_id, estado: g.estado as EstadoGasto })
  );
  if (noElegible) {
    return {
      ok: false,
      error: "Alguno de los comprobantes ya pertenece a un memo o ya fue presentado.",
    };
  }

  const impedimentos = impedimentosParaRendirCaja(gastos as never);
  if (impedimentos.length) {
    return {
      ok: false,
      error: impedimentos
        .map(i => `${i.motivo}${i.cantidad ? ` (${i.cantidad})` : ""}`)
        .join(" "),
    };
  }

  const resumen = resumirCaja(gastos as never);

  // Crear el memo, asignárselo y colgarle los gastos son cinco escrituras
  // que solo sirven juntas: van en una función de la base para que no quede
  // un memo a medio armar si algo falla, y porque un rendidor no tiene
  // permiso de escritura directa sobre memos.
  const { data: memoId, error: errCrear } = await sb.rpc("crear_caja_chica", {
    p_centro: datos.centroCostoId,
    p_gastos: datos.gastoIds,
    p_descripcion: datos.descripcion.trim() || periodoDeCaja(resumen),
  });
  if (errCrear) return { ok: false, error: errCrear.message };

  await registrarEvento(sb, "MEMO", memoId as string, "CREAR", solicitante.usuarioId, null, {
    tipo: "CAJA_CHICA",
    comprobantes: datos.gastoIds.length,
    total: resumen.aReembolsar,
  });

  // Recién ahora se presenta. El memo existió el tiempo justo de armarse, y
  // la bitácora conserva los dos pasos por separado.
  const { error: errPres } = await sb.rpc("presentar_memo", { p_memo: memoId });
  if (errPres) return { ok: false, error: errPres.message };

  await registrarEvento(sb, "MEMO", memoId as string, "PRESENTAR", solicitante.usuarioId,
    { estado: "EN_RENDICION" }, { estado: "PRESENTADA" });

  revalidatePath("/memos");
  revalidatePath("/memos/sin-asignar");
  revalidatePath("/revisar");
  return { ok: true, id: memoId as string };
}
