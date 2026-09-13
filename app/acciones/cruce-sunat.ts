"use server";
// Cruzar un período contra SUNAT, desde la pantalla
//
// SUNAT no contesta al momento: encola el pedido y devuelve un ticket. Y
// cada petición a este servidor tiene un minuto de vida. Las dos cosas
// juntas obligan a partirlo en pasos: la pantalla pide, pregunta, y cuando
// el ticket está listo, baja y cruza. El número de ticket viaja al navegador
// y vuelve, así no hace falta guardarlo en ningún lado.
//
// Nada de esto escribe en la base. Es una consulta: se mira y se cierra.

import { solicitanteActual, clienteServidor } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import { credencialesDe, type CredencialesSunat } from "@/lib/sunat/credenciales";
import { pedirExportacion, consultarTicket, bajarArchivo, type ArchivoDelTicket } from "@/lib/sunat/sire";
import { validarPeriodo } from "@/lib/sunat/periodo";
import { leerZip } from "@/lib/sunat/zip";
import { leerPropuestaRce, revisarIdentidad, type LecturaRce } from "@/lib/sunat/rce";
import {
  cruzar, notasSobreLoRendido,
  type Cruce, type ComprobanteNuestro, type ComprobanteSunat, type NotaSobreLoRendido,
} from "@/lib/dominio/cruce";

/**
 * Lo que hay que saber cuando la descarga falla.
 *
 * SUNAT contesta el fallo de `archivoreporte` con la página de error del
 * portal, sin decir qué campo la rompió. Esto viaja a la pantalla para que
 * se vea qué se mandó y qué había devuelto el ticket, en vez de tener que
 * probar combinaciones contra el servicio de producción.
 */
export interface Diagnostico {
  enviado: Record<string, string>;
  ticket: Record<string, unknown>;
}

export type Paso =
  | { tipo: "error"; motivo: string; diagnostico?: Diagnostico }
  | { tipo: "encolado"; ticket: string; periodo: string }
  | { tipo: "esperando"; ticket: string; periodo: string; estado: string }
  | { tipo: "listo"; ticket: string; periodo: string; archivo: ArchivoDelTicket; ticketCrudo: Record<string, unknown> };

export interface Resultado {
  periodo: string;
  archivo: string;
  cruce: Cruce;
  /** Qué columnas entendió del archivo de SUNAT y cuáles no. */
  lectura: Omit<LecturaRce, "filas">;
  /** Cuántos comprobantes nuestros del período entraron al cruce. */
  nuestros: number;
  /**
   * Aviso cuando la identidad leída es la de la empresa y no la del
   * proveedor. Si aparece, los conteos no valen.
   */
  identidadSospechosa: string | null;
  /** Notas de crédito o débito que caen sobre algo que alguien rindió. */
  notas: NotaSobreLoRendido[];
  /** Qué dejó esta consulta en el archivo histórico. */
  guardado: { nuevos: number; cambiados: number } | null;
}

/** Todo lo de aquí es de Administración del sistema. */
async function credenciales(
  abreviatura: string
): Promise<{ ok: true; cred: CredencialesSunat } | { ok: false; motivo: string }> {
  const solicitante = await solicitanteActual();
  if (!solicitante) return { ok: false, motivo: "Sesión no válida." };
  if (!autoriza(solicitante, "editar_catalogos").ok) {
    return { ok: false, motivo: "Solo Administración del sistema puede consultar a SUNAT." };
  }

  const sb = await clienteServidor();
  const { data: empresa } = await sb
    .from("empresas").select("ruc, abreviatura").eq("abreviatura", abreviatura).single();
  if (!empresa) return { ok: false, motivo: "Esa empresa no existe." };

  const c = credencialesDe(empresa.abreviatura, empresa.ruc, process.env);
  return c.ok ? { ok: true, cred: c.cred } : { ok: false, motivo: c.motivo };
}

function comoError(e: unknown): { tipo: "error"; motivo: string } {
  return { tipo: "error", motivo: e instanceof Error ? e.message : String(e) };
}

/** Paso 1. Le pide a SUNAT que prepare el período. */
export async function pedirPropuesta(abreviatura: string, periodo: string): Promise<Paso> {
  const p = validarPeriodo(periodo, new Date());
  if (!p.ok) return { tipo: "error", motivo: p.motivo };

  const c = await credenciales(abreviatura);
  if (!c.ok) return { tipo: "error", motivo: c.motivo };

  try {
    const ticket = await pedirExportacion(c.cred, p.periodo, "csv");
    return { tipo: "encolado", ticket, periodo: p.periodo };
  } catch (e) {
    return comoError(e);
  }
}

/** Paso 2. Pregunta una vez en qué va. La pantalla decide si vuelve a preguntar. */
export async function verTicket(abreviatura: string, periodo: string, ticket: string): Promise<Paso> {
  const c = await credenciales(abreviatura);
  if (!c.ok) return { tipo: "error", motivo: c.motivo };

  try {
    const t = await consultarTicket(c.cred, periodo, ticket);
    if (!t) return { tipo: "esperando", ticket, periodo, estado: "SUNAT todavía no sabe nada del ticket" };
    if (t.fallado) return { tipo: "error", motivo: `SUNAT rechazó el proceso: ${t.descripcion}` };
    if (t.terminado && t.archivo) {
      // Si SUNAT no repitió el período o el ticket en la respuesta, se usan
      // los que ya conocemos: `archivoreporte` los exige y descubrir que
      // faltan recién al bajar costaría otra vuelta completa.
      return {
        tipo: "listo", ticket, periodo,
        archivo: {
          ...t.archivo,
          periodo: t.archivo.periodo || periodo,
          numTicket: t.archivo.numTicket || ticket,
        },
        ticketCrudo: t.crudo,
      };
    }
    return { tipo: "esperando", ticket, periodo, estado: t.descripcion || t.estado || "en cola" };
  } catch (e) {
    return comoError(e);
  }
}

/**
 * Paso 3. Baja el archivo, lo lee y lo cruza contra lo nuestro.
 *
 * Se compara contra los comprobantes cuya fecha de emisión cae en el
 * período, que es el criterio de SUNAT. No se filtra por estado: un gasto
 * capturado y todavía sin presentar también cuenta como rendido, y dejarlo
 * fuera lo haría aparecer como una factura que nadie reportó.
 */
export async function traerYCruzar(
  abreviatura: string, periodo: string, archivo: ArchivoDelTicket,
  ticketCrudo: Record<string, unknown> = {}
): Promise<
  | { tipo: "error"; motivo: string; diagnostico?: Diagnostico }
  | { tipo: "ok"; resultado: Resultado }
> {
  const c = await credenciales(abreviatura);
  if (!c.ok) return { tipo: "error", motivo: c.motivo };

  const p = validarPeriodo(periodo, new Date());
  if (!p.ok) return { tipo: "error", motivo: p.motivo };

  const diagnostico: Diagnostico = {
    enviado: {
      nomArchivoReporte: archivo.nombre,
      codTipoArchivoReporte: archivo.tipo === "" ? "(vacío)" : archivo.tipo,
      perTributario: archivo.periodo === "" ? "(vacío)" : archivo.periodo,
      codProceso: archivo.codProceso === "" ? "(vacío)" : archivo.codProceso,
      numTicket: archivo.numTicket === "" ? "(vacío)" : archivo.numTicket,
      codLibro: "080000",
    },
    ticket: ticketCrudo,
  };

  // SUNAT responde a un campo vacío con HTTP 500 y una página de error que no
  // dice cuál. Ya pasó una vez —el tipo de archivo salía vacío porque SUNAT
  // lo escribe sin la erre— y costó dos vueltas averiguarlo. Se comprueba
  // antes de gastar la llamada, para que el mensaje nombre el campo.
  const enBlanco = Object.entries(diagnostico.enviado)
    .filter(([, v]) => v === "(vacío)")
    .map(([k]) => k);
  if (enBlanco.length) {
    return {
      tipo: "error",
      motivo: `No se puede pedir el archivo: ${enBlanco.join(", ")} vendría vacío. `
        + "SUNAT no aceptó el ticket con ese campo en blanco.",
      diagnostico,
    };
  }

  const arranque = Date.now();

  try {
    const bruto = await bajarArchivo(c.cred, archivo);
    const dentro = leerZip(bruto);
    if (dentro.length === 0) {
      return { tipo: "error", motivo: "El archivo de SUNAT vino vacío." };
    }

    // Si trae varios, el reporte es el más grande: los otros suelen ser
    // avisos de una línea.
    const reporte = dentro.reduce((a, b) => (b.contenido.length > a.contenido.length ? b : a));
    const { filas, ...lectura } = leerPropuestaRce(reporte.contenido.toString("utf8"));
    const identidad = revisarIdentidad(filas, c.cred.ruc);

    const desde = `${p.anio}-${String(p.mes).padStart(2, "0")}-01`;
    const hasta = new Date(Date.UTC(p.anio, p.mes, 0)).toISOString().slice(0, 10);

    const sb = await clienteServidor();
    const { data: gastos, error } = await sb
      .from("gastos")
      .select("id, proveedor_ruc, proveedor_nombre, tipo_comprobante, serie, numero, fecha_emision, total")
      .eq("clase", "COMPROBANTE")
      .gte("fecha_emision", desde)
      .lte("fecha_emision", hasta);

    if (error) return { tipo: "error", motivo: `No se pudieron leer los gastos: ${error.message}` };

    const nuestros: ComprobanteNuestro[] = (gastos ?? []).map(g => ({
      id: g.id,
      ruc: g.proveedor_ruc,
      tipoComprobante: g.tipo_comprobante,
      serie: g.serie,
      numero: g.numero,
      fechaEmision: g.fecha_emision,
      total: g.total == null ? null : Number(g.total),
      proveedorNombre: g.proveedor_nombre,
    }));

    const deSunat: ComprobanteSunat[] = filas.map(f => ({
      ruc: f.ruc, tipoComprobante: f.tipoComprobante, serie: f.serie,
      numero: f.numero, fechaEmision: f.fechaEmision, total: f.total,
      razonSocial: f.razonSocial, modifica: f.modifica, estado: f.estado,
    }));

    const resultado: Resultado = {
      periodo: p.periodo,
      archivo: reporte.nombre,
      cruce: cruzar(nuestros, deSunat),
      lectura,
      nuestros: nuestros.length,
      identidadSospechosa: identidad.ok ? null : identidad.motivo,
      notas: notasSobreLoRendido(nuestros, deSunat),
      guardado: null,
    };

    // Se guardan los comprobantes antes de anotar la consulta, porque el
    // conteo de cambios es parte de lo que se anota. Un fallo acá no tumba el
    // informe: la consulta ya se hizo y lo caro fue llamar a SUNAT.
    let guardado: Resultado["guardado"] = null;
    const { data: guardadoCrudo, error: errorGuardar } = await sb.rpc(
      "guardar_comprobantes_sunat",
      { p_empresa_ruc: c.cred.ruc, p_periodo: p.periodo, p_filas: filas },
    );
    if (errorGuardar) {
      console.error("No se pudieron guardar los comprobantes:", errorGuardar.message);
    } else {
      const g = Array.isArray(guardadoCrudo) ? guardadoCrudo[0] : guardadoCrudo;
      guardado = g ? { nuevos: g.nuevos ?? 0, cambiados: g.cambiados ?? 0 } : null;
    }
    resultado.guardado = guardado;

    // La constancia se deja después de tener el resultado, y su fallo no
    // tumba la consulta: quedarse sin el informe por no poder anotarlo sería
    // perder lo caro —la llamada a SUNAT— por lo barato.
    const r = resultado.cruce.resumen;
    const { error: errorBitacora } = await sb.rpc("registrar_consulta_sunat", {
      p_empresa_ruc: c.cred.ruc,
      p_periodo: p.periodo,
      p_ticket: archivo.numTicket,
      p_archivo: reporte.nombre,
      p_comprobantes_sunat: filas.length,
      p_comprobantes_nuestros: nuestros.length,
      p_cuadran: r.cuadran,
      p_monto_distinto: r.montoDistinto,
      p_no_estan_en_sunat: r.noEstanEnSunat,
      p_no_comparables: r.noComparables,
      p_solo_en_sunat: r.soloEnSunat,
      p_monto_solo_en_sunat: r.montoSoloEnSunat,
      p_columnas_faltantes: lectura.faltantes,
      p_identidad_sospechosa: resultado.identidadSospechosa,
      p_segundos: Math.round((Date.now() - arranque) / 1000),
    });
    if (errorBitacora) {
      console.error("No se pudo anotar la consulta a SUNAT:", errorBitacora.message);
    }

    return { tipo: "ok", resultado };
  } catch (e) {
    return { ...comoError(e), diagnostico };
  }
}
