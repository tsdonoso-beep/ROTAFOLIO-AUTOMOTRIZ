"use server";
// El histórico de comprobantes, para sacarlo a una hoja
//
// Se arma en el servidor y viaja ya listo: son miles de filas y el navegador
// no tiene por qué saber de dónde salen ni cruzarlas con nada.
//
// La columna que hace que esta hoja valga más que bajar el archivo del portal
// es «lo rindió»: SUNAT sabe que la factura existe, pero no que Annie la
// fotografió en una obra de Huánuco.

import { solicitanteActual, clienteServidor } from "@/lib/supabase/servidor";
import { autoriza } from "@/lib/dominio/permisos";
import {
  filasComprobantesSunat, nombreArchivoSunat, type ComprobanteHistorico,
} from "@/lib/export/comprobantes-sunat";
import { aCsv } from "@/lib/export/csv";
import { publicarHoja, explicarFallo } from "@/lib/drive/servidor";

export interface HojaHistorico {
  nombre: string;
  filas: string[][];
  /** Cuántos comprobantes trae, sin contar los títulos. */
  cuantos: number;
}

/** Cuántos comprobantes hay guardados y de qué períodos. */
export async function periodosGuardados(): Promise<Array<{ periodo: string; cuantos: number }>> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return [];

  const sb = await clienteServidor();
  const { data } = await sb.from("comprobantes_sunat").select("periodo");

  const cuenta = new Map<string, number>();
  for (const c of data ?? []) cuenta.set(c.periodo, (cuenta.get(c.periodo) ?? 0) + 1);

  return [...cuenta.entries()]
    .map(([periodo, cuantos]) => ({ periodo, cuantos }))
    .sort((a, b) => b.periodo.localeCompare(a.periodo));
}

/**
 * Arma la hoja de un período, o de todo si no se pide ninguno.
 *
 * Devuelve las filas y no un archivo: el navegador lo descarga con el mismo
 * camino que usan las demás exportaciones de la aplicación, así el separador
 * y el BOM salen iguales en todas.
 */
export async function hojaDelHistorico(periodo?: string): Promise<HojaHistorico | null> {
  const solicitante = await solicitanteActual();
  if (!solicitante || !autoriza(solicitante, "exportar").ok) return null;

  const sb = await clienteServidor();

  let consulta = sb
    .from("comprobantes_sunat")
    .select(`
      periodo, proveedor_ruc, proveedor_nombre, tipo_comprobante, serie, numero,
      fecha_emision, total, moneda, estado, tipo_nota,
      modifica_tipo, modifica_serie, modifica_numero, car_sunat,
      primera_vez, ultima_vez,
      cambios_comprobante_sunat ( id )
    `)
    .order("fecha_emision", { ascending: true })
    .order("numero", { ascending: true });

  if (periodo) consulta = consulta.eq("periodo", periodo);

  const { data, error } = await consulta;
  if (error || !data) return null;

  // Quién rindió cada comprobante. Se traen los gastos de una vez y se
  // emparejan en memoria: una consulta por comprobante serían miles.
  const { data: gastos } = await sb
    .from("gastos")
    .select("proveedor_ruc, tipo_comprobante, serie, numero, usuarios:usuario_id ( nombre )")
    .eq("clase", "COMPROBANTE")
    .not("numero", "is", null);

  const sinCeros = (v: string | null) => (v ?? "").replace(/^0+/, "") || null;
  const llave = (ruc: string | null, tipo: string | null, serie: string | null, numero: string | null) =>
    [ruc ?? "", tipo ?? "", (serie ?? "").toUpperCase(), sinCeros(numero) ?? ""].join("|");

  const quienRindio = new Map<string, string>();
  for (const g of gastos ?? []) {
    const u = g.usuarios as unknown as { nombre?: string } | null;
    if (u?.nombre) {
      quienRindio.set(llave(g.proveedor_ruc, g.tipo_comprobante, g.serie, g.numero), u.nombre);
    }
  }

  const historico: ComprobanteHistorico[] = data.map(c => ({
    periodo: c.periodo,
    proveedorRuc: c.proveedor_ruc,
    proveedorNombre: c.proveedor_nombre,
    tipoComprobante: c.tipo_comprobante,
    serie: c.serie,
    numero: c.numero,
    fechaEmision: c.fecha_emision,
    total: c.total == null ? null : Number(c.total),
    moneda: c.moneda,
    estado: c.estado,
    tipoNota: c.tipo_nota,
    modificaTipo: c.modifica_tipo,
    modificaSerie: c.modifica_serie,
    modificaNumero: c.modifica_numero,
    carSunat: c.car_sunat,
    primeraVez: c.primera_vez,
    ultimaVez: c.ultima_vez,
    rendidoPor: quienRindio.get(
      llave(c.proveedor_ruc, c.tipo_comprobante, c.serie, c.numero)
    ) ?? null,
    cambios: (c.cambios_comprobante_sunat as unknown as unknown[] | null)?.length ?? 0,
  }));

  return {
    nombre: nombreArchivoSunat(periodo ?? null),
    filas: filasComprobantesSunat(historico),
    cuantos: historico.length,
  };
}


/**
 * Deja el histórico como hoja de Google, para Contabilidad.
 *
 * Se publica siempre con el mismo nombre en la misma carpeta, así el enlace
 * se reparte una vez y sirve para siempre. Reescribir pisa lo que se haya
 * anotado encima: esta hoja es la fuente, y quien quiera trabajar sobre ella
 * que la traiga a la suya con IMPORTRANGE.
 */
export async function publicarHistoricoEnDrive(): Promise<
  { ok: true; url: string; cuantos: number; reemplazada: boolean } | { ok: false; motivo: string }
> {
  const hoja = await hojaDelHistorico();
  if (!hoja) return { ok: false, motivo: "No se pudo armar la hoja. ¿Sigue abierta la sesión?" };
  if (hoja.cuantos === 0) {
    return { ok: false, motivo: "No hay comprobantes guardados todavía. Consulta un período primero." };
  }

  try {
    const r = await publicarHoja({
      csv: aCsv(hoja.filas),
      nombre: "COMPROBANTES SUNAT",
      carpetas: ["SUNAT"],
    });
    return { ok: true, url: r.url, cuantos: hoja.cuantos, reemplazada: r.reemplazada };
  } catch (e) {
    return { ok: false, motivo: explicarFallo(e) };
  }
}
