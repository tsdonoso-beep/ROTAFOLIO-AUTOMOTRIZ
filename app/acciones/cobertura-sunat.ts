"use server";
// Cobertura: qué de lo declarado a SUNAT ya tiene su detalle bajado
//
// Cruza `comprobantes_sunat` (todo lo declarado, vía RCE/SIRE) contra
// `cpe_comprobante` (lo que el scraper ya bajó). El cruce en sí vive en la
// base (`cobertura_cpe` / `resumen_cobertura_cpe`); acá solo se pide, se
// convierte y se publica.

import { solicitanteActual, clienteServidor } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import {
  filasCoberturaSunat, filaCoberturaDesdeRpc, nombreArchivoCobertura, TIPOS_COBERTURA,
  filasResumenCobertura, filaResumenDesdeRpc, NOMBRE_RESUMEN_COBERTURA, TIPOS_RESUMEN_COBERTURA,
  type FilaCobertura, type FilaResumenCobertura,
} from "@/lib/export/cobertura-sunat";
import { publicarHoja, explicarFallo } from "@/lib/drive/servidor";

async function filasCobertura(periodo?: string): Promise<FilaCobertura[] | null> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return null;

  const sb = await clienteServidor();
  const { data, error } = await sb.rpc("cobertura_cpe", { p_periodo: periodo ?? null });
  if (error || !Array.isArray(data)) return null;

  return (data as Record<string, unknown>[]).map(filaCoberturaDesdeRpc);
}

async function filasResumen(): Promise<FilaResumenCobertura[] | null> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return null;

  const sb = await clienteServidor();
  const { data, error } = await sb.rpc("resumen_cobertura_cpe");
  if (error || !Array.isArray(data)) return null;

  return (data as Record<string, unknown>[]).map(filaResumenDesdeRpc);
}

/** El resumen por período, para mostrarlo en la app sin tener que publicar nada. */
export async function resumenCobertura(): Promise<FilaResumenCobertura[]> {
  return (await filasResumen()) ?? [];
}

export interface HojaCobertura {
  nombre: string;
  filas: string[][];
  cuantos: number;
}

/** Arma la hoja de cobertura, para bajarla como CSV. */
export async function hojaDeCobertura(periodo?: string): Promise<HojaCobertura | null> {
  const filas = await filasCobertura(periodo);
  if (!filas) return null;
  return { nombre: nombreArchivoCobertura(periodo ?? null), filas: filasCoberturaSunat(filas), cuantos: filas.length };
}

type ResultadoPublicar =
  | { ok: true; url: string; cuantos: number; reemplazada: boolean }
  | { ok: false; motivo: string };

/** Publica el detalle de cobertura —una fila por comprobante del RCE—. */
export async function publicarCoberturaEnDrive(): Promise<ResultadoPublicar> {
  const hoja = await hojaDeCobertura();
  if (!hoja) return { ok: false, motivo: "No se pudo armar la hoja. ¿Sigue abierta la sesión?" };
  if (hoja.cuantos === 0) return { ok: false, motivo: "No hay comprobantes en el registro de compras todavía." };

  try {
    const r = await publicarHoja({
      filas: hoja.filas, nombre: "COMPROBANTES SUNAT - COBERTURA",
      carpetas: ["SUNAT"], tipos: TIPOS_COBERTURA,
    });
    return { ok: true, url: r.url, cuantos: hoja.cuantos, reemplazada: r.reemplazada };
  } catch (e) {
    return { ok: false, motivo: explicarFallo(e) };
  }
}

/** Publica el resumen por período —una fila por mes, con su % de cobertura—. */
export async function publicarResumenCoberturaEnDrive(): Promise<ResultadoPublicar> {
  const filas = await filasResumen();
  if (!filas) return { ok: false, motivo: "No se pudo armar el resumen. ¿Sigue abierta la sesión?" };
  if (filas.length === 0) return { ok: false, motivo: "No hay comprobantes en el registro de compras todavía." };

  try {
    const r = await publicarHoja({
      filas: filasResumenCobertura(filas), nombre: NOMBRE_RESUMEN_COBERTURA,
      carpetas: ["SUNAT"], tipos: TIPOS_RESUMEN_COBERTURA,
    });
    return { ok: true, url: r.url, cuantos: filas.length, reemplazada: r.reemplazada };
  } catch (e) {
    return { ok: false, motivo: explicarFallo(e) };
  }
}
