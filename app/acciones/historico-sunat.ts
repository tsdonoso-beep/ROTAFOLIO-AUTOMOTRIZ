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

  // Por función y no leyendo la tabla: PostgREST corta toda lectura en 1000
  // filas sin avisar, y con 13 000 comprobantes la pantalla mostraba «1000
  // comprobantes, 2 períodos» como si fuera todo lo que hay.
  const sb = await clienteServidor();
  const { data, error } = await sb.rpc("periodos_de_comprobantes_sunat");
  if (error || !Array.isArray(data)) return [];
  return data as Array<{ periodo: string; cuantos: number }>;
}

/**
 * Trae todas las filas de una consulta, no las primeras mil.
 *
 * El límite de PostgREST no da error: devuelve 200 y mil filas. Se pagina
 * hasta que una página llegue incompleta, que es la señal de que se acabó.
 */
async function todasLasFilas<T>(
  hacer: (desde: number, hasta: number) => PromiseLike<{ data: T[] | null; error: unknown }>
): Promise<T[]> {
  const TAMANO = 1000;
  const salida: T[] = [];
  for (let desde = 0; ; desde += TAMANO) {
    const { data, error } = await hacer(desde, desde + TAMANO - 1);
    if (error || !data) break;
    salida.push(...data);
    if (data.length < TAMANO) break;
  }
  return salida;
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

  // Por función: son trece mil filas, y leyendo la tabla llegarían mil. La
  // función también cuenta los cambios de cada comprobante de una vez; pedir
  // ese conteo anidado desde PostgREST expiraba por tiempo.
  const { data, error } = await sb.rpc("historico_comprobantes_sunat", {
    p_periodo: periodo ?? null,
  });
  if (error || !Array.isArray(data)) return null;

  // Quién rindió cada comprobante. Se traen los gastos de una vez y se
  // emparejan en memoria: una consulta por comprobante serían trece mil.
  const gastos = await todasLasFilas<{
    proveedor_ruc: string | null; tipo_comprobante: string | null;
    serie: string | null; numero: string | null;
    usuarios: { nombre?: string } | null;
  }>((desde, hasta) =>
    sb.from("gastos")
      .select("proveedor_ruc, tipo_comprobante, serie, numero, usuarios:usuario_id ( nombre )")
      .eq("clase", "COMPROBANTE")
      .not("numero", "is", null)
      .range(desde, hasta) as never
  );

  const sinCeros = (v: string | null) => (v ?? "").replace(/^0+/, "") || null;
  const llave = (ruc: string | null, tipo: string | null, serie: string | null, numero: string | null) =>
    [ruc ?? "", tipo ?? "", (serie ?? "").toUpperCase(), sinCeros(numero) ?? ""].join("|");

  const quienRindio = new Map<string, string>();
  for (const g of gastos) {
    const u = g.usuarios as unknown as { nombre?: string } | null;
    if (u?.nombre) {
      quienRindio.set(llave(g.proveedor_ruc, g.tipo_comprobante, g.serie, g.numero), u.nombre);
    }
  }

  const historico: ComprobanteHistorico[] = (data as ComprobanteHistorico[]).map(c => ({
    ...c,
    total: c.total == null ? null : Number(c.total),
    rendidoPor: quienRindio.get(
      llave(c.proveedorRuc, c.tipoComprobante, c.serie, c.numero)
    ) ?? null,
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
