"use server";
import { revalidatePath } from "next/cache";
import { clienteServidor, solicitanteActual } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";

type Resultado =
  | { ok: true; id?: string }
  | { ok: false; error: string };

// ════════════════════════════════════════════════════════════════
// La planilla de movilidad
// ════════════════════════════════════════════════════════════════
//
// El talonario es físico: la planilla 009979 es de Kory Sobrino y la 010212
// la usó Wilmer Zamora, de la misma serie comprada. Acá se registra su
// número, se cargan los desplazamientos uno por uno —como la ley exige— y la
// jefatura firma la casilla AUTORIZADO.
//
// En la sesión de trabajo se dio por hecho que la movilidad no necesitaba
// aprobación. El formulario dice lo contrario: tiene dos firmas.

export async function crearPlanilla(datos: {
  numero: string;
  usuarioId?: string;
  memoId?: string | null;
  periodo?: string | null;
  fechaEmision?: string | null;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  // Cada quien abre la suya; quien administra puede abrirla por otro.
  const dueno = datos.usuarioId ?? solicitante.usuarioId;
  if (dueno !== solicitante.usuarioId && !autoriza(solicitante, "crear_memo").ok) {
    return { ok: false, error: "Solo puedes abrir tu propia planilla." };
  }

  if (!datos.numero.trim()) {
    return { ok: false, error: "Falta el número de planilla del talonario." };
  }

  const sb = await clienteServidor();

  const { data, error } = await sb
    .from("planillas_movilidad")
    .insert({
      numero: datos.numero.trim(),
      usuario_id: dueno,
      memo_id: datos.memoId || null,
      periodo: datos.periodo?.trim() || null,
      fecha_emision: datos.fechaEmision || null,
      creado_por: solicitante.usuarioId,
    })
    .select("id")
    .single();

  // El número es de un talonario numerado de fábrica: repetirlo significa
  // que alguien copió mal, o que dos personas están usando la misma hoja.
  if (error) {
    if (error.code === "23505") {
      return {
        ok: false,
        error: `La planilla ${datos.numero} ya está registrada. `
          + "Revisa el número impreso en el talonario.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/movilidad");
  return { ok: true, id: data.id };
}

/**
 * Un desplazamiento es un gasto de clase MOVILIDAD que apunta a la planilla.
 *
 * No es una línea suelta dentro de un texto: es una fila con sus seis datos,
 * que se valida sola y que se cae sola si le falta alguno.
 */
export async function agregarDesplazamiento(datos: {
  planillaId: string;
  fecha: string;
  motivo: string;
  destino: string;
  monto: number;
}): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const sb = await clienteServidor();

  const { data: planilla } = await sb
    .from("planillas_movilidad")
    .select("id, usuario_id, memo_id, autorizado_en")
    .eq("id", datos.planillaId)
    .single();
  if (!planilla) return { ok: false, error: "La planilla no existe o no tienes acceso." };

  const permiso = autoriza(solicitante, "capturar_gasto", {
    propietarioId: planilla.usuario_id,
  });
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  // Una planilla ya firmada no admite filas nuevas: la firma cubre lo que
  // había cuando se firmó, y agregar después convierte el visto bueno en
  // una autorización en blanco.
  if (planilla.autorizado_en) {
    return {
      ok: false,
      error: "Esta planilla ya está autorizada. Para agregar un desplazamiento, "
        + "abre una nueva o pide que se levante la autorización.",
    };
  }

  const { error } = await sb.from("gastos").insert({
    // El identificador que trae el cliente sirve para no duplicar cuando la
    // conexión se cae a media carga. Acá el origen es el formulario, así
    // que se arma uno con la planilla y el momento.
    client_id: `planilla-${datos.planillaId}-${Date.now()}`,
    usuario_id: planilla.usuario_id,
    memo_id: planilla.memo_id,
    planilla_movilidad_id: datos.planillaId,
    clase: "MOVILIDAD",
    estado: "CAPTURADO",
    fecha_emision: datos.fecha || null,
    mov_motivo: datos.motivo.trim() || null,
    mov_destino: datos.destino.trim() || null,
    total: datos.monto,
    moneda: "PEN",
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/movilidad/${datos.planillaId}`);
  return { ok: true };
}

export async function quitarDesplazamiento(
  gastoId: string, planillaId: string
): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const sb = await clienteServidor();

  const { data: gasto } = await sb
    .from("gastos").select("id, usuario_id, estado").eq("id", gastoId).single();
  if (!gasto) return { ok: false, error: "El desplazamiento no existe." };

  const permiso = autoriza(solicitante, "editar_gasto_no_presentado", {
    propietarioId: gasto.usuario_id,
  });
  if (!permiso.ok) return { ok: false, error: permiso.motivo };

  if (gasto.estado !== "CAPTURADO" && gasto.estado !== "CON_ALERTA") {
    return { ok: false, error: "Este desplazamiento ya no se puede quitar." };
  }

  const { error } = await sb.from("gastos").delete().eq("id", gastoId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/movilidad/${planillaId}`);
  return { ok: true };
}

/**
 * La casilla AUTORIZADO, que firma la jefatura.
 *
 * Es el mismo Project Manager que firma los memos. Se guarda quién y cuándo,
 * no un booleano: una firma sin dueño no es una firma.
 */
export async function autorizarPlanilla(planillaId: string): Promise<Resultado> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, error: "Sesión no válida." };

  const permiso = autoriza(solicitante, "autorizar_apertura_con_pendientes");
  if (!permiso.ok) {
    return { ok: false, error: "Solo la jefatura puede autorizar una planilla de movilidad." };
  }

  const sb = await clienteServidor();

  const { data: planilla } = await sb
    .from("planillas_movilidad")
    .select("id, usuario_id, autorizado_en")
    .eq("id", planillaId)
    .single();
  if (!planilla) return { ok: false, error: "La planilla no existe o no tienes acceso." };
  if (planilla.autorizado_en) return { ok: false, error: "Esta planilla ya estaba autorizada." };

  // Nadie firma su propia planilla: el formulario tiene dos casillas
  // precisamente porque son dos personas.
  if (planilla.usuario_id === solicitante.usuarioId) {
    return {
      ok: false,
      error: "No puedes autorizar tu propia planilla: la casilla AUTORIZADO "
        + "la firma tu jefatura.",
    };
  }

  const { error } = await sb
    .from("planillas_movilidad")
    .update({
      autorizado_por: solicitante.usuarioId,
      autorizado_en: new Date().toISOString(),
    })
    .eq("id", planillaId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/movilidad/${planillaId}`);
  revalidatePath("/movilidad");
  return { ok: true };
}
